import type { CityRecord } from '../db/schema';
import { describeWeather, isHeavySnow } from './wmo';

/**
 * 城市未来一周天气（§6.5）。
 * 数据源 Open-Meteo：免 key、CORS 全开（实测响应与预检都回 `access-control-allow-origin: *`），
 * 所以浏览器直连即可，**不需要**走我们那个为小红书准备的 /api/fetch 中转 ——
 * 它的域名白名单是刻意收窄到三个域的，为一个公开天气接口放宽它不划算。
 */

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const FORECAST_DAYS = 7;
const TIMEOUT_MS = 8000;
/** 预报本身一小时才更新一轮，缓存 60 分钟够新，又能把第三方请求量压到最低 */
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_PREFIX = 'eatmap.weather.';

export interface DayForecast {
  /** 'YYYY-MM-DD'，已是 Asia/Shanghai 的当地日期 */
  date: string;
  /** WMO 天气码 */
  code: number;
  maxC: number;
  minC: number;
  /** 降水概率 0~100；null = 上游没给这一列 */
  precip: number | null;
}

export interface ForecastBundle {
  days: DayForecast[];
  /** 这份数据是什么时候拿到的（用于「x 小时前更新」与过期判断） */
  fetchedAt: number;
  /** true = 先渲染了过期缓存，后台正在刷新 */
  stale: boolean;
}

export function buildForecastUrl(city: Pick<CityRecord, 'lng' | 'lat'>): string {
  const q = new URLSearchParams({
    latitude: city.lat.toFixed(4),
    longitude: city.lng.toFixed(4),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    forecast_days: String(FORECAST_DAYS),
    // 写死上海时区：这张图只覆盖中国城市，日期必须按当地日切，
    // 否则境外浏览器上「今天」会整体错位一天
    timezone: 'Asia/Shanghai',
  });
  return `${ENDPOINT}?${q.toString()}`;
}

/** 数字容错：Open-Meteo 偶尔回 null（缺测）或字符串，一律不认非有限数 */
function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * 解析响应。daily 的五列是平行数组，长度不齐时按最短的截，
 * 任何一列缺位就丢掉那一天 —— 宁可少显示两天，也不要渲染出 NaN°。
 */
export function parseForecast(payload: unknown): DayForecast[] {
  if (!payload || typeof payload !== 'object') return [];
  const daily = (payload as { daily?: Record<string, unknown> }).daily;
  if (!daily) return [];
  const dates = daily.time;
  const codes = daily.weather_code;
  const maxs = daily.temperature_2m_max;
  const mins = daily.temperature_2m_min;
  if (!Array.isArray(dates) || !Array.isArray(codes) || !Array.isArray(maxs) || !Array.isArray(mins)) return [];
  const probs = Array.isArray(daily.precipitation_probability_max) ? daily.precipitation_probability_max : null;
  const span = Math.min(dates.length, codes.length, maxs.length, mins.length);
  const out: DayForecast[] = [];
  for (let i = 0; i < span; i += 1) {
    const date = typeof dates[i] === 'string' ? (dates[i] as string).slice(0, 10) : '';
    const code = num(codes[i]);
    const maxC = num(maxs[i]);
    const minC = num(mins[i]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || code === null || maxC === null || minC === null) continue;
    out.push({ date, code, maxC, minC, precip: probs ? num(probs[i]) : null });
  }
  return out;
}

/** 'YYYY-MM-DD' → 本地时区的 Date（正午，避开夏令时/冬令时的日界抖动） */
function parseDate(local: string): Date {
  const [y, m, d] = local.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12);
}

/** 上海今天的日期。en-CA 的格式化结果恰好就是 ISO 的 YYYY-MM-DD */
export function todayInShanghai(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * 日期 → 表头文案：今天 / 明天 / 周几。
 * 「明天」靠日期字符串比较（按 UTC 日 +1 天），不依赖任何本地时区。
 */
export function dayLabel(date: string, today: string): string {
  if (date === today) return '今天';
  const t = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(t)) return weekdayOf(date);
  if (Date.parse(`${date}T00:00:00Z`) - t === 86_400_000) return '明天';
  return weekdayOf(date);
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function weekdayOf(date: string): string {
  return WEEKDAYS[parseDate(date).getDay()] ?? date.slice(5);
}

interface CacheEntry {
  at: number;
  days: DayForecast[];
}

function readCache(code: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + code);
    if (!raw) return null;
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== 'object') return null;
    const e = o as Partial<CacheEntry>;
    if (typeof e.at !== 'number' || !Array.isArray(e.days) || e.days.length === 0) return null;
    return { at: e.at, days: e.days };
  } catch {
    return null; // 隐私模式 / 配额满：缓存可有可无，不影响功能
  }
}

function writeCache(code: string, entry: CacheEntry): void {
  try {
    localStorage.setItem(CACHE_PREFIX + code, JSON.stringify(entry));
  } catch {
    /* 存不下就算了 */
  }
}

function dropCache(code: string): void {
  try {
    localStorage.removeItem(CACHE_PREFIX + code);
  } catch {
    /* 同上 */
  }
}

/**
 * 取某城市未来一周天气。策略是 stale-while-revalidate：
 * 有旧数据就先回旧的（标 stale）并在后台刷新，没有才等网络。
 * 任何失败都抛错给调用方，由 UI 降级成一行提示 —— 天气失败不该拖垮视频列表。
 */
export async function loadForecast(city: CityRecord, now: number = Date.now()): Promise<ForecastBundle> {
  const cached = readCache(city.code);
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return { days: cached.days, fetchedAt: cached.at, stale: false };
  }
  if (cached) {
    // 先让界面有东西，刷新失败也不打扰用户
    void refresh(city, cached.days, now).catch(() => undefined);
    return { days: cached.days, fetchedAt: cached.at, stale: true };
  }
  return refresh(city, null, now);
}

async function refresh(city: CityRecord, fallback: DayForecast[] | null, now: number): Promise<ForecastBundle> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(buildForecastUrl(city), { signal: ctrl.signal });
    if (!res.ok) throw new Error(`天气接口回 ${res.status}`);
    const days = parseForecast(await res.json().catch(() => null));
    if (days.length === 0) throw new Error('天气数据为空');
    writeCache(city.code, { at: now, days });
    return { days, fetchedAt: now, stale: false };
  } catch (e) {
    if (fallback) return { days: fallback, fetchedAt: now - CACHE_TTL_MS, stale: true };
    throw e instanceof Error && e.name === 'AbortError' ? new Error('天气请求超时') : e;
  } finally {
    clearTimeout(timer);
  }
}

/** 手动刷新（重试按钮走这条，绕开缓存） */
export async function reloadForecast(city: CityRecord): Promise<ForecastBundle> {
  dropCache(city.code);
  return refresh(city, null, Date.now());
}

/** 温度取整显示（预报给的是 23.4 这种一位小数，列表里没必要） */
export function fmtTemp(c: number): string {
  return `${Math.round(c)}°`;
}

/** 降水概率低于这个值不值得占一格（天天挂 10% 是噪声） */
export const PRECIP_SHOW_MIN = 30;

/** 该不该给这一天一点警示色：雷暴、暴雪、或高温 35° 以上、或降水 ≥80% */
export function isHarsh(day: DayForecast): boolean {
  return (
    describeWeather(day.code).icon === 'thunder' ||
    isHeavySnow(day.code) ||
    day.maxC >= 35 ||
    (day.precip ?? 0) >= 80
  );
}
