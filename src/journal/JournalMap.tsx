import { useCallback, useEffect, useMemo, useRef } from 'react';
import { GeoJSON, MapContainer, Pane, useMap, ZoomControl } from 'react-leaflet';
import type { Path } from 'leaflet';
import { blockStyle, PROVINCE_BORDER } from './palette';
import { initialBounds } from './geoBounds';
import type { LatLonBounds } from './geoBounds';
import type { GeoCollection } from './geoTypes';

interface Props {
  geo: GeoCollection;
  /** 34 个省级轮廓：只画分组线，不参与点亮 */
  provinces: GeoCollection;
  /** 已点亮的色块 adcode（一个块可能被它下辖的县级市点亮） */
  lit: ReadonlySet<string>;
  onSelect: (adcode: string) => void;
}

/**
 * 指针飞出地图时不一定有 mouseout（从最外圈直接甩出容器就是漏的），
 * 所以在容器上补一次兜底还原。必须放在 MapContainer 内部才拿得到 map。
 */
function ClearHoverOnLeave({ onClear }: { onClear: () => void }) {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    el.addEventListener('mouseleave', onClear);
    return () => el.removeEventListener('mouseleave', onClear);
  }, [map, onClear]);
  return null;
}

/**
 * 初始视图：四周只留 8px（别把漠河和三亚贴到容器边上），右边多让出一个战果卡。
 *
 * 卡片钉在视口右下角（248px 宽 + 距边 16），而地图是水平居中的：窗口越窄（或越高
 * —— zoom 越大，整张图往四周撑出去）东南沿海就正好落在卡片底下，挡住台湾。
 * 水平方向多留一个卡宽 + 缝，fit 出来的中心就左移半个预留量。
 * 关键是这不会把图缩小：大陆是高度受限的（1376×727 下摆宽 948px，右边白边 353px），
 * 吃掉那 278px 还剩得下，zoom 一档不掉；只有窗口窄到 ~1254px 以下才会开始换 zoom，
 * 那种情势下不避让就是拿台湾换大小，不划算。
 */
const CARD_RESERVED = 248 + 16 + 14;
const FIT_EDGE = 8;
const FIT_OPTIONS = {
  paddingTopLeft: [FIT_EDGE, FIT_EDGE] as [number, number],
  // 垂直方向不预留：那会直接扣掉可用的 117px 高度、把 zoom 降下去；水平错开就够了
  paddingBottomRight: [FIT_EDGE + CARD_RESERVED, FIT_EDGE] as [number, number],
  maxZoom: 6,
  animate: false,
};

/**
 * 把视图对准容器尺寸。
 * `MapContainer` 的 bounds 是在 map 创建那一刻用的，而那一刻容器高度未必是最终值
 * （顶栏、字体回流都会改它），算出来的缩放与中心就偏了，之后再没人纠正 ——
 * 表现就是「刚点进来时上下被裁、图还偏一边」。所以等一帧，量准了再 fit。
 * 容器尺寸变了要重算（窗口拖大拖小），但用户手动拖过/缩放过之后就不再抢他的视图。
 */
function FitInitial({ bounds }: { bounds: LatLonBounds }) {
  const map = useMap();
  useEffect(() => {
    let touched = false;
    let fitting = false;
    let raf = 0;
    const fit = () => {
      fitting = true;
      map.invalidateSize();
      map.fitBounds(bounds, FIT_OPTIONS);
      fitting = false;
    };
    // 自己 fit 也会走 zoomstart，不能拿它当「用户动过」，否则第一次 refit 就把后面的 resize 全屏蔽了
    const markTouched = () => {
      if (!fitting) touched = true;
    };
    const onResize = () => {
      if (touched) return;
      cancelAnimationFrame(raf); // 拖窗口时一帧内会报好几次，只 fit 最后一次
      raf = requestAnimationFrame(fit);
    };
    raf = requestAnimationFrame(fit);
    map.on('dragstart zoomstart', markTouched);
    const ro = new ResizeObserver(onResize);
    ro.observe(map.getContainer());
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      map.off('dragstart zoomstart', markTouched);
    };
  }, [map, bounds]);
  return null;
}

/**
 * 旅记地图：只有 GeoJSON 色块 + 省界分组线，不挂瓦片底图（手册 §6.6）。
 * 没有底图才干净得出一眼看完的「块状中国」，也省掉 GCJ-02 偏移和瓦片外链可用性两个变量。
 */
