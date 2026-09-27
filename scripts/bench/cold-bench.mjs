import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const samples = [];
for (let i = 0; i < 30; i++)
  samples.push(
    JSON.parse(
      execFileSync(
        process.execPath,
        ["--import", "tsx", "scripts/bench/cold.ts"],
        {
          encoding: "utf8",
        },
      ),
    ),
  );
const times = samples.map((s) => s.ms).sort((a, b) => a - b);
const report = {
  scope:
    "Fresh Node process each sample; measured inside process includes WASM+grammar+100-line query, excludes Node/tsx startup",
  n: 30,
  p50: times[15],
  p95: times[28],
  unknown: samples.filter((s) => s.kind === "unknown").length,
  samples,
};
mkdirSync("artifacts/reports", { recursive: true });
writeFileSync(
  "artifacts/reports/cold-start.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(report);
