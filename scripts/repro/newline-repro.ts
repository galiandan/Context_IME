import { Tokenizer } from "../../src/context/tokenizer";
import { DocumentCache } from "../../src/context/cache";
(async () => {
  const t = new Tokenizer(process.cwd());
  const g = await t.grammar("python");
  let version = 1;
  const lines = ["# hello"];
  const c = new DocumentCache(
    {
      get version() {
        return version;
      },
      languageId: "python",
      get lineCount() {
        return lines.length;
      },
      lineAt: (n) => lines[n]!,
    },
    g,
  );
  for (let i = 0; i < 3; i++) console.log("before", await c.query(0, 7));
  lines.push("");
  version++;
  c.edit([
    {
      startLine: 0,
      endLine: 0,
      startColumn: 7,
      endColumn: 7,
      newLines: 1,
      newLastColumn: 0,
    },
  ]);
  console.log("after Enter", await c.query(1, 0));
  lines[1] = "a";
  version++;
  c.edit([
    {
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      newLines: 0,
      newLastColumn: 1,
    },
  ]);
  console.log("after letter", await c.query(1, 1));
})();
