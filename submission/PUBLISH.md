# 投稿到插件市场（awesome-dsh-plugin）——照着做即可

市场**不是**搜 npm 关键词，而是读一份**策展目录**：插件出现在市场里的唯一途径是往
[`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提一个 PR。

## 0. 已满足的硬条件（本仓库现状）

- [x] `package.json` 声明 `dsh.bundle.patch`（**这是最常被拒的原因**：只写 `dsh.client` 不算可安装插件）
- [x] 仓库根有 `cordis.patch.yml`
- [x] 真实可运行的代码（Host 路由 + Client 入口 + 界面，已实测）
- [x] `peerDependencies` 用预发布安全写法（`^0.1.7-rc.2 || ^0.2.0-rc.1 || ...`），且 optional
- [x] client 半体不 require 任何 `@deepseek-ai/dsh-client-*`（只从 module table 取 React）

## 1. 建仓库（1 分钟）

```bash
cd dsh-history-viewer
git init -b main
git add -A
git commit -m "feat: DSH history viewer plugin (browse/search/export session history)"
git remote add origin https://github.com/<你的账号>/dsh-history-viewer.git
git push -u origin main
```

然后**给仓库加上 topic `dsh-plugin`**（GitHub 仓库页 → About → Topics）。
注意：**仓库要建满 1 天**才会通过目录 CI。

## 2. 发布到 npm（可选，但推荐）

> 收录**不要求**发 npm；但发布后用户 `dsh plugin add dsh-history-viewer` 更顺。
> 若发布，`package.json` 的 `repository` 必须指回仓库，否则目录站点不会关联下载量。

```bash
npm login
npm publish --access public     # 包名已存在时改名，例如 @你的账号/dsh-history-viewer
```

发布前可先本地检查包里都有什么：

```bash
npm pack --dry-run
```

**必须确认 tarball 里包含** `client.js`、`ui.html`、`lib/core.js`、`cordis.patch.yml`、`locale/*.json`
（漏了 client bundle 会在运行时抛 `client-modules: client bundle not found`）。

## 3. 提 PR 到目录

1. Fork `awesome-dsh-plugin/awesome-dsh-plugin`
2. 新增**一个**文件：`data/plugins/<你的账号>__dsh-history-viewer.yml`
   （内容照 [`awesome-dsh-plugin-entry.yml`](./awesome-dsh-plugin-entry.yml) 改，`url` 必须与仓库**完全一致**）
3. 一个 PR **最多 3 条**；描述要逐句能被代码验证（夸大是打回主因）
4. 推送后等 CI：条目数 → 从仓库读 `dsh.bundle` → 仓库年龄 → awesome-lint + 站点构建

合法 `category`：`agi ui usage theme model identity session memory tools wsl browser vision voice docs skill workflow git notify dev security remote market fun`
（本插件建议 `ui`；若想强调"会话管理"可用 `session`。）

## 4. 截图（可选）

把 1~8 张截图放进仓库（例如 `docs/assets/screenshots/`），再在**插件目录**建 `screenshots.json`：

```json
{
  "https://github.com/<你的账号>/dsh-history-viewer": [
    "https://raw.githubusercontent.com/<你的账号>/dsh-history-viewer/main/docs/assets/screenshots/01-list.png",
    "https://raw.githubusercontent.com/<你的账号>/dsh-history-viewer/main/docs/assets/screenshots/02-search.png"
  ]
}
```

约束：相对路径不得跳出插件目录；`icon.svg` ≤ 256 KiB（本包 icon 0.5 KB ✓）。

## 5. 用户怎么装

```bash
dsh plugin --profile web add dsh-history-viewer     # 已发 npm
# 或从 GitHub：
dsh plugin --profile web add github:<账号>/dsh-history-viewer
```

装完重启一次 `dsh web`，刷新页面后侧栏底部出现 🕘 按钮。

## 6. 提交前自检清单

- [ ] `npm pack --dry-run` 里能看到 `client.js` / `ui.html` / `cordis.patch.yml`
- [ ] `dsh plugin --profile web add link:$(pwd)` 装上后 `/plugins/dsh-history-viewer/` 返回 200
- [ ] 重启后引导清单里出现 `<包名>/client.js`（不重启看不到按钮，这是正常的）
- [ ] 侧栏底部 🕘 按钮可见、点击弹出浮层、浮层里能列出会话并搜索
- [ ] 描述里的每句话都能在代码里找到对应实现
