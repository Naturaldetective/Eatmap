import { describe, expect, it } from 'vitest';
import cities from '../data/cities.json';
import { adcodeOf, blockAdcodes, groupByBlock, litProvincesOf, loadGeo, loadProvinces, provinceAdcodeOf } from './adcode';
import { FIT_SKIP_ADCODE, initialBounds } from './geoBounds';
import type { GeoCollection, GeoFeature } from './geoTypes';

type CityRow = { code: string; name: string };

describe('城市 code → 色块 adcode（§6.6）', () => {
  /** 这份对账 build-china-geo.mjs 生成时也会做一遍，测试是第二道闸：
   *  城市库加了新码而几何没重生成时，这里必须先红，而不是让用户看到点不亮的城市 */
  it('743 城一个孤儿都不许有', async () => {
    const blocks = blockAdcodes(await loadGeo());
    const orphans = (cities as CityRow[]).filter((c) => !adcodeOf(c.code, blocks));
    expect(orphans.map((c) => `${c.code}(${c.name})`)).toEqual([]);
  });

  it('直辖市 / 特别行政区 / 省直辖县级市直接命中自己的块', async () => {
    const blocks = blockAdcodes(await loadGeo());
    for (const ad of ['110000', '120000', '310000', '500000', '810000', '820000', '429004', '469001']) {
      expect(blocks.has(ad)).toBe(true);
      expect(adcodeOf(ad, blocks)).toBe(ad);
    }
  });

  it('县级市并入上级地级块：点亮遵化，亮的是唐山那块', async () => {
    const blocks = blockAdcodes(await loadGeo());
    expect(blocks.has('130281')).toBe(false);
    expect(adcodeOf('130281', blocks)).toBe('130200');
  });

  it('不是 6 位数字的一律不落块（unknown、截断、多余位数都算）', () => {
    const blocks = new Set(['130200']);
    for (const bad of ['unknown', '', '13020', '1302000', 'abc123', '1302 0']) {
      expect(adcodeOf(bad, blocks)).toBe('');
    }
  });

  it('groupByBlock：同块的归一起，落不到块的丢掉', () => {
    const blocks = new Set(['130200']);
    const rows = [
      { cityCode: '130200', tag: '唐山' },
      { cityCode: '130281', tag: '遵化' },
      { cityCode: 'unknown', tag: '定位失败' },
    ];
    const g = groupByBlock(rows, blocks);
    expect([...g.keys()]).toEqual(['130200']);
    expect(g.get('130200')!.map((r) => r.tag)).toEqual(['唐山', '遵化']);
  });
});

describe('几何数据本身（脚本产出物）', () => {
  it('FeatureCollection 结构完整，adcode 唯一', async () => {
    const geo = await loadGeo();
    expect(geo.type).toBe('FeatureCollection');
    expect(geo.features.length).toBeGreaterThan(300);
    const seen = new Set<string>();
    for (const f of geo.features) {
      expect(f.properties.adcode).toMatch(/^\d{6}$/);
      expect(f.properties.name.length).toBeGreaterThan(1);
      expect(['Polygon', 'MultiPolygon']).toContain(f.geometry.type);
      expect(seen.has(f.properties.adcode)).toBe(false);
      seen.add(f.properties.adcode);
    }
  });

  it('同一个 promise 只解析一次（1MB 的文件不许来回拉）', async () => {
    expect(await loadGeo()).toBe(await loadGeo());
  });
});

describe('色块 → 省份（§6.6 省界分组线、面板标题与战果卡）', () => {
  it('34 个省，且每个色块都落在某个省里：对不上就是两份几何不同源', async () => {
    const [geo, prov] = await Promise.all([loadGeo(), loadProvinces()]);
    expect(prov.features.length).toBe(34);
    const provinces = blockAdcodes(prov);
    const orphans = geo.features
      .map((f) => f.properties.adcode)
      .filter((ad) => !provinces.has(provinceAdcodeOf(ad)));
    expect(orphans).toEqual([]);
  });

  it('取省码：地级、直辖市、省直辖县级市都往前提两位', () => {
    expect(provinceAdcodeOf('130200')).toBe('130000'); // 唐山市 → 河北省
    expect(provinceAdcodeOf('110000')).toBe('110000'); // 直辖市就是自己
    expect(provinceAdcodeOf('429004')).toBe('420000'); // 仙桃（省直辖）→ 湖北
    expect(provinceAdcodeOf('unknown')).toBe('');
    expect(provinceAdcodeOf('13020')).toBe('');
  });

  it('litProvincesOf：同省几个块只计一次，省界表里没有的不凭空多一个省', () => {
    const provinces = new Set(['130000', '510000', '110000']);
    expect(litProvincesOf(['130200', '130100', '110000'], provinces)).toEqual(['110000', '130000']);
    expect(litProvincesOf(['130200', '999999', 'unknown'], provinces)).toEqual(['130000']);
    expect(litProvincesOf([], provinces)).toEqual([]);
  });
});

