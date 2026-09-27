import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
const scenarios = [];
const out = process.env.AUTO_IME_PERF_DIR ?? "artifacts/reports/perf-current";
const entry = process.env.AUTO_IME_BENCH_ENTRY;
for (const language of ["python", "javascript", "typescript", "c", "cpp"]) {
  const samples = [];
  for (let i = 0; i < 30; i++) {
    samples.push(
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            "--expose-gc",
            ...(entry
              ? [entry]
              : ["--import", "tsx", "scripts/bench/resources.ts"]),
            "--cold",
            language,
          ],
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 30000,
            maxBuffer: 1024 * 1024,
          },
        ),
      ),
    );
  }
  const times = samples.map((s) => s.ms).sort((a, b) => a - b);
  scenarios.push({
    language,
    n: samples.length,
    p50: times[14],
    p95: times[28],
    unknown: samples.filter((s) => s.result === "unknown").length,
    samples,
  });
}
mkdirSync(out, { recursive: true });
writeFileSync(
  `${out}/cold.json`,
  JSON.stringify(
    {
      environment: {
        node: process.version,
        cpu: cpus()[0]?.model,
        date: new Date().toISOString(),
      },
      scope:
        "Fresh process each sample; measured WASM/grammar + 100 lines; excludes Node/tsx startup and GC snapshots",
      scenarios,
    },
    null,
    2,
  ),
);
