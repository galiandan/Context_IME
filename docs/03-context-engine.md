# 03 · TextMate 上下文识别

## 1. 分词基础与资源

采用 `vscode-textmate` + `vscode-oniguruma`，以 `tokenizeLine` 的 scopes 和行状态为依据。grammar 与 WASM 随扩展分发，运行时不联网；只加载当前语言及其递归依赖。实现时固定 npm 精确版本、lockfile、grammar commit 和许可证，不能从用户 VS Code 安装目录抽取未知版本语法。

Registry 使用明确 scope → 包内文件映射；外部 include、注入依赖缺失时该语言不就绪，返回 unknown。不能吞掉加载失败后假装所有文本是 code。完整来源与 pinning 要求见[资料](10-references.md)。

TextMate 的 token 不是 AST，也不自动完成插入位置判定。语言规则层只解释固定 grammar 的 scope、定界符与插值结构，不再实现另一套完整扫描器。

## 2. 语言规则契约

| 语言 | 必须覆盖 | 特殊分类 |
| --- | --- | --- |
| Python | 单双引号、三引号、raw 前缀、f-string | 文本为 string，插值表达式为 code，表达式内嵌字符串仍为 string |
| JavaScript | 普通字符串、模板、插值、正则、注释 | 正则内容按 code，不能被其中引号改成 string |
| TypeScript | 同 JS，加 TS grammar 特有嵌套 | JSX/TSX 未验证前不登记对应 languageId |
| C | 双引号字符串、字符字面量、注释、续行 | 字符字面量按 code |
| C++ | C 相关结构、raw string、自定义 raw delimiter | raw 内容为 string，完整闭合后恢复外层 |

Python 三引号即便用于文档说明仍是 string。中文弯引号不是以上语言的合法字符串定界符。每种语言规则与固定 grammar 版本配套测试；scope 名不能凭经验猜测或写一个全语言 `includes("string")`。

## 3. 嵌套作用域分类

按由外到内的 scopes 建立有效上下文，内层有语义的作用域覆盖外层。例如模板外层 string → 插值 meta/code → 内层 quoted string，最终为 string；只有外层 string → 插值 code 时最终为 code。

语言规则明确哪些 scopes 表示字符串内容、字符字面量、正则、注释、插值边界、invalid 和无语义容器。注释内的引号是文本，不启动另一上下文。没有可靠映射的特殊/非法作用域返回 unknown，不把缺少 string 当成 code 的充分证据。

分类结果含 `kind`、稳定 region identity、依据规则 ID、reason。code 只在 grammar 就绪、上文状态可靠且语言规则明确时返回。region identity 的维护见[调度](02-architecture.md)与[缓存](11-incremental-cache.md)。

## 4. 插入位置算法

查询光标行的可靠完整 tokens、行首状态、左右相邻 token 和定界符范围；顺序为：识别边界 → 计算插入所处的内外层 → 应用语言规则。不能单独查询“左侧字符 token”或“右侧字符 token”。

- 在开引号前使用外层；在完整开引号后使用字符串内容。
- 在闭引号前使用字符串内容；在完整闭引号后使用外层，即使 token 本身带 string scope。
- 空字符串的开闭引号之间属于 string。
- 转义引号不构成结束边界，依赖 grammar 的 escape scope 与语言规则。
- 插值开始符完整结束后属于表达式；插值闭合符之前仍在表达式，完整结束后返回模板文本。定界符内部歧义时 unknown。
- EOL/空行必须结合可信行首状态和当前行分词，不能把“没有实际字符”当作 code。

对未闭合字符串行末等 token 边界不足以区分的场景，可使用**同一 grammar**、同一行首状态进行局部插入探测：只在内存中的当前行光标处插入语言规则选择的中性字符，重新分词并检查探测点 scopes。不修改文档、不缓存探测行的行尾状态、不把它传播到后续行。该路径也受超时和长度限制，测试若发现探测改变语法语义则返回 unknown；不能用探测替代所有边界规则。

## 5. 可靠性与降级

`stoppedEarly`、上文状态未就绪、grammar 依赖缺失、超长行、超预算、语言未登记、边界冲突、不可恢复的 malformed 结构都返回 unknown。提前停止产生的 ruleStack 不用于后续行。

分词器 timeLimit 不能被宣传成可抢占任意一次同步正则执行的硬时限。首次采用长度门槛、已审查 grammar 和耗时监控，详见[预算](07-performance.md)。

## 6. 测试基准

至少涵盖需求文档全部光标示例，以及 f-string/模板文本与表达式间的每一个边界、嵌套字符串、正则内引号、C/C++ 字符字面量、raw delimiter、跨行空行、注释内引号、CRLF、中文、emoji、UTF-16 偏移。

每个 fixture 固定语言与 grammar 版本，保留期望 kind、边界两侧位置、必要的 scopes 摘要。缓存与全量基线结果要一致；基线也必须有人工编写的期望样例，不能只用同一错误分类器自证正确。

## 0.1.3 头文件 token 修正

固定 C/C++ grammar 的 `string.quoted.other.lt-gt.include.c/cpp` 与 `string.quoted.double.include.c/cpp` 表示头文件路径，不是文本字符串，均按 code 分类；包括只输入开分隔符和未闭合路径。规则只针对这两类具体 scope，不将整条预处理指令、宏字符串或注释一律视为 code。复现：scripts/repro/include-repro.ts；回归：tests/include.test.ts。
