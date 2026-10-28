import { useEffect, useMemo, useRef, useState } from 'react';
import { addVideo, getAllCities, getVideoByUrl } from '../db/videos';
import type { Category, CityRecord, VideoRecord } from '../db/schema';
import { detectPlatform, normalizeUrl, parseShareText, splitLinks } from '../ingest/parse';
import type { LinkHit } from '../ingest/parse';
import { buildPickScript, parsePickList, parsePickResult } from '../ingest/pick';
import { fetchPageHtml } from '../ingest/fetch';
import { pingRelay, relayBaseUrl, setRelayBaseUrl } from '../ingest/relay';
import type { RelayHealth } from '../ingest/relay';
import { extractMeta, hasUsableMeta } from '../ingest/extract';
import type { VideoMeta } from '../ingest/extract';
import { RATE_LIMIT_MS } from '../ingest/proxies';
import { RELAY_DEFAULT_PATH } from '../ingest/relay';
import { buildDictionary, detectCity } from '../ingest/geo';
import type { GeoCandidate } from '../ingest/geo';
import { classify } from '../ingest/classify';
import type { ClassifyHit } from '../ingest/classify';
import Icon from '../ui/Icon';

type RowStatus = 'queued' | 'fetching' | 'ok' | 'failed' | 'saved' | 'duplicate';

interface Row {
  id: number;
  /** 规范化地址（已去 xsec_token），入库与去重用它 */
  url: string;
  /** 抓取专用地址：带 token 的原地址（无 token 小红书会 302 到 /404） */
  fetchUrl?: string;
  status: RowStatus;
  message?: string;
  meta?: VideoMeta;
  via?: string;
  manual?: VideoMeta;
  savedVideo?: VideoRecord;
  /** M3 识别结果（可被人工下拉覆盖） */
  category?: Category;
  cityCode?: string;
  geoConfidence?: number;
  catConfidence?: number;
  hits?: ClassifyHit[];
  geoCandidates?: GeoCandidate[];
  /** 用户手动改过分类/城市 → 落库 categorySource=manual（§5.2 规则4） */
  edited?: boolean;
}

const STATUS_LABEL: Record<RowStatus, { text: string; cls: string }> = {
  queued: { text: '排队', cls: 'bg-surface-2 text-ink-3' },
  fetching: { text: '抓取中', cls: 'bg-surface-2 text-ink-2 animate-pulse' },
  ok: { text: '待入库', cls: 'bg-food-soft text-food' },
  failed: { text: '失败', cls: 'bg-danger-soft text-danger' },
  saved: { text: '已入库', cls: 'bg-travel-soft text-travel' },
  duplicate: { text: '重复', cls: 'bg-warn-soft text-warn' },
};

/** 置信度低于此值标黄提示复核（§5.1 / §5.2） */
const LOW_CONF = 0.6;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Entry {
  url: string;
  /** 抓取用的原地址（仅当与规范地址不同，即带 xsec_token 时） */
  fetchUrl?: string;
  /** 分享文案/取词结果自带标题时，免走抓取直接识别 */
  meta?: VideoMeta;
}

/** 规范地址用于入库；原地址与它不同（带 token）就另存一份供抓取 */
function toEntry(hit: LinkHit, meta?: VideoMeta): Entry {
  return { url: hit.norm, ...(hit.raw === hit.norm ? {} : { fetchUrl: hit.raw }), ...(meta ? { meta } : {}) };
}

/**
 * 智能解析粘贴内容，优先级：取词 JSON > 分享文案（带标题，免抓取）> 纯链接（需抓取）。
 * 三条路径都保留带 token 的原地址，保证后续「重试抓取」还能拿到正文。
 */
