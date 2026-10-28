/**
 * 自托管中转服务的核心逻辑（§4.5）。零依赖、无 DOM、纯字符串/JSON 处理：
 * 本机入口在 scripts/relay.mjs，传输层在 server/relayNode.ts（两者都必须用 node:https，见下）。
 *
 * 两道关卡都必须解掉，缺一不可（2026-10 逐条实测）：
 * 1. CORS：浏览器里的 JS 读不到跨域响应体。Node 发请求没有浏览器参与、不受 CORS 约束，
 *    再由本服务写 Access-Control-Allow-Origin，前端才允许读 —— 解决靠的是这个响应头，不是换个端口。
 * 2. 平台反脚本判定：小红书按「请求像不像真实导航」决定给不给正文。
 *    - 浏览器 fetch（哪怕在同源页签里、哪怕手动补 Accept: text/html）→ 302 到 /login，只回 48KB 空壳，
 *      因为 fetch 必带 Sec-Fetch-Dest: empty，而它是禁止头、JS 改不了；
 *    - 必须凑齐 UA + Accept: text/html + Accept-Language 三个头（少 Accept-Language 也会被踢）；
 *    - Node 的 global fetch（undici）照样被踢：它把 header 名统一小写、顺序固定，指纹不是浏览器。
 *      同一 URL 同一组头实测：undici → /login 36KB；node:https（保留 header 原生大小写）→ 200 70KB 正文。
 *
 * 自己养这一跳的额外收益：不受第三方额度限制，并能直接解析 __INITIAL_STATE__ 拿到
 * 未截断正文、结构化话题、真封面（og:description 带「…」、og:image 是站点 logo 而非笔记封面）。
 */

export type RelayPlatform = 'xiaohongshu' | 'wechat';

export interface RelayMeta {
  title: string;
  desc: string;
  cover?: string;
}

export interface RelayPayload {
  ok: boolean;
  platform?: RelayPlatform;
  /** 目标站返回的 HTTP 状态 */
  status?: number;
  /** 跟随重定向后的最终地址（短链会归一到笔记真实地址） */
  finalUrl?: string;
  meta?: RelayMeta;
  /** format=html 时回传原始 HTML，让调用方自己跑 extractMeta */
  html?: string;
  error?: string;
}

/** 白名单：只代跑这两个平台，避免自己的服务沦为任意 URL 的开放代理 */
const HOST_PLATFORM: Record<string, RelayPlatform> = {
  'www.xiaohongshu.com': 'xiaohongshu',
  'xiaohongshu.com': 'xiaohongshu',
  'm.xiaohongshu.com': 'xiaohongshu',
  'xhslink.com': 'xiaohongshu',
  'www.xhslink.com': 'xiaohongshu',
  'mp.weixin.qq.com': 'wechat',
};

export const RELAY_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** 三个头缺一不可：少了 Accept 或少 Accept-Language 都会被当成脚本请求踢去 /login */
export const RELAY_HEADERS: Record<string, string> = {
  'User-Agent': RELAY_UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

export const RELAY_TIMEOUT_MS = 12000;
/** 单页体积上限（正文页实测 ~72KB，留足余量防超大页面把服务拖住） */
export const RELAY_MAX_BYTES = 2_000_000;

export class RelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelayError';
  }
}

/** 目标地址是否在白名单内；命中则返回平台 */
export function platformOfTarget(rawUrl: string): RelayPlatform | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return HOST_PLATFORM[u.hostname.toLowerCase()] ?? null;
}

export interface FetchedPage {
  html: string;
  status: number;
  finalUrl: string;
  platform: RelayPlatform;
}

export interface FetchOptions {
  timeoutMs: number;
  maxBytes: number;
  headers: Record<string, string>;
}

/**
 * 传输层注入点：核心逻辑不碰网络，才能被单测确定性地驱动、也才能换实现。
 * 唯一实现是 server/relayNode.ts（node:https）—— 不要换成 global fetch，实测必失败。
 */
export type PageFetcher = (rawUrl: string, opts: FetchOptions) => Promise<FetchedPage>;

/** 校验 + 统一参数的一跳包装 */
export function createRelayFetcher(fetchPage: PageFetcher, opts: { timeoutMs?: number; maxBytes?: number } = {}) {
  const timeoutMs = opts.timeoutMs ?? RELAY_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? RELAY_MAX_BYTES;
  return (rawUrl: string): Promise<FetchedPage> => {
    const platform = platformOfTarget(rawUrl);
    if (!platform) throw new RelayError('不支持的域名（中转只服务小红书 / 微信公众号）');
    return fetchPage(rawUrl, { timeoutMs, maxBytes, headers: RELAY_HEADERS });
  };
}

