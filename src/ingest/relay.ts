/**
 * 抓取中转的浏览器侧入口（§4.5）。
 * 逻辑与传输都在云上：node-functions/api/fetch.ts（内部 import server/ 那套 relayCore/relayNode）。
 * 地址不再可配：中转函数与静态站同源，写死相对路径就是开发和线上的唯一正确写法；
 * 本机 dev 没有这个路径（vite 不代理），探活灯会是红的，自动降级到备用通道。
 */

/** 中转函数的路由路径（与 node-functions/api/fetch.ts 同名） */
export const RELAY_FETCH_PATH = '/api/fetch';

/**
 * 抓取专用一跳。必须传带 xsec_token 的原地址（入库才去 token）：
 * 小红书按「请求像不像真实导航」决定给不给正文，浏览器直发必被踢 /login，
 * 所以由中转在浏览器外面代跑（详见 server/relayNode.ts）。
 */
export function relayEndpoint(target: string, format: 'meta' | 'html' = 'meta'): string {
  return `${RELAY_FETCH_PATH}?url=${encodeURIComponent(target)}&format=${format}`;
}

export interface RelayHealth {
  ok: boolean;
  ms: number;
  detail: string;
}

/** 中转自己的信封长什么样：JSON 且带布尔 ok（字段定义见 server/relayCore.ts） */
function isRelayEnvelope(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith('{')) return false;
  try {
    return typeof (JSON.parse(t) as { ok?: unknown }).ok === 'boolean';
  } catch {
    return false;
  }
}

/**
 * 探活判定。不能只看 HTTP 状态码：纯静态托管会把未知路径回退成 index.html 并给 200，
 * 「200 就算活着」会把「这个站点上根本没有中转」报成绿灯（实测：云上导入页显示「应答 200 · 111ms」，回的是首页 HTML）。
 * 只认中转自己的 JSON 信封；400/502 只要信封在就算活（探活地址本来就取不到正文）。
 */
export function relayProbeVerdict(status: number, text: string): { ok: boolean; detail: string } {
  if (!isRelayEnvelope(text)) {
    const why = /^\s*</.test(text)
      ? '回的是网页——这个站点上没有部署中转（路径被回退成了首页）'
      : '回的不是中转的 JSON 信封';
    return { ok: false, detail: `应答 ${status}，但${why}` };
  }
  return { ok: true, detail: `应答 ${status}` };
}

/** 导入页的状态灯：拿一条不存在的白名单地址探活，只看服务是否应答（不消耗真实笔记） */
export async function pingRelay(timeoutMs = 4000): Promise<RelayHealth> {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  try {
    const res = await fetch(relayEndpoint('https://www.xiaohongshu.com/explore/probe', 'meta'), {
      signal: ac.signal,
    });
    const text = await res.text();
    const v = relayProbeVerdict(res.status, text);
    return { ok: v.ok, ms: Date.now() - t0, detail: v.detail };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, detail: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
