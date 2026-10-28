import type { Platform } from '../db/schema';

/** 各平台合法链接形态（§4.1），short=短链需先解析重定向 */
const PLATFORM_PATTERNS: { platform: Platform; match: RegExp; short?: RegExp }[] = [
  {
    platform: 'xiaohongshu',
    // /explore/{noteId}、/discovery/item/{noteId}，以及 xhslink 短链
    match: /^https?:\/\/(?:www\.)?(?:xiaohongshu\.com\/(?:explore|discovery\/item)\/|xhslink\.com\/)[\w-]+/i,
    short: /^https?:\/\/xhslink\.com\//i,
  },
  {
    platform: 'wechat',
    // /s/{token} 与 /s?__biz=... 两种图文消息形态
    match: /^https?:\/\/mp\.weixin\.qq\.com\/s(?:\/[\w-]+|\?__biz=)/i,
  },
];

export interface ParsedLink {
  platform: Platform;
  /** 是否短链（需要跟随重定向解析真实地址） */
  isShort: boolean;
}

/** 识别链接平台；不支持的链接返回 null（UI 直接拒绝并提示） */
export function detectPlatform(rawUrl: string): ParsedLink | null {
  const url = rawUrl.trim();
  for (const p of PLATFORM_PATTERNS) {
    if (p.match.test(url)) {
      return { platform: p.platform, isShort: !!p.short?.test(url) };
    }
  }
  return null;
}

/**
 * 入库前 URL 规范化（§4.4 去重的前提）：
 * - 小红书 /explore/{id}：剥掉全部 query（xsec_token 等临时参数带有效期，
 *   不剥会导致同一笔记被误判为不同链接，§10 风险表末行）；
 * - 公众号 /s?__biz=...：仅剔除已知临时参数，保留业务参数；
 * - 其余平台：仅做 trim 与 hash 去除。
 */
export function normalizeUrl(rawUrl: string): string {
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return rawUrl.trim();
  }
  u.hash = '';
  const host = u.hostname.toLowerCase();

  if (host.endsWith('xiaohongshu.com') && /^\/(?:explore|discovery\/item)\//.test(u.pathname)) {
    // 入库专用：query 全是临时参数（含 xsec_token）→ 剥掉才能去重。
    // 切记不要拿这个结果去抓取（裸地址必被踢 404），抓取一律用 splitLinks 的 raw。
    u.search = '';
    u.pathname = u.pathname.replace(/\/$/, '');
    return u.toString();
  }
  if (host === 'mp.weixin.qq.com') {
    for (const k of [...u.searchParams.keys()]) {
      if (['tempkey', 'sharer', 'sharettime', 'chksm', 'scene', 'from'].includes(k.toLowerCase())) {
        u.searchParams.delete(k);
      }
    }
    return u.toString();
  }
  return u.toString();
}

/** 一行链接的两种形态：norm 用于入库去重，raw 原样保留 xsec_token 供抓取放行 */
export interface LinkHit {
  norm: string;
  raw: string;
}

/**
 * 从多行文本提取链接清单（保序去重，按 norm 去重）。
 * 为什么必须留着 raw：小红书用 xsec_token 给分享链放行，
 * 无 token 的裸地址会被 302 到 /404（实测 2026-10，这才是「抓不到」的真因）。
 * 所以去 token 只用于去重存储，抓取一定用 raw。
 */
export function splitLinks(text: string): LinkHit[] {
  const seen = new Set<string>();
  const out: LinkHit[] = [];
  for (const line of text.split(/\r?\n/)) {
    // 支持一行里混有分享文案：提取第一个 http(s) 链接
    const m = line.match(/https?:\/\/\S+/);
    if (!m) continue;
    const raw = m[0];
    const norm = normalizeUrl(raw);
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push({ norm, raw });
    }
  }
  return out;
}

/**
 * 旧签名：返回可直接抓取/入库的地址。实测不兼容之处：去 token 的 norm 只能用于去重，
 * 一旦拿去抓取必被踢到 /404，所以这里返回带 token 的 raw（入库前由调用方再规范化）。
 */
export function splitLines(text: string): string[] {
  return splitLinks(text).map((l) => l.raw);
}

/**
 * 分享链的 xsec_token 来自哪个端（仅作诊断/文案提示用，不影响能不能抓取）：
 * 曾以为 app 端在 web 上强制登录，实测证实为误判 —— pc_share 与 app_share 在中转里都能拿到正文，
 * 真门槛是请求头（见 server/relayCore.ts 顶部）。唯一区别：未登录时浏览器直接导航 app_share 长链会踢 /login。
 */
export function shareSource(rawUrl: string): 'pc' | 'app' | 'unknown' {
  const src = (rawUrl.match(/[?&]xsec_source=([^&#]*)/i)?.[1] ?? '').toLowerCase();
  if (src.startsWith('pc')) return 'pc';
  if (src) return 'app';
  return 'unknown';
}

/**
 * 解析小红书 App 分享的整段文案（免抓取路径，§4.3-4）：
 * 典型格式「标题
 http://xhslink.com/xxx
 正文标签... #小红书」，也兼容 pc 复制的长链接。
 * 规则：首个含链接的行之前为标题，链接行之后（含链接前后的标签）全计为描述。
 * 无链接时返回 null。
 */
export function parseShareText(text: string): { title: string; desc: string; url: string } | null {
  const lines = text.split(/\r?\n/);
  const urlLineIdx = lines.findIndex((l) => /https?:\/\/\S+/.test(l));
  if (urlLineIdx === -1) return null;
  const url = lines[urlLineIdx].match(/https?:\/\/\S+/)![0];
  const head = lines.slice(0, urlLineIdx).join('\n');
  // 标题行尾粘着的 #话题 归入描述（不污染标题，也不丢词）
  const tailMatch = head.match(/\s*([#＃]\S+(?:\s+[#＃]\S+)*)\s*$/);
  const title = head.replace(/\s*[#＃]\S+(?:\s+[#＃]\S+)*\s*$/, '').trim();
  const desc = [
    title === head.trim() ? '' : tailMatch?.[1] ?? '',
    lines[urlLineIdx].replace(/https?:\/\/\S+/, ''),
    ...lines.slice(urlLineIdx + 1),
  ]
    .filter((s) => s.trim())
    .join('\n')
    .trim();
  return { title, desc, url };
}
