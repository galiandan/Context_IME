import { test } from "node:test";
import assert from "node:assert/strict";
import { Tokenizer } from "../src/context/tokenizer";
import { DocumentCache, type DocumentView } from "../src/context/cache";
const tokenizer = new Tokenizer(process.cwd());
export class Doc implements DocumentView {
  version = 1;
  languageId = "python";
  lines: string[];
  constructor(text: string, language = "python") {
    this.lines = text.split(/\r?\n/);
    this.languageId = language;
  }
  get lineCount() {
    return this.lines.length;
  }
  lineAt(n: number) {
    return this.lines[n]!;
  }
}
const cases: [string, string, string][] = [
  ["python", 'print(|"hello")', "code"],
  ["python", 'print("|")', "string"],
  ["python", 'print("hello|")', "string"],
  ["python", 'print("hello"|)', "code"],
  ["python", 'print("|', "string"],
  ["python", 'print("a\\"b|")', "string"],
  ["python", 'x = """a\n中😀|\nb"""', "string"],
  ["python", 'r"abc\\|"', "string"],
  ["python", 'f"hi |{x}"', "string"],
  ["python", 'f"hi {x|}"', "code"],
  ["python", "f\"hi {len('a|')}\"", "string"],
  ["python", '# "hi|"', "comment"],
  ["python", "“hello|”", "code"],
  ["javascript", "`hello |${a}`", "string"],
  ["typescript", "`hello ${a|}`", "code"],
  ["javascript", '`hello ${"a|"}`', "string"],
  ["javascript", "const x = /[\"']|/g", "code"],
  ["javascript", '// "hi|"', "comment"],
  ["javascript", '/* "hi|" */', "comment"],
  ["javascript", "/* hi */| x", "code"],
  ["c", "'x|'", "code"],
  ["cpp", '"中😀|"', "string"],
  ["cpp", 'R"tag(a\nb|)tag"', "string"],
  ["c", "#|include <stdio.h>", "code"],
  ["c", '// "|', "comment"],
  ["typescript", 'const x="a\r\n|', "code"],
];
for (const [lang, marked, expected] of cases)
  test(`${lang} ${JSON.stringify(marked)}`, async () => {
    const offset = marked.indexOf("|");
    const before = marked.slice(0, offset).split(/\r?\n/);
    const doc = new Doc(marked.replace("|", ""), lang);
    const cache = new DocumentCache(doc, await tokenizer.grammar(lang));
    let result = await cache.query(before.length - 1, before.at(-1)!.length);
    for (let retry = 0; result.kind === "unknown" && retry < 3; retry++)
      result = await cache.query(before.length - 1, before.at(-1)!.length);
    assert.equal(result.kind, expected, JSON.stringify(result));
  });
test("warm cache, state propagation and mapped suffix", async () => {
  const d = new Doc("x=1\na=2\nb=3\nc=4");
  const c = new DocumentCache(d, await tokenizer.grammar("python"));
  await c.query(3, 2);
  const n = c.stats.tokenized;
  await c.query(3, 2);
  assert.equal(c.stats.tokenized, n);
  d.lines.splice(1, 0, "z=0");
  d.version++;
  c.edit([{ startLine: 1, endLine: 1, newLines: 1 }]);
  await c.query(4, 2);
  assert.equal(c.stats.tokenized, n + 2);
  d.lines[0] = '"""';
  d.version++;
  c.edit([{ startLine: 0, endLine: 0, newLines: 0 }]);
  assert.equal((await c.query(4, 2)).kind, "string");
  assert.ok(c.stats.tokenized > n + 3);
});
test("unknown for cancelled and long lines", async () => {
  const c = new DocumentCache(
    new Doc("a".repeat(20001)),
    await tokenizer.grammar("python"),
  );
  assert.equal((await c.query(0, 1)).kind, "unknown");
  assert.equal((await c.query(0, 1, () => false)).kind, "unknown");
});
