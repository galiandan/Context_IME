# 02 · 架构与事件调度

## 1. 工程构成

TypeScript strict、稳定 VS Code API、npm 锁文件、简单打包工具（优先 esbuild）。TextMate + Oniguruma 按需加载。Windows/macOS helper 采用小型 C++/Objective-C++ 原生程序；Linux 首版直接调用已有框架工具。不使用前端框架、Webview、数据库、语言服务器或独立常驻 daemon。

建议目录如下，允许按实现规模合并小模块，不为目录完整制造占位抽象：

```text
src/
  extension.ts
  core/       controller.ts policy.ts scheduler.ts types.ts
  context/    tokenizer.ts documentCache.ts classifier.ts languageRules.ts
  platform/   adapter.ts processRunner.ts windows.ts macos.ts fcitx5.ts ibus.ts
  ui/         statusBar.ts setup.ts diagnostics.ts
grammars/    固定 grammar、依赖 grammar 与来源清单
native/      Windows/macOS helper 源码
tests/       单元、集成、协议、性能 fixtures
scripts/     构建、资源校验、分平台打包
docs/        本设计及后续实测报告
```

```mermaid
flowchart LR
  E[编辑器事件] --> G[门控与事件合并]
  G --> T[TextMate 行缓存]
  T --> C[插入位置分类]
  C --> P[策略与区域身份]
  P --> S[串行调度]
  S --> A[平台 Adapter]
  A --> H[短时 helper 或框架工具]
```

## 2. 生命周期与事件门控

计划 `onStartupFinished` 只注册轻量监听、命令和状态栏；首次有效语言交互再加载 WASM/grammar，首次需要探测再调用系统工具。配置 `extensionKind: ["ui"]`，不提供 browser 入口。

监听选区、活动编辑器、文本文档、窗口焦点、配置、文档关闭。文档事件只更新对应缓存，不单独授权后台切换；正常键入由同轮编辑器选区/交互事件驱动。对于程序性事件或来源不明确的事件，宁可等下一次有效交互或 resync。

首次激活、活动编辑器变化、窗口重新聚焦均使控制决策与实际状态缓存失效，**不无条件丢弃词法缓存**，也不直接发出 set。窗口失焦停止后续分析批次、清队列；禁用/销毁释放监听、缓存、WASM/registry 可释放资源及子进程句柄。无周期 timer。

## 3. 快照与状态

快照含 editor identity、URI、languageId、document version、selection、focusEpoch、configEpoch、generation。异步加载、分批分词、读回结果都须校验快照仍有效。过期分析不能生成意图。

控制状态为 disabled、unconfigured、ready、analyzing、pending、switching、paused、error。分别保存 desiredPlan（本次期望）、lastRequest（最近实际发送）、observedState（最近真实读取及时间、验证范围）；不把 lastRequest 当作 observedState。

相同上下文区域与相同策略不重新设源，也不每次移动查询系统。已有可信缓存优先走分类快路径；新边界可立即创建意图，实际执行受 `switchDelayMs` 合并和串行约束。一次编辑引发的重复事件只保留最终快照。

## 4. 区域身份与手动接管

字符串/注释区域以入口锚点、语言规则和嵌套路径建立稳定身份。锚点随编辑映射移动；区域内部插字、之前插行、版本变化不创建新身份。定界符被删除、两个区域合并/拆分时旧身份失效。

code 区域按可靠边界分段；同一连续代码区内移动不产生新身份。直接跳到另一个独立字符串是新区域，即便同为 string；若 identity 无法可靠恢复，返回 unknown/keep，不能仅因文档版本改变反复 set。

去重键是稳定区域身份 + 有效策略 + 方案版本。外部手动改变不会自动撤销该键；同区域保持用户意图。resync 明确使其失效。在 keep 或 unknown 期间不进行补偿；回到可信区域只在可确认新边界或显式 resync 时重新应用，避免超时后反复夺回用户设置。

## 5. 串行请求与取消

每个扩展宿主最多一个执行中的设置事务（读取/设置/确认），待执行队列最多一个最新目标。新意图替换尚未执行项；运行中的系统操作不能假装已取消。

每个事务执行前重新检查快照、焦点、单光标、配置、当前目标。平台调用返回后先完成该子进程生命周期，再允许下一个事务执行。旧回包不能覆盖当前 UI 或决策；若旧操作已生效且最新目标不同，只在仍有有效交互与焦点时执行最新目标。

例：string A → code B → string C，A 执行中，B 被 C 替换。A 完成后重验 C；必要时查询并设置 C。不能同时启动 B/C 让旧进程最后覆盖新设置。相同目标也必须处理 A 的失败/未知状态，不能以历史请求猜测成功。

失焦、文档切换、禁用、进入配置向导均递增 generation，清待执行项，取消分析。已启动进程可请求终止，但 OS 已接受的切换可能仍生效；此时不对其他应用补偿。超时与进程退出规则见[调用契约](06-native-protocol.md)。

## 6. 焦点与 composition 限制

`activeTextEditor` 非空不证明焦点在文本区。公开 API 不能提供全面的输入控件焦点与 IME composition 观测。因此门控结合窗口焦点、有效编辑交互、排除语言/编辑器类型、执行前原生前台校验；仍不能宣称消除所有竞态。

不覆盖 type 命令，不增加全局键盘监听，不查询私有 Monaco token。只在必要边界切换降低候选词干扰；防抖不代表已经检测到候选词提交。真实拼音/假名候选、鼠标跳转、命令面板和终端必须手工验证。

多窗口各有调度器，原生端尽可能绑定正确本地前台窗口。扩展宿主 PID 不是 UI 输入线程 PID；应用级守卫不能冒充窗口级守卫。无法保证的组合标为实验性或仅手动操作。
