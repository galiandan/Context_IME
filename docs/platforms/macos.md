# macOS · 短时原生 helper

## 1. TIS 路径

候选 API 为 `TISCreateInputSourceList`、`TISCopyCurrentKeyboardInputSource`、`TISSelectInputSource`；以实际 source ID 枚举、查询、选择，不假定 ABC、US 或某中文输入法已安装。只展示 enabled/selectable 来源，并在需要时区分输入模式 ID。

输入源标识见 [Apple keyboardInputSources](https://developer.apple.com/documentation/appkit/nstextinputcontext/keyboardinputsources)。具体函数可用性、线程与运行循环要求在 macOS SDK 和原型中确认；不能以候选 API 存在证明本项目已兼容。

当前底层键盘布局不一定是当前输入法来源，读回必须采用与用户选择一致的标识。TIS 源匹配不证明第三方输入法内部 ASCII/中文模式；该字段默认 unknown，用户明确看到能力边界。

## 2. 进程与焦点

helper 每次执行一个操作，必要时短暂运行受预算限制的 run loop，然后退出；不建立常驻 GUI/通知服务。正确释放 Core Foundation 对象，需 AppKit 前台检查时使用 Swift。

设置前确认本地前台应用与目标属于同一已验证 VS Code 实例，设置后确认源 ID。检查与选择之间仍有竞态；应用级检测无法区别同窗口内输入控件。

不默认要求辅助功能或输入监控权限，不模拟按键、不通过 AppleScript 自动化切换。若某额外能力需要权限，先缩小功能或重新设计，不把授权变成隐蔽安装前提。

## 3. 构建与分发

提供 Intel x64 和 Apple Silicon arm64 构建脚本及 CI，优先按平台 VSIX 分发对应 helper。单独说明最低 SDK/部署版本；跨编译成功与相应硬件实测分开记录。

打包验证执行权限、签名/公证策略、隔离属性及干净环境安装。没有凭据不执行签名发布，不自动移除 quarantine，不运行时下载替代二进制。因系统限制无法启动时提供诊断。

## 4. 验收

测试用户实际已启用的拉丁输入源与系统拼音、另一个语言来源及第三方输入法。记录系统按文稿记忆输入源设置，但不为通过测试擅自更改。

覆盖候选词未提交、全屏/Space、睡眠唤醒、多窗口、其他应用前台、命令面板、终端、鼠标跳出字符串。源已选中但内部模式仍为英文时报告能力受限，不循环选择源来掩盖问题。

## Swift 迁移与本机编译（2026-09-27，未发布）

源码为 `native/macos.swift`，替换旧 `macos.mm`；没有增加第三方 Swift 包。采用 Swift 5 语言模式（可使用提供此模式的 Swift 6 编译器）、macOS 11.0 部署目标，依赖系统 AppKit/Carbon/Foundation。Copy/Create 对象使用 `takeRetainedValue`，属性指针使用 `takeUnretainedValue`，不额外 CFRelease。

设置前核对应用路径/PID，源枚举限制 enabled/selectable；读回前后再次核对前台应用。立即读回符合期望时不等待，否则只执行一次最多 30ms 的 run loop。helper 返回的是 `observed`，由 TS 比较期望源决定 confirmed/unverified；不保证内部模式。应用 PID 无法区分同一进程中的多个 VS Code 窗口。

优先使用 [GitHub Actions](../github-actions.md) 自动完成以下检查和编译，本地不需要安装 Xcode/Swift。下列命令只供希望在 Mac 上手工复现的人使用。

在 Mac 上安装好 Node/npm 和 Xcode Command Line Tools 后，于项目根目录执行（工具缺失时先自行安装，不由脚本自动安装）：

```sh
xcrun --find swiftc
xcrun swiftc --version
npm ci
npm run check
# 只做 SDK 类型检查，不生成二进制，也不切换输入法
xcrun swiftc -swift-version 5 -typecheck native/macos.swift
# Apple Silicon
TARGET_ARCH=arm64 npm run native:build
npm run package -- darwin-arm64
python3 scripts/verify-vsix.py --target darwin-arm64
# Intel（也可使用同一 SDK 交叉编译；不等于 Intel 实机测试）
TARGET_ARCH=x64 npm run native:build
npm run package -- darwin-x64
python3 scripts/verify-vsix.py --target darwin-x64
```

构建输出为 `native/bin/darwin-arm64/context-ime` 或 `native/bin/darwin-x64/context-ime`；VSIX 位于 `artifacts/vsix/vscode-auto-ime-<package.json版本>-darwin-<架构>.vsix`。脚本使用 `xcrun swiftc -O -whole-module-optimization -target <架构>-apple-macosx11.0`，不需要独立 Swift package 或全局 npm 工具。

可无副作用检查枚举：`native/bin/darwin-arm64/context-ime list --app '/Applications/Visual Studio Code.app/Contents/MacOS/Electron'`。从终端执行 get/target 时，若终端在前台，helper 拒绝是预期行为；不要为绕过检查而删除焦点守卫。安装 VSIX 后使用扩展配置向导记录源，再进行经用户授权的实际切换测试。

本轮仅 Linux 上源码审查与 TS 协议测试，**未执行 Swift 编译或 SDK 类型检查**。Apple SDK 的 Swift 导入签名、签名/隔离策略及真实桌面兼容性仍须在 Mac 上确认。旧 Objective-C++ 的 CI 成功记录不适用于新 Swift 代码。
