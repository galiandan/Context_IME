# Context IME

在代码和文本之间移动光标时，自动选择你配置的输入源。

当前为 **Linux x64 预览版**，支持 Fcitx5 和 IBus。Fcitx5 已有本地使用反馈，IBus 尚未完成真实桌面验证。此发布包不提供 Windows/macOS 功能。

## 能做什么

- 字符串内部使用 text 输入方案，回到代码使用 code 输入方案。
- 注释默认使用 code，可设置为 text 或 keep。
- C/C++ 的 `#include <…>` 和 `#include "…"` 头文件路径保持 code。
- 支持 Python、JavaScript、TypeScript、C、C++；识别插值表达式与嵌套字符串。
- 同一区域内不反复强制切换，允许你手动选择输入源。

## 首次配置

安装后显示“待配置”，此时不会自动切换。

1. 在命令面板执行 **Context IME：配置输入方案**。
2. 为 code 选择用于编程的输入源，为 text 选择用于文本的输入源。Fcitx5 可先用系统方式切换，再记录当前源。
3. 回到单光标编辑区，执行 **Context IME：重新同步**。
4. 需要让注释使用文本方案时，在设置中将 `autoIme.rules.comment` 改为 `text`。

状态栏点击启停；它显示自动规则状态，不是实时输入法指示器。遇到问题可执行 **Context IME：打开诊断**。

## 使用前提与限制

需要系统已安装并运行 Fcitx5（含支持 `--check` 的 `fcitx5-remote`）或 IBus（含 `ibus` 命令）。扩展不会安装或启动系统输入法。如果两个框架都可用，在 `autoIme.backend` 中明确选择一个。

切换的是输入源，不是输入法内部的中文/英文模式。例如 Rime 内按 Shift 切换中英文，可能仍是同一个 `rime` 输入源；把两个方案都记录为它，不会产生预期的中英文切换。

多光标、非空选区、不支持的语言及超出分析预算的文档会暂停自动切换。公开 VS Code API 不能完整观察输入控件焦点和 IME composition；Linux 焦点保护为 bestEffort，系统切换也是异步操作。真实候选词、多窗口、不同桌面和远程工作区的兼容性仍需持续验证。

不支持浏览器版，也不适配终端、搜索框、Git 提交输入框、Notebook、Markdown 和 Vim 模式。

## 隐私与资源

语法资源和 Oniguruma WASM 随包分发，不在运行时下载。不上传代码，不调用云端分析，不修改代码和标点，不记录输入文本或候选词；没有遥测。平台调用使用短时进程，不额外运行常驻 daemon，不轮询输入源。

## 主要设置

| 设置 | 用途 |
|---|---|
| `autoIme.enabled` | 启用或停用 |
| `autoIme.enabledLanguages` | 启用的编程语言 |
| `autoIme.rules.code/string/comment` | code、text、keep 策略 |
| `autoIme.backend` | 自动探测或明确选择后端 |
| `autoIme.fcitx5.code/text`、`autoIme.ibus.code/text` | 本机输入方案 |
| `autoIme.switchDelayMs` | text 方案切换合并延迟，返回 code 不额外等待 |
| `autoIme.maxFileSizeKB` | 文件大小阈值 |
| `autoIme.debug` | 有界诊断日志，默认关闭 |

输入方案为本机设置，不盲目跨机器同步。许可证：MIT；随包保留第三方 grammar、TextMate 和 Oniguruma 的许可证及来源清单。
