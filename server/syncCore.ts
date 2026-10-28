/**
 * 云端同步的服务端逻辑（§3.4 的云上形态 / §4.6）。
 *
 * 与中转（relayCore）同一套架构约定：**纯逻辑、不感知运行时**，
 * 存储通过 SyncStore 注入 —— 云上是 EdgeOne Blob（node-functions/api/data.ts），
 * 单测注入内存实现，两边跑的是同一份判定代码。
 *
 * 为什么不用平台锁：@edgeone/pages-blob 的 set(key, v, { onlyIfNew }) 在类型定义里
 * 明确标了 @deprecated（底层不强制，已存在的 key 照样覆盖），所以并发只能自己管：
 * 服务端存一份带 rev 的全量快照，客户端推时带上自己拉到的 baseRev，
 * 不一致就 409 回服务端当前快照，由客户端合并后重试（乐观并发，无锁）。
 *
 * 空间隔离：/api/data 是公开接口，任何人都能调。数据按 spaces/<spaceId>/state.json
 * 分目录，spaceId = sha256(口令) 的前 16 位十六进制 —— 口令本身不上网，
 * 线上流的只是它的哈希（等价于 bearer：拿到哈希就等于拿到空间，所以口令要当密码保管）。
 */
import { createHash } from 'node:crypto';
import { relayCorsHeaders } from './relayCore';
import type { RelayEnv, RelayHttpResponse } from './relayCore';

export type SyncEnv = RelayEnv & {
  /** 单份快照的体积上限（字节），不配用 DEFAULT_MAX_BODY_BYTES */
  maxBytes?: number;
};

/** 服务端只认这三个字段名，改形状要同时动 validateState 与前端 mergeState */
export const SYNC_STATE_VERSION = 1;
export const SYNC_BLOB_STORE = 'eatmap';
/** 空间 id 长度：16 位十六进制 = 64 bit，够用且 URL 里看得清 */
const SPACE_ID_LEN = 16;
/** 单份快照的硬上限（防被灌爆 Blob）；正常自用几千条也才几 MB */
const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_VIDEOS = 50_000;
/** 同步接口放开的跨源方法（中转只有 GET，两者不要共用一份方法表） */
const SYNC_METHODS = 'GET, PUT, DELETE, OPTIONS';

/** 注入的存储：云上 Blob 实现这三个方法即可（单测用内存 map） */
export interface SyncStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface SyncRequestInput {
  method: string;
  /** 完整请求 URL（含 query），与 relayCore 的入参口径一致 */
  url: string;
  body?: string;
  origin?: string;
}

/** 云端快照：全量 videos + 删除标记（tombstone 不带就「删了又复活」） */
export interface SyncVideo {
  id: string;
  url: string;
  platform: string;
  title: string;
  desc?: string;
  cover?: string;
  category: string;
  categorySource: string;
  cityCode: string;
  geoConfidence?: number;
  parsedAt: number;
  updatedAt?: number;
  note?: string;
}

export interface CloudState {
  app: 'eatmap';
  version: number;
  /** 服务端写入时自增，客户端只读不回填 */
  rev: number;
  updatedAt: number;
  videos: SyncVideo[];
  /** 已删记录 id → 删除时间戳，用于跨设备压制复活 */
  deleted: Record<string, number>;
}

export class SyncError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

/** 口令 → 空间 id（与前端 WebCrypto 算法必须逐字节一致：sha256(utf8) hex 前 16） */
export function spaceIdOf(passphrase: string): string {
  return createHash('sha256').update(passphrase.trim(), 'utf8').digest('hex').slice(0, SPACE_ID_LEN);
}

function isSpaceId(v: string): boolean {
  return /^[0-9a-f]{16}$/.test(v);
}

export function stateKey(spaceId: string): string {
  if (!isSpaceId(spaceId)) throw new SyncError('空间 id 非法');
  return `spaces/${spaceId}/state.json`;
}

