import { build } from "esbuild";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
mkdirSync("artifacts/tmp", { recursive: true });
mkdirSync("artifacts/reports/perf-current", { recursive: true });
await build({
  entryPoints: ["scripts/bench/host.integration.ts"],
  outfile: "artifacts/tmp/host-bench.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
});
const profile = mkdtempSync(resolve("artifacts/tmp/host-bench-"));
mkdirSync(join(profile, "User"));
writeFileSync(
  join(profile, "User/settings.json"),
  JSON.stringify({
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
    "extensions.autoUpdate": false,
    "editor.quickSuggestions": false,
    "editor.suggestOnTriggerCharacters": false,
    "files.hotExit": "off",
    "workbench.startupEditor": "none",
  }),
);
const env = {
  ...process.env,
  AUTO_IME_TEST_REPORT: resolve("artifacts/reports/perf-current/host.json"),
};
delete env.ELECTRON_RUN_AS_NODE;
rmSync(env.AUTO_IME_TEST_REPORT, { force: true });
const child = spawn(
  process.env.VSCODE_EXECUTABLE ?? "/usr/share/code/code",
  [
    "--user-data-dir",
    profile,
    "--extensions-dir",
    join(profile, "extensions"),
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
    "--disable-gpu",
    "--extensionDevelopmentPath=" + process.cwd(),
    "--extensionTestsPath=" + resolve("artifacts/tmp/host-bench.cjs"),
  ],
  { env, stdio: "inherit", shell: false },
);
const timeout = setTimeout(() => child.kill("SIGKILL"), 240000);
child.on("error", (error) => {
  clearTimeout(timeout);
  console.error(error);
  process.exitCode = 1;
});
child.on("close", (code) => {
  clearTimeout(timeout);
  process.exitCode = code === 0 && existsSync(env.AUTO_IME_TEST_REPORT) ? 0 : 1;
  rmSync(profile, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
});
