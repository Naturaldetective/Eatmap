import { useId } from 'react';
import type { CSSProperties } from 'react';

/**
 * 品牌艺术字「EatMap」——全站唯一允许“卖萌”的位置。
 * 逐字母 SVG <text>：暖橙单色渐变 + 白色贴纸描边（paint-order: stroke），
 * 字母各带一点倾角与下沉，悬停时依次弹起；底部一条黄油色「面条线」兼作下划线。
 * 位置用 text-anchor=middle 定中心，避免不同字体下字宽不一致导致挤压/断裂。
 */
const LETTERS = [
  { ch: 'E', x: 11, r: -7, o: -1 },
  { ch: 'a', x: 27, r: 5, o: 1 },
  { ch: 't', x: 41, r: -4, o: 0 },
  { ch: 'M', x: 60, r: 6, o: 1 },
  { ch: 'a', x: 80, r: -5, o: 0 },
  { ch: 'p', x: 96, r: 4, o: 2 },
];

export default function Wordmark({ className = '' }: { className?: string }) {
  // 同页多处使用时渐变 id 不能撞车
  const grad = `wm-${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="0 0 108 46" role="img" aria-label="EatMap" className={`wordmark ${className}`}>
      <title>EatMap</title>
      <defs>
        {/* 必须用 userSpaceOnUse：默认的 objectBoundingBox 会按每个字母各自的
            包围盒算渐变，变成「每字母内部跑一遍彩虹」，整体看很脏。
            双色暖调收敛：不引入粉/绿，与中性 UI 不冲突。 */}
        <linearGradient id={grad} gradientUnits="userSpaceOnUse" x1="2" y1="6" x2="106" y2="34">
          <stop offset="0%" stopColor="#f08c00" />
          <stop offset="100%" stopColor="#d9480f" />
        </linearGradient>
      </defs>
      {/* 面线程：一条波浪下划线兜住字母 */}
      <path
        d="M6 41 Q 24 46 44 41 T 84 41 T 104 39"
        fill="none"
        stroke="#f5d78a"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {LETTERS.map((l, i) => (
        <text
          key={l.ch + i}
          x={l.x}
          y={28}
          textAnchor="middle"
          fontSize="26"
          fill={`url(#${grad})`}
          className="wordmark-letter"
          style={{ '--r': `${l.r}deg`, '--o': `${l.o}px`, '--i': i } as CSSProperties}
        >
          {l.ch}
        </text>
      ))}
    </svg>
  );
}
