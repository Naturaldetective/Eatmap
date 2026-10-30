// 生成 src/data/chinaGeo.json + src/data/chinaProvinces.json
// —— 旅记页「中国块状地图」要的两份几何（手册 §6.6）。
//
// 一次采集出两份：色块（370 个地级单位）+ 省界（34 个省级轮廓，只当分组线画）。
// 省界不用另拉接口：100000_full.json 本身就是 34 省的轮廓，市界是从它的下级取的。
//
// 数据源与城市库同源（阿里 DataV.GeoAtlas），但取的是**边界多边形**：
//   https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json  返回该单位的下一级
// 所以「省级 _full」一次就给全了该省的地级单位（含海南 469001 这类省直辖县级市），
// 34 个请求拼出全国 370 块，不用逐个市再下一层。
//
// 三个必须处理的坑（都是实测踩出来的）：
//  1. 北上津渝港澳的 _full 返回的是**市辖区**（110101 东城区…），而城市库里它们的 code 是
//     110000 这种省级码 —— 照搬会让这 6 个城市一块都对不上。所以直辖市/特区直接用**省级自己的
//     轮廓**当一个块，并跳过它的下级。
//  2. 100000_full 里混着一个 adcode 为 `100000_JD` 的非行政条目，得丢掉。
//  3. 台湾省的 _full 是 404（与城市库口径一致，本就不收录）：不报错，退回省界自己占一块。
//
// 原始响应缓存到 scripts/.china_geo_raw/，重跑不再打网络；删掉该目录即强制重新采集。
// 用法：node scripts/build-china-geo.mjs
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const R = dirname(dirname(fileURLToPath(import.meta.url)));
const RAW_DIR = join(R, 'scripts', '.china_geo_raw');
const OUT = join(R, 'src', 'data', 'chinaGeo.json');
const OUT_PROV = join(R, 'src', 'data', 'chinaProvinces.json');
const BASE = 'https://geo.datav.aliyun.com/areas_v3/bound';

/** 简化容差（度）。0.01° ≈ 1.1km：全国视角看不出差别，整份 gzip 约 0.34MB */
const TOLERANCE = 0.01;
/** 坐标保留 4 位小数（≈11m），再细就是白掏体积 */
const PRECISION = 4;
/** 直辖市与特别行政区：省级码就是城市本身，用省级轮廓，不取其下级 */
const SELF_BLOCK = new Set(['110000', '120000', '310000', '500000', '810000', '820000']);

mkdirSync(RAW_DIR, { recursive: true });

async function fetchJson(file) {
  const cache = join(RAW_DIR, `${file}.json`);
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
  const res = await fetch(`${BASE}/${file}.json`);
  if (!res.ok) return null; // 404（台湾省）由调用方决定跳过还是报错
  const json = await res.json();
  writeFileSync(cache, JSON.stringify(json));
  return json;
}

/* ==================== Douglas-Peucker ==================== */

function perpDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 迭代版（递归在十万点的环上会爆栈）；输入是闭合环，首尾同点 */
function simplifyRing(ring, tol) {
  const pts = ring.map((p) => [p[0], p[1]]);
  if (pts.length < 4) return pts.map(round);
  const keep = new Set([0, pts.length - 1]);
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    if (e <= s + 1) continue;
    let best = -1;
    let at = s;
    for (let i = s + 1; i < e; i += 1) {
      const d = perpDist(pts[i], pts[s], pts[e]);
      if (d > best) {
        best = d;
        at = i;
      }
    }
    if (best > tol) {
      keep.add(at);
      stack.push([s, at], [at, e]);
    }
  }
  const idx = [...keep].sort((a, b) => a - b);
  return idx.map((i) => round(pts[i]));
}

function round([x, y]) {
  const k = 10 ** PRECISION;
  return [Math.round(x * k) / k, Math.round(y * k) / k];
}

function simplifyGeometry(geom, tol) {
  if (geom.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geom.coordinates.map((r) => simplifyRing(r, tol)) };
  }
  if (geom.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geom.coordinates.map((poly) => poly.map((r) => simplifyRing(r, tol))),
    };
  }
  return geom;
}

function pointCount(geom) {
  const rings = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  return rings.flat().reduce((n, r) => n + r.length, 0);
}

/* ==================== 采集 ==================== */

const national = await fetchJson('100000_full');
if (!national) throw new Error('拿不到 100000_full.json，检查网络');

