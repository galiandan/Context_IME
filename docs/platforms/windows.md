# Windows · 短时原生 helper

## 1. 输入源与模式分层

优先使用小型可审查的 Win32 helper，每个请求执行完退出，不弹控制台、不抢焦点。可以参考 im-select，但不能把 1033/2052 这样的语言标识当作用户输入源的唯一身份。

布局路径以实际已加载布局及可解析稳定 ID 为基础；目标是本地 VS Code 前台窗口/输入线程，不是在 helper 自己线程调用 `ActivateKeyboardLayout`。候选设置方式为向正确目标窗口发送 `WM_INPUTLANGCHANGEREQUEST`，读回目标线程布局确认。[Microsoft 消息文档](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-inputlangchangerequest)

TSF 输入服务还需要区分 profile GUID、CLSID、语言与布局。`ITfInputProcessorProfileMgr::ActivateProfile` 的进程/线程/会话范围必须原型核验；不能认为 helper 创建的 TSF manager 自动连接到 Electron 编辑器。[ActivateProfile](https://learn.microsoft.com/en-us/windows/win32/api/msctf/nf-msctf-itfinputprocessorprofilemgr-activateprofile)

IME open/conversion 与源选择独立。IMM32 能否跨进程获取有效 HIMC、目标是否采用 TSF-only 路径都影响可读写能力。未经实测的接口不用于宣称内部中文模式已确认；默认提供源选择，内部模式能力可以明确 unsupported/unknown。

## 2. 目标与源身份

执行前获取 foreground HWND，查询进程身份及输入线程，检查所属本地 VS Code 应用。不能只匹配窗口标题或进程名字片段；扩展宿主 PID 也不是接收键盘的渲染器 PID。请求绑定的窗口/进程需要重新验证，避免启动 helper 期间前台已变。

持久化源标识不能只用本次会话的裸 HKL 或 HWND。每次短 helper 重新解析记录的稳定源 ID；无法区分的 TSF profile 标能力受限，不能取低位语言代码强行归并。源枚举受限时允许记录当前可观察方案，并提示无法识别的内部模式。

应用级检测不等于精确编辑控件检测；同一 VS Code 内的搜索框、终端、命令面板仍依赖扩展门控和测试。

## 3. 执行与确认

使用有界消息/API 调用，不无限同步等待目标窗口。请求接受、源读回匹配、模式读回匹配分别记录；任何无法确认字段保持 unknown。设置后只进行有界确认，不创建后台轮询。

超时停止等待并清除观测可信度；系统可能稍后处理已排队消息，不能保证 kill helper 就撤销它。串行和失焦处理遵守[调用契约](../06-native-protocol.md)。

## 4. 构建与验证

提供 C++ 源码、固定参数构建脚本、x64/arm64 构建方案、平台 CI，随对应 VSIX 包含正确二进制。使用隐藏窗口的异步进程调用；用户不需编译器。保留复制代码的来源、commit、许可证；本次未复制 im-select 代码。

真实测试至少覆盖系统英文键盘与微软拼音、第三方输入法、多种同语言 profile、标准/提升权限、多窗口 Stable/Insiders、其他应用前台、远程桌面和候选词未提交。按各架构记录。若需注入或模拟热键才能控制某内部模式，首版声明不支持该模式，不偷偷降级。
