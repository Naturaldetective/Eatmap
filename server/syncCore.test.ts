import { describe, expect, it } from 'vitest';
import {
  handleSyncRequest,
  spaceIdOf,
  stateKey,
  validateState,
  type CloudState,
  type SyncStore,
} from './syncCore';

/** 内存版存储：只验 syncCore 的判定，不碰 Blob / 文件系统 */
function memStore(): SyncStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => void map.set(k, v),
    delete: async (k) => void map.delete(k),
  };
}

const PASS = 'eatmap-demo';
const SPACE = spaceIdOf(PASS);

function snapshot(over: Partial<CloudState> = {}): CloudState {
  return {
    app: 'eatmap',
    version: 1,
    rev: 0,
    updatedAt: 0,
    videos: [
      {
        id: 'v1',
        url: 'https://www.xiaohongshu.com/explore/aaa',
        platform: 'xiaohongshu',
        title: '成都探店',
        category: 'food',
        categorySource: 'auto',
        cityCode: '510100',
        parsedAt: 1_700_000_000_000,
      },
    ],
    deleted: {},
    ...over,
  };
}

async function req(
  store: SyncStore,
  method: string,
  query: Record<string, string> = {},
  body?: string,
) {
  const q = new URLSearchParams(query).toString();
  const out = await handleSyncRequest(
    { method, url: `/api/data${q ? '?' + q : ''}`, body, origin: 'https://eatmap.edgeone.cool' },
    store,
  );
  return { ...out, json: () => JSON.parse(out.body) as CloudState & { ok: boolean; error?: string; rev?: number } };
}

describe('空间口令哈希（跨端一致性的服务端半边）', () => {
  it('固定向量：口令 eatmap-demo → 3bf86d02c12030f5', () => {
    // 前端 src/sync/spaceId.test.ts 断言同一个字面量；两边算法漂了就有一侧红
    expect(SPACE).toBe('3bf86d02c12030f5');
    expect(spaceIdOf('口令测试')).toBe('54a5272ae2d713ef');
  });

  it('首尾空格不算口令的一部分（复制粘贴常带）', () => {
    expect(spaceIdOf(`  ${PASS}  `)).toBe(SPACE);
  });

  it('存储 key 按空间分目录，非法 id 直接拒', () => {
    expect(stateKey(SPACE)).toBe(`spaces/${SPACE}/state.json`);
    expect(() => stateKey('../../etc/passwd')).toThrow(/空间 id 非法/);
    expect(() => stateKey('短')).toThrow(/空间 id 非法/);
  });
});

describe('快照校验', () => {
  it('认自家快照，缺 deleted 当空表', () => {
    const s = validateState(snapshot({ deleted: undefined as unknown as Record<string, number> }));
    expect(s.deleted).toEqual({});
    expect(s.videos).toHaveLength(1);
  });

  it('不是 EatMap / 版本不对 / videos 不是数组都拒', () => {
    expect(() => validateState({ ...snapshot(), app: 'other' })).toThrow(/不是 EatMap/);
    expect(() => validateState({ ...snapshot(), version: 99 })).toThrow(/版本不支持/);
    expect(() => validateState({ ...snapshot(), videos: 'x' })).toThrow(/videos 不是数组/);
    expect(() => validateState({ ...snapshot(), videos: [{ id: 'a' }] })).toThrow(/缺少 id 或 url/);
    expect(() => validateState(null)).toThrow(/不是对象/);
  });

  it('deleted 里的非数字项丢掉而不是整份拒掉（云端标记不该因一条脏数据不可用）', () => {
    const s = validateState(snapshot({ deleted: { a: 1, b: 'x' as unknown as number, c: NaN } }));
    expect(s.deleted).toEqual({ a: 1 });
  });
});

