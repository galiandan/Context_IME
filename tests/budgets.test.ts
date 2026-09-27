import { test } from "node:test";
import assert from "node:assert/strict";
import { INITIAL, type IGrammar } from "vscode-textmate";
import { DocumentCache } from "../src/context/cache";

function fixture(stopped = false) {
  const limits: number[] = [];
  const grammar = {
    tokenizeLine(text: string, _state: unknown, limit: number) {
      limits.push(limit);
      return {
        stoppedEarly: stopped,
        ruleStack: INITIAL,
        tokens: [
          { startIndex: 0, endIndex: text.length, scopes: ["source.python"] },
        ],
      };
    },
  } as unknown as IGrammar;
  const doc = {
    version: 1,
    languageId: "python",
    lineCount: 100,
    lineAt: () => "abc",
  };
  return { doc, grammar, limits };
}

test("production line and insertion probes retain the 5ms budget", async () => {
  const { doc, grammar, limits } = fixture();
  const c = new DocumentCache(
    doc,
    grammar,
    undefined,
    undefined,
    undefined,
    () => 0,
  );
  assert.equal((await c.query(0, 0)).kind, "code");
  assert.deepEqual(limits, [5, 5]);
});

test("budget exhaustion keeps the trusted prefix queryable", async () => {
  const { doc, grammar } = fixture();
  const c = new DocumentCache(doc, grammar, Infinity, 5, 1024);
  assert.equal((await c.query(99, 1)).reason, "cache-limit");
  const tokenized = c.stats.tokenized;
  assert.equal((await c.query(0, 1)).kind, "code");
  assert.equal(c.stats.tokenized, tokenized);
  assert.ok(c.bytes <= 1024);
  c.clear();
  assert.equal(c.bytes, 0);
});

test("typing invalidates classification bytes without accumulating phantom memory", async () => {
  const { doc, grammar } = fixture();
  const c = new DocumentCache(doc, grammar, Infinity);
  await c.query(99, 1);
  const bytes = c.bytes;
  for (let i = 0; i < 100; i++) {
    doc.version++;
    c.edit([{ startLine: 99, endLine: 99, newLines: 0 }]);
    await c.query(99, 1);
    assert.equal(c.bytes, bytes);
  }
  assert.equal(c.stats.tokenized, 200);
});

test("stopped tokenization reports unknown without retaining an input stack", async () => {
  const { doc, grammar } = fixture(true);
  const c = new DocumentCache(
    doc,
    grammar,
    undefined,
    undefined,
    undefined,
    () => 0,
  );
  assert.equal((await c.query(1, 1)).reason, "tokenizer-timeout");
  assert.equal(c.stats.tokenized, 2);
  assert.equal(c.bytes, 0);
});

test("a stopped boundary probe reports its reason and is never cached", async () => {
  const { doc, grammar } = fixture();
  const original = grammar.tokenizeLine.bind(grammar);
  grammar.tokenizeLine = (...args) =>
    args[0].length > 3
      ? { tokens: [], ruleStack: INITIAL, stoppedEarly: true }
      : original(...args);
  const c = new DocumentCache(
    doc,
    grammar,
    undefined,
    undefined,
    undefined,
    () => 0,
  );
  assert.equal((await c.query(0, 0)).reason, "tokenizer-timeout");
  assert.equal((await c.query(0, 1)).kind, "code");
});

test("one bounded retry yields and recovers a cold tokenizer", async () => {
  const { doc, grammar } = fixture();
  const original = grammar.tokenizeLine.bind(grammar);
  let calls = 0;
  let yielded = false;
  setImmediate(() => {
    yielded = true;
  });
  grammar.tokenizeLine = (...args) =>
    ++calls === 1
      ? { tokens: [], ruleStack: INITIAL, stoppedEarly: true }
      : original(...args);
  const c = new DocumentCache(
    doc,
    grammar,
    undefined,
    undefined,
    undefined,
    () => 0,
  );
  assert.equal((await c.query(0, 1)).kind, "code");
  assert.equal(calls, 2);
  assert.equal(yielded, true);
});

test("cold retry is cancelled when focus or snapshot becomes invalid", async () => {
  const { doc, grammar } = fixture(true);
  let alive = true;
  setImmediate(() => {
    alive = false;
  });
  const c = new DocumentCache(
    doc,
    grammar,
    undefined,
    undefined,
    undefined,
    () => 0,
  );
  assert.equal((await c.query(0, 1, () => alive)).reason, "cancelled");
  assert.equal(c.stats.tokenized, 1);
});

test("100ms production request budget prevents a late retry", async () => {
  const { doc, grammar } = fixture(true);
  let now = 0;
  const original = grammar.tokenizeLine.bind(grammar);
  grammar.tokenizeLine = (...args) => {
    now = 101;
    return original(...args);
  };
  const c = new DocumentCache(
    doc,
    grammar,
    undefined,
    undefined,
    undefined,
    () => now,
  );
  assert.equal((await c.query(0, 1)).reason, "request-budget");
  assert.equal(c.stats.tokenized, 1);
  assert.equal(c.bytes, 0);
});
