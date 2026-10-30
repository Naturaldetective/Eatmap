# 「吃图 EatMap」开发手册

> 一个纯前端的「美食/游玩地图」应用：导入小红书或微信公众号视频链接 → 自动识别城市并分类（吃 / 玩）→ 在地图上按城市展示符号，点击跳转原视频 → 根据各城市导入的视频数量排序，推荐游玩城市。
>
> 部署：**EdgeOne Pages（纯静态站 + node-functions）**，当前只在这个平台跑通；数据：主存储在各浏览器 IndexedDB，可选开云端同步（§4.6）。

---

## 1. 产品概述

### 1.1 核心用户流程

```
粘贴链接（小红书 / 微信公众号视频）
        │
        ▼
解析器提取标题 + 正文/标签文本
        │
        ▼
城市识别（文本 → 城市 → 经纬度坐标）
        │
        ▼
视频分类（吃 / 玩 / 待定）
        │
        ▼
写入 IndexedDB
        │
        ▼
地图渲染城市符号（数量越多，符号越大/越醒目）
点击符号 → 侧栏列出该城市视频 → 点击跳转原链接
        │
        ▼
推荐榜单：按「好吃的数量」降序排列城市
```

### 1.2 功能清单

| 编号 | 功能 | 说明 | 优先级 |
|---|---|---|---|
| F1 | 链接导入 | 支持单条粘贴 + 批量（每行一条），识别 `xiaohongshu.com` / `mp.weixin.qq.com` 链接 | P0 |
| F2 | 城市自动关联 | 从标题/正文/标签中识别城市名，定位到地图坐标 | P0 |
| F3 | 视频自动分类 | 判定「吃的视频」或「游玩的视频」，低置信度时允许人工修改 | P0 |
| F4 | 地图展示 | 城市位置放细线图标 + 数量气泡（大小＝条数，颜色＝吃/玩构成），点击符号弹出该城市视频列表，可跳转原链接 | P0 |
| F5 | 城市推荐排序 | 侧栏/榜单按城市「好吃的数量」降序推荐游玩城市 | P0 |
| F6 | 数据管理 | 支持编辑（改城市/改分类/删除）、导出 JSON、导入 JSON 备份 | P0 |
| F7 | 筛选 | 按分类（吃/玩）、城市、关键词筛选地图上的点 | P1 |
| F8 | 手动兜底 | 解析失败/城市识别不出时，手动选择城市与分类后保存 | P1 |
| F9 | 图片封面 | 视频封面缩略图展示（若可抓到） | P2 |
| F10 | 城市一周天气 | 城市抽屉顶部展示该城市未来 7 天预报，辅助「什么时候去」（§6.5） | P2 |
| F11 | 旅记 | 抽屉里逐条插旗「我去过」，旅记页按真实行政区划色块点亮全国（370 块 + 34 条省界分组线，点块看「省份 · 城市」明细）（§6.6） | P1 |

### 1.3 明确的设计约束（先说清楚，避免后期返工）

1. **默认数据只在浏览器本地**：IndexedDB 绑定「域名 + 浏览器 + 浏览器用户配置」，换设备/换浏览器/清缓存即丢失。因此 F6 的导出/导入 JSON 是**必须**做的备份通道，不是可选功能；跨设备则靠可选的云端同步（§4.6，不设口令就仍然纯本地）。
2. **本体是纯静态站，服务端只有两个同源函数**：浏览器里 fetch 拿不到小红书正文（§4.3），所以抓取那一跳必须在浏览器外面跑 —— 它就是站点自己的函数 `/api/fetch`（§4.5）；同步走 `/api/data`（§4.6）。两者都只存在于 EdgeOne Pages，本机 dev 没有这两个路径。
3. **不存储视频本身**：只存链接 URL + 元信息，点击跳转到原平台，无版权与存储压力。

---

## 2. 技术选型

| 领域 | 选型 | 理由 |
|---|---|---|
| 框架 | React 19 + TypeScript + Vite | 生态成熟，Vite 构建产物纯静态，天然适配静态托管 + 函数目录的形态 |
| 地图 | Leaflet + `react-leaflet`，底图用高德瓦片（GCJ-02） | 免费无需 token（对比 Mapbox/Google 需注册）；高德瓦片在国内网络可用；中国城市坐标统一用高德/腾讯体系的 GCJ-02，避免坐标偏移 |
| 本地数据库 | `idb`（IndexedDB 的轻量 Promise 封装） | 数据量目标 <1万条，IndexedDB 完全够用；localStorage 5MB 限制且是同步 API，不选 |
| UI 组件 | Tailwind CSS + 少量自绘组件（或 shadcn/ui） | 保持轻量 |
| 城市数据 | 内置 `cities.json`（743 条地级市+县级市，含别名），由 DataV.GeoAtlas 权威区划数据生成（见 §5.1）| 无后端也能离线完成「城市名→坐标」转换 |
| 视频分类 | 规则 + 词频打分（纯前端，见 §5） | 不上大模型：无后端、零成本、可解释、可人工纠正 |
| 跨域抓取 | 站点自己的同源函数 `/api/fetch`（`node-functions/api/fetch.ts`，唯一运行位置，§4.5）+ r.jina.ai 与公共 CORS 代理（降级），全不可用时走分享文案/页签取词/手动录入（§4.3） | 浏览器发不出小红书愿意回正文的那个请求（请求指纹，§4.3），必须有一跳在浏览器外面 |
| 部署 | EdgeOne Pages（静态站 + `node-functions/`，§4.5 / §4.6） | 当前唯一跑通的平台；平台还提供 Blob 存储当同步后端 |

> ⚠️ 不用 AMap/百度地图 JS SDK 的原因：需要开发者 key、配额管理，且 Leaflet + 高德瓦片已满足「打点 + 点击」的全部需求。若后续要行政区边界、POI 搜索再引入高德 Web 服务 API。

---

## 3. 数据模型（IndexedDB）

数据库名：`eatmap`，版本 `2`（v2 加了 `tombstones` / `syncMeta` 两张同步附表，见 §3.5）。
由 `src/db/schema.ts` 集中管理，**每次改表结构必须升 version 并写 `upgrade` 迁移**。

### 3.1 `videos`（主表：导入的视频）

```ts
interface VideoRecord {
  id: string;              // crypto.randomUUID()
  url: string;             // 原始链接（唯一索引，重复导入时提示）
  platform: 'xiaohongshu' | 'wechat';
  title: string;           // 解析出的标题，解析失败时为空、可手动补
  desc?: string;           // 正文摘要/标签文本（分类与城市识别的依据）
  cover?: string;          // 封面图 URL（P2，可空）
  category: 'food' | 'travel' | 'unknown';   // 吃 / 玩 / 待定
  categorySource: 'auto' | 'manual';         // 分类来源，manual 后不再被自动覆盖
  cityCode: string;        // 关联城市 → cities.code，识别失败为 'unknown'
  parsedAt: number;        // 时间戳
  updatedAt?: number;      // 最后修改时间（v2 起，§4.6 合并定胜负用；老数据缺省按 parsedAt 算）
  visitedAt?: number;      // 「我去过这里」的点亮时刻（§6.6，缺省 = 未点亮）；城市与色块的「去过」全由它派生
  note?: string;           // 用户备注
}
// 索引：url(unique), cityCode, category, parsedAt
```

### 3.2 `cities`（城市静态表，启动时从内置 cities.json 灌入）

```ts
interface CityRecord {
  code: string;            // 高德 adcode，如 '310000'
  name: string;            // '上海'
  province: string;        // '上海市'
  lng: number; lat: number;// GCJ-02 坐标
  aliases: string[];       // 别名/俗称，如 ['魔都', '申城']
}
```

### 3.3 派生数据（不落库，实时聚合）

- 城市计数：`GROUP BY cityCode` → 每城 `{foodCount, travelCount, total}`，用 `idb` 的索引遍历在内存聚合（万级以内 <10ms）。
- 推荐排序：`score = foodCount * 3 + travelCount * 1`（「吃的数量越多越靠前」为主权重，游玩数量为副权重；系数做成常量可调，见 §6）。
- 城市级「去过」：`visitedCitiesOf()` 纯函数，任一记录点亮就算去过、`firstAt` 取最早那次。**不给城市单独开一张「点亮表」**，
  是为了让「最后一条点亮记录被删/取消」这种脏状态不可能出现 —— 派生永远跟着记录走（§6.6）。

### 3.4 导出/导入格式

```json
{ "app": "eatmap", "version": 1, "exportedAt": 1730000000000, "videos": [ ...VideoRecord ] }
```
导入时按 `url` 去重合并（已有则跳过或覆盖，弹窗二选一）。cities 是静态数据，不需要导出。

云端快照（§4.6）是另一个格式，多两个字段：`rev`（服务端定的版本号）与 `deleted`（id → 删除时间）。
两者不通用，备份文件不能当快照推，反之亦然。

### 3.5 同步附表（v2）

