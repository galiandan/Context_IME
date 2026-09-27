# 性能实测（2026-09-27）

新增：已发布 0.1.4 的 [性能消耗审计与优化实验](performance-audit-0.1.4.md)，覆盖五语言冷启动、长字符串/注释、CPU profile、实际 Host 对照、空闲和内存趋势。

最新 0.1.4（系统 Node 26）结果与前后对比见 [稳定性修复记录](0.1.4-stability.md)。以下保留首次 Node 24 测量，不能混为同一环境。

环境：AMD Ryzen 7 9700X 8-Core Processor；Linux 7.2.7-zen1-1-zen x64；Node v24.20.0（VS Code Electron RUN_AS_NODE）；VS Code 1.139.1；Wayland；Fcitx5 5.1.23。没有修改系统输入法。

命令：`npm run bench`、`node scripts/bench/cold-bench.mjs`、`node --import tsx scripts/bench/idle.ts`。本次历史原始结果已归档至 docs/benchmarks/2026-09-27-node24/ 下的 benchmark.json、cold-start.json、idle.json；当前脚本的新结果写入 artifacts/reports/；这些是本机结果，不是第三方 README 数字。

| 行数 | 文档冷缓存 p50/p95 ms（30次） | 暖查询 p50/p95 ms（1000次） | 编辑+查询 p50/p95 ms（100次） | 前部多行定界符编辑 p50/p95 ms（30次） | unknown 次数 |
|---|---|---|---|---|---|
| 100 | 0.7580 / 5.6276 | 0.0005 / 0.0008 | 0.0186 / 0.0498 | 0.6135 / 1.2325 | 0 |
| 10000 | 59.0728 / 65.8768 | 0.0005 / 0.0005 | 0.3132 / 0.8016 | 60.1667 / 66.7044 | 0 |
| 40000 | 66.3412 / 72.4937 | 0.0004 / 0.0004 | 67.2226 / 79.5356 | 66.4446 / 75.1782 | 1160 |

fixture 每行 `x=1`；编辑指标包含缓存 edit 映射和 query，不仅分词时间。冷文档组共享已加载 grammar/WASM；首次 grammar 冷启动单独测量。四万行超过估算缓存预算，暖查询的快速结果是 **unknown 降级**，不是成功解析；不能和一万行成功样本混为性能优势。没有省略失败/unknown 样本。

真正全新进程冷启动（30 次，包括 WASM/grammar 加载和 100 行 query，不含 Node/tsx 启动）：p50 19.801ms，p95 21.197ms，unknown 2 次；由 5ms 行分词提前停止导致，等待下次交互重试。

| 行数 | 常规分词行数 | 已映射后缀复用行数 | 位置缓存访问 | 主动让出次数 |
|---|---|---|---|---|
| 100 | 6100 | 0 | 1160 | 3 |
| 10000 | 600100 | 0 | 1160 | 4680 |
| 40000 | 1937555 | 0 | 0 | 15085 |

本基准修改末行和起点定界符，本来不期待未变后缀复用；插删行/多处编辑及收敛的复用量由 tests/cache.test.ts、tests/context.test.ts 断言，不能从上表复用 0 推断缓存无增量性。

Fake Adapter：1001 次同区域事件只执行 1 次设置；这是控制器测试，不是真实输入法成本。
Fcitx5 只读查询 30 次：p50 1.441ms，p95 1.590ms；含探测 get=31、set=0、真实进程=32。没有真实切换延迟或边界到确认时延数据。

空闲 300.0 秒：开始 {'processes': 2, 'set': 1}，结束 {'processes': 2, 'set': 1}，调用量不变=True。测量范围为已初始化核心控制器+真实后端；不是 VS Code 全宿主 CPU/能耗测量。

反复打开/清理 100 次，每 10 次 GC 后 heapUsed（MiB）：6.73, 6.54, 6.54, 6.55, 6.55, 6.56, 6.57, 6.56, 6.58, 6.57。本次首尾差 -0.16MiB，未见持续线性增长；不能据此证明所有使用场景无泄漏。
末次整个进程 RSS 248.2MiB；external 5.4MiB，包含运行时/WASM，不能当扩展独占开销。没有单独测得 native helper 峰值 RSS、WASM 专属内存、关闭插件对照组、真实 Extension Host CPU 或电功耗。

缓存预算是估算，不是总堆 8MiB 承诺。单次同步正则不可硬抢占；超长行和 stoppedEarly 保守返回 unknown。尚未达成的实机、峰值内存和焦点/composition 验收见 compatibility.md。

0.1.5 已合入优化的同机对照见 [性能优化记录](0.1.5-performance.md)。

0.1.6 大文件 token 淘汰和冷初始化进展重试见 [完整报告](0.1.6-cache-cold.md)。
