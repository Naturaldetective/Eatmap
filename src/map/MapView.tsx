import { MapContainer, TileLayer, ZoomControl } from 'react-leaflet';
import type { ReactNode } from 'react';
import { AMAP_STREET, CHINA_CENTER, CHINA_ZOOM } from './mapConfig';

/**
 * 地图底座：接收 children（CityMarker / FlyController 等在 Map 上下文内的组件）。
 * 缩放控件改到左下角（.leaflet-default 的左上位置与控制面板叠在一起）。
 */
export default function MapView({ children }: { children?: ReactNode }) {
  return (
    <MapContainer
      center={CHINA_CENTER}
      zoom={CHINA_ZOOM}
      zoomSnap={0.5}
      minZoom={3}
      maxZoom={18}
      zoomControl={false}
      // 国内底图范围大致限定，避免飞到境外空白区
      maxBounds={[[-10, 60], [70, 150]]}
      maxBoundsViscosity={0.8}
    >
      <ZoomControl position="bottomleft" />
      {/* map-tiles：降饱和提亮，让底图退到背景层（样式见 index.css） */}
      <TileLayer url={AMAP_STREET.url} className="map-tiles" {...AMAP_STREET.options} />
      {children}
    </MapContainer>
  );
}
