import { describe, expect, it } from 'vitest';
import { buildSnapshot, fingerprintOf, mergeState, stampOf } from './merge';
import type { CloudSnapshot } from './merge';
import type { Tombstone, VideoRecord } from '../db/schema';

const URL_A = 'https://www.xiaohongshu.com/explore/aaa';
const URL_B = 'https://www.xiaohongshu.com/explore/bbb';

function video(over: Partial<VideoRecord> = {}): VideoRecord {
  return {
    id: 'v1',
    url: URL_A,
    platform: 'xiaohongshu',
    title: '成都探店',
    category: 'food',
    categorySource: 'auto',
    cityCode: '510100',
    parsedAt: 1_000,
    ...over,
  };
}

function cloud(videos: VideoRecord[], deleted: Record<string, number> = {}, rev = 3): CloudSnapshot {
  return { app: 'eatmap', version: 1, rev, updatedAt: 0, videos, deleted };
}

const tomb = (id: string, url: string, deletedAt: number): Tombstone => ({ id, url, deletedAt });

describe('拉取合并', () => {
  it('云端独有的记录拉进本地', () => {
    const r = mergeState({ local: [], remote: cloud([video()]), localDeleted: [] });
    expect(r.upsert).toHaveLength(1);
    expect(r.stats.added).toBe(1);
  });

  it('本地独有的不动（等推送阶段带上去）', () => {
    const r = mergeState({ local: [video()], remote: cloud([]), localDeleted: [] });
    expect(r.upsert).toHaveLength(0);
    expect(r.dropIds).toHaveLength(0);
  });

  it('同 id：云端更新才覆盖，云端更旧/同时间都不动本地', () => {
    const local = [video({ updatedAt: 500 })];
    expect(mergeState({ local, remote: cloud([video({ updatedAt: 900, title: '改名' })]), localDeleted: [] }).upsert)
      .toEqual([expect.objectContaining({ title: '改名' })]);
    expect(mergeState({ local, remote: cloud([video({ updatedAt: 100 })]), localDeleted: [] }).upsert).toHaveLength(0);
    expect(mergeState({ local, remote: cloud([video({ updatedAt: 500 })]), localDeleted: [] }).upsert).toHaveLength(0);
  });

  it('老数据没 updatedAt 时按 parsedAt 定胜负（不能永远判负于云端）', () => {
    expect(stampOf(video({ parsedAt: 800 }))).toBe(800);
    const r = mergeState({ local: [video({ parsedAt: 800 })], remote: cloud([video({ parsedAt: 200 })]), localDeleted: [] });
    expect(r.upsert).toHaveLength(0);
  });
});

describe('同一条链接被两台设备各自导入（id 不同、url 相同）', () => {
  it('时间新的那条赢，另一条落删除标记并从本地删掉', () => {
    const r = mergeState({
      local: [video({ id: 'local-old', updatedAt: 100 })],
      remote: cloud([video({ id: 'remote-new', updatedAt: 900, title: '云端改过' })]),
      localDeleted: [],
    });
    expect(r.upsert).toEqual([expect.objectContaining({ id: 'remote-new' })]);
    expect(r.dropIds).toEqual(['local-old']);
    expect(r.tombstones).toContainEqual(expect.objectContaining({ id: 'local-old', url: URL_A }));
    expect(r.stats.deduped).toBe(1);
  });

  it('本地更新时反过来：云端那条被压掉，本地记录不动', () => {
    const r = mergeState({
      local: [video({ id: 'local-new', updatedAt: 900 })],
      remote: cloud([video({ id: 'remote-old', updatedAt: 100 })]),
      localDeleted: [],
    });
    expect(r.upsert).toHaveLength(0);
    expect(r.dropIds).toHaveLength(0);
    expect(r.tombstones).toContainEqual(expect.objectContaining({ id: 'remote-old' }));
  });
});

describe('删除标记（不记这个就是「删了又复活」）', () => {
  it('本地删过、云端快照还带着 → 从本地删掉，标记保留以便推回去', () => {
    const r = mergeState({
      local: [],
      remote: cloud([video({ id: 'v1', updatedAt: 100 })]),
      localDeleted: [tomb('v1', URL_A, 500)],
    });
    expect(r.upsert).toHaveLength(0);
    expect(r.tombstones).toEqual([tomb('v1', URL_A, 500)]);
  });

  it('本地已删且库里还留着（另一台设备删的）→ dropIds 收掉它', () => {
    const r = mergeState({
      local: [video({ id: 'v1', updatedAt: 100 })],
      remote: cloud([video({ id: 'v1', updatedAt: 100 })], { v1: 500 }),
      localDeleted: [],
    });
    expect(r.dropIds).toEqual(['v1']);
  });

  it('删除早于最后一次修改 → 不删（否则「A 刚改完、B 早前删过」会吃掉新数据）', () => {
    const r = mergeState({
      local: [video({ id: 'v1', updatedAt: 900 })],
      remote: cloud([video({ id: 'v1', updatedAt: 900 })], { v1: 500 }),
      localDeleted: [],
    });
    expect(r.dropIds).toHaveLength(0);
    expect(r.upsert).toHaveLength(0);
  });

  it('云端带来的无 url 标记不能丢，且要随快照推回去', () => {
    const r = mergeState({ local: [], remote: cloud([], { ghost: 700 }), localDeleted: [] });
    expect(r.tombstones).toEqual([tomb('ghost', '', 700)]);
    const body = buildSnapshot([], r.tombstones);
    expect(body.deleted).toEqual({ ghost: 700 });
  });
});

describe('打包与指纹', () => {
  it('buildSnapshot 是完整的本地全量 + 全部标记', () => {
    const body = buildSnapshot([video()], [tomb('gone', URL_B, 1)]);
    expect(body.app).toBe('eatmap');
    expect(body.videos).toHaveLength(1);
    expect(body.deleted).toEqual({ gone: 1 });
  });

  it('指纹随条数与最新时间变化（决定要不要白推一趟）', () => {
    const a = fingerprintOf([video({ updatedAt: 10 })], []);
    expect(fingerprintOf([video({ updatedAt: 10 })], [])).toBe(a);
    expect(fingerprintOf([video({ updatedAt: 11 })], [])).not.toBe(a);
    expect(fingerprintOf([video({ updatedAt: 10 })], [tomb('x', URL_B, 5)])).not.toBe(a);
  });
});

