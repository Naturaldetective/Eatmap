import type { GeoCollection, GeoFeature } from './geoTypes';

/** Leaflet 的 LatLngBounds 字面量写法：[[南, 西], [北, 东]] */
export type LatLonBounds = [[number, number], [number, number]];

/** 几何缺失时的兜底框（大致是中国本体），不让 fitBounds 拿到 NaN */
const FALLBACK: LatLonBounds = [
  [3.5, 73.0],
  [54.0, 135.5],
];

/**
 * 初始视图的 fit 目标：把三沙市（460300）算在外。
 *
 * 它是全框里唯一越过 18°N 以南的块（minLat 3.840°，第二南的三亚在 18.144°），
 * 中间是 14° 的空海 —— 留着它，整张图就得为这段空海让位。
 * 截掉后高度 49.72° → 35.42°（-28.8%），同样的容器能多吃半档 zoom，大陆大一圈。
 * 块本身还在地图上（往下拖就是，点亮了照样是砖的），只是不占初始视野。
 *
 * 为什么不写死 center + zoom：写死的缩放必然把西北或南海那几块裁掉（全框 62°×50°），
 * 而这块图要的就是「除了最南那串岛礁，其余一块不裁」。
 */
export const FIT_SKIP_ADCODE = '460300';

export function initialBounds(geo: GeoCollection | null | undefined): LatLonBounds {
  const features = geo?.features;
  if (!features?.length) return boundsOf([]);
  return boundsOf(features.filter((f) => f?.properties?.adcode !== FIT_SKIP_ADCODE));
}

/** 一份 feature 集合的四至；不导出，外面只需要 initialBounds 这一个口径 */
function boundsOf(features: readonly GeoFeature[]): LatLonBounds {
  let south = 90;
  let west = 180;
  let north = -90;
  let east = -180;
  let seen = 0;

  for (const f of features) {
    const g = f?.geometry;
    // Polygon 是 [环][点]，MultiPolygon 是 [多边形][环][点]
    const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      for (const ring of poly) {
        for (const [lng, lat] of ring) {
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          seen++;
          if (lat < south) south = lat;
          if (lat > north) north = lat;
          if (lng < west) west = lng;
          if (lng > east) east = lng;
        }
      }
    }
  }

  return seen
    ? [
        [south, west],
        [north, east],
      ]
    : FALLBACK;
}
