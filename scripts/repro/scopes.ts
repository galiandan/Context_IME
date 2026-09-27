import { Tokenizer } from "../../src/context/tokenizer";
import { INITIAL } from "vscode-textmate";
(async () => {
  const t = new Tokenizer(process.cwd());
  for (const [lang, text] of [
    ["python", "f\"{len('x')}\""],
    ["typescript", "`a ${x} z`"],
    ["javascript", "const x=/[\"']/g"],
  ]) {
    const g = await t.grammar(lang!);
    console.log(
      lang,
      JSON.stringify(g?.tokenizeLine(text!, INITIAL, 0).tokens, null, 2),
    );
  }
})();
