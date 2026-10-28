import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAllCities, seedCities } from '../db/schema';
import { getRanking } from '../db/videos';
import type { CityCount } from '../db/videos';
import type { CityRecord } from '../db/schema';
import { FOOD_WEIGHT, TRAVEL_WEIGHT } from '../db/videos';
import Icon from '../ui/Icon';

type RankedCity = CityCount & { score: number };

export default function RankingPage() {
  const [rows, setRows] = useState<RankedCity[] | null>(null);
  const [cities, setCities] = useState<CityRecord[]>([]);

  async function reload() {
    await seedCities().catch(() => {});
    setCities(await getAllCities());
    setRows(await getRanking());
  }
  useEffect(() => {
    void reload();
  }, []);

  const cityByCode = useMemo(() => new Map(cities.map((c) => [c.code, c])), [cities]);
  const maxScore = rows && rows.length ? rows[0].score : 0;

  return (
    <div className="mx-auto h-full w-full max-w-2xl overflow-y-auto px-6 py-7">
      <h1 className="text-[19px] font-semibold tracking-tight text-ink">城市推荐</h1>
      <p className="mt-1 text-[12.5px] text-ink-3">
        综合得分 = 吃 ×{FOOD_WEIGHT} + 玩 ×{TRAVEL_WEIGHT}，只统计已识别到城市的记录
      </p>

      {!rows && <p className="mt-8 text-center text-[13px] text-ink-3">加载中…</p>}
      {rows?.length === 0 && (
        <div className="kd-card mt-8 p-8 text-center">
          <Icon name="mountain" className="mx-auto h-9 w-9 text-ink-3" strokeWidth={1.4} />
          <p className="mt-3 text-[14px] font-semibold text-ink">暂无推荐数据</p>
          <p className="mt-1 text-[12.5px] text-ink-3">
            先在导入页添加链接，或在
            <Link to="/data" className="mx-0.5 text-food underline decoration-line-2 underline-offset-2">
              数据页
            </Link>
            载入示例
          </p>
        </div>
      )}

      {!!rows?.length && (
        <>
          {/* 表头式说明行：把「列」的含义讲清楚，比在每行里塞图标干净 */}
          <div className="kd-label mt-6 flex items-center gap-4 px-4 pb-2">
            <span className="w-5 text-right">#</span>
            <span>城市</span>
            <span className="ml-auto flex items-center gap-2">
              <span className="inline-flex items-center gap-1">
                <i className="kd-dot bg-food" />吃
              </span>
              <span className="inline-flex items-center gap-1">
                <i className="kd-dot bg-travel" />玩
              </span>
              <span className="w-9 text-right">得分</span>
            </span>
          </div>
          <ol className="flex flex-col gap-2">
            {rows.map((r, i) => {
              const city = cityByCode.get(r.cityCode);
              return (
                <li
                  key={r.cityCode}
                  className="kd-card kd-enter flex items-center gap-4 px-4 py-3"
                  style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}
                >
                  <span
                    className={`w-5 shrink-0 text-right text-[13px] font-semibold tabular-nums ${
                      i < 3 ? 'text-food' : 'text-ink-3'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[14px] font-semibold text-ink">
                        {city?.name ?? r.cityCode}
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-3">{city?.province}</span>
                    </div>
                    {/* 相对得分条：单色、3px，不做三段渐变 */}
                    <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-food/70"
                        style={{ width: maxScore ? `${Math.max(4, (r.score / maxScore) * 100)}%` : '0%' }}
                      />
                    </div>
                  </div>
                  <span className="flex shrink-0 items-center gap-3 text-[12px] tabular-nums text-ink-2">
                    <span className="inline-flex items-center gap-1.5">
                      <i className="kd-dot bg-food" />
                      {r.foodCount}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <i className="kd-dot bg-travel" />
                      {r.travelCount}
                    </span>
                    <span className="w-9 text-right text-[14px] font-semibold text-ink">{r.score}</span>
                  </span>
                  <Link
                    to={`/?city=${r.cityCode}`}
                    aria-label={`在地图上查看${city?.name ?? ''}`}
                    className="-mr-1 shrink-0 rounded-md p-1.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    <Icon name="chevronRight" className="h-4 w-4" />
                  </Link>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
