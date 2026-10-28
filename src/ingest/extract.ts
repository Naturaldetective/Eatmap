import type { Platform } from '../db/schema';

export interface VideoMeta {
  title: string;
  desc: string;
  cover?: string;
}

/** DOMParser 在测试环境不可用，抽象出去以便注入 */
type ParseHtml = (html: string) => Document | null;

const domParse: ParseHtml = (html) => {
  if (typeof DOMParser === 'undefined') return null;
  try {
    return new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return null;
  }
};

function meta(doc: Document, ...selectors: { sel: string; attr: string }[]): string {
  for (const { sel, attr } of selectors) {
    // 先按 property/name 匹配到 meta 标签，再取其 content 值
    const v = doc.querySelector(`meta[${attr}="${sel}"]`)?.getAttribute('content')?.trim();
    if (v) return v;
  }
  return '';
}

/** og/twitter meta 通用提取 */
function fromMeta(doc: Document): VideoMeta {
  return {
    title: meta(doc,
      { sel: 'og:title', attr: 'property' },
      { sel: 'twitter:title', attr: 'name' },
    ),
    desc: meta(doc,
      { sel: 'og:description', attr: 'property' },
      { sel: 'twitter:description', attr: 'name' },
      { sel: 'description', attr: 'name' },
    ),
    cover: meta(doc, { sel: 'og:image', attr: 'property' }) || undefined,
  };
}

/** 压掉换行空白，并剥掉小红书站点后缀（og:title 带「 - 小红书」不能直接入库） */
function cleanTitle(raw: string, platform: Platform): string {
  let t = raw.replace(/\s+/g, ' ').trim();
  if (platform === 'xiaohongshu') t = t.replace(/\s*[-–—|｜]\s*(?:小红书|Xiaohongshu|xhs)\s*$/i, '').trim();
  return t;
}

/** 渲染后 DOM 里的话题（#xxx），拼到描述尾部供城市识别与分类用 */
function xhsTags(doc: Document): string {
  return [...doc.querySelectorAll('#detail-tag-id .tag, a[href*="search_result"]')]
    .map((e) => e.textContent?.trim() ?? '')
    .filter((s) => s.startsWith('#') && s.length > 1)
    .join(' ');
}

/** 正则兜底：从原始 HTML 抠 JSON 字段/JS 变量（DOM 结构缺失或 meta 为空时用） */
function rxFirst(html: string, patterns: RegExp[]): string {
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return '';
}

/**
 * 提取标题/描述/封面（§4.2）。
 * 小红书走中转通道时拿回的是**渲染后的 DOM**，优先读 #detail-title / #detail-desc（比截断的
 * og:description 完整）；直连/原始 HTML 只有 og meta。
 * 未登录且无 token 时返回的是 404/站点页，这类站点级标题视为无效，由调用方走手动降级（§4.3）。
 */
export function extractMeta(html: string, platform: Platform, parse: ParseHtml = domParse): VideoMeta {
  const doc = parse(html);
  let title = '';
  let desc = '';
  let cover: string | undefined;

  if (platform === 'xiaohongshu' && doc) {
    title = cleanTitle(doc.getElementById('detail-title')?.textContent ?? '', platform);
    const body = (doc.getElementById('detail-desc')?.textContent ?? '').trim();
    const tags = xhsTags(doc);
    desc = [body, tags].filter(Boolean).join('\n');
  }

  if (doc) {
    const m = fromMeta(doc);
    if (!title) title = cleanTitle(m.title, platform);
    if (!desc) desc = m.desc;
    cover ??= m.cover;
    if (!title) {
      title = cleanTitle(
        doc.querySelector('#activity-name')?.textContent?.trim()
          ?? doc.title?.trim()
          ?? '',
        platform,
      );
    }
    if (!desc) {
      desc = doc.getElementById('js_content')?.textContent?.trim().slice(0, 300) ?? '';
    }
  }

  if (platform === 'xiaohongshu') {
    // __INITIAL_STATE__ 里的 noteData / 页面 description 兜底
    if (!title) {
      title = cleanTitle(rxFirst(html, [
        /"title"\s*:\s*"([^"]{2,120})"/,
        /<title>([^<]{2,120})-小红书<\/title>/,
      ]), platform);
    }
    if (!desc) desc = rxFirst(html, [/"desc(?:ription)?"\s*:\s*"([^"]{2,500})"/]);
    // 站点级通用标题 / 无 token 被踢到 404 = 没拿到笔记本体，判定失败
    if (/^(小红书|xiaohongshu)/i.test(title) || title.includes('你的生活兴趣社区')) {
      return { title: '', desc: '' };
    }
  } else {
    if (!title) title = rxFirst(html, [/var msg_title\s*=\s*'([^']{2,120})'/, /<title>([^<]{2,120})<\/title>/]);
    if (!desc) desc = rxFirst(html, [/var msg_desc(?:ription)?\s*=\s*'([^']{2,500})'/]);
    if (/^微信公众平台$/.test(title)) return { title: '', desc: '' };
  }

  // 通用失败页（代理异常/风控跳转/无 token 的 404）
  if (/验证|安全检测|环境异常|页面不见了|内容不存在|已被删除/.test(title)) return { title: '', desc: '' };

  return { title, desc, cover };
}

/** 提取结果是否有效（至少要有标题才能入库） */
export function hasUsableMeta(m: VideoMeta): boolean {
  return m.title.length > 0;
}
