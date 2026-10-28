import { describe, expect, it } from 'vitest';
import { RELAY_DEFAULT_PATH, relayEndpoint, relayProbeVerdict } from './relay';

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

describe('探活判定（不能被 SPA 回退骗成绿灯）', () => {
  it('静态站把 /api/fetch 回退成首页：200 + HTML 算死', () => {
    const v = relayProbeVerdict(200, '<!doctype html><html><head><title>EatMap</title></head></html>');
    expect(v.ok).toBe(false);
    expect(v.detail).toContain('没有部署中转');
  });

  it('EdgeOne 预览域的鉴权页：401 + HTML 算死', () => {
    const v = relayProbeVerdict(401, '<!doctype html><html>Tencent Edgeone 401 : UNAUTHORIZED</html>');
    expect(v.ok).toBe(false);
  });

  it('中转的 502/400 信封仍算活（探活地址本来就取不到正文）', () => {
    expect(relayProbeVerdict(502, '{"ok":false,"platform":"xiaohongshu","status":200}').ok).toBe(true);
    expect(relayProbeVerdict(400, '{"ok":false,"error":"缺少 url 参数"}').ok).toBe(true);
  });

  it('200 但不是信封（空体/垃圾文本）也算死', () => {
    expect(relayProbeVerdict(200, '').ok).toBe(false);
    expect(relayProbeVerdict(200, '{"proxy":"someone else"}').ok).toBe(false);
  });
});
