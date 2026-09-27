# 0.1.4 性能消耗审计（2026-09-27）

测试对象是已发布的 0.1.4 运行代码。本次仅增加基准脚本与报告；`src/`、`dist/` 运行逻辑没有修改，没有发布新版本。两个优化实验通过构建插件临时改写输入，产物仅存在 `artifacts/tmp/perf-prototype/`，不进入扩展包。

## 环境与方法

- Linux 7.2.7-zen1-1-zen x64，AMD Ryzen 7 9700X，系统 Node 26.10.0；VS Code 1.139.1 的独立 Extension Host 为 Node 24.20.0（见 host.json）。CPU governor 为 powersave、EPP 为 balance_performance，未修改系统配置。
- 无新增依赖；工具均为项目级 TypeScript/esbuild 与 Node 内置 CPU profiler。核心延迟每项 1000 次，前部编辑 100 次；每次交互让出一次事件循环。冷启动为每语言 30 个独立进程。
- 合成文件，不读取用户代码；真实 Fcitx5 仅探测/查询，真实 set=0。没有测真实输入源切换耗时、电功耗、Windows/macOS 桌面。
- 延迟单位 ms；CPU 为进程 user+system CPU 时间；内存快照在计时间隔外执行 GC。RSS 包含 Node/tsx/WASM/测试数据，不能当扩展独占内存。冷启动不含 Node/tsx 启动及 GC 快照。

## 1. 暖查询与编辑

| 场景 | 样本 | p50 ms | p95 ms | 最大 ms | CPU 合计 ms | unknown |
|---|---:|---:|---:|---:|---:|---:|
| python-100-lines-move | 1000 | 0.0017 | 0.0282 | 0.3397 | 26.6 | 0 |
| javascript-100-lines-move | 1000 | 0.0053 | 0.0543 | 0.1511 | 31.8 | 32 |
| typescript-100-lines-move | 1000 | 0.0034 | 0.0589 | 0.1638 | 42.5 | 30 |
| c-100-lines-move | 1000 | 0.0030 | 0.0284 | 0.1715 | 20.3 | 0 |
| cpp-100-lines-move | 1000 | 0.0030 | 0.1652 | 0.4044 | 76.2 | 180 |
| python-simple-10k-type | 1000 | 0.2655 | 0.7236 | 0.9164 | 304.5 | 0 |
| python-code-10k-move | 1000 | 0.0100 | 0.0111 | 0.0897 | 17.4 | 226 |
| python-multiline-10k-move | 1000 | 0.9609 | 1.8256 | 3.6397 | 1033.1 | 0 |
| python-code-10k-type | 1000 | 0.0124 | 0.0131 | 0.1716 | 17.9 | 1000 |
| python-multiline-10k-type | 1000 | 1.8907 | 1.9912 | 2.1609 | 1935.7 | 0 |
| python-code-10k-head-edit | 100 | 0.7559 | 0.9993 | 2.2437 | 110.1 | 100 |
| python-multiline-10k-head-edit | 100 | 2.3880 | 2.4598 | 2.5388 | 254.5 | 0 |
| cpp-comment-10k-move | 1000 | 0.7122 | 1.3348 | 1.4642 | 725.5 | 0 |
| js-template-10k-move | 1000 | 1.0596 | 1.9854 | 2.2161 | 1076.9 | 0 |
| python-code-40k-move | 1000 | 0.0118 | 0.0128 | 0.1462 | 17.6 | 805 |

普通代码输入的 fixture 会持续追加空格，行会增长到约 1000 字符；不是先前 `x=${i}` 固定短行基准，所以不能把不同负载的数值当版本回退。

JS/TS 模板和 C++ raw string 小文件中的 unknown 都位于刻意覆盖的多字符定界符内部（ambiguous-boundary），不是超时。`value = 123456` 的一万行文件因 token 较多已触及 8MiB 估算缓存上限；这些末尾查询快速返回 unknown，不是成功分类的性能优势。简单 `x=1` 一万行与多行文本一万行仍可完整缓存。

