# dsh-history-viewer 只读审计报告（2026-10-10）

被审对象：`D:\dsh-history-plugin`（v1.0.0，已以 junction 装入 `~/.dsh/profiles/web`，路由在 3080 上实测存活）
权威规范：`@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/*`（标 **[官方]**）
生态范例：`~/.dsh/profiles/web/node_modules/{dsh-chat-manager,dsh-better-sidebar,dshmarket}`（标 **[惯例]**）
本报告不修改任何文件、不安装、不调用 plugin manager。

---

## Top 8 优先级清单

1. **P1 [官方]** 插件卡片文案被静默丢弃 —— locale 文件写成了扁平 `{title,description}`，读取器只认 `{meta:{title,description}}`（`dsh-app-boot/lib/index.js:1937-1941`）。动作：`locale/{zh,en}.json` 改为 `{"meta":{"title":…,"description":…}}`。
2. **P1 [官方]** 界面是 iframe 里的自建页面 —— `practices.md:33` 明文禁止"Host 出 HTML + iframe"，故拿不到主题 token / 亮暗切换 / `ctx.locale`；`ui.html` 全量硬编码 `#14161a` 等色值且 `color-scheme:dark`。动作：改为 React 组件注册进 slot（或至少全量换 `--dsw-alias-*`）。
3. **P1 [官方]** 浮层无任何无障碍协议 —— 无 `role="dialog"`/`aria-modal`、无 Esc、无焦点陷阱与初始焦点（`user-actions.md`/`practices.md:35` 要求保留 Modal 的焦点与 Escape 行为）。动作：补 dialog 语义 + Esc + focus trap + 关闭后焦点归还侧栏按钮。
4. **P1 [惯例]** 路由只有 Host 判据、没有 Origin/sec-fetch-site 判据 —— 实测带 `Origin: https://evil.example` 的请求返回 200 与 770 字节会话数据；官方 `/api` 同条件 401，better-sidebar/chat-manager 走 `isTrustedApiRequest`（`trust-fence.ts:81`）。动作：复用官方 fence 语义（Host + `sec-fetch-site` + Origin），并读 `ctx.webRuntime.trustedHosts`。
5. **P1 [惯例]** 状态变更走 GET —— `/api/focus?toggle=…`、`/api/reindex` 无 CSRF 令牌、无确认头；chat-manager 用 POST + `x-dsh-…-confirmation`。动作：改 POST + 自定义确认头。
6. **P2 [官方]** 无 `Config`/schemastery —— 官方要求"可调值进 Config"，现由 `DSH_HISTORY_VIEWER_DIR`/`config.dshHome` 裸读且不校验（`practices.md:22`, `host-plugin.md:54`）。动作：导出 `Config`（dataDir、冷却、缓存条数）。
7. **P2 [惯例]** 客户端零清理 —— 模块级 `open`/`subs` 跨卸载存活，注册无 disposer（`ui-plugin.md:12` 要求 `ctx.effect`）。worker 也未保存引用、卸载时不 `terminate()`。
8. **P2 [惯例]** 清单残缺 —— 缺 `repository`/`publishConfig`/`bugs`/`homepage`（`contributing.md` 明确 `repository` 必须回指仓库），缺 `screenshots.json`/CHANGELOG/英文 README，`peerDependencies` 预发布分支用 `^0.2.0-rc.2` 削弱了规范推荐的显式 `||` 写法。

---

## 1. 清单与安装

