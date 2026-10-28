import type { VideoMeta } from './extract';

/**
 * 取词脚本：中转也失效时的兜底，只读**当前已渲染的笔记页** DOM（不发任何请求）。
 * 为什么不做成批量 fetch：页签里的 fetch 必带 Sec-Fetch-Dest: empty（禁止头，JS 改不了），
 * 且会自动带上登录态 cookie，实测两种 token 都被踢 /login 只回 36KB 壳（反而比不登录还差）；
 * 批量请走 §4.5 的中转服务，或在 App 里粘整段分享文案（自带标题+话题，完全免抓取）。
 */
export function buildPickScript(): string {
  return `(() => {
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').replace(/\\s*[-|｜]\\s*小红书\\s*$/, '').trim();
  const og = (p) => document.querySelector('meta[property="' + p + '"], meta[name="' + p + '"]')?.getAttribute('content') || '';
  const title = clean(document.getElementById('detail-title')?.textContent || og('og:title') || document.title);
  const body = (document.getElementById('detail-desc')?.textContent || og('og:description') || '').trim();
  const tags = [...document.querySelectorAll('#detail-tag-id .tag, a[href*="search_result"]')]
    .map((e) => e.textContent.trim()).filter((t) => t.startsWith('#')).join(' ');
  const out = { url: location.href, title, desc: [body, tags].filter(Boolean).join('\\n'), cover: og('og:image') || undefined };
  if (!title || /你的生活兴趣社区|页面不见了/.test(title)) {
    console.warn('EatMap：当前页签不是笔记详情页（或 token 已失效），请打开笔记后重试');
    return null;
  }
  copy(JSON.stringify(out));
  console.log('EatMap 取词结果（已复制到剪贴板）：\\n' + JSON.stringify(out, null, 2));
  return out;
})()`;
}

type PickedMeta = VideoMeta & { url?: string };

function toPicked(o: Record<string, unknown>): PickedMeta | null {
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  if (!title) return null;
  return {
    title,
    desc: typeof o.desc === 'string' ? o.desc.trim() : '',
    cover: typeof o.cover === 'string' && o.cover ? o.cover : undefined,
    url: typeof o.url === 'string' ? o.url : undefined,
  };
}

/**
 * 解析用户粘回的取词结果，支持单条对象与批量数组两种形态。
 * 容错：允许前后有控制台噪声文字，逐个抠出能解析出 title 的 JSON 对象。
 */
export function parsePickList(text: string): PickedMeta[] {
  const out: PickedMeta[] = [];
  const seen = new Set<string>();
  const add = (o: unknown) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return;
    const m = toPicked(o as Record<string, unknown>);
    const key = m ? `${m.url ?? ''}|${m.title}` : '';
    if (m && !seen.has(key)) {
      seen.add(key);
      out.push(m);
    }
  };
  // 整段就是合法 JSON（对象或数组）时优先整体解析，避免嵌套花括号把正则切坏
  const trimmed = text.trim();
  if (/^[[{]/.test(trimmed)) {
    try {
      const whole = JSON.parse(trimmed) as unknown;
      if (Array.isArray(whole)) {
        whole.forEach(add);
        return out;
      }
      if (whole && typeof whole === 'object') {
        add(whole);
        return out;
      }
    } catch {
      /* 整体解析失败再走逐对象兜底 */
    }
  }
  for (const raw of text.match(/\{[\s\S]*?\}/g) ?? []) {
    try {
      add(JSON.parse(raw) as unknown);
    } catch {
      /* 继续尝试下一个候选 */
    }
  }
  return out;
}

/** 单条形态：取第一条（脚本回传常常只有一条） */
export function parsePickResult(text: string): PickedMeta | null {
  return parsePickList(text)[0] ?? null;
}
