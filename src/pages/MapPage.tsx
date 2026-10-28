import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { countByCity } from '../db/videos';
import type { CityCount } from '../db/videos';
import { getAllCities, seedCities } from '../db/schema';
import type { Category, CityRecord } from '../db/schema';
import MapView from '../map/MapView';
import CityMarker from '../map/CityMarker';
import CityDrawer from '../map/CityDrawer';
import FlyController from '../map/FlyController';
import Icon from '../ui/Icon';

type Filter = Category | 'all';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'food', label: '吃' },
  { key: 'travel', label: '玩' },
];

export default function MapPage() {
  const [cities, setCities] = useState<CityRecord[]>([]);
  const [counts, setCounts] = useState<CityCount[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  // 榜单页 /?city=xx 跳转：命中则选中该城市并消耗掉 query
  useEffect(() => {
    const c = searchParams.get('city');
    if (c && cities.some((x) => x.code === c)) {
      setSelectedCode(c);
      searchParams.delete('city');
      setSearchParams(searchParams, { replace: true });
    }
  }, [cities, searchParams, setSearchParams]);

  const cityByCode = useMemo(() => new Map(cities.map((c) => [c.code, c])), [cities]);

  async function reload() {
    await seedCities().catch(() => {});
    const cs = await getAllCities();
    setCities(cs);
    setCounts(await countByCity(filter === 'all' ? undefined : filter));
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换筛选时重新拉聚合（城市库不必重取）
  useEffect(() => {
    void countByCity(filter === 'all' ? undefined : filter).then(setCounts);
  }, [filter]);

  // 只在地图上渲染有数据、且能定位到坐标的城市
  const markers = useMemo(
    () => counts.filter((c) => c.total > 0 && c.cityCode !== 'unknown' && cityByCode.has(c.cityCode)),
    [counts, cityByCode],
  );

  const totals = useMemo(
    () =>
      markers.reduce(
        (s, m) => ({ food: s.food + m.foodCount, travel: s.travel + m.travelCount }),
        { food: 0, travel: 0 },
      ),
    [markers],
  );

  const selectedCity = selectedCode ? cityByCode.get(selectedCode) ?? null : null;

  // 城市搜索候选（按名称/省前缀匹配）
  const searchResults = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return cities.filter((c) => c.name.includes(q) || c.province.includes(q)).slice(0, 8);
  }, [query, cities]);

  return (
    <div className="relative h-full">
      <MapView>
        <FlyController target={selectedCity} />
        {markers.map((c) => (
          <CityMarker key={c.cityCode} city={cityByCode.get(c.cityCode)!} count={c} onClick={setSelectedCode} />
        ))}
      </MapView>

      {/* 左上控制面板：筛选 / 搜索 / 图例合并成一块，内部用 1px 线分区，
          不再散成三个各自漂着的胶囊 */}
      <div className="absolute left-4 top-4 z-[1000] w-[268px] rounded-xl border border-line bg-surface shadow-float">
        <div className="rounded-t-xl p-1.5">
          <div className="kd-seg">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                data-active={filter === f.key}
                className="kd-seg-item"
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative border-t border-line p-1.5">
          <Icon
            name="search"
            className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索城市"
            className="w-full rounded-lg bg-surface-2/70 py-1.5 pl-7 pr-2 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:bg-surface focus:ring-2 focus:ring-food/15"
          />
          {searchResults.length > 0 && (
            <ul className="absolute inset-x-1.5 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-float">
              {searchResults.map((c) => (
                <li key={c.code}>
                  <button
                    onClick={() => {
                      setSelectedCode(c.code);
                      setQuery('');
                    }}
                    className="flex w-full items-baseline justify-between px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-surface-2"
                  >
                    <span>{c.name}</span>
                    <span className="text-[11px] text-ink-3">{c.province}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-2.5 whitespace-nowrap rounded-b-xl border-t border-line bg-canvas/70 px-3 py-2 text-[11px] text-ink-3">
          <span className="flex items-center gap-1.5">
            <i className="kd-dot bg-food" />吃 <b className="font-semibold tabular-nums text-ink-2">{totals.food}</b>
          </span>
          <span className="flex items-center gap-1.5">
            <i className="kd-dot bg-travel" />玩 <b className="font-semibold tabular-nums text-ink-2">{totals.travel}</b>
          </span>
          <span className="ml-auto">大小＝条数</span>
          <button
            onClick={() => void reload()}
            title="刷新"
            className="-mr-1 rounded-md p-1 transition-colors hover:bg-surface-2 hover:text-ink-2"
          >
            <Icon name="refresh" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {selectedCity && (
        <CityDrawer city={selectedCity} category={filter} onClose={() => setSelectedCode(null)} />
      )}

      {markers.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center">
          <div className="kd-enter pointer-events-auto w-[300px] rounded-xl border border-line bg-surface/95 p-6 text-center shadow-float backdrop-blur-sm">
            <Icon name="bowl" className="mx-auto h-9 w-9 text-ink-3" strokeWidth={1.4} />
            <p className="mt-3 text-[15px] font-semibold text-ink">地图上还没有气泡</p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">
              导入小红书 / 公众号视频链接，城市气泡会自动落在这里
            </p>
            <Link to="/import" className="kd-btn kd-btn-primary mx-auto mt-4">
              去导入
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
