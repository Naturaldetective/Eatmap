/**
 * EdgeOne Pages 上的云端同步接口（§4.6）。
 *
 * 存储用平台的 Blob 存储（@edgeone/pages-blob）：首次 getStore('eatmap') 平台会自动建命名空间，
 * 零控制台配置，1GB 免费、单对象 25MB —— 我们整个空间就一个 state.json，绰绰有余。
 * 平台没有托管数据库，Blob 的 key 前缀就是我们的「表」（spaces/<spaceId>/state.json）。
 *
 * 与中转同一个结论：放 node-functions 而不是 edge-functions ——
 * 这里要 import 的 SDK 走 npm 依赖，且逻辑与前端共用一套约定：
 * 判定全在 server/syncCore.ts（纯逻辑、可单测），本文件只做平台适配。
 *
 * 路由：本文件 → `https://<站点>/api/data`。
 * 本地调试：`edgeone pages dev`（http://localhost:8088）；`npm run dev` 本机没有这个路径，
 * 同步卡片会报「同步接口回的是网页」，属预期（完整链路只能在云上验）。
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
