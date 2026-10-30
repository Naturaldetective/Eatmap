import { useEffect, useState } from 'react';
import { listVideos } from '../db/videos';
import type { VideoRecord } from '../db/schema';
import type { CityRecord } from '../db/schema';
import type { Category } from '../db/schema';
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

export default function CityDrawer({ city, category, onClose }: Props) {
  const [videos, setVideos] = useState<VideoRecord[] | null>(null);

  useEffect(() => {
    setVideos(null);
    listVideos({ cityCode: city.code }).then((rows) => {
      setVideos(category === 'all' ? rows : rows.filter((r) => r.category === category));
    });
  }, [city.code, category]);

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

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {/* 天气跟着列表一起滚：列表一长就不该让它常驻占掉一百像素 */}
        <CityWeather city={city} />
        {videos === null && <p className="p-6 text-center text-[13px] text-ink-3">加载中…</p>}
        {videos?.length === 0 && (
          <p className="p-6 text-center text-[13px] text-ink-3">该筛选下暂无视频</p>
        )}
        {videos?.map((v) => (
          <a
            key={v.id}
            href={v.url}
            target="_blank"
            rel="noreferrer"
            className="mb-2 flex gap-2.5 rounded-xl border border-line bg-surface p-2.5 transition-shadow last:mb-0 hover:shadow-soft"
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
              <p className="truncate text-[13px] font-medium text-ink">{v.title || '(无标题)'}</p>
              <div className="mt-1.5 flex items-center gap-2.5 text-[11px] text-ink-3">
                <span className="inline-flex items-center gap-1">
                  <i className={`kd-dot ${CAT_DOT[v.category]}`} />
                  {CAT_LABEL[v.category]}
                </span>
                <span className="tabular-nums">{new Date(v.parsedAt).toLocaleDateString('zh-CN')}</span>
              </div>
            </div>
          </a>
        ))}
      </div>

      <footer className="flex shrink-0 items-center justify-center gap-1 border-t border-line bg-surface px-4 py-2 text-[11px] text-ink-3">
        <Icon name="external" className="h-3 w-3" />
        点击卡片在新标签打开原视频
      </footer>
    </aside>
  );
}
