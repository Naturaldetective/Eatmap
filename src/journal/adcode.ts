/**
 * 旅记页的「城市 → 色块 → 省份」映射（手册 §6.6）。
 *
 * 色块只有地级一层（370 块），而城市库有 743 条（339 地级 + 30 省直辖县 + 374 县级市）。
 * 县级市如果单独成块，就会嵌在它上级市的块里面重叠绘制，要挖洞就得引多边形布尔运算 ——
 * 不值当。所以**县级市并入上级地级块**：点亮「遵化」，亮的是唐山市那块，
 * 但面板里列的还是「遵化 · 2026-10-30」，用户记的那条信息一点没丢。
 *
 * 依据是 adcode 的编码规则：县级 = 地级前 4 位 + 两位序号，所以 `code.slice(0,4) + '00'`
 * 就是它的上级。北上渝港澳是省级码（110000），在色块表里直接命中，不走这条。
 * 同一套规则再往上一层：地级码前 2 位 + '0000' 就是它所属的省（直辖市也就 110000 自己）。
 */
import type { GeoFeature, GeoCollection } from './geoTypes';

export type { GeoFeature, GeoCollection };

/** 几何数据 1.15MB，绝不能进主包：只在旅记页动态 import（与 cities.json 同一套路，§7） */
let geoPromise: Promise<GeoCollection> | null = null;

export function loadGeo(): Promise<GeoCollection> {
  geoPromise ??= import('../data/chinaGeo.json')
    .then((m) => m.default as unknown as GeoCollection)
    // 失败的 promise 不能留在缓存里，否则不刷新页面就永远重试不了（1MB 多的 chunk 确实会断）
    .catch((err: unknown) => {
      geoPromise = null;
      throw err;
    });
  return geoPromise;
}

let provPromise: Promise<GeoCollection> | null = null;

/** 省界几何（34 个省级轮廓，只用来画分组线），同样不进主包 */
export function loadProvinces(): Promise<GeoCollection> {
  provPromise ??= import('../data/chinaProvinces.json')
    .then((m) => m.default as unknown as GeoCollection)
    .catch((err: unknown) => {
      provPromise = null;
      throw err;
    });
  return provPromise;
}

export function blockAdcodes(fc: GeoCollection): Set<string> {
  return new Set(fc.features.map((f) => f.properties.adcode));
}

/**
 * 城市 code 落在哪个色块上。'' = 这块图上没有（正常不该出现，
 * build-china-geo.mjs 每次生成都会全量对账，孤儿不为 0 就直接 exit 1）。
 */
export function adcodeOf(cityCode: string, blocks: ReadonlySet<string>): string {
  if (!/^\d{6}$/.test(cityCode)) return '';
  if (blocks.has(cityCode)) return cityCode;
  const parent = cityCode.slice(0, 4) + '00';
  return blocks.has(parent) ? parent : '';
}

/** 按色块归组：一个块可能同时被它的地级市和几个下辖县级市点亮 */
export function groupByBlock<T extends { cityCode: string }>(
  rows: T[],
  blocks: ReadonlySet<string>,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const ad = adcodeOf(r.cityCode, blocks);
    if (!ad) continue;
    const list = out.get(ad);
    if (list) list.push(r);
    else out.set(ad, [r]);
  }
  return out;
}

/** 色块 adcode → 所属省的 adcode：前两位 + 四个 0（130200 → 130000；110000 → 110000） */
export function provinceAdcodeOf(blockAdcode: string): string {
  return /^\d{6}$/.test(blockAdcode) ? blockAdcode.slice(0, 2) + '0000' : '';
}

/** adcode → 行政区名，色块表和省界表共用 */
export function namesOf(fc: GeoCollection): Map<string, string> {
  return new Map(fc.features.map((f) => [f.properties.adcode, f.properties.name]));
}

/**
 * 点亮的色块铺到了哪几个省（按 adcode 正序，去重）。
 * 只认省界表里真有的省：省界缺一个码就是数据出错，宁可少计也不能凭空多一个省。
 */
export function litProvincesOf(
  litBlocks: Iterable<string>,
  provinces: ReadonlySet<string>,
): string[] {
  const out = new Set<string>();
  for (const ad of litBlocks) {
    const prov = provinceAdcodeOf(ad);
    if (prov && provinces.has(prov)) out.add(prov);
  }
  return [...out].sort();
}
