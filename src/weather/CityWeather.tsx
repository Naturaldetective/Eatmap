import { useEffect, useState } from 'react';
import type { CityRecord } from '../db/schema';
import Icon from '../ui/Icon';
import {
  PRECIP_SHOW_MIN,
  dayLabel,
  fmtTemp,
  isHarsh,
  loadForecast,
  reloadForecast,
  todayInShanghai,
  type ForecastBundle,
} from './forecast';
import { describeWeather } from './wmo';

interface Props {
  city: CityRecord;
}

/** 更新时刻：同一天只写时分，跨年才带日期，省字数的同时不歧义 */
function stampOf(at: number): string {
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return todayInShanghai(d) === todayInShanghai() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/**
 * 城市抽屉里的「未来一周天气」（§6.5）。
 * 刻意做成抽屉顶部一块安静的面板：中性纸墨 + 细线图标，
 * 只有雷暴 / 暴雪 / 高温 / 降水 ≥80% 才借一次 warn 色 —— 它是状态，不是装饰。
 * 拿不到数据就缩成一行提示，绝不占住视频列表的位置。
 */
export default function CityWeather({ city }: Props) {
  const [bundle, setBundle] = useState<ForecastBundle | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setBundle(null);
    setErr('');
    loadForecast(city)
      .then((b) => alive && setBundle(b))
      .catch((e: unknown) => {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
    // 依赖只写 city.code：同一城市的对象引用变化（上游重渲染）不该再打一次第三方接口
  }, [city.code]);

  async function retry() {
    setBusy(true);
    setErr('');
    try {
      setBundle(await reloadForecast(city));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const head = (
    <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
      <span className="kd-label">未来一周</span>
      {bundle && (
        <span className="text-[10px] text-ink-3 tabular-nums">
          {stampOf(bundle.fetchedAt)} 更新{bundle.stale ? ' · 刷新中' : ''}
        </span>
      )}
      <button
        onClick={retry}
        disabled={busy}
        aria-label="刷新天气"
        className="ml-auto rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
      >
        <Icon name="refresh" className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );

  if (err) {
    return (
      <div className="mb-2.5 rounded-xl border border-line bg-surface">
        {head}
        <p className="px-2.5 py-2 text-[11px] leading-relaxed text-ink-3">
          {err}。不影响看视频，
          <button onClick={retry} disabled={busy} className="text-ink underline decoration-line-2 underline-offset-2">
            再试一次
          </button>
        </p>
      </div>
    );
  }

  if (!bundle) {
    return (
      <div className="mb-2.5 rounded-xl border border-line bg-surface">
        {head}
        {/* 占位格的列宽要和真数据完全对齐（同样 px-1、不用 gap），否则加载完会跳一下 */}
        <div className="grid grid-cols-7 px-1 py-2.5">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="mx-0.5 h-[52px] rounded-md bg-surface-2" />
          ))}
        </div>
      </div>
    );
  }

  const today = todayInShanghai();

  return (
    <div className="mb-2.5 rounded-xl border border-line bg-surface">
      {head}
      {/* px-1 给左右两列一点余量：七列全出血时末列的降水百分比会贴到面板边框上 */}
      <div className="grid grid-cols-7 px-1">
        {bundle.days.map((d) => {
          const look = describeWeather(d.code);
          const harsh = isHarsh(d);
          const isToday = d.date === today;
          const showPrecip = d.precip !== null && d.precip >= PRECIP_SHOW_MIN;
          return (
            <div
              key={d.date}
              title={`${d.date.slice(5).replace('-', '/')} ${look.label} ${fmtTemp(d.maxC)}/${fmtTemp(d.minC)}${
                d.precip === null ? '' : ` 降水 ${d.precip}%`
              }`}
              className={`flex flex-col items-center gap-px py-1.5 ${isToday ? 'bg-surface-2' : ''}`}
            >
              <span className={`text-[10px] ${isToday ? 'font-semibold text-ink' : 'text-ink-3'}`}>
                {dayLabel(d.date, today)}
              </span>
              <Icon
                name={look.icon}
                className={`mt-0.5 h-[17px] w-[17px] ${harsh ? 'text-warn' : 'text-ink-2'}`}
                strokeWidth={1.5}
              />
              <span className="mt-0.5 text-[12px] font-semibold text-ink tabular-nums">{fmtTemp(d.maxC)}</span>
              <span className="text-[10px] text-ink-3 tabular-nums">{fmtTemp(d.minC)}</span>
              <span className={`h-[13px] text-[10px] tabular-nums ${harsh ? 'text-warn' : 'text-ink-3'}`}>
                {showPrecip ? `${d.precip}%` : ''}
              </span>
            </div>
          );
        })}
      </div>
      <p className="border-t border-line px-2.5 py-1 text-[10px] text-ink-3">
        预报为当日极值 · 天气数据来自 Open-Meteo
      </p>
    </div>
  );
}
