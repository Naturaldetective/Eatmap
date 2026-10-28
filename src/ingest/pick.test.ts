import { describe, expect, it } from 'vitest';
import { buildPickScript, parsePickList, parsePickResult } from './pick';

describe('取词脚本（中转失效时的兜底，只读当前已渲染的笔记页）', () => {
  it('脚本含 og 与 #detail-* 双兜底、copy 回传，并拒绝非笔记页', () => {
    const s = buildPickScript();
    expect(s).toContain("og('og:title')");
    expect(s).toContain("getElementById('detail-title')");
    expect(s).toContain('copy(JSON.stringify(out))');
    expect(s).toContain('你的生活兴趣社区');
  });

  it('不靠同源 fetch 批量抓（实测那样只能拿到 SPA 壳）', () => {
    expect(buildPickScript()).not.toContain('fetch(');
  });

  it('模板里的正则在生成脚本中保持转义（别把 /\\s+/ 写成 /s+/）', () => {
    const s = buildPickScript();
    expect(s).toContain('/\\s+/g');
    expect(s).toContain("join('\\n')");
  });
});

describe('取词结果回传解析', () => {
  it('单条标准 JSON 直接解析', () => {
    const m = parsePickResult('{"url":"https://www.xiaohongshu.com/explore/abc","title":"成都火锅","desc":"探店 苍蝇馆子","cover":"https://img/x.jpg"}');
    expect(m).not.toBeNull();
    expect(m!.title).toBe('成都火锅');
    expect(m!.cover).toBe('https://img/x.jpg');
  });

  it('批量数组 → 多条，按 url 保序', () => {
    const text = JSON.stringify([
      { url: 'https://www.xiaohongshu.com/explore/a', title: '成都火锅', desc: '串串' },
      { url: 'https://www.xiaohongshu.com/explore/b', title: '武汉热干面', desc: '过早' },
    ]);
    expect(parsePickList(text).map((m) => m.title)).toEqual(['成都火锅', '武汉热干面']);
  });

  it('容忍控制台打印格式（前后有多余文字）', () => {
    const m = parsePickResult('EatMap 取词结果（已复制到剪贴板）：\n{ "url": "u", "title": "重庆小面", "desc": "" }\n> undefined');
    expect(m!.title).toBe('重庆小面');
    expect(m!.cover).toBeUndefined();
  });

  it('批量数组带噪声前缀也能逐条抠出，且跳过没有 title 的失败项', () => {
    const text = [
      'EatMap 取词结果（1 条，已复制到剪贴板）：',
      '[\n  {\n    "url": "u1",\n    "title": "长沙夜宵",\n    "desc": ""\n  },\n  {\n    "error": "NO_TITLE",\n    "url": "u2"\n  }\n]',
      '> undefined',
    ].join('\n');
    expect(parsePickList(text).map((m) => m.title)).toEqual(['长沙夜宵']);
  });

  it('同一批里重复链接只留一条', () => {
    const text = JSON.stringify([
      { url: 'u1', title: 'A' },
      { url: 'u1', title: 'A' },
    ]);
    expect(parsePickList(text)).toHaveLength(1);
  });

  it('无 title 或非法 JSON → 空结果', () => {
    expect(parsePickList('{"desc":"只有描述"}')).toEqual([]);
    expect(parsePickResult('随便一段文字')).toBeNull();
  });
});
