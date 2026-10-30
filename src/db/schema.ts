import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
// 城市库（743 条 / 67KB）走动态 import：打包成独立 chunk，不抬高主包体积，
// 也避开首屏同步解析大 JSON（手册 §7：数据文件只允许在 src/db/ 里 import）

/** ============ 类型定义（与 DEVELOPMENT.md §3 对应） ============ */

export type Platform = 'xiaohongshu' | 'wechat';
export type Category = 'food' | 'travel' | 'unknown';
type CategorySource = 'auto' | 'manual';

export interface VideoRecord {
  id: string;
  url: string;
  platform: Platform;
  title: string;
  desc?: string;
  cover?: string;
  category: Category;
  categorySource: CategorySource;
  /** 关联城市 → cities.code；识别失败为 'unknown' */
  cityCode: string;
  /** 城市识别置信度 0~1（§5.1），手动选择视为 1 */
  geoConfidence?: number;
  parsedAt: number;
  note?: string;
  /** 最后一次人工修改时间（§4.6 合并时比这个判谁赢；缺省视为等于 parsedAt） */
  updatedAt?: number;
  /**
   * 「我去过这里」的点亮时刻（§6.6）。缺省 = 未点亮。
   * 只记在记录上，城市级的「去过」完全由它派生（见 listVisitedCities）——
   * 不另开一张表，是为了不让「记录删了但城市还亮着」这种脏状态有可能出现。
   */
  visitedAt?: number;
}

/** 删除标记（§4.6）：不记这个的话，本地删掉的记录下次拉取会从云上原样复活 */
export interface Tombstone {
  id: string;
  url: string;
  deletedAt: number;
}

/** 同步游标：只存一行，记录本机对齐到云上的哪个版本 */
export interface SyncMetaRecord {
  id: 'state';
  /** 云上快照版本号；0 = 从未同步过 */
  rev: number;
  updatedAt: number;
  lastPulledAt: number;
  lastPushedAt: number;
  /** 上次推上去的本地数据指纹（条数:最新时间）；变了才推，不每次拉完都白推一趟 */
  fingerprint: string;
}

export interface CityRecord {
  code: string;
  name: string;
  province: string;
  lng: number;
  lat: number;
  aliases: string[];
}

/** ============ 库表定义 ============ */

interface EatmapSchema extends DBSchema {
  videos: {
    key: string;
    value: VideoRecord;
    indexes: { 'by-url': string; 'by-city': string; 'by-category': string; 'by-parsedAt': number };
  };
  cities: {
    key: string;
    value: CityRecord;
  };
  tombstones: {
    key: string;
    value: Tombstone;
  };
  syncMeta: {
    key: string;
    value: SyncMetaRecord;
  };
}

const DB_NAME = 'eatmap';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<EatmapSchema>> | null = null;

/** 全局唯一连接（升级逻辑集中在此） */
export function getDB(): Promise<IDBPDatabase<EatmapSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<EatmapSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const videos = db.createObjectStore('videos', { keyPath: 'id' });
          videos.createIndex('by-url', 'url', { unique: true });
          videos.createIndex('by-city', 'cityCode');
          videos.createIndex('by-category', 'category');
          videos.createIndex('by-parsedAt', 'parsedAt');
          db.createObjectStore('cities', { keyPath: 'code' });
        }
        // v2：云端同步要的两张表（删除标记 + 同步游标），老库直接建空表即可，
        // 不需要迁移老数据 —— 老记录没 updatedAt 就按 parsedAt 算（见 merge.ts）
        if (oldVersion < 2) {
          db.createObjectStore('tombstones', { keyPath: 'id' });
          db.createObjectStore('syncMeta', { keyPath: 'id' });
        }
        // 未来加字段示例：升 DB_VERSION 后在这里做数据迁移
        // if (oldVersion < 3) { ... }
      },
    });
  }
  return dbPromise;
}

/** ============ 城市种子数据灌入（§3.2，启动时调用） ============ */

/**
 * 幂等 upsert，但只跑一次：城市库已从 68 扩到 743 条，
 * 而 MapPage / RankingPage / DataPage 各自 reload 都会调它，
 * 不做缓存就是每次进页面重跑 743 个 put。失败时清缓存以便重试。
 */
let seedPromise: Promise<number> | null = null;

export function seedCities(): Promise<number> {
  seedPromise ??= (async () => {
    const { default: citiesSeed } = await import('../data/cities.json');
    const db = await getDB();
    const tx = db.transaction('cities', 'readwrite');
    await Promise.all([
      ...citiesSeed.map((c) => tx.store.put(c as CityRecord)),
      tx.done,
    ]);
    return citiesSeed.length;
  })().catch((e) => {
    seedPromise = null;
    throw e;
  });
  return seedPromise;
}

/** 全量城市（城市识别 geo.ts 的词典也用它） */
export async function getAllCities(): Promise<CityRecord[]> {
  const db = await getDB();
  return db.getAll('cities');
}
