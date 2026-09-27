import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Registry, parseRawGrammar, type IGrammar } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
// Counts successful scanner construction through the public registry factory.
// Used only to distinguish cold compilation progress from repeated timeouts.
export const grammarCompilation = new WeakMap<IGrammar, { scanners: number }>();
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
  private compilation = { scanners: 0 };
  private manifest?: Promise<{ scope: string; file: string }[]>;
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
          createOnigScanner: (p) => {
            const scanner = new OnigScanner(p);
            this.compilation.scanners++;
            return scanner;
          },
          createOnigString: (s) => new OnigString(s),
        })),
        loadGrammar: async (scope) => {
          this.manifest ??= readFile(
            join(this.root, "grammars/manifest.json"),
            "utf8",
          ).then((content) => JSON.parse(content) as { scope: string; file: string }[]);
          const manifest = await this.manifest;
          const entry = manifest.find((e) => e.scope === scope);
          if (!entry) throw new Error("GRAMMAR_DEPENDENCY_MISSING: " + scope);
          const file = join(this.root, "grammars", entry.file);
          return parseRawGrammar(await readFile(file, "utf8"), file);
        },
      });
    }
    const grammar = (await this.registry.loadGrammar(scope)) ?? undefined;
    if (grammar) grammarCompilation.set(grammar, this.compilation);
    return grammar;
  }
  dispose() {
    this.registry?.dispose();
    this.registry = undefined;
  }
}
