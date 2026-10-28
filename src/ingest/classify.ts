import type { Category } from '../db/schema';
import {
  BOTH_HIGH,
  FOOD_BIAS_TIE,
  FOOD_FIRST,
  LEXICON,
  MIN_SCORE_GAP,
  type Lexicon,
} from './lexicon';

export interface ClassifyHit {
  word: string;
  weight: number; // 实际计入的加权（含标题 ×2）
  where: 'title' | 'desc';
}

interface ClassifyResult {
  category: Category;
  /** 0~1，供 UI 标记是否需复核 */
  confidence: number;
  foodScore: number;
  travelScore: number;
  /** 命中明细，UI tooltip 展示「为什么这么判」（§5.2 可解释性） */
  hits: ClassifyHit[];
}

const TITLE_WEIGHT = 2; // 标题命中 ×2 加权（§5.2）
const STRONG = 3;
const WEAK = 1;
/** 绝对证据强度：分差达此值视为满置信（约两条强词标题命中） */
const CONF_FULL = 6;

/** 统计一个词在文本中出现的次数（大小写不敏感，中文本身无大小写） */
function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  const h = hay.toLowerCase();
  const n = needle.toLowerCase();
  let count = 0;
  let i = h.indexOf(n);
  while (i !== -1) {
    count++;
    i = h.indexOf(n, i + n.length); // 不重叠计数
  }
  return count;
}

function scoreSide(
  side: Lexicon['food'],
  title: string,
  desc: string,
  hits: ClassifyHit[],
): number {
  let score = 0;
  for (const [weight, words] of [[STRONG, side.strong], [WEAK, side.weak]] as const) {
    for (const w of words) {
      const tc = countOccurrences(title, w);
      const dc = countOccurrences(desc, w);
      if (tc > 0) {
        const add = tc * weight * TITLE_WEIGHT;
        score += add;
        hits.push({ word: w, weight: add, where: 'title' });
      }
      if (dc > 0) {
        const add = dc * weight;
        score += add;
        hits.push({ word: w, weight: add, where: 'desc' });
      }
    }
  }
  return score;
}

/**
 * 吃/玩分类打分器（§5.2）。纯函数，无副作用，便于单测与词表迭代。
 * 输入 title + desc（含正文摘要与 #话题# 标签，调用方拼接进 desc）。
 */
export function classify(title: string, desc = '', lexicon: Lexicon = LEXICON): ClassifyResult {
  const hits: ClassifyHit[] = [];
  const foodScore = scoreSide(lexicon.food, title, desc, hits);
  const travelScore = scoreSide(lexicon.travel, title, desc, hits);

  const gap = foodScore - travelScore;
  const absGap = Math.abs(gap);
  const max = Math.max(foodScore, travelScore);

  // 规则1：全 0 → unknown
  if (max === 0) {
    return { category: 'unknown', confidence: 0, foodScore, travelScore, hits };
  }

  let category: Category = gap > 0 ? 'food' : gap < 0 ? 'travel' : 'unknown';

  // 规则3：混合且都很高时按 FOOD_FIRST 偏吃（分差在 FOOD_BIAS_TIE 内）
  if (
    FOOD_FIRST &&
    category !== 'food' &&
    foodScore > 0 &&
    foodScore >= BOTH_HIGH &&
    travelScore >= BOTH_HIGH &&
    gap >= -FOOD_BIAS_TIE
  ) {
    category = 'food';
  }

  // 规则2：确信度不足（分差 < MIN_SCORE_GAP）→ 交人工，除非偏吃能定
  const confident = absGap >= MIN_SCORE_GAP;
  const ratio = absGap / max;
  if (!confident) {
    if (FOOD_FIRST && foodScore > 0 && gap >= -FOOD_BIAS_TIE) {
      category = 'food';
    } else {
      return { category: 'unknown', confidence: round2(ratio), foodScore, travelScore, hits };
    }
  }

  // confidence = 相对比例与绝对强度二者较小：单弱词不会满分，高票混合不过度自信
  const confidence = round2(Math.min(ratio, absGap / CONF_FULL));
  return { category, confidence, foodScore, travelScore, hits };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
