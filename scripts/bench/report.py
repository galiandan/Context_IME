import json,pathlib
root=pathlib.Path(__file__).resolve().parents[2]
b=json.loads((root/'artifacts/reports/benchmark.json').read_text());cold=json.loads((root/'artifacts/reports/cold-start.json').read_text());idle=json.loads((root/'artifacts/reports/idle.json').read_text()) if (root/'artifacts/reports/idle.json').exists() else None
lines=[f"# 性能实测（{b['environment']['date'][:10]}）",'',f"环境：{b['environment']['cpu']}；{b['environment']['platform']} {b['environment']['release']}；Node {b['environment']['node']}。纯 Node 核心基准；VS Code、桌面会话和输入法工具版本未由本次脚本采集。没有修改系统输入法。",'', ('命令：`npm run bench`、`npm run bench:cold`' + ('、`npm run bench:idle`' if idle else '（本次未重跑五分钟空闲测试）') + '。原始结果位于 artifacts/reports/benchmark.json、cold-start.json' + ('、idle.json' if idle else '') + '；这些是本机结果，不是第三方 README 数字。'),'','| 行数 | 文档冷缓存 p50/p95 ms（30次） | 暖查询 p50/p95 ms（1000次） | 编辑+查询 p50/p95 ms（100次） | 前部多行定界符编辑 p50/p95 ms（30次） | unknown 次数 |','|---|---|---|---|---|---|']
for s in b['scenarios']:
 cells=[str(s['lines'])]
 for k in ['cold','warm','input','delimiter']:cells.append(f"{s[k]['p50']:.4f} / {s[k]['p95']:.4f}")
 cells.append(str(s['unknown']));lines.append('| '+' | '.join(cells)+' |')
lines+=['','fixture 每行 `x=1`；编辑指标包含缓存 edit 映射和 query，不仅分词时间。冷文档组共享已加载 grammar/WASM；首次 grammar 冷启动单独测量。四万行超过估算缓存预算，暖查询的快速结果是 **unknown 降级**，不是成功解析；不能和一万行成功样本混为性能优势。没有省略失败/unknown 样本。','',f"真正全新进程冷启动（30 次，包括 WASM/grammar 加载和 100 行 query，不含 Node/tsx 启动）：p50 {cold['p50']:.3f}ms，p95 {cold['p95']:.3f}ms，unknown {cold['unknown']} 次；由 5ms 行分词提前停止导致，等待下次交互重试。",'', '| 行数 | 常规分词行数 | 已映射后缀复用行数 | 位置缓存访问 | 主动让出次数 |','|---|---|---|---|---|']
for s in b['scenarios']:
 st=s['stats'];lines.append(f"| {s['lines']} | {st['tokenized']} | {st['reused']} | {st['hits']} | {st['yields']} |")
lines+=['','本基准修改末行和起点定界符，本来不期待未变后缀复用；插删行/多处编辑及收敛的复用量由 tests/cache.test.ts、tests/context.test.ts 断言，不能从上表复用 0 推断缓存无增量性。', '',f"Fake Adapter：{b['fake']['events']} 次同区域事件只执行 {b['fake']['set']} 次设置；这是控制器测试，不是真实输入法成本。"]
a=b['backend']
if 'latency' in a:lines += [f"Fcitx5 只读查询 30 次：p50 {a['latency']['p50']:.3f}ms，p95 {a['latency']['p95']:.3f}ms；含探测 get={a['get']}、set={a['set']}、真实进程={a['realProcesses']}。没有真实切换延迟或边界到确认时延数据。"]
if idle:lines+=['',f"空闲 {idle['durationMs']/1000:.1f} 秒：开始 {idle['before']}，结束 {idle['after']}，调用量不变={idle['passed']}。测量范围为已初始化核心控制器+真实后端；不是 VS Code 全宿主 CPU/能耗测量。"]
heaps=b['memory']['gcHeapEvery10Closes'];lines+=['',f"反复打开/清理 100 次，每 10 次 GC 后 heapUsed（MiB）：{', '.join(f'{v/1048576:.2f}' for v in heaps)}。本次首尾差 {(heaps[-1]-heaps[0])/1048576:.2f}MiB，未见持续线性增长；不能据此证明所有使用场景无泄漏。",f"末次整个进程 RSS {b['memory']['process']['rss']/1048576:.1f}MiB；external {b['memory']['process']['external']/1048576:.1f}MiB，包含运行时/WASM，不能当扩展独占开销。没有单独测得 native helper 峰值 RSS、WASM 专属内存、关闭插件对照组、真实 Extension Host CPU 或电功耗。",'', '缓存预算是估算，不是总堆 8MiB 承诺。单次同步正则不可硬抢占；超长行和 stoppedEarly 保守返回 unknown。尚未达成的实机、峰值内存和焦点/composition 验收见 compatibility.md。']
(root/'artifacts/reports/performance.md').write_text('\n'.join(lines)+'\n')
print('Performance report generated')