```ts
interface Tombstone { id: string; url: string; deletedAt: number }  // 删除标记
interface SyncMetaRecord {                                          // 只一行，id: 'state'
  rev: number;              // 本机对齐到云上的快照版本，0 = 从未同步
  updatedAt: number;
  lastPulledAt: number; lastPushedAt: number;
  fingerprint: string;      // 上次推上去的数据指纹「条数:标记数:最新时间」
}
```

---

## 4. 链接导入与解析（F1/F2 的核心难点）

### 4.1 链接识别

| 平台 | 合法链接形态 |
|---|---|
| 小红书 | `https://www.xiaohongshu.com/explore/{noteId}?xsec_token=...`（**抓取必须带 token**，§4.3）、`https://xhslink.com/{short}`（短链需跟随重定向） |
| 微信公众号 | `https://mp.weixin.qq.com/s/{token}`、`.../s?__biz=...` |

正则见 `src/ingest/parse.ts` 的 `PLATFORM_PATTERNS`。不支持的链接直接拒绝并提示。

### 4.2 提取目标

从页面 HTML 里尽可能拿到：`title`、`desc/正文前 N 字`、`标签(#话题#)`、`cover`。
- 小红书：**渲染后 DOM 优先**（`#detail-title`、`#detail-desc`、`#detail-tag-id .tag`，正文比截断的 meta 完整），
  其次 `og:title` / `og:description` / `og:image`，兜底正则抠 `"title"` / `__INITIAL_STATE__`。
  入库标题一律剥掉「 - 小红书」站点后缀（`cleanTitle`）。
- 公众号：`<meta property="og:title">`、`og:description`，兜底 `msg_title` / `#activity-name` 文本。

### 4.3 跨域对策（按顺序降级）

1. **直连尝试** `fetch(url)` —— 少数环境可用，作为第一试。
2. **中转函数（当前主力通道，§4.5）**：站点自己的同源函数 `/api/fetch`（云上 node-functions），
   地址已在代码里写死为同源相对路径，无需任何配置。它不回 HTML 而是回**结构化 JSON**（`FetchHtmlResult.meta`）：正文未截断、
   话题已归一（`#丹东美食[话题]#` → `#丹东美食#`，识别因此走 `tag` 来源而不是 `desc`）、封面是真图。
3. **`https://r.jina.ai/{url}` + `x-return-format: html`**：第三方无头渲染中转，
   CORS 开放、境内可达（实测 1~3s）、无需 API key（匿名额度约 20 次/分钟，故 `RATE_LIMIT_MS=1200` 节流）。
   回传的是渲染后的 DOM，所以 §4.2 的 `#detail-*` 选择器直接命中；但只能拿到截断的 og 与站点 logo 当封面。
4. **公共 CORS 代理**（仅作公众号兜底）：`api.allorigins.win/raw`（实测对小红书直接 408）、
   `api.codetabs.com/v1/proxy`（境内不可达）。列表在 `src/ingest/proxies.ts`，可增删排序、每通道自带超时与失败切换。
5. **分享文案免网络解析**：小红书 App 复制的分享文案自带「标题 + 链接 + #话题」，`parseShareText()` 直接解析出元数据并进识别，**完全不走抓取**。
6. **页签取词（一次一条）**：中转失效时展开助手 —— `buildPickScript()` 生成的脚本在**已打开的笔记页签** Console 执行，
   读已渲染 DOM（`#detail-title` / `#detail-desc` / 话题）并 `copy()` 回传 JSON，粘回导入页写入。
   实测不能改成「脚本里批量 fetch 多条」：同源 `fetch()` 别的笔记时小红书只回 48KB 的 SPA 壳（无 og、无正文），
   真因是 fetch 必带禁止头 `Sec-Fetch-Dest: empty`（JS 改不了）且会自动带上登录 cookie，见下方第二次更正；
   批量请走 §4.5 的中转服务，或 §4.3-5 的分享文案粘贴（`parsePickList()` 仍支持一次粘多条取词结果）。
7. **手动录入（兜底）**：以上都不行时用户自己填标题+描述，系统照常识别。

> ⚠️ **M6 结论的第一次更正（2026-10 复测）**：原判定「小红书对匿名请求 302 到登录页、任何代理都拿不到正文」**是错的**，
> 根因在我们自己：`normalizeUrl()` 为去重把 `xsec_token` 剥掉后再去抓，而小红书**正是用这个 token 给分享链放行**。
> 实测（未登录浏览器）：带 token 的 `/explore/{id}` 返回 200，`og:title`、`#detail-desc`、话题、封面齐全；
> 不带 token 才被打到「小红书 - 你访问的页面不见了」（302 → `/404?source=/404/sec_xxx`）。
> 因此规则改为：**抓取用原地址（`Row.fetchUrl`，含 token），入库/去重用规范地址（`Row.url`，已去 token）**，
> 两者由 `splitLinks()` 一次产出；token 有有效期，所以**不入库**，只在本次会话的行里存活。
> 另：`corsproxy.io` 需付费 key（401），已从通道列表移除；「登录墙不可绕过」的说法作废，
> 但第三方中转仍是外部依赖，故 §4.3-5/6/7 三条免抓取路径继续保留为兜底。
>
> ⚠️ **第二次更正（同日，做中转时实测）**：第一次更正之后又判定「`xsec_source=app_share` 的 token 在 web 端强制登录、
> 只能收 pc_share」，**同样是误判** —— ImportPage 当时据此对 app_share 链接提前判失败（白白扔掉能成功的链接）。
> 拿同一篇笔记的两条链分别测：pc_share 与 app_share 经中转都返回 200 + 全文，真正的门槛是**请求头三件套**：
> 缺 `Accept: text/html,…` 或缺 `Accept-Language: zh-CN,zh;q=0.9` 才 302 到 `/login?redirectPath=…`（36KB 壳）。
> 与 token 来自哪个端无关，所以早退已删除，`shareSource()` 降级为纯诊断信息。另两条硬边界（都实测过，别再重试）：
> **浏览器内的 `fetch` 拿不到正文**（同源也不行，`Sec-Fetch-Dest: empty` 是禁止头）；
> **Node 的 `global fetch`（undici）也拿不到**（同一组头只回 36KB 壳），只有 `node:https` 原生请求给出 70KB 正文 ——
> 差别在请求指纹（undici 把 header 名全小写、顺序固定），细节见 §4.5。

### 4.4 重复导入

按 `url` 唯一索引检测；重复时提示「已存在，跳过 / 覆盖」。短链先解析成长链再比对。

### 4.5 中转函数（`server/` 纯逻辑 + `node-functions/api/fetch.ts`）

「像不像真实导航」是服务端判的，而浏览器发出的请求一定带着改不了的禁止头（§4.3 第二次更正），
所以这一跳必须挪到浏览器外面 —— 它就是站点自己的一个函数，与页面同源：

```
浏览器 ──同源 /api/fetch?url=<带 token 原链>──▶ EdgeOne node-functions ──node:https──▶ 小红书
                                            ◀── JSON {ok,platform,status,finalUrl,meta}
```

三个文件，边界刻意切开（**换平台只动最上面那层**）：

| 文件 | 职责 | 为什么这么切 |
|---|---|---|
| `server/relayCore.ts` | 纯逻辑：域名白名单、注入三头、`__INITIAL_STATE__` 解析、退化到 og / `msg_title`、HTTP 请求与响应组装 | 不 import 任何 node 模块，所以能在 vitest 里用 stub 传输层单测（`server/relayCore.test.ts`，14 条） |
| `server/relayNode.ts` | 传输层：`node:https` 原生请求 + 手动跟随重定向 | 换成 `global fetch` 就取不到正文，文件头已钉死这条注释 |
| `node-functions/api/fetch.ts` | 平台适配：EdgeOne 的 `Request`/`Response` ↔ 上面两个，路由 `/api/fetch` | 必须是 **node-functions** 而不是 edge-functions（下表）；函数路由优先于静态资源，所以不会被回退成 `index.html` |

为什么是 `node-functions/`：

| 目录 | 运行时 | 能不能拿到正文 |
|---|---|---|
| `edge-functions/` | V8 / Service-Worker 风格，**只有 Web `fetch`** | 很可能跟 undici 一样只拿到壳（同一个坑） |
| `node-functions/` | 真 Node.js，可用 `node:https` 与完整 npm | 能复用已验证的 `server/relayNode.ts` |

安全与隐私约束（每条都有测试兜着）：

- **目标域名白名单**（`www.xiaohongshu.com` / `xhslink.com` / `mp.weixin.qq.com`，仅 http(s)），白名单外一律 400 且**不发出请求** ——
  否则这个公开端点就变成了通用代理（白名单与「每跳复校」在服务端仍然生效，所以它能拿的只有三个域）。
- **重定向每一跳重新校验**白名单（防 SSRF 跳去 `169.254.169.254` / 内网地址）。
- 响应 `Cache-Control: no-store`：`xsec_token` 是凭证，不能被任何中间层缓存留下。
- 日志只打 `host + pathname`，token 在 query 里，进不了日志。
- `Access-Control-Allow-Origin` 默认 `*`（同源调用其实用不上 CORS）；设 `RELAY_ALLOWED_ORIGINS` 后精确回源 + `Vary: Origin`。