export default function JournalMap({ geo, provinces, lit, onSelect }: Props) {
  /** adcode → 已绘制的 path */
  const layers = useRef(new Map<string, Path>());
  /**
   * 事件回调与 style 一律读 ref：Leaflet 的 handler 只在创建那一次挂上去，
   * 直接闭包 lit / onSelect 就会永远停在首帧那份值上。
   */
  const litRef = useRef(lit);
  const pickRef = useRef(onSelect);
  pickRef.current = onSelect;
  /** 当前挂着 hover 色的那一个块，全局只会有一个 */
  const hoveredRef = useRef('');

  // style 函数身份必须保持稳定：react-leaflet 的 updateGeoJSON 一见到它换引用
  // 就整层重刷样式，白白把 370 个多边形走一遍。刷新改由下面这个 effect 做。
  const style = useMemo(
    () => (feature?: { properties?: { adcode?: string } } | null) =>
      blockStyle(litRef.current.has(feature?.properties?.adcode ?? '')),
    [],
  );

  /** 还原成常态：不管是 mouseout、换块还是飞离容器，走这一个口子，重复调用也无害 */
  const clearHover = useCallback(() => {
    const ad = hoveredRef.current;
    hoveredRef.current = '';
    layers.current.get(ad)?.setStyle(blockStyle(litRef.current.has(ad), false));
  }, []);

  useEffect(() => {
    litRef.current = lit;
    for (const [ad, layer] of layers.current) {
      // 正被 hover 的那一块重新点亮/熄灭时，保持 hover 色，等它自己 mouseout
      layer.setStyle(blockStyle(lit.has(ad), ad === hoveredRef.current));
      // SVG 按下发顺序叠色，不提到前面来的点亮块会被邻块压住
      if (lit.has(ad)) layer.bringToFront();
    }
  }, [lit]);

  useEffect(() => {
    const map = layers.current;
    return () => map.clear();
  }, []);

  // 初始视图按几何外接框 fitBounds：传了 bounds 就不能再传 center + zoom
  // （react-leaflet 里 center+zoom 优先，bounds 会被默默忽略）。
  // 用的是截过最南那串岛礁的框（geoBounds.ts），不是全框：换来半档 zoom
  const bounds = useMemo(() => initialBounds(geo), [geo]);

  return (
    <MapContainer
      className="journal-map"
      bounds={bounds}
      boundsOptions={FIT_OPTIONS}
      /* 档位要细到能兑住 fitBounds 算出来的缩放：截掉南沙只换来 0.45 档，
       * snap 留在 0.5 就会被向下取整抹平（实测 zoom 仍是 3、上下各白留 107px）。
       * 0.125 下实测吃到 zoom 3.375（大陆 701×514 → 908×668）；但 fit 的理想值落在两个档位
       * 之间，最多还要再被向下吃掉 1/8 档（≈ 8% 尺寸），所以细到 0.0625；
       * 这里不挂瓦片，档位不对齐瓦片网格没有代价。+/- 按钮不受影响，zoomDelta 默认仍是 1 整档。 */
      zoomSnap={0.0625}
      /*
       * 不设 maxBounds（只锁缩放区间）。视口比 maxBounds 大时，Leaflet 会把视图中心
       * 夹到框边上，而本页初始就是 zoom 3 上下、fit 目标又只有 35° 高 —— 高窗口下实测被夹得
       * 往下偏 195px，正好毁掉刚 fitBounds 好的居中。这里不挂瓦片，拖出界只是一片纸色，
       * 损失比错位小；minZoom 锁 3 免得缩成一粒沙找不到自己在哪。
       */
      minZoom={3}
      // 边界是按 1.1km 容差简化过的，放到太深的级别会数得出折角，不如锁住
      maxZoom={8}
      zoomControl={false}
      // 右下角要让给战果卡，而这里没挂任何瓦片，attribution 只剩一个 Leaflet 徽标
      attributionControl={false}
    >
      <FitInitial bounds={bounds} />
      <ClearHoverOnLeave onClear={clearHover} />
      <ZoomControl position="bottomleft" />
      <GeoJSON
        data={geo}
        style={style}
        onEachFeature={(feature, layer) => {
          // Leaflet 把 onEachFeature 的 layer 声明成 Layer，但 GeoJSON 里画出来的必是 Path
          const path = layer as Path;
          const ad = String(feature?.properties?.adcode ?? '');
          layers.current.set(ad, path);
          path.on({
            // hover 只改样式、绝不调 bringToFront/bringToBack：实测在指针底下重排 SVG
            // 会丢掉 mouseout，色就永久停在 hover 上。叠色顺序统一交给 [lit] 那个 effect。
            mouseover: () => {
              clearHover();
              hoveredRef.current = ad;
              path.setStyle(blockStyle(litRef.current.has(ad), true));
            },
            mouseout: () => {
              if (hoveredRef.current === ad) clearHover();
            },
            // 未点亮也开面板（亮着的列记录，没亮的只给「省份 · 城市」这个答案），见 JournalPage
            click: () => pickRef.current(ad),
          });
        }}
      />
      {/*
       * 省界单独一个 pane（zIndex 450 > overlayPane 的 400）而不是共用一层：
       * 点亮块在 [lit] 的 effect 里会 bringToFront()，同一个 renderer 内那一挪就把省界线盖到底下去了。
       * react-leaflet 的 Pane 会把 pane 名递进 context，里面的 GeoJSON 不用重复写 pane，
       * 而且 children 要等 pane 真建出来才挂载（renderer 找得到容器）。
       */}
      <Pane name="provinceBorders" style={{ zIndex: 450 }}>
        <GeoJSON data={provinces} style={PROVINCE_BORDER} />
      </Pane>
    </MapContainer>
  );
}
