# 10 · 资料、来源与核验边界

历史设计核验日期：2026-09-27。**本轮实现核验、固定版本、已阅读源码及未验证项见 [verified-references.md](verified-references.md)；以下保留早先设计阶段的核验边界，不代表当前实现状态。**引用仓库分支页面只是查阅快照，不是依赖锁定。当前未引入第三方代码/grammar/WASM；实施时必须固定实际版本与许可证，不能把“计划使用”写成“已经打包”。

## 1. VS Code 与分词

| 来源 | 本次依据与边界 |
| --- | --- |
| [稳定 Extension API](https://code.visualstudio.com/api/references/vscode-api) | 早前已查阅编辑器/文档/窗口接口；本轮重抓取超时。实施再核对固定版本 vscode.d.ts，不假设 token/composition 私有接口公开可用 |
| [Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host) | 本地/远程/UI 宿主区分；本轮查阅 |
| [TextMate 仓库](https://github.com/microsoft/vscode-textmate)及[公开接口源码](https://raw.githubusercontent.com/microsoft/vscode-textmate/main/src/main.ts) | 本轮核对 tokenizeLine、ruleStack、stoppedEarly、StateStack.equals、grammar 加载接口 |
| [Oniguruma 仓库](https://github.com/microsoft/vscode-oniguruma)及[README](https://raw.githubusercontent.com/microsoft/vscode-oniguruma/main/README.md) | WASM 绑定与分发资源；本轮查阅，未构建/计量 |
| [平台 VSIX](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) | 平台定向打包；具体工具版本与 target 在实施时固定 |

TextMate 库提供逐行状态接口，不替本项目管理文档 edits。不得将“选用解析库”“使用防抖”描述成增量已验证；不能从 editor 内部直接读取完整缓存，也不依赖未公开命令。

## 2. 参考扩展与工具

| 参考 | 本次确认层级 | 影响本项目的选择 |
| --- | --- | --- |
| [daipeihust/im-select](https://github.com/daipeihust/im-select) | 仓库/说明查阅；未完成固定 commit 的逐文件审计，本轮猜测 Windows 源码路径返回 404，不据此编造实现 | 作为原生源选择路线参考；不能照搬语言数值或假设内部模式受控 |
| [CI124.auto-ime](https://marketplace.visualstudio.com/items?itemName=CI124.auto-ime) | 市场说明与[仓库 README](https://github.com/CI124/auto-ime/blob/081a5a49a0fa4af41f4377497453b06bb2103997/README_EN.md)查阅，非发布 VSIX 源码一致性审计 | 页面描述注释导向、轮询/热键路径及全量解析限制；本项目采用字符串导向、无轮询、不模拟热键、真实行缓存 |
| [zlflly.smart-cursor](https://marketplace.visualstudio.com/items?itemName=zlflly.smart-cursor) | 市场说明与[仓库入口](https://github.com/zlflly/SmartCursor)查阅，非完整源码审计 | 借鉴记录输入源的引导；其 Windows/WSL 工具依赖不能证明本项目三平台支持 |

第三方声称的速度、资源节约或实时状态不作为本项目实测数据。后续实现前沿市场链接核实源码仓库、发布版本、commit、实际进程调用与测试；无法访问时记录未核实并继续可验证工作，不推断内部实现。

## 3. 平台资料

- [WM_INPUTLANGCHANGEREQUEST](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-inputlangchangerequest)：目标窗口处理输入语言请求，不等于已完成设置。
- [TSF ActivateProfile](https://learn.microsoft.com/en-us/windows/win32/api/msctf/nf-msctf-itfinputprocessorprofilemgr-activateprofile)：profile 激活候选 API，跨进程/Electron 行为仍待原型。
- [Apple keyboardInputSources](https://developer.apple.com/documentation/appkit/nstextinputcontext/keyboardinputsources)：实际输入源标识；TIS 具体函数/线程要求还需 SDK 及实机复核。
- [Fcitx5 remote.cpp](https://raw.githubusercontent.com/fcitx/fcitx5/master/src/tools/remote.cpp)：本轮核对 -n/-s/-o/-c/--check 及调用的框架方法，注释声明 LGPL-2.1-or-later；本项目计划调用系统工具，不复制该源码。
- [IBus 命令源码](https://github.com/ibus/ibus/blob/main/tools/main.vala)：引擎查询/设置/枚举参考；实施还需固定工具版本和输出 fixture。
- [IBusBus 参考](https://ibus.github.io/docs/ibus-1.5/IBusBus.html)：理解框架能力，首版不因此引入 libibus 原生依赖。

文档/源码能说明接口语义，不能证明本项目在真实桌面成功控制目标输入法。

## 4. grammar 与许可证接入要求

首选从 VS Code 官方语言扩展所使用的 grammar 及其上游仓库选取固定版本，再按依赖图完整打包。不能直接断言 VS Code 仓库中所有 grammar 都只适用同一个 MIT 许可证；逐文件追溯上游版权和额外 notices。

实施时创建 `grammars/manifest.json` 和 `THIRD_PARTY_NOTICES.md`，每项包含：语言/scope、仓库 URL、上游文件路径、commit/tag、包版本、SHA-256、依赖 scope、许可证标识、许可证正文路径、本地修改说明。npm 包与 helper 引用代码同样登记。

当前状态：TextMate/Oniguruma 拟采用官方包，精确版本未定；五种语言 grammar 尚未选定固定 commit；helper 尚未引入；参考项目声明的许可证不替代复制时的固定版本核查。实施应先完成固定与审查，再生成 lockfile、构建离线资源和许可证清单，不运行时下载。

## 5. 证据分级

官方接口可查、设计已确定、源码已实现、产物已编译、自动测试通过、真实环境验证通过是不同事实。当前只完成前两类的部分核实与文档设计，没有后四类成果。未知项由[实施计划](09-roadmap.md)和[测试门槛](08-testing-release.md)推进，不靠修改文案消除。