前端侧（`src/ingest/relay.ts`）**地址写死同源 `/api/fetch`，不可配**：函数与站点同源，再给一个输入框只是多一条能填错的路。
`RelayBar` 拿一条不存在的白名单地址探活，**只认中转自己的 JSON 信封**（`relayProbeVerdict`）：
400/502 只要信封在就算活，而「200 + HTML」算死 —— 纯静态托管会把未知路径回退成 `index.html` 并给 200，
只看状态码会把「站点上根本没中转」报成绿灯（云上实测过：应答 200 · 111ms，回的却是首页）。
封面域 `sns-webpic-qc.xhscdn.com` 实测无防盗链（带不带 Referer 都 200），但站内给的是 `http://`，中转已升成 `https://`，否则被混合内容拦截。

#### 已删除的本机形态（别再加回来）

云上函数可用之前，这一跳跑在自己机器上：`scripts/relay.mjs`（`npm run relay`，只绑 `127.0.0.1:8787`）
+ vite `server.proxy` + 导入页的中转地址输入框（localStorage `eatmap.relayUrl`）+ 构建期变量 `VITE_RELAY_URL`
+ 为「云上页面调本机 127.0.0.1」而发的 `Access-Control-Allow-Private-Network` 头；
同步侧还有 `.eatmap-sync/` 文件存储（`server/syncFileStore.ts`）与同步卡片的接口地址输入框。
云上端到端验通之后这些全部删了 —— 同一份逻辑现在只有一个运行位置，少一条「本地好的、云上不一样」的分叉。

代价（已知并接受）：`npm run dev` 抓不到真实正文，导入页灯是红的、同步卡片报「回的是网页」，自动降级到备用通道。
需要本地跑真函数时用 `edgeone pages dev`（http://localhost:8088），完整链路只能在云上验。

> 另：Vercel 形态仍未做。它的 SPA rewrite `/(.*)` 会吞掉 `/api/*`，需先改成 `/((?!api/).*)`；
> EdgeOne Pages 因为函数路由优先，没这个问题。部署细节见 §8。

---

### 4.6 云端同步（`server/syncCore.ts` + `node-functions/api/data.ts` + `src/sync/`）

静态托管站没有数据库，换设备/清浏览器缓存数据就没了。平台提供的持久化只有两种：

| 能力 | 结论 |
|---|---|
| 托管数据库 | **没有**（官方明确：无 SQL / 无 MongoDB） |
| KV 存储 | 仅 edge-functions（V8）可用，要控制台开通 + 绑命名空间，`list` 每次上限 256 键 |
| **Blob 存储** | `@edgeone/pages-blob`，`getStore('eatmap')` 首次调用自动建命名空间（零配置），1GB 免费、单对象 25MB，node-functions 可用 |

所以：**Blob 的 key 前缀当「表」用**，整个空间就一个 `spaces/<spaceId>/state.json`。

#### 语义：本地为主，云上是一份带版本的全量快照

流程固定为「拉 → 合并进本地 → 本地全量推回去」。服务端**不参与合并**：
合并规则（谁的时间新、删除怎么压制）只有前端 `src/sync/merge.ts` 一份，两边各写一遍必然漂移。
服务端只做三件事：校验快照、比 rev、存取存储。地图/榜单/离线全部照旧读 IndexedDB，同步挂了不影响浏览。

#### 并发：rev 乐观锁（平台的锁不可依赖）

`@edgeone/pages-blob` 的 `set(key, v, { onlyIfNew })` 在类型定义里标了 `@deprecated`、
**底层不强制**（已存在的 key 照样覆盖），所以不能拿它当锁。改成版本号：

- 客户端 PUT 带上自己拉到的 `baseRev`；服务端读当前快照（`consistency: 'strong'`，读己之写），
  `rev !== baseRev` 就回 **409 + 服务端当前快照**，客户端合并后重试（上限 2 次）；
- `rev` 与 `updatedAt` 一律由服务端写，客户端带来的值不采信；
- 快照响应恒带 `Cache-Control: no-store`，防中间层缓存把旧 rev 喂回来。

#### 三条合并硬规则（`src/sync/merge.ts`）

1. **先按 id 合流**：同一条记录本地/云端各一份时取时间新的 —— 不能当「重复」处理，
   否则会给自己下删除标记（这个坑踩过，表现为「同步一次数据自己消失」）；
2. **再按 url 归并**：不同 id 撞同一 url 才是真重复（两台设备各自粘了同一条链接），时间新的赢、
   同分本地赢，败者落删除标记并从本地删；
3. **删除按 id 压制**：只有 `tombstone.deletedAt >= 记录时间` 才判删；云端带来的无 url 标记也要保留并推回去，
   滤掉就等于把别人的删除抹了，第三台设备一拉集体复活。

落库时**先删后写**（`src/db/sync.ts` 的 `applyMerge`）：`videos.url` 是唯一索引，
同 url 换 id 时先 put 新记录会撞旧记录的索引。

#### 空间与口令

- `/api/data` 是公开接口，任何人都能调 → 数据按 `spaces/<spaceId>/` 分目录，
  `spaceId = sha256(口令)` 的十六进制前 16 位；
- **口令本身不上网，上网的是它的哈希**，所以哈希等价于 bearer 凭证：拿到就能读写该空间，
  口令要当密码保管（丢了 = 云上那份找得回但想不起口令）；
- 跨端一致性靠「同名字面量向量」钉住：`server/syncCore.test.ts` 与 `src/sync/spaceId.test.ts`
  各断言一次 `eatmap-demo → 3bf86d02c12030f5`，两边算法一漂就有一侧红（互相 import 反而测不出来）；
- 改口令 = 换空间，走客户端驱动的迁移：拉平旧空间 → 记新口令 → 推新空间 →（可选）`DELETE` 旧空间，
  服务端不需要 move 接口。

#### 触发时机

`App` 挂载与窗口 focus 时拉平，切到后台前推一次；导入页/数据页每次改动后 `scheduleSync()`
（防抖 1.5s，批量导入只推一趟）。推之前比数据指纹，一致就不白推。
删除标记保留 90 天（`SYNC_TTL_MS`）后清理 —— 某台设备离线超过这个窗口，会把别人早已删掉的记录拉回来。

> 数据在公网上是按口令分开的**明文快照**，只放探店记录，别塞敏感信息。

---

## 5. 城市识别与视频分类

### 5.1 城市识别（`src/ingest/geo.ts`）

策略：**文本匹配 + 层级优先 + 消歧**。

1. 清洗文本：`title + desc + 标签` 拼接。
2. 用 `cities.json`（**743 条：全部 369 个地级单位 + 374 个县级市 + 海南省直辖县**，含别名）做匹配：
   - 全量匹配：`成都会` → 命中「成都」；
   - 别名匹配：`成都` ⊂ aliases？→ 支持「春城」→昆明 这类；
   - 防误匹配：单字/双字常见词（如「海口」「丹东」中的「海」）→ 匹配时要求城市名前后不是干扰字符，长名优先（先试「哈尔滨」，避免被「尔滨」之类噪音干扰）；
   - **通名上下文黑名单**（`geo.ts` 的 `FALSE_CONTEXT`）：地名嵌在通名里时不是地名 —— 「鸭绿江的**入海口**」≠ 海南海口。
     只按「前一个字」判定（海口前面是入/出时不命中）而不做整词遮蔽，以免误伤「梅河口 / 老河口」这类真地名。
     这里是持续迭代处：新的误命中样本加一条词表就行，不要改匹配算法。
3. 命中多个城市时（如「成都绕不了一圈」标题里还有「重庆」）：
   - 优先 `#话题#` 标签里的城市；
   - 其次标题中出现位置最靠前的；
   - 仍无法确定 → `cityCode='unknown'`，进入人工选择（P1 列表页支持批量补城市）。
4. 识别结果记录 `geoConfidence`（0~1），<0.6 的在 UI 上标黄提示复核。**歧义只在同级证据之间算数**：
   话题与标题互相竞争才是真二义；正文里顺带出现的地名不会把话题/标题级的结论拉进标黄区
   （候选列表里仍然全部列出，人工复核时看得到）。结论本身来自正文时，同级竞争照旧全算。
   打分规则：
   - `#话题#`：同级唯一 0.9 / 同级多城 0.8；
   - 标题：标准名同级唯一 0.85 / 别名同级唯一 0.7 / 同级多城 0.55；
   - **正文（desc）：不管标准名还是别名、不管唯一还是多城，最高只给 0.55** —— 正文里顺带提到的
     城市不足以当归属结论，一律标黄交人工复核。

#### 城市库数据来源与再生成（M6 扩库）

早期只手写了 68 城，**缺城会引发连锁误判**：标题里的「丹东」不在库里被无声忽略，
识别就退到正文里顺带提到的「海口」，当时还给到 0.7 的自信分数（高于 0.6 不标黄）。
扩库到 743 城后漏城概率大降，但正文来源本身仍不可信，故已把 desc 上限压到 0.55（一律标黄），
该行为由 `src/ingest/geo.test.ts` 「正文唯一命中标准名 → 仍 <0.6 强制复核」钉住。

