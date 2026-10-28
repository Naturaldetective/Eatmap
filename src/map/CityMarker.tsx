import { Marker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { useMemo } from 'react';
import { bubbleSize, bubbleKind } from './mapConfig';
import type { CityCount } from '../db/videos';
import type { CityRecord } from '../db/schema';

interface Props {
  city: CityRecord;
  count: CityCount;
  onClick: (code: string) => void;
}

/** 生成气泡 divIcon：尺寸随总数、颜色随吃/玩占比、中央只留条数（样式在 index.css .bubble-*） */
function makeIcon(count: CityCount): L.DivIcon {
  const size = bubbleSize(count.total);
  const kind = bubbleKind(count.foodCount, count.travelCount);
  const html = `
    <div class="bubble bubble-${kind}" style="width:${size}px;height:${size}px;font-size:${Math.max(11, size / 3.1)}px;">
      ${count.total}
    </div>`;
  return L.divIcon({
    html,
    className: '', // 去掉默认 div 背景/边框
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function CityMarker({ city, count, onClick }: Props) {
  const icon = useMemo(() => makeIcon(count), [count]);
  return (
    <Marker
      position={[city.lat, city.lng]}
      icon={icon}
      eventHandlers={{ click: () => onClick(city.code) }}
    >
      <Tooltip direction="top" offset={[0, -bubbleSize(count.total) / 2]}>
        <span className="font-semibold">{city.name}</span>
        <span className="ml-1.5 tabular-nums text-ink-3">
          吃 {count.foodCount} · 玩 {count.travelCount}
        </span>
      </Tooltip>
    </Marker>
  );
}