| 项 | 结论 | 证据 | 级别 | 动作 |
|---|---|---|---|---|
| `dsh.bundle.patch` | 正确 | `package.json:49-51` `patch: ./cordis.patch.yml`；`cordis.patch.yml:3-5` insert 行 | ✅ | — |
| `dsh.client.*` | 正确且必要 | `package.json:55-61` `platform:web / immediately:true / inject:["@deepseek-ai/dsh-client-ui-sidebar"]`；该 inject 正是 `sidebar.footer.action` 的声明方（`dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:76`，[官方] 属依赖排序，允许） | ✅ | — |
| `exports` | 齐全 | `package.json:19-24` 含 `.`/`./client`/`./package.json`/`./locale/*.json`。`./locale/*.json` 是**读取卡片文案的硬前提**（`dsh-app-boot:1972` 走模块解析读 `<specifier>/locale/en.json`） | ✅ | — |
| `files` | 未漏运行必需文件 | `package.json:25-35` 含 index.js/client.js/ui.html/lib/locale/icon。`lib/` 覆盖 `index-worker.js` 与 `core.js` | ✅ | 若要发 npm，建议补 `preview-plugin.png`、`screenshots.json` |
| `icon` | 合规 | `package.json:36` + `icon.svg` 467 B（限制 256 KiB，`dsh-app-boot:1872`）；校验过 relative/SVG/在包内 | ✅ | — |
| `meta` | **死配置** | `package.json:37-40`；`readPluginMeta` 只读 locale 文件与 `icon`，从不读 `meta`（`dsh-app-boot:1969-1995`） | P2 | 删除或保留当注释；真正生效的是 locale |
| `locale/*.json` | **格式错，文案全部失效** | `locale/zh.json:1-4` 为扁平 `{"title":…}`；读取器取 `parsed.meta?.title`（`dsh-app-boot:1937-1941`）→ 全部 `undefined` → 回退成 `name`/`description`。对照 chat-manager、better-sidebar 均为 `{"meta":{…}}` | **P1** | 包一层 `meta` |
| `engines.node` | 过松 | `package.json:16-18` `>=20`；生态多为 `^22.19.0`/`>=22.19.0`（chat-manager、dsh-search）。本次审计 dsh 0.2.0-rc.2 实际跑在 `D:\New Folder\node.exe` | P2 | 与部署实际对齐（`>=22.19.0`） |
| `dsh.engines.dsh` | 无人读 | `package.json:52-54`；兼容性评估只读 `peerDependencies`（`dsh-app-boot:286-301`，grep `engines` 零命中） | P2 | 删除或保留当文档 |
| `peerDependencies`（预发布陷阱） | 基本正确但有弱化 | `package.json:42` `^0.1.7-rc.2 \|\| ^0.2.0-rc.1 \|\| ^0.2.0-rc.2 \|\| ^0.2.1-alpha.1 \|\| ^0.2.1-alpha.2`。显式分支写法**符合规范**（`contributing.md` 预发布段）；但 `includePrerelease:true` 下 `^0.2.0-rc.2` 也会放行 `0.2.0-rc.5` 等未测版本，而生态范例把每个版本逐字 `\|\|` 列出 | P2 | 收紧为 `>=0.2.0-rc.2 <0.2.1-0` 之类带预发布标签的元组区间 |
| `peerDependenciesMeta.optional` | 正确 | `package.json:44-46` | ✅ | — |
| `publishConfig` | **缺失** | `package.json` 无该字段；chat-manager/dsh-search/better-sidebar/dshmarket 均有（含 `access:public`） | P2 | `"publishConfig":{"access":"public"}` |
| `repository` | **缺失（市场硬条件）** | `package.json` 无；`PUBLISH.md:31` 自己写明"发布了 npm，`repository` 必须指回仓库"，`contributing.md` npm 段重复该硬条件；dshmarket 靠它做包↔仓库关联（`dshmarket/src/profile.ts:574`） | **P1（发布前）** | 补 `repository`/`bugs`/`homepage` |
| `license` | 声明 MIT 但署名占位 | `package.json:6` + `LICENSE:3` `Copyright (c) 2026 dsh-history-viewer contributors` | P2 | 填真实作者 |
| `main`/`types` | 用 `exports` 即可，非必需 | — | — | 生态多数同时给 `main`（纯 JS 可选） |

---

## 2. Host 半体

