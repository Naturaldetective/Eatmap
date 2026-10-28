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
 * 探活判定。不能只看 HTTP 状态码：纯静态托管（EdgeOne Pages / Vercel 的 SPA rewrite）
 * 会把任意未知路径回退成 index.html 并给 200，「200 就算活着」会把
 * 「这个站点上根本没有中转」报成绿灯（实测：云上导入页显示「应答 200 · 111ms」，回的是首页 HTML）。
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
