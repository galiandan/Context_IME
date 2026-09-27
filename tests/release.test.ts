import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("release validates exact stable tag and both lock versions before publishing", () => {
  const dir = mkdtempSync(join(tmpdir(), "auto-ime-release-"));
  const pkg = { name: "vscode-auto-ime", version: "1.2.3" };
  const lock = { ...pkg, packages: { "": { ...pkg } } };
  const run = (tag: string, args: string[] = []) =>
    spawnSync(
      process.execPath,
      [resolve("scripts/release-metadata.mjs"), ...args],
      { cwd: dir, env: { ...process.env, RELEASE_TAG: tag }, encoding: "utf8" },
    );
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
    writeFileSync(join(dir, "package-lock.json"), JSON.stringify(lock));
    assert.equal(run("v1.2.3").status, 0);
    for (const tag of [
      "1.2.3",
      "v1.2.4",
      "v01.2.3",
      "v1.2.3-beta",
      "v1.2.3;echo bad",
      "",
    ])
      assert.notEqual(run(tag).status, 0, tag);
    lock.packages[""].version = "1.2.2";
    writeFileSync(join(dir, "package-lock.json"), JSON.stringify(lock));
    assert.notEqual(run("v1.2.3").status, 0);
    lock.packages[""].version = "1.2.3";
    lock.version = "1.2.2";
    writeFileSync(join(dir, "package-lock.json"), JSON.stringify(lock));
    assert.notEqual(run("v1.2.3").status, 0);
    lock.version = "1.2.3";
    writeFileSync(join(dir, "package-lock.json"), JSON.stringify(lock));
    mkdirSync(join(dir, "artifacts/vsix"), { recursive: true });
    assert.match(
      run("v1.2.3", ["--verify-assets"]).stderr,
      /Missing or unexpected/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