同一个样本还暴露了第二个问题：中转取回全文后该笔记的话题已归一成 `#丹东美食#`（应为 0.9 不标黄），
却被正文里的「鸭绿江的**入海口**」误算出一个海口当竞争城市、一路压到 0.55。因此加了
`FALSE_CONTEXT` 通名黑名单 + 「歧义只算同级」两条规则（上面的规则 2 与 4），
由 `geo.test.ts` 「通名上下文不算地名 / 话题结论不被正文顺带提到的城市拖黄」
与 `geoData.test.ts` 「但同级（标题 vs 标题）真二义仍必须标黄」钉住。

- 数据源：阿里 DataV.GeoAtlas `https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json`
  （CORS 开放，`properties.adcode/name/centroid` 即权威区划码 + 真实中心坐标；
  部分城市 `centroid` 为空需回退 `center`，如无锡；台湾省文件 404，暂不收录）。
- 采集：`node scripts/collect-cities.mjs` 起本地端口，浏览器内 fetch 全部区划后 POST 落盘
  （数据不过对话，且避开 curl）。
- 生成：`node scripts/build-cities.mjs` 读 `scripts/.cities_raw.json` + 旧精修表，输出 `src/data/cities.json`。规则：
  1. 官方全称 → 常用简称（石家庄市→石家庄；自治州/盟/地区走显式简称表，算法截「族」不可靠）；
  2. **简称与下辖县级市重名时，地级单位加后缀**：大理市=`大理`、大理白族自治州=`大理州`（否则「大理」二义）；
  3. **名称是常用词的改用带后缀形式**：合作/东方/同仁/乌苏/龙井 → `X市`，
     避免「品牌合作」「龙井虾仁」「乌苏啤酒」被当成城市；
  4. 别名不得与任何城市简称重名（自动剔除，修正了旧数据里「凤城」误挂清远的问题）；
  5. 旧表的精修别名按 code 合并保留（成都→蓉城、上海→魔都等）。
- 回归测试：`src/ingest/geoData.test.ts` 直接跑发布数据，守住「同词不多城」、县级市可识别、
  标题城市优于正文提及、常用词不误命中等约束。改城市库后必跑。

### 5.2 视频分类：吃 or 玩（`src/ingest/classify.ts`）

纯前端打分制规则分类器，**输出 `{category, confidence, hits}`**，hits 用于 UI 展示「为什么这么判」。

**词表**（`src/ingest/lexicon.ts`，初始版人工整理，后续按误判样本迭代）：

```
food 强词（权重3）：探店、美食、好吃、餐厅、饭店、小吃、烧烤、火锅、奶茶、咖啡、
                   面馆、早餐、夜宵、人均、菜单、点单、招牌菜、xx店、苍蝇馆子…
food 弱词（权重1）：吃、喝、味道、排队、性价比、碳水、辣、甜…
travel 强词（权重3）：景点、景区、攻略、打卡地、博物馆、公园、古镇、雪山、徒步、
                     自驾、住宿、民宿、酒店、门票、路线、行程、拍照、出片…
travel 弱词（权重1）：玩、逛、看、风景、周末、假期、citywalk…
```

**判定逻辑**：
1. 标题（×2 加权）+ 正文 + 标签逐词扫描，累计 `foodScore / travelScore`。
2. `score > 0` 的一侧且分差 ≥2 → 判胜；分差为 0/1 或全 0 → `unknown`（UI 标灰，等待人工选）。
3. 特殊规则：food 与 travel 同现且都很高 → 允许归类为「吃」优先（产品定位是「好吃的地图」，可配置）。
4. 人工修改后 `categorySource='manual'`，重新解析/编辑时不再自动覆盖。

> 词表命中示例会在卡片上以 tooltip 展示（如「命中：探店(3)、火锅(3) → 吃」），保证可解释性，方便你训练词表。

---

## 6. 地图与推荐（F4/F5）

### 6.1 地图页（主页）

- Leaflet 地图，中国视角初始（中心 ~[104, 35]，zoom 4.5），底图高德街道瓦片：
  `https://webrd0{1-4}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}`
- 每个有数据城市一个 `Marker`，用自定义 `divIcon`：
  - 主色由 `bubbleKind()` 决定：吃多→焦糖（`--color-food`）、玩多→松绿（`--color-travel`）、相当→对角硬分界双色；
    气泡内**只放条数、不放 emoji**（颜色即语义，图例写在控制面板底部）；
  - 尺寸 `size = 24 + log2(total)*8`，上限 64px；实心纯色 + 2px 白环 + 一层薄投影，hover 只做 `translateY(-1px) scale(1.06)`。
- 底图统一加 `.map-tiles`（`saturate(.62) contrast(.9) brightness(1.03)`）降饱和，让地图退到背景层、气泡成为唯一焦点；
  缩放控件移到左下（`zoomControl={false}` + `<ZoomControl position="bottomleft" />`），避开左上控制面板。
- 点击气泡 → 打开右侧抽屉（Drawer）：该城市视频列表（封面缩略图 + 标题 + 分类色点 + 录入日期），整卡可点新标签打开原视频。
- 左上**单一控制面板**（筛选分段 / 城市搜索 / 图例三段，内部 1px 线分区），不拆成多个漂浮胶囊。

### 6.2 推荐榜单页

- 顶部一行表头式说明（`kd-label`）把「列」的含义讲清楚；每行：序号 + 城市名/省 + 吃/玩计数（色点）+ 得分 + 3px 单色相对得分细条 + 右侧箭头（跳地图并飞至该城市）。
- 前三名只把序号染成焦糖色，不用奖牌 emoji。
- 前端实时聚合，无缓存需求；数据量 <1万条无需虚拟滚动。

### 6.3 导入页

- 大 textarea：每行一条链接，粘贴即解析，逐行显示状态机：
  `排队 → 抓取中 → 成功(展示 城市/分类 预览) / 失败(可重试/转手动)`。
- 顶部「中转服务」状态条（`RelayBar`，§4.5）：绿/红灯 + 探活耗时 + 当前地址，可直接填已部署的中转地址（存 localStorage）。
- 解析完成的行允许就地微调（下拉改城市、切分类），确认后入库。
- 低置信度用 `.kd-low`（暗金描边 + 米黄底 + `alert` 细线图标），不用 tailwind 亮 amber 粗边。

### 6.4 视觉规范（M7 定稿：可爱但不幼稚）

第一版走「马卡龙色 + emoji 图标 + 描边贴纸」，实测观感偏幼稚，已整体重做。
当前规则已落在 `src/index.css` 的 `@theme` 与 `.kd-*` 类里，**后续新增界面必须遵守**：

| 维度 | 现行规则 | 已废弃的做法 |
| --- | --- | --- |
| 颜色 | 中性纸墨承担 95%（`canvas/surface/surface-2`、`ink/ink-2/ink-3`、`line/line-2`）；彩色**只有** `food`（焦糖 #d9480f）与 `travel`（松绿 #0f7b6c）两个语义色（旅记页的「去过」点亮复用 `food`，不给它另配一支，§6.6），`warn/danger` 仅用于状态 | peach/bubblegum/mint/sky/butter 五色平铺 |
| 图标 | `src/ui/Icon.tsx` 细线图标（24 格画布、1.7 描边、round cap），可爱来自圆头线条 | 用 emoji 当图标（跨平台不一致，且是廉价感第一来源） |
| 圆角/描边 | 卡片 14px、按钮/输入 9px、chip 6px，圆形只给气泡与色点；边框统一 1px | 万物 9999px 胶囊 + 2px 米色描边 |
| 阴影 | 只两档：`shadow-soft`（贴在纸上）、`shadow-float`（面板/抽屉） | 厚投影 + inset 内阴影 |
| 字体 | 正文用规整黑体；标题 600、正文 400/500、次要 12px `ink-3`，数字一律 `tabular-nums` | 全站 700/800（没有轻重对比就没有高级感）、正文用圆体 |
| 渐变 | 只允许出现在品牌字；主按钮用墨色实底 | 主按钮/激活态/进度条三段渐变 |
| 动效 | 150–220ms `ease-out`，只做 opacity 与 ≤4px 位移（`.kd-enter`） | 弹跳 `kd-pop`、常驻漂浮 `kd-float`、气泡果冻高光与底部「脚丫」阴影 |
| 文案 | 陈述句、无叠词无波浪号（「地图上还没有气泡」） | 「还空空の呀」「投喂链接吧～」「排排坐」 |
| 布局 | 同组控件合并为一块面板并用 1px 内分区；页面标题右侧挂 `kd-label` 元信息 | 三四个各自漂浮的胶囊散落四角 |

例外：品牌艺术字 `src/ui/Wordmark.tsx` 是全站唯一允许“卖萌”的位置（暖橙双色渐变 + 贴纸白边 + 逐字母弹跳），
界面其余部分一律保持中性。改视觉后必须回跑 `npm test`：`src/map/mapConfig.test.ts` 已钉住 `bubbleKind()` 的新签名。

