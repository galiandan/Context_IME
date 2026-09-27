import { execFileSync } from "node:child_process";
import { accessSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
const { name, version, publisher } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const args = process.argv.slice(2);
const marketplace = args.includes("--marketplace");
const target =
  args.find((arg) => arg !== "--marketplace") ??
  `${process.platform}-${process.arch}`;
if (!/^(linux|win32|darwin)-(x64|arm64)$/.test(target))
  throw Error("Unsupported target");
if (!target.startsWith("linux"))
  accessSync(
    `native/bin/${target}/context-ime${target.startsWith("win32") ? ".exe" : ""}`,
  );
mkdirSync("artifacts/vsix", { recursive: true });
mkdirSync("artifacts/tmp", { recursive: true });
{
  const ignore = readFileSync(".vscodeignore", "utf8").replace(
    "!README.md",
    "!README.marketplace.md",
  );
  writeFileSync("artifacts/tmp/marketplace.vscodeignore", ignore);
}
execFileSync(
  process.execPath,
  [
    "node_modules/@vscode/vsce/vsce",
    "package",
    "--no-dependencies",
    "--allow-missing-repository",
    "--no-rewrite-relative-links",
    "--ignore-other-target-folders",
    "--readme-path",
    "README.marketplace.md",
    "--ignoreFile",
    "artifacts/tmp/marketplace.vscodeignore",
    "--target",
    target,
    "--out",
    `artifacts/vsix/${name}-${version}-${target}${marketplace ? "-" + publisher : ""}.vsix`,
  ],
  { stdio: "inherit" },
);
