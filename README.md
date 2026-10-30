# Eatmap（吃图）

把小红书 / 公众号链接批量变成「哪个城市有什么好吃的」地图：粘一批链接 → 自动取回标题与正文 → 识别城市和「吃 / 玩」分类 → 在地图上按城市聚合成气泡，并给出推荐榜单。主存储在各浏览器本地（IndexedDB），可选开一个口令把数据同步到云端，项目本体是纯静态站。

设计与决策的完整记录在 [DEVELOPMENT.md](./DEVELOPMENT.md)，这份 README 只讲怎么用、为什么这么设计。

> **部署：当前仅在腾讯 EdgeOne Pages 跑通**（静态站 + `node-functions/` 函数，路由 `/api/fetch` 与 `/api/data`）。
> 两个能力都依赖平台特性：**函数路由优先于 SPA 回退** + **真 Node 运行时**（能跑 `node:https`，§「为什么需要中转」）。
> 换别的托管要先解决这两件事（清单见 DEVELOPMENT.md §8），**Vercel 形态未做**（它的 `/(.*)` rewrite 会吞掉 `/api/*`）。

## 功能

| 页面 | 路由 | 作用 |
| --- | --- | --- |
| 地图 | `/` | 城市气泡（大小=条目数，颜色=吃/玩构成），点气泡开抽屉看该城市清单 + 未来一周天气 |
| 导入 | `/import` | 批量粘链接 / 分享文案 / 取词 JSON，逐行显示抓取与识别状态，可就地改城市与分类后入库 |
| 榜单 | `/ranking` | 按城市聚合的综合得分（吃 ×权重 + 玩 ×权重）排行，点行跳地图并飞到该城市 |
| 数据 | `/data` | 导出 / 导入 JSON、编辑、删除，以及示例数据的灌入与清空；云端同步（设口令 / 立即同步 / 换口令迁移）也在这里 |

- 城市识别：743 城词典（全部地级单位 + 县级市 + 海南省直辖县，含别名），`#话题#` > 标题 > 正文分级打分，低于 0.6 标黄交人工复核。
- 分类：词表加权打分（`src/ingest/lexicon.ts`，持续迭代处），结果可解释（列出命中词与权重），人工改过的不被覆盖。
- 城市天气：抽屉顶部一块「未来一周」（Open-Meteo，免 key、浏览器直连）。中性纸墨 + 细线图标，
  只有雷暴 / 暴雪 / 高温 / 降水 ≥80% 才借一次警示色；拿不到就缩成一行提示，不影响看视频。
- 数据模型：`videos` + `cities` 两张表（v2 起再加 `tombstones` / `syncMeta` 两张同步附表），派生数据实时聚合不落库。

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest run
npm run build      # 生产构建 → dist/（推上 EdgeOne Pages 即发布）
```

本机 dev 只跑前端：`/api/fetch` 与 `/api/data` 是站点自己的 EdgeOne Functions，本机没有，
所以导入页那盏中转灯在本地是红的、同步卡片会报「同步接口回的是网页」——都属预期，
抓取会自动降级到备用通道，不阻塞改样式与改识别规则。要验完整链路就 `npm run build` 后推到 EdgeOne 上测
（本地也可用 `edgeone pages dev` 跑真函数）。

## 抓取为什么需要中转

浏览器里发不出小红书愿意回正文的那个请求：

- 服务端按「请求像不像真实导航」决定给不给内容。门槛是**请求头三件套**——桌面 `User-Agent` + `Accept: text/html` + `Accept-Language: zh-CN`，缺后两者就被 302 到 `/login`（只回 36KB 的 SPA 壳，无标题无正文）。
- 浏览器内的 `fetch` 一定带 `Sec-Fetch-Dest: empty`（禁止头，JS 删不掉），同源也拿不到正文。
- Node 的 `global fetch`（undici）同一组头也只拿到壳——差异在请求指纹（header 名被全小写、顺序固定）。只有 `node:https` 原生请求给出 70KB 正文。

所以抓取这一跳放到浏览器外面，由站点自己的函数代跑（与页面同源）：

```
浏览器 ──同源 /api/fetch?url=<带 xsec_token 的原链>──▶ EdgeOne node-functions ──node:https──▶ 平台
                                                    ◀── JSON { ok, platform, status, finalUrl, meta }
```

`meta` 是结构化元数据（未截断正文、话题归一成 `#丹东美食#`、真实封面已升 https），前端直接跳过 HTML 解析。中转不可达时自动降级：中转 → r.jina.ai → 公共 CORS 代理 → 分享文案粘贴 → 页签取词 → 手动录入。

安全约束：目标域名白名单（小红书 / xhslink / 公众号，仅 http(s)），白名单外一律 400 且不发请求；跟随重定向时每一跳复校白名单；响应 `Cache-Control: no-store`（`xsec_token` 是凭证，不留任何缓存）；日志只打 `host + pathname`，不落 token。

