import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, platform, release } from "node:os";
import { Tokenizer } from "../../src/context/tokenizer";
import { DocumentCache, type DocumentView } from "../../src/context/cache";
import { ProcessRunner } from "../../src/platform/process";
import { createAdapter } from "../../src/platform/adapter";
import { Controller } from "../../src/core/controller";
class Doc implements DocumentView {
  version = 1;
  languageId = "python";
  constructor(public lines: string[]) {}
  get lineCount() {
    return this.lines.length;
  }
  lineAt(n: number) {
    return this.lines[n]!;
  }
}
const summary = (samples: number[]) => {
  const s = [...samples].sort((a, b) => a - b);
  return {
    n: s.length,
    p50: s[Math.floor(s.length * 0.5)],
    p95: s[Math.floor(s.length * 0.95)],
  };
};
async function main() {
  const startCpu = process.cpuUsage(),
    root = process.cwd(),
    t = new Tokenizer(root);
  const result: Record<string, unknown> = {
    environment: {
      platform: platform(),
      release: release(),
      node: process.version,
      cpu: cpus()[0]?.model,
      date: new Date().toISOString(),
    },
    scenarios: [],
  };
  const scenarios: unknown[] = [];
  for (const lines of [100, 10000, 40000]) {
    const cold: number[] = [],
      warm: number[] = [],
      input: number[] = [],
      delimiter: number[] = [];
    let unknown = 0;
    const totals = { tokenized: 0, reused: 0, hits: 0, yields: 0 };
    for (let i = 0; i < 30; i++) {
      const d = new Doc(Array(lines).fill("x=1"));
      const begin = performance.now(),
        c = new DocumentCache(d, await t.grammar("python"));
      let r = await c.query(lines - 1, 2);
      cold.push(performance.now() - begin);
      if (r.kind === "unknown") unknown++;
      if (i === 29) {
        // Explicit subsequent user-like requests, never an automatic background retry.
        for (let j = 0; r.kind === "unknown" && j < 8; j++)
          r = await c.query(lines - 1, 2);
        for (let j = 0; j < 1000; j++) {
          const b = performance.now();
          r = await c.query(lines - 1, j % 4);
          warm.push(performance.now() - b);
          if (r.kind === "unknown") unknown++;
        }
        for (let j = 0; j < 100; j++) {
          const b = performance.now();
          d.lines[lines - 1] = `x=${j}`;
          d.version++;
          c.edit([{ startLine: lines - 1, endLine: lines - 1, newLines: 0 }]);
          r = await c.query(lines - 1, 2);
          if (r.kind === "unknown") unknown++;
          input.push(performance.now() - b);
        }
        for (let j = 0; j < 30; j++) {
          const b = performance.now();
          d.lines[0] = j % 2 ? "x=1" : '"""';
          d.version++;
          c.edit([{ startLine: 0, endLine: 0, newLines: 0 }]);
          r = await c.query(lines - 1, 2);
          delimiter.push(performance.now() - b);
          if (r.kind === "unknown") unknown++;
        }
      }
      for (const k of Object.keys(totals) as (keyof typeof totals)[])
        totals[k] += c.stats[k];
      c.clear();
    }
    scenarios.push({
      lines,
      cold: summary(cold),
      warm: summary(warm),
      input: summary(input),
      delimiter: summary(delimiter),
      unknown,
      stats: totals,
    });
  }
  result.scenarios = scenarios;
  const heap: number[] = [];
  for (let i = 0; i < 100; i++) {
    const c = new DocumentCache(
      new Doc(Array(100).fill("x=1")),
      await t.grammar("python"),
    );
    await c.query(99, 1);
    c.clear();
    if (i % 10 === 9) {
      global.gc?.();
      heap.push(process.memoryUsage().heapUsed);
    }
  }
  result.memory = { gcHeapEvery10Closes: heap, process: process.memoryUsage() };
  let fakeSet = 0;
  const controller = new Controller(async () => {
    fakeSet++;
  }, 0);
  controller.accept("one", "text", () => true);
  await new Promise((r) => setTimeout(r, 10));
  for (let i = 0; i < 1000; i++) controller.accept("one", "text", () => true);
  await controller.idle();
  result.fake = { set: fakeSet, events: 1001 };
  controller.dispose();
  const runner = new ProcessRunner();
  try {
    const a = await createAdapter(root, "auto", runner);
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const b = performance.now();
      await a.get();
      samples.push(performance.now() - b);
    }
    result.backend = {
      name: a.backend,
      readOnly: true,
      get: a.getCount,
      set: a.setCount,
      realProcesses: runner.count,
      latency: summary(samples),
    };
  } catch (e) {
    result.backend = { error: String(e), realProcesses: runner.count };
  }
  runner.dispose();
  result.cpu = process.cpuUsage(startCpu);
  mkdirSync("artifacts/reports", { recursive: true });
  writeFileSync(
    "artifacts/reports/benchmark.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
  t.dispose();
}
void main();
