# 架构摘要与方案取舍

这是两版设计合并后的当前基准。旧文档中“自写完整词法扫描器、会话内常驻助手、Linux 首版直连 D-Bus/libibus、注释默认自然语言、自定义中文引号区域”等选择已被本次统一改写替代，不是并行维护的第二套方案。

## 1. 取舍依据

| 主题 | 最终选择 | 采用理由 |
| --- | --- | --- |
| 分词 | TextMate + Oniguruma，语言专用边界分类器 | 复用成熟 grammar，降低复杂字符串与插值维护成本 |
| 增量性 | 本项目维护行级状态、编辑映射与收敛 | 分词库不替应用自动维护文档缓存，必须自行证明复用正确 |
| 平台进程 | 事件触发短 helper，无独立常驻进程 | 先降低常驻成本，测量启动开销后再决定是否优化 |
| Linux 接口 | 首版异步 execFile 调框架自带工具 | 减少打包与原生依赖，保持实际可运行的完整功能链路 |
| 上下文策略 | code / string / comment / unknown → code / text / keep | 把识别事实与用户输入方案分开 |
| 注释 | 默认 code，可配 text 或 keep | 按最新需求保留可配置性 |
| 不确定性 | unknown 时保持，不猜英文 | 保留原设计对系统副作用的保守策略 |
| 验证 | 实现、编译、自动测试、实机验证分别记录 | 防止用 Mock 或平台空接口冒充兼容 |
| 文档 | 主题拆分、单一规范来源 | 保留易维护的原文档组织方式 |

首版不引入 Tree-sitter 或第二套完整解析引擎，也不自行复制 VS Code 的整个高亮系统。若 TextMate 存在关键缺陷，先提交最小复现、scope 输出和测试，再评估局部 grammar 修补或替代方案。

## 2. 为什么选择 TextMate

`vscode-textmate` 提供按行分词、行尾状态、嵌套 scopes 和提前停止标记；本项目在其外实现缓存及插入位置分类。需要完整 scopes，所以首先使用 `tokenizeLine`，不能只看二进制 token 的 string 位。官方接口见 [TextMate 源码](https://raw.githubusercontent.com/microsoft/vscode-textmate/main/src/main.ts)。

选择它是为了控制实现复杂度，不代表零启动成本、自动增量或编译器级语法正确。WASM、grammar 依赖和行状态均计入性能预算。稳定扩展 API 不能被假定提供编辑器内部完整 token 缓存，本项目独立加载固定资源。

## 3. 输入源与内部模式

用户输入方案包含一个具体 source ID，以及可选的、后端明确支持的模式要求。选择中文输入法不等于打开其中文 conversion 模式；框架 active 状态也不等于内部中文模式。默认只配置源，内部模式未知就显示能力受限。

| 后端 | 可查询/设置的设计路径 | 验证边界 |
| --- | --- | --- |
| Windows | 目标输入线程布局；可行时补 TSF profile、IME open/conversion | 布局不能代表全部 TSF profile；跨进程内部模式可能不可读写 |
| macOS | TIS 输入源 ID 的枚举、读取、选择 | 源匹配不保证输入法内部英文/中文模式 |
| Fcitx5 | `-n` 查询源、`-s` 选择源；active 单独处理 | `-o` 只是激活，不能证明内部中文模式 |
| IBus | `engine` 查询/设置引擎，`list-engine` 枚举 | 引擎名称匹配不保证 engine 私有模式 |

这里描述实现路线，不代表本项目已经在对应系统验证通过。

## 4. 焦点、组合态与远程

窗口焦点、活动编辑器和编辑事件是可用的门控信息，但不能据此断言搜索框/终端没有焦点，或 IME 候选词已提交。防抖不是 composition 检测。禁止私有命令、编辑器注入、全局键盘钩子和劫持所有按键。

使用 `extensionKind: ["ui"]`，将系统操作留在本地桌面。远程 URI 通过文档 API 读取，不映射成本地文件路径。纯浏览器版不提供该功能。[Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host)

## 5. 参考与来源管理

参考 `im-select` 的平台 API 使用方式，但不照搬语言数字作为唯一源 ID；参考 CI124.auto-ime 和 SmartCursor 的交互与问题边界，不采纳其 README 的性能宣传作为实测结论。市场页面不等于完整源码审计或发布包一致性证明。

当前实现已创建 grammars/manifest.json、resources/manifest.json、锁文件和第三方许可证清单；scope 调整见 implementation-notes.md。已查阅与未核实项见[资料与核验](10-references.md)。
