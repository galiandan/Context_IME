import {
  INITIAL,
  type IGrammar,
  type IToken,
  type StateStack,
} from "vscode-textmate";
import {
  atInsertion,
  scopeKind,
  scopePath,
  type Classification,
} from "./classifier";
import { grammarCompilation } from "./tokenizer";
export interface DocumentView {
  version: number;
  languageId: string;
  lineCount: number;
  lineAt(n: number): string;
}
export interface Edit {
  startLine: number;
  endLine: number;
  newLines: number;
  startColumn?: number;
  endColumn?: number;
  newLastColumn?: number;
}
interface Row {
  text?: string;
  input: StateStack;
  output: StateStack;
  tokens?: IToken[];
  openers?: IToken[];
  results?: Map<number, Classification>;
}
interface Anchor {
  line: number;
  column: number;
  id: number;
}
const isOpening = (t: IToken) =>
  t.scopes.some((s) =>
    /punctuation.*(begin|start)|punctuation\.definition\.comment/.test(s),
  );
let sequence = 0;
export class DocumentCache {
  private classified = new Set<Row>();
  private estimated = 0;
  private fullRows = new Set<Row>();
  private revision: number;
  private rows = new Map<number, Row>();
  private valid = -1;
  private epoch = 0;
  private anchors: Anchor[] = [];
  stats = {
    tokenized: 0,
    hits: 0,
    reused: 0,
    yields: 0,
    compacted: 0,
    restored: 0,
  };
  constructor(
    readonly document: DocumentView,
    private grammar?: IGrammar,
    private budgetMs = 100,
    private tokenBudgetMs = 5,
    private maxBytes = 8 * 1024 * 1024,
    private now: () => number = () => performance.now(),
  ) {
    this.revision = document.version;
  }
  get bytes() {
    return this.estimated + this.anchors.length * 64;
  }
  private rowBytes(r: Row) {
    return (
      (r.text?.length ?? 0) * 2 +
      (r.tokens ?? r.openers ?? []).length * 160 +
      (r.tokens ? 256 : 192) +
      (r.results?.size ?? 0) * 128
    );
  }
  private compact(r: Row) {
    if (!r.tokens) return;
    const before = this.rowBytes(r);
    // Keep only region-open tokens and trusted states. edit() proves text
    // alignment by removing every changed row; compact rows need no text copy.
    r.openers = r.tokens.filter(isOpening);
    r.tokens = undefined;
    r.text = undefined;
    r.results = undefined;
    this.fullRows.delete(r);
    this.classified.delete(r);
    this.estimated += this.rowBytes(r) - before;
    this.stats.compacted++;
  }
  private fit(protectedRow: Row, extra = 0) {
    for (const r of this.fullRows) {
      if (this.bytes + extra <= this.maxBytes) break;
      if (r !== protectedRow) this.compact(r);
    }
    return this.bytes + extra <= this.maxBytes;
  }
  clear() {
    this.classified.clear();
    this.fullRows.clear();
    this.rows.clear();
    this.revision = this.document.version;
    this.estimated = 0;
    this.anchors = [];
    this.valid = -1;
    this.epoch++;
  }
  edit(edits: Edit[]) {
    if (!edits.length) return;
    if (this.document.version !== this.revision + 1) {
      this.clear();
      return;
    }
    this.revision = this.document.version;
    this.epoch++;
    // Only rows queried at cursor positions carry classifications. Invalidate
    // those identities without walking every tokenized line on each keystroke.
    for (const r of this.classified) {
      this.estimated -= (r.results?.size ?? 0) * 128;
      r.results = undefined;
    }
    this.classified.clear();
    const sorted = [...edits].sort(
      (a, b) =>
        a.startLine - b.startLine ||
        (a.startColumn ?? 0) - (b.startColumn ?? 0),
    );
    const first = sorted[0]!.startLine;
    const singleLine = sorted.every(
      (e) => e.startLine === e.endLine && e.newLines === 0,
    );
    const mapped = singleLine ? this.rows : new Map<number, Row>();
    if (singleLine) {
      for (const e of sorted) {
        const row = mapped.get(e.startLine);
        if (row) {
          this.estimated -= this.rowBytes(row);
          this.fullRows.delete(row);
        }
        mapped.delete(e.startLine);
      }
    } else
      for (const [line, row] of this.rows) {
        let delta = 0,
          dirty = false;
        for (const e of sorted) {
          if (line >= e.startLine && line <= e.endLine) {
            dirty = true;
            break;
          }
          if (line > e.endLine) delta += e.newLines - (e.endLine - e.startLine);
        }
        if (!dirty) mapped.set(line + delta, row);
        else this.fullRows.delete(row);
      }
    for (const a of this.anchors)
      for (const e of [...sorted].reverse()) {
        const sc = e.startColumn ?? 0,
          ec = e.endColumn ?? Number.MAX_SAFE_INTEGER;
        if (a.line > e.endLine)
          a.line += e.newLines - (e.endLine - e.startLine);
        else if (a.line >= e.startLine) {
          if (a.line === e.startLine && a.column < sc) continue;
          if (a.line === e.endLine && a.column >= ec) {
            a.line = e.startLine + e.newLines;
            a.column = (e.newLastColumn ?? 0) + a.column - ec;
          } else a.id = -1;
        }
      }
    this.anchors = this.anchors.filter((a) => a.id !== -1);
    this.rows = mapped;
    if (!singleLine)
      this.estimated = [...mapped.values()].reduce(
        (n, r) => n + this.rowBytes(r),
        0,
      );
    this.valid = Math.min(this.valid, first - 1);
  }
  async query(
    line: number,
    column: number,
    alive: () => boolean = () => true,
  ): Promise<Classification> {
    const unknown = (reason: string): Classification => ({
      kind: "unknown",
      region: "unknown",
      reason,
    });
    if (!this.grammar || !alive() || line >= this.document.lineCount)
      return unknown("not-ready");
    if (this.document.version !== this.revision) this.clear();
    const epoch = this.epoch,
      version = this.document.version,
      start = this.now();
    let batch = start,
      count = 0,
      retries = 0;
    const current = () =>
      alive() && epoch === this.epoch && version === this.document.version;
    const compiled = () => grammarCompilation.get(this.grammar!)?.scanners ?? 0;
    const canRetry = (before: number) =>
      this.tokenBudgetMs > 0 &&
      retries < 3 &&
      (retries === 0 || compiled() > before);
    const pause = async () => {
      retries++;
      this.stats.yields++;
      await new Promise<void>((r) => setImmediate(r));
      if (!current()) return "cancelled";
      if (this.now() - start >= this.budgetMs) return "request-budget";
      return undefined;
    };
    for (let n = this.valid + 1; n <= line; n++) {
      if (!current()) return unknown("cancelled");
      const text = this.document.lineAt(n);
      if (text.length > 20000) return unknown("line-limit");
      const input = n === 0 ? INITIAL : this.rows.get(n - 1)?.output;
      if (!input) return unknown("no-state");
      const old = this.rows.get(n);
      if (
        old &&
        (old.text === undefined || old.text === text) &&
        old.input.equals(input)
      ) {
        this.stats.reused++;
      } else {
        let before = compiled();
        let result = this.grammar.tokenizeLine(text, input, this.tokenBudgetMs);
        this.stats.tokenized++;
        while (result.stoppedEarly && canRetry(before)) {
          // Extra retries require observable new scanner compilation. A hot
          // pathological line still gets only the original single retry.
          const reason = await pause();
          if (reason) return unknown(reason);
          before = compiled();
          result = this.grammar.tokenizeLine(text, input, this.tokenBudgetMs);
          this.stats.tokenized++;
        }
        if (result.stoppedEarly) return unknown("tokenizer-timeout");
        if (old) this.fullRows.delete(old);
        const row: Row = {
          text,
          input,
          output: result.ruleStack,
          tokens: result.tokens,
        };
        this.rows.set(n, row);
        this.fullRows.add(row);
      }
      this.estimated += old
        ? -this.rowBytes(old) + this.rowBytes(this.rows.get(n)!)
        : this.rowBytes(this.rows.get(n)!);
      if (!this.fit(this.rows.get(n)!)) {
        // Keep the trusted prefix and predecessor stacks. Dropping the whole
        // document here made even previously warm positions unusable.
        const overflow = this.rows.get(n)!;
        this.estimated -= this.rowBytes(overflow);
        this.classified.delete(overflow);
        this.fullRows.delete(overflow);
        this.rows.delete(n);
        return unknown("cache-limit");
      }
      this.valid = n;
      if (this.now() - start > this.budgetMs) return unknown("request-budget");
      if (++count >= 128 || this.now() - batch >= 4) {
        this.stats.yields++;
        await new Promise<void>((r) => setImmediate(r));
        count = 0;
        batch = this.now();
      }
    }
    if (!current()) return unknown("cancelled");
    const row = this.rows.get(line);
    if (!row) return unknown("evicted");
    if (!row.tokens) {
      const text = this.document.lineAt(line);
      let beforeCompilation = compiled();
      let restored = this.grammar.tokenizeLine(
        text,
        row.input,
        this.tokenBudgetMs,
      );
      this.stats.tokenized++;
      while (restored.stoppedEarly && canRetry(beforeCompilation)) {
        const reason = await pause();
        if (reason) return unknown(reason);
        beforeCompilation = compiled();
        restored = this.grammar.tokenizeLine(
          text,
          row.input,
          this.tokenBudgetMs,
        );
        this.stats.tokenized++;
      }
      if (restored.stoppedEarly) return unknown("tokenizer-timeout");
      if (!restored.ruleStack.equals(row.output))
        return unknown("state-mismatch");
      const before = this.rowBytes(row);
      row.text = text;
      row.tokens = restored.tokens;
      row.openers = undefined;
      this.estimated += this.rowBytes(row) - before;
      this.fullRows.add(row);
      this.stats.restored++;
      if (!this.fit(row)) {
        this.compact(row);
        return unknown("cache-limit");
      }
      if (this.now() - start > this.budgetMs) return unknown("request-budget");
    }
    // Recently accessed tokens survive longer under capacity pressure.
    this.fullRows.delete(row);
    this.fullRows.add(row);
    this.stats.hits++;
    const cached = row.results?.get(column);
    if (cached) return cached;
    // A concurrent query can compact this row while a boundary retry yields.
    // Keep this request's immutable payload until it completes or is cancelled.
    const queryText = row.text!,
      queryTokens = row.tokens!;
    let beforeCompilation = compiled();
    let insertion = atInsertion(
      this.grammar,
      queryText,
      column,
      row.input,
      queryTokens,
      this.document.languageId,
      this.tokenBudgetMs,
    );
    while (
      insertion.reason === "tokenizer-timeout" &&
      canRetry(beforeCompilation)
    ) {
      const reason = await pause();
      if (reason) return unknown(reason);
      beforeCompilation = compiled();
      insertion = atInsertion(
        this.grammar,
        queryText,
        column,
        row.input,
        queryTokens,
        this.document.languageId,
        this.tokenBudgetMs,
      );
    }
    if (this.now() - start > this.budgetMs) return unknown("request-budget");
    const kind = insertion.kind;
    if (kind === "unknown")
      return unknown(insertion.reason ?? "ambiguous-boundary");
    let region: string = kind;
    if (kind === "string" || kind === "comment") {
      let scanned = 0;
      // Find the nearest semantic opening in the same nested scope path.
      outer: for (let n = line; n >= 0; n--) {
        if (++scanned % 128 === 0) {
          if (this.now() - start > this.budgetMs)
            return unknown("request-budget");
          if (this.now() - batch >= 4) {
            this.stats.yields++;
            await new Promise<void>((r) => setImmediate(r));
            if (!current()) return unknown("cancelled");
            batch = this.now();
          }
        }
        const r = this.rows.get(n);
        if (!r) break;
        const tokens = r.tokens ?? r.openers ?? [];
        for (let i = tokens.length - 1; i >= 0; i--) {
          const t = tokens[i]!;
          if (n === line && t.startIndex >= column) continue;
          // Most tokens are text, not region openers. Filter them before
          // computing nested kind/path (which allocate temporary arrays).
          if (
            !isOpening(t) ||
            scopeKind(t.scopes, this.document.languageId) !== kind ||
            scopePath(t.scopes) !== insertion.path
          )
            continue;
          let a = this.anchors.find(
            (a) => a.line === n && a.column === t.startIndex,
          );
          if (!a) {
            if (!this.fit(row, 64)) return unknown("cache-limit");
            a = { line: n, column: t.startIndex, id: ++sequence };
            this.anchors.push(a);
          }
          region = `${kind}:${a.id}`;
          break outer;
        }
      }
    }
    const result = { kind, region };
    if ((row.results?.size ?? 0) < 256 && this.bytes + 128 <= this.maxBytes) {
      (row.results ??= new Map()).set(column, result);
      this.classified.add(row);
      this.estimated += 128;
    }
    return result;
  }
}
