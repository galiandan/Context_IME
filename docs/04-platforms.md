# 04 · 平台能力与兼容性口径

## 1. 原生路线

“跨平台”指三个桌面系统分别提供真实适配，不以三个空接口或 Mock 代替。Windows/macOS 使用随对应 VSIX 分发的短时原生 helper；Linux 允许依赖用户已有的 Fcitx5/IBus 框架命令，它们使用框架正式接口，不是操作系统兼容层。

不引入 Wine、xdotool、模拟 Shift/Ctrl+Space、PowerShell 循环、全局键盘钩子或进程注入。不要求终端用户另装 Node.js/编译器，不在运行时下载二进制。直连 D-Bus、原生模块等后续优化必须由进程启动与资源实测证明必要性。

## 2. 统一能力

| 能力 | 返回内容 |
| --- | --- |
| 探测 | 后端存在、服务可用、版本或失败原因 |
| 发现方案 | 枚举实际源，或声明只能由用户手动切换后记录 |
| 查询 | 可观察的 sourceId、可选模式、时间戳、未知字段 |
| 设置 | 请求是否接受、实际观测、已验证字段和错误 |
| 焦点 | `window / application / bestEffort / unavailable` |
| 内部模式 | 是否可读/可写，按具体输入法而非仅按 OS 声明 |
| 通知 | 是否有可靠变化事件；首版短时 CLI 后端不假设有 |
| 释放 | 取消待处理任务、结束短时进程、释放资源 |

sourceId 在各后端内不透明且带后端标识。source、active、IME open/conversion 分别表达，不用单个“中文=true”合并。源已经读回匹配但模式未知时，只能报告源已确认。

## 3. 当前兼容性记录

实际四级结果已集中记录于 [compatibility.md](compatibility.md)，包括 Linux TS/VSIX、本地 VS Code 自动测试、原生未编译平台和所有实机验证缺口。

实施后按架构、系统版本、桌面、框架版本、安装方式拆成实际报告；Linux 无自有 helper 时编译列注明“TS 构建结果；系统工具不由本项目编译”。不能用 CI 跨编译成功替代原生运行测试。

## 4. 远程与浏览器

设置 `extensionKind: ["ui"]`，本地适配器基于本地 Extension Host 的 OS 选择。Remote-SSH、WSL、Dev Containers 的文档由 VS Code API 提供；不将远程 URI 当本地路径，不在远程 Linux 执行命令控制本地 Windows 输入法。

必须在集成测试中确认扩展实际位于本地宿主，不能只因为 manifest 写了 ui 就省略验证。纯浏览器 vscode.dev/github.dev 不提供系统控制，不以远程服务器 helper 充当浏览器输入源控制。[Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host)

## 5. 发布边界

只有真实适配和构建产物具备时才生成对应平台包；预览版可明确标注未实机验证，正式支持声明必须附实机记录。最低 OS、VS Code、框架版本由最终 API 和测试结果确定。

已知会误切其他应用或打断组合输入的组合阻断自动模式正式发布。框架缺失、权限不足、源不存在显示诊断，不静默失败，不擅自安装组件或修改系统输入法配置。
