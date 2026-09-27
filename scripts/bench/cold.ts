import { Tokenizer } from "../../src/context/tokenizer";
import { DocumentCache } from "../../src/context/cache";
(async () => {
  const start = performance.now();
  const t = new Tokenizer(process.cwd());
  const g = await t.grammar("python");
  const c = new DocumentCache(
    { version: 1, languageId: "python", lineCount: 100, lineAt: () => "x=1" },
    g,
  );
  const r = await c.query(99, 2);
  console.log(
    JSON.stringify({
      ms: performance.now() - start,
      kind: r.kind,
      tokenized: c.stats.tokenized,
    }),
  );
  c.clear();
  t.dispose();
})();