### 6.5 城市抽屉的「未来一周」天气（F10）

代码：`src/weather/{forecast.ts, wmo.ts, CityWeather.tsx}`，挂在 `CityDrawer` 滚动区首位（跟着列表一起滚，
列表一长就不该让它常驻占掉一百像素）。

**数据源：Open-Meteo**（`https://api.open-meteo.com/v1/forecast`）。选它的三条理由，都是实测过的：

1. **免 API key** —— 站点的密钥只进 EdgeOne 环境变量，前端任何密钥都是泄漏；免 key 就免去了「为天气再开一条服务端通道」。
2. **CORS 全开** —— 带 `Origin` 请求实测回 `access-control-allow-origin: *`，预检也放行，所以**浏览器直连**。
3. 一次请求就带回 7 天的 `weather_code` + 极值温度 + 降水概率，无需拼装。

> **不要**把这一跳塞进 `/api/fetch`（§4.5）。那个中转的域名白名单是刻意收窄到三个域的，
> 为一个公开天气接口放宽它，等于给 SSRF 面开门 —— 天气根本不需要服务端。

**参数与解析**（`buildForecastUrl` / `parseForecast`）：

- `timezone=Asia/Shanghai` **必须写死**。图里只覆盖中国城市，日期必须按当地日切；
  用默认（浏览器时区）时，境外浏览器上的「今天」会整体错位一天。
- `daily` 五列是**平行数组**，长度不齐时按最短的截；温度回 `null`（缺测）就丢掉那一天 ——
  宁可少显示两天，也不要渲染出 `NaN°`。任何垃圾响应一律回 `[]`，不抛。
- 日期靠 `todayInShanghai()`（`Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' })`）求，
  「明天」靠 `Date.parse(x + 'T00:00:00Z')` 的毫秒差判 —— 都不能碰 `new Date('YYYY-MM-DD')`，那按 UTC 解析。

**缓存与降级**（`loadForecast`）：localStorage 键 `eatmap.weather.<cityCode>`，TTL 60 分钟（上游本身一小时才更新一轮）；
策略是 stale-while-revalidate —— 有旧数据先渲染并标 `stale`（表头显示「· 刷新中」）并在后台刷新，刷新失败也不打扰用户。
超时 8s。任何失败都缩成一行 `ink-3` 提示（「…不影响看视频，再试一次」），**天气挂了就当没有这块**，绝不占住视频列表。
重试按钮走 `reloadForecast`，先清缓存再打网络。

**显示规则**（`CityWeather`）：

| 项 | 规则 | 为什么 |
| --- | --- | --- |
| 温度 | `Math.round` + `°`，高温 `ink` 600 / 低温 `ink-3`，一律 `tabular-nums` | 上游给一位小数，列表里没必要；数字不齐就不算精致 |
| 降水 | `< 30%` 整格不显示（`PRECIP_SHOW_MIN`），但占位高度保留 | 天天挂 10% 是噪声 |
| 警示色 | 仅 `isHarsh()`：雷暴 / 暴雪（大雪 75、强阵雪 86）/ `maxC ≥ 35` / 降水 `≥ 80%` 才用一次 `text-warn` | §6.4：`warn` 是状态，不是装饰；小雪/中雪在北方冬季是常态，一行里全染金就读不出重点了 |
| 今天列 | `bg-surface-2` 打底 + 表头加粗 | 不用彩色也能一眼定位「从哪天开始看」 |
| 表头 | 今天 / 明天 / 周几 | 日期数字要读，周几才是决策依据 |
| 署名 | 底部固定一行「预报为当日极值 · 天气数据来自 Open-Meteo」 | 许可要求署名；同时说清是极值，免得被当成逐小时预报 |

**图标**：`Icon.tsx` 新增 `sun/cloud/cloudSun/rain/snow/thunder/fog` 七个，共用同一套 24 格画布与 1.7 描边，
云形共用一个轮廓、靠下方的雨丝/雪叉/闪电/雾带区分，保证一排里视觉重量一致。两条实测教训：
雪叉**必须用十字**（X 形在 17px 下两笔会并成一个黑点），闪电要留够折角幅度但末笔收在画布内（`y ≤ 22.9`，越界会被裁）。
`wmo.ts` 是 WMO 码 → 「中文说法 + 图标名」的纯映射，强度只改文字不换图标（毛毛雨到暴雨同一个雨形）；
**认不出的码一律退回中性云形，绝不抛错** —— 天气拿不到不该影响看视频。

测试边界：`forecast.test.ts` / `wmo.test.ts` 用**实测抓回的真实响应**做 fixture 覆盖解析与显示规则；
「能不能取到天气」依赖外部服务，本机测不了，只能在浏览器里开抽屉看（§8 第 3 步）。

### 6.6 旅记页：插旗点亮全国（F11）

代码：`src/journal/`（`adcode.ts` / `palette.ts` / `geoTypes.ts` / `geoBounds.ts` / `JournalMap.tsx`）+ `src/pages/JournalPage.tsx`，
点亮入口在 `CityDrawer`。三条需求定下来的形态（都是问过再做的，不是自己猜的）：

- 地图要**真实行政区划色块**，不是方块网格、也不是 Leaflet 点位；
- **吃和玩都可点亮**（点亮是「我去过」，与分类无关）；
- **必须先有记录才能点亮** —— 没导入过视频的城市不许凭空点亮一个格子（不然地图会变成许愿池）。

**只多一个字段，同步协议零改动**。`VideoRecord.visitedAt`（§3.1）：

- 不升 DB version（无新表、无新索引），不升 `SYNC_STATE_VERSION`，不开新的 Blob key；
- 服务端 `validateState` 对 `videos` 是**原样透传**，所以新字段自动跟着快照走（§4.6）；
- 隔离沿用 `spaces/<sha256(口令)前16>/state.json`：别人拿不到你的空间 id，写入也进不去 ——
  旅记数据不需要新的隔离维度，也不需要新的存储形态；
- **点亮必须走 `updateVideo`**：它把 `updatedAt` 顶到当前时刻，而合并就按 `updatedAt` 定胜负（§4.6）。
  直接 `db.put` 改字段不顶时间，这次点亮会被云上那份「更晚改过但没点亮」的同 id 记录洗回去。
  `fingerprintOf` 也只看条数 + 最新时间，不顶时间连推送都不会发（`merge.test.ts` 钉住了这两条）。
- 取消点亮 = `visitedAt: undefined`，记录本身不丢；`JSON.stringify` 会把 undefined 键抹掉，快照里不残留。

**几何数据怎么来的**（`scripts/build-china-geo.mjs` → `src/data/chinaGeo.json` + `src/data/chinaProvinces.json`，
一次采集出两份：370 个地级色块 + 34 条省界分组线）。采集时撞到三条事实，
决定了成块规则（都能在 DataV.GeoAtlas 复核）：

1. `{省adcode}_full.json` **一次返回该省全部地级单位**，含 469001 五指山 / 429004 仙桃这类省直辖县级市
   —— 所以要逐个地级取 `_full` 的想法可以省掉，34 份省级请求就够。
2. 北上津渝港澳的 `_full` 返回的是**市辖区**（110101 东城区…），而城市库用的是省级码 110000。
   照搬会导致这 6 城根本没有块可点。所以脚本里 `SELF_BLOCK` 这 6 个码**改用省级自身轮廓**成块。
3. 台湾省 `_full` 404（与城市库口径一致，§10），取不到子区时**退回省界轮廓**自己占一块（而不是缺个洞），并记进 `skipped` 输出。

**体积控制**：原始 34 份 full 是几 MB 到几十 MB，不能直接进前端。Douglas-Peucker 简化 + 坐标保 4 位小数：
容差 `0.01°`（≈1.1km）→ **370 块 / 141994 → 62034 点 / 1.15MB（gzip 338KB）**。
DP 必须写成**迭代版**，递归在十万点的环上会爆栈。几何 `import()` 成独立 chunk（与 cities.json 同一套路，§7），
主包不受影响；`tsc -b` 实测 2.1s 也没被这份大 JSON 拖住。

省界**不额外打网络**：`100000_full.json` 本身就是 34 省的轮廓（市界就是从它的下级取的），
同一个脚本顺手写出一份 → **34 块 / 20630 点 / 0.37MB（gzip 119KB）**。
它的简化容差跟市界**保持一致**：两条线本该骑在同一条原始边界上，各简化各的容差会在深缩放时错开几像素，看着像省界画歪了。

**城市 → 色块 → 省份的映射**（`adcode.ts`）。色块只有地级一层（370），城市库有 743 条（339 地级 + 30 省直辖县 + 374 县级市）。
县级市若单独成块就嵌在上级市的块里重叠绘制，要挖洞得引多边形布尔运算 —— 不值当。所以**县级市并入上级地级块**：
依据是 adcode 编码规则（县级 = 地级前 4 位 + 两位序号），`code.slice(0,4)+'00'` 就是它上级。
点亮「遵化」亮的是唐山市那块，但面板里列的还是「遵化 · 2026-10-30」，用户记的那条信息一点没丢。
再往上一层同一条规则：块码前 2 位 + `'0000'` 就是所属省（`provinceAdcodeOf`），所以省名、
面板标题上的「省份 · 城市」都是纯前缀运算，不需要任何反查表。直辖市与港澳的块码本身就是省级码，算出来就是自己。

