# Eatmap（吃图）

把小红书 / 公众号链接批量变成「哪个城市有什么好吃的」地图：粘一批链接 → 自动取回标题与正文 → 识别城市和「吃 / 玩」分类 → 在地图上按城市聚合成气泡，并给出推荐榜单。主存储在各浏览器本地（IndexedDB），可选开一个口令把数据同步到云端，项目本体是纯静态站。

设计与决策的完整记录在 [DEVELOPMENT.md](./DEVELOPMENT.md)，这份 README 只讲怎么用、为什么这么设计。

## 功能

| 页面 | 路由 | 作用 |
| --- | --- | --- |
| 地图 | `/` | 城市气泡（大小=条目数，颜色=吃/玩构成），点气泡开抽屉看该城市清单 |
| 导入 | `/import` | 批量粘链接 / 分享文案 / 取词 JSON，逐行显示抓取与识别状态，可就地改城市与分类后入库 |
| 榜单 | `/ranking` | 按城市聚合的综合得分（吃 ×权重 + 玩 ×权重）排行，点行跳地图并飞到该城市 |
| 数据 | `/data` | 导出 / 导入 JSON、编辑、删除，以及示例数据的灌入与清空；云端同步（设口令 / 立即同步 / 换口令迁移）也在这里 |

- 城市识别：743 城词典（全部地级单位 + 县级市 + 海南省直辖县，含别名），`#话题#` > 标题 > 正文分级打分，低于 0.6 标黄交人工复核。
- 分类：词表加权打分（`src/ingest/lexicon.ts`，持续迭代处），结果可解释（列出命中词与权重），人工改过的不被覆盖。
- 数据模型：`videos` + `cities` 两张表（v2 起再加 `tombstones` / `syncMeta` 两张同步附表），派生数据实时聚合不落库。

## 快速开始

```bash
npm install
npm run relay      # 另开一个终端：本机中转服务，监听 127.0.0.1:8787
npm run dev        # http://localhost:5173
npm test           # vitest run
npm run build      # 生产构建 → dist/（纯静态，可直接托管）
```

Node 26 起（`npm run relay` 直接 import `.ts`，无需构建中转）。中转只绑 `127.0.0.1`，不监听对外地址。

relay 同时挂两个端点：`/api/fetch`（抓取中转）与 `/api/data`（云端同步，本机存在 `.eatmap-sync/` 文件里，已 gitignore）；
vite 把两个路径都代理过去。不跑 relay 也能用：进页会探活，不通自动降级；云上则两个端点都由 EdgeOne Functions 提供（见下）。

## 抓取为什么需要一个本机中转

浏览器里发不出小红书愿意回正文的那个请求：

- 服务端按「请求像不像真实导航」决定给不给内容。门槛是**请求头三件套**——桌面 `User-Agent` + `Accept: text/html` + `Accept-Language: zh-CN`，缺后两者就被 302 到 `/login`（只回 36KB 的 SPA 壳，无标题无正文）。
- 浏览器内的 `fetch` 一定带 `Sec-Fetch-Dest: empty`（禁止头，JS 删不掉），同源也拿不到正文。
- Node 的 `global fetch`（undici）同一组头也只拿到壳——差异在请求指纹（header 名被全小写、顺序固定）。只有 `node:https` 原生请求给出 70KB 正文。

所以抓取这一跳放到浏览器外面：

```
浏览器 ──/api/fetch?url=<带 xsec_token 的原链>──▶ vite proxy ──▶ 127.0.0.1:8787 ──node:https──▶ 平台
                                                              ◀── JSON { ok, platform, status, finalUrl, meta }
```

`meta` 是结构化元数据（未截断正文、话题归一成 `#丹东美食#`、真实封面已升 https），前端直接跳过 HTML 解析。中转不可达时自动降级：中转 → r.jina.ai → 公共 CORS 代理 → 分享文案粘贴 → 页签取词 → 手动录入。

