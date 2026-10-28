/**
 * 云端同步的浏览器侧（§4.6）。
 *
 * 语义：IndexedDB 永远是本机主存储（地图/榜单/离线都不变），云上只是**一份带版本号的全量快照**。
 * 流程固定为「拉 → 合并进本地 → 本地全量推回去」，服务端不参与合并（合并规则只有前端这一份，
 * 两边各写一遍必然漂移），它只做 rev 比对与存储。
 *
 * 空间口令：口令本身不上网，上网的是 sha256(口令) 的前 16 位（与 server/syncCore.ts 的
 * spaceIdOf 逐字节一致）。所以口令等同于 bearer 凭证 —— 拿到哈希就能读写那个空间，
 * 存在 localStorage 里也要当密码保管。改口令 = 换空间，走 changePassphrase 的迁移流程。
 */
import { listVideos } from '../db/videos';
import { applyMerge, getSyncMeta, listTombstones, pruneTombstones, resetSyncState, setSyncMeta } from '../db/sync';
import { buildSnapshot, fingerprintOf, mergeState } from './merge';
// 口令哈希算法拆到 spaceId.ts，让服务端测试能同时 import 两边比对（各测各的发现不了不一致）
import { spaceIdOf } from './spaceId';
import type { CloudSnapshot } from './merge';

const LS_PASS = 'eatmap.spacePass';
const LS_AUTO = 'eatmap.syncAuto';
/** 同步函数的路由路径（与 node-functions/api/data.ts 同名）：同源，不需要也不能配 */
const SYNC_PATH = '/api/data';
/** 409 之后的重试次数：两次都撞说明有设备在疯狂写，再撞下去只是耗流量 */
const MAX_RETRY = 2;
const PUSH_DEBOUNCE_MS = 1500;

export interface SyncStatus {
  configured: boolean;
  auto: boolean;
  spaceId: string;
  running: boolean;
  rev: number;
  lastAt: number;
  ok: boolean;
  detail: string;
}

let current: SyncStatus = {
  configured: false,
  auto: true,
  spaceId: '',
  running: false,
  rev: 0,
  lastAt: 0,
  ok: false,
  detail: '',
};
const listeners = new Set<(s: SyncStatus) => void>();

function publish(patch: Partial<SyncStatus>): SyncStatus {
  current = { ...current, ...patch };
  for (const fn of listeners) fn(current);
  return current;
}

export function getSyncStatus(): SyncStatus {
  return current;
}

