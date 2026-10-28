/**
 * 本机 dev 的同步存储（SyncStore 的文件实现）。
 *
 * 存在的理由只有一个：让「本地开发」和「云上跑」用的是**同一份 syncCore 判定**，
 * 不会出现本地测过、推上去行为不一样。云上是 Blob（node-functions/api/data.ts），
 * 本机就是 .eatmap-sync/ 下的一个 json 文件。
 *
 * 数据落在仓库内且已被 .gitignore 忽略，不会误提交。
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { SyncStore } from './syncCore';

/** key 里带目录层级，写入前必须确认没跑出 base 之外（防 ../ 穿越） */
function safePath(base: string, key: string): string {
  const p = resolve(join(base, key));
  if (p !== resolve(base) && !p.startsWith(resolve(base) + sep)) {
    throw new Error(`非法的存储 key：${key}`);
  }
  return p;
}

export function fileStore(base = '.eatmap-sync'): SyncStore {
  const root = resolve(base);
  return {
    async get(key) {
      try {
        return await readFile(safePath(root, key), 'utf8');
      } catch {
        return null;
      }
    },
    async set(key, value) {
      const p = safePath(root, key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, value, 'utf8');
    },
    async delete(key) {
      await rm(safePath(root, key), { force: true });
    },
  };
}