/* ==================== HTML → meta（无 DOMParser，全靠正则 + JSON） ==================== */

/** __INITIAL_STATE__ 里只取这几个字段，绝不把整包状态回传（里面夹着用户信息与凭证） */
interface XhsNote {
  title?: string;
  desc?: string;
  tagList?: { name?: string }[];
  imageList?: { urlDefault?: string }[];
}

/** 站点级标题 = 没拿到笔记本体（登录壳 / 404 / 风控页），判定为失败 */
export function isSiteLevelTitle(t: string): boolean {
  return (
    !t ||
    /^小红书/i.test(t) ||
    /你的生活兴趣社区|访问的页面不见了|页面不存在/.test(t) ||
    /^微信公众平台$/.test(t) ||
    /验证|安全检测|环境异常|内容不存在|已被删除/.test(t)
  );
}

function unescapeText(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** 原始 HTML 里抠 og/twitter meta（property 与 content 前后顺序两种写法都要顾到） */
export function rxMeta(html: string, prop: string): string {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*?content=["']([^"']*)["']` +
      `|<meta[^>]+content=["']([^"']*)["'][^>]*?(?:property|name)=["']${prop}["']`,
    'i',
  );
  const m = html.match(re);
  return unescapeText((m?.[1] ?? m?.[2] ?? '').replace(/\s+/g, ' '));
}

/**
 * 话题写法归一：正文里是 `#丹东美食[话题]#`，剥掉 `[话题]` 变成 `#丹东美食#`，
 * 再把 tagList 补齐（去重）追加到尾部。为什么要成对的 #：detectCity 的话题抽取正则
 * 要求前后都有 #（§5.1），这样话题命中才按「话题来源」计分（唯一 0.9），
 * 而不是掉进正文来源（上限 0.55、一律标黄）。
 */
export function joinDescWithTags(desc: string, tagList: XhsNote['tagList']): string {
  const body = (desc ?? '').replace(/\[话题\]/g, '').trim();
  const tags = (tagList ?? [])
    .map((t) => (t?.name ?? '').trim())
    .filter((n) => n && !body.includes(`#${n}#`))
    .map((n) => `#${n}#`)
    .join(' ');
  return [body, tags].filter(Boolean).join('\n');
}

/** 抠 __INITIAL_STATE__ 的 JSON（站内把 undefined 直接写进 JSON，得先换成 null 才能 parse） */
export function readInitialState(html: string): unknown {
  const m = html.match(/__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1].replace(/\bundefined\b/g, 'null'));
  } catch {
    return null;
  }
}

function pickXhsNote(state: unknown, rawUrl: string): XhsNote | null {
  const map = (state as { note?: { noteDetailMap?: Record<string, { note?: XhsNote }> } })?.note
    ?.noteDetailMap;
  if (!map) return null;
  const noteId = rawUrl.match(/\/(?:explore|discovery\/item)\/([\w-]+)/)?.[1];
  const byId = noteId ? map[noteId]?.note : undefined;
  if (byId?.title) return byId;
  // 兜底：取第一条有标题的（短链跳转后 noteId 与地址不一致时仍能命中）
  for (const v of Object.values(map)) {
    if (v?.note?.title) return v.note;
  }
  return null;
}

/** 站内 CDN 给的封面是 http://，https 页面里直接挂会被混合内容拦截 */
function normalizeCover(u?: string): string | undefined {
  if (!u) return undefined;
  return u.replace(/^http:\/\//, 'https://');
}

/**
 * 服务端侧提取标题/正文/话题/封面。
 * 小红书优先读 __INITIAL_STATE__（全文 + 结构化话题 + 真封面），退化到 og meta；
 * 公众号只有 og / msg_title 可用。提不出有效标题返回 undefined（由调用方报错给前端）。
 */
export function parseRelayMeta(
  html: string,
  platform: RelayPlatform,
  rawUrl: string,
): RelayMeta | undefined {
  if (platform === 'xiaohongshu') {
    const note = pickXhsNote(readInitialState(html), rawUrl);
    if (note?.title) {
      const cover = normalizeCover(note.imageList?.[0]?.urlDefault) || rxMeta(html, 'og:image');
      return {
        title: note.title.replace(/\s+/g, ' ').trim(),
        desc: joinDescWithTags(note.desc ?? '', note.tagList),
        ...(cover ? { cover } : {}),
      };
    }
  }
  const title = unescapeText(
    rxMeta(html, 'og:title') || rxMeta(html, 'twitter:title') || rxMeta(html, 'description'),
  );
  if (title && !isSiteLevelTitle(title)) {
    const desc = rxMeta(html, 'og:description') || rxMeta(html, 'twitter:description');
    const cover = rxMeta(html, 'og:image');
    return { title, desc, ...(cover ? { cover } : {}) };
  }
  // 公众号兜底：var msg_title='…'
  const wxTitle = html.match(/var msg_title\s*=\s*'([^']{2,120})'/)?.[1]?.trim();
  if (wxTitle && !isSiteLevelTitle(wxTitle)) {
    const cdn = html.match(/var msg_cdn_url\s*=\s*'([^']+)'/)?.[1];
    return {
      title: wxTitle,
      desc: html.match(/var msg_desc(?:ription)?\s*=\s*'([^']{2,500})'/)?.[1]?.trim() ?? '',
      ...(cdn ? { cover: cdn } : {}),
    };
  }
  return undefined;
}

