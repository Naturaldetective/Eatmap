import { describe, expect, it } from 'vitest';
import { classify } from './classify';

describe('吃/玩分类打分器（§5.2）', () => {
  it('美食探店：强词密集 → food，高置信，命中词可解释', () => {
    const r = classify(
      '成都苍蝇馆子天花板！人均40吃到扶墙',
      '#成都美食 探店第38期，火锅串串香都在这家',
    );
    expect(r.category).toBe('food');
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
    expect(r.foodScore).toBeGreaterThan(r.travelScore);
    expect(r.hits.some((h) => ['探店', '火锅', '苍蝇馆子'].includes(h.word))).toBe(true);
  });

  it('游玩攻略：→ travel', () => {
    const r = classify('长沙周末citywalk全攻略', '景点门票、民宿、拍照出片圣地推荐，收藏这一篇就够了');
    expect(r.category).toBe('travel');
    expect(r.confidence).toBeGreaterThan(0.6);
    expect(r.travelScore).toBeGreaterThan(r.foodScore);
  });

  it('无词表命中 → unknown', () => {
    const r = classify('随手记录一下', '');
    expect(r.category).toBe('unknown');
    expect(r.confidence).toBe(0);
  });

  it('单个弱词：判吃但置信度不足（<0.6）触发人工复核，不冒充高可信', () => {
    const r = classify('今天吃点啥', '');
    expect(r.category).toBe('food');
    expect(r.foodScore).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThan(0.6);
  });

  it('吃玩同票：FOOD_FIRST 偏向吃（产品定位）', () => {
    const r = classify('美食攻略', '');
    expect(r.category).toBe('food');
  });

  it('标题命中权重高于正文（×2）：同一强词标题比正文更主导', () => {
    const inTitle = classify('火锅', '随便');
    const inDesc = classify('随便', '火锅');
    expect(inTitle.foodScore).toBeGreaterThan(inDesc.foodScore);
  });
});
