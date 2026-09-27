import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
for (const arg of args) {
  if (!["--dry-run", "--azure-credential"].includes(arg)) {
    throw new Error(`Unknown option: ${arg}`);
  }
}
const dryRun = args.includes("--dry-run");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (
  manifest.publisher !== "Galiandan-CIO" ||
  manifest.name !== "vscode-auto-ime"
) {
  throw new Error(
    "Unexpected publisher or extension name; check release identity.",
  );
}
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run using npm run publish:marketplace.");
const run = (argv) =>
  execFileSync(process.execPath, argv, { cwd: root, stdio: "inherit" });
for (const script of ["lint", "typecheck", "test", "package:marketplace"]) {
  run([npmCli, "run", script]);
}
const packagePath = join(
  root,
  "artifacts",
  "vsix",
  `${manifest.name}-${manifest.version}-linux-x64-${manifest.publisher}.vsix`,
);
if (dryRun) {
  console.log(
    `Dry run complete. No upload or authentication attempted.\nPackage: ${packagePath}`,
  );
} else {
  run([
    join(root, "node_modules/@vscode/vsce/vsce"),
    "publish",
    "--packagePath",
    packagePath,
    ...(args.includes("--azure-credential") ? ["--azure-credential"] : []),
  ]);
}
