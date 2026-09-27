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
test("batched disjoint line edits map cached suffix rows and opener identities", async () => {
  const d = new Doc(
    Array.from({ length: 120 }, (_, i) => `v${i} = "text ${i}"`),
  );
  const g = await tokenizer.grammar("python");
  const c = new SemanticCache(d, g);
  const before = new Map<number, string>();
  for (let line = 0; line < d.lineCount; line++)
    before.set(
      line,
      (await reliable(c, line, d.lineAt(line).indexOf("text") + 2)).region,
    );

  // Apply mutations from bottom to top while retaining the edits' common old
  // document coordinates, as VS Code reports a multi-change event.
  d.lines.splice(90, 4, "v90 = \"a\"", "v91 = \"b\"");
  d.lines.splice(50, 1, "v50 = \"a\"", "v51 = \"b\"");
  d.lines.splice(10, 2, "v10 = \"a\"", "v11 = \"b\"", "v12 = \"c\"");
  d.version++;
  c.edit([
    { startLine: 10, endLine: 11, newLines: 2 },
    { startLine: 50, endLine: 50, newLines: 1 },
    { startLine: 90, endLine: 93, newLines: 1 },
  ]);

  for (const [oldLine, region] of before) {
    if ([10, 11, 50, 90, 91, 92, 93].includes(oldLine)) continue;
    const delta =
      Number(oldLine > 11) +
      Number(oldLine > 50) -
      2 * Number(oldLine > 93);
    const newLine = oldLine + delta;
    assert.equal(
      (await reliable(c, newLine, d.lineAt(newLine).indexOf("text") + 2)).region,
      region,
      `old line ${oldLine} -> ${newLine}`,
    );
  }
  const fresh = new SemanticCache(d, g);
  for (let line = 0; line < d.lineCount; line++)
    assert.equal(
      (await reliable(c, line, Math.min(8, d.lineAt(line).length))).kind,
      (await reliable(fresh, line, Math.min(8, d.lineAt(line).length))).kind,
      `line ${line}`,
    );
});
test("multiple old-coordinate newline insertions remap anchors before, at, and after edits", async () => {
  const d = new Doc(
    Array.from({ length: 40 }, (_, i) => `v${i} = "text ${i}"`),
  );
  const c = new SemanticCache(d, await tokenizer.grammar("python"));
  const before = new Map<number, string>();
  for (const line of [4, 5, 8, 10, 12, 30])
    before.set(
      line,
      (await reliable(c, line, d.lineAt(line).indexOf("text") + 2)).region,
    );

  d.lines.splice(10, 0, "");
  d.lines.splice(5, 0, "");
  d.version++;
  c.edit([
    {
      startLine: 5,
      endLine: 5,
      newLines: 1,
      startColumn: 0,
      endColumn: 0,
      newLastColumn: 0,
    },
    {
      startLine: 10,
      endLine: 10,
      newLines: 1,
      startColumn: 0,
      endColumn: 0,
      newLastColumn: 0,
    },
  ]);

  for (const [oldLine, region] of before) {
    const newLine = oldLine + Number(oldLine >= 5) + Number(oldLine >= 10);
    assert.equal(
      (await reliable(c, newLine, d.lineAt(newLine).indexOf("text") + 2)).region,
      region,
      `old line ${oldLine} -> ${newLine}`,
    );
  }
});
test("long regions reuse sparse opener links and keep scan distance bounded", async () => {
  const d = new Doc([
    'value = """',
    ...Array<string>(1000).fill("long prose 世界😀 content"),
    '"""',
  ]);
  const c = new SemanticCache(d, await tokenizer.grammar("python"));
  const first = await reliable(c, 1000, 2);
  const scanAfterFirst = c.stats.regionRowsScanned;
  assert.equal(first.kind, "string");
  assert.ok(scanAfterFirst >= 1000);

  const nextLine = await reliable(c, 999, 2);
  assert.equal(nextLine.region, first.region);
  const afterNextLine = c.stats.regionRowsScanned;
  assert.ok(afterNextLine - scanAfterFirst <= 64);

  const sameLine = await reliable(c, 999, 3);
  assert.equal(sameLine.region, first.region);
  assert.equal(c.stats.regionRowsScanned - afterNextLine, 1);
  assert.ok(c.stats.regionLinkHits >= 2);

  const oldText = d.lineAt(500);
  d.lines[500] = "edited prose";
  d.version++;
  c.edit([
    {
      startLine: 500,
      endLine: 500,
      newLines: 0,
      startColumn: 0,
      endColumn: oldText.length,
      newLastColumn: d.lineAt(500).length,
      text: d.lineAt(500),
    },
  ]);
  const beforeEditQuery = c.stats.regionRowsScanned;
  assert.equal((await reliable(c, 1000, 4)).region, first.region);
  assert.equal(c.stats.regionRowsScanned - beforeEditQuery, 1);
  c.clear();
  assert.equal(c.bytes, 0);
});
test("edited delimiters invalidate region links even when the suffix state converges", async () => {
  const d = new Doc([
    'value = """',
    ...Array<string>(100).fill("long prose"),
    '"""',
  ]);
  const c = new SemanticCache(d, await tokenizer.grammar("python"));
  const before = await reliable(c, 90, 3);
  assert.equal(before.kind, "string");

  const old50 = d.lineAt(50),
    old51 = d.lineAt(51);
  d.lines[50] = '"""';
  d.lines[51] = '"""';
  d.version++;
  c.edit([
    {
      startLine: 50,
      endLine: 50,
      newLines: 0,
      startColumn: 0,
      endColumn: old50.length,
      newLastColumn: 3,
    },
    {
      startLine: 51,
      endLine: 51,
      newLines: 0,
      startColumn: 0,
      endColumn: old51.length,
      newLastColumn: 3,
    },
  ]);

  const after = await reliable(c, 90, 3);
  assert.equal(after.kind, "string");
  assert.notEqual(after.region, before.region);
  assert.equal((await reliable(c, 91, 4)).region, after.region);
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
test("single-line edits retain mapped opener identities without changing other regions", async () => {
  const d = new Doc(
    Array.from({ length: 200 }, (_, i) => `v${i} = "text ${i}"`),
  );
  const c = new SemanticCache(d, await tokenizer.grammar("python"));
  const regions: string[] = [];
  for (let line = 0; line < d.lineCount; line++)
    regions.push((await reliable(c, line, d.lineAt(line).indexOf("text") + 2)).region);

  const line = 100;
  d.lines[line] = `  ${d.lineAt(line)}`;
  d.version++;
  c.edit([
    {
      startLine: line,
      endLine: line,
      startColumn: 0,
      endColumn: 0,
      newLines: 0,
      newLastColumn: 2,
    },
  ]);

  assert.equal(
    (await reliable(c, line, d.lineAt(line).indexOf("text") + 2)).region,
    regions[line],
  );
  assert.equal((await reliable(c, 199, 10)).region, regions[199]);
  c.clear();
  assert.equal(c.bytes, 0);
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
  assert.equal((await c.query(0, 1)).reason, "request-budget");
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

test("position results invalidate and release without accumulating across edits", async () => {
  const d = new Doc(Array(200).fill("value = 123"));
  const c = new SemanticCache(d, await tokenizer.grammar("python"));
  await c.query(199, 2);
  await c.query(10, 2);
  const bytes = c.bytes;
  for (let i = 0; i < 20; i++) {
    d.lines[100] = i % 2 ? "value = 123" : "value = 456";
    d.version++;
    c.edit([{ startLine: 100, endLine: 100, newLines: 0 }]);
    assert.equal((await c.query(199, 2)).kind, "code");
    assert.equal((await c.query(10, 2)).kind, "code");
    assert.equal(c.bytes, bytes);
    const tokenized = c.stats.tokenized;
    await c.query(10, 2);
    assert.equal(c.stats.tokenized, tokenized);
    assert.equal(c.bytes, bytes);
  }
  c.clear();
  assert.equal(c.bytes, 0);
});

for (const [language, open, close, kind] of [
  ["python", 'value = """', '"""', "string"],
  ["javascript", "const value = `", "`;", "string"],
  ["cpp", "/*", "*/", "comment"],
]) {
  test(`${language}: long regions retain distinct opener identities after edits`, async () => {
    const d = new Doc([
      open!,
      ...Array<string>(300).fill("text 世界😀"),
      close!,
      open!,
      "tail",
      close!,
    ]);
    d.languageId = language!;
    const c = new SemanticCache(d, await tokenizer.grammar(language!));
    const first = await c.query(1, 2);
    const tail = await c.query(300, 2);
    const next = await c.query(303, 2);
    assert.equal(tail.kind, kind);
    assert.equal(tail.region, first.region);
    assert.notEqual(next.region, first.region);
    d.lines[150] = "changed text";
    d.version++;
    c.edit([{ startLine: 150, endLine: 150, newLines: 0 }]);
    assert.equal((await c.query(300, 2)).region, first.region);
    assert.equal((await c.query(303, 2)).region, next.region);
  });
}

test("compacted rows retain nested regions and propagate delimiter changes across edits", async () => {
  const { DocumentCache } = await import("../src/context/cache");
  const d = new Doc([
    'value = """',
    ...Array<string>(500).fill("text"),
    '"""',
    'other="tail"',
  ]);
  const g = await tokenizer.grammar("python");
  const c = new DocumentCache(d, g, Infinity, 0, 130000);
  const first = await c.query(1, 2);
  assert.equal((await c.query(500, 2)).region, first.region);
  assert.ok(c.bytes <= 130000);
  const full = new SemanticCache(d, g);
  for (const line of [0, 1, 100, 500, 502])
    assert.equal(
      (await c.query(line, 2)).kind,
      (await full.query(line, 2)).kind,
    );
  d.lines[0] = "value = 123";
  d.lines[501] = "other = 123";
  d.version++;
  c.edit([
    { startLine: 0, endLine: 0, newLines: 0 },
    { startLine: 501, endLine: 501, newLines: 0 },
  ]);
  assert.equal((await c.query(500, 2)).kind, "code");
  d.lines.splice(100, 0, '"""');
  d.version++;
  c.edit([{ startLine: 100, endLine: 100, newLines: 1 }]);
  assert.equal((await c.query(500, 2)).kind, "string");
  const region = (await c.query(500, 2)).region;
  assert.notEqual(region, first.region);
  d.lines.splice(100, 1);
  d.version++;
  c.edit([{ startLine: 100, endLine: 101, newLines: 0 }]);
  assert.equal((await c.query(500, 2)).kind, "code");
  assert.ok(c.bytes <= 130000);
});

test("unreported version change cannot reuse compacted state", async () => {
  const { DocumentCache } = await import("../src/context/cache");
  const d = new Doc(['"""', ...Array<string>(300).fill("text")]);
  const c = new DocumentCache(
    d,
    await tokenizer.grammar("python"),
    Infinity,
    0,
    80000,
  );
  assert.equal((await c.query(300, 2)).kind, "string");
  d.lines[0] = "x=1";
  d.version++;
  assert.equal((await c.query(300, 2)).kind, "code");
});

test("compacted suffix mapping agrees with full tokenization through insert/delete/undo", async () => {
  const { DocumentCache } = await import("../src/context/cache");
  const d = new Doc(Array.from({ length: 80 }, (_, i) => `x${i}="text"`));
  const g = await tokenizer.grammar("python");
  const c = new DocumentCache(d, g, Infinity, 0, 40000);
  await c.query(79, 6);
  assert.ok(c.stats.compacted > 0);
  for (let i = 0; i < 30; i++) {
    const at = 1 + ((i * 17) % 70);
    const original = d.lines[at]!;
    for (const undo of [false, true]) {
      if (undo) d.lines.splice(at, 2, original);
      else d.lines.splice(at, 1, '"""', "# not necessarily a comment");
      d.version++;
      c.edit([
        { startLine: at, endLine: at + (undo ? 2 : 1), newLines: undo ? 1 : 2 },
      ]);
      const fresh = new SemanticCache(d, g);
      for (const line of [
        0,
        at,
        Math.min(at + 3, d.lineCount - 1),
        d.lineCount - 1,
      ]) {
        assert.equal(
          (await c.query(line, 2)).kind,
          (await fresh.query(line, 2)).kind,
          `${i}/${undo}/${line}`,
        );
      }
      assert.ok(c.bytes <= 40000);
    }
  }
  c.clear();
  assert.equal(c.bytes, 0);
});

for (const [language, open, close, kind] of [
  ["javascript", "const x = `", "`;", "string"],
  ["typescript", "const x = `", "`;", "string"],
  ["cpp", 'auto x = R"tag(', ')tag";', "string"],
  ["c", "/*", "*/", "comment"],
]) {
  test(`${language}: compacted opener survives tail queries and inserted prefix`, async () => {
    const { DocumentCache } = await import("../src/context/cache");
    const d = new Doc([
      open!,
      ...Array<string>(350).fill("prose 世界😀 text"),
      close!,
    ]);
    d.languageId = language!;
    const c = new DocumentCache(
      d,
      await tokenizer.grammar(language!),
      Infinity,
      0,
      100000,
    );
    const first = await c.query(1, 2);
    const tail = await c.query(350, 2);
    assert.equal(tail.kind, kind);
    assert.equal(tail.region, first.region);
    assert.ok(c.stats.compacted > 0);
    assert.equal((await c.query(1, 2)).region, first.region);
    d.lines.unshift("x=0;");
    d.version++;
    c.edit([
      {
        startLine: 0,
        endLine: 0,
        newLines: 1,
        startColumn: 0,
        endColumn: 0,
        newLastColumn: 0,
      },
    ]);
    assert.equal((await c.query(351, 2)).region, first.region);
    assert.ok(c.bytes <= 100000);
  });
}