/** 只挡垃圾与滥用，不做业务校验：字段不齐的记录在客户端合并时也会被自然丢弃 */
export function validateState(raw: unknown): CloudState {
  const o = raw as Partial<CloudState> | null;
  if (!o || typeof o !== 'object') throw new SyncError('快照不是对象');
  if (o.app !== 'eatmap') throw new SyncError('不是 EatMap 的快照');
  if (o.version !== SYNC_STATE_VERSION) throw new SyncError(`快照版本不支持：${String(o.version)}`);
  if (!Array.isArray(o.videos)) throw new SyncError('videos 不是数组');
  if (o.videos.length > MAX_VIDEOS) throw new SyncError(`记录数超过上限 ${MAX_VIDEOS}`);
  for (const v of o.videos) {
    if (!v || typeof v.id !== 'string' || !v.id || typeof v.url !== 'string' || !v.url) {
      throw new SyncError('记录缺少 id 或 url');
    }
    if (typeof v.parsedAt !== 'number' || !Number.isFinite(v.parsedAt)) {
      throw new SyncError(`记录 ${v.id} 的 parsedAt 非法`);
    }
  }
  const deleted: Record<string, number> = {};
  if (o.deleted && typeof o.deleted === 'object') {
    for (const [k, val] of Object.entries(o.deleted)) {
      if (typeof val === 'number' && Number.isFinite(val)) deleted[k] = val;
    }
  }
  return {
    app: 'eatmap',
    version: SYNC_STATE_VERSION,
    rev: Number.isFinite(o.rev) ? Number(o.rev) : 0,
    updatedAt: Number.isFinite(o.updatedAt) ? Number(o.updatedAt) : 0,
    videos: o.videos,
    deleted,
  };
}

/** 读快照：损坏的存量文件当没有（否则一次写坏就永远同步不了） */
async function readState(store: SyncStore, spaceId: string): Promise<CloudState | null> {
  const text = await store.get(stateKey(spaceId));
  if (!text) return null;
  try {
    return validateState(JSON.parse(text));
  } catch {
    return null;
  }
}

function envelope(
  status: number,
  payload: unknown,
  origin: string | undefined,
  env: SyncEnv,
): RelayHttpResponse {
  return {
    status,
    headers: {
      ...relayCorsHeaders(origin, env, undefined, SYNC_METHODS),
      'Content-Type': 'application/json; charset=utf-8',
      // 快照是可变状态，任何中间层都不许缓存（Blob 自己的 eventual 一致性已经够烦人了）
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(payload),
  };
}

/**
 * 同步接口的主入口。
 * GET    ?space=<id>                → { ok, state }        state 为 null 表示空空间
 * PUT    ?space=<id>&baseRev=<n>    → { ok, rev }          版本冲突 409 且带回服务端当前快照
 * DELETE ?space=<id>                → { ok }               改口令后清旧空间用
 */
export async function handleSyncRequest(
  input: SyncRequestInput,
  store: SyncStore,
  env: SyncEnv = {},
): Promise<RelayHttpResponse> {
  const json = (status: number, payload: unknown) => envelope(status, payload, input.origin, env);
  const method = (input.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return { status: 204, headers: relayCorsHeaders(input.origin, env, '', SYNC_METHODS), body: '' };
  }

  let spaceId = '';
  let baseRev = 0;
  try {
    const u = new URL(input.url, 'http://sync.local');
    spaceId = u.searchParams.get('space') ?? '';
    baseRev = Number(u.searchParams.get('baseRev') ?? '0');
  } catch {
    return json(400, { ok: false, error: '地址无法解析' });
  }
  if (!isSpaceId(spaceId)) {
    return json(400, { ok: false, error: '缺少或非法的 space 参数（需要先设置空间口令）' });
  }

  try {
    if (method === 'GET') {
      const state = await readState(store, spaceId);
      return json(200, { ok: true, state });
    }

    if (method === 'DELETE') {
      await store.delete(stateKey(spaceId));
      return json(200, { ok: true });
    }

    if (method === 'PUT') {
      const body = input.body ?? '';
      const limit = env.maxBytes ?? DEFAULT_MAX_BODY_BYTES;
      if (body.length > limit) {
        return json(413, { ok: false, error: `快照超过体积上限 ${Math.round(limit / 1024 / 1024)}MB` });
      }
      if (!Number.isFinite(baseRev) || baseRev < 0) {
        return json(400, { ok: false, error: 'baseRev 非法' });
      }
      let incoming: CloudState;
      try {
        incoming = validateState(JSON.parse(body));
      } catch (e) {
        return json(400, { ok: false, error: e instanceof Error ? e.message : String(e) });
      }
      const current = await readState(store, spaceId);
      const currentRev = current?.rev ?? 0;
      if (currentRev !== baseRev) {
        // 带回服务端快照让客户端自己合并后重试，不在服务端做合并：
        // 合并规则（谁的时间新、删除怎么压制）只有前端那份和它配套，两处各写一遍必漂移。
        return json(409, { ok: false, error: 'rev-conflict', state: current });
      }
      const next: CloudState = {
        ...incoming,
        rev: baseRev + 1,
        updatedAt: Date.now(),
      };
      await store.set(stateKey(spaceId), JSON.stringify(next));
      return json(200, { ok: true, rev: next.rev, updatedAt: next.updatedAt });
    }

    return json(405, { ok: false, error: `不支持的方法 ${method}` });
  } catch (e) {
    if (e instanceof SyncError) return json(e.status, { ok: false, error: e.message });
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
