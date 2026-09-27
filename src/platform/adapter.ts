import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { ProcessRunner } from "./process";
export type Backend = "windows" | "macos" | "fcitx5" | "ibus";
export interface Plan {
  sourceId: string;
}
export interface Observed {
  sourceId?: string;
  observedAt: number;
  mode?: { active?: boolean };
}
export interface Result {
  status: "confirmed" | "unverified";
  observed: Observed;
  verifiedFields: string[];
}
export function source(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.startsWith("-") ||
    Buffer.byteLength(value) > 1024 ||
    /[\x00-\x1f\x7f\uFFFD]/u.test(value)
  )
    throw new Error("INVALID_SOURCE");
  return value;
}
export function plan(value: unknown): Plan | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).some((k) => k !== "sourceId"))
    throw new Error("MODE_UNSUPPORTED");
  return { sourceId: source(obj.sourceId) };
}
interface NativeReply {
  version: number;
  sourceId?: string;
  sources?: string[];
  target?: string;
  status?: string;
}
export class Adapter {
  observed?: Observed;
  getCount = 0;
  setCount = 0;
  readonly capability = {
    mode: "unsupported",
    focus: "bestEffort",
    enumeration: "capture",
    sourceIdentity: "source-id",
    tsfProfile: "unsupported",
  };
  constructor(
    readonly backend: Backend,
    readonly executable: string,
    readonly runner: ProcessRunner,
    private appPath = process.execPath,
  ) {
    if (backend === "ibus") this.capability.enumeration = "list-or-capture";
    if (backend === "windows")
      this.capability.sourceIdentity =
        "keyboard-layout-only (KLID), not TSF profile";
    if (backend === "macos" || backend === "windows") {
      this.capability.focus = "application";
      this.capability.enumeration = "list";
    }
  }
  private async native(args: string[], timeout = 1500): Promise<NativeReply> {
    this.observed = undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        await this.runner.run(
          this.executable,
          [...args, "--app", this.appPath],
          timeout,
        ),
      );
    } catch (e) {
      if (e instanceof SyntaxError) throw new Error("INVALID_OUTPUT");
      throw e;
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as NativeReply).version !== 1
    )
      throw new Error("INVALID_OUTPUT");
    const reply = parsed as NativeReply;
    const operation = args[0];
    if (operation === "get" || operation === "set" || operation === "probe") {
      if (reply.status !== "observed") throw new Error("INVALID_OUTPUT");
      source(reply.sourceId);
    } else if (operation === "target") {
      if (
        typeof reply.target !== "string" ||
        !reply.target ||
        reply.target.length > 128 ||
        /[^0-9:]/u.test(reply.target)
      )
        throw new Error("FOCUS_UNSAFE");
    }
    return reply;
  }
  async get(timeout = 1500): Promise<Observed> {
    this.observed = undefined;
    this.getCount++;
    let id: string;
    if (this.backend === "fcitx5")
      id = source(
        (
          await this.runner.run(this.executable, ["--check", "-n"], timeout)
        ).trim(),
      );
    else if (this.backend === "ibus")
      id = source(
        (await this.runner.run(this.executable, ["engine"], timeout)).trim(),
      );
    else id = source((await this.native(["get"], timeout)).sourceId);
    const result = { sourceId: id, observedAt: Date.now() };
    this.observed = result;
    return result;
  }
  async probe() {
    if (this.backend === "fcitx5") {
      const state = (
        await this.runner.run(this.executable, ["--check"])
      ).trim();
      if (!/^[012]$/.test(state)) throw new Error("BACKEND_UNAVAILABLE");
    }
    await this.get();
    return this.capability;
  }
  async list(): Promise<string[]> {
    if (this.backend === "fcitx5") return [];
    if (this.backend === "ibus") {
      try {
        const output = await this.runner.run(this.executable, [
          "list-engine",
          "--name-only",
        ]);
        const ids = output.trim().split(/\r?\n/);
        if (ids.length > 512) throw new Error("INVALID_OUTPUT");
        return ids.map(source);
      } catch {
        return [];
      }
    }
    const items = (await this.native(["list"])).sources;
    if (!Array.isArray(items) || items.length > 512)
      throw new Error("INVALID_OUTPUT");
    return items.map(source);
  }
  async set(target: Plan, valid: () => boolean): Promise<Result> {
    const id = source(target.sourceId),
      deadline = Date.now() + 2500;
    const check = () => {
      if (!valid()) throw new Error("STALE_REQUEST");
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("TIMEOUT");
      return Math.min(1500, left);
    };
    let observed = await this.get(check());
    check();
    if (observed.sourceId !== id) {
      this.setCount++;
      if (this.backend === "fcitx5")
        await this.runner.run(this.executable, ["--check", "-s", id], check());
      else if (this.backend === "ibus")
        await this.runner.run(this.executable, ["engine", id], check());
      else {
        const guard = await this.native(["target"], check());
        if (typeof guard.target !== "string" || guard.target.length > 128)
          throw new Error("FOCUS_UNSAFE");
        this.observed = undefined;
        const reply = await this.native(
          ["set", "--source", id, "--target", guard.target],
          check(),
        );
        check();
        observed = { sourceId: source(reply.sourceId), observedAt: Date.now() };
        this.observed = observed;
      }
      if (this.backend === "fcitx5" || this.backend === "ibus")
        observed = await this.get(check());
      check();
    }
    return {
      status: observed.sourceId === id ? "confirmed" : "unverified",
      observed,
      verifiedFields: observed.sourceId === id ? ["sourceId"] : [],
    };
  }
}
export async function createAdapter(
  root: string,
  selection: string,
  runner: ProcessRunner,
): Promise<Adapter> {
  const native =
    process.platform === "win32"
      ? "windows"
      : process.platform === "darwin"
        ? "macos"
        : undefined;
  if (native) {
    if (selection !== "auto" && selection !== native)
      throw new Error("BACKEND_PLATFORM_MISMATCH");
    const path = join(
      root,
      "native/bin",
      `${process.platform}-${process.arch}`,
      process.platform === "win32" ? "context-ime.exe" : "context-ime",
    );
    await access(path, constants.X_OK);
    const a = new Adapter(native, path, runner);
    await a.probe();
    return a;
  }
  if (process.platform !== "linux") throw new Error("PLATFORM_UNSUPPORTED");
  const found: Adapter[] = [];
  for (const backend of ["fcitx5", "ibus"] as const) {
    if (selection !== "auto" && selection !== backend) continue;
    // Fixed system directories, never workspace-controlled PATH.
    for (const dir of ["/usr/bin", "/bin"]) {
      try {
        const path = await realpath(
          join(dir, backend === "fcitx5" ? "fcitx5-remote" : "ibus"),
        );
        await access(path, constants.X_OK);
        const a = new Adapter(backend, path, runner);
        await a.probe();
        found.push(a);
        break;
      } catch {
        /* Try next trusted location/backend. */
      }
    }
  }
  if (found.length !== 1)
    throw new Error(
      found.length
        ? "MULTIPLE_BACKENDS_SELECT_EXPLICITLY"
        : "BACKEND_UNAVAILABLE",
    );
  return found[0]!;
}
