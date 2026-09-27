import { mkdirSync, writeFileSync } from "node:fs";
import { Controller } from "../../src/core/controller";
import { ProcessRunner } from "../../src/platform/process";
import { createAdapter } from "../../src/platform/adapter";
(async () => {
  const runner = new ProcessRunner();
  await createAdapter(process.cwd(), "auto", runner);
  let calls = 0;
  const c = new Controller(async () => {
    calls++;
  }, 0);
  c.accept("r", "plan", () => true);
  await new Promise((r) => setTimeout(r, 20));
  const before = { processes: runner.count, set: calls };
  const start = performance.now();
  await new Promise((r) => setTimeout(r, 300000));
  const after = { processes: runner.count, set: calls };
  const report = {
    durationMs: performance.now() - start,
    before,
    after,
    passed: JSON.stringify(before) === JSON.stringify(after),
    scope:
      "Core controller + live backend initialized; no polling. Not an Extension Host CPU measurement.",
  };
  mkdirSync("artifacts/reports", { recursive: true });
  writeFileSync(
    "artifacts/reports/idle.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(report);
  c.dispose();
  runner.dispose();
})();
