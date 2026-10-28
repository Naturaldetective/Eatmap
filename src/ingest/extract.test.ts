// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { extractMeta, hasUsableMeta } from './extract';

const xhsNote = `
<html><head>
<meta property="og:title" content="成都苍蝇馆子天花板！人均40吃到扶墙">
<meta property="og:description" content="#成都美食 探店第38期，火锅串串香都在这家">
<meta property="og:image" content="https://sns-img.example.com/cover.jpg">
<script>window.__INITIAL_STATE__={};</script>
</head><body>正文</body></html>`;

const xhsRiskPage = `<html><head><title>小红书 - 你的生活兴趣社区</title></head><body>安全检测</body></html>`;

const wechatArticle = `
<html><head>
<meta property="og:title" content="">
</head><body>
<h1 class="rich_media_title" id="activity-name">长沙周末citywalk全攻略</h1>
<div id="js_content">景点门票、民宿、拍照出片圣地推荐，收藏这一篇就够了。</div>
</body></html>`;

const wechatVarFallback = `<html><head></head><body><script>var msg_title='淄博烧烤还剩多少热度';var msg_desc='烧烤 小饼 蘸料 测评';</script></body></html>`;

/** 中转通道（r.jina.ai）回传的是渲染后的 DOM：正文在 #detail-desc，话题在 #detail-tag-id */
const xhsRenderedDom = `<html><head>
<meta property="og:title" content="丹东只有草莓？最值得吃的是大海鲜和小黄牛 - 小红书">
<meta property="og:description" content="#趁开海吃口鲜 @吃货薯 丹东是整个北方的“美食孤岛”">
<meta property="og:image" content="https://sns-img.example.com/cover.jpg">
</head><body>
<h1 id="detail-title">丹东只有草莓？最值得吃的是大海鲜和小黄牛</h1>
<div id="detail-desc">#趁开海吃口鲜 @吃货薯
丹东是整个北方的“美食孤岛”，这里是鸭绿江的入海口，海鲜又大又肥</div>
<div id="detail-tag-id"><a class="tag" href="/search_result?k=1">#丹东美食</a><a class="tag" href="/search_result?k=2">#开海季</a></div>
</body></html>`;

/** 无 token 的裸地址会被 302 到这个 404 页 */
const xhsNoTokenPage = `<html><head>
<meta property="og:title" content="你访问的页面不见了">
<title>小红书 - 你访问的页面不见了</title></head><body>登录</body></html>`;

describe('元信息提取（§4.2）', () => {
  it('小红书：og meta 直通，含描述与封面', () => {
    const m = extractMeta(xhsNote, 'xiaohongshu');
    expect(m.title).toBe('成都苍蝇馆子天花板！人均40吃到扶墙');
    expect(m.desc).toContain('成都美食');
    expect(m.cover).toContain('cover.jpg');
    expect(hasUsableMeta(m)).toBe(true);
  });

  it('小红书风控页：站点级标题判定为无效 → 触发手动降级', () => {
    const m = extractMeta(xhsRiskPage, 'xiaohongshu');
    expect(hasUsableMeta(m)).toBe(false);
  });

  it('小红书渲染后 DOM：取 #detail-title/#detail-desc + 话题，不拼站点后缀', () => {
    const m = extractMeta(xhsRenderedDom, 'xiaohongshu');
    expect(m.title).toBe('丹东只有草莓？最值得吃的是大海鲜和小黄牛');
    expect(m.desc).toContain('美食孤岛');
    expect(m.desc).toContain('#丹东美食');
    expect(m.cover).toContain('cover.jpg');
    expect(hasUsableMeta(m)).toBe(true);
  });

  it('og:title 带「 - 小红书」后缀时入库标题被洗干净', () => {
    const html = `<html><head><meta property="og:title" content="武汉三镇夜宵地图 - 小红书"></head></html>`;
    expect(extractMeta(html, 'xiaohongshu').title).toBe('武汉三镇夜宵地图');
  });

  it('无 token 被踢到 404 页 → 判定无效（不存垃圾标题）', () => {
    expect(hasUsableMeta(extractMeta(xhsNoTokenPage, 'xiaohongshu'))).toBe(false);
  });

  it('公众号：og 为空时取 #activity-name + js_content 正文摘要', () => {
    const m = extractMeta(wechatArticle, 'wechat');
    expect(m.title).toBe('长沙周末citywalk全攻略');
    expect(m.desc).toContain('景点门票');
  });

  it('公众号：DOM 缺失时正则兜底 msg_title/msg_desc', () => {
    // 注入无 DOM 解析器，强制走正则兜底路径
    const m = extractMeta(wechatVarFallback, 'wechat', () => null);
    expect(m.title).toBe('淄博烧烤还剩多少热度');
    expect(m.desc).toContain('烧烤');
  });

  it('通用失败：验证/环境异常字样判定无效', () => {
    const html = `<html><head><meta property="og:title" content="环境异常，请完成验证后继续访问"></head></html>`;
    expect(hasUsableMeta(extractMeta(html, 'xiaohongshu'))).toBe(false);
  });
});
