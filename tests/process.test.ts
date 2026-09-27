import { test } from "node:test";
import assert from "node:assert/strict";
import { ProcessRunner } from "../src/platform/process";
import { source, plan, Adapter } from "../src/platform/adapter";
test("execFile arguments are literal including shell syntax", async () => {
  const r = new ProcessRunner();
  const args = [
    "a b",
    "中文",
    "$(touch /tmp/auto-ime-must-not-exist)",
    "; echo bad",
    '"quoted"',
  ];
  assert.deepEqual(
    JSON.parse(
      await r.run(process.execPath, [
        "-e",
        "console.log(JSON.stringify(process.argv.slice(1)))",
        "--",
        ...args,
      ]),
    ),
    args,
  );
  r.dispose();
});
test("timeout, output cap and failure close child", async () => {
  const r = new ProcessRunner();
  await assert.rejects(
    r.run(process.execPath, ["-e", "setTimeout(()=>{},5000)"], 30),
  );
  await assert.rejects(
    r.run(process.execPath, ["-e", 'process.stdout.write("x".repeat(200000))']),
  );
  await assert.rejects(r.run("/definitely/missing", []));
  r.dispose();
});
test("malformed source and unsupported mode are rejected", () => {
  for (const s of ["", "\n", "x".repeat(1025), undefined])
    assert.throws(() => source(s));
  assert.throws(() => plan({ sourceId: "abc", mode: { open: true } }));
});
test("backend readback, stale request and unknown state", async () => {
  class FakeRunner extends ProcessRunner {
    args: string[][] = [];
    override async run(_f: string, a: readonly string[]) {
      this.args.push([...a]);
      return a.includes("-s") ? "" : "actual";
    }
  }
  const r = new FakeRunner(),
    a = new Adapter("fcitx5", "/usr/bin/fcitx5-remote", r);
  const result = await a.set({ sourceId: "desired" }, () => true);
  assert.equal(result.status, "unverified");
  assert.equal(result.verifiedFields.length, 0);
  await assert.rejects(
    a.set({ sourceId: "x" }, () => false),
    /STALE/,
  );
  assert.deepEqual(r.args[1], ["--check", "-s", "desired"]);
});
test("native malformed JSON, unknown version and empty source fail safely", async () => {
  class FakeRunner extends ProcessRunner {
    constructor(private reply: string) {
      super();
    }
    override async run() {
      return this.reply;
    }
  }
  for (const output of [
    "not json",
    '{"version":2,"sourceId":"abc"}',
    '{"version":1}',
    '{"version":1,"sourceId":""}',
  ]) {
    const a = new Adapter("macos", "/absolute/helper", new FakeRunner(output));
    await assert.rejects(a.get());
  }
});
test("IBus uses engine argv and confirms only observed source", async () => {
  class FakeRunner extends ProcessRunner {
    calls: string[][] = [];
    current = "old";
    override async run(_f: string, args: readonly string[]) {
      this.calls.push([...args]);
      if (args.length === 2) this.current = args[1]!;
      return this.current;
    }
  }
  const r = new FakeRunner(),
    a = new Adapter("ibus", "/usr/bin/ibus", r);
  const result = await a.set({ sourceId: "源 with spaces;$(x)" }, () => true);
  assert.equal(result.status, "confirmed");
  assert.deepEqual(r.calls, [
    ["engine"],
    ["engine", "源 with spaces;$(x)"],
    ["engine"],
  ]);
  assert.equal(result.observed.mode, undefined);
});
test("IBus name-only list and capture fallback", async () => {
  class FakeRunner extends ProcessRunner {
    override async run() {
      return "xkb:us::eng\nlibpinyin\n";
    }
  }
  const a = new Adapter("ibus", "/usr/bin/ibus", new FakeRunner());
  assert.deepEqual(await a.list(), ["xkb:us::eng", "libpinyin"]);
  class MissingList extends ProcessRunner {
    override async run(): Promise<string> {
      throw Error("unsupported option");
    }
  }
  assert.deepEqual(
    await new Adapter("ibus", "/usr/bin/ibus", new MissingList()).list(),
    [],
  );
});
