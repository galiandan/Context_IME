import { Tokenizer } from "../../src/context/tokenizer";
import { INITIAL } from "vscode-textmate";
(async () => {
  const t = new Tokenizer(process.cwd());
  for (const [l, s] of [
    ["javascript", '" '],
    ["javascript", 'print(" '],
    ["cpp", 'R"sql(SELECT "x" FROM t)sql"'],
  ]) {
    const g = await t.grammar(l!);
    console.log(
      l,
      s,
      JSON.stringify(g?.tokenizeLine(s!, INITIAL, 0).tokens, null, 2),
    );
  }
})();
