import { describe, expect, it } from 'vitest';
import type { CityRecord } from '../db/schema';
import { buildDictionary, detectCity } from './geo';

const FIXTURE: CityRecord[] = [
  { code: '510100', name: '成都', province: '四川省', lng: 104, lat: 30, aliases: ['蓉城', '天府'] },
  { code: '500000', name: '重庆', province: '重庆市', lng: 106, lat: 29, aliases: ['山城', '雾都', '渝'] },
  { code: '310000', name: '上海', province: '上海市', lng: 121, lat: 31, aliases: ['魔都', '申城'] },
  { code: '460100', name: '海口', province: '海南省', lng: 110, lat: 20, aliases: ['椰城'] },
  { code: '210600', name: '丹东', province: '辽宁省', lng: 124, lat: 40, aliases: [] },
  { code: '420100', name: '武汉', province: '湖北省', lng: 114, lat: 30, aliases: ['江城', '汉'] },
];

describe('buildDictionary', () => {
  it('过滤单字别名（渝/汉 会误命中大量文本，§5.1 防误匹配）', () => {
    const dict = buildDictionary(FIXTURE);
    expect(dict.every((d) => d.term.length >= 2)).toBe(true);
    expect(dict.some((d) => d.term === '渝')).toBe(false);
    expect(dict.some((d) => d.term === '汉')).toBe(false);
  });

  it('按词长降序，最长优先', () => {
    const dict = buildDictionary(FIXTURE);
    for (let i = 1; i < dict.length; i++) {
      expect(dict[i - 1].term.length).toBeGreaterThanOrEqual(dict[i].term.length);
    }
  });
});

describe('detectCity（§5.1）', () => {
  const dict = buildDictionary(FIXTURE);

  it('标题标准名命中 → 高置信', () => {
    const r = detectCity({ title: '成都好吃的太多了' }, dict);
    expect(r.cityCode).toBe('510100');
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('别名命中 → 置信度略低于标准名', () => {
    const r = detectCity({ title: '魔都探店记' }, dict);
    expect(r.cityCode).toBe('310000');
    expect(r.matchedTerm).toBe('魔都');
    expect(r.confidence).toBeLessThan(0.85);
  });

  it('#话题# 里的城市优先于正文", ', () => {
    const r = detectCity({ title: '这家店绝了', desc: '#重庆火锅# 市区推荐' }, dict);
    expect(r.cityCode).toBe('500000');
    expect(r.candidates[0].source).toBe('tag');
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('正文唯一命中标准名 → 仍 <0.6 强制复核（顺带提及不冒充归属）', () => {
    const r = detectCity({ title: '这家苍蝇馆子绝了', desc: '成都本地人常去' }, dict);
    expect(r.cityCode).toBe('510100');
    expect(r.candidates[0].source).toBe('desc');
    expect(r.confidence).toBeLessThan(0.6);
  });

  it('多城歧义 → 取标题最靠前，置信度降到 <0.6 触发复核', () => {
    const r = detectCity({ title: '上海 ports 海口转机一日游' }, dict);
    expect(r.cityCode).toBe('310000'); // 上海位置更靠前
    expect(r.confidence).toBeLessThan(0.6);
    expect(r.candidates.length).toBeGreaterThan(1);
  });

  it('别名与标准名同指一城，不虚增为多城歧义', () => {
    const r = detectCity({ title: '上海｜魔都的早晨' }, dict);
    expect(r.cityCode).toBe('310000');
    expect(r.candidates.length).toBe(1);
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('识别不到 → unknown', () => {
    const r = detectCity({ title: '随便逛逛' }, dict);
    expect(r.cityCode).toBe('unknown');
    expect(r.confidence).toBe(0);
  });

  it('通名上下文不算地名（「入海口」≠ 海南海口，§5.1）', () => {
    const r = detectCity({ title: '这家馆子绝了', desc: '这里是鸭绿江的入海口，海鲜又大又肥' }, dict);
    expect(r.candidates.filter((c) => c.code === '460100')).toHaveLength(0);
    expect(r.cityCode).toBe('unknown');
  });

  it('黑名单只管前缀那一个字，其他语境下的海口照旧命中', () => {
    const r = detectCity({ title: '骑楼下的一天', desc: '海口老街的早茶' }, dict);
    expect(r.cityCode).toBe('460100');
    expect(r.candidates[0].source).toBe('desc');
  });

  it('话题结论不被正文里顺带提到的城市拖黄（同级才算歧义）', () => {
    const r = detectCity({ title: '本地人常去', desc: '#重庆火锅# 市区推荐，下次去成都再写一期' }, dict);
    expect(r.cityCode).toBe('500000');
    expect(r.candidates.some((c) => c.code === '510100')).toBe(true); // 候选仍列出，供人工参考
    expect(r.confidence).toBe(0.9);
  });

  it('结论来自正文时，同级多城依旧降到 0.45', () => {
    const r = detectCity({ title: '随便吃吃', desc: '成都和海口都去了几家店' }, dict);
    expect(r.candidates[0].source).toBe('desc');
    expect(r.confidence).toBe(0.45);
  });

  it('丹东事故原样本：话题命中给 0.9，不标黄', () => {
    const r = detectCity({
      title: '丹东只有草莓？最值得吃的是大海鲜和小黄牛',
      desc: '这里是鸭绿江的入海口\n#丹东美食# #开海季# #海鲜#',
    }, dict);
    expect(r.cityCode).toBe('210600');
    expect(r.candidates).toHaveLength(1);
    expect(r.confidence).toBe(0.9);
  });
});
