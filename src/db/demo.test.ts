import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { clearDemoData, loadDemoData, DEMO_PREFIX } from './demo';
import { getRanking, listVideos, seedCities, getAllCities } from './videos';

describe('示例数据（M5 可视化验证）', () => {
  it('载入幂等：重复载入不新增；清空后归零', async () => {
    const n1 = await loadDemoData();
    expect(n1).toBeGreaterThan(30);
    const n2 = await loadDemoData();
    expect(n2).toBe(0); // url 已存在全部跳过

    const cleared = await clearDemoData();
    expect(cleared).toBe(n1);
    expect((await listVideos()).length).toBe(0);
  });

  it('榜单排序：成都第一（吃最多），unknown 城市不进榜', async () => {
    await seedCities();
    await loadDemoData();
    const cities = await getAllCities();
    const nameOf = (code: string) => cities.find((c) => c.code === code)?.name;

    const ranking = await getRanking();
    expect(nameOf(ranking[0].cityCode)).toBe('成都');
    // 吃权重×3 → 杭州(吃1玩5=8) 应排在 上海(吃3玩3=12) 之后
    const hz = ranking.findIndex((r) => nameOf(r.cityCode) === '杭州');
    const sh = ranking.findIndex((r) => nameOf(r.cityCode) === '上海');
    expect(sh).toBeLessThan(hz);
    // 全部榜单城市都能在城市库中定位（无 unknown）
    expect(ranking.every((r) => r.cityCode !== 'unknown')).toBe(true);

    await clearDemoData();
  });

  it('示例 url 均带 demo 前缀，不会混入真实数据', async () => {
    await loadDemoData();
    const all = await listVideos();
    expect(all.every((v) => v.url.startsWith(DEMO_PREFIX))).toBe(true);
    await clearDemoData();
  });
});
