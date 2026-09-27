import * as vscode from "vscode";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
export async function run() {
  const extension = vscode.extensions.getExtension(
    "Galiandan-CIO.vscode-auto-ime",
  );
  assert.ok(extension);
  const api = (await extension.activate()) as {
    diagnosticSnapshot: () => {
      set: number;
      caches: number;
      paused: boolean;
      pauseReason?: string;
      lastContext?: string;
    };
  };
  assert.ok(extension.isActive);
  assert.equal(extension.extensionKind, vscode.ExtensionKind.UI);
  const commands = await vscode.commands.getCommands(true);
  for (const c of ["toggle", "setup", "resync", "diagnostics"])
    assert.ok(commands.includes("autoIme." + c));
  // Isolated test profile has no source plans; these tests can never request a source change.
  const config = vscode.workspace.getConfiguration("autoIme");
  for (const b of ["windows", "macos", "fcitx5", "ibus"])
    for (const role of ["code", "text"])
      assert.deepEqual(config.get(b + "." + role), {});
  const document = await vscode.workspace.openTextDocument({
    language: "python",
    content: 'print("hello")\nvalue=1',
  });
  let editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 8, 0, 8);
  await vscode.commands.executeCommand("autoIme.resync");
  // Record real editor events without configuring any input source.
  const newlineEvents: unknown[] = [];
  const commentDoc = await vscode.workspace.openTextDocument({
    language: "python",
    content: "# hello",
  });
  const commentEditor = await vscode.window.showTextDocument(commentDoc);
  commentEditor.selection = new vscode.Selection(0, 7, 0, 7);
  await vscode.commands.executeCommand("autoIme.resync");
  assert.equal(api.diagnosticSnapshot().lastContext, "comment");
  const selectionListener = vscode.window.onDidChangeTextEditorSelection(
    (e) => {
      if (e.textEditor === commentEditor)
        newlineEvents.push({
          event: "selection",
          kind: e.kind,
          line: e.selections[0]?.active.line,
          column: e.selections[0]?.active.character,
        });
    },
  );
  const changeListener = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document === commentDoc)
      newlineEvents.push({ event: "change", version: e.document.version });
  });
  await vscode.commands.executeCommand("type", { text: "\n" });
  await new Promise((r) => setTimeout(r, 100));
  newlineEvents.push({
    event: "after-enter",
    snapshot: api.diagnosticSnapshot(),
  });
  assert.equal(
    api.diagnosticSnapshot().lastContext,
    "code",
    "Enter must analyze the blank code line before typing a letter",
  );
  await vscode.commands.executeCommand("type", { text: "a" });
  await new Promise((r) => setTimeout(r, 100));
  selectionListener.dispose();
  changeListener.dispose();
  writeFileSync(
    process.env.AUTO_IME_TEST_REPORT!.replace(
      "integration.json",
      "newline-events.json",
    ),
    JSON.stringify(newlineEvents, null, 2),
  );
  editor = await vscode.window.showTextDocument(document);
  editor.selections = [
    new vscode.Selection(0, 2, 0, 2),
    new vscode.Selection(1, 2, 1, 2),
  ];
  await vscode.commands.executeCommand("autoIme.resync");
  assert.equal(api.diagnosticSnapshot().pauseReason, "多光标时暂停");
  editor.selections = [new vscode.Selection(0, 0, 0, 5)];
  await vscode.commands.executeCommand("autoIme.resync");
  assert.equal(api.diagnosticSnapshot().paused, true);
  assert.equal(api.diagnosticSnapshot().pauseReason, "非空选区时暂停");
  const large = await vscode.workspace.openTextDocument({
    language: "python",
    content: "x".repeat(1024 * 1024 + 1),
  });
  await vscode.window.showTextDocument(large);
  await vscode.commands.executeCommand("autoIme.resync");
  assert.equal(api.diagnosticSnapshot().paused, true);
  assert.equal(api.diagnosticSnapshot().pauseReason, "文件超过大小限制");
  const header = await vscode.workspace.openTextDocument({
    language: "cpp",
    content: "#include <iostream>",
  });
  const headerEditor = await vscode.window.showTextDocument(header);
  headerEditor.selection = new vscode.Selection(0, 10, 0, 10);
  for (let attempt = 0; attempt < 4; attempt++) {
    await vscode.commands.executeCommand("autoIme.resync");
    if (api.diagnosticSnapshot().lastContext === "code") break;
  }
  assert.equal(
    api.diagnosticSnapshot().lastContext,
    "code",
    "C++ header path uses code",
  );
  const unknown = await vscode.workspace.openTextDocument({
    language: "plaintext",
    content: "hello",
  });
  await vscode.window.showTextDocument(unknown);
  await vscode.commands.executeCommand("autoIme.resync");
  assert.equal(api.diagnosticSnapshot().pauseReason, "不支持当前语言");
  await vscode.commands.executeCommand("autoIme.diagnostics");
  assert.equal(api.diagnosticSnapshot().set, 0);
  writeFileSync(
    process.env.AUTO_IME_TEST_REPORT ?? "artifacts/reports/integration.json",
    JSON.stringify(
      {
        passed: true,
        extensionPath: extension.extensionPath,
        vscode: vscode.version,
        extensionKind: extension.extensionKind,
        platform: process.platform,
        checks: [
          "activation",
          "commands",
          "UI declaration",
          "unconfigured resync",
          "multiple selections",
          "unsupported language",
          "nonempty selection",
          "oversized document",
          "zero source settings",
          "C++ include header stays code",
          "Enter without Keyboard kind analyzes code before first letter",
          "diagnostics",
        ],
        nativeSwitching: false,
      },
      null,
      2,
    ),
  );
}
