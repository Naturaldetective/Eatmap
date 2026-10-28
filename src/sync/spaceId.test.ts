import { describe, expect, it } from 'vitest';
import { spaceIdOf } from './spaceId';

describe('口令 → 空间 id（与服务端 spaceIdOf 的跨端一致性）', () => {
  it('固定向量和 server/syncCore.test.ts 里那条必须相同', async () => {
    // 两处都写死字面量而不是互相 import：谁改了算法，另一侧的测就会红
    expect(await spaceIdOf('eatmap-demo')).toBe('3bf86d02c12030f5');
    expect(await spaceIdOf('口令测试')).toBe('54a5272ae2d713ef');
  });

  it('trim 掉首尾空格（粘贴常带），中文口令稳定', async () => {
    expect(await spaceIdOf('  eatmap-demo  ')).toBe(await spaceIdOf('eatmap-demo'));
    expect(await spaceIdOf('吃图我的空间')).toBe(await spaceIdOf('吃图我的空间'));
  });

  it('输出 16 位十六进制，不同口令不撞', async () => {
    const a = await spaceIdOf('a');
    const b = await spaceIdOf('b');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
  });
});
