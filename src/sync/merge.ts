/**
 * 本地与云端快照的合并规则（§4.6）。纯函数、不碰 IndexedDB，所以能单测。
 *
 * 类型是 server/syncCore.ts 里 CloudState 的**前端镜像**（故意不 import：
 * 那边依赖 node:crypto，跨目录 import 会把 Node 代码拖进浏览器包）。
 * 改字段要两边一起改，云端只做「是不是合法快照」的粗校验，不参与合并判定。
 *
 * 三条硬规则：
 * 1. 身份按 url 归并 —— 两台设备各自粘同一条链接会生成不同 id，不按时序去重就是重复气泡；
 * 2. 同一条记录谁的时间新谁赢（updatedAt，老数据没有就退回 parsedAt）；
 * 3. 删除按 id 压制 —— 只有 tombstone 时间 >= 该记录时间才判删，
 *    否则「设备 A 刚改完、设备 B 早已删过」这种交错会把新数据吃掉。
 */
import type { Tombstone, VideoRecord } from '../db/schema';

export interface CloudSnapshot {
  app: 'eatmap';
  version: number;
  rev: number;
  updatedAt: number;
  videos: VideoRecord[];
  deleted: Record<string, number>;
}

export interface MergeInput {
  local: VideoRecord[];
  /** 云端快照；null = 空空间（首次上传） */
  remote: CloudSnapshot | null;
  /** 本机已有的删除标记 */
  localDeleted: Tombstone[];
}

export interface MergeResult {
  /** 要写进本地的（新增 + 覆盖） */
  upsert: VideoRecord[];
  /** 本地要删掉的 id（被云端更新删除压制的、以及同 url 的重复旧 id） */
  dropIds: string[];
  /** 合并后的完整删除标记（要落库，也要随快照推上去） */
  tombstones: Tombstone[];
  stats: { added: number; updated: number; removed: number; deduped: number };
}

/** 记录的时间戳：老数据没 updatedAt 就用 parsedAt，别让它们永远判负 */
export function stampOf(v: Pick<VideoRecord, 'parsedAt' | 'updatedAt'>): number {
  return v.updatedAt ?? v.parsedAt ?? 0;
}

export function mergeState(input: MergeInput): MergeResult {
  const { local, remote, localDeleted } = input;
  const remoteVideos = remote?.videos ?? [];
  const remoteDeleted = remote?.deleted ?? {};

  // 删除标记先并起来：id → {deletedAt, url}，url 只有本地 tombstone 才有
  const deleted = new Map<string, Tombstone>();
  for (const t of localDeleted) deleted.set(t.id, { ...t });
  for (const [id, at] of Object.entries(remoteDeleted)) {
    if (!deleted.has(id)) deleted.set(id, { id, url: '', deletedAt: at });
  }
  const deletedAt = (id: string): number => deleted.get(id)?.deletedAt ?? 0;

  // 第一步按 id 合流：同一条记录本地与云端各有一份，取时间新的
  // （不能直接当成“重复”丢进 losers —— 同 id 的“败者”与“赢家”是一个人，
  // 给它下删除标记等于自己删自己）
  const byId = new Map<string, { v: VideoRecord; fromRemote: boolean }>();
  for (const v of local) byId.set(v.id, { v, fromRemote: false });
  for (const v of remoteVideos) {
    const cur = byId.get(v.id);
    if (!cur || stampOf(v) > stampOf(cur.v)) byId.set(v.id, { v, fromRemote: true });
  }

  // 第二步按 url 归并：不同 id 撞同一 url 才是真重复（两台设备各自粘了同一条链接）
  const byUrl = new Map<string, { winner: { v: VideoRecord; fromRemote: boolean }; losers: VideoRecord[] }>();
  for (const { v, fromRemote } of byId.values()) {
    const cur = byUrl.get(v.url);
    if (!cur) {
      byUrl.set(v.url, { winner: { v, fromRemote }, losers: [] });
      continue;
    }
    const stamp = stampOf(v);
    // 同分时本地赢：避免每次拉取都把本地记录重写一遍
    const win = stamp > stampOf(cur.winner.v) || (stamp === stampOf(cur.winner.v) && !fromRemote);
    if (win) {
      cur.losers.push(cur.winner.v);
      cur.winner = { v, fromRemote };
    } else {
      cur.losers.push(v);
    }
  }

  const localById = new Map(local.map((v) => [v.id, v]));
  const upsert: VideoRecord[] = [];
  const dropSet = new Set<string>();
  let deduped = 0;

  for (const [, group] of byUrl) {
    const { winner, losers } = group;
    const w = winner.v;
    // 同一条 url 上的重复 id：全部落删除标记，否则老快照还会把它们带回来
    for (const l of losers) {
      deduped++;
      if (!deleted.has(l.id)) {
        deleted.set(l.id, { id: l.id, url: l.url, deletedAt: Math.max(stampOf(l), stampOf(w)) });
      }
      if (localById.has(l.id)) dropSet.add(l.id);
    }
    // 赢家自己已被删（按 id 压制）：本地有就删掉，不往本地写
    if (deletedAt(w.id) > 0 && deletedAt(w.id) >= stampOf(w)) {
      if (localById.has(w.id)) dropSet.add(w.id);
      continue;
    }
    const mine = localById.get(w.id);
    if (!mine) {
      upsert.push(w);
      continue;
    }
    // 本地已有同 id：只有云端更新才覆盖（同 url 不同 id 的情况上面已按赢家处理）
    if (winner.fromRemote && stampOf(w) > stampOf(mine)) upsert.push(w);
  }

  // 云端带来的删除标记（url 未知也要留）：滤掉的话下一次推送就把别人的删除抹了，
  // 第三台设备再拉一次就集体复活 —— 标记只多不少。
  const tombstones = [...deleted.values()];
  // 同 url 不同 id 时，赢家与败者可能指向同一个 id（本地=云端），Set 已经天然去重
  const dropIds = [...dropSet].filter((id) => !upsert.some((v) => v.id === id));

  const stats = {
    added: upsert.filter((v) => !localById.has(v.id)).length,
    updated: upsert.filter((v) => localById.has(v.id)).length,
    removed: dropIds.length,
    deduped,
  };
  return { upsert, dropIds, tombstones, stats };
}

/** 把本地全量 + 删除标记打包成要 PUT 的快照（rev 由服务端定，这里给 0 占位） */
export function buildSnapshot(videos: VideoRecord[], tombstones: Tombstone[]): Omit<CloudSnapshot, 'rev'> {
  const deleted: Record<string, number> = {};
  for (const t of tombstones) deleted[t.id] = t.deletedAt;
  return { app: 'eatmap', version: 1, updatedAt: Date.now(), videos, deleted };
}

/** 数据指纹：条数 + 最新时间，变了才值得推一趟（比全量 JSON 比对便宜得多） */
export function fingerprintOf(videos: VideoRecord[], tombstones: Tombstone[]): string {
  let max = 0;
  for (const v of videos) max = Math.max(max, stampOf(v));
  for (const t of tombstones) max = Math.max(max, t.deletedAt);
  return `${videos.length}:${tombstones.length}:${max}`;
}

