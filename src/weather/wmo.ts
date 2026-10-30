import type { IconName } from '../ui/Icon';

/**
 * WMO 天气码 → 中文说法 + 细线图标（Open-Meteo 的 weather_code 用的就是这套码）。
 * 图标只画 7 个形：晴 / 晴间多云 / 阴 / 雾 / 雨 / 雪 / 雷暴，
 * 强度差异（毛毛雨 vs 大雨）交给文字标签承担，不靠图标堆细节。
 */
export interface WeatherLook {
  label: string;
  icon: IconName;
}

const WMO: Record<number, WeatherLook> = {
  0: { label: '晴', icon: 'sun' },
  1: { label: '晴间多云', icon: 'cloudSun' },
  2: { label: '多云', icon: 'cloudSun' },
  3: { label: '阴', icon: 'cloud' },
  45: { label: '雾', icon: 'fog' },
  48: { label: '冻雾', icon: 'fog' },
  51: { label: '毛毛雨', icon: 'rain' },
  53: { label: '毛毛雨', icon: 'rain' },
  55: { label: '浓毛毛雨', icon: 'rain' },
  56: { label: '冻毛毛雨', icon: 'rain' },
  57: { label: '冻毛毛雨', icon: 'rain' },
  61: { label: '小雨', icon: 'rain' },
  63: { label: '中雨', icon: 'rain' },
  65: { label: '大雨', icon: 'rain' },
  66: { label: '冻雨', icon: 'rain' },
  67: { label: '冻雨', icon: 'rain' },
  71: { label: '小雪', icon: 'snow' },
  73: { label: '中雪', icon: 'snow' },
  75: { label: '大雪', icon: 'snow' },
  77: { label: '雪粒', icon: 'snow' },
  80: { label: '阵雨', icon: 'rain' },
  81: { label: '强阵雨', icon: 'rain' },
  82: { label: '暴雨', icon: 'rain' },
  85: { label: '阵雪', icon: 'snow' },
  86: { label: '强阵雪', icon: 'snow' },
  95: { label: '雷阵雨', icon: 'thunder' },
  96: { label: '雷暴伴冰雹', icon: 'thunder' },
  99: { label: '强雷暴伴冰雹', icon: 'thunder' },
};

/** 认不出的码一律退回「云」形 + 中性说法，绝不抛错（天气拿不到不该影响看视频） */
export function describeWeather(code: number): WeatherLook {
  return WMO[code] ?? { label: '云', icon: 'cloud' };
}

/**
 * 算「暴雪」的码：大雪 / 强阵雪。小雪、中雪、阵雪不算 ——
 * 北方冬季一周里天天有雪是常态，全染警示色就等于没有重点（§6.5）。
 */
const HEAVY_SNOW = new Set([75, 86]);

export function isHeavySnow(code: number): boolean {
  return HEAVY_SNOW.has(code);
}