const blocks = new Map(); // adcode → feature，按 adcode 去重（省级只当直辖市块或缺下级时的兜底）
const skipped = [];
for (const prov of national.features) {
  const ad = String(prov.properties.adcode);
  if (!/^\d{6}$/.test(ad)) {
    skipped.push(`${ad}(${prov.properties.name})`);
    continue; // 100000_JD 这类非行政条目
  }
  if (SELF_BLOCK.has(ad)) {
    blocks.set(ad, {
      type: 'Feature',
      properties: { adcode: ad, name: prov.properties.name },
      geometry: prov.geometry,
    });
    continue;
  }
  const sub = await fetchJson(`${ad}_full`);
  const kids = sub?.features ?? [];
  if (!kids.length) {
    // 台湾省（_full 404）等：没有下级就用省界自己占一块，地图不至于缺个洞
    skipped.push(`${ad}(${prov.properties.name}) → 退回省界`);
    blocks.set(ad, {
      type: 'Feature',
      properties: { adcode: ad, name: prov.properties.name },
      geometry: prov.geometry,
    });
    continue;
  }
  for (const f of kids) {
    const kid = String(f.properties.adcode);
    if (!/^\d{6}$/.test(kid)) continue;
    blocks.set(kid, {
      type: 'Feature',
      properties: { adcode: kid, name: f.properties.name },
      geometry: f.geometry,
    });
  }
}

/* ==================== 与城市库对账 ==================== */

const cities = JSON.parse(readFileSync(join(R, 'src', 'data', 'cities.json'), 'utf8'));
const adOf = (code) => (blocks.has(code) ? code : blocks.has(code.slice(0, 4) + '00') ? code.slice(0, 4) + '00' : '');

const orphans = cities.filter((c) => !adOf(c.code));
let direct = 0;
let viaParent = 0;
for (const c of cities) {
  if (blocks.has(c.code)) direct += 1;
  else if (adOf(c.code)) viaParent += 1;
}

/* ==================== 简化并落盘 ==================== */

let before = 0;
let after = 0;
const features = [...blocks.values()]
  .sort((a, b) => a.properties.adcode.localeCompare(b.properties.adcode))
  .map((f) => {
    before += pointCount(f.geometry);
    const geometry = simplifyGeometry(f.geometry, TOLERANCE);
    after += pointCount(geometry);
    return { type: 'Feature', properties: f.properties, geometry };
  });

const fc = { type: 'FeatureCollection', features };
const text = JSON.stringify(fc);
writeFileSync(OUT, text);

/**
 * 省界：直接从已经拉到的 100000_full 里取省级轮廓，不额外打网络。
 * 容差跟市界保持一致 —— 两条线本该骑在同一条原始边界上，各简化各的容差
 * 会在深缩放时错开几像素，看着像省界画歪了。
 */
const provFeatures = national.features
  .filter((f) => /^\d{6}$/.test(String(f.properties.adcode)))
  .sort((a, b) => String(a.properties.adcode).localeCompare(String(b.properties.adcode)))
  .map((f) => ({
    type: 'Feature',
    // 原始 properties 带 childrenNum / center / centroid / level / acroutes，前端一个都不读
    properties: { adcode: String(f.properties.adcode), name: f.properties.name },
    geometry: simplifyGeometry(f.geometry, TOLERANCE),
  }));

const provText = JSON.stringify({ type: 'FeatureCollection', features: provFeatures });
writeFileSync(OUT_PROV, provText);

// 色块 → 省也要对账：省界表缺一个码，旅记页就会多出一个不属于任何省的块，
// 面板标题也就取不到省名（只能退化成光一个城市名）。
const provCodes = new Set(provFeatures.map((f) => f.properties.adcode));
const provOrphans = [...blocks.keys()].filter((ad) => !provCodes.has(ad.slice(0, 2) + '0000'));
if (provOrphans.length) {
  console.error('落不到省里的色块：', provOrphans.join('、'));
  process.exit(1);
}

console.log(`色块 ${features.length} 个 · 点数 ${before} → ${after}（容差 ${TOLERANCE}°）`);
console.log(`城市库 ${cities.length} 城：直接命中 ${direct} · 归上级地级 ${viaParent} · 对不上 ${orphans.length}`);
if (orphans.length) {
  console.error('孤儿城市：', orphans.map((c) => `${c.code} ${c.name}`).join('、'));
  process.exit(1); // 对不上就说明映射规则或数据源变了，不能悄悄出一份缺点的地图
}
if (skipped.length) console.log('跳过：', skipped.join('、'));
console.log(`${OUT}  ${(Buffer.byteLength(text) / 1048576).toFixed(2)}MB`);
console.log(`省界 ${provFeatures.length} 个（跳过非行政条目 ${national.features.length - provFeatures.length}）`);
console.log(`${OUT_PROV}  ${(Buffer.byteLength(provText) / 1048576).toFixed(2)}MB`);
