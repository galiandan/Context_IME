import { test } from "node:test";
import assert from "node:assert/strict";
import { NewlineInteraction } from "../src/core/newlineInteraction";
import { Controller } from "../src/core/controller";
import { Tokenizer } from "../src/context/tokenizer";
import { DocumentCache } from "../src/context/cache";
const point = { line: 0, character: 7 };
const change = { range: { start: point, end: point }, text: "\n" };
test("Enter unknown-kind selection is accepted only for the paired editor/version/destination", () => {
  const gate = new NewlineInteraction(),
    editor = {};
  gate.note(editor, 1, point);
  gate.change(editor, 2, [change], true, undefined);
  assert.equal(
    gate.consume(editor, 2, { line: 1, character: 0 }, undefined),
    true,
  );
  assert.equal(
    gate.consume(editor, 2, { line: 1, character: 0 }, undefined),
    false,
  );
});
test("background edits, lost focus, undo, API movement and arbitrary unknown selections are rejected", () => {
  const editor = {};
  for (const scenario of [
    "background",
    "focus",
    "undo",
    "api",
    "version",
    "position",
    "reset",
    "no-grant",
  ]) {
    const gate = new NewlineInteraction();
    if (scenario !== "no-grant") gate.note(editor, 1, point);
    gate.change(
      scenario === "background" ? {} : editor,
      2,
      [change],
      scenario !== "focus",
      scenario === "undo" ? 1 : undefined,
    );
    if (scenario === "reset") gate.reset();
    assert.equal(
      gate.consume(
        editor,
        scenario === "version" ? 3 : 2,
        { line: 1, character: scenario === "position" ? 1 : 0 },
        scenario === "api" ? 3 : undefined,
      ),
      false,
      scenario,
    );
  }
});
test("CRLF indentation correlates; pasted code and multiple changes do not", () => {
  const editor = {},
    gate = new NewlineInteraction();
  gate.note(editor, 1, point);
  gate.change(editor, 2, [{ ...change, text: "\r\n    " }], true, undefined);
  assert.equal(
    gate.consume(editor, 2, { line: 1, character: 4 }, undefined),
    true,
  );
  for (const changes of [
    [{ ...change, text: "\nprint(1)" }],
    [change, change],
  ]) {
    gate.note(editor, 1, point);
    gate.change(editor, 2, changes, true, undefined);
    assert.equal(
      gate.consume(editor, 2, { line: 1, character: 0 }, undefined),
      false,
    );
  }
});
test("comment Enter classifies blank line as code and dispatches before any letter or debounce timer", async () => {
  const tokenizer = new Tokenizer(process.cwd());
  const grammar = await tokenizer.grammar("python");
  let version = 1;
  const lines = ["# hello"];
  const cache = new DocumentCache(
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
    grammar,
  );
  for (let i = 0; i < 4; i++) {
    const r = await cache.query(0, 7);
    if (r.kind === "comment") break;
  }
  const requests: string[] = [];
  const controller = new Controller(async (target) => {
    requests.push(target);
  }, 100);
  controller.accept("comment", "text", () => true, true);
  await controller.idle();
  lines.push("");
  version++;
  cache.edit([
    {
      startLine: 0,
      endLine: 0,
      startColumn: 7,
      endColumn: 7,
      newLines: 1,
      newLastColumn: 0,
    },
  ]);
  const result = await cache.query(1, 0);
  assert.equal(result.kind, "code");
  controller.accept(result.region, "code", () => true, true);
  assert.deepEqual(requests, ["text", "code"]);
  await controller.idle();
  controller.dispose();
  tokenizer.dispose();
});
test("immediate code replaces delayed text but still waits for the running process", async () => {
  const calls: string[] = [];
  let release: () => void = () => {};
  const controller = new Controller(async (target) => {
    calls.push(target);
    if (target === "running")
      await new Promise<void>((r) => {
        release = r;
      });
  }, 100);
  controller.accept("a", "text", () => true);
  controller.accept("b", "code", () => true, true);
  assert.deepEqual(calls, ["code"]);
  await controller.idle();
  controller.accept("c", "running", () => true, true);
  controller.accept("d", "text", () => true);
  controller.accept("e", "code", () => true, true);
  assert.deepEqual(calls, ["code", "running"]);
  release();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, ["code", "running", "code"]);
  controller.dispose();
});
test("immediate code cannot bypass focus/snapshot validation", () => {
  let calls = 0;
  const controller = new Controller(async () => {
    calls++;
  }, 100);
  controller.accept("a", "code", () => false, true);
  assert.equal(calls, 0);
  controller.dispose();
});