- `apply/inject` 形态 **[官方]** 合规：`export function apply(ctx, config = {})`（`index.js:32`）+ `inject = ['webServer']`（`index.js:21`），未混用默认导出（`host-plugin.md:49-52`）。
- `ctx.webServer.register` **[官方]** 用法正确：返回 disposer（`dsh-host-webserver/lib/types/index.d.ts:90`），插件在 `index.js:207` `ctx.effect(() => dispose)` 中登记。可改进为直接 `ctx.effect(() => ctx.webServer.register({...}))`、并用 `ctx.effect(fn, name)` 形式给清理命名（chat-manager 如此，`src/index.js:28`）。**P2**
- **同步重活（阻塞宿主机事件循环）**：`currentIndex()` 每个 API 请求都跑 `maybeRefresh → core.indexIsStale`，后者对 sessions 目录做递归 `readdirSync` + 每个文件 `statSync`（`index.js:92,77`；`core.js:253-261`）；`/api/search` 还会在事件循环里 `readFileSync` + 解析多个会话文本（`core.js:268-279`）。重建本身已正确移入 worker（`index-worker.js`）。**P1（性能）** — 动作：把 stale 判定做成 mtime 汇总缓存/`fs.watch`，并给 `indexIsStale` 加最短间隔。
- `uiHtml()` 每次请求 `fs.statSync`（`index.js:100`），命中缓存才免读；`/api/text` 一次返回整会话（`index.js:170`）。**P2**
- **配置校验缺失**：无 `Config` **[官方]**（`practices.md:22`、`host-plugin.md:54`）。`config.dshHome` 未校验类型（`index.js:33`），若 patch 里写成非字符串会让 `path.join` 抛同步异常；日志级别等也无处可调。**P1**
- **日志方式不可靠**：`ctx.logger` 在 dsh 内部被大量使用（`dsh-app-boot/lib/index.js:138,4056` 等），并非"部分版本不可见"；而 `index.js:36` 是 `try { ctx.logger?.[level]?.(…) } catch {}`，即 logger 缺失时**静默不输出**，与 README:46 "同时走 console" 的声明不符。**P1（可观测性）** — 动作：`(ctx.logger ?? console)[level]` 或补 console 兜底。
- 未用导入：`import os from 'node:os'`（`index.js:14`）全文件无用（`core.js` 自己 import）——P2。
- 错误响应回显异常文本：`index.js:201` `'internal error: ' + e.message`，路径等信息可能外泄。P2。

---

## 3. Client 半体

- `window.__ModuleLoader__.load({ id })` **[官方]** 完全正确：`client.js:11-12` 的 id 等于包名 `dsh-history-viewer`（`manifest.d.ts:178` 要求 id 必须等于图中行名）。✅
- 返回形态正确：`{ inject: ['slots'], apply(ctx) }`（`client.js:63-73`），与官方模板 `templates/decoration/client.js:13-18` 一致。✅
- **未 require 任何 `@deepseek-ai/dsh-client-*`** **[官方 严禁]**：全文件只有 `require('react')`（`client.js:14`），`grep` 无 client 包引用。✅（对照 chat-manager 反而 require 了 primitives，属违规范例）
- **slot 选择符合 practices**：`sidebar.footer.action`（list，`contract/slots.d.ts:76`）与 `shell.overlay`（`dsh-client-ui-layout/lib/types/client/index.d.ts:85`）都是真实声明的槽；chat-manager 与 dshmarket 以同样写法注册 `shell.overlay`。`order:40`/`id` 均为 list 槽必填项（`slots/index.d.ts:564-569`）。✅
- **资源清理缺失 [官方 ui-plugin.md:12]**：`ctx.slots.inject/register` 的 disposer 未留；模块级 `let open`、`const subs = new Set()`（`client.js:19-26`）在插件卸载后仍是活引用（订阅者已随组件卸载清掉，故非泄漏级，但状态跨重载残留）；也无 `ctx.effect`。**P2**
- **未在组件外写 DOM、未 append 到 body** **[官方 practices.md:36]** ✅ —— overlay 全在 React 树内。
- 副作用散落：`window.open(BASE + '/', '_blank', 'noopener')` 在事件回调内（`client.js:58`），可接受；但"在新标签页打开"意味着同源新页面直接拿到完整历史 UI（见安全维度）。

