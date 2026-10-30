import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { VideoRecord } from './schema';
import {
  addVideo,
  countByCity,
  deleteVideo,
  exportVideos,
  getRanking,
  getVideoByUrl,
  importVideos,
  listVideos,
  listVisitedRecords,
  seedCities,
  setVideoVisited,
  updateVideo,
  videoScore,
  visitedCitiesOf,
  getAllCities,
  getDB,
  type AddResult,
  type NewVideo,
} from './videos';

/** 新增必然成功（重复则抛错），便于测试里拿到 VideoRecord 类型 */
async function addOk(over: Partial<NewVideo> = {}): Promise<VideoRecord> {
  const r: AddResult = await addVideo(mk(over));
  if (!r.ok) throw new Error('unexpected duplicate url');
  return r.video;
}

function mk(over: Partial<NewVideo> = {}): NewVideo {
  return {
    url: `https://www.xiaohongshu.com/explore/${Math.random().toString(36).slice(2)}`,
    platform: 'xiaohongshu',
    title: '测试视频',
    category: 'food',
    categorySource: 'auto',
    cityCode: '510100',
    ...over,
  };
}

describe('eatmap 数据层（M1）', () => {
  /** 用例自包含：先清库再造数，避免用例间状态漂移 */
  async function resetVideos() {
    const db = await getDB();
    const tx = db.transaction('videos', 'readwrite');
    await tx.store.clear();
    await tx.done;
  }

  it('seedCities：城市种子灌入并可查询', async () => {
    const n = await seedCities();
    expect(n).toBeGreaterThan(50);
    const cities = await getAllCities();
    expect(cities.length).toBe(n);
    const cd = cities.find((c) => c.code === '510100');
    expect(cd?.name).toBe('成都');
    expect(cd?.aliases).toContain('蓉城');
  });

  it('addVideo：写入成功；url 重复返回已有记录（§4.4）', async () => {
    const url = 'https://mp.weixin.qq.com/s/dup-test';
    const first = await addVideo(mk({ url, platform: 'wechat' }));
    expect(first.ok).toBe(true);
    let firstId = '';
    if (first.ok) firstId = first.video.id;
    const second = await addVideo(mk({ url }));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.existing.url).toBe(url);
    expect((await getVideoByUrl(url))?.id).toBe(firstId);
  });

  it('按城市聚合计数（手册 M1 验收：写入/按城市聚合）', async () => {
    await resetVideos();
    // 成都：3 food + 1 travel；重庆：1 food；unknown 城市 1 条
    await addVideo(mk({ cityCode: '510100', category: 'food' }));
    await addVideo(mk({ cityCode: '510100', category: 'food' }));
    await addVideo(mk({ cityCode: '510100', category: 'food' }));
    await addVideo(mk({ cityCode: '510100', category: 'travel' }));
    await addVideo(mk({ cityCode: '500000', category: 'food' }));
    await addVideo(mk({ cityCode: 'unknown', category: 'unknown' }));

    const counts = await countByCity();
    const cd = counts.find((c) => c.cityCode === '510100')!;
    expect(cd.foodCount).toBe(3);
    expect(cd.travelCount).toBe(1);
    expect(cd.total).toBe(4);
  });

  it('按分类过滤聚合（地图筛选 §6.1）：只统计 food 时 travel 城市不计入', async () => {
    await resetVideos();
    await addVideo(mk({ cityCode: '510100', category: 'food' }));
    await addVideo(mk({ cityCode: '510100', category: 'food' }));
    await addVideo(mk({ cityCode: '510100', category: 'travel' }));
    await addVideo(mk({ cityCode: '440100', category: 'travel' }));

    const foodOnly = await countByCity('food');
    const cd = foodOnly.find((c) => c.cityCode === '510100')!;
    expect(cd.total).toBe(2);
    expect(cd.foodCount).toBe(2);
    expect(cd.travelCount).toBe(0);
    // 纯 travel 城市在 food 筛选下不应出现
    expect(foodOnly.find((c) => c.cityCode === '440100')).toBeUndefined();
  });

  it('推荐排序：score = food*3 + travel（§3.3），unknown 不进榜', async () => {
    await resetVideos();
    expect(videoScore({ foodCount: 2, travelCount: 3 })).toBe(9);
    await addVideo(mk({ cityCode: '510100', category: 'food' }));
    await addVideo(mk({ cityCode: '510100', category: 'food' }));
    await addVideo(mk({ cityCode: '510100', category: 'food' }));
    await addVideo(mk({ cityCode: '510100', category: 'food' }));
    await addVideo(mk({ cityCode: '510100', category: 'travel' }));
    await addVideo(mk({ cityCode: '500000', category: 'food' }));
    await addVideo(mk({ cityCode: '500000', category: 'food' }));
    await addVideo(mk({ cityCode: '440100', category: 'food' }));
    await addVideo(mk({ cityCode: '440100', category: 'food' }));
    await addVideo(mk({ cityCode: '440100', category: 'food' }));
    await addVideo(mk({ cityCode: 'unknown', category: 'unknown' }));

    const ranking = await getRanking();
    expect(ranking.find((r) => r.cityCode === 'unknown')).toBeUndefined();
    // 成都(food4,travel1)=13 > 广州(food3)=9 > 重庆(food2)=6
    expect(ranking[0].cityCode).toBe('510100');
    expect(ranking[0].score).toBe(13);
    expect(ranking.map((r) => r.cityCode)).toEqual(['510100', '440100', '500000']);
  });

  it('updateVideo：可改分类并锁定 manual 来源；id 不可变；url 查重', async () => {
    const video = await addOk();
    const updated = await updateVideo({ id: video.id, category: 'travel', categorySource: 'manual' });
    expect(updated.category).toBe('travel');
    expect(updated.categorySource).toBe('manual');
    const dup = await addVideo(mk({ url: updated.url }));
    expect(dup.ok).toBe(false);
    await expect(updateVideo({ id: video.id, url: updated.url + '#x' })).resolves.toBeTruthy();
  });

  it('listVideos：按城市/分类过滤，按时间倒序', async () => {
    const cdFood = await listVideos({ cityCode: '510100', category: 'food' });
    expect(cdFood.every((v) => v.cityCode === '510100' && v.category === 'food')).toBe(true);
    for (let i = 1; i < cdFood.length; i++) {
      expect(cdFood[i - 1].parsedAt).toBeGreaterThanOrEqual(cdFood[i].parsedAt);
    }
  });

  it('导出/导入 JSON：skip 与 overwrite 合并策略（§3.4）', async () => {
    await resetVideos();
    const file = await exportVideos();
    expect(file.app).toBe('eatmap');
    await addVideo(mk({ title: '原始标题' }));
    const exported = await exportVideos();
    expect(exported.videos.length).toBe(1);

    // 原样回灌：全部跳过
    const skip = await importVideos(exported, 'skip');
    expect(skip.added).toBe(0);
    expect(skip.merged).toBe(exported.videos.length);

    // 改标题后回灌 overwrite：以文件为准
    const patched = structuredClone(exported);
    patched.videos[0].title = '覆盖测试';
    await importVideos(patched, 'overwrite');
    expect((await getVideoByUrl(patched.videos[0].url))?.title).toBe('覆盖测试');
  });

  it('deleteVideo：删除后聚合数减少', async () => {
    await resetVideos();
    const video = await addOk({ cityCode: '440100' });
    const before = (await countByCity()).find((c) => c.cityCode === '440100')!;
    await deleteVideo(video.id);
    const after = (await countByCity()).find((c) => c.cityCode === '440100');
    expect(after?.total ?? 0).toBe(before.total - 1);
  });
});

