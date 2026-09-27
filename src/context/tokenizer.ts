import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Registry, parseRawGrammar, type IGrammar } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
let wasm: Promise<void> | undefined;
export const languages: Record<string, string> = {
  python: "source.python",
  javascript: "source.js",
  typescript: "source.ts",
  c: "source.c",
  cpp: "source.cpp",
};
export class Tokenizer {
  private registry?: Registry;
  constructor(private root: string) {}
  async grammar(language: string): Promise<IGrammar | undefined> {
    const scope = languages[language];
    if (!scope) return undefined;
    if (!this.registry) {
      wasm ??= readFile(join(this.root, "resources/onig.wasm")).then((b) =>
        loadWASM(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
      );
      this.registry = new Registry({
        onigLib: wasm.then(() => ({
          createOnigScanner: (p) => new OnigScanner(p),
          createOnigString: (s) => new OnigString(s),
        })),
        loadGrammar: async (scope) => {
          const manifest = JSON.parse(
            await readFile(join(this.root, "grammars/manifest.json"), "utf8"),
          ) as { scope: string; file: string }[];
          const entry = manifest.find((e) => e.scope === scope);
          if (!entry) throw new Error("GRAMMAR_DEPENDENCY_MISSING: " + scope);
          const file = join(this.root, "grammars", entry.file);
          return parseRawGrammar(await readFile(file, "utf8"), file);
        },
      });
    }
    return (await this.registry.loadGrammar(scope)) ?? undefined;
  }
  dispose() {
    this.registry?.dispose();
    this.registry = undefined;
  }
}
