import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAllCities, seedCities } from '../db/schema';
import type { CityRecord, VideoRecord } from '../db/schema';
import { listVideos, listVisitedRecords } from '../db/videos';
import type { VisitedRecord } from '../db/videos';
import {
  blockAdcodes,
  groupByBlock,
  litProvincesOf,
  loadGeo,
  loadProvinces,
  namesOf,
  provinceAdcodeOf,
} from '../journal/adcode';
import type { GeoCollection } from '../journal/geoTypes';
import JournalMap from '../journal/JournalMap';
import Icon from '../ui/Icon';

/** zh-CN 下正好是 2026/10/30，与抽屉里的日期口径一致 */
const fmtDay = (ts: number) => new Date(ts).toLocaleDateString('zh-CN');

const CAT_DOT: Record<string, string> = { food: 'bg-food', travel: 'bg-travel', unknown: 'bg-ink-3/40' };

export default function JournalPage() {
  const [geo, setGeo] = useState<GeoCollection | null>(null);
  const [provinces, setProvinces] = useState<GeoCollection | null>(null);
  const [geoFailed, setGeoFailed] = useState(false);
  const [cities, setCities] = useState<CityRecord[]>([]);
  /** 已点亮的记录：城市与色块都从它派生，不落库（§6.6） */
  const [lit, setLit] = useState<VisitedRecord[] | null>(null);
  /** 全量记录：未点亮的块也要能回答「这里到底有没有东西可点亮」 */
  const [all, setAll] = useState<VideoRecord[] | null>(null);
  const [picked, setPicked] = useState('');

  async function reload() {
    await seedCities().catch(() => {});
    const [cs, rows, vs] = await Promise.all([getAllCities(), listVisitedRecords(), listVideos()]);
    setCities(cs);
    setLit(rows);
    setAll(vs);
  }

  function retryGeo() {
    setGeoFailed(false);
    // 两份几何一起走：缺省界的地图不算画完，不要一半亮一半空白
    Promise.all([loadGeo(), loadProvinces()])
      .then(([g, p]) => {
        setGeo(g);
        setProvinces(p);
      })
      .catch(() => setGeoFailed(true));
  }

  useEffect(() => {
    void reload();
    retryGeo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const blocks = useMemo(() => (geo ? blockAdcodes(geo) : null), [geo]);
  const byBlock = useMemo(
    () => (blocks && lit ? groupByBlock(lit, blocks) : new Map<string, VisitedRecord[]>()),
    [blocks, lit],
  );
  const litSet = useMemo(() => new Set(byBlock.keys()), [byBlock]);
  const cityName = useMemo(() => new Map(cities.map((c) => [c.code, c.name])), [cities]);
  const blockName = useMemo(() => (geo ? namesOf(geo) : new Map<string, string>()), [geo]);
  const provSet = useMemo(() => (provinces ? blockAdcodes(provinces) : null), [provinces]);
  const provName = useMemo(() => (provinces ? namesOf(provinces) : new Map<string, string>()), [provinces]);
  // 战果卡两个数都按色块口径：跟地图上亮着的块 1:1 对得上，用户数得出来。
  // （城市口径是 743 城，拿它当分子除以 370 会算出超过分母的数）
  const litProvCount = useMemo(
    () => (provSet ? litProvincesOf(litSet, provSet).length : 0),
    [litSet, provSet],
  );

  const detail = useMemo(
    () => (byBlock.get(picked) ?? []).slice().sort((a, b) => a.visitedAt - b.visitedAt),
    [byBlock, picked],
  );
  /** 全量记录按块归组：用来区分「有记录但没插旗」与「压根没导入过」 */
  const withRecords = useMemo(
    () => (blocks && all ? groupByBlock(all, blocks) : new Map<string, VideoRecord[]>()),
    [blocks, all],
  );

  // 面板标题：省 · 市。直辖市与港澳的块名就是省名本身，拼起来会变成「北京市 · 北京市」，只留一个
  const pickedCity = blockName.get(picked) ?? picked;
  const pickedProv = provName.get(provinceAdcodeOf(picked)) ?? '';
  const pickedTitle = pickedProv && pickedProv !== pickedCity ? `${pickedProv} · ${pickedCity}` : pickedCity;
  const pickedRecords = withRecords.get(picked) ?? [];
  /* 跳地图页开抽屉要的是城市库里的 code：块码未必是座城（台湾块就是），
   * 所以优先用该块内某条记录的 code——它一定在城市库里。 */
  const jumpCity = pickedRecords[0]?.cityCode ?? (cityName.has(picked) ? picked : '');

  function handleSelect(ad: string) {
    // 未点亮的块也开面板：标题就是「省份 · 城市」，这就是点它要问的答案
    setPicked(ad && ad !== picked ? ad : '');
  }

  return (
    <div className="relative h-full">
      {geo && provinces ? (
        <JournalMap geo={geo} provinces={provinces} lit={litSet} onSelect={handleSelect} />
      ) : (
        <div className="flex h-full items-center justify-center">
          {geoFailed ? (
            <div className="kd-card w-[300px] p-6 text-center">
              <Icon name="alert" className="mx-auto h-8 w-8 text-warn" strokeWidth={1.4} />
              <p className="mt-3 text-[14px] font-semibold text-ink">地图数据没取到</p>
              <p className="mt-1.5 text-[12.5px] text-ink-3">边界文件有 1MB 多，网络断一次就会走到这里</p>
              <button onClick={retryGeo} className="kd-btn kd-btn-ghost mx-auto mt-4">
                重试
              </button>
            </div>
          ) : (
            <p className="text-[13px] text-ink-3">地图加载中…</p>
          )}
        </div>
      )}

      {/*
       * 战果卡：右下角一小块，只报数字与入口。图例那种教学性的东西不该占在
       * 一张要截图给人看的卡片上，而且亮没亮看一眼就懂，不需要图例。
       */}
      <div className="absolute bottom-4 right-4 z-[1000] w-[248px] max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface/95 shadow-float backdrop-blur-sm">
        <p className="px-3.5 pb-2.5 pt-3 text-[12.5px] leading-relaxed text-ink-2">
          {litSet.size === 0 ? (
            '还没有点亮的城市 —— 去地图给任意一条记录插面旗'
          ) : (
            <>
              你已经吃过了全国
              <br />
              <b className="text-[17px] font-semibold tabular-nums text-food">{litSet.size}</b>
              <span className="text-ink-3"> / {geo?.features.length ?? '—'} </span>个城市
              <span className="mx-1.5 text-line-2">·</span>
              <b className="text-[17px] font-semibold tabular-nums text-food">{litProvCount}</b>
              <span className="text-ink-3"> / {provinces?.features.length ?? '—'} </span>个省份
            </>
          )}
        </p>
        <div className="flex items-center gap-2 border-t border-line px-3.5 py-2">
          <Link to="/" className="kd-btn kd-btn-ghost px-2.5 py-1 text-[12px]">
            <Icon name="map" className="h-3.5 w-3.5" />
            去地图点亮
          </Link>
          <button
            onClick={() => void reload()}
            title="刷新"
            className="ml-auto rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2"
          >
            <Icon name="refresh" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {picked && (
        <aside className="kd-enter absolute right-4 top-4 z-[1000] flex max-h-[calc(100%-9rem)] w-[300px] max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-line bg-surface shadow-float">
          <header
            className={`flex shrink-0 items-center gap-2 px-3.5 py-2.5 ${
              detail.length || pickedRecords.length ? 'border-b border-line' : ''
            }`}
          >
            <Icon
              name="flag"
              className={`h-3.5 w-3.5 shrink-0 ${detail.length ? 'text-food' : 'text-ink-3'}`}
            />
            <h2 className="truncate text-[14px] font-semibold text-ink" title={pickedTitle}>
              {pickedTitle}
            </h2>
            <span className="ml-auto shrink-0 text-[11px] text-ink-3">
              {detail.length ? (
                <>
                  <span className="tabular-nums">{fmtDay(detail[0].visitedAt)}</span> 起 · {detail.length} 条
                </>
              ) : (
                '未点亮'
              )}
            </span>
            <button
              onClick={() => setPicked('')}
              aria-label="关闭"
              className="-mr-1 shrink-0 rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Icon name="close" className="h-3.5 w-3.5" />
            </button>
          </header>
          {detail.length === 0 ? (
            /* 有记录但没插旗：只压一条，说清「差一面旗」并给出去点亮。
             * 压根没记录的什么都不放 —— 标题 + 右上角「未点亮」已经答完问题了，
             * 面板里坐一大块导入引导比不说更烦。 */
            pickedRecords.length > 0 && (
              <div className="flex items-center gap-2 px-3.5 py-2.5">
                <Icon name="flag" className="h-3.5 w-3.5 shrink-0 text-ink-3" strokeWidth={1.6} />
                <p className="min-w-0 flex-1 text-[12px] leading-snug text-ink-3">
                  这块还没插旗 · 已导入{' '}
                  <b className="tabular-nums text-ink-2">{pickedRecords.length}</b> 条
                </p>
                <Link
                  to={jumpCity ? `/?city=${jumpCity}` : '/'}
                  className="kd-btn kd-btn-ghost shrink-0 px-2.5 py-1 text-[12px]"
                >
                  去点亮
                </Link>
              </div>
            )
          ) : (
            <>
              <ol className="min-h-0 flex-1 overflow-y-auto p-2.5">
                {detail.map((v) => (
                  <li key={v.id} className="mb-2 last:mb-0">
                    <div className="flex items-center gap-2 text-[11px] text-ink-3">
                      <i className={`kd-dot ${CAT_DOT[v.category]}`} />
                      <span className="font-medium text-travel">
                        {cityName.get(v.cityCode) ?? v.cityCode}
                      </span>
                      <span className="ml-auto tabular-nums">{fmtDay(v.visitedAt)}</span>
                    </div>
                    <a
                      href={v.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 flex items-start gap-1.5 text-[13px] text-ink transition-colors hover:text-food"
                    >
                      <span className="min-w-0 flex-1 break-words">{v.title || '(无标题)'}</span>
                      <Icon name="external" className="mt-0.5 h-3 w-3 shrink-0 text-ink-3" />
                    </a>
                  </li>
                ))}
              </ol>
              <footer className="shrink-0 border-t border-line px-3.5 py-1.5 text-[10.5px] text-ink-3">
                点亮日期取自你插旗那天，不是视频发布日期
              </footer>
            </>
          )}
        </aside>
      )}
    </div>
  );
}
