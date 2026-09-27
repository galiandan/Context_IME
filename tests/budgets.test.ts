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
  assert.equal(c.stats.tokenized, tokenized + 1);
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

test("evicts token payloads, restores only the requested line from trusted state", async () => {
  const { doc, grammar } = fixture();
  const c = new DocumentCache(doc, grammar, Infinity, 5, 24000);
  assert.equal((await c.query(99, 1)).kind, "code");
  assert.ok(c.bytes <= 24000);
  const before = c.stats.tokenized;
  assert.equal((await c.query(0, 1)).kind, "code");
  assert.equal(c.stats.tokenized, before + 1);
  assert.ok(c.bytes <= 24000);
  assert.equal((await c.query(99, 1)).kind, "code");
  c.clear();
  assert.equal(c.bytes, 0);
});

test("cold compilation progress permits at most three shared retries with unchanged limits", async () => {
  const { grammarCompilation } = await import("../src/context/tokenizer");
  for (const stoppedCalls of [2, 99]) {
    const { doc, grammar, limits } = fixture();
    const activity = { scanners: 0 };
    grammarCompilation.set(grammar, activity);
    const original = grammar.tokenizeLine.bind(grammar);
    let calls = 0;
    grammar.tokenizeLine = (...args) => {
      calls++;
      activity.scanners++;
      const result = original(...args);
      return { ...result, stoppedEarly: calls <= stoppedCalls };
    };
    const c = new DocumentCache(doc, grammar, 100, 5, undefined, () => 0);
    assert.equal(
      (await c.query(0, 1)).kind,
      stoppedCalls === 2 ? "code" : "unknown",
    );
    assert.equal(calls, stoppedCalls === 2 ? 3 : 4);
    assert.ok(limits.every((limit) => limit === 5));
  }
});

test("extra cold retries stop on compilation stall or cancellation", async () => {
  const { grammarCompilation } = await import("../src/context/tokenizer");
  for (const cancel of [false, true]) {
    const { doc, grammar } = fixture(true);
    const activity = { scanners: 0 };
    grammarCompilation.set(grammar, activity);
    const original = grammar.tokenizeLine.bind(grammar);
    let calls = 0,
      alive = true;
    grammar.tokenizeLine = (...args) => {
      calls++;
      if (cancel || calls === 1) activity.scanners++;
      if (cancel && calls === 2)
        setImmediate(() => {
          alive = false;
        });
      return original(...args);
    };
    const c = new DocumentCache(doc, grammar, 100, 5, undefined, () => 0);
    assert.equal(
      (await c.query(0, 1, () => alive)).reason,
      cancel ? "cancelled" : "tokenizer-timeout",
    );
    assert.equal(calls, 2);
  }
});

test("line and insertion share cold retry allowance and the request deadline", async () => {
  const { grammarCompilation } = await import("../src/context/tokenizer");
  const { doc, grammar } = fixture();
  const activity = { scanners: 0 };
  grammarCompilation.set(grammar, activity);
  const original = grammar.tokenizeLine.bind(grammar);
  let calls = 0;
  grammar.tokenizeLine = (...args) => {
    calls++;
    activity.scanners++;
    return { ...original(...args), stoppedEarly: calls !== 3 };
  };
  const c = new DocumentCache(doc, grammar, 100, 5, undefined, () => 0);
  assert.equal((await c.query(0, 0)).reason, "tokenizer-timeout");
  assert.equal(calls, 5); // 3 line attempts, then 2 insertion attempts; 3 retries total.
});

test("boundary retry survives another query compacting its row during the yield", async () => {
  const { doc, grammar } = fixture();
  const original = grammar.tokenizeLine.bind(grammar);
  let probeCalls = 0;
  grammar.tokenizeLine = (...args) => {
    const result = original(...args);
    return {
      ...result,
      stoppedEarly: args[0].length === 4 && ++probeCalls === 1,
    };
  };
  const c = new DocumentCache(doc, grammar, 100, 5, 24000, () => 0);
  const other = new Promise<void>((resolve, reject) =>
    setImmediate(() => {
      c.query(99, 1)
        .then((result) => {
          assert.equal(result.kind, "code");
          resolve();
        })
        .catch(reject);
    }),
  );
  assert.equal((await c.query(0, 0)).kind, "code");
  await other;
  assert.ok(c.stats.compacted > 0);
  assert.ok(c.bytes <= 24000);
});
