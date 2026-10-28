/**
 * EdgeOne Pages 上的中转（§4.5 的云上形态）。
 *
 * 为什么放 node-functions 而不是 edge-functions：
 * edge-functions 是 V8/Service-Worker 运行时，只有 Web `fetch`，而我们已经实测过
 * 「非浏览器 fetch 客户端拿不到小红书正文」——undici 把 header 名全小写、顺序固定，
 * 平台按请求指纹判定，同一组头只回 36KB 空壳。node-functions 是真 Node.js 运行时，
 * 可以直接用 server/relayNode.ts 里那套 `node:https`（实测给 70KB 正文）。
 *
 * 路由：本文件 → `https://<站点>/api/fetch`。函数路由优先于静态资源，
 * 所以不会再被 SPA 回退吞成 index.html（那正是云上那盏假绿灯的成因）。
 *
 * 本地调试：`npm i -g edgeone` 后在项目根执行 `edgeone pages dev`（http://localhost:8088）。
 * 环境变量：RELAY_ALLOWED_ORIGINS（逗号分隔的 Origin 白名单）在 Pages 项目设置里配。
 */
import { handleRelayRequest, relayCorsHeaders } from '../../server/relayCore';
import type { RelayEnv } from '../../server/relayCore';
import { nodePageFetcher } from '../../server/relayNode';

interface FunctionContext {
  request: Request;
  /** Pages 项目的环境变量（EdgeOne 也把它作为第二个入参传给 handler） */
  env?: Record<string, string | undefined>;
}

/** 每次调用都重新读环境变量，冷启动/热复用都能拿到最新配置 */
function readEnv(env: Record<string, string | undefined> | undefined): RelayEnv {
  return {
    allowedOrigins: env?.RELAY_ALLOWED_ORIGINS ?? process.env.RELAY_ALLOWED_ORIGINS ?? '',
    // 云上同样默认不缓存：xsec_token 是访问凭证
    cacheSeconds: Number(env?.RELAY_CACHE_SECONDS ?? process.env.RELAY_CACHE_SECONDS ?? 0),
  };
}

/** 把中转的 HTTP 信封（status/headers/body）转成平台的 Response */
function toResponse(out: { status: number; headers: Record<string, string>; body: string }): Response {
  return new Response(out.body, { status: out.status, headers: out.headers });
}

export async function onRequest(context: FunctionContext): Promise<Response> {
  const { request } = context;
  const env = readEnv(context.env);
  const origin = request.headers.get('origin') ?? undefined;

  // 预检：与正常响应同一套头（同源调用方其实用不上，放开是为允许别的站点直接复用这一跳）
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: relayCorsHeaders(origin, env, request.headers.get('access-control-request-headers') ?? undefined),
    });
  }

  const url = new URL(request.url);
  return toResponse(
    await handleRelayRequest(
      {
        url: url.searchParams.get('url') ?? '',
        format: url.searchParams.get('format') ?? 'meta',
        origin,
      },
      nodePageFetcher,
      env,
    ),
  );
}