/* ==================== HTTP 信封（各入口共用） ==================== */

export interface RelayHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface RelayRequestInput {
  /** 目标地址（原样带 xsec_token） */
  url?: string;
  /** meta（默认，回结构化数据）| html（回原文，供前端 extractMeta） */
  format?: string;
  /** 请求方的 Origin，用于决定 CORS 回哪个值 */
  origin?: string;
}

export interface RelayEnv {
  /** 逗号分隔的 Origin 白名单；配了就只回这些源（不配则回 *，本机自用足够） */
  allowedOrigins?: string;
  /** >0 时允许中间层缓存。默认 0：分享 token 是访问凭证，绝不能被缓存 */
  cacheSeconds?: number;
}

/**
 * CORS 头（预检与正常响应共用）。
 * `Access-Control-Allow-Private-Network` 是给「云上 https 页面直接调本机 127.0.0.1」那条路用的：
 * Chrome 的 PNA（私有网络访问）会先预检，响应不回这个头就被拦在浏览器里，
 * 不配也不影响本机同源（vite 代理）那条路。
 */
export function relayCorsHeaders(
  origin: string | undefined,
  env: RelayEnv,
  requestHeaders?: string,
): Record<string, string> {
  const list = (env.allowedOrigins ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allow = list.length
    ? origin && list.includes(origin)
      ? origin
      : list[0]
    : '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': requestHeaders || 'content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Private-Network': 'true',
    // 回 * 时不随 Origin 变，不能发空的 Vary（会让中间层以为要按源分开存）
    ...(list.length ? { Vary: 'Origin' } : {}),
  };
}

function corsHeaders(origin: string | undefined, env: RelayEnv): Record<string, string> {
  return relayCorsHeaders(origin, env);
}

/** 一次请求的全部逻辑：校验 → 代跑 → 解析 → 打包成 HTTP 响应 */
export async function handleRelayRequest(
  input: RelayRequestInput,
  fetchPage: PageFetcher,
  env: RelayEnv = {},
): Promise<RelayHttpResponse> {
  const headers = {
    ...corsHeaders(input.origin, env),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control':
      (env.cacheSeconds ?? 0) > 0 ? `public, max-age=${env.cacheSeconds}` : 'no-store',
  };
  const json = (status: number, payload: RelayPayload): RelayHttpResponse => ({
    status,
    headers,
    body: JSON.stringify(payload),
  });

  const target = (input.url ?? '').trim();
  if (!target) return json(400, { ok: false, error: '缺少 url 参数' });
  if (!platformOfTarget(target)) {
    return json(400, { ok: false, error: '不支持的域名（中转只服务小红书 / 微信公众号）' });
  }
  const wantHtml = input.format === 'html';
  try {
    const page = await createRelayFetcher(fetchPage)(target);
    const meta = wantHtml ? undefined : parseRelayMeta(page.html, page.platform, page.finalUrl);
    if (!wantHtml && !meta) {
      return json(502, {
        ok: false,
        platform: page.platform,
        status: page.status,
        finalUrl: page.finalUrl,
        error: '已按真实导航请求，目标站仍只回站点壳（token 过期或被风控）',
      });
    }
    return json(200, {
      ok: true,
      platform: page.platform,
      status: page.status,
      finalUrl: page.finalUrl,
      ...(meta ? { meta } : {}),
      ...(wantHtml ? { html: page.html } : {}),
    });
  } catch (e) {
    return json(502, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}
