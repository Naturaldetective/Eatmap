import { describe, expect, it } from 'vitest';
import { describeWeather, isHeavySnow } from './wmo';

describe('WMO 天气码映射（§6.5）', () => {
  it('常见码给得出中文说法与图标', () => {
    expect(describeWeather(0)).toEqual({ label: '晴', icon: 'sun' });
    expect(describeWeather(3).label).toBe('阴');
    expect(describeWeather(45).icon).toBe('fog');
    expect(describeWeather(61).icon).toBe('rain');
    expect(describeWeather(71).icon).toBe('snow');
    expect(describeWeather(95).icon).toBe('thunder');
  });

  it('强度只改文字不换图标：毛毛雨到暴雨都是同一个雨形', () => {
    for (const code of [51, 53, 55, 61, 63, 65, 80, 81, 82]) {
      expect(describeWeather(code).icon).toBe('rain');
    }
    // 但说法必须分得开，大雨和小雨在界面上要能读出差别
    expect(describeWeather(61).label).not.toBe(describeWeather(65).label);
    expect(describeWeather(82).label).toBe('暴雨');
  });

  it('冻雨归到雨、阵雪归到雪，不另开图标', () => {
    expect(describeWeather(66).icon).toBe('rain');
    expect(describeWeather(85).icon).toBe('snow');
    expect(describeWeather(86).icon).toBe('snow');
  });

  it('认不出的码退回中性云形，绝不抛错也不给空标签', () => {
    for (const code of [-1, 4, 100, 999, 50.5]) {
      const look = describeWeather(code);
      expect(look.icon).toBe('cloud');
      expect(look.label).toBeTruthy();
    }
  });

  it('只有大雪 / 强阵雪算暴雪，小雪中雪阵雪不算（§6.5 警示色口径）', () => {
    expect(isHeavySnow(75)).toBe(true);
    expect(isHeavySnow(86)).toBe(true);
    for (const code of [71, 73, 77, 85]) expect(isHeavySnow(code)).toBe(false);
    // 冻雨（66/67）归到雨形，目前也不给警示色 —— 要加得先定口径
    for (const code of [56, 61, 66, 80]) expect(isHeavySnow(code)).toBe(false);
  });

  it('每条说法都不带站点噪声（直接进 UI 文本）', () => {
    for (const code of [0, 1, 2, 3, 45, 48, 51, 56, 61, 66, 71, 77, 80, 95, 96, 99]) {
      const { label } = describeWeather(code);
      expect(label).not.toMatch(/\s|undefined|null/);
    }
  });
});
