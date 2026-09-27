import { test } from "node:test";
import assert from "node:assert/strict";
import { Tokenizer } from "../src/context/tokenizer";
import { DocumentCache } from "../src/context/cache";
import type { Kind } from "../src/context/classifier";
const tokenizer = new Tokenizer(process.cwd());
const fixtures: [string, Kind][] = [
  ["#include |<iostream>", "code"],
  ["#include <|iostream>", "code"],
  ["#include <io|stream>", "code"],
  ["#include <iostream|>", "code"],
  ["#include <iostream>|", "code"],
  ["#include <|>", "code"],
  ["#include <|", "code"],
  ["#include <vec|", "code"],
  ['#include "|local.h"', "code"],
  ['#include "local|.h"', "code"],
  ['#include "local.h|"', "code"],
  ['#include "local.h"|', "code"],
  ['#include "|"', "code"],
  ['#include "|', "code"],
  ['#include "local|', "code"],
  ["  # include <sys/ty|pes.h>", "code"],
  ["#include <stdio.h>\r\n|", "code"],
  ["#include <stdio.h> // 中文|", "comment"],
  ['#include "local.h" /* 中文| */', "comment"],
  ["// #include <vec|tor>", "comment"],
  ['/* #include "local|.h" */', "comment"],
  ['const char *s = "hello|";', "string"],
  ['#define MESSAGE "hello|"', "string"],
  ["if (a < b|) {}", "code"],
];
for (const languageId of ["c", "cpp"]) {
  for (const [marked, expected] of fixtures)
    test(`${languageId} header ${JSON.stringify(marked)}`, async () => {
      const before = marked.slice(0, marked.indexOf("|")).split(/\r?\n/);
      const lines = marked.replace("|", "").split(/\r?\n/);
      const cache = new DocumentCache(
        {
          version: 1,
          languageId,
          lineCount: lines.length,
          lineAt: (n) => lines[n]!,
        },
        await tokenizer.grammar(languageId),
      );
      let result = await cache.query(before.length - 1, before.at(-1)!.length);
      for (let retry = 0; result.kind === "unknown" && retry < 4; retry++)
        result = await cache.query(before.length - 1, before.at(-1)!.length);
      assert.equal(result.kind, expected);
    });
  test(`${languageId} incremental typing of header never enters text region`, async () => {
    let text = "#include ",
      version = 1;
    const cache = new DocumentCache(
      {
        get version() {
          return version;
        },
        languageId,
        lineCount: 1,
        lineAt: () => text,
      },
      await tokenizer.grammar(languageId),
    );
    for (const char of "<vector>") {
      const column = text.length;
      text += char;
      version++;
      cache.edit([
        {
          startLine: 0,
          endLine: 0,
          startColumn: column,
          endColumn: column,
          newLines: 0,
          newLastColumn: column + 1,
        },
      ]);
      let result = await cache.query(0, text.length);
      for (let retry = 0; result.kind === "unknown" && retry < 4; retry++)
        result = await cache.query(0, text.length);
      assert.equal(result.kind, "code", text);
      assert.equal(result.region, "code");
    }
  });
}
