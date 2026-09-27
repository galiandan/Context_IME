import { test } from "node:test";
import assert from "node:assert/strict";
import { Controller } from "../src/core/controller";
const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));
test("same region manual override is retained; explicit resync", async () => {
  const calls: string[] = [];
  const c = new Controller(async (p) => {
    calls.push(p);
  }, 0);
  c.accept("region", "text", () => true);
  await wait();
  c.accept("region", "text", () => true);
  await wait();
  assert.deepEqual(calls, ["text"]);
  c.reset();
  c.accept("region", "text", () => true);
  await wait();
  assert.equal(calls.length, 2);
});
test("serial system requests, newest pending, late process exit", async () => {
  const calls: string[] = [];
  let release: () => void = () => {};
  const c = new Controller(async (p) => {
    calls.push(p);
    if (calls.length === 1)
      await new Promise<void>((r) => {
        release = r;
      });
  }, 0);
  c.accept("a", "text", () => true);
  await wait();
  c.accept("b", "code", () => true);
  c.accept("c", "text", () => true);
  await wait();
  assert.deepEqual(calls, ["text"]);
  release();
  await wait();
  assert.deepEqual(calls, ["text", "text"]);
});
test("focus/disable/editor invalidates pending and stale analysis", async () => {
  const calls: string[] = [];
  const c = new Controller(async (p) => {
    calls.push(p);
  }, 20);
  c.accept("a", "text", () => true);
  c.reset();
  await wait(30);
  assert.equal(calls.length, 0);
  c.accept("b", "code", () => false);
  await wait(30);
  assert.equal(calls.length, 0);
});
test("duplicate event refreshes pending snapshot, late old analysis cannot run", async () => {
  const calls: string[] = [];
  let generation = 1;
  const c = new Controller(async (p) => {
    calls.push(p);
  }, 20);
  c.accept("r", "text", () => generation === 1);
  generation = 2;
  c.accept("r", "text", () => generation === 2);
  await wait(30);
  assert.deepEqual(calls, ["text"]);
  c.accept("old", "code", () => false);
  await wait(30);
  assert.deepEqual(calls, ["text"]);
  c.dispose();
});
test("three backend failures stop automatic requests until reset", async () => {
  let calls = 0;
  const c = new Controller(async () => {
    calls++;
    throw Error("FAIL");
  }, 0);
  for (let i = 0; i < 5; i++) {
    c.accept(String(i), "text", () => true);
    await wait();
  }
  assert.equal(calls, 3);
  assert.equal(c.failures, 3);
  c.reset();
  c.accept("r", "code", () => true);
  await wait();
  assert.equal(calls, 4);
  c.dispose();
});
test("in-flight request survives cancellation but never starts pending compensation", async () => {
  const calls: string[] = [];
  let exit: () => void = () => {};
  const c = new Controller(async (p) => {
    calls.push(p);
    await new Promise<void>((r) => {
      exit = r;
    });
  }, 0);
  c.accept("a", "text", () => true);
  await wait();
  c.accept("b", "code", () => true);
  c.reset();
  exit();
  await wait();
  assert.deepEqual(calls, ["text"]);
});
test("stale pending snapshot does not claim ownership of an unexecuted region", async () => {
  const calls: string[] = [];
  const c = new Controller(async (p) => {
    calls.push(p);
  }, 0);
  c.accept("r", "text", () => false);
  await wait();
  c.accept("r", "text", () => true);
  await wait();
  assert.deepEqual(calls, ["text"]);
  c.dispose();
});

test("cancelled in-flight lookup retains the latest same-region intent", async () => {
  let generation = 1;
  let release!: () => void;
  let requests = 0;
  const applied: string[] = [];
  const c = new Controller(async (target, valid) => {
    if (++requests === 1)
      await new Promise<void>((r) => {
        release = r;
      });
    if (!valid()) throw Error("STALE_REQUEST");
    applied.push(target);
  }, 0);
  c.accept("r", "text", () => generation === 1, true);
  generation++;
  c.cancel();
  c.accept("r", "text", () => generation === 2, true);
  release();
  await c.idle();
  assert.deepEqual(applied, ["text"]);
  assert.equal(requests, 2);
  c.cancel();
  c.accept("r", "text", () => true, true);
  await c.idle();
  assert.equal(
    requests,
    2,
    "successful ownership survives typing/manual override",
  );
  c.dispose();
});

test("same-region movement refreshes an in-flight snapshot without concurrent work", async () => {
  let generation = 1;
  let release!: () => void;
  let requests = 0;
  let applied = 0;
  const c = new Controller(async (_target, valid) => {
    if (++requests === 1)
      await new Promise<void>((r) => {
        release = r;
      });
    if (valid()) applied++;
  }, 0);
  c.accept("r", "text", () => generation === 1, true);
  generation++;
  c.accept("r", "text", () => generation === 2, true);
  release();
  await c.idle();
  assert.equal(applied, 1);
  assert.equal(requests, 2);
  c.dispose();
});

test("duplicate still-valid in-flight requests are applied only once", async () => {
  let release!: () => void;
  let calls = 0;
  const c = new Controller(async () => {
    calls++;
    await new Promise<void>((r) => {
      release = r;
    });
  }, 0);
  c.accept("r", "text", () => true, true);
  c.accept("r", "text", () => true, true);
  release();
  await c.idle();
  assert.equal(calls, 1);
  c.dispose();
});
