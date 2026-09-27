# macOS · 短时原生 helper

## 1. TIS 路径

候选 API 为 `TISCreateInputSourceList`、`TISCopyCurrentKeyboardInputSource`、`TISSelectInputSource`；以实际 source ID 枚举、查询、选择，不假定 ABC、US 或某中文输入法已安装。只展示 enabled/selectable 来源，并在需要时区分输入模式 ID。

输入源标识见 [Apple keyboardInputSources](https://developer.apple.com/documentation/appkit/nstextinputcontext/keyboardinputsources)。具体函数可用性、线程与运行循环要求在 macOS SDK 和原型中确认；不能以候选 API 存在证明本项目已兼容。

当前底层键盘布局不一定是当前输入法来源，读回必须采用与用户选择一致的标识。TIS 源匹配不证明第三方输入法内部 ASCII/中文模式；该字段默认 unknown，用户明确看到能力边界。

## 2. 进程与焦点

helper 每次执行一个操作，必要时短暂运行受预算限制的 run loop，然后退出；不建立常驻 GUI/通知服务。正确释放 Core Foundation 对象，需 AppKit 前台检查时使用 Objective-C++。

设置前确认本地前台应用与目标属于同一已验证 VS Code 实例，设置后确认源 ID。检查与选择之间仍有竞态；应用级检测无法区别同窗口内输入控件。

不默认要求辅助功能或输入监控权限，不模拟按键、不通过 AppleScript 自动化切换。若某额外能力需要权限，先缩小功能或重新设计，不把授权变成隐蔽安装前提。

## 3. 构建与分发

提供 Intel x64 和 Apple Silicon arm64 构建脚本及 CI，优先按平台 VSIX 分发对应 helper。单独说明最低 SDK/部署版本；跨编译成功与相应硬件实测分开记录。

打包验证执行权限、签名/公证策略、隔离属性及干净环境安装。没有凭据不执行签名发布，不自动移除 quarantine，不运行时下载替代二进制。因系统限制无法启动时提供诊断。

## 4. 验收

测试用户实际已启用的拉丁输入源与系统拼音、另一个语言来源及第三方输入法。记录系统按文稿记忆输入源设置，但不为通过测试擅自更改。

覆盖候选词未提交、全屏/Space、睡眠唤醒、多窗口、其他应用前台、命令面板、终端、鼠标跳出字符串。源已选中但内部模式仍为英文时报告能力受限，不循环选择源来掩盖问题。
