# dsh-history-viewer · DSH 历史查看器

**浏览、检索、导出你的 DSH 会话历史。** 纯本地读取会话日志，不依赖任何第三方插件，也不上传任何数据。

[![npm](https://img.shields.io/npm/v/dsh-history-viewer?label=npm)](https://www.npmjs.com/package/dsh-history-viewer)
[![GitHub](https://img.shields.io/badge/GitHub-xiao0xueAI%2Fdsh--history--viewer-blue)](https://github.com/xiao0xueAI/dsh-history-viewer)

一句话安装（然后**重启一次 `dsh web`**、刷新页面，左栏底部就会出现 🕘）：

```bash
dsh plugin --profile web add dsh-history-viewer
```

> 本机 npm 源若是只读镜像（如 npmmirror）且装不到最新版，临时用官方源：
> `npm_config_registry=https://registry.npmjs.org dsh plugin --profile web add dsh-history-viewer`


> 为什么需要它：DSH 官方的历史类插件（如 `dsh-history`）已经不适配 0.2.x（peer 范围把新版本排除在外，启动时会被拒绝加载）。本插件直接读
> `~/.dsh/sessions/**/session.v*.jsonl.zstd`，把历史变成可检索、可阅读、可导出的资源，插件生态怎么变都不影响它。

## 功能

- **侧边栏入口**：侧栏底部出现 🕘 按钮，点开在应用内浮层查看（也可"在新标签页打开"）
- **按项目（工作区）过滤**：项目名取自 DSH 自己的 `storages/workspace.json`，改过名/搬过目录也能正确归类
- **📌 固定会话**：把常看的会话固定住，只看这些（按项目分别记录）
- **范围切换**：只看对话 / 含工具 / 全部（思考过程与上下文注入）
- **项目内全文检索**：搜索结果按会话分组、带上下文、关键词高亮，**点一条直接跳到原文位置并闪烁**
- **Markdown 渲染**：正文与搜索卡片都按 DSH 界面那样渲染（标题/表格/代码块/粗体），不显示源码符号
- **导出**：把当前范围的对话一键导出为 Markdown
- **本地缓存**：索引缓存在 `~/.dsh/dsh-history-viewer/`，过期自动后台重建

## 安装

在任意 profile 里：

```bash
dsh plugin --profile web add dsh-history-viewer
```

从本地目录安装（开发用）：

```bash
dsh plugin --profile web add link:/path/to/dsh-history-viewer
```

装完**重启一次 `dsh web`**（Host 半体会热加载，但浏览器端的模块清单在启动时组装）。刷新页面后，侧栏底部就有 🕘 按钮。

## 怎么用（上手 5 分钟）

**入口**：刷新页面后，**左侧栏最底部**有一个 🕘 按钮 → 点开在应用内浮层里显示完整界面；
浮层右上角还有「在新标签页打开」（适合长时间翻历史，或让界面占满屏幕）。

**界面地图**：

```
┌ 左栏 ──────────────────┐┌ 右栏 ─────────────────────────────┐
│ 搜索框（回车=搜对话）   ││ 标题 + 路径 + 原文/渲染 + 导出     │
│ 项目下拉（工作区）      ││ ───────────────────────────────── │
│ 范围：只看对话/含工具/全部│ 正文（分页：← 更早 / 更晚 →）      │
│ 📌 只看固定的 N 个      ││   或 搜索结果（按会话分组卡片）    │
│ 会话列表（📌 可固定）   ││                                   │
└────────────────────────┘└───────────────────────────────────┘
```

**四个最常用动作**：

1. **只看某个会话**：鼠标移到左栏会话上点 **📌** 固定它 → 顶部按钮变成「📌 只看固定的 1 个」；
   再点这个按钮就在"只看固定的"和"本项目全部"之间切换（固定按项目分别记）。
2. **找一句话**：搜索框输入关键词回车 → 右栏按会话分组列出命中（带上文/下文、关键词高亮）→
   **点任意一条直接跳到原文那条消息**并闪烁定位。右上角可调「每个会话显示 8/20/50/全部」。
3. **导出这段对话**：右上角「导出这段对话」→ 下载 Markdown（按当前项目/固定/范围过滤）。
4. **看操作细节**：范围切到「含工具」（工具调用与结果）或「全部」（含思考过程与上下文注入）。

**看长会话**：正文是分页的，顶部有「← 更早 / 更晚 →」与「第 X–Y 条 / 共 N 条」，不会一次吐几 MB。

**插件版 vs 独立版**：插件版跟着 DSH 走（DSH 起来就能用，无需另开进程）；
独立的命令行版本不依赖 DSH，双击它的 `查看历史.cmd` 即可使用，适合分享给不想装插件的人。

## 数据与隐私

- 只读 `<DSH_HOME>/sessions`（默认 `~/.dsh/sessions`）与 `<DSH_HOME>/storages/workspace.json`
- 写：仅在自己的缓存目录 `~/.dsh/dsh-history-viewer/`（索引与固定配置）
- 路由只服务本机：连接来源必须是回环地址 + `Host` 精确白名单 + `Sec-Fetch-Site`/`Origin` 同源 +
  本次运行随机令牌（`/api/*` 必须带 `x-hv-token`），不做任何外部网络请求
- 环境变量：`DSH_HOME` 可指定 DSH 数据目录；`DSH_HISTORY_VIEWER_DIR` 可指定缓存目录

## 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 侧栏底部没有 🕘 | 装完插件后**重启一次 `dsh web`** 再刷新页面（浏览器端模块清单在启动时组装） |
| 第一次打开停顿几秒 | 首次访问要在 worker 里建索引（本机 88 个会话约 6 秒，之后不再发生，且不阻塞 DSH） |
| 打开是空的 | 可能固定了某个会话而它不在当前项目里 —— 点顶部「📌 只看固定的」或把项目切到「全部项目」 |
| 搜索结果很长 | 正文分页 + 每会话命中条数可调；点命中会跳到原文位置 |

## 已知边界

- 索引是快照：新会话由后台 worker 重建（默认 5 分钟冷却）；因此刚发出的消息可能要等一次刷新
- 检索结果里超长内容会截断（工具结果 4000 字、单条命中 900 字），截断不会切断 `**粗体**` 标记；原始日志始终完整
- 多帧 zstd 靠帧魔数切分（Node 的流式解码只解第一帧）；解析失败/空帧会计入索引里的 `stats` 而不是静默丢弃


## 开发

```
index.js        Host 半体：ctx.webServer.register 挂 /plugins/dsh-history-viewer（界面 + API）
lib/core.js     核心：多帧 zstd 解析、v3/v4 日志抽取、按 id 合并副本、项目归属、检索、转录导出
client.js       Client 半体：sidebar.footer.action 入口 + shell.overlay 浮层（iframe）
ui.html         界面本体（零依赖前端：Markdown 渲染 + 高亮 + 分页展开）
locale/*.json   插件卡片文案（中文/英文）
cordis.patch.yml  bundle 行声明
```

- 服务端：`ctx.webServer.register({ kind: 'prefix', path, handler })`（`inject: ['webServer']`）
- 客户端：`window.__ModuleLoader__.load({ id: '<包名>', factory })` + `ctx.slots.inject/register`
- 不 `require` 任何 `@deepseek-ai/dsh-client-*`（版本漂移会让 slot 条目崩溃），React 从 module table 取

## License

MIT
