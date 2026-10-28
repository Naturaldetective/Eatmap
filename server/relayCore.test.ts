import { describe, expect, it } from 'vitest';
import {
  handleRelayRequest,
  isSiteLevelTitle,
  joinDescWithTags,
  parseRelayMeta,
  platformOfTarget,
  readInitialState,
  relayCorsHeaders,
  RELAY_HEADERS,
  rxMeta,
} from './relayCore';
import type { FetchedPage, PageFetcher } from './relayCore';

/** 笔记正文页的最小仿真：__INITIAL_STATE__ 里带未截断正文（含 [话题] 写法）与真封面 */
const NOTE_HTML = `<html><head>
<meta property="og:title" content="丹东只有草莓？最值得吃的是大海鲜和小黄牛 - 小红书">
<meta name="twitter:description" content="#趁开海吃口鲜 …">
</head><body><script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"6aad":{"note":{"title":"丹东只有草莓？最值得吃的是大海鲜和小黄牛","desc":"#趁开海吃口鲜[话题]# 丹东是整个北方的“美食孤岛”\\n#丹东美食[话题]#","tagList":[{"name":"趁开海吃口鲜"},{"name":"丹东美食"},{"name":"开海季"}],"imageList":[{"urlDefault":"http://sns-webpic-qc.xhscdn.com/abc/cover!nd_dft_jpg_3"}]}}}},"user":undefined}</script></body></html>`;

/** 未登录/被风控时的站点壳：没有笔记数据，只有站点级标题 */
const SHELL_HTML = '<html><head><meta property="og:title" content="小红书 - 你的生活兴趣社区"></head><body></body></html>';

const NOTE_URL = 'https://www.xiaohongshu.com/explore/6aad?xsec_token=ABC&xsec_source=app_share';

describe('域名白名单（防止自己的服务沦为开放代理 / SSRF）', () => {
  it('只放行小红书与公众号', () => {
    expect(platformOfTarget('https://www.xiaohongshu.com/explore/abc')).toBe('xiaohongshu');
    expect(platformOfTarget('https://xhslink.com/aBc')).toBe('xiaohongshu');
    expect(platformOfTarget('https://mp.weixin.qq.com/s/abc')).toBe('wechat');
  });
  it('其他域名与非法地址一律拒绝', () => {
    expect(platformOfTarget('https://example.com/explore/abc')).toBeNull();
    expect(platformOfTarget('http://127.0.0.1:8080/admin')).toBeNull();
    expect(platformOfTarget('not-a-url')).toBeNull();
  });
});

describe('请求头（实测门槛：少了哪一个都会被踢去 /login）', () => {
  it('必须同时具备 UA + Accept: text/html + Accept-Language', () => {
    expect(RELAY_HEADERS.Accept).toContain('text/html');
    expect(RELAY_HEADERS['Accept-Language']).toBeTruthy();
    expect(RELAY_HEADERS['User-Agent']).toContain('Mozilla');
    // 绝不能带 Sec-Fetch-*：浏览器 fetch 必带且改不掉，正是它暴露脚本身份
    expect(Object.keys(RELAY_HEADERS).some((k) => k.toLowerCase().startsWith('sec-fetch'))).toBe(false);
  });
});

describe('__INITIAL_STATE__ 解析', () => {
  it('undefined 直接写进 JSON 也能 parse', () => {
    expect(readInitialState(NOTE_HTML)).not.toBeNull();
  });

  it('标准顺序与反转顺序的 meta 都能抠到 content', () => {
    expect(rxMeta(NOTE_HTML, 'og:title')).toBe('丹东只有草莓？最值得吃的是大海鲜和小黄牛 - 小红书');
    expect(rxMeta('<meta content="X" property="og:title">', 'og:title')).toBe('X');
  });

  it('剥掉 [话题] 让 #xxx# 成对，缺的 tagList 补齐且不重复', () => {
    const desc = joinDescWithTags('#丹东美食[话题]# 好吃', [{ name: '丹东美食' }, { name: '开海季' }]);
    expect(desc).toContain('#丹东美食#');
    expect(desc).not.toContain('[话题]');
    expect(desc).toContain('#开海季#');
    expect(desc.split('#开海季#').length).toBe(2);
  });

  it('优先用站内数据：未截断正文 + 结构化话题 + 真封面（http 升 https）', () => {
    const m = parseRelayMeta(NOTE_HTML, 'xiaohongshu', NOTE_URL)!;
    expect(m.title).toBe('丹东只有草莓？最值得吃的是大海鲜和小黄牛');
    expect(m.desc).toContain('美食孤岛');
    expect(m.desc).toContain('#趁开海吃口鲜#');
    expect(m.desc).toContain('#开海季#');
    expect(m.cover).toBe('https://sns-webpic-qc.xhscdn.com/abc/cover!nd_dft_jpg_3');
  });

  it('话题成对后能被 detectCity 当话题来源识别（§5.1 话题优先）', async () => {
    const { buildDictionary, detectCity } = await import('../src/ingest/geo');
    const cities = [{ code: '210600', name: '丹东', province: '辽宁', lng: 124, lat: 40, aliases: [] }];
    const m = parseRelayMeta(NOTE_HTML, 'xiaohongshu', NOTE_URL)!;
    const r = detectCity({ title: m.title, desc: m.desc }, buildDictionary(cities as never));
    expect(r.cityCode).toBe('210600');
    expect(r.candidates[0].source).toBe('tag');
    expect(r.confidence).toBe(0.9);
  });

  it('站点壳判定为无效，绝不当成正文回传', () => {
    expect(isSiteLevelTitle('小红书 - 你的生活兴趣社区')).toBe(true);
    expect(isSiteLevelTitle('小红书 - 你访问的页面不见了')).toBe(true);
    expect(isSiteLevelTitle('微信公众平台')).toBe(true);
    expect(parseRelayMeta(SHELL_HTML, 'xiaohongshu', NOTE_URL)).toBeUndefined();
  });

  it('公众号走 msg_title 兜底', () => {
    const html = "<html><script>var msg_title='淄博烧烤还剩多少热度';var msg_desc='烧烤 小饼 蘸料';var msg_cdn_url='https://mmbiz/x.png';</script></html>";
    const m = parseRelayMeta(html, 'wechat', 'https://mp.weixin.qq.com/s/abc')!;
    expect(m.title).toBe('淄博烧烤还剩多少热度');
    expect(m.cover).toBe('https://mmbiz/x.png');
  });
});