export function extractEntries(text: string): Entry[] {
  const picked = parsePickList(text);
  const withUrl = picked.filter((m) => m.url && detectPlatform(m.url));
  if (withUrl.length) {
    // 取词脚本可批量回传：一条一个 entry，自带标题所以全部免抓取
    return withUrl.map(({ url, ...meta }) => toEntry({ norm: normalizeUrl(url!), raw: url! }, meta));
  }
  const entries: Entry[] = [];
  const seen = new Set<string>();
  for (const block of text.split(/\r?\n\s*\r?\n/)) {
    if (!/https?:\/\//.test(block)) continue;
    const share = parseShareText(block);
    if (!share) continue;
    if (!detectPlatform(share.url)) continue;
    const hit = { norm: normalizeUrl(share.url), raw: share.url };
    if (seen.has(hit.norm)) continue;
    seen.add(hit.norm);
    entries.push(toEntry(hit, share.title ? { title: share.title, desc: share.desc } : undefined));
  }
  if (entries.length > 0) return entries;
  return splitLinks(text).map((hit) => toEntry(hit));
}

export default function ImportPage() {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const nextId = useRef(1);

  // 城市词典：从 db 灌入的城市构建一次，供识别与下拉共用
  const [cities, setCities] = useState<CityRecord[]>([]);
  useEffect(() => {
    getAllCities().then(setCities).catch(() => setCities([]));
  }, []);
  const dict = useMemo(() => buildDictionary(cities), [cities]);

  const patchRow = (id: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  /** 对某行跑城市识别 + 分类打分，回填建议 */
  function analyze(meta: VideoMeta): Pick<Row, 'category' | 'cityCode' | 'geoConfidence' | 'catConfidence' | 'hits' | 'geoCandidates'> {
    const geo = detectCity({ title: meta.title, desc: meta.desc }, dict);
    const cls = classify(meta.title, meta.desc);
    return {
      category: cls.category,
      cityCode: geo.cityCode,
      geoConfidence: geo.confidence,
      catConfidence: cls.confidence,
      hits: cls.hits,
      geoCandidates: geo.candidates,
    };
  }

  async function parseOne(row: Row): Promise<void> {
    patchRow(row.id, { status: 'fetching' });
    const platform = detectPlatform(row.url)?.platform;
    // 抓取用带 token 的原地址，入库用规范地址（§4.3）
    const target = row.fetchUrl ?? row.url;
    try {
      const { html, via, meta: relayMeta } = await fetchPageHtml(target);
      // 中转直接回结构化元数据（未截断正文 + 话题 + 真封面），其他通道只能前端提 HTML
      const meta = relayMeta ?? extractMeta(html, platform!);
      if (hasUsableMeta(meta)) {
        const existing = await getVideoByUrl(row.url);
        patchRow(row.id, {
          status: existing ? 'duplicate' : 'ok',
          meta,
          via,
          message: existing ? 'url 已存在' : undefined,
          ...(existing ? {} : analyze(meta)),
        });
      } else {
        // 拿到页面但提不出标题 = 被踢到 404 / 风控页 / token 失效
        patchRow(row.id, {
          status: 'failed',
          via,
          message:
            platform !== 'xiaohongshu'
              ? '页面未解析出标题（可能链接失效或需验证），请重试或手动录入。'
              : !row.fetchUrl
                ? '这条链接里没有 xsec_token（小红书用它给分享链放行），裸地址会被踢到 404。请粘 App 里的整段分享文案，或从笔记页「复制链接」拿带 token 的完整链接。'
                : '各通道都没取到正文（token 已过期，或这篇笔记设了权限）。可重试抓取，或用下方取词脚本，或直接手动录入。',
        });
      }
    } catch (e) {
      patchRow(row.id, {
        status: 'failed',
        message: (e instanceof Error ? e.message : String(e)) + '（中转与各通道不可达：本机中转未启动可运行 npm run relay，或改用取词脚本、手动录入）',
      });
    }
  }

  async function startParse() {
    const entries = extractEntries(text);
    if (entries.length === 0) return;
    const newRows: Row[] = entries.map((e) => {
      const link = detectPlatform(e.url);
      if (!link) {
        return { id: nextId.current++, url: e.url, status: 'failed', message: '不支持的链接（仅小红书 / 微信公众号）' };
      }
      if (e.meta) {
        // 分享文案/取词结果自带标题 → 免抓取，直接进识别
        return { id: nextId.current++, url: e.url, fetchUrl: e.fetchUrl, status: 'ok', meta: e.meta, via: '粘贴', ...analyze(e.meta) };
      }
      return { id: nextId.current++, url: e.url, fetchUrl: e.fetchUrl, status: 'queued' };
    });
    setRows((rs) => [...rs, ...newRows]);
    setText('');

    setRunning(true);
    for (const row of newRows) {
      if (row.status !== 'queued') continue;
      await parseOne(row);
      await sleep(RATE_LIMIT_MS);
    }
    setRunning(false);
  }

  /** 入库：写意识别出的城市/分类；用户改过则 categorySource=manual */
  async function saveRow(row: Row) {
    const meta = row.manual ?? row.meta;
    if (!meta?.title) return;
    const platform = detectPlatform(row.url)!.platform;
    const r = await addVideo({
      url: row.url,
      platform,
      title: meta.title,
      desc: meta.desc || undefined,
      cover: meta.cover,
      category: row.category ?? 'unknown',
      categorySource: row.edited ? 'manual' : 'auto',
      cityCode: row.cityCode ?? 'unknown',
      geoConfidence: row.geoConfidence,
    });
    if (r.ok) patchRow(row.id, { status: 'saved', savedVideo: r.video });
    else patchRow(row.id, { status: 'duplicate', message: 'url 已存在' });
  }

  const cityName = (code: string) => cities.find((c) => c.code === code)?.name ?? '未识别';

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 overflow-y-auto px-6 py-7">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-ink">导入链接</h1>
          <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-ink-3">
            每行一条小红书 / 微信公众号链接，支持直接粘贴带文案的分享内容。
            抓取后自动识别城市与吃/玩分类，置信度偏低的会标出，可就地纠正。
            小红书要用分享出来的完整地址（带 xsec_token），去掉它的裸地址会被平台拦下。
          </p>
        </div>
        <span className="kd-label shrink-0">{cities.length} 个城市词典</span>
      </div>

      <RelayBar />

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={'每行一条链接，或直接粘贴小红书分享文案 / 取词脚本回传的 JSON\n例：成都探店｜这家人均 40 的苍蝇馆子绝了\nhttp://xhslink.com/xxxx …'}
        className="kd-input w-full resize-y !rounded-xl font-mono text-[12.5px] leading-relaxed"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={startParse}
          disabled={running || !text.trim() || dict.length === 0}
          className="kd-btn kd-btn-primary"
        >
          {running ? '解析中…' : dict.length === 0 ? '城市库加载中…' : '开始解析'}
        </button>
        {rows.length > 0 && (
          <button onClick={() => setRows([])} className="kd-btn kd-btn-ghost">
            清空列表
          </button>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.id} className="kd-card p-3.5">
            <div className="flex items-center gap-2.5">
              <span className={`kd-chip ${STATUS_LABEL[row.status].cls}`}>
                {STATUS_LABEL[row.status].text}
              </span>
              <a
                href={row.fetchUrl ?? row.url}
                target="_blank"
                rel="noreferrer"
                className="truncate text-[12.5px] text-ink-2 underline decoration-line decoration-1 underline-offset-2 hover:text-food"
              >
                {row.url}
              </a>
              {row.via && <span className="ml-auto shrink-0 text-[11px] text-ink-3">via {row.via}</span>}
            </div>
            {row.message && (
              <p className="mt-1.5 text-[12px] leading-relaxed text-danger">{row.message}</p>
            )}

            {(row.status === 'ok' || row.status === 'failed') && (
              <RowEditor
                row={row}
                cities={cities}
                canAnalyze={dict.length > 0}
                onMetaChange={(m) => patchRow(row.id, { meta: row.status === 'ok' ? m : row.meta, manual: row.status === 'failed' ? m : row.manual })}
                onPickMeta={(m) => patchRow(row.id, { manual: m, edited: false, ...analyze(m) })}
                onReanalyze={() => {
                  const m = row.manual ?? row.meta;
                  if (m) patchRow(row.id, { ...analyze(m), edited: false });
                }}
                onCategory={(c) => patchRow(row.id, { category: c, edited: true })}
                onCity={(code, conf) => patchRow(row.id, { cityCode: code, geoConfidence: conf, edited: true })}
                onSave={() => void saveRow(row)}
                onRetry={row.status === 'failed' ? () => void parseOne(row) : undefined}
                cityName={cityName}
              />
            )}

            {row.status === 'saved' && (
              <p className="mt-1.5 text-[12px] text-travel">「{row.manual?.title ?? row.meta?.title}」已写入本地数据库</p>
            )}
            {row.status === 'duplicate' && (
              <p className="mt-1.5 text-[12px] text-warn">该链接已存在，未重复写入</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface EditorProps {
  row: Row;
  cities: CityRecord[];
  canAnalyze: boolean;
  onMetaChange: (m: VideoMeta) => void;
  /** 取词脚本回传：同时写入 manual 并立即重跑识别 */
  onPickMeta: (m: VideoMeta) => void;
  onReanalyze: () => void;
  onCategory: (c: Category) => void;
  onCity: (code: string, conf: number) => void;
  onSave: () => void;
  onRetry?: () => void;
  cityName: (code: string) => string;
}

function RowEditor(p: EditorProps) {
  const { row } = p;
  const meta = row.manual ?? row.meta ?? { title: '', desc: '' };
  const isManual = row.status === 'failed';
  const geoLow = row.cityCode && row.cityCode !== 'unknown' && (row.geoConfidence ?? 0) < LOW_CONF;
  const catLow = row.category && row.category !== 'unknown' && (row.catConfidence ?? 0) < LOW_CONF;
  const hitTip = (row.hits ?? []).map((h) => `${h.word}(${h.weight},${h.where})`).join('、') || '无词表命中';

  return (
    <div className="mt-2.5 flex flex-col gap-2">
      <input
        className="kd-input w-full text-[13px]"
        defaultValue={meta.title}
        placeholder={isManual ? '手动录入标题（必填）' : '标题'}
        onChange={(e) => p.onMetaChange({ ...meta, title: e.target.value })}
      />
      <textarea
        className="kd-input w-full text-[12px] leading-relaxed"
        rows={2}
        defaultValue={meta.desc}
        placeholder="描述/正文摘要/标签（用于城市识别与分类）"
        onChange={(e) => p.onMetaChange({ ...meta, desc: e.target.value })}
      />

      {isManual && <PickHelper url={row.fetchUrl ?? row.url} onPick={p.onPickMeta} />}

      {/* 识别结果行：城市 + 分类 + 重新识别 + 入库 */}
      <div className="flex flex-wrap items-center gap-2.5 text-[12.5px]">
        <label className="flex items-center gap-1.5 text-ink-3">
          <Icon name="pin" className="h-3.5 w-3.5" />
          城市
          <select
            className={`kd-input !px-2 !py-1 text-[12px] ${geoLow ? 'kd-low' : ''}`}
            value={row.cityCode ?? 'unknown'}
            onChange={(e) => p.onCity(e.target.value, 1)}
          >
            <option value="unknown">未识别</option>
            {p.cities.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
          {geoLow && <Icon name="alert" className="h-3.5 w-3.5 text-warn" />}
          {row.geoConfidence != null && row.cityCode !== 'unknown' && (
            <span className="text-[11px] tabular-nums">{Math.round(row.geoConfidence * 100)}%</span>
          )}
        </label>

        <label className="flex items-center gap-1.5 text-ink-3" title={hitTip}>
          <Icon name="tag" className="h-3.5 w-3.5" />
          分类
          <select
            className={`kd-input !px-2 !py-1 text-[12px] ${catLow ? 'kd-low' : ''}`}
            value={row.category ?? 'unknown'}
            onChange={(e) => p.onCategory(e.target.value as Category)}
          >
            <option value="unknown">待定</option>
            <option value="food">吃</option>
            <option value="travel">玩</option>
          </select>
          {row.catConfidence != null && row.category !== 'unknown' && (
            <span className="cursor-help text-[11px] tabular-nums" title={hitTip}>{Math.round(row.catConfidence * 100)}%</span>
          )}
        </label>

        <div className="ml-auto flex items-center gap-2">
          {p.canAnalyze && (
            <button onClick={p.onReanalyze} className="kd-btn kd-btn-ghost !px-2.5 !py-1 text-[12px]">
              重新识别
            </button>
          )}
          {p.onRetry && (
            <button onClick={p.onRetry} className="kd-btn kd-btn-ghost !px-2.5 !py-1 text-[12px]">重试抓取</button>
          )}
          <button
            onClick={p.onSave}
            disabled={!meta.title}
            className="kd-btn kd-btn-primary !px-3 !py-1 text-[12px]"
          >
            {isManual ? '手动入库' : '入库'}
          </button>
        </div>
      </div>
      {row.edited && <p className="text-[11px] text-ink-3">已手动修正，入库后分类来源记为 manual，不会被自动覆盖</p>}
    </div>
  );
}

/**
 * 中转服务状态灯 + 地址入口（§4.5）。
 * 本机：先跑 npm run relay，地址留空走 vite 代理；部署后：填公网地址，存 localStorage 长期使用。
 */
function RelayBar() {
  const [base, setBase] = useState(() => relayBaseUrl());
  const [draft, setDraft] = useState('');
  const [health, setHealth] = useState<RelayHealth | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    setHealth(await pingRelay());
    setBase(relayBaseUrl());
    setBusy(false);
  }

  useEffect(() => {
    void check();
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-[12px]">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${!health ? 'bg-line-2' : health.ok ? 'bg-travel' : 'bg-danger'}`}
      />
      <span className="shrink-0 font-medium text-ink-2">中转服务</span>
      <span className="min-w-0 flex-1 truncate text-ink-3" title={health?.detail}>
        {busy ? '检测中…' : health ? `${health.detail} · ${health.ms}ms` : '未检测'}
        <span className="ml-1.5 font-mono text-[11px]">{base}</span>
      </span>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={base === RELAY_DEFAULT_PATH ? '默认 /api/fetch，可填中转地址' : base}
        className="kd-input w-52 !px-2 !py-1 font-mono text-[11.5px]"
      />
      <button
        onClick={() => {
          setRelayBaseUrl('');
          setDraft('');
          void check();
        }}
        className="kd-btn kd-btn-ghost !px-2.5 !py-1 text-[12px]"
      >
        恢复默认
      </button>
      <button
        onClick={() => {
          if (draft.trim()) setRelayBaseUrl(draft);
          setDraft('');
          void check();
        }}
        disabled={busy}
        className="kd-btn kd-btn-primary !px-2.5 !py-1 text-[12px]"
      >
        {draft.trim() ? '保存并测试' : '重新检测'}
      </button>
      <p className="w-full leading-relaxed text-ink-3">
        本机跑 npm run relay（监听 127.0.0.1:8787，vite 已代理，地址留空即可）；有已部署的中转就填在后面。
        连不上时自动降级 r.jina.ai → 公共代理 → 分享文案粘贴。
      </p>
    </div>
  );
}

/** 取词助手：中转通道失效时的兜底，从浏览器页签里直读笔记 DOM */
function PickHelper({ url, onPick }: { url: string; onPick: (m: VideoMeta) => void }) {
  const script = useMemo(() => buildPickScript(), []);
  const [copied, setCopied] = useState(false);
  const [paste, setPaste] = useState('');
  const [err, setErr] = useState('');

  async function copyScript() {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setErr('自动复制失败，请手动选中脚本复制');
    }
  }

  function fill() {
    const m = parsePickResult(paste);
    if (!m) {
      setErr('没识别到含 title 的 JSON，请确认粘贴的是脚本输出');
      return;
    }
    onPick({ title: m.title, desc: m.desc, cover: m.cover });
    setErr('');
    setPaste('');
  }

  return (
    <details className="rounded-lg border border-line bg-surface-2/50 p-3 text-[12px]">
      <summary className="cursor-pointer select-none font-medium text-ink-2">
        页签取词（中转通道不可用时的兜底，一次一条）
      </summary>
      <ol className="mt-2 list-decimal space-y-1 pl-4 text-ink-3 marker:text-ink-3">
        <li>
          先打开这条笔记（带 token 的分享链无需登录），或{' '}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-food underline decoration-line-2 underline-offset-2"
          >
            打开
          </a>
        </li>
        <li>复制脚本，在笔记页签按 F12 的 Console 粘贴执行（结果自动复制到剪贴板）</li>
        <li>回到这里粘到下方框，点「填入」。要一次进多条：直接粘 App 里的整段分享文案（自带标题与话题，无需抓取）</li>
      </ol>
      <div className="mt-2.5 flex items-start gap-2">
        <code className="max-h-24 flex-1 overflow-y-auto whitespace-pre-wrap rounded-md border border-line bg-surface p-2 font-mono text-[10.5px] leading-relaxed text-ink-3">
          {script}
        </code>
        <button onClick={() => void copyScript()} className="kd-btn kd-btn-ghost shrink-0 !px-2.5 !py-1 text-[12px]">
          {copied ? '已复制' : '复制脚本'}
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={2}
          placeholder='粘贴取词结果，如 {"title":"…","desc":"…","cover":"…"}'
          className="kd-input min-w-0 flex-1 text-[12px]"
        />
        <button onClick={fill} disabled={!paste.trim()} className="kd-btn kd-btn-primary shrink-0 self-center !px-3 !py-1 text-[12px]">
          填入
        </button>
      </div>
      {err && <p className="mt-1.5 text-danger">{err}</p>}
    </details>
  );
}