describe('同步接口：拉 / 推 / 版本冲突 / 删空间', () => {
  it('空空间 GET 回 state:null，不报错', async () => {
    const r = await req(memStore(), 'GET', { space: SPACE });
    expect(r.status).toBe(200);
    expect(r.json()).toEqual({ ok: true, state: null });
  });

  it('首次 PUT baseRev=0 → rev 1，GET 能拉回来', async () => {
    const store = memStore();
    const put = await req(store, 'PUT', { space: SPACE, baseRev: '0' }, JSON.stringify(snapshot()));
    expect(put.status).toBe(200);
    expect(put.json().rev).toBe(1);
    const got = await req(store, 'GET', { space: SPACE });
    const state = (got.json() as unknown as { state: CloudState }).state;
    expect(state.rev).toBe(1);
    expect(state.videos[0].title).toBe('成都探店');
  });

  it('服务端自己定 rev 与 updatedAt，不采信客户端带来的值', async () => {
    const store = memStore();
    await req(store, 'PUT', { space: SPACE, baseRev: '0' }, JSON.stringify(snapshot({ rev: 999, updatedAt: 1 })));
    const state = (
      (await req(store, 'GET', { space: SPACE })).json() as unknown as { state: CloudState }
    ).state;
    expect(state.rev).toBe(1);
    expect(state.updatedAt).toBeGreaterThan(Date.now() - 60_000);
  });

  it('rev 不匹配 → 409 且带回服务端当前快照（客户端据此合并重试）', async () => {
    const store = memStore();
    await req(store, 'PUT', { space: SPACE, baseRev: '0' }, JSON.stringify(snapshot()));
    await req(store, 'PUT', { space: SPACE, baseRev: '1' }, JSON.stringify(snapshot({ updatedAt: 2 })));
    const stale = await req(store, 'PUT', { space: SPACE, baseRev: '1' }, JSON.stringify(snapshot()));
    expect(stale.status).toBe(409);
    const body = stale.json() as unknown as { error: string; state: CloudState };
    expect(body.error).toBe('rev-conflict');
    expect(body.state.rev).toBe(2);
  });

  it('空空间上 baseRev 给非 0 → 409（说明客户端记着别的空间的版本）', async () => {
    const r = await req(memStore(), 'PUT', { space: SPACE, baseRev: '7' }, JSON.stringify(snapshot()));
    expect(r.status).toBe(409);
  });

  it('DELETE 之后这个空间归零', async () => {
    const store = memStore();
    await req(store, 'PUT', { space: SPACE, baseRev: '0' }, JSON.stringify(snapshot()));
    expect((await req(store, 'DELETE', { space: SPACE })).status).toBe(200);
    expect((await req(store, 'GET', { space: SPACE })).json()).toEqual({ ok: true, state: null });
  });

  it('缺 space / 非法 space → 400', async () => {
    expect((await req(memStore(), 'GET')).status).toBe(400);
    expect((await req(memStore(), 'GET', { space: 'GGGGGGGGGGGGGGGG' })).status).toBe(400);
  });

  it('PUT 正文不是 JSON / 不是合法快照 → 400，不落库', async () => {
    const store = memStore();
    expect((await req(store, 'PUT', { space: SPACE, baseRev: '0' }, '<html>')).status).toBe(400);
    expect((await req(store, 'PUT', { space: SPACE, baseRev: '0' }, '{"app":"other"}')).status).toBe(400);
    expect(store.map.size).toBe(0);
  });

  it('超过体积上限 → 413（防被灌爆 Blob）', async () => {
    const big = JSON.stringify(snapshot()) + 'x'.repeat(2048);
    const r = await handleSyncRequest(
      { method: 'PUT', url: `/api/data?space=${SPACE}&baseRev=0`, body: big },
      memStore(),
      { maxBytes: 64 },
    );
    expect(r.status).toBe(413);
  });

  it('预检要放开 PUT / DELETE（中转只有 GET）', async () => {
    const r = await req(memStore(), 'OPTIONS', { space: SPACE });
    expect(r.status).toBe(204);
    expect(r.headers['Access-Control-Allow-Methods']).toContain('PUT');
    expect(r.headers['Access-Control-Allow-Methods']).toContain('DELETE');
  });

  it('快照一律 no-store：中间层缓存会让 rev 判定用到旧值', async () => {
    const r = await req(memStore(), 'GET', { space: SPACE });
    expect(r.headers['Cache-Control']).toBe('no-store');
  });

  it('不支持的方法 → 405', async () => {
    expect((await req(memStore(), 'PATCH', { space: SPACE })).status).toBe(405);
  });
});