export function subscribeSync(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

/* ==================== 配置 ==================== */

function lsGet(k: string): string {
  try {
    return localStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
}

function lsSet(k: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* 隐私模式下存不下，本次会话仍可用 */
  }
}

export function getPassphrase(): string {
  return lsGet(LS_PASS);
}

function isAutoSync(): boolean {
  const v = lsGet(LS_AUTO);
  return v === '' ? true : v === '1';
}

export function setAutoSync(on: boolean): void {
  lsSet(LS_AUTO, on ? '1' : '0');
  publish({ auto: on });
}

/** 随机口令：20 位 base32（去掉易混字符），手抄也不会抄错 */
export function newPassphrase(): string {
  const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

export { spaceIdOf };

/* ==================== 网络 ==================== */

interface SyncEnvelope {
  ok: boolean;
  error?: string;
  state?: CloudSnapshot | null;
  rev?: number;
}

async function callSync(spaceId: string, init?: RequestInit & { query?: Record<string, string> }): Promise<SyncEnvelope> {
  const q = new URLSearchParams({ space: spaceId, ...(init?.query ?? {}) });
  const res = await fetch(`${SYNC_PATH}?${q}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let json: SyncEnvelope;
  try {
    json = JSON.parse(text) as SyncEnvelope;
  } catch {
    // 静态托管站没部署 /api/data 时这里会被回退成 index.html，说清楚免得又是「200 但看不懂」
    throw new Error(/^\s*</.test(text) ? '同步接口回的是网页（这个站点上没有部署 /api/data）' : '同步接口响应不是合法 JSON');
  }
  if (!res.ok && res.status !== 409) throw new Error(json.error || `同步接口 HTTP ${res.status}`);
  return json;
}

/** 拉一次、合并、必要时推回去。返回本次状态 */
export async function syncNow(opts: { force?: boolean; pull?: boolean } = {}): Promise<SyncStatus> {
  const pass = getPassphrase();
  if (!pass) {
    return publish({ configured: false, detail: '未设置空间口令' });
  }
  if (current.running) return current;
  publish({ configured: true, running: true, detail: '同步中…' });
  const spaceId = await spaceIdOf(pass);
  const wantPull = opts.pull !== false;

  try {
    let remote: CloudSnapshot | null = null;
    if (wantPull) {
      const got = await callSync(spaceId);
      remote = got.state ?? null;
      const merged = mergeState({ local: await listVideos(), remote, localDeleted: await listTombstones() });
      await applyMerge(merged);
      await pruneTombstones();
      await setSyncMeta({ rev: remote?.rev ?? 0, updatedAt: remote?.updatedAt ?? 0, lastPulledAt: Date.now() });
    }

    const pushed = await pushSnapshot(spaceId, remote, opts.force === true);
    const detail = pushed
      ? `已同步 · ${new Date().toLocaleTimeString('zh-CN')} · rev ${pushed}`
      : `已是最新 · rev ${remote?.rev ?? 0}`;
    return publish({ configured: true, running: false, ok: true, spaceId, rev: pushed ?? remote?.rev ?? 0, lastAt: Date.now(), detail });
  } catch (e) {
    return publish({
      configured: true,
      running: false,
      ok: false,
      spaceId,
      lastAt: Date.now(),
      detail: '同步失败：' + (e instanceof Error ? e.message : String(e)),
    });
  }
}

/**
 * 把本地全量推上去。rev 冲突就重新拉一次、合并、再推（最多 MAX_RETRY 次）。
 * 指纹一致且没 force 时直接跳过，省掉一次 8MB 上限的 PUT。
 */
async function pushSnapshot(spaceId: string, remote: CloudSnapshot | null, force: boolean): Promise<number | null> {
  let serverState = remote;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    const videos = await listVideos();
    const tombstones = await listTombstones();
    const fp = fingerprintOf(videos, tombstones);
    const meta = await getSyncMeta();
    const baseRev = serverState?.rev ?? meta.rev ?? 0;
    if (!force && fp === meta.fingerprint && (serverState ? serverState.rev === meta.rev : baseRev === 0)) {
      return baseRev;
    }
    if (!videos.length && !tombstones.length) return baseRev; // 空空间不写，省得把别人的数据判成「全删了」
    const body = JSON.stringify(buildSnapshot(videos, tombstones));
    const res = await callSync(spaceId, { method: 'PUT', query: { baseRev: String(baseRev) }, body });
    if (res.ok && typeof res.rev === 'number') {
      await setSyncMeta({ rev: res.rev, fingerprint: fp, lastPushedAt: Date.now() });
      return res.rev;
    }
    // 409：拿服务端当前快照重新合并再来一遍
    serverState = res.state ?? null;
    if (!serverState) throw new Error(res.error || '推送失败');
    await applyMerge(mergeState({ local: await listVideos(), remote: serverState, localDeleted: await listTombstones() }));
  }
  throw new Error(`连续 ${MAX_RETRY} 次版本冲突，稍后再试（可能有另一台设备在同时写）`);
}

/* ==================== 触发 ==================== */

let timer: ReturnType<typeof setTimeout> | null = null;

/** 页面改完数据调这个：防抖一次，避免批量导入时每条链接都推一趟 */
export function scheduleSync(): void {
  if (!getPassphrase() || !isAutoSync()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow({ pull: false });
  }, PUSH_DEBOUNCE_MS);
}

/** App 启动时挂一次：进页面拉平、离开前推平 */
export function startAutoSync(): () => void {
  publish({ auto: isAutoSync(), configured: !!getPassphrase() });
  const run = () => {
    if (isAutoSync() && getPassphrase()) void syncNow();
  };
  const onVisibility = () => {
    // 切到后台/关页面前把本地推完，不然最后一条改动要等下次打开才上去
    if (document.visibilityState === 'hidden' && isAutoSync() && getPassphrase()) void syncNow({ pull: false });
  };
  run();
  window.addEventListener('focus', run);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('focus', run);
    document.removeEventListener('visibilitychange', onVisibility);
    if (timer) clearTimeout(timer);
  };
}

/* ==================== 口令与空间 ==================== */

/**
 * 设置/更换口令。旧空间的数据先拉平到本地，再用新口令推上去，
 * 最后（可选）删掉旧空间的快照 —— 迁移是客户端驱动的，服务端不需要 move 接口。
 */
export async function changePassphrase(next: string, opts: { deleteOld?: boolean } = {}): Promise<SyncStatus> {
  const oldPass = getPassphrase();
  const trimmed = next.trim();
  if (!trimmed) throw new Error('口令不能为空');
  if (trimmed === oldPass) return syncNow();

  if (oldPass) {
    // 先把旧空间的东西收到本地，否则换完口令就等于把那份数据留在云上看不见了
    await syncNow({ force: false });
  }
  const oldSpaceId = oldPass ? await spaceIdOf(oldPass) : '';
  lsSet(LS_PASS, trimmed);
  await resetSyncState();
  const status = await syncNow({ pull: true });
  if (opts.deleteOld && oldSpaceId) {
    try {
      await callSync(oldSpaceId, { method: 'DELETE' });
    } catch {
      /* 旧空间没删掉不影响新空间可用性，最多是云上多一份快照 */
    }
  }
  return status;
}

/**
 * 关闭同步：只抹掉本机口令与同步游标，云上那份快照原样留着
 * （换设备/重新填回口令还能拉回来；要连云上那份一起抹，用 changePassphrase 的「删旧空间」）。
 */
export async function clearPassphrase(): Promise<SyncStatus> {
  lsSet(LS_PASS, null);
  await resetSyncState();
  return publish({ configured: false, running: false, ok: false, spaceId: '', rev: 0, detail: '已关闭同步，数据只在本浏览器' });
}