安全约束：目标域名白名单（小红书 / xhslink / 公众号，仅 http(s)），白名单外一律 400 且不发请求；跟随重定向时每一跳复校白名单；响应 `Cache-Control: no-store`（`xsec_token` 是凭证，不留本机缓存）；日志只打 `host + pathname`，不落 token。

云上形态已跑通：同一套代码放在 `node-functions/api/fetch.ts`（EdgeOne Pages Node Functions，路由 `/api/fetch`），
直接 import `server/` 里那套，**零副本**；推送到关联仓库即自动发布，不依赖本机终端。

配置项（都可省）：

| 项 | 作用 |
| --- | --- |
| `RELAY_ALLOWED_ORIGINS` | 设了就精确回源 + `Vary: Origin`，不设默认 `*`（本机自用） |
| `VITE_RELAY_URL` | 构建期指定中转地址 |
| 导入页的中转输入框 | 存在 localStorage（`eatmap.relayUrl`），优先级最高，方便指向已部署的中转 |

抓取必须用**带 token 的原地址**，入库/去重才用剥掉 token 的规范地址——两条地址由 `splitLinks()` 一次产出，别混用（裸地址必被踢 404）。

## 目录

```
eat-map/
├── src/
│   ├── ingest/       # 链接解析、抓取管线、中转地址配置、城市识别、分类（全是纯函数）
│   ├── db/           # IndexedDB 表定义与 CRUD + 聚合，唯一的数据入口
│   ├── sync/         # 云端同步：merge.ts（合并规则）/ cloud.ts（拉推调度）/ SyncCard.tsx
│   ├── map/ pages/ ui/
│   └── data/cities.json   # 由 scripts/build-cities.mjs 生成
├── server/           # 浏览器外面那一跳：relayCore/relayNode（抓取）+ syncCore/syncFileStore（同步）
├── node-functions/   # 云上服务端：api/fetch.ts（中转）+ api/data.ts（同步，读写 EdgeOne Blob）
├── scripts/          # relay.mjs 入口；城市库采集与生成
└── DEVELOPMENT.md    # 数据模型、识别规则、跨域对策、云端同步、视觉规范、部署、风险表的完整记录
```

服务端代码只有一套：`node-functions/` 直接 import `server/` 里的纯逻辑，本机 relay 与云上函数跑同一份判定，
不会出现「本地好的、云上不一样」。

## 数据与隐私

主存储在浏览器 IndexedDB，绑定「域名 + 浏览器 + 浏览器用户配置」；不存视频本体，只存链接与元信息，点击跳回原平台。

想跨设备共用，在「数据页」设一个空间口令就自动同步（详见 DEVELOPMENT.md §4.6）：

- 流程是「拉 → 合并进本地 → 本地全量推回」，地图/榜单/离线始终读本地，同步挂了不影响浏览；
- 云上只存一份全量快照（`spaces/<口令哈希>/state.json`，EdgeOne Blob），合并规则只在前端一份；
- **口令本身不上网，上网的是它的哈希**，哈希等价于 bearer 凭证 —— 口令要当密码保管，忘了云上那份就找不回；
- 数据在公网上是**明文快照**（只是按口令分开），只放探店记录，别塞敏感信息；不想开就不填口令，行为跟纯本地一致。

本地兼底：导出 / 导入 JSON 仍是标配流程，没设口令时清缓存依旧会丢。

## 已知局限

- 主力抓取通道是自己机器上的中转，忘了 `npm run relay` 就退到 r.jina.ai（匿名约 20 次/分钟）。
- ~~部署版中转未做~~ → 已上线：EdgeOne Pages `node-functions/api/fetch.ts`（机房出口 IP 未被风控，函数路由优先于 SPA 回退）；Vercel 形态仍未做（SPA rewrite 会吞 `/api/*`）。
- 同步接口 `/api/data` 本身公开可调，靠「目录按口令哈希分开」保护；多设备并发写靠 rev 冲突重试收敛。
- 城市库来自阿里 DataV.GeoAtlas，台湾省文件 404 暂不收录；识别是词法匹配，歧义靠置信度标黄 + 人工复核兜底。
