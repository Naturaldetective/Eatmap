// 由 scripts/.cities_raw.json（DataV 行政区划权威数据）+ 原精修别名表生成 src/data/cities.json
// 规则：
//  1. 官方全称 → 常用简称（石家庄市→石家庄；自治州/盟/地区走显式简称表）
//  2. 简称与下辖县级市重名时，地级单位改用「X州 / X地区 / X盟」形式，避免词典歧义
//     （否则「大理」同时指向 大理白族自治州 与 大理市）
//  3. 原精修别名按 code 合并保留；自治州等补全称与「X州」为别名
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const R = dirname(dirname(fileURLToPath(import.meta.url)));
const raw = JSON.parse(readFileSync(join(R, 'scripts/.cities_raw.json'), 'utf8'));
const curated = JSON.parse(readFileSync('/tmp/cities_curated.json', 'utf8'));

const PROV = {
  11: '北京市', 12: '天津市', 13: '河北省', 14: '山西省', 15: '内蒙古自治区',
  21: '辽宁省', 22: '吉林省', 23: '黑龙江省', 31: '上海市', 32: '江苏省',
  33: '浙江省', 34: '安徽省', 35: '福建省', 36: '江西省', 37: '山东省',
  41: '河南省', 42: '湖北省', 43: '湖南省', 44: '广东省', 45: '广西壮族自治区',
  46: '海南省', 50: '重庆市', 51: '四川省', 52: '贵州省', 53: '云南省',
  54: '西藏自治区', 61: '陕西省', 62: '甘肃省', 63: '青海省', 64: '宁夏回族自治区',
  65: '新疆维吾尔自治区', 71: '台湾省', 81: '香港特别行政区', 82: '澳门特别行政区',
};

/** 民族地区显式简称（官方全称 → 常用简称） */
const SHORT = {
  延边朝鲜族自治州: '延边', 恩施土家族苗族自治州: '恩施', 湘西土家族苗族自治州: '湘西',
  阿坝藏族羌族自治州: '阿坝', 甘孜藏族自治州: '甘孜', 凉山彝族自治州: '凉山',
  黔西南布依族苗族自治州: '黔西南', 黔东南苗族侗族自治州: '黔东南', 黔南布依族苗族自治州: '黔南',
  楚雄彝族自治州: '楚雄', 红河哈尼族彝族自治州: '红河', 文山壮族苗族自治州: '文山',
  西双版纳傣族自治州: '西双版纳', 大理白族自治州: '大理', 德宏傣族景颇族自治州: '德宏',
  怒江傈僳族自治州: '怒江', 迪庆藏族自治州: '迪庆',
  临夏回族自治州: '临夏', 甘南藏族自治州: '甘南',
  海北藏族自治州: '海北', 黄南藏族自治州: '黄南', 海南藏族自治州: '海南州',
  果洛藏族自治州: '果洛', 玉树藏族自治州: '玉树', 海西蒙古族藏族自治州: '海西',
  昌吉回族自治州: '昌吉', 博尔塔拉蒙古自治州: '博尔塔拉', 巴音郭楞蒙古自治州: '巴音郭楞',
  克孜勒苏柯尔克孜自治州: '克孜勒苏', 伊犁哈萨克自治州: '伊犁',
  阿克苏地区: '阿克苏', 喀什地区: '喀什', 和田地区: '和田', 塔城地区: '塔城',
  阿勒泰地区: '阿勒泰', 大兴安岭地区: '大兴安岭', 阿里地区: '阿里',
  兴安盟: '兴安', 锡林郭勒盟: '锡林郭勒', 阿拉善盟: '阿拉善',
  // 海南省直辖自治县（算法截「族」会多留一个字，逐个显式给定）
  白沙黎族自治县: '白沙', 昌江黎族自治县: '昌江', 乐东黎族自治县: '乐东',
  陵水黎族自治县: '陵水', 保亭黎族苗族自治县: '保亭', 琼中黎族苗族自治县: '琼中',
};

const SPECIAL = { 香港特别行政区: '香港', 澳门特别行政区: '澳门', 神农架林区: '神农架' };

/**
 * 名称是常用词、会被无关文案误命中的，保留行政区但改用带后缀形式入词典。
 * 典型：甘南州府「合作」——「品牌合作/感谢合作」不该被判成甘肃合作市。
 */
