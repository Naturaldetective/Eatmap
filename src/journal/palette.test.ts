import { describe, expect, it } from 'vitest';
import { blockStyle, PROVINCE_BORDER } from './palette';

describe('旅记页着色口径（§6.6：整页只两种砖粉，未点亮不许比纸亮）', () => {
  it('点亮块走「吃」那支焦糖的浅底，不引入第三种语义色', () => {
    // 点亮 = 去过，吃和玩都算，所以不能借用「玩」（travel）的绿；
    // 描边就是 --color-food (#d9480f) 的半透版
    expect(blockStyle(true).fillColor).toBe('#f7ded0');
    expect(blockStyle(true).color).toContain('217, 72, 15');
  });

  it('未点亮块填充比 canvas 底色深一档：反过来大陆会变成一块白斑', () => {
    // 两个都是接近白的浅灰，直接比十六进制整数就等于比谁更深
    const tone = (hex?: string) => parseInt(hex!.slice(1), 16);
    expect(tone(blockStyle(false).fillColor)).toBeLessThan(tone('#faf8f5'));
    expect(blockStyle(true).fillColor).not.toBe(blockStyle(false).fillColor);
  });

  it('「突出」靠描边加粗而不是靠饱和度', () => {
    expect(blockStyle(true).weight ?? 0).toBeGreaterThan(blockStyle(false).weight ?? 0);
  });

  it('hover 只压深填充一档，描边与线宽都不动', () => {
    for (const lit of [true, false]) {
      const base = blockStyle(lit);
      const hover = blockStyle(lit, true);
      expect(hover.fillColor).not.toBe(base.fillColor);
      expect(hover.color).toBe(base.color);
      expect(hover.weight).toBe(base.weight);
    }
  });
});

describe('省界分组线（§6.6）', () => {
  /** 都是接近白的浅灰，比十六进制整数就是比谁更深 */
  const tone = (hex: string) => parseInt(hex.slice(1), 16);

  it('绝不填充：填了就等于拿 34 个大多边形把下面的色块盖光', () => {
    expect(PROVINCE_BORDER.fill).toBe(false);
    expect(PROVINCE_BORDER.stroke).toBe(true);
  });

  it('不交互：点击得穿透到下面的色块，不然面板永远点不开', () => {
    expect(PROVINCE_BORDER.interactive).toBe(false);
  });

  it('比市界深一档粗一档，但不引入第三种语义色（线里不含砖粉）', () => {
    expect(tone(PROVINCE_BORDER.color!)).toBeLessThan(tone(blockStyle(false).color!));
    expect(PROVINCE_BORDER.weight!).toBeGreaterThan(blockStyle(false).weight!);
    expect(PROVINCE_BORDER.color).not.toContain('217, 72, 15');
  });

  it('半透：它要骑在直辖市的描边上，不透明会把描边切断成褐框', () => {
    expect(PROVINCE_BORDER.opacity!).toBeLessThan(1);
  });
});
