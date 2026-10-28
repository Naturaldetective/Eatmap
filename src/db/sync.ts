/**
 * 同步用到的 IndexedDB 读写（§4.6）。所有跨表事务集中在这里，
 * 页面只调 syncXxx，不自己开 transaction —— 手册 §7 的口径。
 */
import { getDB } from './schema';
import type { SyncMetaRecord, Tombstone } from './schema';
import type { MergeResult } from '../sync/merge';

export async function listTombstones(): Promise<Tombstone[]> {
  const db = await getDB();
  return db.getAll('tombstones');
}

/**
 * 应用合并结果：先删后写。
 * 顺序不能反 —— videos.url 是唯一索引，同 url 换 id 时先 put 新记录会撞旧记录的索引。
 */
export async function applyMerge(result: MergeResult): Promise<void> {
  const { upsert, dropIds, tombstones } = result;
  if (!upsert.length && !dropIds.length && !tombstones.length) return;
  const db = await getDB();
  const tx = db.transaction(['videos', 'tombstones'], 'readwrite');
  for (const id of dropIds) tx.objectStore('videos').delete(id);
  for (const t of tombstones) tx.objectStore('tombstones').put(t);
  for (const v of upsert) tx.objectStore('videos').put(v);
  await tx.done;
}

const EMPTY_META: SyncMetaRecord = {
  id: 'state',
  rev: 0,
  updatedAt: 0,
  lastPulledAt: 0,
  lastPushedAt: 0,
  fingerprint: '',
};

export async function getSyncMeta(): Promise<SyncMetaRecord> {
  const db = await getDB();
  return (await db.get('syncMeta', 'state')) ?? { ...EMPTY_META };
}

export async function setSyncMeta(patch: Partial<Omit<SyncMetaRecord, 'id'>>): Promise<SyncMetaRecord> {
  const db = await getDB();
  const cur = await getSyncMeta();
  const next: SyncMetaRecord = { ...cur, ...patch, id: 'state' };
  await db.put('syncMeta', next);
  return next;
}

/**
 * 清理过期删除标记（默认 90 天）。
 * 清早了的后果：某台设备离线超过这个窗口，再上线时会把别人早已删掉的记录拉回来。
 * 自用场景 90 天足够宽，真要长期多端就调大 SYNC_TTL_MS。
 */
export const SYNC_TTL_MS = 90 * 24 * 3600 * 1000;

export async function pruneTombstones(now = Date.now()): Promise<number> {
  const db = await getDB();
  const all = await db.getAll('tombstones');
  const stale = all.filter((t) => now - t.deletedAt > SYNC_TTL_MS);
  if (!stale.length) return 0;
  const tx = db.transaction('tombstones', 'readwrite');
  for (const t of stale) tx.store.delete(t.id);
  await tx.done;
  return stale.length;
}

/** 换空间（改口令）时的重来一遍：清掉游标与删除标记，本地记录保留 */
export async function resetSyncState(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['syncMeta', 'tombstones'], 'readwrite');
  tx.objectStore('syncMeta').clear();
  tx.objectStore('tombstones').clear();
  await tx.done;
}
