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
  text: string;
  input: StateStack;
  output: StateStack;
  tokens: IToken[];
  id: number;
  results: Map<number, Classification>;
}
interface Anchor {
  line: number;
  column: number;
  id: number;
}
let sequence = 0;
export class DocumentCache {
  private classified = new Set<Row>();
  private estimated = 0;
  private rows = new Map<number, Row>();
  private valid = -1;
  private epoch = 0;
  private anchors: Anchor[] = [];
  stats = { tokenized: 0, hits: 0, reused: 0, yields: 0 };
  constructor(
    readonly document: DocumentView,
    private grammar?: IGrammar,
    private budgetMs = 100,
    private tokenBudgetMs = 5,
    private maxBytes = 8 * 1024 * 1024,
  ) {}
  get bytes() {
    return this.estimated + this.anchors.length * 64;
  }
  private rowBytes(r: Row) {
    return (
      r.text.length * 2 + r.tokens.length * 160 + 256 + r.results.size * 128
    );
  }
  clear() {
    this.classified.clear();
    this.rows.clear();
    this.estimated = 0;
    this.anchors = [];
    this.valid = -1;
    this.epoch++;
  }
  edit(edits: Edit[]) {
    if (!edits.length) return;
    this.epoch++;
    // Only rows queried at cursor positions carry classifications. Invalidate
    // those identities without walking every tokenized line on each keystroke.
    for (const r of this.classified) {
      this.estimated -= r.results.size * 128;
      r.results.clear();
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
        if (row) this.estimated -= this.rowBytes(row);
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
    const epoch = this.epoch,
      version = this.document.version,
      start = performance.now();
    let batch = start,
      count = 0;
    const current = () =>
      alive() && epoch === this.epoch && version === this.document.version;
    for (let n = this.valid + 1; n <= line; n++) {
      if (!current()) return unknown("cancelled");
      const text = this.document.lineAt(n);
      if (text.length > 20000) return unknown("line-limit");
      const input = n === 0 ? INITIAL : this.rows.get(n - 1)?.output;
      if (!input) return unknown("no-state");
      const old = this.rows.get(n);
      if (old && old.text === text && old.input.equals(input)) {
        this.stats.reused++;
      } else {
        const result = this.grammar.tokenizeLine(
          text,
          input,
          this.tokenBudgetMs,
        );
        this.stats.tokenized++;
        if (result.stoppedEarly) return unknown("tokenizer-timeout");
        this.rows.set(n, {
          text,
          input,
          output: result.ruleStack,
          tokens: result.tokens,
          id: old?.id ?? ++sequence,
          results: new Map(),
        });
      }
      this.estimated += old
        ? -this.rowBytes(old) + this.rowBytes(this.rows.get(n)!)
        : this.rowBytes(this.rows.get(n)!);
      if (this.bytes > this.maxBytes) {
        // Keep the trusted prefix and predecessor stacks. Dropping the whole
        // document here made even previously warm positions unusable.
        const overflow = this.rows.get(n)!;
        this.estimated -= this.rowBytes(overflow);
        this.classified.delete(overflow);
        this.rows.delete(n);
        return unknown("cache-limit");
      }
      this.valid = n;
      if (performance.now() - start > this.budgetMs)
        return unknown("request-budget");
      if (++count >= 128 || performance.now() - batch >= 4) {
        this.stats.yields++;
        await new Promise<void>((r) => setImmediate(r));
        count = 0;
        batch = performance.now();
      }
    }
    if (!current()) return unknown("cancelled");
    const row = this.rows.get(line);
    if (!row) return unknown("evicted");
    this.stats.hits++;
    const cached = row.results.get(column);
    if (cached) return cached;
    const insertion = atInsertion(
      this.grammar,
      row.text,
      column,
      row.input,
      row.tokens,
      this.document.languageId,
      this.tokenBudgetMs,
    );
    const kind = insertion.kind;
    if (kind === "unknown")
      return unknown(insertion.reason ?? "ambiguous-boundary");
    let region: string = kind;
    if (kind === "string" || kind === "comment") {
      // Find the nearest semantic opening in the same nested scope path.
      outer: for (let n = line; n >= 0; n--) {
        const r = this.rows.get(n);
        if (!r) break;
        for (let i = r.tokens.length - 1; i >= 0; i--) {
          const t = r.tokens[i]!;
          if (n === line && t.startIndex >= column) continue;
          if (
            scopeKind(t.scopes, this.document.languageId) !== kind ||
            scopePath(t.scopes) !== insertion.path
          )
            continue;
          if (
            t.scopes.some((s) =>
              /punctuation.*(begin|start)|punctuation\.definition\.comment/.test(
                s,
              ),
            )
          ) {
            let a = this.anchors.find(
              (a) => a.line === n && a.column === t.startIndex,
            );
            if (!a) {
              a = { line: n, column: t.startIndex, id: ++sequence };
              this.anchors.push(a);
            }
            region = `${kind}:${a.id}`;
            break outer;
          }
        }
      }
    }
    const result = { kind, region };
    if (row.results.size < 256 && this.bytes + 128 <= this.maxBytes) {
      row.results.set(column, result);
      this.classified.add(row);
      this.estimated += 128;
    }
    return result;
  }
}
