# 第三方资源

运行时全部离线。精确 npm 版本、完整性见 package-lock.json；运行时包 commit 和 WASM 哈希见 resources/manifest.json；grammar commit、哈希、依赖图和本地补丁见 grammars/manifest.json。

- vscode-textmate 9.2.0：Microsoft，MIT，licenses/vscode-textmate-LICENSE.txt。
- vscode-oniguruma 2.0.1：Microsoft，MIT；Oniguruma 内嵌许可也保留于 licenses/vscode-oniguruma-LICENSE.txt 和 licenses/vscode-oniguruma-NOTICES.txt。
- Python：MagicStack/MagicPython；C：jeff-hykin/better-c-syntax；C++ 及宏：jeff-hykin/better-cpp-syntax；JS/TS：microsoft/TypeScript-TmLanguage。使用 VS Code 1.95.3 固定 commit 内的转换产物，各上游版权与 MIT 正文见 licenses/vscode-ThirdPartyNotices.txt 对应条目；VS Code 许可见 licenses/vscode-LICENSE.txt。
- C/C++ 可选嵌入高亮已删除，宏依赖完整分发；不是复制另一套词法引擎。
- 本项目 helper 为原创；im-select、auto-ime、SmartCursor 仅作接口/交互研究，未复制其代码或二进制。系统 Fcitx5/IBus 不复制到扩展包。
- esbuild、TypeScript、tsx、eslint、vsce 等仅是构建/测试依赖，不随 VSIX 分发；完整锁定树在 package-lock.json。
