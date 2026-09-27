import * as vscode from "vscode";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
};
export async function run() {
  const ext = vscode.extensions.getExtension("Galiandan-CIO.vscode-auto-ime");
  assert.ok(ext);
  const api = (await ext.activate()) as {
    diagnosticSnapshot(): {
      set: number;
      processes: number;
      caches: number;
      lastContext?: string;
    };
  };
  const config = vscode.workspace.getConfiguration("autoIme");
  for (const b of ["windows", "macos", "fcitx5", "ibus"])
    for (const role of ["code", "text"])
      assert.deepEqual(config.get(`${b}.${role}`), {});
  const idle: unknown[] = [],
    typing: unknown[] = [];
  // Same isolated Extension Host, activated-but-disabled versus enabled with no source plans.
  // ABBA order reduces (but does not eliminate) startup drift and shared-host noise.
  for (const enabled of [false, true, true, false]) {
    await config.update("enabled", enabled, vscode.ConfigurationTarget.Global);
    await delay(500);
    const document = await vscode.workspace.openTextDocument({
      language: "python",
      content: 'value = "hello world"\n' + "x=1\n".repeat(999),
    });
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(0, 10, 0, 10);
    await vscode.commands.executeCommand("autoIme.resync");
    await delay(2000);
    const before = {
      focused: vscode.window.state.focused,
      memory: process.memoryUsage(),
      snapshot: api.diagnosticSnapshot(),
    };
    let cpu = process.cpuUsage(),
      start = performance.now();
    await delay(10000);
    const elapsed = performance.now() - start,
      used = process.cpuUsage(cpu);
    const after = {
      focused: vscode.window.state.focused,
      memory: process.memoryUsage(),
      snapshot: api.diagnosticSnapshot(),
    };
    idle.push({
      enabled,
      elapsed,
      cpu: used,
      oneCoreCpuPercent: (used.user + used.system) / (elapsed * 10),
      before,
      after,
    });
    const samples: number[] = [];
    const startLength = document.lineAt(0).text.length;
    let focusedSamples = 0;
    cpu = process.cpuUsage();
    start = performance.now();
    for (let i = 0; i < 100; i++) {
      if (vscode.window.state.focused) focusedSamples++;
      const b = performance.now();
      await vscode.commands.executeCommand("type", { text: "a" });
      samples.push(performance.now() - b);
    }
    typing.push({
      enabled,
      latency: summary(samples),
      focusedSamples,
      actualInserted: document.lineAt(0).text.length - startLength,
      validWorkload:
        focusedSamples === 100 &&
        document.lineAt(0).text.length - startLength === 100,
      elapsed: performance.now() - start,
      cpu: process.cpuUsage(cpu),
      snapshot: api.diagnosticSnapshot(),
      memory: process.memoryUsage(),
    });
    assert.equal(api.diagnosticSnapshot().set, 0);
    await vscode.commands.executeCommand(
      "workbench.action.revertAndCloseActiveEditor",
    );
    await delay(200);
    assert.equal(api.diagnosticSnapshot().caches, 0);
  }
  writeFileSync(
    process.env.AUTO_IME_TEST_REPORT!,
    JSON.stringify(
      {
        passed: true,
        vscode: vscode.version,
        node: process.version,
        platform: process.platform,
        extension: ext.packageJSON.version,
        idle,
        typing,
        scope:
          "Isolated profile; built-in extensions share Host. Activated-but-disabled baseline, not uninstalled. No input plans, no OS set. Typing latency includes VS Code IPC/editor work. No forced GC.",
      },
      null,
      2,
    ),
  );
}
