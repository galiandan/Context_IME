import { SemanticCache } from "./semanticCache";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Tokenizer } from "../src/context/tokenizer";
const tokenizer = new Tokenizer(process.cwd());
const fixtures: [string, string, string][] = [
  ["python", '""|"abc"""', "unknown"],
  ["python", '"""|abc"""', "string"],
  ["python", '"""abc|"""', "string"],
  ["python", '"""abc"""|', "code"],
  ["python", 'f"|{x}"', "string"],
  ["python", 'f"{|x}"', "code"],
  ["python", 'f"{x}|"', "string"],
  ["python", "f\"{'a'}|tail\"", "string"],
  ["javascript", "`a |${x}`", "string"],
  ["javascript", "`a ${|x}`", "code"],
  ["javascript", "`a ${x|}`", "code"],
  ["javascript", "`a ${x}|`", "string"],
  ["javascript", "`a $|{x}`", "unknown"],
  ["javascript", '`a ${`b ${"c|"}`} d`', "string"],
  ["typescript", "/hello[\"']|/.test(x)", "code"],
  ["javascript", '"abc"|', "code"],
  ["javascript", '"a\\"b|"', "string"],
  ["javascript", '"|', "string"],
  ["cpp", 'R"xyz(|text)xyz"', "string"],
  ["cpp", 'R"xyz(text|)xyz"', "string"],
  ["cpp", 'R"xyz(text)xyz"|', "code"],
  ["cpp", 'R"sql(SELECT "x|" FROM t)sql"', "string"],
  ["c", "L'x|'", "code"],
  ["cpp", 'u8"😀中|"', "string"],
  ["c", '/* "| */', "comment"],
  ["python", '# abc|\n"next"', "comment"],
  ["python", '# abc\n|"next"', "code"],
  ["javascript", '// abc\r\n"中😀|"', "string"],
  ["python", 'print("a|b")', "string"],
  ["python", 'print("ab|)', "string"],
];
for (const [languageId, marked, expected] of fixtures)
  test(`${languageId} boundary ${JSON.stringify(marked)}`, async () => {
    const pos = marked.indexOf("|"),
      before = marked.slice(0, pos).split(/\r?\n/),
      lines = marked.replace("|", "").split(/\r?\n/);
    const c = new SemanticCache(
      {
        version: 1,
        languageId,
        lineCount: lines.length,
        lineAt: (n) => lines[n]!,
      },
      await tokenizer.grammar(languageId),
    );
    let r = await c.query(before.length - 1, before.at(-1)!.length);
    for (
      let i = 0;
      r.kind === "unknown" && expected !== "unknown" && i < 4;
      i++
    )
      r = await c.query(before.length - 1, before.at(-1)!.length);
    assert.equal(r.kind, expected, JSON.stringify(r));
  });
