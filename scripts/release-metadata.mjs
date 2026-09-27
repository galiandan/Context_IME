import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length && args[0] !== "--verify-assets"))
  throw Error("Expected no arguments or --verify-assets");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const tag = process.env.RELEASE_TAG;
if (
  !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? "") ||
  tag !== `v${pkg.version}` ||
  lock.version !== pkg.version ||
  lock.packages?.[""]?.version !== pkg.version ||
  lock.name !== pkg.name ||
  lock.packages?.[""]?.name !== pkg.name ||
  !/^[a-z0-9][a-z0-9-]*$/.test(pkg.name)
)
  throw Error(
    "Release tag must be vX.Y.Z and match package.json/package-lock.json identity and versions",
  );
console.log(`Validated ${pkg.name} ${tag}`);
if (args[0] === "--verify-assets") {
  const targets = [
    "linux-x64",
    "win32-x64",
    "win32-arm64",
    "darwin-x64",
    "darwin-arm64",
  ];
  const directory = "artifacts/vsix";
  const expected = targets
    .map((t) => `${pkg.name}-${pkg.version}-${t}.vsix`)
    .sort();
  const actual = readdirSync(directory)
    .filter((n) => n.endsWith(".vsix"))
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw Error("Missing or unexpected release VSIX files");
  for (const target of targets)
    execFileSync("python", ["scripts/verify-vsix.py", "--target", target], {
      stdio: "inherit",
    });
  writeFileSync(
    join(directory, "SHA256SUMS.txt"),
    expected
      .map(
        (name) =>
          `${createHash("sha256")
            .update(readFileSync(join(directory, name)))
            .digest("hex")}  ${name}\n`,
      )
      .join(""),
  );
}
