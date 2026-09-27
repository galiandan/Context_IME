# Context IME · VS Code 自动切换输入法

光标进入字符串的可输入内容区域时使用文本输入方案，回到代码区域时使用代码输入方案。输入语言由用户选择；注释默认跟随代码，也可配置为文本方案或保持现状。

- package name：`vscode-auto-ime`
- 展示名称：`Context IME`
- 设置与命令前缀：`autoIme`
- 首版语言：Python、JavaScript、TypeScript、C、C++
- 目标环境：Windows、macOS、Linux 桌面版 VS Code

**当前源码版本为 0.1.7，五平台构建与发布以 GitHub Actions 运行结果为准。** 分类/增量缓存/控制器/平台进程与本地 VS Code 集成已自动测试；用户已反馈 Linux 字符串和 C++ 头文件切换正常；候选词、多窗口及 Windows/macOS 原生环境尚未系统验证。详见[交付记录](docs/delivery.md)、[兼容性](docs/compatibility.md)、[性能实测](docs/performance-results.md)。

0.1.1 修复了注释回车后漏处理选区事件、直到首个字母才切回 code 的问题；详见 [修复记录](docs/0.1.1-newline-fix.md)。

0.1.6 在容量压力下淘汰 token、保留可信行状态，并按实际 scanner 初始化进展有限重试；见 [大文件与冷启动记录](docs/0.1.6-cache-cold.md)。

0.1.5 优化长字符串/注释定位和缓存内存分配；对照结果见 [性能优化记录](docs/0.1.5-performance.md)。

0.1.4 修复快速输入时的漏切竞态，优化单行编辑缓存，增加冷分词有限重试与暂停原因；实测和验证边界见 [修复记录](docs/0.1.4-stability.md)。

0.1.3 将 C/C++ 的 `#include <…>` 和 `#include "…"` 头文件路径归为 code，包含尚未闭合的路径输入。

