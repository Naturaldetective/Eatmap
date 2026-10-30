/**
 * 只声明本项目真会用到的 GeoJSON 片段（手册 §6.6）。
 * 不引 @types/geojson：为一个只读数据结构加依赖不值当，而且我们的几何是
 * 自己脚本生成的，字段就是 build-china-geo.mjs 写出去的那几个。
 */
export type Ring = [number, number][];

export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: Ring[];
}

export interface MultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: Ring[][];
}

export type Geometry = PolygonGeometry | MultiPolygonGeometry;

export interface GeoFeature {
  type: 'Feature';
  properties: { adcode: string; name: string };
  geometry: Geometry;
}

export interface GeoCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
}
