import type { CityRecord } from '../db/schema';

/** 匹配词条：城市名或别名。isName=标准名（置信度高于别名） */
interface CityTerm {
  term: string;
  code: string;
  isName: boolean;
}

/**
 * 由城市库构建匹配词典。
 * 关键约束（§5.1 防误匹配）：匹配词长度必须 ≥2，
 * 排除「汉/穗/宁/渝」这类单字别名（会误命中大量无关文本）。
 * 按词长降序，供最长优先消费。
 */
export function buildDictionary(cities: CityRecord[]): CityTerm[] {
  const terms: CityTerm[] = [];
  for (const c of cities) {
    if (c.name.length >= 2) terms.push({ term: c.name, code: c.code, isName: true });
    for (const a of c.aliases) {
      if (a.length >= 2 && a !== c.name) terms.push({ term: a, code: c.code, isName: false });
    }
  }
  return terms.sort((x, y) => y.term.length - x.term.length);
}

export interface GeoCandidate {
  code: string;
  term: string;
  source: 'tag' | 'title' | 'desc';
  index: number;
  isName: boolean;
}

interface GeoResult {
  cityCode: string;
  /** <0.6 在 UI 标黄提示复核（§5.1） */
  confidence: number;
  matchedTerm?: string;
  candidates: GeoCandidate[];
}

const UNKNOWN: GeoResult = { cityCode: 'unknown', confidence: 0, candidates: [] };

/** 提取 #话题# 标签文本（§5.1：话题里的城市优先） */
function extractTags(text: string): string {
  const tags = [...text.matchAll(/#([^#\s]{1,20})#/g)].map((m) => m[1]);
  return tags.join(' ');
}

/**
 * 地名出现在这些「通名上下文」里时不是地名（§5.1 防误匹配）。
 * 丹东事故复盘：正文里「鸭绿江的入海口」被当成海南海口，多出一个竞争城市就把
 * 话题级的丹东结论一路拖进标黄区。按「前一个字」判定而不是整词遮蔽，
 * 是为了不误伤「梅河口 / 老河口」这类真地名（遮蔽会让长词也命中不了）。
 * 这里是持续迭代处：新的误命中样本往这里加一条，不要改匹配算法。
 */
const FALSE_CONTEXT: Record<string, string[]> = {
  海口: ['入', '出'], // 入海口 / 出海口（后者常是「寻找出海口」这种比喻）
};

function isFalseContext(term: string, prev: string | undefined): boolean {
  const prefixes = FALSE_CONTEXT[term];
  return !!prefixes && !!prev && prefixes.includes(prev);
}

/** 在一段文本里做最长优先匹配，命中的字符位置被消费，短词无法命中其内部 */
function matchSegment(
  text: string,
  dict: CityTerm[],
  source: GeoCandidate['source'],
): GeoCandidate[] {
  const consumed = new Array<boolean>(text.length).fill(false);
  const out: GeoCandidate[] = [];
  for (const { term, code, isName } of dict) {
    let from = 0;
    let idx: number;
    while ((idx = text.indexOf(term, from)) !== -1) {
      const overlap = idx >= 0 && consumed.slice(idx, idx + term.length).some(Boolean);
      if (!overlap && !isFalseContext(term, text[idx - 1])) {
        for (let k = idx; k < idx + term.length; k++) consumed[k] = true;
        out.push({ code, term, source, index: idx, isName });
      }
      from = idx + term.length;
    }
  }
  return out;
}

const SOURCE_PRIORITY: Record<GeoCandidate['source'], number> = { tag: 3, title: 2, desc: 1 };

/**
 * 城市识别（§5.1）。纯函数：给定文本与词典，返回城市码 + 置信度 + 候选明细。
 * 消歧优先级：#话题# > 标题出现最靠前 > 正文；仍不确定（多城同级）降置信度交人工。
 */
export function detectCity(
  input: { title: string; desc?: string },
  dict: CityTerm[],
): GeoResult {
  const title = input.title ?? '';
  const desc = input.desc ?? '';
  const combined = `${title} ${desc}`;
  const tags = extractTags(combined);

  const candidates: GeoCandidate[] = [
    ...(tags ? matchSegment(tags, dict, 'tag') : []),
    ...matchSegment(title, dict, 'title'),
    ...(desc ? matchSegment(desc, dict, 'desc') : []),
  ];

  if (candidates.length === 0) return UNKNOWN;

  // 按城市码归并，取每城最高优先级来源、最靠前位置
  const best = new Map<string, GeoCandidate>();
  for (const c of candidates) {
    const cur = best.get(c.code);
    if (
      !cur ||
      SOURCE_PRIORITY[c.source] > SOURCE_PRIORITY[cur.source] ||
      (SOURCE_PRIORITY[c.source] === SOURCE_PRIORITY[cur.source] && c.index < cur.index)
    ) {
      best.set(c.code, c);
    }
  }
  const codes = [...best.values()];
  codes.sort(
    (a, b) =>
      SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source] ||
      (a.source === b.source ? a.index - b.index : 0) ||
      (b.isName ? 1 : 0) - (a.isName ? 1 : 0),
  );

  const winner = codes[0];
  // 歧义只在「声明级」证据之间算数：话题与标题互相竞争才是真二义；
  // 正文里顺带出现的地名不足以推翻话题/标题的结论（丹东那条就是被「入海口」拖黄的）。
  // 结论本身来自正文时，同级竞争照旧全部算上。
  const rivalFloor = winner.source === 'desc' ? 1 : SOURCE_PRIORITY.title;
  const distinct = codes.filter((c) => SOURCE_PRIORITY[c.source] >= rivalFloor).length;

  // 置信度：来源优先级 + 是否标准名 + 同级唯一性
  let confidence: number;
  if (winner.source === 'tag') confidence = distinct === 1 ? 0.9 : 0.8;
  else if (winner.source === 'title') confidence = distinct === 1 ? (winner.isName ? 0.85 : 0.7) : 0.55;
  // 正文是最弱来源：标题里没有城市、正文顺带提到一个，不足以断定归属。
  // 丹东事故复盘——当时给到 0.7（高于标黄线）就安静输出了可能错的答案，
  // 所以唯一命中标准名也只给 0.55，一律标黄交人工复核。
  else confidence = distinct === 1 ? 0.55 : 0.45;
  if (distinct > 1) confidence = Math.min(confidence, 0.55); // 同级多城歧义，标黄复核

  return {
    cityCode: winner.code,
    confidence: Math.round(confidence * 100) / 100,
    matchedTerm: winner.term,
    candidates: codes,
  };
}
