import * as vscode from "vscode";
import { Tokenizer, languages } from "./context/tokenizer";
import { DocumentCache } from "./context/cache";
import { NewlineInteraction } from "./core/newlineInteraction";
import { Controller } from "./core/controller";
import { Adapter, createAdapter, plan, type Plan } from "./platform/adapter";
import { ProcessRunner } from "./platform/process";
export function activate(context: vscode.ExtensionContext) {
  const tokenizer = new Tokenizer(context.extensionPath),
    runner = new ProcessRunner();
  const caches = new Map<string, DocumentCache>();
  const newlineInteraction = new NewlineInteraction();
  let lastContext: string | undefined;
  let generation = 0,
    backendEpoch = 0,
    setup = false,
    adapter: Adapter | undefined,
    adapterPromise: Promise<Adapter> | undefined;
  let lastError = "",
    paused = true,
    disposed = false;
  const errors = new Map<string, number>();
  const log: string[] = [];
  const output = vscode.window.createOutputChannel("Context IME");
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    50,
  );
  status.command = "autoIme.toggle";
  status.show();
  function setting<T>(
    key: string,
    fallback: T,
    local = false,
    doc?: vscode.TextDocument,
  ): T {
    const config = vscode.workspace.getConfiguration(
      "autoIme",
      doc ? { uri: doc.uri, languageId: doc.languageId } : undefined,
    );
    if (local || !vscode.workspace.isTrusted) {
      const i = config.inspect<T>(key);
      return (
        i?.globalLanguageValue ?? i?.globalValue ?? i?.defaultValue ?? fallback
      );
    }
    return config.get<T>(key, fallback);
  }
  function configured(): boolean {
    const b =
      adapter?.backend ??
      (process.platform === "win32"
        ? "windows"
        : process.platform === "darwin"
          ? "macos"
          : setting("backend", "auto", true));
    try {
      return !!readPlan(b, "code") && !!readPlan(b, "text");
    } catch {
      return false;
    }
  }
  function readPlan(b: string, role: string): Plan | undefined {
    const value = setting<Record<string, unknown>>(b + "." + role, {}, true);
    return Object.keys(value).length ? plan(value) : undefined;
  }
  function report(e: unknown) {
    const message = e instanceof Error ? e.message : "INTERNAL_ERROR";
    lastError = message;
    if (errors.size < 128 || errors.has(message))
      errors.set(message, (errors.get(message) ?? 0) + 1);
    if (setting("debug", false)) {
      log.push(`${new Date().toISOString()} ${message}`);
      while (log.length > 256 || log.join("\n").length > 32768) log.shift();
    }
    render();
  }
  function render() {
    status.text = `$(keyboard) IME · ${!setting("enabled", true) ? "停用" : setup ? "暂停" : lastError || controller.error ? "后端错误" : !configured() ? "待配置" : paused ? "暂停" : "自动"}`;
    status.tooltip = `Context IME（规则状态，并非实时输入法）\n期望：${controller.desired ? "已配置方案" : "无"}\n最近请求：${controller.lastRequest ? "已发送" : "无"}\n最近观测：${adapter?.observed ? new Date(adapter.observed.observedAt).toISOString() : "无"}\n确认范围：仅输入源；内部模式未知\n点击启用/停用`;
  }
  async function backend() {
    if (adapter) return adapter;
    const epoch = backendEpoch;
    adapterPromise ??= createAdapter(
      context.extensionPath,
      setting("backend", "auto", true),
      runner,
    );
    try {
      const result = await adapterPromise;
      if (epoch !== backendEpoch || disposed) throw new Error("STALE_REQUEST");
      adapter = result;
      return result;
    } catch (e) {
      if (epoch === backendEpoch) adapterPromise = undefined;
      throw e;
    }
  }
  const controller = new Controller(
    async (serialized, valid) => {
      const target = JSON.parse(serialized) as { backend: string; plan: Plan };
      const a = await backend();
      if (!valid() || a.backend !== target.backend)
        throw new Error("STALE_REQUEST");
      const result = await a.set(target.plan, valid);
      if (result.status !== "confirmed") throw new Error("SOURCE_UNCONFIRMED");
      lastError = "";
    },
    20,
    render,
  );
  function invalidate(reset = true) {
    newlineInteraction.reset();
    generation++;
    if (reset) controller.reset();
    else controller.cancel();
    paused = true;
    render();
  }
  function eligible(
    editor: vscode.TextEditor | undefined,
  ): editor is vscode.TextEditor {
    if (
      !editor ||
      disposed ||
      setup ||
      !vscode.window.state.focused ||
      !setting("enabled", true) ||
      vscode.env.uiKind !== vscode.UIKind.Desktop
    )
      return false;
    const d = editor.document;
    if (
      d.uri.scheme === "vscode-notebook-cell" ||
      d.uri.scheme === "vscode-scm" ||
      d.uri.scheme === "git" ||
      !languages[d.languageId] ||
      !setting<string[]>("enabledLanguages", []).includes(d.languageId)
    )
      return false;
    if (editor.selections.length !== 1 || !editor.selection.isEmpty)
      return false;
    const last = d.lineAt(d.lineCount - 1);
    return (
      d.offsetAt(last.range.end) * 2 <= setting("maxFileSizeKB", 2048) * 1024
    );
  }
  async function interact(editor: vscode.TextEditor | undefined) {
    const gen = ++generation;
    if (!eligible(editor)) {
      controller.cancel();
      paused = true;
      render();
      return;
    }
    newlineInteraction.note(
      editor,
      editor.document.version,
      editor.selection.active,
    );
    const version = editor.document.version,
      position = editor.selection.active;
    const valid = () =>
      gen === generation &&
      vscode.window.activeTextEditor === editor &&
      eligible(editor) &&
      editor.document.version === version &&
      editor.selection.active.isEqual(position);
    try {
      const d = editor.document,
        key = d.uri.toString();
      let cache = caches.get(key);
      if (!cache) {
        const grammar = await tokenizer.grammar(d.languageId);
        if (!valid()) return;
        cache = new DocumentCache(
          {
            get version() {
              return d.version;
            },
            get languageId() {
              return d.languageId;
            },
            get lineCount() {
              return d.lineCount;
            },
            lineAt: (n) => d.lineAt(n).text,
          },
          grammar,
        );
        caches.set(key, cache);
      }
      caches.delete(key);
      caches.set(key, cache);
      while (caches.size > 3) {
        const k = caches.keys().next().value as string;
        caches.get(k)?.clear();
        caches.delete(k);
      }
      const result = await cache.query(
        position.line,
        position.character,
        valid,
      );
      if (!valid()) return;
      lastContext = result.kind;
      let total = 0;
      for (const c of caches.values()) total += c.bytes;
      if (total > 8 * 1024 * 1024) {
        for (const [k, c] of caches)
          if (c !== cache) {
            c.clear();
            caches.delete(k);
          }
      }
      if (result.kind === "unknown") {
        controller.cancel();
        paused = true;
        render();
        return;
      }
      const policy = setting<string>(
        "rules." + result.kind,
        result.kind === "string" ? "text" : "code",
        false,
        d,
      );
      if (policy === "keep") {
        controller.cancel();
        paused = true;
        render();
        return;
      }
      // No probing on every cursor move. The first eligible interaction resolves the local backend once.
      const a = await backend();
      if (!valid()) return;
      const target = readPlan(a.backend, policy);
      paused = false;
      render();
      if (!target || !configured()) {
        controller.cancel();
        return;
      }
      controller.delay = Math.max(
        0,
        Math.min(100, setting("switchDelayMs", 20)),
      );
      controller.accept(
        key + "\0" + result.region,
        JSON.stringify({ backend: a.backend, plan: target }),
        valid,
        policy === "code",
      );
    } catch (e) {
      if (valid()) report(e);
    }
  }
  async function configure() {
    setup = true;
    invalidate();
    await controller.idle();
    try {
      const a = await backend();
      const sources = await a.list();
      const captured: Record<string, Plan> = {};
      for (const role of ["code", "text"]) {
        const choices = sources.map((id) => ({ label: id, id }));
        choices.push({ label: "手动切换后记录当前输入源", id: "" });
        const choice = await vscode.window.showQuickPick(choices, {
          title: `Context IME：配置 ${role} 方案`,
          placeHolder: "仅记录源；不会自动试切，内部模式未知",
        });
        if (!choice) return;
        let id = choice.id;
        if (!id) {
          const confirm = await vscode.window.showInformationMessage(
            `请用系统方式切到 ${role} 输入源，再点击记录。记录后请回编辑器重新同步验证。`,
            { modal: true },
            "记录当前",
          );
          if (!confirm) return;
          id = (await a.get()).sourceId ?? "";
        }
        captured[role] = { sourceId: id };
      }
      if (captured.code?.sourceId === captured.text?.sourceId) {
        void vscode.window.showInformationMessage(
          "code 和 text 使用同一输入源：仅选择源不会切换它的内部中英文模式。",
        );
      }
      const config = vscode.workspace.getConfiguration("autoIme");
      const oldCode = config.inspect(a.backend + ".code")?.globalValue;
      try {
        await config.update(
          a.backend + ".code",
          captured.code,
          vscode.ConfigurationTarget.Global,
        );
        await config.update(
          a.backend + ".text",
          captured.text,
          vscode.ConfigurationTarget.Global,
        );
      } catch (e) {
        await config.update(
          a.backend + ".code",
          oldCode,
          vscode.ConfigurationTarget.Global,
        );
        throw e;
      }
      lastError = "";
    } catch (e) {
      report(e);
    } finally {
      setup = false;
      invalidate();
    }
  }
  context.subscriptions.push(
    status,
    output,
    vscode.commands.registerCommand("autoIme.toggle", async () => {
      invalidate();
      await vscode.workspace
        .getConfiguration("autoIme")
        .update(
          "enabled",
          !setting("enabled", true),
          vscode.ConfigurationTarget.Global,
        );
    }),
    vscode.commands.registerCommand("autoIme.setup", configure),
    vscode.commands.registerCommand("autoIme.resync", async () => {
      invalidate();
      lastError = "";
      if (!adapter) adapterPromise = undefined;
      const e = vscode.window.activeTextEditor;
      if (e && vscode.window.state.focused) {
        await vscode.window.showTextDocument(e.document, {
          viewColumn: e.viewColumn,
          preserveFocus: false,
        });
        await interact(vscode.window.activeTextEditor);
      }
    }),
    vscode.commands.registerCommand("autoIme.diagnostics", () => {
      output.clear();
      output.appendLine(
        JSON.stringify(
          {
            backend: adapter?.backend,
            capabilities: adapter?.capability,
            configured: configured(),
            paused,
            error: lastError || controller.error,
            errors: Object.fromEntries(errors),
            desired: controller.desired
              ? JSON.parse(controller.desired)
              : undefined,
            lastRequest: controller.lastRequest
              ? JSON.parse(controller.lastRequest)
              : undefined,
            observed: adapter?.observed,
            processes: runner.count,
            get: adapter?.getCount,
            set: adapter?.setCount,
            caches: [...caches.values()].map((c) => ({
              bytes: c.bytes,
              ...c.stats,
            })),
            limits:
              "公开 API 无完整控件焦点/composition 观测；Linux 为 bestEffort；内部模式未知；无轮询。",
            log,
          },
          null,
          2,
        ),
      );
      output.show();
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      const pairedNewline = newlineInteraction.consume(
        e.textEditor,
        e.textEditor.document.version,
        e.textEditor.selection.active,
        e.kind,
      );
      if (
        e.textEditor === vscode.window.activeTextEditor &&
        (e.kind === vscode.TextEditorSelectionChangeKind.Keyboard ||
          e.kind === vscode.TextEditorSelectionChangeKind.Mouse ||
          pairedNewline)
      )
        void interact(e.textEditor);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!e.contentChanges.length) return;
      if (e.document === vscode.window.activeTextEditor?.document) {
        const editor = vscode.window.activeTextEditor;
        newlineInteraction.change(
          editor,
          e.document.version,
          e.contentChanges,
          eligible(editor),
          e.reason,
        );
        generation++;
        controller.cancel();
      }
      caches.get(e.document.uri.toString())?.edit(
        e.contentChanges.map((c) => ({
          startLine: c.range.start.line,
          endLine: c.range.end.line,
          newLines: c.text.split(/\r?\n/).length - 1,
          startColumn: c.range.start.character,
          endColumn: c.range.end.character,
          newLastColumn:
            c.text.split(/\r?\n/).at(-1)!.length +
            (c.text.includes("\n") ? 0 : c.range.start.character),
        })),
      );
    }),
    vscode.window.onDidChangeActiveTextEditor(() => invalidate()),
    vscode.window.onDidChangeWindowState(() => invalidate()),
    vscode.workspace.onDidCloseTextDocument((d) => {
      const key = d.uri.toString();
      caches.get(key)?.clear();
      caches.delete(key);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("autoIme")) return;
      invalidate();
      backendEpoch++;
      adapter = undefined;
      adapterPromise = undefined;
      if (!setting("debug", false)) log.length = 0;
      if (!setting("enabled", true)) {
        for (const c of caches.values()) c.clear();
        caches.clear();
      }
    }),
    {
      dispose() {
        disposed = true;
        invalidate();
        controller.dispose();
        runner.dispose();
        for (const c of caches.values()) c.clear();
        caches.clear();
        tokenizer.dispose();
      },
    },
  );
  render();
  return {
    diagnosticSnapshot: () => ({
      lastContext,
      processes: runner.count,
      set: adapter?.setCount ?? 0,
      caches: caches.size,
      paused,
      configured: configured(),
    }),
  };
}
