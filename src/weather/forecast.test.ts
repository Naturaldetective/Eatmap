import { describe, expect, it } from 'vitest';
import {
  buildForecastUrl,
  dayLabel,
  fmtTemp,
  isHarsh,
  parseForecast,
  todayInShanghai,
  type DayForecast,
} from './forecast';

/** 2026-10-28 实测抓回的长沙响应（原样，未加工） */
const CHANGSHA = {
  latitude: 28.224955,
  longitude: 112.93318,
  timezone: 'Asia/Shanghai',
  daily: {
    time: ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'],
    weather_code: [51, 1, 80, 81, 81, 81, 3],
    temperature_2m_max: [23.4, 28.6, 27.8, 17.6, 19.4, 16.6, 21.6],
    temperature_2m_min: [16.3, 18.1, 14.3, 13.0, 15.7, 14.0, 13.3],
    precipitation_probability_max: [49, 0, 90, 95, 65, 82, 65],
  },
};

const day = (over: Partial<DayForecast>): DayForecast => ({
  date: '2026-10-30',
  code: 0,
  maxC: 20,
  minC: 10,
  precip: null,
  ...over,
});

describe('请求地址（§6.5）', () => {
  it('经纬度用 lat/lng 顺序进参数，各列一次要全', () => {
    const url = new URL(buildForecastUrl({ lng: 112.939, lat: 28.228 }));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(url.searchParams.get('latitude')).toBe('28.2280');
    expect(url.searchParams.get('longitude')).toBe('112.9390');
    expect(url.searchParams.get('forecast_days')).toBe('7');
    expect(url.searchParams.get('daily')).toContain('precipitation_probability_max');
  });

  it('时区写死 Asia/Shanghai —— 否则境外浏览器上「今天」会错位一天', () => {
    expect(new URL(buildForecastUrl({ lng: 0, lat: 0 })).searchParams.get('timezone')).toBe('Asia/Shanghai');
  });
});

describe('响应解析', () => {
  it('真实响应的七列平行数组按日期对齐成 7 天', () => {
    const days = parseForecast(CHANGSHA);
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({
      date: '2026-10-30',
      code: 51,
      maxC: 23.4,
      minC: 16.3,
      precip: 49,
    });
    expect(days[6].date).toBe('2026-11-05');
  });

  it('降水列整个缺失时不报错，precip 记 null（UI 就不显示那一行）', () => {
    const noPrecip = { daily: { ...CHANGSHA.daily } };
    delete (noPrecip.daily as Record<string, unknown>).precipitation_probability_max;
    const days = parseForecast(noPrecip);
    expect(days).toHaveLength(7);
    expect(days[0].precip).toBeNull();
  });

  it('某一列长度不齐时按最短的截，不产出 undefined', () => {
    const short = { daily: { ...CHANGSHA.daily, temperature_2m_min: [16.3, 18.1] } };
    expect(parseForecast(short)).toHaveLength(2);
  });

  it('缺测的 null 温度：丢掉那一天，而不是渲染出 NaN°', () => {
    const withNull = {
      daily: {
        time: ['2026-10-30', '2026-10-31'],
        weather_code: [0, 0],
        temperature_2m_max: [23.4, null],
        temperature_2m_min: [16.3, 18.1],
        precipitation_probability_max: [49, 0],
      },
    };
    const days = parseForecast(withNull);
    expect(days).toHaveLength(1);
    expect(days[0].date).toBe('2026-10-30');
  });

  it('垃圾响应一律回空数组，不抛（调用方据此降级成一行提示）', () => {
    expect(parseForecast(null)).toEqual([]);
    expect(parseForecast('nope')).toEqual([]);
    expect(parseForecast({})).toEqual([]);
    expect(parseForecast({ daily: { time: 'not-array' } })).toEqual([]);
    expect(parseForecast({ daily: { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [] } })).toEqual([]);
  });

  it('日期带时间后缀也只取前 10 位（上游格式变体不至于把整天丢掉）', () => {
    const withTime = {
      daily: {
        time: ['2026-10-30T00:00'],
        weather_code: [3],
        temperature_2m_max: [20],
        temperature_2m_min: [12],
      },
    };
    expect(parseForecast(withTime)[0].date).toBe('2026-10-30');
  });
});

describe('表头文案', () => {
  it('今天 / 明天 / 周几（2026-10-30 是周五）', () => {
    expect(dayLabel('2026-10-30', '2026-10-30')).toBe('今天');
    expect(dayLabel('2026-10-31', '2026-10-30')).toBe('明天');
    expect(dayLabel('2026-11-01', '2026-10-30')).toBe('周日');
    expect(dayLabel('2026-11-05', '2026-10-30')).toBe('周四');
  });

  it('跨年也算得出明天，不靠字符串拼接', () => {
    expect(dayLabel('2027-01-01', '2026-12-31')).toBe('明天');
    expect(dayLabel('2027-01-01', '2026-12-30')).toBe('周五');
  });

  it('today 非法时退回周几，不显示 NaN', () => {
    expect(dayLabel('2026-11-01', 'garbage')).toBe('周日');
  });
});

describe('上海日界', () => {
  it('UTC 16:30 已是上海次日凌晨：日期必须按上海切，不看浏览器时区', () => {
    expect(todayInShanghai(new Date('2026-10-30T16:30:00Z'))).toBe('2026-10-31');
    expect(todayInShanghai(new Date('2026-10-30T15:30:00Z'))).toBe('2026-10-30');
  });
});

describe('显示规则', () => {
  it('温度取整', () => {
    expect(fmtTemp(23.4)).toBe('23°');
    expect(fmtTemp(23.6)).toBe('24°');
    expect(fmtTemp(-4.2)).toBe('-4°');
  });

  it('雷暴、暴雪、≥35° 高温、≥80% 降水才值得给一次警示色', () => {
    expect(isHarsh(day({ code: 95 }))).toBe(true);
    expect(isHarsh(day({ code: 75 }))).toBe(true); // 大雪
    expect(isHarsh(day({ code: 86 }))).toBe(true); // 强阵雪
    expect(isHarsh(day({ maxC: 35.2 }))).toBe(true);
    expect(isHarsh(day({ precip: 80 }))).toBe(true);
    expect(isHarsh(day({ code: 1, maxC: 28, precip: 49 }))).toBe(false);
  });

  it('小雪 / 中雪 / 阵雪不染金：北方冬季一行里全是金色就读不出重点了', () => {
    for (const code of [71, 73, 77, 85]) {
      expect(isHarsh(day({ code, maxC: 2, precip: 40 }))).toBe(false);
    }
  });
});
