import { describe, expect, it } from 'vitest';
import { bubbleSize, bubbleKind } from './mapConfig';

describe('气泡尺寸（§6.1 size=24+log2(total)*8，上限64）', () => {
  it('total<=0 不占尺寸', () => {
    expect(bubbleSize(0)).toBe(0);
  });
  it('单调递增', () => {
    expect(bubbleSize(1)).toBeLessThan(bubbleSize(10));
    expect(bubbleSize(10)).toBeLessThan(bubbleSize(50));
  });
  it('上限封顶 64', () => {
    expect(bubbleSize(100000)).toBe(64);
  });
});

describe('气泡主色（吃多焦糖 / 玩多松绿 / 均衡对角分色）', () => {
  it('吃多 → food', () => {
    expect(bubbleKind(5, 1)).toBe('food');
  });
  it('玩多 → travel', () => {
    expect(bubbleKind(1, 5)).toBe('travel');
  });
  it('吃玩相等 → mixed（CSS 里画成对角硬分界）', () => {
    expect(bubbleKind(3, 3)).toBe('mixed');
  });
});
