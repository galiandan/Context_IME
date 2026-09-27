import { SemanticCache } from "./semanticCache";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Tokenizer } from "../src/context/tokenizer";
import {
  type DocumentCache,
  type DocumentView,
  type Edit,
} from "../src/context/cache";
class Doc implements DocumentView {
  version = 1;
  languageId = "python";
  constructor(public lines: string[]) {}
  get lineCount() {
    return this.lines.length;
  }
  lineAt(n: number) {
    return this.lines[n]!;
  }
}
const tokenizer = new Tokenizer(process.cwd());
async function reliable(c: DocumentCache, line: number, col: number) {
  let r = await c.query(line, col);
  for (let i = 0; r.kind === "unknown" && i < 4; i++)
    r = await c.query(line, col);
  return r;
}
test("multiple old-snapshot ranges, undo/redo, insertion and deletion", async () => {
  const d = new Doc(["a=1", "b=2", "c=3", "d=4", "e=5", "f=6"]);
  const g = await tokenizer.grammar("python"),
    c = new SemanticCache(d, g);
  await reliable(c, 5, 1);
  const snapshots = [
    ["a=1", '"""', "c=3", "d=4", '"""', "f=6"],
    ["a=1", "b=2", "c=3", "d=4", "e=5", "f=6"],
  ];
  for (const lines of [...snapshots, ...snapshots]) {
    d.lines = lines;
    d.version++;
    c.edit([
      { startLine: 1, endLine: 1, newLines: 0 },
      { startLine: 4, endLine: 4, newLines: 0 },
    ]);
    const baseline = new SemanticCache(d, g);
    for (let n = 0; n < d.lineCount; n++)
      assert.equal(
        (await reliable(c, n, 1)).kind,
        (await reliable(baseline, n, 1)).kind,
      );
  }
  d.lines.splice(1, 2, "new=1");
  d.version++;
  c.edit([{ startLine: 1, endLine: 3, newLines: 1 }]);
  const baseline = new SemanticCache(d, g);
  assert.equal(
    (await reliable(c, 3, 1)).kind,
    (await reliable(baseline, 3, 1)).kind,
  );
});
test("seeded edits agree with full tokenization including delimiter propagation", async () => {
  const d = new Doc(Array.from({ length: 60 }, (_, i) => `v${i}="hello"`));
  const g = await tokenizer.grammar("python"),
    c = new SemanticCache(d, g);
  let seed = 42;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed;
  };
  for (let i = 0; i < 100; i++) {
    const n = random() % (d.lineCount - 1);
    const count = random() % 3;
    const inserts = ['"""', "# comment", 'value="中😀"'].slice(0, count);
    d.lines.splice(n, 1, ...inserts);
    if (!d.lines.length) d.lines = [""];
    d.version++;
    const edit: Edit = {
      startLine: n,
      endLine: Math.min(n + 1, d.lineCount),
      newLines: count,
    };
    c.edit([edit]);
    const full = new SemanticCache(d, g);
    for (const line of [0, Math.floor(d.lineCount / 2), d.lineCount - 1])
      assert.equal(
        (await reliable(c, line, Math.min(2, d.lineAt(line).length))).kind,
        (await reliable(full, line, Math.min(2, d.lineAt(line).length))).kind,
        `edit ${i} line ${line}`,
      );
  }
});
test("stable identity after earlier insertions and interior typing; nested templates", async () => {
  const d = new Doc(["x=0", 'value="hello"']);
  const g = await tokenizer.grammar("python"),
    c = new SemanticCache(d, g);
  const a = await reliable(c, 1, 9);
  d.lines[1] = 'value="h中ello"';
  d.version++;
  c.edit([
    {
      startLine: 1,
      endLine: 1,
      startColumn: 8,
      endColumn: 8,
      newLines: 0,
      newLastColumn: 9,
    },
  ]);
  assert.equal((await reliable(c, 1, 10)).region, a.region);
  d.lines.unshift("y=0");
  d.version++;
  c.edit([
    {
      startLine: 0,
      endLine: 0,
      startColumn: 0,
      endColumn: 0,
      newLines: 1,
      newLastColumn: 0,
    },
  ]);
  assert.equal((await reliable(c, 2, 10)).region, a.region);
  const js = new Doc(['`a ${"b"} c`']);
  js.languageId = "javascript";
  const jc = new SemanticCache(js, await tokenizer.grammar("javascript"));
  assert.equal(
    (await reliable(jc, 0, 2)).region,
    (await reliable(jc, 0, 11)).region,
  );
  assert.notEqual(
    (await reliable(jc, 0, 2)).region,
    (await reliable(jc, 0, 7)).region,
  );
});
test("cancel cold batches and release bounded cache", async () => {
  const d = new Doc(Array(1000).fill("x=1"));
  const c = new SemanticCache(d, await tokenizer.grammar("python"));
  let alive = true;
  setImmediate(() => {
    alive = false;
  });
  assert.equal((await c.query(999, 1, () => alive)).kind, "unknown");
  assert.ok(c.stats.tokenized < 1000);
  c.clear();
  assert.equal(c.bytes, 0);
});
test("stoppedEarly never becomes a trustworthy predecessor", async () => {
  const real = await tokenizer.grammar("python");
  assert.ok(real);
  const stopped = Object.create(real) as typeof real;
  stopped.tokenizeLine = () => ({
    tokens: [],
    ruleStack: undefined as never,
    stoppedEarly: true,
  });
  const c = new SemanticCache(new Doc(['"""', "text"]), stopped);
  assert.equal((await c.query(1, 1)).kind, "unknown");
  assert.equal(c.stats.tokenized, 1);
  assert.equal(c.bytes, 0);
});
test("unsupported grammar and request budget preserve unknown", async () => {
  const d = new Doc(["x=1"]);
  assert.equal((await new SemanticCache(d).query(0, 1)).kind, "unknown");
  const c = new SemanticCache(d, await tokenizer.grammar("python"), 0);
  assert.equal((await c.query(0, 1)).kind, "unknown");
  assert.equal((await c.query(0, 1)).kind, "code");
});
test("same-line multiple edits use old columns in descending application order", async () => {
  const d = new Doc(['value="hello"']);
  const c = new SemanticCache(d, await tokenizer.grammar("python"));
  const before = await reliable(c, 0, 9);
  d.lines[0] = 'xxvalue="中hello"';
  d.version++;
  c.edit([
    {
      startLine: 0,
      endLine: 0,
      startColumn: 7,
      endColumn: 7,
      newLines: 0,
      newLastColumn: 8,
    },
    {
      startLine: 0,
      endLine: 0,
      startColumn: 0,
      endColumn: 0,
      newLines: 0,
      newLastColumn: 2,
    },
  ]);
  assert.equal((await reliable(c, 0, 11)).region, before.region);
});
