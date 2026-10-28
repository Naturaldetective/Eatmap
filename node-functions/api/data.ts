/**
 * EdgeOne Pages 上的云端同步接口（§4.6）。
 *
 * 存储用平台的 Blob 存储（@edgeone/pages-blob）：首次 getStore('eatmap') 平台会自动建命名空间，
 * 零控制台配置，1GB 免费、单对象 25MB —— 我们整个空间就一个 state.json，绰绰有余。
 * 平台没有托管数据库，Blob 的 key 前缀就是我们的「表」（spaces/<spaceId>/state.json）。
 *
 * 与中转同一个结论：放 node-functions 而不是 edge-functions ——
 * 这里要 import 的 SDK 走 npm 依赖，且逻辑与本机 dev（scripts/relay.mjs 的 /api/data）
 * 共用 server/syncCore.ts，零副本。
 *
 * 路由：本文件 → `https://<站点>/api/data`。
 * 本地调试：`edgeone pages dev`（http://localhost:8088）；日常开发其实用 `npm run relay`
 * 那条路就够了（同一套 core，行为一致）。
 */
import { getStore } from '@edgeone/pages-blob';
import { handleSyncRequest, SYNC_BLOB_STORE } from '../../server/syncCore';
import type { SyncStore } from '../../server/syncCore';

/** Blob → SyncStore：读一律 strong（读己之写），否则 rev 比对会拿 60s 前的旧值误判冲突 */
function blobStore(): SyncStore {
  const store = getStore(SYNC_BLOB_STORE);
  return {
    get: (key) => store.get(key, { type: 'text', consistency: 'strong' }) as Promise<string | null>,
    set: (key, value) => store.set(key, value, { cacheControl: 'no-store' }),
    delete: (key) => store.delete(key),
  };
}

interface FunctionContext {
  request: Request;
  env?: Record<string, string | undefined>;
}

export async function onRequest(context: FunctionContext): Promise<Response> {
  const { request } = context;
  const body = request.method === 'PUT' ? await request.text() : undefined;
  const out = await handleSyncRequest(
    {
      method: request.method,
      url: request.url,
      body,
      origin: request.headers.get('origin') ?? undefined,
    },
    blobStore(),
    {
      allowedOrigins: context.env?.RELAY_ALLOWED_ORIGINS ?? process.env.RELAY_ALLOWED_ORIGINS ?? '',
    },
  );
  return new Response(out.body || null, { status: out.status, headers: out.headers });
}
