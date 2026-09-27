import { build } from "esbuild";
import { mkdir, copyFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
await mkdir("resources", { recursive: true });
await mkdir("dist", { recursive: true });
await copyFile(
  "node_modules/vscode-oniguruma/release/onig.wasm",
  "resources/onig.wasm",
);
for (const entry of JSON.parse(
  await readFile("grammars/manifest.json", "utf8"),
)) {
  const hash = createHash("sha256")
    .update(await readFile("grammars/" + entry.file))
    .digest("hex");
  if (hash !== entry.sha256)
    throw Error("Grammar checksum mismatch " + entry.file);
}
await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  outfile: "dist/extension.js",
  sourcemap: true,
  logLevel: "info",
});
