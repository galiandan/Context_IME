# 实现核验与设计调整（2026-09-27）

本文记录本轮实际实现与设计之间的必要差异；原设计文档继续作为目标，交付/验证结果以 compatibility.md、performance-results.md 和 delivery.md 为准。

## TextMate 的实际 scope 与复现

固定资源来自 VS Code 1.95.3 commit `f1a4fb101478ce6ec82fe9627c43efbf9e98c813`，每个 grammar 自带的真正上游 commit 也写入 grammars/manifest.json。资源不从用户安装目录抽取。运行时 TextMate 9.2.0、Oniguruma 2.0.1；源码 commit、npm integrity 和 WASM SHA-256 见 resources/manifest.json。

C/C++ 的可选 includes 引用 `source.asm/arm/x86/x86_64/glsl/sql/regexp.python`。固定版本官方 cpp/package.json 没有贡献这些语言；Registry 对必需依赖一律报缺失会使整门语言不可用。已在构建资源中删除这些可选嵌入高亮 includes，保留包内 `source.cpp.embedded.macro` 真正依赖，外层 C/C++ 字符串始终按输入字符串处理。补丁脚本 scripts/vendor/patch-grammars.py；没有新增完整解析引擎。

原始 C++ `R"sql(SELECT "x" FROM t)sql"` 的内容 scope 是 `meta.string.quoted.double.raw.sql.cpp`，并非 `string.*`。分类器明确识别此固定 grammar scope。JS 的 `"` 行末插入一个中性空格，grammar 给空格 `string.quoted.double.js / invalid.illegal.newline.js`；这表示未闭合字符串到行末，不表示光标已离开字符串。只对此已复现的 JS/TS newline scope 保留 string，其余 invalid 返回 unknown。复现：`node --import tsx scripts/repro/repro.ts`；人工期望测试：tests/boundaries.test.ts。

正常 token 内容直接分类；边界使用原行入口状态，在内存中插入空格并调用同一 grammar；探测状态不传播到下一行。多字符定界符内部返回 unknown。五种语言的空串、引号两侧、插值表达式、嵌套字符串、正则、raw、注释、CRLF 和 UTF-16 用例有人工期望。

5ms tokenizeLine timeLimit 是协作预算，首次正则编译可能导致提前停止，必须丢弃该结果。语法测试允许后续显式查询重试（不改变期望，也不放宽生产预算）；性能报告包含首次 unknown。生产中不无限后台重试，只等待下一次有效交互/重新同步。

## 缓存和区域

缓存保留最早编辑之前的前缀，对同一事件旧坐标排序映射剩余行；受影响边界行重算；文本与入口 StateStack.equals 同时成立才复用。不会只因相同行文本就停止传播。处理 128 行或 4ms 让出；每次最多约 100ms。超长行和未可靠分词的行阻断后缀。暖行 token/位置结果复用，文档关闭释放。最多三个文档、估算总量 8MiB；估算并不是 JS 堆硬上限。

当前缓存达到 8MiB 后清理该文档缓存并记住当前版本的 unknown，不重复扫描；普通编辑保留有效前缀，不清空整个缓存。尚未实现设计中的“只淘汰远处 token、保留全部检查点”的更细粒度回收。因此部分低于文件大小阈值的高 token 密度文档也可能达到缓存上限；四万行基准明确包含这个降级。

字符串/注释 identity 由开分隔符锚点和嵌套 scope 路径得到；锚点按字符/行编辑逆序映射。测试覆盖内容输入、前部插行和嵌套模板返回外层。code 使用连续观测上下文去重；直接在两个 code 位置间跳转不会强制重新设源。unknown/keep 不自动补偿，显式 resync 可重置。

## 调度、焦点与平台

只处理 Keyboard/Mouse 类型的选区事件；文档编辑只更新缓存并取消旧快照，不单独授权设置。无法识别来源的程序性事件等下一次有效交互。窗口回焦和切编辑器只失效决策，不直接设置。执行前检查编辑器对象、版本、选区、焦点、启用和配置 generation。异步 backend 探测也校验配置 epoch，防止旧探测覆盖新后端。

设置串行、最多一个最新待执行项。子进程超时 SIGKILL 后等 close 才释放事务；已发出的系统消息可能已经生效，失焦后不补偿。三次失败熔断到 resync/配置修复。无周期轮询。内部 IME 模式本版不支持，配置 mode/未知字段明确拒绝。

Windows 是 KLID 布局适配，并非完整 TSF profile 适配。源 ID 是 `klid:XXXXXXXX`；前台 HWND/PID/输入线程和程序完整路径重验；HKL 到注册表 KLID 的映射不可靠/歧义则失败，不改 helper 自己的布局来冒充目标控制。设置使用有界 WM_INPUTLANGCHANGEREQUEST；跨进程与具体 TSF 组合仍待实机。macOS 使用 TIS 实际 source ID，前台应用 bundle 路径/PID 重验。Linux 用固定 `/usr/bin`、`/bin` 工具，不读取工作区 PATH，不启动服务；Fcitx5 --check 在调用前检查框架。

公开 VS Code API 不完整暴露 composition 和输入控件焦点；这些限制仍存在。Linux CLI 是 bestEffort 保护，macOS 应用级保护，Windows 有窗口身份守卫但不能识别同一窗口内的编辑区/搜索框。不能将自动测试或只读源查询当作候选词/多窗口正确性的证明。