describe('初始视图外接框 initialBounds', () => {
  /** 一个 feature 的最南点：Polygon 是 [环][点]，MultiPolygon 是 [多边形][环][点] */
  const minLat = (f: GeoFeature): number => {
    let lo = 90;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const poly of polys) for (const ring of poly) for (const [, lat] of ring) lo = Math.min(lo, lat);
    return lo;
  };

  it('四至截到海南以南：不含三沙，但北、西、东三边仍到头', async () => {
    const [[s, w], [n, e]] = initialBounds(await loadGeo());
    // 全框是 3.84°N 起（南沙）；截后下沿就是三亚的最南点，海南一块不裁
    expect(s).toBeGreaterThan(18);
    expect(s).toBeLessThan(18.2);
    expect(n).toBeGreaterThan(53);
    expect(w).toBeLessThan(74);
    expect(e).toBeGreaterThan(135);
    // 换来的高度：49.72° → 35.42°，这就是那半档 zoom 的来源
    expect(n - s).toBeLessThan(36);
  });

  it('截线只切三沙一块：除它以外没有别的块越过 18.1°N', async () => {
    // 这条防的是误伤：海南、广东、广西、台湾都在 18°N 以上，
    // 以几何数据里真有没有第二块低于截线为准，而不是凭印象
    const geo = await loadGeo();
    expect(geo.features.filter((f) => minLat(f) < 18.1).map((f) => f.properties.adcode)).toEqual([FIT_SKIP_ADCODE]);
    // 它仍然在几何里：只是不进初始视野，往下拖还在，点亮了照样是砖的
    expect(geo.features.some((f) => f.properties.adcode === FIT_SKIP_ADCODE)).toBe(true);
  });

  it('Polygon 与 MultiPolygon 都按点集取四至', () => {
    const geo = {
      type: 'FeatureCollection',
      features: [
        { geometry: { type: 'Polygon', coordinates: [[[100, 20], [101, 20], [101, 21]]] } },
        {
          geometry: {
            type: 'MultiPolygon',
            coordinates: [[[[120, 30], [121, 30], [120.5, 31]]], [[[90, 5], [91, 5], [90, 6]]]],
          },
        },
      ],
    } as unknown as GeoCollection;
    expect(initialBounds(geo)).toEqual([
      [5, 90],
      [31, 121],
    ]);
  });

  it('拿不到可用坐标时回落到兜底框，而不是把 NaN 交给 fitBounds', () => {
    const bad = [
      null,
      undefined,
      { type: 'FeatureCollection', features: [] },
      { type: 'FeatureCollection', features: [{ geometry: { type: 'LineString', coordinates: [] } }] },
      {
        type: 'FeatureCollection',
        features: [{ geometry: { type: 'Polygon', coordinates: [[[NaN, NaN]]] } }],
      },
    ] as unknown as (GeoCollection | null | undefined)[];
    for (const g of bad) {
      const [[s, w], [n, e]] = initialBounds(g);
      expect([s, w, n, e].every(Number.isFinite)).toBe(true);
      expect(s).toBeGreaterThan(0);
      expect(n).toBeGreaterThan(s);
    }
  });
});

describe('初始视图不能交给 maxBounds 兜底', () => {
  it('初始框只有 35° 高：视口比它大的低缩放下，任何 maxBounds 都会把中心夹偏', async () => {
    const [[s, w], [n, e]] = initialBounds(await loadGeo());
    // 高度只有 35°：截掉南沙之后更容易装进高窗口，
    // 这时 Leaflet 的「中心夹到 maxBounds 内」会退化成夹到框边（实测偏 195px）。
    // 这条断言钉住前提：几何要是哪天变得能装进任何视口（不可能），才轮到重新考虑 maxBounds。
    expect(n - s).toBeLessThan(55);
    expect(e - w).toBeLessThan(70);
    expect(s).toBeGreaterThan(0); // 全框都在北半球，视口一高就超出南边界
  });
});
