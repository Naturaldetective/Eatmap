import { describe, expect, it } from 'vitest';
import seed from '../data/cities.json';
import type { CityRecord } from '../db/schema';
import { buildDictionary, detectCity } from './geo';

/**
 * 针对**真实发布数据** src/data/cities.json 的回归测试。
 * geo.test.ts 用固定 fixture 测算法，这里测数据覆盖与词典完整性——
 * 算法正确但数据缺城，线上一样会认错（丹东被判成海口的真实事故）。
 */
const cities = seed as unknown as CityRecord[];
const dict = buildDictionary(cities);
const codeOf = (name: string) => cities.find((c) => c.name === name)?.code;

describe('城市库覆盖（743 条：全部地级市 + 县级市）', () => {
  it('规模达标且无脏数据', () => {
    expect(cities.length).toBeGreaterThan(700);
    expect(new Set(cities.map((c) => c.code)).size).toBe(cities.length);
    expect(cities.every((c) => c.lng > 73 && c.lng < 136 && c.lat > 3 && c.lat < 54)).toBe(true);
    expect(cities.every((c) => c.province)).toBe(true);
  });

  it('同一词条不得指向两个城市（否则识别必然随机错）', () => {
    const owner = new Map<string, string>();
    const dup: string[] = [];
    for (const t of dict) {
      const prev = owner.get(t.term);
      if (prev && prev !== t.code) dup.push(`${t.term}: ${prev} vs ${t.code}`);
      owner.set(t.term, t.code);
    }
    expect(dup).toEqual([]);
  });

  it('县级市可识别', () => {
    for (const [text, city] of [
      ['义乌国际商贸城一日逛吃', '义乌'],
      ['昆山奥灶面哪家正宗', '昆山'],
      ['武夷山熏鹅配米糕', '武夷山'],
      ['香格里拉的松茸季', '香格里拉'],
    ] as const) {
      expect(detectCity({ title: text }, dict).cityCode, text).toBe(codeOf(city));
    }
  });
});

describe('事故复现：丹东笔记曾被判成海口', () => {
  const TITLE = '丹东只有草莓？最值得吃的是大海鲜和小黄牛 - 小红书';

  it('标题里的城市必须赢过正文顺带提及的城市', () => {
    expect(detectCity({ title: TITLE }, dict).cityCode).toBe('210600');
    const r = detectCity({ title: TITLE, desc: '从海口飞过去，落地先整海鲜' }, dict);
    expect(r.cityCode).toBe('210600');
    // 标题与正文不是同级证据：正文里「从海口飞过去」只是行程顺带提及，
    // 不足以把标题级的丹东结论拖进标黄区（候选仍列出海口，人工复核时看得到）。
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
    expect(r.candidates.map((c) => c.code)).toContain('460100');
  });

  it('但同级（标题 vs 标题）真二义仍必须标黄', () => {
    const r = detectCity({ title: '海口丹东两头跑，哪家海鲜硬' }, dict);
    expect(r.cityCode).toBe('460100'); // 位置更靠前
    expect(r.confidence).toBeLessThan(0.6);
  });

  it('州与州府重名时，简称归县级市（大理→大理市，不是大理州）', () => {
    expect(detectCity({ title: '大理古城的菌子火锅' }, dict).cityCode).toBe(codeOf('大理'));
    expect(codeOf('大理')).toBe('532901');
    expect(codeOf('大理州')).toBe('532900');
    expect(detectCity({ title: '大理州政协附近小吃' }, dict).cityCode).toBe('532900');
  });

  it('城市名是常用词时不得误命中（吃/玩文案里高频出现）', () => {
    for (const text of [
      '感谢品牌合作', '各位同仁多指教', '龙井虾仁的做法', '乌苏啤酒配烧烤',
      '东方甄选的零食', '海南的椰子鸡',
    ]) {
      const r = detectCity({ title: text }, dict);
      expect(r.cityCode, text).toBe('unknown');
    }
  });

  it('同名小城归正确省份（凤城是辽宁县级市，不是清远的别名）', () => {
    expect(detectCity({ title: '凤城草莓采摘' }, dict).cityCode).toBe('210682');
  });
});