/** 假的传输层：单测不碰网络，只验证编排与信封（spy 用于回看它收到的请求头） */
function stubFetcher(page: Partial<FetchedPage>, spy?: { headers?: Record<string, string> }): PageFetcher {
  return async (rawUrl, opts) => {
    if (spy) spy.headers = opts.headers;
    return {
      html: page.html ?? '',
      status: page.status ?? 200,
      finalUrl: page.finalUrl ?? rawUrl,
      platform: page.platform ?? 'xiaohongshu',
    };
  };
}

describe('中转的 HTTP 信封', () => {
  it('正常笔记 → 200 + ok + meta', async () => {
    const res = await handleRelayRequest({ url: NOTE_URL }, stubFetcher({ html: NOTE_HTML }));
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.meta.title).toContain('丹东');
  });

  it('把导航所需的三个头原样交给传输层', async () => {
    const spy: { headers?: Record<string, string> } = {};
    await handleRelayRequest({ url: NOTE_URL }, stubFetcher({ html: NOTE_HTML }, spy));
    expect(spy.headers).toMatchObject({
      Accept: expect.stringContaining('text/html'),
      'Accept-Language': expect.any(String),
      'User-Agent': expect.any(String),
    });
  });

  it('白名单外的地址直接 400，且一次请求都不发出去', async () => {
    let called = 0;
    const res = await handleRelayRequest(
      { url: 'http://169.254.169.254/latest/meta-data/' },
      async (...a) => {
        called++;
        return stubFetcher({})(a[0], a[1]);
      },
    );
    expect(res.status).toBe(400);
    expect(called).toBe(0);
  });

  it('只回站点壳 → 502 并说明原因（不假装成功）', async () => {
    const res = await handleRelayRequest({ url: NOTE_URL }, stubFetcher({ html: SHELL_HTML }));
    expect(res.status).toBe(502);
    expect(JSON.parse(res.body).error).toContain('壳');
  });

  it('format=html 回原文给前端自己提取', async () => {
    const res = await handleRelayRequest({ url: NOTE_URL, format: 'html' }, stubFetcher({ html: NOTE_HTML }));
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.meta).toBeUndefined();
    expect(body.html).toContain('__INITIAL_STATE__');
  });

  it('token 是访问凭证：默认 no-store，不配白名单时 CORS 才回 *', async () => {
    const open = await handleRelayRequest({ url: NOTE_URL }, stubFetcher({ html: NOTE_HTML }));
    expect(open.headers['Cache-Control']).toBe('no-store');
    expect(open.headers['Access-Control-Allow-Origin']).toBe('*');
    const locked = await handleRelayRequest(
      { url: NOTE_URL, origin: 'http://localhost:5173' },
      stubFetcher({ html: NOTE_HTML }),
      { allowedOrigins: 'http://localhost:5173' },
    );
    expect(locked.headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    expect(locked.headers.Vary).toBe('Origin');
  });

  it('云上 https 页面直连本机：响应与预检都要带 PNA 头', async () => {
    const res = await handleRelayRequest(
      { url: NOTE_URL, origin: 'https://eatmap-dpojxxeywur9.edgeone.cool' },
      stubFetcher({ html: NOTE_HTML }),
    );
    // Chrome 的私有网络访问预检不回这个头就直接拦（云上页面 → 127.0.0.1）
    expect(res.headers['Access-Control-Allow-Private-Network']).toBe('true');
    const pre = relayCorsHeaders('https://eatmap-dpojxxeywur9.edgeone.cool', {}, 'x-eatmap-probe');
    expect(pre['Access-Control-Allow-Headers']).toBe('x-eatmap-probe');
    expect(pre['Access-Control-Allow-Private-Network']).toBe('true');
  });
});