const RENAME = { 合作: '合作市', 东方: '东方市', 同仁: '同仁市', 乌苏: '乌苏市', 龙井: '龙井市' };

/** 官方全称 → 简称；级别由 parent 字段判定（有 parent 即下辖县级单位），不能按名称长度猜 */
function shorten(full, parent) {
  if (SPECIAL[full]) return { name: SPECIAL[full], level: 'special' };
  if (SHORT[full]) return { name: SHORT[full], level: 'prefecture-ethnic' };
  if (full.endsWith('市')) return { name: full.slice(0, -1), level: parent ? 'county' : 'prefecture' };
  // 海南等省直辖县：普通县去尾缀「县」（自治县已在 SHORT 里逐个给定）
  if (full.endsWith('县') && full.length >= 3) return { name: full.slice(0, -1), level: 'county' };
  return { name: full, level: 'other' };
}

const rows = raw.rows.map(([code, full, lng, lat, parent]) => {
  const s = shorten(full, parent);
  return { code, full, name: RENAME[s.name] ?? s.name, level: s.level, parent, lng, lat, aliases: [] };
});

// 规则 2：简称被下辖县级市占用时，地级单位加后缀（大理州 / 阿克苏地区 / 锡林郭勒盟）
const countyNames = new Set(rows.filter((r) => r.level === 'county').map((r) => r.name));
for (const r of rows) {
  if (r.level !== 'prefecture-ethnic' || !countyNames.has(r.name)) continue;
  const suffix = r.full.endsWith('盟') ? '盟' : r.full.endsWith('地区') ? '地区' : '州';
  r.name = r.name + suffix;
}
// 同理处理普通地级市与县级市重名（如 吉林市 vs 桦甸市无冲突，但保留兜底）
for (const r of rows) {
  if (r.level !== 'prefecture') continue;
  const kids = rows.filter((k) => k.parent === r.code && k.name === r.name);
  if (kids.length) r.name = r.name + '市';
}

const unmapped = rows.filter((r) => r.level === 'other').map((r) => r.full);

// 合并精修别名 + 民族地区补全称/「X州」别名
const byCode = new Map(rows.map((r) => [r.code, r]));
for (const c of curated) {
  const t = byCode.get(c.code);
  if (t) t.aliases = [...new Set([...(t.aliases || []), ...(c.aliases || [])])];
  else byCode.set(c.code, { ...c, full: c.name, level: 'curated', parent: '', aliases: c.aliases || [] });
}
for (const r of byCode.values()) {
  if (r.level !== 'prefecture-ethnic') continue;
  const alt = [r.full];
  if (!r.name.endsWith('州')) alt.push(r.name + '州');
  r.aliases = [...new Set([...r.aliases, ...alt.filter((a) => a !== r.name)])];
}
// 别名不得与任何城市简称重名（否则 buildDictionary 会把别名指向错城）
const allNames = new Set([...byCode.values()].map((r) => r.name));
for (const r of byCode.values()) r.aliases = r.aliases.filter((a) => a !== r.name && !allNames.has(a));

const out = [...byCode.values()]
  .sort((a, b) => a.code.localeCompare(b.code))
  .map((r) => ({ code: r.code, name: r.name, province: PROV[r.code.slice(0, 2)] ?? '', lng: r.lng, lat: r.lat, aliases: r.aliases }));

const body = out.map((c) => `  ${JSON.stringify(c)}`).join(',\n');
writeFileSync(join(R, 'src/data/cities.json'), `[\n${body}\n]\n`);

const county = out.filter((c) => (byCode.get(c.code)?.level ?? '') === 'county').length;
console.log(`总计 ${out.length} 条｜县级市 ${county}｜地级 ${out.length - county}`);
console.log('未识别后缀的条目（需人工加简称表）:', unmapped.length ? unmapped : '无');
console.log('丹东:', JSON.stringify(out.find((c) => c.name === '丹东')));
console.log('抽样:', ['大理', '大理州', '延边', '海南州', '义乌', '昆山', '神农架', '香港', '白沙', '合作市'].map((n) => {
  const c = out.find((x) => x.name === n);
  return c ? `${n}=${c.code}` : `${n}=缺失`;
}).join(' '));
console.log('两字名（常用词误命中风险，需人工过一眼）:', out.filter((c) => c.name.length === 2).map((c) => c.name).join(' '));