源码仓库：[galiandan/Context_IME](https://github.com/galiandan/Context_IME)。

## 发布身份与市场包

发布者：`Galiandan-CIO`；扩展完整 ID：`Galiandan-CIO.vscode-auto-ime`。

`npm run package:marketplace` 生成使用市场介绍页的 Linux x64 包，输出文件名带 `-Galiandan-CIO` 后缀。此命令只打包，不上传市场。市场发布包可在对应 Publisher 的管理页上传。

早期本地包 ID 为 `context-ime-local.vscode-auto-ime`，与正式发布者的包是两个扩展。安装新身份的包时请停用或卸载旧身份的版本，避免两个实例同时管理输入法；`autoIme.*` 用户设置继续沿用。

终端发布与更新：见 [本地发布指南](docs/publishing.md)。`npm run publish:marketplace -- --run-id <成功运行ID> --dry-run` 下载并校验 CI 包；去掉 `--dry-run` 上传完全相同的构建产物，不在本地重新编译。

## 安装与使用

当前机器可安装：

```sh
code --install-extension artifacts/vsix/vscode-auto-ime-0.1.7-linux-x64.vsix
```

也可在扩展面板选择“从 VSIX 安装”。第一次显示“待配置”，不猜输入源。命令面板执行 **Context IME：配置输入方案**，分别选 code/text 输入源；Fcitx5 可手动切换后记录当前。配置过程不会试切，不安装系统组件。回编辑器执行 **Context IME：重新同步**。相同输入源并不保证内部中英文模式转换。

单光标进入字符串用 text、回代码用 code；注释默认 code，可以将 `autoIme.rules.comment` 设为 `text` 或 `keep`。同一区域的后续输入/移动不会反复设源，因此用户手动切换后不会在下一按键被抢回。状态栏悬停可直接打开配置与诊断，显示具体暂停原因；点击启停；它显示规则状态，不是实时输入法指示器。错误查看 **Context IME：打开诊断**。

本版优先保守：多光标、选区、未知语言、超长行、预算/缓存超限、失焦等暂停；回焦等待有效编辑器交互。公开 API 不能完整观察 composition/所有输入控件焦点，Linux 仅 bestEffort。窗口内终端/搜索框/命令面板、真实候选词行为仍须实测。Windows 目前只提供 KLID 布局，TSF profile 和内部模式不支持。

## 开发、F5 与打包

跨平台编译和打包交给 [GitHub Actions](docs/github-actions.md)：分支 push/PR 自动构建五个平台 VSIX，推送匹配版本的 `vX.Y.Z` Tag 自动创建 GitHub Release。macOS 的 Swift 检查和编译使用 GitHub macOS Runner，本地无需安装 Xcode/Swift。

当前机器已通过 pacman 安装 Node.js/npm，直接使用系统 `node` 和 `npm`，不再需要修改 PATH。所有 npm 工具均在项目的 dependencies/devDependencies 中固定版本；不需要全局安装 vsce、TypeScript、ESLint 等工具。

```sh
npm ci
npm run check
npm run build
npm run test:integration
npm run package:marketplace
npm run verify:vsix
```

按 **F5** 选择“Context IME”，预启动任务直接运行项目的 npm build。目录结构、项目级安装方式和清理命令见[开发指南](docs/development.md)。安装包集中在 `artifacts/vsix/`，测试/性能报告在 `artifacts/reports/`，临时文件在 `artifacts/tmp/`。`npm run clean` 只清理可重建的构建/测试中间产物，保留 VSIX 和报告。

Windows/macOS 最新源码优化及未验证边界见 [原生优化记录](docs/native-optimization.md)，Swift 的 Mac 编译步骤见 [macOS 文档](docs/platforms/macos.md)。

`npm run native:build` 在 Windows MSVC 开发者终端构建 helper；macOS 使用 Xcode Command Line Tools 与 `TARGET_ARCH=x64/arm64`。`npm run package -- win32-x64` / `darwin-arm64` 等生成对应包；缺失 helper 即失败。只使用已有工具，项目不会自动安装系统 SDK、签名或发布。构建矩阵见 `.github/workflows/ci.yml`。

缓存、资源、scope 修正和调度细节见[实现核验](docs/implementation-notes.md)。运行资源完全离线，来源/commit/许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [开发与目录约定](docs/development.md) | 系统 Node/npm、项目级依赖、脚本与产物目录 |
| [架构摘要与方案取舍](docs/architecture.md) | 两版方案如何合并、关键技术决策 |
| [需求与验收](docs/01-requirements.md) | 首版范围、字符串边界、默认行为 |
| [架构与事件调度](docs/02-architecture.md) | 模块、状态机、手动接管、焦点、并发 |
| [上下文识别](docs/03-context-engine.md) | TextMate、插入位置、嵌套作用域、语言规则 |
| [增量缓存](docs/11-incremental-cache.md) | 行号映射、状态收敛、工作预算、取消 |
| [平台总览](docs/04-platforms.md) | 统一能力、远程宿主、兼容性等级 |
| [Windows](docs/platforms/windows.md) | Win32 / TSF / IME 状态与短时 helper |
| [macOS](docs/platforms/macos.md) | TIS 输入源与 Intel / Apple Silicon 构建 |
| [Linux](docs/platforms/linux.md) | Fcitx5、IBus、X11 / Wayland |
| [配置与交互](docs/05-configuration.md) | 设置、向导、命令、状态栏与诊断 |
| [平台调用契约](docs/06-native-protocol.md) | Adapter、短时进程、验证与错误处理 |
| [性能设计](docs/07-performance.md) | 轻量化约束、预算、可重复测量 |
| [测试与交付](docs/08-testing-release.md) | 核心测试、实机测试、CI、平台 VSIX |
| [实施计划与风险](docs/09-roadmap.md) | 开发顺序、阶段门槛、风险台账 |
| [资料与核验](docs/10-references.md) | 官方资料、参考实现、版本和许可证管理 |

建议从架构摘要开始，再阅读需求、识别、缓存和事件调度。每个主题只有一处详细规范，其他文件通过链接引用。

## 合并后的设计主线

TypeScript 严格模式 + 稳定 VS Code API；使用按需加载、随包分发的 TextMate grammar 与 Oniguruma WASM。上下文识别使用行级增量缓存，不能可靠判断时保持输入法不变。

平台控制采用事件触发的短时调用：Windows/macOS 使用包内原生 helper，Linux 使用用户已有框架的 `fcitx5-remote` / `ibus`。不轮询、不常驻额外 daemon、不模拟输入法快捷键、不运行时下载二进制。

保留原方案的分文件组织、能力分级、保守降级、串行调度和风险记录；采用后续方案更完整的语法覆盖、缓存验收与工程交付要求。详细取舍见[架构摘要](docs/architecture.md)。
