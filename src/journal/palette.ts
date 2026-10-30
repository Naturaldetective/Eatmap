import type { PathOptions } from 'leaflet';

/**
 * 旅记页的着色口径（手册 §6.6）。
 * 单独拎成纯函数是为了能测：整页只允许两种砖粉（点亮 / 点亮 hover），
 * 未点亮块必须比 canvas 底色深一点点而不是浅一点点，否则大陆会变成「一块白斑」。
 *
 * 为什么不是那支松绿：点亮 = 「去过」，吃和玩都算，借「玩」的语义色是错位的；
 * 而冷绿骑在暖纸底 + 褐省界上，色温打架（实测看着像湖）。“吃图”的足迹用「吃」那支。
 */

/** 未点亮：几乎与纸底色重合，存在感全部让给点亮的块 */
const UNLIT: PathOptions = { color: '#e0d8cc', weight: 0.6, fillColor: '#f8f5f1', fillOpacity: 1 };

/** 点亮：砖粉填充 + 焦糖描边（复用 food #d9480f，不新增第三种语义色）。「突出」靠描边与线宽，不靠饱和度 */
const LIT: PathOptions = { color: 'rgba(217, 72, 15, 0.5)', weight: 1.3, fillColor: '#f7ded0', fillOpacity: 1 };

/** hover 只压深填充一档，描边保持原样：免得一块颜色在两种深浅之间跳 */
const LIT_HOVER: PathOptions = { ...LIT, fillColor: '#f0cfb9' };
const UNLIT_HOVER: PathOptions = { ...UNLIT, fillColor: '#f1ece4' };

export function blockStyle(lit: boolean, hovered = false): PathOptions {
  if (lit) return hovered ? LIT_HOVER : LIT;
  return hovered ? UNLIT_HOVER : UNLIT;
}

/**
 * 省界分组线：只描边不填充，压在色块层之上。
 * 比市界（#e0d8cc / 0.6）深一档粗一档，但故意用半透 —— 它得在点亮块的砖描边上骑过去，
 * 不透明就会把那些直辖市的描边切断成褐框（两者同暖族，半透之后分得开但不打架）。不交互，点击穿透到下面的块。
 */
export const PROVINCE_BORDER: PathOptions = {
  stroke: true,
  color: '#b3a48c',
  weight: 1.1,
  opacity: 0.7,
  fill: false,
  interactive: false,
};
