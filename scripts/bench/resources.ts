import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, release } from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { Tokenizer } from "../../src/context/tokenizer";
import { DocumentCache, type DocumentView } from "../../src/context/cache";
import { createAdapter } from "../../src/platform/adapter";
import { ProcessRunner } from "../../src/platform/process";

const out = process.env.AUTO_IME_PERF_DIR ?? "artifacts/reports/perf-current";
const tick = () => new Promise<void>((r) => setImmediate(r));
const percentile = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return {
    n: s.length,
    p50: s[Math.ceil(s.length * 0.5) - 1],
    p95: s[Math.ceil(s.length * 0.95) - 1],
    max: s.at(-1),
  };
};
function memory() {
  global.gc?.();
  return process.memoryUsage();
}
class Doc implements DocumentView {
  version = 1;
  constructor(
    public lines: string[],
    public languageId: string,
  ) {}
  get lineCount() {
    return this.lines.length;
  }
  lineAt(n: number) {
    return this.lines[n]!;
  }
}
const snippets: Record<string, string> = {
  python: 'value = "hello 世界😀"',
  javascript: "const value = `hello ${name}`;",
  typescript: "const value: string = `hello ${name}`;",
  c: 'const char *value = "hello world";',
  cpp: 'auto value = R"tag(hello world)tag";',
};
async function main() {
  mkdirSync(out, { recursive: true });
  const environment = {
    date: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    kernel: release(),
    cpu: cpus()[0]?.model,
    extension: JSON.parse(readFileSync("package.json", "utf8")).version,
    cpuUnit: "microseconds",
    memoryUnit: "bytes",
    latencyUnit: "milliseconds",
  };
  const tokenizer = new Tokenizer(process.cwd());
  if (process.argv[2] === "--cold") {
    const language = process.argv[3]!;
    const before = memory(),
      cpu = process.cpuUsage(),
      start = performance.now();
    const g = await tokenizer.grammar(language);
    const c = new DocumentCache(
      new Doc(Array(100).fill(snippets[language]), language),
      g,
    );
    const result = await c.query(99, 1);
    const elapsed = performance.now() - start;
    const usage = process.cpuUsage(cpu);
    const followups: unknown[] = [];
    let followup = result;
    for (let i = 0; followup.kind === "unknown" && i < 7; i++) {
      await tick();
      const began = performance.now();
      followup = await c.query(99, 1);
      followups.push({
        ms: performance.now() - began,
        result: followup.kind,
        reason: followup.reason,
      });
    }
    console.log(
      JSON.stringify({
        language,
        ms: elapsed,
        cpu: usage,
        result: result.kind,
        reason: result.reason,
        cacheBytes: c.bytes,
        followups,
        before,
        after: memory(),
      }),
    );
    tokenizer.dispose();
    return;
  }
  if (process.argv[2] === "--idle") {
    const runner = new ProcessRunner();
    const adapter = await createAdapter(process.cwd(), "auto", runner);
    const before = {
      processes: runner.count,
      get: adapter.getCount,
      set: adapter.setCount,
      memory: memory(),
    };
    const cpu = process.cpuUsage(),
      start = performance.now(),
      usage = process.resourceUsage();
    await new Promise((r) => setTimeout(r, 300000));
    const elapsed = performance.now() - start,
      used = process.cpuUsage(cpu);
    const after = {
      processes: runner.count,
      get: adapter.getCount,
      set: adapter.setCount,
      memory: process.memoryUsage(),
    };
    const report = {
      environment,
      elapsed,
      before,
      after,
      cpu: used,
      oneCoreCpuPercent: (used.user + used.system) / (elapsed * 10),
      voluntaryContextSwitches:
        process.resourceUsage().voluntaryContextSwitches -
        usage.voluntaryContextSwitches,
      scope:
        "Initialized core + read-only live adapter, not VS Code Host or power consumption",
    };
    writeFileSync(`${out}/idle.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    runner.dispose();
    return;
  }
  const initialMemory = memory();
  const grammarMemory: unknown[] = [];
  for (const language of Object.keys(snippets)) {
    await tokenizer.grammar(language);
    grammarMemory.push({ language, memory: memory() });
  }
  const scenarios: unknown[] = [];
  async function scenario(
    name: string,
    doc: Doc,
    mode: "move" | "type" | "head-edit",
  ) {
    const c = new DocumentCache(doc, await tokenizer.grammar(doc.languageId));
    const prepareStart = performance.now(),
      prepareCpuStart = process.cpuUsage();
    let ready = await c.query(doc.lineCount - 1, 0),
      prepareRequests = 1;
    while (ready.kind === "unknown" && prepareRequests < 8) {
      ready = await c.query(doc.lineCount - 1, 0);
      prepareRequests++;
    }
    const prepareMs = performance.now() - prepareStart,
      prepareCpu = process.cpuUsage(prepareCpuStart);
    const beforeStats = { ...c.stats },
      beforeMemory = memory();
    const delays = monitorEventLoopDelay({ resolution: 1 });
    delays.enable();
    const cpu = process.cpuUsage(),
      start = performance.now(),
      samples: number[] = [];
    const kinds: Record<string, number> = {},
      reasons: Record<string, number> = {};
    const count = mode === "head-edit" ? 100 : 1000;
    for (let i = 0; i < count; i++) {
      await tick(); // One synthetic editor interaction per event-loop turn.
      const b = performance.now();
      const line =
        mode === "move"
          ? 1 + ((i * 7919) % (doc.lineCount - 2))
          : doc.lineCount - 2;
      if (mode !== "move") {
        const changed = mode === "head-edit" ? 1 : line;
        doc.lines[changed] += " ";
        doc.version++;
        c.edit([
          {
            startLine: changed,
            endLine: changed,
            newLines: 0,
            startColumn: doc.lines[changed]!.length - 1,
            endColumn: doc.lines[changed]!.length - 1,
            newLastColumn: doc.lines[changed]!.length,
          },
        ]);
      }
      const column =
        mode === "move"
          ? i % (Math.min(32, doc.lineAt(line).length) + 1)
          : Math.min(doc.lineAt(line).length, 2 + (i % 8));
      const result = await c.query(line, column);
      samples.push(performance.now() - b);
      kinds[result.kind] = (kinds[result.kind] ?? 0) + 1;
      if (result.reason)
        reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
    }
    const elapsed = performance.now() - start,
      used = process.cpuUsage(cpu);
    await tick();
    delays.disable();
    scenarios.push({
      name,
      lines: doc.lineCount,
      mode,
      prepared: ready.kind,
      prepareRequests,
      prepareMs,
      prepareCpu,
      latency: percentile(samples),
      elapsed,
      cpu: used,
      kinds,
      reasons,
      eventLoopDelay: {
        p95: delays.percentile(95) / 1e6,
        max: delays.max / 1e6,
      },
      beforeStats,
      afterStats: { ...c.stats },
      cacheBytes: c.bytes,
      beforeMemory,
      afterMemory: memory(),
    });
    c.clear();
  }
  for (const language of Object.keys(snippets)) {
    await scenario(
      `${language}-100-lines-move`,
      new Doc(Array(100).fill(snippets[language]), language),
      "move",
    );
  }
  await scenario(
    "python-simple-10k-type",
    new Doc(Array(10000).fill("x=1"), "python"),
    "type",
  );
  for (const mode of ["move", "type", "head-edit"] as const) {
    await scenario(
      `python-code-10k-${mode}`,
      new Doc(Array(10000).fill("value = 123456"), "python"),
      mode,
    );
    await scenario(
      `python-multiline-10k-${mode}`,
      new Doc(
        [
          'value = """',
          ...Array(9998).fill("long prose 世界😀 content"),
          '"""',
        ],
        "python",
      ),
      mode,
    );
  }
  await scenario(
    "cpp-comment-10k-move",
    new Doc(
      ["/*", ...Array(9998).fill("long prose 世界😀 content"), "*/"],
      "cpp",
    ),
    "move",
  );
  await scenario(
    "js-template-10k-move",
    new Doc(
      [
        "const value = `",
        ...Array(9998).fill("long prose 世界😀 content"),
        "`;",
      ],
      "javascript",
    ),
    "move",
  );
  await scenario(
    "python-code-40k-move",
    new Doc(Array(40000).fill("value = 123"), "python"),
    "move",
  );
  const closes: unknown[] = [];
  for (let i = 0; i < 100; i++) {
    const c = new DocumentCache(
      new Doc(Array(1000).fill(snippets.python), "python"),
      await tokenizer.grammar("python"),
    );
    await c.query(999, 2);
    c.clear();
    if (i % 10 === 9)
      closes.push({ iteration: i + 1, memory: memory(), cacheBytes: c.bytes });
  }
  const beforeDispose = memory();
  tokenizer.dispose();
  const report = {
    environment,
    initialMemory,
    grammarMemory,
    scenarios,
    closes,
    beforeDispose,
    afterDispose: memory(),
    resourceUsage: process.resourceUsage(),
    scope:
      "Synthetic core workload; CPU/RSS include Node/tsx/WASM; GC snapshots outside timed intervals; no IME set",
  };
  const path = `${out}/${process.argv.includes("--profile") ? "profile-run" : "resources"}.json`;
  writeFileSync(path, JSON.stringify(report, null, 2));
  console.log(path);
}
void main();
