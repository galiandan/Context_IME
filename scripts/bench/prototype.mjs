// Experimental builds only. Never modifies src/ or the shipped extension.
import { build } from "esbuild";
import { dirname, relative, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
// Pin the context modules and tests to the audited baseline so historical A/B
// experiments remain reproducible after production adopts an optimization.
function baselineSource(path) {
  const file = relative(process.cwd(), path).split(sep).join("/");
  return execFileSync("git", ["show", `040d28e:${file}`], {
    encoding: "utf8",
  });
}
const enabled = process.argv.includes("--memo");
const openingFirst = process.argv.includes("--opening-first");
const variant = enabled ? "memo" : openingFirst ? "opening-first" : "baseline";
mkdirSync("artifacts/tmp/perf-prototype", { recursive: true });
const options = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  plugins: enabled
    ? [
        {
          name: "scope-memo-experiment",
          setup(api) {
            api.onLoad(
              { filter: /[/\\]context[/\\]classifier\.ts$/ },
              (args) => {
                let source = baselineSource(args.path);
                if (
                  !source.includes("export function scopeKind(") ||
                  !source.includes("export function scopePath(")
                )
                  throw Error("Prototype requires current classifier shape");
                source = source
                  .replace(
                    "export function scopeKind(",
                    "function uncachedKind(",
                  )
                  .replace(
                    "export function scopePath(",
                    "function uncachedPath(",
                  );
                source += `
const kindMemo = new Map<string, WeakMap<readonly string[], Kind>>();
const pathMemo = new WeakMap<readonly string[], string>();
export function scopeKind(scopes: readonly string[], language: string): Kind {
 let memo = kindMemo.get(language);
 if (!memo) { memo = new WeakMap(); kindMemo.set(language, memo); }
 let result = memo.get(scopes);
 if (result === undefined) { result = uncachedKind(scopes, language); memo.set(scopes, result); }
 return result;
}
export function scopePath(scopes: readonly string[]): string {
 let result = pathMemo.get(scopes);
 if (result === undefined) { result = uncachedPath(scopes); pathMemo.set(scopes, result); }
 return result;
}
`;
                return { contents: source, loader: "ts" };
              },
            );
          },
        },
      ]
    : openingFirst
      ? [
          {
            name: "opening-first-experiment",
            setup(api) {
              api.onLoad({ filter: /[/\\]context[/\\]cache\.ts$/ }, (args) => {
                let source = baselineSource(args.path);
                const needle = "          if (\n            scopeKind(t.scopes";
                if (!source.includes(needle))
                  throw Error("Prototype requires current cache shape");
                source = source.replace(
                  needle,
                  String.raw`          if (!t.scopes.some((s) =>
          /punctuation.*(begin|start)|punctuation\.definition\.comment/.test(s))) continue;
` + needle,
                );
                return {
                  contents: source,
                  loader: "ts",
                  resolveDir: dirname(args.path),
                };
              });
            },
          },
        ]
      : [],
};
options.plugins.push({
  name: "audited-baseline",
  setup(api) {
    api.onLoad({ filter: /[/\\]tests[/\\].*\.ts$/ }, (args) => ({
      contents: baselineSource(args.path),
      loader: "ts",
      resolveDir: dirname(args.path),
    }));
    api.onLoad(
      { filter: /[/\\]context[/\\](cache|classifier|tokenizer)\.ts$/ },
      (args) => ({
        contents: baselineSource(args.path),
        loader: "ts",
        resolveDir: dirname(args.path),
      }),
    );
  },
});
await build({
  ...options,
  entryPoints: ["scripts/bench/resources.ts"],
  outfile: `artifacts/tmp/perf-prototype/${variant}.cjs`,
});
if (enabled || openingFirst) {
  const { readdirSync } = await import("node:fs");
  await build({
    ...options,
    entryPoints: readdirSync("tests")
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => `tests/${f}`),
    outdir: `artifacts/tmp/perf-prototype/tests-${variant}`,
    outExtension: { ".js": ".cjs" },
  });
}
