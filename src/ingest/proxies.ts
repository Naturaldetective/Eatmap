import { relayEndpoint } from './relay';

/**
 * 抓取通道配置（§4.3 / §4.5）：可增删排序，fetch.ts 按顺序降级尝试。
 * to(target) 统一抽象「怎么把目标地址变成可请求的地址」；
 * 部分通道要额外请求头（r.jina.ai 要 x-return-format）与更长超时；
 * metaJson 标记「这一跳回来的已是结构化 JSON」，fetch.ts 不再走 HTML 提取。
 */
export interface CorsProxy {
  name: string;
  to: (target: string) => string;
  headers?: Record<string, string>;
  /** 单跳超时；不给则用 FETCH_TIMEOUT */
  timeoutMs?: number;
  /** 通道直接回 meta JSON（自托管中转），无需前端再提取 HTML */
  metaJson?: boolean;
}

export const CORS_PROXIES: CorsProxy[] = [
  {
    name: '中转服务',
    // 站点自己的函数（同源 /api/fetch，云上 node-functions 提供）：
    // 在浏览器外面把「真实导航」那副头凑齐，实测 app_share 长链也能拿到全文 + 真封面
    to: (t) => relayEndpoint(t, 'meta'),
    metaJson: true,
    timeoutMs: 15000,
  },
  {
    name: 'r.jina.ai',
    // 无头浏览器渲染后回传 DOM（含 #detail-title / #detail-desc），CORS 开放，境内可达（实测 1~3s）
    to: (t) => `https://r.jina.ai/${t}`,
    headers: { 'x-return-format': 'html' },
    timeoutMs: 15000,
  },
  {
    name: 'allorigins',
    // raw 端点返回原始字节流，跟随重定向 → 短链也能拿到最终页面
    to: (t) => `https://api.allorigins.win/raw?url=${encodeURIComponent(t)}`,
  },
  {
    name: 'codetabs',
    to: (t) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(t)}`,
  },
];

// 实测更正（2026-10，逐条推翻了 M6 与本会话中途的两个结论）：
// 1. 「小红书必须登录 cookie」是错的。真门槛是请求像不像真实导航：必须带 UA + Accept: text/html
//    + Accept-Language，且不能带 Sec-Fetch-Dest: empty（浏览器 fetch 必带、又是禁止头），
//    所以浏览器里哪怕同源 fetch 也只能拿到 /login 空壳 —— 这一跳只能在浏览器外面发。
// 2. 「app_share 长链强制登录、任何中转都拿不到」也是错的：pc_share / app_share 一视同仁，
//    差的只是那几个头（Node 的 global fetch 也不行：undici 把头名全小写，指纹不像浏览器）。
// 3. 公共代理大多死在第 2 条而不是 CORS：allorigins 对小红书直接 408、codetabs 境内不可达
//    （两条保留作公众号兜底）；r.jina.ai 可用但是第三方额度（匿名约 20 次/分钟）。
// 通道现状：首位自托管中转（§4.5）→ r.jina.ai → 公共代理；全挂时 UI 仍引导「分享文案 / 取词脚本」。

/** 单跳超时（ms），超时即切换下一个通道 */
export const FETCH_TIMEOUT = 8000;

/**
 * 批量导入节流（§10）。走自己的中转时不卡第三方额度，1.2s 只为了不把目标站打出风控；
 * 降级到 r.jina.ai 时被限流会直接失败并落到下一条通道，不在这里重试。
 */
export const RATE_LIMIT_MS = 1200;