describe('旅记点亮（§6.6）', () => {
  async function resetVideos() {
    const db = await getDB();
    const tx = db.transaction('videos', 'readwrite');
    await tx.store.clear();
    await tx.done;
  }

  it('点亮会顶高 updatedAt：不然跨设备合并会把这次点亮洗掉', async () => {
    await resetVideos();
    const v = await addOk({ cityCode: '510100' });
    expect(v.visitedAt).toBeUndefined();
    const lit = await setVideoVisited(v.id, true);
    const at = lit.visitedAt ?? 0;
    expect(at).toBeGreaterThan(0);
    expect(lit.updatedAt ?? 0).toBeGreaterThanOrEqual(at);
    expect((await getVideoByUrl(v.url))?.visitedAt).toBe(at);
  });

  it('取消点亮：visitedAt 清空，记录本身不丢', async () => {
    await resetVideos();
    const v = await addOk({ cityCode: '510100', title: '火锅' });
    await setVideoVisited(v.id, true);
    const off = await setVideoVisited(v.id, false);
    expect(off.visitedAt).toBeUndefined();
    expect(off.title).toBe('火锅');
    expect(await listVisitedRecords()).toEqual([]);
  });

  it('重复点亮刷新日期：已亮着再按一次不报错也不堆历史', async () => {
    await resetVideos();
    const v = await addOk();
    const first = await setVideoVisited(v.id, true);
    const second = await setVideoVisited(v.id, true);
    expect(second.visitedAt ?? 0).toBeGreaterThanOrEqual(first.visitedAt ?? 0);
    expect(await listVisitedRecords()).toHaveLength(1);
  });

  it('任一记录点亮就算城去过，firstAt 取最早，次数累计', async () => {
    await resetVideos();
    await setVideoVisited((await addOk({ cityCode: '510100' })).id, true);
    await setVideoVisited((await addOk({ cityCode: '510100', category: 'travel' })).id, true);
    const cd = await addOk({ cityCode: '510100' });
    await setVideoVisited(cd.id, true);
    await setVideoVisited((await addOk({ cityCode: '440100' })).id, true);
    await setVideoVisited((await addOk({ cityCode: 'unknown', category: 'unknown' })).id, true);

    const cities = visitedCitiesOf(await listVisitedRecords());
    // 'unknown' 不进气泡也不进色块，但 listVisitedRecords 负责把它交给调用方
    expect((await listVisitedRecords()).some((r) => r.cityCode === 'unknown')).toBe(true);
    expect(cities.find((c) => c.cityCode === 'unknown')).toBeUndefined();
    expect(cities).toHaveLength(2);
    expect(cities.find((c) => c.cityCode === '510100')!.count).toBe(3);
    expect(cities.find((c) => c.cityCode === '440100')!.count).toBe(1);
    // 结果按 firstAt 正序（同一毫秒内点亮两座城时不比谁先，只保证不乱序）
    expect(cities[0].firstAt).toBeLessThanOrEqual(cities[1].firstAt);
  });

  it('只改一条的点亮不影响同城其他记录', async () => {
    await resetVideos();
    const a = await addOk({ cityCode: '510100' });
    const b = await addOk({ cityCode: '510100' });
    await setVideoVisited(a.id, true);
    expect((await getVideoByUrl(b.url))?.visitedAt).toBeUndefined();
    expect(visitedCitiesOf(await listVisitedRecords())[0].count).toBe(1);
  });
});