> **孤儿必须为 0**，两道闸：`build-china-geo.mjs` 每次生成完都与 cities.json 全量对账，孤儿不为 0 直接 `exit 1`；
> `adcode.test.ts` 再对账一遍。城市库以后加了新码而几何没重生成，测试必须先红，
> 而不是让用户在旅记页看到一座点不亮的城市。色块 → 省同样两处对账（省界缺一个码，
> 面板标题就取不到省名，只能退化成光一个城市名）。

**渲染**（`JournalMap.tsx`）：**不挂瓦片底图**，只有两层 GeoJSON（370 个色块 + 34 条省界分组线）—— 没有底图才干净得出一眼看完的「块状中国」，
也顺带消掉 GCJ-02 偏移与瓦片外链可用性两个变量；容器底色走 `.journal-map.leaflet-container`（就是纸色）。

- 着色只有两套（`palette.ts`）：未点亮 `#f8f5f1` + `#e0d8cc` 细边（比纸色**深**一档，反过来大陆会变成一块白斑）；
  点亮 `#f7ded0` 砖粉 + `rgba(217,72,15,.5)` 描边（描边就是 `--color-food` 的半透版）、线宽 0.6→1.3。
  **不新增第三种语义色**（§6.4），而且点亮借的是「吃」那支而不是「玩」的松绿：
  点亮 = 去过，吃和玩都算，挂在「玩」的语义色上是错位；而冷绿骑在暖纸底 + 褐省界上色温打架，
  实测看着像湖（试过四个方案：松绿 / 砖粉 / 花青蓝 / 蜜金，蓝跟绿都输在色温，蜜金与纸底同族糊成一片）。
  「突出」靠描边加粗而不是靠饱和度，所以点亮一片也不会突兀。
- hover 只压深填充一档、描边不动，**期间绝不调 `bringToFront()`/`bringToBack()`**：在指针底下重排 SVG
  会丢掉 `mouseout`，填充就永久停在 hover 色上（实测普查 370 块的 fill，抓到 3 块卡在 `#f1ece4`）。
  叠色顺序只在点亮态变化的那个 effect 里统一维护（亮的提到前面），一个不变量由一处负责而不是每次 hover 都改一次。
- hover 态用 `hoveredRef` 记，全局只会有一个：进新块先还原旧块，`mouseout` 只在自己仍是当前 hover 时才还原
  （跨块时旧块的 `mouseout` 可能在新块的 `mouseover` 之后才到，不拦住就把新块还原掉了），指针直接甩出地图不触发任何 `mouseout`，所以容器上再补一次
  `mouseleave` 兜底 —— 三个入口共用一个幂等的 `clearHover()`。
- 省界单独一个 **pane**（`react-leaflet` 的 `<Pane name="provinceBorders" style={{zIndex:450}}>`，盖在 overlayPane 的 400 之上）
 而不是与色块共用一层：点亮块在 `[lit]` 的 effect 里会 `bringToFront()`，同一个 renderer 内那一挪就把省界线盖到底下去了。
  线本身 `fill:false` + `interactive:false`：填了就是拿 34 个大多边形把色块盖光，不交互才能点击穿透到下面的块
  （Leaflet 的 CSS 只给 `.leaflet-interactive` 开 pointer-events，非交互 path 天生不吃鼠标）。
  颜色用半透中性褐 `#b3a48c / 0.7`：它要骑在直辖市的砖描边上，不透明会把描边切断成褐框（两者同暖族）。
- `style` 函数身份必须稳定：react-leaflet 的 `updateGeoJSON` 一见到它换引用就整层重刷 370 个多边形；
  点亮态变化改由 `adcode → layer` 的 ref 映射定点 `setStyle`。Leaflet 的 handler 只在创建那一次挂上，
  回调里一律读 `litRef` / `pickRef`，直接闭包就会永远停在首帧那份值上。
- `maxZoom` 锁 8（边界是 1.1km 容差简化的，放到太深会数得出折角），`minZoom` 锁 3（再小中国就成一粒沙，找不到自己在哪）。
- **初始视图按几何外接框 `fitBounds`，不写死 center + zoom**（`geoBounds.ts`），但 **fit 目标截掉三沙市**：
  它是全框里唯一越过 18°N 以南的块（南沙拉到 3.84°N，第二南的三亚在 18.144°，中间是 14° 的空海），
  留着它整张图就得为这段空海让位。截后高度 49.72° → 35.42°，实测大陆 701×514 → 948×697（边长 +35%）。
  代价只是刚进来看不到那串岛礁，往下拖就是 —— 块仍在图里、能点能亮（面板「海南省 · 三沙市」实测过）。
  截线不写魔法数，写的是 `FIT_SKIP_ADCODE = '460300'`，另有测试钉住「除它以外没有别的块低于 18.1°N」，
  以后几何里多了其他南海地名也不会被顺手切掉。
  react-leaflet 里 `center`+`zoom` 优先于 `bounds`，两个都传时 `bounds` 会被默默忽略 —— 所以是**只传 bounds**。
- **fit 的时机比 fit 的参数更容易错**（`FitInitial`）：`MapContainer` 的 `bounds` 是在 map 创建那一刻用的，
  而那一刻容器高度未必是最终值（顶栏、字体回流、旁边面板开合都会改它），算出来的缩放与中心就偏了，
  之后再没人纠正 —— 症状就是「刚点进来时上下被裁、图还偏一边」（实测过一份 margins 329/288/42/-4 的中间态）。
  所以挂载后等一帧 `invalidateSize()` + `fitBounds()`，并挂 `ResizeObserver` 在容器尺寸变了时重算（rAF 合帧，
  拖窗口一帧内会报好几次）；用户 `dragstart` / `zoomstart` 过就不再抢他的视图。
  **自己 fit 也会走 `zoomstart`**，不拿一个 `fitting` 护栏挡住，第一次 refit 就把后面的 resize 全屏蔽了（实测踩过）。
- **`zoomSnap` 要细到能兑住 fit 的结果**：截掉南沙只换来 0.45 档，`zoomSnap` 留在 0.5 就会被向下取整抹平
  （实测 zoom 仍停在 3、上下各白留 107px）。0.125 下吃到 zoom 3.375；但 fit 的理想值落在两个档位之间，
  **每细一档最多还能再捡回被向下吃掉的那半格**：细到 0.0625 后实测 3.4375，大陆 908×668 → 948×697（边长再 +4.4%，
  上下白边从 29/30 收到 15/15）。这里不挂瓦片，档位不对齐瓦片网格没有代价；`+/-` 按钮也不受影响（`zoomDelta` 默认仍 1 整档）。
  再细（1/64）只能捡回不到 1% 的尺寸，不做了。
- **fit 的留白不对称，右边让开战果卡**：卡片钉在视口右下（248px + 距边 16），而地图是水平居中的 ——
  窗口一窄（或一高，zoom 大了整张图往四周撑）东南沿海就落到卡片底下。实测 1376 宽下台湾右边缘到卡片左边缘
  只剩 125px，窗口窄到 ~1130 就压上了。改成 `paddingTopLeft: [8, 8]` + `paddingBottomRight: [8 + 278, 8]`
  （`CARD_RESERVED` = 卡宽 + 距边 + 14 缝），fit 中心左移半个预留量：实测台湾从 x 911–987 移到 782–861，
  与卡片间隙 251px，而 **没因此把图缩小** —— 大陆是高度受限的，吃掉右边那 278px 白边还剩得下（右边仍白 353px）。
  避让只做水平：垂直预留 117px 会直接掉 zoom。现在要重新撞上得把窗口收到 874px 宽以下（原先是 1126px）；
  真到那么窄，宁可小一点也不能挡着台湾。
- **不设 `maxBounds`**：视口比 maxBounds 大时，Leaflet 会把视图中心夹到框边上（夹取区间为空时退化成一侧边界），
  而本页初始就是 zoom 3 上下、fit 目标又只有 35° 高 —— 高窗口下实测被夹得往下偏 195px，正好毁掉刚 fit 好的居中。
  不挂瓦片，拖出界只是一片纸色，这个损失比错位小。修好后实测：垂直始终对称（上 15 / 下 15，大陆口径，
  三沙按设计在视野外），水平则不再对称 —— 1376×783 下是 75 / 353，差的正是上面那条让给卡片的量。
