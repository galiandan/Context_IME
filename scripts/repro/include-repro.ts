import { Tokenizer } from "../../src/context/tokenizer";
import { INITIAL } from "vscode-textmate";
(async () => {
  const t = new Tokenizer(process.cwd());
  for (const language of ["c", "cpp"]) {
    const g = await t.grammar(language);
    for (const text of [
      "#include <iostream>",
      '#include "local.h"',
      "#include <",
      '#include "',
      "#include /* hi */ <stdio.h>",
      "#include <stdio.h> // hi",
      '#define NAME "hello"',
      "#if __has_include(<vector>)",
    ])
      console.log(
        JSON.stringify({
          language,
          text,
          tokens: g?.tokenizeLine(text, INITIAL, 0).tokens,
        }),
      );
  }
  t.dispose();
})();
