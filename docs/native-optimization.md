# Windows/macOS 优化记录（2026-09-27，未发布）

> 后续验证更新：0.1.7 的五平台 CI 已全部成功，VSIX 已下载校验并发布 Marketplace。Swift/Win32 本轮均已在对应 Runner 编译；真实桌面输入法仍未验证。[完整记录](https://github.com/galiandan/Context_IME/blob/main/docs/0.1.7-release.md)。下文“未编译/未推送”等表述属于最初交付时的历史状态。


本次保留已有 0.1.6 工作和版本号，未发布、未修改系统输入法、未触发远程 CI。macOS 替换为 Swift helper；Windows 保持 C++。具体编译命令见 [macOS](platforms/macos.md#swift-迁移与本机编译2026-09-27未发布) 和 [Windows](platforms/windows.md)。

## 改动与工作量

原生设置流程由 get → target → set（自带读回）→ get，改为 get → target → set（使用其读回）。正常需要切换时进程数 4→3，减少 25%；已在目标源时仍为一次 get，同区域与空闲不新增调用。不是 CPU/延迟提升 25% 的实测承诺。Linux 调用顺序不变。

JSON 版本、observed 状态、源 ID 和目标 token 严格验证；failed/accepted 即使带有匹配 ID 也不能算确认。过期、焦点改变、实际源不匹配继续拒绝/返回 unverified。原生调用开始即清除旧观测，失败时不保留旧结果冒充当前状态。

macOS 按 Swift ARC/CF ownership 管理对象，过滤 enabled/selectable，拒绝异常参数，枚举最多 512 项、输出低于 64KiB、ID 最多 1024 UTF-8 字节。立即读回成功省去原来固定 30ms 等待；不匹配时一次有界 run loop。Swift 并不替换 TIS 系统 API，也不能保证新语言的启动更快。

Windows 使用真实焦点线程查询与发送，收紧枚举/注册表缓冲区边界，移除非枚举操作的不必要枚举。仍仅支持可解析 KLID，不支持 TSF profile/IME conversion。

## 验证与边界

当前 Linux x64/Node 26.10.0，未发现 swift/swiftc、clang++ 或 MinGW，未安装系统工具。`npm run check` 通过：lint、strict TypeScript、166 项测试。新增协议测试覆盖两平台三次调用、特殊字符参数、失败/未知状态、非法目标、失效任务与不匹配读回。`npm run build`、`npm run test:integration` 和 `git diff --check` 也通过；隔离 VS Code 集成不配置真实输入方案。FakeRunner 测试不执行 Win32/TIS，也不是原生源码的编译验证。

| 平台 | 实现 | 本轮编译 | 本轮自动测试 | 真实桌面 |
|---|---|---|---|---|
| Windows x64/arm64 | C++ 优化已写入 | 未执行 | TS 协议通过；MSVC /analyze 待运行 | 未进行真实环境验证 |
| macOS x64/arm64 | Swift 替换完成 | 按用户要求未执行；SDK 类型检查也未执行 | TS 协议通过；Swift 待 Mac 验证 | 未进行真实环境验证 |

静态审查未发现其余明确错误，但不能承诺无 SDK 类型错误或桌面竞态。CI 仍保留两平台构建；本轮没有 push/触发 CI，因此没有新原生构建证据。发布版 0.1.6 VSIX 未覆盖，当前目录 TS 构建与发布版不同。

## 官方资料核验

- [GetKeyboardLayoutList](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getkeyboardlayoutlist)：返回实际复制数量。
- [GetGUIThreadInfo](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getguithreadinfo)：可以查询其他线程；窗口失去激活时句柄可能无效，需重验。
- [WM_INPUTLANGCHANGEREQUEST](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-inputlangchangerequest)：应用可拒绝，不能从消息返回值推断成功。
- [Apple 输入源标识](https://developer.apple.com/documentation/appkit/nstextinputcontext/keyboardinputsources)：TIS source ID 与语言标签不同。
- Apple 的具体 TIS 函数页面本轮抓取失败，本机无 SDK；Swift 导入类型与部署兼容性保留为 Mac 编译检查项，不借其他项目 README 宣称已验证。没有复制第三方 Swift 源码或增加依赖。