- **点任意块都开面板**，标题一律是**「省份 · 城市」**（直辖市与港澳的块名就是省名本身，拼起来会变成
  「北京市 · 北京市」，同名时只留一个）；再点同一块 = 收起。里面按数据分两种长相：
  已点亮 → 列「时间 + 你游玩了哪些」（城市名 · 点亮日期 · 标题，可跳原视频，按点亮时间正序）；
  有记录但没插旗 → 一条紧凑的「这块还没插旗 · 已导入 N 条」+「去点亮」（跳 `/?city=<code>` 直接开那座的抽屉）；
  压根没记录 → **只留标题条**，body 什么都不放（此时 header 连下边线都不画，面板就是一条 chip）：
  点未点亮的块要的就是「这是哪儿」，标题已经答完；原来那一大块居中的「还没有这里的记录 + 去导入」
  被明确要求去掉 —— 引导感太重，比不说更烦。
  区分「有记录没插旗」与「压根没记录」需要全量记录：页面上除了 `listVisitedRecords()` 还拉一次
  `listVideos()`，用同一个 `groupByBlock` 出「有记录的块」集合。
  跳转用的 city code 取**该块内某条记录的 `cityCode`** 而不是块 adcode：块码未必是城市库里的城
  （台湾块就是），记录的码一定在库里。四个直辖市的库内码本来就是 110000/120000/310000/500000，
  与块码同码，所以 `adcodeOf` 不需要特判。
- **战果卡在右下角**（`absolute bottom-4 right-4`，248px 宽）：一行「你已经吃过了全国 N / 370 个城市 ·
  M / 34 个省份」+「去地图点亮」+ 刷新。两个数都按**色块口径**（与地图上亮着的块 1:1，用户数得出来）：
  城市口径是 743 城，拿它当分子除以 370 会算出超过分母的数；`M` 由 `litProvincesOf` 现算（派生不落库）。
  一块都没点亮时换成一句提示，不弹大卡。图例（去过 / 没去过）拿掉了 —— 教学性的东西不该占在炫耀位上。
  右下角要让位给它，所以 `attributionControl={false}`（本页不挂任何瓦片，attribution 只剩一个 Leaflet 徽标）；
  面板也因此限高 `max-h-[calc(100%-9rem)]`，长列表不会压到这张卡。
  （这里走过一次来回：曾按「右下角不放任何卡片」把整张卡删掉，而用户实际要删的是未点亮面板里那块导入引导
  —— 卡片已原样恢复。教训：**「底下这部分不要」这种指代必须先对齐是哪一块**，不要按自己的理解删功能。）

**点亮交互**（`CityDrawer.tsx`）：卡片右上角一面细线旗（`Icon.tsx` 新增 `flag`，燕尾旗面 —— 矩形旗在 17px 下读不出是旗），
吃/玩卡片都有；点亮态卡片描边与底色转砖粉（与地图上的点亮块同族，旗子不再单独占一支颜色），行内加「旗 + 日期」。
点亮底色必须与 `bg-surface` 二选一，不能叠在一起：同时挂 `bg-surface` + `bg-food/[0.04]` 时谁赢看样式表生成顺序，
实测白色胜出、点亮态就只剩描边了（文档里却一直写着「底色转松绿」—— 文字比代码乐观）。按钮**不能嵌在 `<a>` 里**（交互元素嵌套不合法），
所以外套一层 `relative` div，按钮作 sibling 浮在右上角，标题块 `pr-16` 让位。顶栏下再挂一条城市级「已点亮 · 日期起 · N 条」。
抽屉里存的是**该城全量记录**、渲染时才按筛选切：城市级「去过」不能跟着「只看吃」这种筛选走，否则点亮过玩、切到吃就显示没去过。
切换就地改那一行、不重拉列表（重拉会把滚动位置弹回顶部），改完 `scheduleSync()` 立刻推。

**已知局限**（都是取舍，不是 bug）：

- 点亮的日期 = **你插旗那天**，不是你真的去过的那天。一期不加「手填旅行日期」，那要再开一条输入路径；
- 台湾省在几何里（`_full` 404 → 退回省界占一块），但城市库里没有 71xxxx 的城，所以它是一块**永远点不亮**的区 —— 保留轮廓是为了地图完整；
- 一块亮 ≠ 整城都去过：亮的是「这个地级市里有任一点亮记录」；
- 省界与市界是**两条独立简化的线**（同一容差 0.01°，但 DP 作用在不同折线上），深缩放到 6 级以上能看出像素级偏移；
- 首次进旅记页要多拉 1.52MB（gzip 约 457KB：色块 1.15MB + 省界 0.37MB），之后走 HTTP 缓存与模块缓存；拉失败给重试（`loadGeo` / `loadProvinces` 都不缓存失败的 promise）。

---

## 7. 工程结构

```
eat-map/
├── index.html
├── vite.config.ts
├── package.json
├── tsconfig.json             # references：app / node / server 三个 project
├── tsconfig.server.json      # server/ 带 @types/node，不与浏览器项目混（否则 node:https 破坏 app 类型检查）
├── scripts/
│   ├── collect-cities.mjs    # 城市库采集（§5.1）
│   ├── build-cities.mjs      # 城市库生成（§5.1）
│   └── build-china-geo.mjs   # 旅记几何采集（370 色块 + 34 省界）+ DP 简化 + 与城市库全量对账（§6.6）
├── node-functions/           # 云上形态的服务端（EdgeOne Pages Node Functions，§4.5 / §4.6）
│   ├── api/fetch.ts          # → /api/fetch，import 同一套 server/ 代码（零副本）
│   └── api/data.ts           # → /api/data，读写 EdgeOne Blob 存储（存什么、为何不用 KV 见 §4.6）
├── server/                   # 浏览器外面那一跳（§4.5 / §4.6）
│   ├── relayCore.ts          # 中转纯逻辑（零依赖、可单测）
│   ├── relayNode.ts          # node:https 传输层
│   ├── syncCore.ts           # 同步纯逻辑：口令哈希 / 快照校验 / rev 乐观并发（存储通过 SyncStore 注入）
│   ├── relayCore.test.ts
│   └── syncCore.test.ts
├── public/
│   └── favicon.svg
└── src/
    ├── main.tsx / App.tsx    # 路由：/（地图） /journal（旅记） /import /ranking /data
    ├── db/
    │   ├── schema.ts         # 库表定义 + version + upgrade
    │   ├── videos.ts         # CRUD + 聚合（countByCity 等）
    │   └── sync.ts           # 同步附表读写（合并结果落库、游标、标记清理）
    ├── sync/
    │   ├── merge.ts          # 合并规则（纯函数：按 id 合流 → 按 url 归并 → 删除压制）
    │   ├── spaceId.ts        # 口令 → 空间 id（WebCrypto，与服务端哈希必须一致）
    │   ├── cloud.ts          # 拉/推/冲突重试、自动同步调度、口令与迁移
    │   └── SyncCard.tsx      # 数据页的同步状态与设置卡片
    ├── ingest/
    │   ├── parse.ts          # 链接识别正则、平台判断
    │   ├── fetch.ts          # 直连→中转→代理链→降级 的抓取管线
    │   ├── relay.ts          # 前端侧中转地址配置 + 探活（§4.5）
    │   ├── proxies.ts        # 通道列表（中转排首位，每通道带超时/metaJson）
    │   ├── geo.ts            # 城市识别
    │   ├── classify.ts       # 吃/玩分类器
    │   └── lexicon.ts        # 词表（持续迭代处）
    ├── data/
    │   ├── cities.json       # 城市→坐标→别名（由 scripts/build-cities.mjs 生成，见 §5.1）
    │   ├── chinaGeo.json     # 370 块边界几何（由 build-china-geo.mjs 生成，§6.6；动态 import 成独立 chunk）
    │   └── chinaProvinces.json # 34 条省界轮廓（同一脚本顺手产出，只当分组线）
    ├── journal/
    │   ├── adcode.ts         # 城市 code → 色块 adcode → 所属省；两份几何懒加载（独立 chunk，不进主包）
    │   ├── palette.ts        # 两套着色（点亮 / 未点亮 + hover）+ 省界线，纯函数可单测
    │   ├── geoBounds.ts      # 初始视图的 fit 目标：几何四至 + 截掉三沙（§6.6），纯函数可单测
    │   ├── geoTypes.ts       # 自写的最小 GeoJSON 类型（不为此引 @types/geojson）
    │   └── JournalMap.tsx    # 无瓦片底图的 Leaflet：色块层 + 省界层（单独 pane）
    ├── weather/
    │   ├── forecast.ts        # Open-Meteo 请求/解析/缓存（纯逻辑，可单测，§6.5）
    │   ├── wmo.ts             # WMO 天气码 → 中文说法 + 图标名
    │   └── CityWeather.tsx    # 抽屉顶部的「未来一周」面板
    ├── map/
    │   ├── MapView.tsx       # react-leaflet 封装
    │   ├── CityMarker.tsx    # divIcon 气泡
    │   └── CityDrawer.tsx    # 城市视频抽屉（顶部挂 CityWeather；逐条插旗点亮的入口，§6.6）
    ├── pages/
    │   ├── MapPage.tsx
    │   ├── JournalPage.tsx   # 旅记页：色块地图（右下角战果卡）+ 点击面板（省份 · 城市，亮/未亮都开）
    │   ├── ImportPage.tsx    # 链接导入 + RelayBar 中转状态灯
    │   ├── RankingPage.tsx
    │   └── DataPage.tsx      # 导出/导入/编辑/删除 + SyncCard 云端同步
    └── ui/                   # 通用组件、样式
        └── Wordmark.tsx      # 品牌艺术字 EatMap（SVG 逐字母 + 渐变贴纸描边）
```

