import { build } from "esbuild";
import { mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
await build({
  entryPoints: ["tests/extension.integration.ts"],
  outfile: "artifacts/tmp/integration.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["vscode"],
});
const profile = mkdtempSync(resolve("artifacts/tmp/context-ime-tests-"));
mkdirSync("artifacts/reports", { recursive: true });
const executable =
  process.env.VSCODE_EXECUTABLE ??
  (process.platform === "linux" ? "/usr/share/code/code" : "code");
const env = {
  ...process.env,
  AUTO_IME_TEST_REPORT: resolve("artifacts/reports/integration.json"),
};
delete env.ELECTRON_RUN_AS_NODE;
rmSync(env.AUTO_IME_TEST_REPORT, { force: true });
const args = [
  "--user-data-dir",
  profile,
  "--extensions-dir",
  join(profile, "extensions"),
  "--skip-welcome",
  "--skip-release-notes",
  "--disable-workspace-trust",
  "--disable-gpu",
  "--extensionDevelopmentPath=" +
    (process.env.AUTO_IME_EXTENSION_PATH ?? process.cwd()),
  "--extensionTestsPath=" + resolve("artifacts/tmp/integration.cjs"),
];
const child = spawn(executable, args, { env, stdio: "inherit", shell: false });
const timeout = setTimeout(() => child.kill("SIGKILL"), 60000);
child.on("error", (e) => {
  clearTimeout(timeout);
  console.error(e);
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
