import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Release the exact files produced by a successful GitHub run; never rebuild locally.
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const runIndex = args.indexOf("--run-id");
const runId = runIndex >= 0 ? args[runIndex + 1] : undefined;
if (!runId || !/^\d+$/.test(runId))
  throw Error(
    "Use npm run publish:marketplace -- --run-id <successful GitHub run ID> [--dry-run]",
  );
const other = args.filter((_, i) => i !== runIndex && i !== runIndex + 1);
if (other.some((a) => !["--dry-run", "--azure-credential"].includes(a)))
  throw Error("Unknown publishing option");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (
  manifest.publisher !== "Galiandan-CIO" ||
  manifest.name !== "vscode-auto-ime"
)
  throw Error("Unexpected extension identity");
const capture = (file, argv) =>
  execFileSync(file, argv, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
const run = (file, argv) =>
  execFileSync(file, argv, { cwd: root, stdio: "inherit" });
const repo = "galiandan/Context_IME";
const result = JSON.parse(
  capture("gh", [
    "run",
    "view",
    runId,
    "--repo",
    repo,
    "--json",
    "status,conclusion,headSha,workflowName,event,url",
  ]),
);
if (
  result.status !== "completed" ||
  result.conclusion !== "success" ||
  !["build-test-vsix", "release-vsix"].includes(result.workflowName) ||
  !["push", "workflow_dispatch"].includes(result.event) ||
  result.headSha !== capture("git", ["rev-parse", "HEAD"]).trim()
)
  throw Error(
    "Run must be successful, trusted CI/Release, and match local HEAD",
  );
if (capture("git", ["status", "--porcelain"]).trim())
  throw Error("Commit source changes before publishing CI artifacts");
mkdirSync(join(root, "artifacts/vsix"), { recursive: true });
const directory = mkdtempSync(join(root, `artifacts/vsix/github-${runId}-`));
run("gh", [
  "run",
  "download",
  runId,
  "--repo",
  repo,
  "--pattern",
  "vsix-*",
  "--dir",
  directory,
]);
const targets = [
  "linux-x64",
  "win32-x64",
  "win32-arm64",
  "darwin-x64",
  "darwin-arm64",
];
const packages = targets.map((target) =>
  join(
    directory,
    `vsix-${target}`,
    `${manifest.name}-${manifest.version}-${target}.vsix`,
  ),
);
for (const path of packages) run("python", ["scripts/verify-vsix.py", path]);
console.log(
  `Verified five GitHub-built packages from ${result.url}\n${directory}`,
);
if (!other.includes("--dry-run"))
  run(process.execPath, [
    join(root, "node_modules/@vscode/vsce/vsce"),
    "publish",
    "--packagePath",
    ...packages,
    ...(other.includes("--azure-credential") ? ["--azure-credential"] : []),
  ]);
