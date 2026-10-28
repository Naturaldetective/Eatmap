import { CORS_PROXIES, FETCH_TIMEOUT } from './proxies';
import type { CorsProxy } from './proxies';
import type { VideoMeta } from './extract';

interface FetchHtmlResult {
  /** metaJson 通道不回 HTML（为空串） */
  html: string;
  /** 实际成功的通道名；'direct' 或代理名（§4.3 降级链） */
  via: string;
  /** 中转已解析好的结构化元数据，有它就不必再跑 extractMeta */
  meta?: VideoMeta;
}

class AllChannelsFailedError extends Error {
  constructor(public attempts: { via: string; error: string }[]) {
    super('所有抓取通道均失败：' + attempts.map((a) => `${a.via}(${a.error})`).join('、'));
    this.name = 'AllChannelsFailedError';
  }
}

/** 带超时的 fetch（AbortSignal，每通道各自的上限） */
async function fetchWithTimeout(
  url: string,
  ms: number,
  headers?: Record<string, string>,
): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new DOMException('timeout', 'TimeoutError')), ms);
  try {
    return await fetch(url, { signal: ac.signal, redirect: 'follow', ...(headers ? { headers } : {}) });
  } finally {
    clearTimeout(timer);
  }
}

type Channel = {
  name: string;
  build: (target: string) => string;
  headers?: Record<string, string>;
  timeoutMs: number;
  metaJson?: boolean;
};

/** 中转回传的 JSON 信封（字段定义见 server/relayCore.ts 的 RelayPayload） */
interface RelayJson {
  ok?: boolean;
  error?: string;
  meta?: { title?: string; desc?: string; cover?: string };
}

/** metaJson 通道：拿不到可用标题就当这一跳失败，继续降级 */
function toVideoMeta(text: string): VideoMeta {
  let j: RelayJson;
  try {
    j = JSON.parse(text) as RelayJson;
  } catch {
    // 静态托管站没部署中转时，/api/fetch 会被 SPA 回退成 index.html（还带 200）；
    // 不区分开的话，降级原因会被记成一句看不懂的 JSON 解析错。
    throw new Error(
      /^\s*</.test(text)
        ? '这个站点上没有中转（/api/fetch 被回退成了网页）'
        : '中转响应不是合法 JSON',
    );
  }
  if (!j.ok || !j.meta?.title) throw new Error(j.error || '中转未返回正文');
  return { title: j.meta.title, desc: j.meta.desc ?? '', ...(j.meta.cover ? { cover: j.meta.cover } : {}) };
}

/**
 * 抓取管线（§4.3 / §4.5）：直连 → 中转通道依次尝试，任一通道拿到可用结果即返回。
 * 注意：小红书必须传带 xsec_token 的原地址（无 token 会被 302 到 /404），
 * 调用方负责把 raw 地址传进来（入库才去 token）。
 * 风控/登录页也回 HTML：这里只保证拿到文本，内容有效性由 extract.ts 判定
 * （提不到 title/desc 视为失败，继续降级到手动录入）。
 */
export async function fetchPageHtml(target: string): Promise<FetchHtmlResult> {
  const channels: Channel[] = [
    { name: 'direct', build: (t) => t, timeoutMs: FETCH_TIMEOUT },
    ...CORS_PROXIES.map((p: CorsProxy) => ({
      name: p.name,
      build: p.to,
      headers: p.headers,
      timeoutMs: p.timeoutMs ?? FETCH_TIMEOUT,
      metaJson: p.metaJson,
    })),
  ];
  const attempts: { via: string; error: string }[] = [];
  for (const ch of channels) {
    try {
      const res = await fetchWithTimeout(ch.build(target), ch.timeoutMs, ch.headers);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (ch.metaJson) return { html: '', via: ch.name, meta: toVideoMeta(text) };
      if (text.trim().length < 200) throw new Error('响应过短，可能是拦截页');
      return { html: text, via: ch.name };
    } catch (e) {
      attempts.push({ via: ch.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  throw new AllChannelsFailedError(attempts);
}