---

## 4. 主题与 i18n

- **硬编码颜色（严重）**：`ui.html:4-69` 通篇字面色值（`#14161a`、`#2a2f37`、`#3b82f6`…），且 `ui.html:4` `:root{color-scheme:dark}` 写死深色。**[官方]** `practices.md:34` "literal colors are for artwork only"；`ui-plugin.md:12` 要求继承宿主主题。**P1** 但**根因是 iframe 架构**（iframe 文档拿不到宿主 `--dsw-*` 变量），所以选 1 与选 2 必须一起修。
- Client 侧浮层混用了 token 与兜底色：`client.js:27` `var(--dsw-alias-${name}, fallback)`，用了 `bg-base`（真实存在）、`text-primary`（**不存在**，真实 token 是 `--dsw-alias-label-primary`）、`border-l2`（真实存在）、`bg-overlay`/`bg-mask-*` 未用。证据：`dsh-client-ui-theme/lib/client.js:26` 的 token 表含 `--dsw-alias-label-primary`/`-secondary`/`-caption`，无 `text-primary`。**P2** — 动作：改 `label-primary`。
- **界面文案未走客户端 locale 服务 [官方 ui-plugin.md:12 明文]**：`client.js` 与 `ui.html` 全是中文字面量（`client.js:34,56,59`；`ui.html:73,83,94,105`…），既未 `inject: ['locale']`，也未声明 slot `locale:` 命名空间（`slots/index.d.ts:610`）。`locale/*.json` 只服务插件卡片。**P1**
- `dsh.client.inject` 值正确且必要（见维度 1）。**生态惯例**：chat-manager 额外 inject 了 `@deepseek-ai/dsh-client-locale` 并在客户端读 `ctx.locale.getSnapshot().active`；本插件两处都缺。

---

## 5. 可访问性与交互（对照 `user-actions.md` 与 `practices.md:35`）

| 项 | 现状 | 级别 |
|---|---|---|
| 按钮 aria-label/title | 侧栏按钮有 `title`+`aria-label`（`client.js:33-34`）✅；但浮层内"在新标签页打开/关闭"仅文字、无 `aria-label`（`client.js:58-59`）| P2 |
| Esc 关闭 | **无**任何 `keydown`/Escape 处理 | **P1** |
| 焦点管理 | 无初始焦点、无焦点陷阱、无关闭后焦点归还 | **P1** |
| `role="dialog"`/`aria-modal` | **无**（`client.js:44-54`）| **P1** |
| iframe `title` | 有 `title: 'DSH 历史查看'`（`client.js:60`）✅ | — |
| iframe 沙箱 | 无 `sandbox` 属性；同源 iframe 因此可 `window.parent` 触达宿主同源 `/api` | P2（见维度 7） |
| 键盘可达性（ui.html） | 会话行是 `<div onclick>`（`ui.html:313-321`）、搜索卡片是 `<div onclick>`（`ui.html:399-425`）、📌 是 `<button>` ✅，但 div 行不聚焦、无 `tabindex`/`role`、无 Enter/Space 处理 | **P1** |
| 其他 | `alert()` 说明气泡（`ui.html:259`）；`:focus-visible` 样式缺失 | P2 |

---

## 6. 性能与资源

