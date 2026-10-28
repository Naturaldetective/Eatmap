/**
 * 传输层（node:https）。唯一被验证可用的实现 —— 不要改成 global fetch：
 * 同一 URL 同一组头实测 undici 被踢 /login（36KB 壳）、node:https 拿到 200 / 70KB 正文，
 * 差别在请求指纹（undici 把 header 名统一小写、顺序固定，不像浏览器）。
 * node:https 原样保留 RELAY_HEADERS 里的大写头名，指纹与真实导航一致。
 *
 * 只做三件事：按白名单跟随重定向（防 SSRF）、限时、限体积。
 */
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { createGunzip, createInflate } from 'node:zlib';
import type { FetchedPage, FetchOptions, PageFetcher } from './relayCore.ts';
import { platformOfTarget, RelayError } from './relayCore.ts';

const MAX_HOPS = 5;

interface RawPage {
  status: number;
  location: string | null;
  body: string;
}

function once(url: URL, headers: Record<string, string>, timeoutMs: number, maxBytes: number): Promise<RawPage> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'http:' ? httpRequest : httpsRequest;
    const req = mod(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'http:' ? 80 : 443),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const encoding = (res.headers['content-encoding'] || '').toLowerCase();
        let src: NodeJS.ReadableStream = res;
        // 我们不发 Accept-Encoding，正常拿 identity；万一对方强行压了也要能解
        if (encoding === 'gzip') src = res.pipe(createGunzip());
        else if (encoding === 'deflate') src = res.pipe(createInflate());
        src.on('data', (b: Buffer) => {
          size += b.length;
          chunks.push(b);
          if (size > maxBytes) req.destroy(new Error('响应超过体积上限'));
        });
        src.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location ?? null,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        src.on('error', reject);
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`超时 ${timeoutMs}ms`)));
    req.on('error', reject);
    req.end();
  });
}

/** 跟随重定向；每一跳都重新校验白名单，防止被引导到内网/任意站点（SSRF） */
export const nodePageFetcher: PageFetcher = async (rawUrl, opts: FetchOptions): Promise<FetchedPage> => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new RelayError('地址无法解析');
  }
  let hops = 0;
  let last: RawPage | null = null;
  while (hops++ <= MAX_HOPS) {
    if (!platformOfTarget(url.toString())) {
      throw new RelayError(`跳转到白名单外地址，已中止：${url.host}`);
    }
    last = await once(url, opts.headers, opts.timeoutMs, opts.maxBytes);
    if (last.status >= 400) throw new RelayError(`目标站返回 HTTP ${last.status}`);
    if (last.location && last.status >= 300 && last.status < 400) {
      url = new URL(last.location, url);
      continue;
    }
    const html = last.body.slice(0, opts.maxBytes);
    const platform = platformOfTarget(url.toString());
    if (!platform) throw new RelayError('不支持的域名（中转只服务小红书 / 微信公众号）');
    return { html, status: last.status, finalUrl: url.toString(), platform };
  }
  throw new RelayError(`重定向超过 ${MAX_HOPS} 跳`);
};
