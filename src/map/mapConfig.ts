import type { LatLngExpression, TileLayerOptions } from 'leaflet';

/** 中国视野初始中心，注意 Leaflet 顺序是 [纬度, 经度] */
export const CHINA_CENTER: LatLngExpression = [35, 104];

/** 初始缩放：支持 4.5 需要 MapContainer 设置 zoomSnap={0.5} */
export const CHINA_ZOOM = 4.5;

/**
 * 高德街道瓦片（GCJ-02 坐标系，免 token）。
 * 注意：Leaflet 默认按 WGS-84 瓦片处理，高德瓦片会有 ~50-500m 的视觉偏移，
 * 本期只做城市级打点，偏移可接受（见 DEVELOPMENT.md §2）。
 */
export const AMAP_STREET: { url: string; options: TileLayerOptions } = {
  url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
  options: {
    subdomains: ['1', '2', '3', '4'],
    maxZoom: 18,
    attribution: '&copy; 高德地图',
  },
};

/** 气泡尺寸（§6.1）：size = 24 + log2(total)*8，上限 64px */
export function bubbleSize(total: number): number {
  if (total <= 0) return 0;
  return Math.min(64, Math.round(24 + Math.log2(total) * 8));
}

export type BubbleKind = 'food' | 'travel' | 'mixed';

/**
 * 按吃/玩数量定主色（§6.1）。不再往气泡里塞 emoji：
 * 颜色与吃/玩一一对应（图例里说明），图形本身已经是信息。
 */
export function bubbleKind(food: number, travel: number): BubbleKind {
  if (food === travel) return 'mixed';
  return food > travel ? 'food' : 'travel';
}