- **worker**：`index.js:51-70` 有 `building` 并发闸 ✅、消息类型分支 ✅、`exit` 复位并清缓存 ✅、启动异常回退 ✅。**缺口**：worker 引用未保存 → 插件卸载时不能 `terminate()`，重建会在宿主卸载后继续跑（`plugins` 卸载语义要求清理）；`progress` 消息被忽略；无超时。**P1**。
- **索引写入非原子**：worker 直接 `fs.writeFileSync(index.json)`（`core.js:246`）。主线程若在写入中途 `loadIndex`（`core.js:251` 的 `JSON.parse` 失败即返回 `null`），`currentIndex()` 会退化成"0 个会话"并再次触发重建（`index.js:74,93`），形成抖动/循环。**P1** — 动作：临时文件 + rename，且 loader 在 null 时回退旧索引而非空表。
- **lineCache 无界风险**：`index.js:82-88` 上限 60 会话看起来有界，但每项是整会话全部文本行（每行最长 200000 字符，`core.js:235`），60×大会话可达数十 MB 常驻，且清空策略是"最旧一条"而非按字节。**P2** — 动作：按累计字节上限淘汰。
- **uiCache 有界**（按 mtime 失效，`index.js:97-106`）✅。
- **响应头/压缩**：`/`(UI) 用 `cache-control: max-age=30`（`index.js:131`），API 用 `no-store`（`index.js:110`）——合理；UI 未压缩（`content-length` 23197，实测无 `content-encoding`），gzip 由 webServer 统一开关（`Config.compression`），非插件职责。**P2** 可选：给 UI 加 `etag`。
- 搜索上限由客户端传 `limit=2000`（`ui.html:365`），服务端只在 `hits.length>=limit` 时截断（`core.js:333`）——单次搜索可能把数千条命中序列化进一个响应。**P2**。

---

## 7. 安全（实测）

- **`localOnly` 判据不足 [惯例]**：`index.js:114-117` 只做 `host.startsWith('127.0.0.1'|'localhost'|'[::1]')` 的字符串前缀比较。实测：
  - `GET /plugins/dsh-history-viewer/api/sessions` 无任何凭据 → **200**（747 B；带 Origin 时 770 B）；
  - 同条件官方 `GET /api/sessions` → **401**（有浏览器令牌交换/签名 cookie，`dsh-client-connection/lib/types/browser-auth.d.ts`）；
  - `Host: evil.example` → 403（好消息：DNS rebinding 的本体被挡住，因为 rebinding **无法伪造 Host**，官方注释亦如此说明 `api-request-trust.d.ts:1-13`）；
  - **但 `Origin: https://evil.example` + `sec-fetch-site: cross-site` → 仍 200**，即缺少官方 fence 的另外两条判据（`isTrustedApiRequest`，`dsh-better-sidebar/src/trust-fence.ts:81-126`；chat-manager 同源复用 `hostRequestFence`）。
  **P1** — 动作：照搬官方 fence（Host 归属 + `sec-fetch-site: cross-site` 拒绝 + Origin 同源校验），并支持 `ctx.webRuntime.trustedHosts`（现在 `--host 0.0.0.0` 部署下本插件路由会整片 403，属功能缺陷，`index.js:116`）。
- **CSRF / 状态变更**：`/api/focus`（切固定、切项目）与 `/api/reindex` 都是 GET 且无令牌/确认头（`index.js:151-164,194-197`）。跨站 GET 可被任意本机页面触发。**P1**。
- **敏感内容外泄面**：日志不打印会话内容 ✅（只打印计数与错误）。但 (a) 错误响应回显 `e.message`（`index.js:201`）；(b) 无认证意味着**任何能发 HTTP 的本机进程**（含其他插件、任意本地脚本）都能整库读取历史——历史文本里可能含用户粘贴的 API key。**P1**，动作：接官方浏览器鉴权或至少加一次性令牌，并在 UI 与 README 标注风险。
- **iframe 同源与边界**：iframe 无 `sandbox`（`client.js:60`），页面与宿主同源，故 viewer 内若出现 XSS 即可调用宿主同源 `/api`。当前 `ui.html` 的转义纪律良好（`esc()` 于 `ui.html:112`，`md()` 先转义再排版 `ui.html:140-149`，搜索高亮走 `textContent`/`esc`），因此现状**未发现可利用 XSS**；建议加 `sandbox="allow-scripts allow-downloads allow-popups"`（**注意**：加 sandbox 会切断同源 fetch，必须与该 iframe 架构一并重构）。**P2**。
- 路径安全：`/api/export` 的文件名做了非法字符替换（`index.js:177`）✅；路由无文件路径参数，无遍历面 ✅。
- **审计副作用（如实报告）**：为验证 CSRF 我调用过一次 `GET /api/focus?toggle=probe-nonexistent-id`，它向 `~/.dsh/dsh-history-viewer/focus.json` 写入了一个不存在的 id；已用同样的 toggle 调用撤销，并读回文件确认 `ids` 恢复为原单条 `session-d5192b12-…`。除此之外未改动任何文件、未安装、未运行 plugin manager。