长多行字符串/注释的区域定位会反复向前扫描 token 并计算 scope，导致查询耗时随距起点的行数增长。生产 5ms tokenize timeLimit 不包含这段区域查找，不能将其视为整个 query 的硬时间上限。

## 2. 首次冷启动

| 语言 | 样本 | 首次 p50 ms | 首次 p95 ms | 首次 unknown | 后续结果 |
|---|---:|---:|---:|---:|---|
| python | 30 | 38.14 | 40.29 | 0 | 首次均得到 code |
| javascript | 30 | 48.78 | 50.64 | 30 | 全部需下一次查询后得到 code |
| typescript | 30 | 49.27 | 50.14 | 30 | 全部需下一次查询后得到 code |
| c | 30 | 41.61 | 44.13 | 0 | 首次均得到 code |
| cpp | 30 | 69.56 | 73.52 | 30 | 全部需下一次查询后得到 code |

三种语言的首次 unknown 均为 tokenizer-timeout；跟进查询不是生产中的自动无限重试，而是基准显式模拟下一次用户交互。每个样本的后续延迟在 cold.json 中；均在下一次查询恢复。现有 0.1.4 的一次有限重试对 Python 有帮助，但不能据此认为其他语言首次交互也一定可用。同步 regex 懒编译可以超过传入的 5ms 协作式预算。

## 3. 空闲与内存

- 核心 + 只读真实后端初始化后空闲 300.1 秒：CPU 合计 148.84ms，折合单核平均 **0.0496%**。进程调用数 2→2，get 1→1，set 0→0。低 CPU 不等于严格零 CPU或已测省电。
- 核心测试进程初始 heapUsed 7.41MiB；加载五语言 grammar（尚未编译所有 regex）后 12.75MiB，增量约 5.34MiB。external 从 3.79MiB 到 6.79MiB；其中包含 WASM 和其他外部内存，不是 WASM 独占值。
- 全部场景预热后，反复打开/清理 100 个千行缓存，每 10 次 GC 后 heapUsed 为 18.68, 18.57, 18.58, 18.63, 18.65, 18.62, 18.66, 18.62, 18.65, 18.64 MiB；缓存 bytes 均归零，未见持续线性增长。不能由此证明不存在任何泄漏。
- 整个压力测试进程 peak RSS 251.6MiB，包含运行时、grammar、WASM、临时字符串和测量脚本。**不是扩展占用 252MiB 的结论。**

独立 VS Code 用户目录执行 off/on/on/off 对照（停用的是规则，扩展仍已激活），每组 10 秒空闲、100 次实际 type 命令。第二次完整测量四组都满足聚焦且实际插入 100 字符；100 次 type 包含 VS Code IPC、编辑和内置扩展，不是纯分类时间。

- 启用两组 type p95 为 7.11 / 6.93ms，停用为 8.00 / 5.78ms，未见可重复的整体打字劣化；样本与噪声不足以宣称精确零开销。
- 共享 Host 的启用空闲 CPU 为 0.0015% / 0.8930%，停用为 0.0257% / 0.0020%；有明显波动，不能将峰值差额归因给本扩展。各阶段后端进程数未增长，set=0，文档关闭缓存数归零。
- 第一轮有失焦/实际未打字的场景，host-first.json 仅保留原始证据，不参与有效对照结论。后续脚本加入焦点和实际插入量校验。

## 4. 降低开销的隔离实验

CPU 采样约 8.06 秒，其中 scopePath 自身约 19.1%、scopeKind 自身约 13.8%；二者合计约 32.9%。这是当前长文本压力场景采样，不代表所有用户日常负载。

比较基线与两个实验时，三者均经同样 esbuild 打包、同样 Node 参数执行。原始结果在同目录 prototype-*.json；完整 CPU profile 位于 artifacts/reports/perf-0.1.4/core.cpuprofile（未加入源代码仓库），可在 VS Code 打开分析。

