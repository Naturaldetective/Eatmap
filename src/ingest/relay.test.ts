import { describe, expect, it } from 'vitest';
import { RELAY_DEFAULT_PATH, relayEndpoint } from './relay';

describe('中转地址拼接（§4.5）', () => {
  it('默认走同源 /api/fetch（开发由 vite 代理转给本机中转）', () => {
    expect(relayEndpoint('https://www.xiaohongshu.com/explore/abc')).toBe(
      `${RELAY_DEFAULT_PATH}?url=${encodeURIComponent('https://www.xiaohongshu.com/explore/abc')}&format=meta`,
    );
  });

  it('token 里的 = 与 & 必须整体编码，否则会被中转当成自己的 query 吃掉', () => {
    const raw = 'https://www.xiaohongshu.com/explore/abc?xsec_token=CB123=&xsec_source=app_share&type=video';
    const ep = relayEndpoint(raw);
    const q = new URLSearchParams(ep.slice(RELAY_DEFAULT_PATH.length + 1));
    expect(q.get('url')).toBe(raw);
    expect(q.get('format')).toBe('meta');
  });

  it('format=html 用于回原文（前端自己跑 extractMeta）', () => {
    expect(relayEndpoint('https://mp.weixin.qq.com/s/abc', 'html')).toContain('format=html');
  });
});
