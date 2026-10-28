import { addVideo, deleteVideo, listVideos } from './videos';
import type { Category, VideoRecord } from './schema';

/**
 * 演示数据：不依赖真实链接抓取即可端到端验证地图/抽屉/榜单（M5）。
 * url 统一带 demo 标记，便于「清空示例数据」按前缀删除，绝不混入真实导入数据。
 */
const DEMO_URL_PREFIX = 'https://demo.eatmap.local/';
/** 导出给测试断言「示例数据不得混进真实导入的数据」 */
export { DEMO_URL_PREFIX as DEMO_PREFIX };

interface DemoSpec {
  cityCode: string;
  category: Category;
  title: string;
  desc: string;
}

const SPECS: DemoSpec[] = [
  // 成都：吃 6 + 玩 2（榜单应第一）
  { cityCode: '510100', category: 'food', title: '成都苍蝇馆子天花板，人均40吃到扶墙', desc: '#成都美食 探店，火锅串串香都在这家' },
  { cityCode: '510100', category: 'food', title: '成都本地人带路的苍蝇馆子Top5', desc: '探店 火锅 冒菜 人均 招牌菜' },
  { cityCode: '510100', category: 'food', title: '成都早餐这样吃，巴适得板', desc: '甜水面 肥肠粉 早餐 老字号' },
  { cityCode: '510100', category: 'food', title: '成都玉林路小店，撸串喝啤酒', desc: '夜市 烧烤 夜宵 撸串' },
  { cityCode: '510100', category: 'food', title: '成都必吃火锅避坑指南', desc: '火锅 点单 菜单 排队 性价比' },
  { cityCode: '510100', category: 'food', title: '藏在成都居民区的日料小馆', desc: '料理 日料 人均 探店' },
  { cityCode: '510100', category: 'travel', title: '成都市区 citywalk 一日游路线', desc: '景点 打卡 路线 拍照 公园' },
  { cityCode: '510100', category: 'travel', title: '青城山都江堰两日游攻略', desc: '攻略 门票 民宿 路线 徒步' },

  // 广州：吃 5 + 玩 1
  { cityCode: '440100', category: 'food', title: '广州早茶老字号合集', desc: '早茶 点心 虾饺 老字号 人均' },
  { cityCode: '440100', category: 'food', title: '广州探店：城中村宝藏大排档', desc: '探店 大排档 夜市 好吃' },
  { cityCode: '440100', category: 'food', title: '广州平价粤菜餐厅推荐', desc: '餐厅 粤菜 菜单 性价比' },
  { cityCode: '440100', category: 'food', title: '广州糖水铺子，夏天续命', desc: '甜品 糖水 下午茶 好吃' },
  { cityCode: '440100', category: 'food', title: '广州深夜食堂砂锅粥', desc: '夜宵 宵夜 烧烤 粥' },
  { cityCode: '440100', category: 'travel', title: '广州周末去哪儿：沙面+东山口', desc: '打卡 拍照 古镇 citywalk' },

  // 重庆：吃 4 + 玩 3
  { cityCode: '500000', category: 'food', title: '重庆老火锅，本地人不去洪崖洞', desc: '火锅 探店 辣 人均 招牌菜' },
  { cityCode: '500000', category: 'food', title: '重庆小面 Top 榜', desc: '面馆 早餐 小吃 好吃' },
  { cityCode: '500000', category: 'food', title: '重庆江湖菜，量大管饱', desc: '馆子 江湖菜 干饭 苍蝇馆子' },
  { cityCode: '500000', category: 'food', title: '重庆夜市烧烤一条街', desc: '夜市 烧烤 夜宵 撸串' },
  { cityCode: '500000', category: 'travel', title: '重庆洪崖洞夜景攻略', desc: '景点 夜景 打卡 门票 攻略' },
  { cityCode: '500000', category: 'travel', title: '重庆山城步道徒步路线', desc: '徒步 路线 景点 拍照 攻略' },
  { cityCode: '500000', category: 'travel', title: '武隆天生三桥一日游', desc: '景区 门票 攻略 行程 自驾' },

  // 上海：吃 3 + 玩 3
  { cityCode: '310000', category: 'food', title: '上海本帮菜老字号', desc: '餐厅 本帮菜 老字号 人均' },
  { cityCode: '310000', category: 'food', title: '上海咖啡探店地图', desc: '咖啡 咖啡馆 探店 下午茶' },
  { cityCode: '310000', category: 'food', title: '上海生煎包子哪家强', desc: '小吃 早餐 好吃 排队' },
  { cityCode: '310000', category: 'travel', title: '上海外滩+陆家嘴一日游', desc: '景点 打卡 路线 拍照' },
  { cityCode: '310000', category: 'travel', title: '上海博物馆导览', desc: '博物馆 门票 攻略 展览' },
  { cityCode: '310000', category: 'travel', title: '上海市区 citywalk 路线', desc: 'citywalk 打卡 拍照 小众' },

  // 长沙：吃 3 + 玩 1
  { cityCode: '430100', category: 'food', title: '长沙臭豆腐排队也要吃', desc: '小吃 排队 好吃 夜宵' },
  { cityCode: '430100', category: 'food', title: '长沙湘菜馆推荐', desc: '餐厅 湘菜 辣 人均' },
  { cityCode: '430100', category: 'food', title: '长沙奶茶一条街', desc: '奶茶 喝 下午茶 探店' },
  { cityCode: '430100', category: 'travel', title: '橘子洲头一日游攻略', desc: '景点 攻略 打卡 门票' },

  // 杭州：吃 1 + 玩 5（玩为主，气泡应偏青绿）
  { cityCode: '330100', category: 'food', title: '杭州片儿川老字号', desc: '面馆 小吃 好吃' },
  { cityCode: '330100', category: 'travel', title: '西湖环湖步行全攻略', desc: '景点 攻略 徒步 拍照 免费' },
  { cityCode: '330100', category: 'travel', title: '灵隐寺祈福路线', desc: '景点 门票 攻略 路线' },
  { cityCode: '330100', category: 'travel', title: '杭州两日游行程规划', desc: '行程 攻略 民宿 门票 景点' },
  { cityCode: '330100', category: 'travel', title: '西溪湿地坐摇橹船', desc: '景区 门票 风景 小众' },

  // 西安：吃 2 + 玩 4
  { cityCode: '610100', category: 'food', title: '西安回民街避坑指南', desc: '小吃 美食 夜市 人均' },
  { cityCode: '610100', category: 'food', title: '西安肉夹馍必吃榜', desc: '小吃 好吃 早餐 排队' },
  { cityCode: '610100', category: 'travel', title: '兵马俑购票参观攻略', desc: '景点 门票 攻略 博物馆' },
  { cityCode: '610100', category: 'travel', title: '西安城墙骑行路线', desc: '景点 骑行 攻略 门票' },

  // 北京：吃 2 + 玩 2
  { cityCode: '110000', category: 'food', title: '北京铜锅涮肉老字号', desc: '火锅 涮肉 餐厅 人均' },
  { cityCode: '110000', category: 'food', title: '北京豆汁儿到底能不能喝', desc: '小吃 味道 老字号 挑战' },
  { cityCode: '110000', category: 'travel', title: '故宫深度游路线', desc: '景点 故宫 门票 攻略 拍照' },
  { cityCode: '110000', category: 'travel', title: '北京胡同 citywalk', desc: 'citywalk 打卡 小众 拍照' },

  // 未识别城市 + 待定分类（验证 unknown 不进榜、可人工纠正）
  { cityCode: 'unknown', category: 'unknown', title: '随手记录的一顿饭', desc: '今天随便吃点' },
];

function build(spec: DemoSpec, i: number): Parameters<typeof addVideo>[0] {
  return {
    url: `${DEMO_URL_PREFIX}${spec.category}-${i}-${spec.cityCode}`,
    platform: i % 2 === 0 ? 'xiaohongshu' : 'wechat',
    title: spec.title,
    desc: spec.desc,
    category: spec.category,
    categorySource: 'auto',
    cityCode: spec.cityCode,
    geoConfidence: spec.cityCode === 'unknown' ? 0 : 0.9,
  };
}

/** 载入示例数据（幂等：url 已存在则跳过），返回新增条数 */
export async function loadDemoData(): Promise<number> {
  let added = 0;
  for (let i = 0; i < SPECS.length; i++) {
    const r = await addVideo(build(SPECS[i], i));
    if (r.ok) added++;
  }
  return added;
}

/** 清空示例数据（按 demo url 前缀），返回删除条数。真实导入数据不受影响 */
export async function clearDemoData(): Promise<number> {
  const all = await listVideos();
  const demos = all.filter((v: VideoRecord) => v.url.startsWith(DEMO_URL_PREFIX));
  for (const v of demos) await deleteVideo(v.id);
  return demos.length;
}
