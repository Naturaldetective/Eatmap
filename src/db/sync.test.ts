import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { addVideo, deleteVideo, getDB, listVideos, updateVideo } from './videos';
import {
  applyMerge,
  getSyncMeta,
  listTombstones,
  pruneTombstones,
  resetSyncState,
  setSyncMeta,
  SYNC_TTL_MS,
} from './sync';
import { mergeState } from '../sync/merge';
import type { CloudSnapshot } from '../sync/merge';
import type { NewVideo } from './videos';

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

function cloud(videos: CloudSnapshot['videos'], deleted: Record<string, number> = {}): CloudSnapshot {
  return { app: 'eatmap', version: 1, rev: 1, updatedAt: 0, videos, deleted };
}

/** 用例自包含：三张表都清一遍，避免用例间状态漂移（同 videos.test.ts 的口径） */
async function resetAll() {
  const db = await getDB();
  const tx = db.transaction(['videos', 'tombstones', 'syncMeta'], 'readwrite');
  tx.objectStore('videos').clear();
  tx.objectStore('tombstones').clear();
  tx.objectStore('syncMeta').clear();
  await tx.done;
}

beforeEach(() => resetAll());

describe('删除标记落库', () => {
  it('deleteVideo 会留下 tombstone（否则下次拉取原样复活）', async () => {
    const r = await addVideo(mk());
    if (!r.ok) throw new Error('unexpected duplicate');
    await deleteVideo(r.video.id);
    expect(await listVideos()).toHaveLength(0);
    const ts = await listTombstones();
    expect(ts).toEqual([expect.objectContaining({ id: r.video.id, url: r.video.url })]);
    expect(ts[0].deletedAt).toBeGreaterThan(0);
  });

  it('updateVideo 会刷新 updatedAt（合并时靠它定胜负）', async () => {
    const r = await addVideo(mk({ updatedAt: 100 }));
    if (!r.ok) throw new Error('unexpected duplicate');
    const next = await updateVideo({ id: r.video.id, title: '改过' });
    expect(next.updatedAt!).toBeGreaterThan(100);
  });
});

describe('合并结果落库', () => {
  it('同 url 换 id：先删旧再写新，不撞 by-url 唯一索引', async () => {
    const url = 'https://www.xiaohongshu.com/explore/dup';
    const old = await addVideo(mk({ url, id: 'local-old', updatedAt: 100 }));
    if (!old.ok) throw new Error('unexpected duplicate');
    const result = mergeState({
      local: await listVideos(),
      remote: cloud([{ ...old.video, id: 'remote-new', updatedAt: 900, title: '云端改名' }]),
      localDeleted: await listTombstones(),
    });
    await applyMerge(result);
    const rows = await listVideos();
    expect(rows.map((r) => r.id)).toEqual(['remote-new']);
    expect(rows[0].title).toBe('云端改名');
  });

  it('云端删除压制本地：拉一次就没了', async () => {
    const r = await addVideo(mk({ id: 'gone', updatedAt: 100 }));
    if (!r.ok) throw new Error('unexpected duplicate');
    const result = mergeState({
      local: await listVideos(),
      remote: cloud([{ ...r.video, updatedAt: 100 }], { gone: 500 }),
      localDeleted: [],
    });
    await applyMerge(result);
    expect(await listVideos()).toHaveLength(0);
    expect(await listTombstones()).toContainEqual(expect.objectContaining({ id: 'gone' }));
  });
});

describe('同步游标', () => {
  it('没同步过时给一份全零的默认值而不是 undefined', async () => {
    expect(await getSyncMeta()).toEqual({
      id: 'state',
      rev: 0,
      updatedAt: 0,
      lastPulledAt: 0,
      lastPushedAt: 0,
      fingerprint: '',
    });
  });

  it('setSyncMeta 是打补丁，不覆盖没提到的字段', async () => {
    await setSyncMeta({ rev: 7, fingerprint: '1:0:100' });
    await setSyncMeta({ lastPushedAt: 1234 });
    const meta = await getSyncMeta();
    expect(meta.rev).toBe(7);
    expect(meta.fingerprint).toBe('1:0:100');
    expect(meta.lastPushedAt).toBe(1234);
  });

  it('resetSyncState 清游标与标记，但保留本地记录（换口令用）', async () => {
    await addVideo(mk({ id: 'keep' }));
    const del = await addVideo(mk({ id: 'del' }));
    if (del.ok) await deleteVideo('del');
    await setSyncMeta({ rev: 3 });
    await resetSyncState();
    expect((await getSyncMeta()).rev).toBe(0);
    expect(await listTombstones()).toHaveLength(0);
    expect((await listVideos()).map((v) => v.id)).toEqual(['keep']);
  });
});

describe('删除标记清理', () => {
  it('只清超过窗口的，新标记留着防复活', async () => {
    const r = await addVideo(mk({ id: 'del-me' }));
    if (!r.ok) throw new Error('unexpected duplicate');
    await deleteVideo('del-me');
    const fresh = (await listTombstones())[0];
    const db = await getDB();
    await db.put('tombstones', {
      ...fresh,
      id: 'ancient',
      deletedAt: Date.now() - SYNC_TTL_MS - 1000,
    });

    expect(await pruneTombstones()).toBe(1);
    const left = await listTombstones();
    expect(left.map((t) => t.id)).toEqual(['del-me']);
  });
});