代码分三层（**换平台只动最上面那层**）：

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 判定 | `server/relayCore.ts` | 零依赖纯逻辑：白名单、每跳复校、meta 解析、CORS（可单测、不碰网络） |
| 传输 | `server/relayNode.ts` | `node:https` 原生请求（上面的指纹结论落在这） |
| 适配 | `node-functions/api/fetch.ts` | EdgeOne 的 `Request`/`Response` ↔ 上面两个，路由 `/api/fetch` |

配置项（可省）：

| 项 | 作用 |
| --- | --- |
| `RELAY_ALLOWED_ORIGINS` | Pages 项目环境变量，中转与同步接口**共用**；设了就精确回源 + `Vary: Origin`，不设默认 `*`（同源调用无所谓） |

抓取必须用**带 token 的原地址**，入库/去重才用剥掉 token 的规范地址——两条地址由 `splitLinks()` 一次产出，别混用（裸地址必被踢 404）。

## 目录

```
eat-map/
├── src/
│   ├── ingest/       # 链接解析、抓取管线、中转探活、城市识别、分类（全是纯函数）
│   ├── db/           # IndexedDB 表定义与 CRUD + 聚合，唯一的数据入口
│   ├── sync/         # 云端同步：merge.ts（合并规则）/ cloud.ts（拉推调度）/ SyncCard.tsx
│   ├── weather/      # 城市未来一周天气：Open-Meteo 请求/解析/缓存 + 抽屉面板
│   ├── map/ pages/ ui/
│   └── data/cities.json   # 由 scripts/build-cities.mjs 生成
├── server/           # 浏览器外面那一跳的纯逻辑：relayCore/relayNode（抓取）+ syncCore（同步）
├── node-functions/   # 云上服务端（唯一运行位置）：api/fetch.ts（中转）+ api/data.ts（同步，读写 EdgeOne Blob）
├── scripts/          # 城市库采集与生成
└── DEVELOPMENT.md    # 数据模型、识别规则、跨域对策、云端同步、视觉规范、部署、风险表的完整记录
```

服务端只有一套逻辑：`node-functions/` 直接 import `server/` 里的纯逻辑（零副本），
换平台只需要再写一个薄适配层，不用重测判定。

## 数据与隐私

主存储在浏览器 IndexedDB，绑定「域名 + 浏览器 + 浏览器用户配置」；不存视频本体，只存链接与元信息，点击跳回原平台。

想跨设备共用，在「数据页」设一个空间口令就自动同步（详见 DEVELOPMENT.md §4.6）：

- 流程是「拉 → 合并进本地 → 本地全量推回」，地图/榜单/离线始终读本地，同步挂了不影响浏览；
- 云上只存一份全量快照（`spaces/<口令哈希>/state.json`，EdgeOne Blob），合并规则只在前端一份；
- **口令本身不上网，上网的是它的哈希**，哈希等价于 bearer 凭证 —— 口令要当密码保管，忘了云上那份就找不回；
- 数据在公网上是**明文快照**（只是按口令分开），只放探店记录，别塞敏感信息；不想开就不填口令，行为跟纯本地一致。

本地兜底：导出 / 导入 JSON 仍是标配流程，没设口令时清缓存依旧会丢。

## 已知局限

- 抓取主力通道是站点自己的函数，只在 EdgeOne Pages 上存在；本机 dev 跑不到它，自动降级到 r.jina.ai（匿名约 20 次/分钟）。
- ~~部署版中转未做~~ → 已上线：EdgeOne Pages `node-functions/api/fetch.ts`（机房出口 IP 未被风控，函数路由优先于 SPA 回退）；同步接口 `node-functions/api/data.ts` 同样已云上实测。**仅这一个平台验证过**，Vercel 形态仍未做（SPA rewrite 会吞 `/api/*`）。
- 预览域 `*.edgeone.cool` 带时效签名，**命令行 curl 一律 401**（回的是鉴权页），所以函数挂没挂只能在浏览器里看，curl 探不出来。
- 同步接口 `/api/data` 本身公开可调，靠「目录按口令哈希分开」保护；多设备并发写靠 rev 冲突重试收敛。
- 城市库来自阿里 DataV.GeoAtlas，台湾省文件 404 暂不收录；识别是词法匹配，歧义靠置信度标黄 + 人工复核兜底。
- 天气是外部依赖（Open-Meteo，免 key 但同样可能限流 / 改接口）：已用 60 分钟本地缓存 + stale-while-revalidate + 失败降级压到最低，
  最坏情况是抽屉顶部只剩一行提示，不会白屏。日期一律按 `Asia/Shanghai` 切，境外浏览器上也不会错一天。
