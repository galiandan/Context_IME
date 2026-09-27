# 平台兼容性（0.1.4 本地预览）

| 平台 | 已实现 | 已编译/构建 | 自动测试通过 | 真实桌面输入法验证通过 |
|---|---|---|---|---|
| Linux x64 Fcitx5 | 探测、记录、查询、设置、读回 | TS + Linux x64 VSIX | 核心/进程/Adapter + 本地 VS Code 集成通过 | 用户反馈字符串和 C++ 头文件场景正常（旧版本）；0.1.4 未进行真实切换验证；Wayland/Fcitx5 只读探测和查询通过 |
| Linux IBus | 探测、枚举/记录、查询、设置、读回 | TS 已构建 | 协议 Fake Runner 测试通过 | 未进行真实环境验证；本机无 ibus 命令 |
| Windows x64/arm64 | 原生布局 helper、目标守卫、KLID 源；不支持 TSF profile/内部模式 | **未编译**；有 MSVC 构建脚本和 CI | 通用核心/原生输出错误处理测试通过；原生未运行 | 未进行真实环境验证 |
| macOS x64/arm64 | TIS 枚举/查询/选择、前台应用/PID 守卫 | **未编译**；有双架构构建脚本和 CI | 通用核心/协议测试通过；原生未运行 | 未进行真实环境验证 |
| Remote-SSH / WSL / Dev Containers | ui 宿主、本机后端、文档 API（不使用 URI 当本地路径） | manifest/TS 已构建 | 本地 UI 宿主声明测试通过；远程会话未测 | 未进行真实环境验证 |
| 浏览器 | 不提供 browser 入口；不支持 | 不适用 | manifest 检查 | 不支持 |

Windows/macOS 缺 helper 时打包会失败，不生成空功能平台包。首次 GitHub CI 已运行但五项失败（Windows 换行校验和、其他平台语义测试超时）；本轮修复后的 CI 结果见 docs/0.1.4-stability.md。Linux arm64 的 TS/WASM 没有本机原生依赖，但未运行于 arm64。

所有后端只确认输入源，不保证源内部的中文/ASCII/假名模式。Fcitx5 `-o` 仅激活，本项目不将其视为中文模式。未配置 code/text 两个方案不设置。不同语言均可配置实际已安装源。

真实桌面验收仍需用户授权后按 docs/08-testing-release.md 执行：候选词未提交、手动切换、输入焦点跳转、终端/搜索/命令面板、多窗口、系统按应用记忆、睡眠恢复、Windows TSF/第三方 IME、macOS TIS 与沙箱/签名、X11/Wayland/Electron 组合。当前没有冒称这些已通过。