---

## 8. 市场可发布性（对照 `PUBLISH.md`、`contributing.md`、`awesome-dsh-plugin-entry.yml`）

- `dsh.bundle` 声明 **[硬条件]** ✅（`package.json:49-51`），`cordis.patch.yml` 在仓库根 ✅，真实代码 ✅，client 半体不 require client 包 ✅ —— `PUBLISH.md:8-13` 的自检项属实。
- **条目文件本身**：`submission/awesome-dsh-plugin-entry.yml:1-6` 的字段形态（`url`/`name`/`category`/`description.en|zh`）与官方 `contributing.md` 完全一致 ✅；`url`/`name` 仍是 `CHANGE-ME` 占位符（P1，提交前必须改）；`category: ui` 合法，但插件同时具备很强的 `session` 属性，`PUBLISH.md:55` 也建议二选一（分类不会被打回，P2）。
- **缺的硬条件/推荐项**：
  1. `repository` 字段（**npm 关联硬条件**，`contributing.md` "npm package" 段；也影响 dshmarket 的"本地副本↔目录"身份匹配）——**P1**；
  2. 仓库 topic `dsh-plugin`（`contributing.md` 要求）——**P1**，且仓库需**创建满 1 天**（CI 自动查）✅ 已写在 `PUBLISH.md:26`；
  3. 仓库根目录 `screenshots.json`（1–8 张，相对路径），**该文件目前不存在**；包里仅有 `preview-plugin.png`（未在 `files` 里、也未被任何文件引用）——**P1（推荐项、市场详情页体验）**；
  4. `CHANGELOG.md`：**不存在**，但生态发布型插件普遍有（dsh-musage 列入 `files`），且 `version` 策略（`1.0.0` 起始）需要记录——**P2**；
  5. README 中英文：仅中文单文件（`README.md`，标题行混排英文）；better-sidebar/chat-manager 是 `README.md` + `README_EN.md`/`README.zh-CN.md`——**P2**（条目要求只是 description 双语，README 非硬条件）；
  6. 许可证一致性：`package.json:6` MIT ↔ `LICENSE` MIT ✅，仅署名占位——**P2**；
  7. `private` 字段不存在（对 npm 发布是正确的）✅；`keywords` 含 `dsh-plugin`/`deepseek-harness` ✅。

---

## 附：运行实例事实（供交叉验证）

- 已装：`~/.dsh/profiles/web/package.json` 中 `"dsh-history-viewer": "link:D:/dsh-history-plugin"`，junction 指向 `D:\dsh-history-plugin`；`bundles` 列表末位。
- 实测存活：`GET http://127.0.0.1:3080/plugins/dsh-history-viewer/` → 200 / 23197 B；`/api/sessions` → 200 / 747 B。
- 运行时：`dsh web --no-open --port 3080`（PID 35056），dsh `0.2.0-rc.2`，`engines.node >=20` 与实际一致但偏松。
- 缓存目录 `~/.dsh/dsh-history-viewer/`：`index.json`(32316 B)、`focus.json`、`text/`。
