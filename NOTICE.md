# NOTICE

本插件（`dsh-destinywind-mcp`）是基于第三方开源项目修改而来的衍生作品，不是原创。

## 上游

- 项目：`dsh-mcp`
- 版本：1.12.0
- 作者：Arvin.qi <arvin.qi@qq.com>
- 仓库：https://github.com/ArvinQi/dsh-mcp
- 许可：MIT（见同目录 `LICENSE`，版权归原作者所有）

## 本仓库所做的修改

1. 包名由 `dsh-mcp` 改为 `dsh-destinywind-mcp`；客户端包的模块加载 id 同步改名
   （`window.__ModuleLoader__.load({ id })` 必须等于包名）。
2. 设置页导航项的顺序由 `order: 25` 改为 `order: 18`，使其排在「技能」页
   （`order: 17`）正下方。
3. 新增 `dsh.bundle.patch` 与 `cordis.patch.yml`，使插件可通过
   `plugin_manager` 的 `install_bundle` 即插即用（上游包没有这两个文件，
   需要手工往 profile 的 `cordis.patch.yml` 里追加行）。
4. 新增 `peerDependencies` 声明。DSH 的模块拦截层按「导入方自己的
   `package.json` 的 peerDependencies」判定是否路由到安装级副本，
   上游包未声明，`link:` 安装时 `@deepseek-ai/*` 会解析失败。
   其中 `@deepseek-ai/cordis-plugin-include` 是 `lib/cordis-servers.js`
   实际导入的包，缺它会直接导致插件激活失败（`failed to import`）。
5. 内置 MCP 服务预设模板（见 `src/client/presets.ts`），表单可一键预填。
   预设目录现只保留 GitHub 一项（唯一在本机端到端验证过的配方），
   其余条目与对应文案一并删除。
6. 移除上游 README/CHANGELOG 中与 npm 发布、GitHub 安装相关的章节。
7. 修正 `scripts/build.mjs`：上游把 esbuild 的 `nodePaths` 写死为空数组，
   在 `link:` 安装下构建客户端包会报 `Could not resolve "zod"`；
   现按实际存在的目录补全解析路径。
8. `GlobalEnvEditor` 的「批量添加」默认把带值的行标记为私密
   （上游默认明文，粘贴 token 时会写进配置文件）。
9. 补上 `package.json` 已声明但缺失的 `icon.svg`。
10. 「新增服务器」由页面内联表单改为弹窗，预设选择器移入弹窗；编辑既有服务器
    仍在对应行下方就地展开。弹窗由 UI 原语 `Modal` 实现（见第 12 项），
    不再使用自绘的 `overlay` / `dialog`。
11. `GlobalEnvEditor` 的变量列表改为逐行列表（`.genvRow` 三列网格：变量名 +
    私密/明文标记、值、操作），新增与编辑走弹窗；已保存的行不允许改名
    （变量名就是凭据文档的键，改名会孤立已存的密文）。列表类名统一用
    `genv*` 前缀，避免与 `McpSettingsSection.module.css` 的同名 `.row` 相撞
    （后者后注入，会覆盖前者）。
12. 设置页 UI 改用 DSH 的 UI 原语（`@deepseek-ai/dsh-client-ui-primitives`）：
    按钮、弹窗、标签、复选框、分段控件分别换成 `Button`、`Modal`、`Tag`、
    `Checkbox`、`SegmentedControl`，弹窗的 Escape 关闭、焦点陷阱与焦点归位
    交给 `useModalLayer`。相应地删掉了本插件自绘的按钮样式（`ServerForm` 的
    `.form button`、`ServersJsonEditor` 的 `.actions button`、
    `GlobalEnvEditor` 的 `.actions button`）——本插件的 `*.module.css` 是
    **原样注入、类名不做哈希**，任何规则都是全局的，自绘控件样式曾误伤
    输入框旁的圆形发送按钮。`ServersJsonEditor.module.css` 的类名一并加
    `json` 前缀，因为它在 `ServerForm.module.css` 之后注入，同名的
    `.hint` / `.error` / `.actions` 会连带改掉服务器表单的文案样式。
    页面结构改为「标题 + 注入模式 + 设置卡片」，卡片沿用设置页的
    `--dsw-alias-settings-card-*` 令牌。
13. `GlobalEnvEditor` 改为**即时生效**：新增、编辑、批量添加、删除各自确认后
    立即调用 `envSet` 写盘，宿主的回包直接成为新状态，底部的「保存」按钮与
    行上的「未保存」标记一并删除。原因是 `envSet` 的语义是**整体替换**，
    各操作此前都只改本地草稿，不点保存则全部丢弃——而按钮只有「添加变量」
    一条路径时，弹窗里的「确定」看起来就该完成一切，于是那个「保存」既像
    多余又确实必需，是个误导。相应地把校验与序列化抽成 `toPayload`、把写盘
    抽成 `commit`，并给每个入口加 `busy` 守卫：写穿之后若从过期的 `rows`
    快照发起第二次提交，会把第一次正在删除的行又加回来。
    新增文案 `globalEnvRemoved`（已删除），删除死键 `globalEnvSave`、
    `globalEnvSaving`、`globalEnvPending`。

上游代码未做逻辑改动；`lib/` 下的宿主半文件（`index.js`、`mcp-client.js`、
`oauth.js`、`probe.js`、`transport.js`、`cordis-servers.js`、`patch-writer.js`、
`host-locales.js`）与上游 1.12.0 一致，仅 `lib/client.js` 因改名、排序与上述
第 5、8 项重新构建。
