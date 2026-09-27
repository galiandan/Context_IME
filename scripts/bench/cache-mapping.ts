import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, release } from "node:os";
import { Tokenizer } from "../../src/context/tokenizer";
import { DocumentCache, type DocumentView } from "../../src/context/cache";

const iterations = 400;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const percentile = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    max: sorted.at(-1),
  };
};

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

async function main() {
  const tokenizer = new Tokenizer(process.cwd());
  const grammar = await tokenizer.grammar("python");
  const scenarios = [];

  for (const lineCount of [1000, 10000, 40000]) {
    const doc = new Doc(
      Array.from({ length: lineCount }, (_, i) => `value${i} = 1`),
    );
    const cache = new DocumentCache(doc, grammar, Infinity, 0, 8 * 1024 * 1024);
    const setupStart = performance.now();
    let prepared = await cache.query(lineCount - 1, 1);
    for (let retry = 0; prepared.kind === "unknown" && retry < 8; retry++)
      prepared = await cache.query(lineCount - 1, 1);
    if (prepared.kind === "unknown")
      throw new Error(`Unable to prepare ${lineCount} rows: ${prepared.reason}`);
    const setupMs = performance.now() - setupStart;

    for (let i = 0; i < 20; i++) {
      doc.lines.unshift("");
      doc.version++;
      cache.edit([
        {
          startLine: 0,
          endLine: 0,
          newLines: 1,
          startColumn: 0,
          endColumn: 0,
          newLastColumn: 0,
          text: "\n",
        },
      ]);
    }
    await tick();
    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      doc.lines.unshift("");
      doc.version++;
      const start = performance.now();
      cache.edit([
        {
          startLine: 0,
          endLine: 0,
          newLines: 1,
          startColumn: 0,
          endColumn: 0,
          newLastColumn: 0,
          text: "\n",
        },
      ]);
      samples.push(performance.now() - start);
    }

    scenarios.push({
      lineCount,
      prepared: prepared.kind,
      setupMs,
      iterations,
      editMappingMs: percentile(samples),
      tokenizedLines: cache.stats.tokenized,
      cacheBytes: cache.bytes,
    });
    cache.clear();
  }

  tokenizer.dispose();
  const report = {
    environment: {
      date: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      kernel: release(),
      cpu: cpus()[0]?.model,
    },
    scope:
      "Synthetic DocumentCache newline-insertion mapping; timings exclude document array splice, tokenization, and IME processes.",
    scenarios,
  };
  mkdirSync("artifacts/reports", { recursive: true });
  writeFileSync(
    "artifacts/reports/cache-mapping.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
}

void main();
