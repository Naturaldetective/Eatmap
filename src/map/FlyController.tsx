import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import type { CityRecord } from '../db/schema';

/** 选中城市时把地图飞到该城市并放大（§6.1 城市搜索 / 点击气泡） */
export default function FlyController({ target }: { target: CityRecord | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) {
      map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 6.5), { duration: 0.8 });
    }
  }, [target, map]);
  return null;
}
