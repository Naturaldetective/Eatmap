import { describe, expect, it } from 'vitest';
import { detectPlatform, normalizeUrl, parseShareText, splitLinks } from './parse';

describe('分享文案解析（免抓取路径）', () => {
  it('小红书 App 分享文案：标题/短链/标签分离', () => {
    const text = '成都探店｜这家人均40的苍蝇馆子绝了\nhttp://xhslink.com/a/6aad569b\n#成都美食 #火锅 小红书';
    const r = parseShareText(text);
    expect(r).not.toBeNull();
    expect(r!.title).toBe('成都探店｜这家人均40的苍蝇馆子绝了');
    expect(r!.url).toBe('http://xhslink.com/a/6aad569b');
    expect(r!.desc).toContain('#成都美食');
  });

  it('标题行尾粘着的 #话题 归入描述，不污染标题', () => {
    const r = parseShareText('重庆老火锅推荐 #重庆美食\nhttps://www.xiaohongshu.com/explore/abc123');
    expect(r!.title).toBe('重庆老火锅推荐');
    expect(r!.desc).toContain('#重庆美食');
  });

  it('纯链接行（无标题）→ title 为空串，需回退抓取', () => {
    const r = parseShareText('https://mp.weixin.qq.com/s?__biz=MzA5&mid=265');
    expect(r!.title).toBe('');
    expect(r!.url).toContain('mp.weixin.qq.com');
  });

  it('无链接返回 null', () => {
    expect(parseShareText('今天吃了好吃的')).toBeNull();
  });
});

describe('链接识别（§4.1）', () => {
  it('接受小红书三种形态并标记短链', () => {
    expect(detectPlatform('https://www.xiaohongshu.com/explore/abc123')).toEqual({ platform: 'xiaohongshu', isShort: false });
    expect(detectPlatform('https://xhslink.com/m/AbCd')).toEqual({ platform: 'xiaohongshu', isShort: true });
    expect(detectPlatform('http://xiaohongshu.com/discovery/item/xyz?x=1')!.platform).toBe('xiaohongshu');
  });

  it('接受公众号两种形态', () => {
    expect(detectPlatform('https://mp.weixin.qq.com/s/AbC-dEf')).toEqual({ platform: 'wechat', isShort: false });
    expect(detectPlatform('https://mp.weixin.qq.com/s?__biz=MzA5&mid=1#rd')?.platform).toBe('wechat');
  });

  it('其他链接一律拒绝', () => {
    expect(detectPlatform('https://www.douyin.com/video/123')).toBeNull();
    expect(detectPlatform('not a url')).toBeNull();
  });
});

describe('URL 规范化（§4.4 去重前提）', () => {
  it('小红书剥掉全部临时 query 参数', () => {
    const a = 'https://www.xiaohongshu.com/explore/abc?xsec_token=ABt&xsec_source=pc_share&share_from=app';
    expect(normalizeUrl(a)).toBe('https://www.xiaohongshu.com/explore/abc');
  });

  it('公众号保留业务参数、剔除临时参数与 hash', () => {
    const a = 'https://mp.weixin.qq.com/s?__biz=MzA5&mid=265&tempkey=xxx&scene=1#wechat_redirect';
    expect(normalizeUrl(a)).toBe('https://mp.weixin.qq.com/s?__biz=MzA5&mid=265');
  });

  it('splitLinks：混在文案里的链接也能提取，按 norm 去重保序（同笔记不同 token 算一条）', () => {
    const text = [
      '看看这家店 https://www.xiaohongshu.com/explore/aaa?xsec_token=1 太好吃了',
      '',
      'https://www.xiaohongshu.com/explore/aaa?xsec_token=2', // 同笔记不同 token → 视为重复
      'https://mp.weixin.qq.com/s/bbb',
      '没有链接的一行',
    ].join('\n');
    // 去 token 的 norm 只能用于去重，拿去抓取必被踢 404，所以抓取用 raw（留着 token）
    expect(splitLinks(text)).toEqual([
      { norm: 'https://www.xiaohongshu.com/explore/aaa', raw: 'https://www.xiaohongshu.com/explore/aaa?xsec_token=1' },
      { norm: 'https://mp.weixin.qq.com/s/bbb', raw: 'https://mp.weixin.qq.com/s/bbb' },
    ]);
  });

  it('splitLinks：norm 去 token 供去重，raw 留 token 供抓取（缺它必被 302 到 404）', () => {
    const raw = 'https://www.xiaohongshu.com/explore/abc?xsec_token=ABc123%3D&xsec_source=pc_share';
    expect(splitLinks(raw)).toEqual([
      { norm: 'https://www.xiaohongshu.com/explore/abc', raw },
    ]);
  });

  it('splitLinks：无 token 时 norm 与 raw 一致（调用方可据此不存 fetchUrl）', () => {
    const hits = splitLinks('http://xhslink.com/a/6aad569b');
    expect(hits).toEqual([{ norm: 'http://xhslink.com/a/6aad569b', raw: 'http://xhslink.com/a/6aad569b' }]);
  });
});
