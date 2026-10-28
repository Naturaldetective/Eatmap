import { useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteVideo,
  exportVideos,
  getAllCities,
  importVideos,
  listVideos,
  seedCities,
  updateVideo,
} from '../db/videos';
import type { BackupFile, MergeStrategy } from '../db/videos';
import type { Category, CityRecord, VideoRecord } from '../db/schema';
import { clearDemoData, loadDemoData } from '../db/demo';
import { scheduleSync } from '../sync/cloud';
import SyncCard from '../sync/SyncCard';
import Icon from '../ui/Icon';

const CAT_DOT: Record<Category, string> = {
  food: 'bg-food',
  travel: 'bg-travel',
  unknown: 'bg-ink-3/40',
};

export default function DataPage() {
  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [cities, setCities] = useState<CityRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [strategy, setStrategy] = useState<MergeStrategy>('skip');

  const cityByCode = useMemo(() => new Map(cities.map((c) => [c.code, c])), [cities]);

  async function reload() {
    await seedCities().catch(() => {});
    setCities(await getAllCities());
    setVideos(await listVideos());
  }
  useEffect(() => {
    void reload();
  }, []);

  async function guard(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      // 仅当 ok 非空才覆盖；否则保留 fn 内部自己 setMsg 的提示（如「载入示例 N 条」）
      if (ok) setMsg(ok);
    } catch (e) {
      setMsg('操作失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
      await reload();
      // 改完数据防抖推一次（未设口令时 scheduleSync 自己会直接返回）
      scheduleSync();
    }
  }

  async function onExport() {
    const file = await exportVideos();
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `eatmap-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg(`已导出 ${file.videos.length} 条`);
  }

  async function onImportFile(f: File) {
    await guard(async () => {
      const text = await f.text();
      const parsed = JSON.parse(text) as BackupFile;
      if (parsed.app !== 'eatmap' || !Array.isArray(parsed.videos)) throw new Error('不是有效的 EatMap 备份文件');
      const r = await importVideos(parsed, strategy);
      setMsg(`导入完成：新增 ${r.added}，${strategy === 'skip' ? '跳过' : '覆盖'} ${r.merged}`);
    }, '导入完成');
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 overflow-y-auto px-6 py-7">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-ink">数据管理</h1>
          <p className="mt-1 text-[12.5px] text-ink-3">
            主存储一直在本浏览器（IndexedDB）；设了空间口令就自动上云，换设备填同一口令即可。
          </p>
        </div>
        <span className="kd-label shrink-0 tabular-nums">{videos.length} 条</span>
      </div>

      {/* 工具条 */}
      <div className="kd-card flex flex-wrap items-center gap-2 px-3 py-2.5">
        <button
          disabled={busy}
          onClick={() => guard(async () => { const n = await loadDemoData(); setMsg(`已载入示例 ${n} 条`); }, '')}
          className="kd-btn kd-btn-primary"
        >
          <Icon name="plus" className="h-3.5 w-3.5" />
          载入示例数据
        </button>
        <button
          disabled={busy}
          onClick={() => guard(async () => { const n = await clearDemoData(); setMsg(`已清空示例 ${n} 条`); }, '')}
          className="kd-btn kd-btn-ghost kd-btn-danger"
        >
          <Icon name="trash" className="h-3.5 w-3.5" />
          清空示例数据
        </button>
        <span className="mx-1.5 h-5 w-px bg-line" />
        <button disabled={busy || videos.length === 0} onClick={onExport} className="kd-btn kd-btn-ghost">
          <Icon name="upload" className="h-3.5 w-3.5" />
          导出 JSON
        </button>
        <label className="flex items-center gap-1.5 text-[12px] text-ink-3">
          重复时
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as MergeStrategy)}
            className="kd-input !px-2 !py-1 text-[12px]"
          >
            <option value="skip">跳过</option>
            <option value="overwrite">覆盖</option>
          </select>
        </label>
        <button disabled={busy} onClick={() => fileRef.current?.click()} className="kd-btn kd-btn-ghost">
          <Icon name="download" className="h-3.5 w-3.5" />
          导入 JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImportFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {msg && (
        <p className="flex items-center gap-1.5 text-[12.5px] text-travel">
          <Icon name="check" className="h-3.5 w-3.5" />
          {msg}
        </p>
      )}

      <SyncCard />

      {/* 列表：标题做成 Notion 式无框行内编辑，不再给每个输入框加一层盒子 */}
      <ul className="flex flex-col gap-2">
        {videos.length === 0 && (
          <li className="kd-card border-dashed px-6 py-10 text-center">
            <Icon name="inbox" className="mx-auto h-8 w-8 text-ink-3" strokeWidth={1.4} />
            <p className="mt-2.5 text-[13.5px] font-medium text-ink">还没有数据</p>
            <p className="mt-1 text-[12px] text-ink-3">可在导入页添加链接，或用上方的「载入示例数据」先看效果</p>
          </li>
        )}
        {videos.map((v) => (
          <li key={v.id} className="kd-card flex flex-wrap items-center gap-2.5 px-3.5 py-2.5 text-[13px]">
            <input
              className="min-w-0 flex-1 border-b border-transparent bg-transparent py-0.5 text-ink outline-none transition-colors hover:border-line focus:border-food"
              defaultValue={v.title}
              title={v.title}
              onBlur={(e) => {
                if (e.target.value !== v.title) void guard(() => updateVideo({ id: v.id, title: e.target.value }), '已保存标题');
              }}
            />
            <select
              className={`kd-input !px-2 !py-1 text-[12px] ${(v.geoConfidence ?? 0) < 0.6 && v.cityCode !== 'unknown' ? 'kd-low' : ''}`}
              value={v.cityCode}
              onChange={(e) => void guard(() => updateVideo({ id: v.id, cityCode: e.target.value, geoConfidence: 1 }), '')}
            >
              <option value="unknown">未识别</option>
              {cities.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
            <select
              className="kd-input !px-2 !py-1 text-[12px]"
              value={v.category}
              onChange={(e) => void guard(() => updateVideo({ id: v.id, category: e.target.value as Category, categorySource: 'manual' }), '')}
            >
              <option value="unknown">待定</option>
              <option value="food">吃</option>
              <option value="travel">玩</option>
            </select>
            <a
              href={v.url}
              target="_blank"
              rel="noreferrer"
              title="打开原视频"
              className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <Icon name="external" className="h-4 w-4" />
            </a>
            <button
              onClick={() => { if (confirm(`删除「${v.title}」？`)) void guard(() => deleteVideo(v.id), '已删除'); }}
              title="删除"
              className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger"
            >
              <Icon name="trash" className="h-4 w-4" />
            </button>
            <span className="flex w-full items-center gap-1.5 text-[11px] text-ink-3">
              <i className={`kd-dot ${CAT_DOT[v.category]}`} />
              {cityByCode.get(v.cityCode)?.name ?? '未识别'} · {v.platform} ·{' '}
              {v.categorySource === 'manual' ? '人工' : '自动'} ·{' '}
              <span className="tabular-nums">{new Date(v.parsedAt).toLocaleDateString('zh-CN')}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