| 长文本场景 | 基线 p95 ms | WeakMap 记忆结果 p95 ms | 先过滤起始定界符 p95 ms |
|---|---:|---:|---:|
| python-multiline-10k-move | 1.725 | 0.602 | 0.369 |
| python-multiline-10k-type | 1.941 | 0.645 | 0.446 |
| python-multiline-10k-head-edit | 2.717 | 1.616 | 1.622 |
| cpp-comment-10k-move | 1.602 | 0.599 | 0.362 |
| js-template-10k-move | 2.332 | 0.683 | 0.434 |

**优先采用“先过滤起始定界符”**：原代码先计算每个 token 的 kind/path，之后才判断它是否可能是区域起点。实验调整检查顺序，先跳过不含起始标记的 token；不增加解析引擎、持久缓存、轮询或系统调用。所有原有判定仍执行，146 项回归测试通过。

- Python 多行字符串末尾输入 1000 次：CPU 从 1856.5ms 降到 441.9ms，约减少 76%；p95 从 1.941ms 到 0.446ms。
- 调换顺序复测（优化→基线）仍得到 p95 0.441ms 对 1.871ms，CPU 457.3ms 对 1820.0ms。说明优势不只是首轮运行顺序造成。
- 对应阶段堆占用差异约 -0.04MiB（测量噪声范围），没有引入额外持久索引；仍为线性扫描，不能说解决了所有大文件问题。
- WeakMap 实验也通过 146 项测试，但比基线多占约 1–2MiB 堆，速度还不如简单调整检查顺序，所以不优先采用。

后续优先级：

1. 将已验证的检查顺序优化单独合入下一补丁版，保留本次基准作为回归依据；本次实验未写回生产代码。
2. 缓存内存：先考虑按需创建位置结果 Map，再设计远处 token 淘汰/可信状态检查点；必须重新测量实际堆、记账与跨编辑状态收敛，不能只增大 8MiB 限制。
3. 冷启动：区分 grammar 初始化与交互查询，研究有限预热或 worker 隔离。前者可能只是把开销提前，后者可能增加内存；不得以提高超时或预加载全部语言冒充降低 CPU。
4. 暂不更换 Linux 调用后端：空闲无轮询、同区域不重复 set，当前热点在纯 TS 区域定位，先优化它收益更明确。

## 5. 复现命令

请串行运行 CPU 压力测试，避免互相争用资源。VS Code 宿主对照会打开独立测试窗口；失焦样本不得用于启用/停用耗时比较。

```sh
npm run bench:resources
npm run bench:resources:cold
npm run bench:resources:idle   # 5 分钟；只读系统输入源
npm run bench:host
npm run bench:profile
node scripts/bench/prototype.mjs
node scripts/bench/prototype.mjs --memo
node scripts/bench/prototype.mjs --opening-first
node --test artifacts/tmp/perf-prototype/tests-opening-first/*.cjs
AUTO_IME_PERF_DIR=artifacts/reports/perf-0.1.4/prototype-baseline node --expose-gc artifacts/tmp/perf-prototype/baseline.cjs
AUTO_IME_PERF_DIR=artifacts/reports/perf-0.1.4/prototype-opening-first node --expose-gc artifacts/tmp/perf-prototype/opening-first.cjs
npm run check
```

本次 lint、strict typecheck、生产测试及两种隔离实验各 146 项测试通过。没有安装新工具、设置系统输入法、更新已安装扩展或发布 Marketplace。

后续说明：0.1.5 已合入起始定界符优先检查与按需分类 Map，见 [实测记录](0.1.5-performance.md)。本报告保留原始实验结论；当前 benchmark 默认输出 perf-current，历史隔离实验脚本从 Git 的 040d28e 读取 context 模块和对应测试，需保留该提交历史。
