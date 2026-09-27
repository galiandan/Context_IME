# 本轮源码核验（2026-09-27）

源码快照信息及已抓取文件哈希见 reference-audit.json；它是查阅记录，不是所有文件完整审计，也不是发布 VSIX 与仓库一致性的证明。第三方性能宣传未用于本项目性能结论。

| 对象 | 固定版本/commit | 核验结论 |
|---|---|---|
| VS Code API | @types/vscode 1.95.0；grammar/相关 API 源码 f1a4fb101478ce6ec82fe9627c43efbf9e98c813 | 稳定 document/selection/window API；无完整 token/composition API；ui 要求本地桌面宿主 |
| vscode-textmate | 9.2.0 / f0f2a44b4c055b0e0fa3869e5de338efda5b7cf1 | tokenizeLine、stoppedEarly、StateStack.equals；库不负责文档编辑缓存 |
| vscode-oniguruma | 2.0.1 / 184a6e2d4603c5a31efc0a33f544be1545d9ec6b | loadWASM、本地 wasm；NOTICE 中 Oniguruma 6.9.5_rev1 许可完整保留 |
| im-select | 9cd5278b185a9d6daa12ba35471ec2cc1a2e3012 | 查阅 macOS main.m 的 TIS 路径及 Windows im-select.cpp；后者取 HKL 低 16 位语言值并 PostMessage，本项目不照搬源身份简化 |
| CI124.auto-ime | 0.9.1 / 081a5a49a0fa4af41f4377497453b06bb2103997 | 查阅 ASTAnalyzer.ts、poller.ts、Linux adapter 等；Tree-sitter parse(text) 与循环 timeout 路线不是本项目实现 |
| zlflly.smart-cursor | 1.0.6 / f8c77f0e74f0cce797a307161bc77412cdee7d5c | 查阅 package.json、extension.js；手动记录源、im-select/PowerShell/WSL 与周期监控只作参考；本项目不复制 |
| Fcitx5 | 586a986c5af83f83bd6787c0bd019ca21473fef0，src/tools/remote.cpp；本机 5.1.23 | --check 不启动框架；-n/-s 查询/指定源；-o 调 Activate，不保证中文模式 |
| IBus | d464316d9b9613005c5573a010fec7f9b40b93b6，tools/main.vala | engine 查询/设置 global engine；list-engine --name-only 每行一个 ID；无法枚举时手动记录 |

官方入口：[Extension API](https://code.visualstudio.com/api/references/vscode-api)、[Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host)、[TextMate](https://github.com/microsoft/vscode-textmate)、[Oniguruma](https://github.com/microsoft/vscode-oniguruma)、[WM_INPUTLANGCHANGEREQUEST](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-inputlangchangerequest)、[Apple 输入源](https://developer.apple.com/documentation/appkit/nstextinputcontext/keyboardinputsources)。

Windows API 文档只证明接口语义，不证明 Electron/TSF 实际可控。macOS TIS API 名称与 im-select 源码一致，但本机没有 Apple SDK，SDK 编译与硬件验证仍未完成。对 Windows KLID 注册表映射、系统输入线程、TIS 选择、X11/Wayland 桌面行为不作超出当前测试的兼容承诺。

完整上游 grammar commit 已从每个 grammar 的 version 字段提取到清单：MagicPython 7d0f2b22a5ad8fccbd7341bc7b7a715169283044；TypeScript-TmLanguage b80b7509a78e642f789c567e144ed951ab98b4e3；better-c-syntax 34712a6106a4ffb0a04d2fa836fd28ff6c5849a4；better-cpp-syntax f1d127a8af2b184db570345f0bb179503c47fdf6。
