import { useEffect, useMemo, useState } from 'react';
import { isVisited, listVideos, setVideoVisited, visitedCitiesOf } from '../db/videos';
import type { VideoRecord } from '../db/schema';
import type { CityRecord } from '../db/schema';
import type { Category } from '../db/schema';
import { scheduleSync } from '../sync/cloud';
import CityWeather from '../weather/CityWeather';
import Icon from '../ui/Icon';

interface Props {
  city: CityRecord;
  /** 当前地图筛选分类：抽屉列表与之保持一致 */
  category: Category | 'all';
  onClose: () => void;
}

const CAT_LABEL: Record<Category, string> = { food: '吃', travel: '玩', unknown: '待定' };
const CAT_DOT: Record<Category, string> = {
  food: 'bg-food',
  travel: 'bg-travel',
  unknown: 'bg-ink-3/40',
};

const fmtDay = (ts: number) => new Date(ts).toLocaleDateString('zh-CN');

export default function CityDrawer({ city, category, onClose }: Props) {
  /** 存的是该城全量记录：城市「去过」按所有记录派生，不能跟着筛选走 */
  const [all, setAll] = useState<VideoRecord[] | null>(null);
  /** 正在写库的那条 id：只禁用它自己的按钮，不让整列卡住 */
  const [pending, setPending] = useState('');

  useEffect(() => {
    setAll(null);
    listVideos({ cityCode: city.code }).then(setAll);
  }, [city.code]);

  const videos = all && category !== 'all' ? all.filter((r) => r.category === category) : all;

  async function toggle(v: VideoRecord) {
    if (pending) return;
    setPending(v.id);
    try {
      const next = await setVideoVisited(v.id, !v.visitedAt);
      // 就地改这一行，不重拉：重拉会把列表滚回顶部，点亮第三条就丢视位置
      setAll((rows) => (rows ? rows.map((r) => (r.id === v.id ? next : r)) : rows));
      scheduleSync();
    } finally {
      setPending('');
    }
  }

  /** 城市级「去过」由记录派生（§3.3）：抽屉里只有一个城，所以取唯一那一项 */
  const visited = useMemo(
    () => (all ? (visitedCitiesOf(all.filter(isVisited))[0] ?? null) : null),
    [all],
  );

  return (
    <aside className="absolute right-0 top-0 z-[1000] flex h-full w-[340px] max-w-[85vw] flex-col border-l border-line bg-canvas shadow-float">
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-4 py-3">
        <h2 className="text-[15px] font-semibold text-ink">{city.name}</h2>
        <span className="text-[11px] text-ink-3">{city.province}</span>
        <span className="kd-label ml-auto">
          {category === 'food' ? '只看吃' : category === 'travel' ? '只看玩' : '全部'}
        </span>
        <button
          onClick={onClose}
          aria-label="关闭"
          className="-mr-1 rounded-md p-1.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <Icon name="close" className="h-4 w-4" />
        </button>
      </header>

      {/* 城市级点亮提示：只要有一条记录亮着就在顶栏下挂一条，日期取最早那次 */}
      {visited && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-food/[0.06] px-4 py-1.5 text-[11px] text-food">
          <Icon name="flag" className="h-3 w-3" />
          <span>已点亮 · {fmtDay(visited.firstAt)} 起</span>
          <span className="ml-auto tabular-nums">{visited.count} 条</span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {/* 天气跟着列表一起滚：列表一长就不该让它常驻占掉一百像素 */}
        <CityWeather city={city} />
        {videos === null && <p className="p-6 text-center text-[13px] text-ink-3">加载中…</p>}
        {videos?.length === 0 && (
          <p className="p-6 text-center text-[13px] text-ink-3">该筛选下暂无视频</p>
        )}
        {videos?.map((v) => (
          /* 卡片整体是个 <a>，而按钮不能嵌在 <a> 里（交互元素嵌套不合法），
             * 所以外套一层 relative div，点亮按钮作为兄弟节点浮在右上角。 */
          <div key={v.id} className="relative mb-2 last:mb-0">
            <a
              href={v.url}
              target="_blank"
              rel="noreferrer"
              className={`flex gap-2.5 rounded-xl border p-2.5 transition-shadow hover:shadow-soft ${
                v.visitedAt ? 'border-food/35 bg-food/[0.04]' : 'border-line bg-surface'
              }`}
            >
              {v.cover ? (
                <img src={v.cover} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" loading="lazy" />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-3">
                  <Icon
                    name={v.category === 'travel' ? 'mountain' : 'bowl'}
                    className="h-5 w-5"
                    strokeWidth={1.5}
                  />
                </div>
              )}
              <div className="min-w-0 flex-1">
                {/* pr-16 是给右上角的旗帜按钮让位，不然长标题会钻到按钮底下 */}
                <p className="truncate pr-16 text-[13px] font-medium text-ink">
                  {v.title || '(无标题)'}
                </p>
                <div className="mt-1.5 flex items-center gap-2.5 text-[11px] text-ink-3">
                  <span className="inline-flex items-center gap-1">
                    <i className={`kd-dot ${CAT_DOT[v.category]}`} />
                    {CAT_LABEL[v.category]}
                  </span>
                  <span className="tabular-nums">{new Date(v.parsedAt).toLocaleDateString('zh-CN')}</span>
                  {v.visitedAt && (
                    <span className="ml-auto inline-flex items-center gap-1 text-food">
                      <Icon name="flag" className="h-3 w-3" />
                      <span className="tabular-nums">{fmtDay(v.visitedAt)}</span>
                    </span>
                  )}
                </div>
              </div>
            </a>
            <button
              onClick={() => void toggle(v)}
              disabled={pending === v.id}
              aria-pressed={!!v.visitedAt}
              aria-label={v.visitedAt ? '取消点亮' : '点亮「我去过这里」'}
              title={v.visitedAt ? `已点亮 · ${fmtDay(v.visitedAt)}（再点取消）` : '点亮「我去过这里」'}
              className={`absolute right-1.5 top-1.5 z-[1] rounded-md border p-1 transition-colors disabled:opacity-40 ${
                v.visitedAt
                  ? 'border-food/40 bg-food/10 text-food'
                  : 'border-line bg-surface text-ink-3 hover:border-food/40 hover:text-food'
              }`}
            >
              <Icon name="flag" className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <footer className="flex shrink-0 items-center justify-center gap-1 border-t border-line bg-surface px-4 py-2 text-[11px] text-ink-3">
        <Icon name="external" className="h-3 w-3" />
        点击卡片在新标签打开原视频 · 右上角旗帜标记「去过」
      </footer>
    </aside>
  );
}