编码约定：TypeScript strict；所有 IndexedDB 访问只允许经 `src/db/`；分类/城市词法逻辑全部是纯函数（方便单元测试，见 §9 M6）。

---

## 8. 部署（当前仅在 EdgeOne Pages 跑通）

> **唯一验证过的平台是 Tencent Cloud EdgeOne Pages**。换别的静态托管要重新解决两件事：
> ① `/api/*` 不能被 SPA 回退吞掉（函数路由必须优先于静态资源，否则就是 §4.5 那个「200 但回的是首页」的假绿灯）；
> ② 得有真 Node 运行时能跑 `node:https`（§4.3 的请求指纹结论，edge-functions 的 V8 `fetch` 不行）。
> Vercel 形态未做（它的 `/(.*)` rewrite 会吞掉 `/api/*`，得先改成 `/((?!api/).*)`），仓库里也不再保留 `vercel.json`。

1. 发布：推送到 Pages 关联的仓库即自动构建（Build Command `npm run build`，Output `dist`）。
   `node-functions/` 由平台自动识别为函数并接上路由（`api/fetch.ts` → `/api/fetch`，`api/data.ts` → `/api/data`），
   不需要单独的函数配置；Blob 命名空间首次 `getStore('eatmap')` 自动创建，控制台零开通步骤。
2. 环境变量（Pages 项目设置里，可省）：`RELAY_ALLOWED_ORIGINS` —— 中转与同步接口**共用**这个 CORS 允许源，
   不填默认 `*`。
3. 本地验证：`npm run build && npm run preview` 只验静态构建；函数里的判定逻辑靠单测验（`server/*.test.ts`，core 不感知运行时，测的就是云上那份），
   完整链路（真实抓取 + Blob 读写）只能在云上验，或用 `edgeone pages dev` 在本地跑真函数。
4. **预览域 `*.edgeone.cool` 带时效签名，命令行 curl 一律 401**（`X-EOP-MSG: eo_time missing`），
   所以别拿 curl 判定函数挂没挂 —— 要么在浏览器里测，要么绑正式域名。
5. 域名：`*.edgeone.cool` 是预览域名且有有效期，生产要绑自有域名；绑域名后 `TILE_LAYERS` 可切换备选瓦片源。
6. 提醒用户（README/关于页）：主存储在本浏览器，但可在「数据页」设空间口令自动上云（§4.6）；没设口令时清缓存仍会丢，导出 JSON 仍是兜底。

---

## 9. 开发里程碑

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| M0 | 脚手架：Vite+TS+Tailwind+路由+Leaflet 出图 | 页面能看到中国地图 |
| M1 | 数据层：schema、cities.json 灌入、CRUD、聚合 | 单测：写入/按城市聚合计数 |
| M2 | 导入管线：链接正则 + 抓取(直连/代理) + 手动降级表单 | 公众号链接能抓到标题描述 |
| M3 | 识别与分类：城市识别、吃/玩打分、置信度标记 | 10 条样例链接 ≥8 条城市正确、≥7 条分类正确 |
| M4 | 地图交互：城市气泡、抽屉列表、点击跳转、筛选 | 端到端：导入→图上出现→点击→跳转 |
| M5 | 推荐榜单 + 数据管理（编辑/删除/导出/导入） | 排序符合 food 权重规则；导出文件可回灌 |
| M6 | 词表与别名迭代（用真实误判样本回灌 lexicon/cities aliases）、部署上线 | 生产域名可访问（已达成：EdgeOne Pages，中转与同步均云上实测） |

---

## 10. 风险与已知局限（坦诚记录）

| 风险 | 影响 | 缓解 |
|---|---|---|
| 小红书分享链必须带 xsec_token（~~曾误判为「登录墙不可绕过」~~，见 §4.3） | 去 token 的裸地址必被踢到 404 | 抓取用原地址、入库去 token；token 过期时走分享文案 / 页签取词 / 手动三条兜底 |
| ~~app_share 的 token 在 web 端强制登录~~（第二次误判，已证伪，见 §4.3） | 曾经把本来能成功的链接提前判失败 | 早退已删除；真门槛是请求头三件套 + `node:https`，由中转代跑 |
| 抓取完全依赖站点自己的 `/api/fetch` 函数（平台侧改动 / 函数没接上路由时是静默变哑） | 降级 r.jina.ai → 公共代理，正文质量下降（截断 og + 站点 logo 当封面）但不至于不能用 | `RelayBar` 状态灯常驻导入页，能识别「200 + 回了个网页」这种被 SPA 回退吞掉的情况（只看状态码会误报绿灯）；路由与 env 见 §8 |
| r.jina.ai 是外部依赖（匿名约 20 次/分钟，可能限流或下线） | 批量导入变慢或需降级 | 每通道独立超时 + 失败切换；`RATE_LIMIT_MS=1200` 节流；失败行给「重试 / 取词 / 手动」三条出口 |
| Open-Meteo 也是外部依赖（免 key，但同样可能限流 / 改字段，§6.5） | 抽屉里的天气块拿不到 | 60 分钟 localStorage 缓存 + stale-while-revalidate + 8s 超时；失败只缩成一行提示，不参与主流程；字段解析一律容错（缺列就丢那天，不渲染 `NaN°`） |
| 数据只在单浏览器 | 换设备丢失、清缓存丢失 | ~~只靠导出 JSON~~ → 已上云：空间口令 + EdgeOne Blob 快照自动同步（§4.6）；导出/导入仍作兜底 |
| 同步接口 `/api/data` 公开可调 | 没口令的人乱写会污染 Blob（但进不了你的空间：目录按口令哈希分） | 快照服务端校验 + 8MB 体积上限 + 50_000 条上限；口令当密码保管（丢了 = 云上那份找不回） |
| 多设备同时写（rev 冲突靠重试收敛） | 极端情况下一次推送要重试 2 次，超过就报错 | 409 带回服务端快照由客户端合并后重试；自用单主写入场景几乎碰不到 |
| 删除标记只存 90 天（`SYNC_TTL_MS`） | 某设备离线超窗口会把别人早已删的记录拉回来 | 长期多端就调大窗口；或先拉后推、不要长期离线 |
| EdgeOne Blob 默认 60s 最终一致 | rev 比对拿到旧值 → 误判冲突 | 读写全走 `consistency: 'strong'`，响应恒 `no-store`；**已云上实测**：PUT 得 rev:1 后立刻 GET 即读到 rev:1，未出现旧值 |
| 城市识别歧义（「海口」、「天津大学」类文本） | 误关联 | 通名上下文黑名单 + 同级才算歧义 + 置信度标黄人工复核；别名表持续迭代 |
| 分类误判（吃玩混合视频） | 排序偏差 | 允许人工修改且 manual 不被覆盖；混合时默认偏「吃」 |
| 城市库来自阿里 DataV.GeoAtlas（外部数据源，§5.1）：旅记的两份几何（色块 + 省界）也是从它一次性采集的 | 源头改了得重跑 `build-china-geo.mjs`；几何不进前端运行期，**不依赖对方可用性** | 采集有 `scripts/.china_geo_raw/` 缓存可离线重跑；生成时全量对账（城市→块、块→省），孤儿不为 0 就 `exit 1`；`adcode.test.ts` 再钉一道 |
| 色块边界按 1.1km 容差简化过，且只有地级一层（§6.6） | 深缩放能看出折角；县级市没有自己的块 | `maxZoom` 锁 8；县级市并入上级地级块，面板里仍按城市列明细 |
| 只在 EdgeOne Pages 一个平台验证过（函数目录名、Blob SDK、路由优先级都是平台特性） | 换平台得重做 §4.5/§4.6 的适配层 | 逻辑全在 `server/`（不感知运行时），新平台只需再写一个薄适配；§8 列了换平台必答的两题 |
| 预览域 `*.edgeone.cool` 带时效签名且对 curl 一律 401 | 无法用 curl/脚本做回归，只能浏览器人工测 | 绑自有域名后可自动化；探活判定已改成只认 JSON 信封（§4.5） |
| 小红书分享链带过期 token 参数 | 去重误判 | 入库前规范化 URL（strip query 中的临时参数，保留 noteId） |

---

## 11. 快速启动命令

```bash
npm create vite@latest eat-map -- --template react-ts
cd eat-map
npm i leaflet react-leaflet idb
npm i -D tailwindcss @types/leaflet
npm run dev        # 本地开发 http://localhost:5173（只跑前端：无 /api/fetch 与 /api/data，灯红属预期）
npm test           # vitest run（含 server/relayCore.test.ts 的无网络单测）
npm run build      # 生产构建 → dist/
# 发布：推送到 EdgeOne Pages 关联仓库自动构建（§8），本地调函数可用 `edgeone pages dev`
```
