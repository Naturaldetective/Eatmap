import { getDB, type Category, type VideoRecord } from './schema';

export type { Category, CityRecord, SyncMetaRecord, Tombstone, VideoRecord } from './schema';
export { seedCities, getAllCities, getCity, getDB } from './schema';

/** addVideo 的返回结合类型（导出供测试/调用方收窄） */
export type AddResult = { ok: true; video: VideoRecord } | { ok: false; existing: VideoRecord };

/** ============ CRUD（所有 IndexedDB 访问只允许经 src/db/，见手册 §7） ============ */

export type NewVideo = Omit<VideoRecord, 'id' | 'parsedAt'> &
  Partial<Pick<VideoRecord, 'id' | 'parsedAt'>>;

/** 新增：url 唯一索引冲突时返回已存在记录（调用方决定跳过/覆盖，§4.4） */
export async function addVideo(input: NewVideo): Promise<AddResult> {
  const db = await getDB();
  const now = Date.now();
  const video: VideoRecord = {
    parsedAt: now,
    ...input,
    id: input.id ?? crypto.randomUUID(),
    updatedAt: input.updatedAt ?? now,
  };
  const existing = await db.getFromIndex('videos', 'by-url', video.url);
  if (existing) return { ok: false, existing };
  await db.put('videos', video);
  return { ok: true, video };
}

/** 覆盖更新（按 id 不存在则报错由调用方处理） */
export async function updateVideo(patch: Partial<Omit<VideoRecord, 'id'>> & { id: string }): Promise<VideoRecord> {
  const db = await getDB();
  const old = await db.get('videos', patch.id);
  if (!old) throw new Error(`video not found: ${patch.id}`);
  // id 不可变；url 若修改需再次查重
  if (patch.url && patch.url !== old.url) {
    const dup = await db.getFromIndex('videos', 'by-url', patch.url);
    if (dup && dup.id !== patch.id) throw new Error(`url already exists: ${patch.url}`);
  }
  // 不显式传 updatedAt 的一律视为「刚刚改过」：同步合并就靠这个时间定胜负
  const next: VideoRecord = { ...old, ...patch, id: old.id, updatedAt: patch.updatedAt ?? Date.now() };
  await db.put('videos', next);
  return next;
}

/** 删除同时落下 tombstone（§4.6）：云上要据此压制其他设备的旧快照，否则删了又复活 */
export async function deleteVideo(id: string): Promise<void> {
  const db = await getDB();
  const old = await db.get('videos', id);
  const tx = db.transaction(['videos', 'tombstones'], 'readwrite');
  tx.objectStore('videos').delete(id);
  if (old) {
    tx.objectStore('tombstones').put({ id, url: old.url, deletedAt: Date.now() });
  }
  await tx.done;
}

export async function getVideoByUrl(url: string): Promise<VideoRecord | undefined> {
  const db = await getDB();
  return db.getFromIndex('videos', 'by-url', url);
}

export async function listVideos(opts?: { category?: Category; cityCode?: string }): Promise<VideoRecord[]> {
  const db = await getDB();
  let rows: VideoRecord[];
  if (opts?.cityCode) rows = await db.getAllFromIndex('videos', 'by-city', opts.cityCode);
  else if (opts?.category) rows = await db.getAllFromIndex('videos', 'by-category', opts.category);
  else rows = await db.getAll('videos');
  if (opts?.category && opts?.cityCode) rows = rows.filter((r) => r.category === opts.category);
  return rows.sort((a, b) => b.parsedAt - a.parsedAt);
}

/** ============ 派生数据：城市聚合与推荐排序（实时计算不落库，§3.3） ============ */

export interface CityCount {
  cityCode: string;
  foodCount: number;
  travelCount: number;
  unknownCount: number;
  total: number;
}

/** 万级以内单次遍历内存聚合（手册 §3.3 的性能预算）；category 传则只统计该分类（地图筛选 §6.1） */
export async function countByCity(category?: Category): Promise<CityCount[]> {
  const db = await getDB();
  const map = new Map<string, CityCount>();
  // 万级以内直接 getAll 内存聚合；避开 idb v8 游标代理在测试环境的行为差异
  for (const v of await db.getAll('videos')) {
    if (category && v.category !== category) continue;
    let c = map.get(v.cityCode);
    if (!c) {
      c = { cityCode: v.cityCode, foodCount: 0, travelCount: 0, unknownCount: 0, total: 0 };
      map.set(v.cityCode, c);
    }
    if (v.category === 'food') c.foodCount++;
    else if (v.category === 'travel') c.travelCount++;
    else c.unknownCount++;
    c.total++;
  }
  return [...map.values()];
}

/** 推荐权重：好吃数为主（×3），游玩数为副（×1），常量可调（§3.3） */
export const FOOD_WEIGHT = 3;
export const TRAVEL_WEIGHT = 1;

export function videoScore(c: Pick<CityCount, 'foodCount' | 'travelCount'>): number {
  return c.foodCount * FOOD_WEIGHT + c.travelCount * TRAVEL_WEIGHT;
}

/** 推荐榜单：按 score 降序；'unknown' 城市不进榜 */
export async function getRanking(): Promise<(CityCount & { score: number })[]> {
  const counts = await countByCity();
  return counts
    .filter((c) => c.cityCode !== 'unknown')
    .map((c) => ({ ...c, score: videoScore(c) }))
    .sort((a, b) => b.score - a.score || b.total - a.total);
}

/** ============ 导出 / 导入 JSON 备份（§3.4，数据页在 M5 接入 UI） ============ */

export interface BackupFile {
  app: 'eatmap';
  version: 1;
  exportedAt: number;
  videos: VideoRecord[];
}

export async function exportVideos(): Promise<BackupFile> {
  const db = await getDB();
  return { app: 'eatmap', version: 1, exportedAt: Date.now(), videos: await db.getAll('videos') };
}

export type MergeStrategy = 'skip' | 'overwrite';

/** 按 url 去重合并：skip=已有则跳过；overwrite=以文件为准覆盖 */
export async function importVideos(file: BackupFile, strategy: MergeStrategy = 'skip'): Promise<{ added: number; merged: number }> {
  const db = await getDB();
  let added = 0;
  let merged = 0;
  const tx = db.transaction('videos', 'readwrite');
  for (const v of file.videos) {
    const existing = await tx.store.index('by-url').get(v.url);
    if (!existing) {
      await tx.store.put(v);
      added++;
    } else if (strategy === 'overwrite') {
      await tx.store.put({ ...v, id: existing.id });
      merged++;
    } else {
      merged++;
    }
  }
  await tx.done;
  return { added, merged };
}
