/**
 * 中转服务的浏览器侧入口配置（§4.5）。
 * 逻辑与传输都在 server/ 那边，这里只负责「前端该往哪个地址发」：
 * 1. 用户在导入页手填的地址（localStorage）优先 —— 部署到 Vercel 后填一次即可长期用；
 * 2. 构建期变量 VITE_RELAY_URL；
 * 3. 默认 '/api/fetch' —— 开发时由 vite 代理转给本机 127.0.0.1:8787，生产时同源直接命中同名函数。
 */

const LS_KEY = 'eatmap.relayUrl';
export const RELAY_DEFAULT_PATH = '/api/fetch';

/** 去掉结尾多余的 /，避免拼出 //url= */
function trimBase(v: string): string {
  return v.trim().replace(/\/+$/, '');
}

export function relayBaseUrl(): string {
  let stored = '';
  try {
    stored = localStorage.getItem(LS_KEY) ?? '';
  } catch {
    // 非浏览器环境（单测 / SSR 预演）没有 localStorage，直接用默认值
  }
  const configured = stored || (import.meta.env.VITE_RELAY_URL as string | undefined) || RELAY_DEFAULT_PATH;
  return trimBase(configured);
}

export function isRelayOverridden(): boolean {
  try {
    return !!localStorage.getItem(LS_KEY);
  } catch {
    return false;
  }
}

/** 传空串即恢复默认（同源 /api/fetch） */
export function setRelayBaseUrl(v: string): string {
  try {
    if (v.trim()) localStorage.setItem(LS_KEY, trimBase(v));
    else localStorage.removeItem(LS_KEY);
  } catch {
    /* 存不下就算了，本次会话仍用传入值 */
  }
  return relayBaseUrl();
}

/**
 * 抓取专用一跳。必须传带 xsec_token 的原地址（入库才去 token）：
 * 小红书按「请求像不像真实导航」决定给不给正文，浏览器直发必被踢 /login，
 * 所以由中转在浏览器外面代跑（详见 server/relayNode.ts）。
 */
export function relayEndpoint(target: string, format: 'meta' | 'html' = 'meta'): string {
  return `${relayBaseUrl()}?url=${encodeURIComponent(target)}&format=${format}`;
}

export interface RelayHealth {
  ok: boolean;
  ms: number;
  detail: string;
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
    // 400/502 都算「服务活着」：请求进了中转、只是这条探活地址取不到正文
    const alive = res.status === 200 || res.status === 400 || res.status === 502;
    if (!alive) return { ok: false, ms: Date.now() - t0, detail: `HTTP ${res.status} ${text.slice(0, 60)}` };
    return { ok: true, ms: Date.now() - t0, detail: `应答 ${res.status}` };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, detail: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
