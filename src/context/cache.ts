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
  text?: string;
}
interface Row {
  text?: string;
  input: StateStack;
  output: StateStack;
  tokens?: IToken[];
  openers?: IToken[];
  results?: Map<number, Classification>;
  dirty?: boolean;
  hasBoundary?: boolean;
}
interface Anchor {
  line: number;
  column: number;
  id: number;
  path: string;
}
type AnchorGroup = Anchor | Anchor[];
interface RegionLink {
  anchor: Anchor;
  epoch: number;
}
const isOpening = (t: IToken) =>
  t.scopes.some((s) =>
    /punctuation.*(begin|start)|punctuation\.definition\.comment/.test(s),
  );
const isBoundary = (t: IToken) =>
  t.scopes.some((s) =>
    /punctuation.*(begin|start|end)|punctuation\.definition\.comment|escape/.test(
      s,
    ),
  );
let sequence = 0;
const REGION_LINK_BYTES = 24;
export class DocumentCache {
  private classified = new Set<Row>();
  private estimated = 0;
  private fullRows = new Set<Row>();
  private revision: number;
  private rows = new Map<number, Row>();
  private valid = -1;
  private epoch = 0;
  private regionEpoch = 0;
  private anchors = new Map<number, AnchorGroup>();
  private anchorCount = 0;
  private regionLinks = new WeakMap<Row, RegionLink>();
  private regionLinkCount = 0;
  stats = {
    tokenized: 0,
    hits: 0,
    reused: 0,
    yields: 0,
    compacted: 0,
    restored: 0,
    regionRowsScanned: 0,
    regionLinkHits: 0,
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
    return (
      this.estimated +
      this.anchorCount * 128 +
      this.regionLinkCount * REGION_LINK_BYTES
    );
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
    r.hasBoundary ??= r.tokens.some(isBoundary);
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
  private anchorAt(line: number, column: number): Anchor | undefined {
    const group = this.anchors.get(line);
    if (!group) return undefined;
    if (!Array.isArray(group)) return group.column === column ? group : undefined;
    let low = 0,
      high = group.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (group[mid]!.column < column) low = mid + 1;
      else high = mid;
    }
    return group[low]?.column === column ? group[low] : undefined;
  }
  private addAnchor(anchor: Anchor) {
    const group = this.anchors.get(anchor.line);
    if (!group) this.anchors.set(anchor.line, anchor);
    else if (!Array.isArray(group)) {
      this.anchors.set(
        anchor.line,
        group.column < anchor.column ? [group, anchor] : [anchor, group],
      );
    } else {
      let low = 0,
        high = group.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (group[mid]!.column < anchor.column) low = mid + 1;
        else high = mid;
      }
      group.splice(low, 0, anchor);
    }
    this.anchorCount++;
  }
  private removeAnchor(anchor: Anchor) {
    const group = this.anchors.get(anchor.line);
    let removed = false;
    if (group && !Array.isArray(group) && group === anchor) {
      this.anchors.delete(anchor.line);
      removed = true;
    } else if (group && Array.isArray(group)) {
      const index = group.findIndex((item) => item === anchor);
      if (index >= 0) {
        group.splice(index, 1);
        if (!group.length) this.anchors.delete(anchor.line);
        else if (group.length === 1) this.anchors.set(anchor.line, group[0]!);
        removed = true;
      }
    }
    anchor.id = -1;
    if (removed) this.anchorCount--;
  }
  private rememberRegion(row: Row, anchor: Anchor, epoch: number) {
    const old = this.regionLinks.get(row);
    if (old?.anchor === anchor && old.epoch === epoch) return;
    if (!old && this.bytes + REGION_LINK_BYTES > this.maxBytes) return;
    if (!old) this.regionLinkCount++;
    this.regionLinks.set(row, { anchor, epoch });
  }
  private forgetRegion(row: Row) {
    if (this.regionLinks.delete(row)) this.regionLinkCount--;
  }
  private mayChangeRegion(edits: readonly Edit[]) {
    const possibleDelimiter = /[\r\n'"`\\/#*{}<>]/u;
    for (const e of edits) {
      if (
        e.startLine !== e.endLine ||
        e.newLines > 0 ||
        e.text === undefined ||
        possibleDelimiter.test(e.text)
      )
        return true;
      if (!this.anchorCount) continue;
      const row = this.rows.get(e.startLine);
      if (!row) return true;
      row.hasBoundary ??= (row.tokens ?? row.openers ?? []).some(isBoundary);
      if (row.hasBoundary) return true;
    }
    return false;
  }
  clear() {
    this.classified.clear();
    this.fullRows.clear();
    this.rows.clear();
    this.revision = this.document.version;
    this.estimated = 0;
    this.anchors.clear();
    this.anchorCount = 0;
    this.regionLinks = new WeakMap();
    this.regionLinkCount = 0;
    this.valid = -1;
    this.epoch++;
    this.regionEpoch++;
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
    if (this.mayChangeRegion(sorted)) {
      this.regionEpoch++;
      this.regionLinks = new WeakMap();
      this.regionLinkCount = 0;
    }
    const first = sorted[0]!.startLine;
    const singleLine = sorted.every(
      (e) => e.startLine === e.endLine && e.newLines === 0,
    );
    const mapped = singleLine ? this.rows : new Map<number, Row>();
    // All surviving rows retain the same payload size. Account only for rows
    // intersected by edits instead of rescanning every mapped row afterward.
    let mappedEstimated = this.estimated;
    let byEnd: Edit[] = [];
    let deltaPrefix: number[] = [];
    if (singleLine) {
      for (const e of sorted) {
        const row = mapped.get(e.startLine);
        if (row) {
          this.fullRows.delete(row);
          const link = this.regionLinks.get(row);
          if (
            link &&
            link.epoch === this.regionEpoch &&
            link.anchor.id > 0
          ) {
            const before = this.rowBytes(row);
            row.text = undefined;
            row.tokens = undefined;
            row.openers = undefined;
            row.results = undefined;
            row.dirty = true;
            this.estimated += this.rowBytes(row) - before;
          } else {
            this.forgetRegion(row);
            this.estimated -= this.rowBytes(row);
            mapped.delete(e.startLine);
          }
        }
      }
    } else {
      // Content changes are expressed in the old document's coordinates.
      // Build intervals and line deltas once instead of comparing every cached
      // row with every edit in a large formatter or multi-cursor batch.
      const intervals: { start: number; end: number }[] = [];
      for (const e of sorted) {
        const last = intervals.at(-1);
        if (last && e.startLine <= last.end)
          last.end = Math.max(last.end, e.endLine);
        else intervals.push({ start: e.startLine, end: e.endLine });
      }
      byEnd = [...sorted].sort((a, b) => a.endLine - b.endLine);
      deltaPrefix = [0];
      for (const e of byEnd)
        deltaPrefix.push(
          deltaPrefix.at(-1)! + e.newLines - (e.endLine - e.startLine),
        );
      for (const [line, row] of this.rows) {
        let low = 0,
          high = intervals.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (intervals[mid]!.start <= line) low = mid + 1;
          else high = mid;
        }
        const interval = intervals[low - 1];
        if (interval && line <= interval.end) {
          this.fullRows.delete(row);
          this.forgetRegion(row);
          mappedEstimated -= this.rowBytes(row);
          continue;
        }
        low = 0;
        high = byEnd.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (byEnd[mid]!.endLine < line) low = mid + 1;
          else high = mid;
        }
        const mappedLine = line + deltaPrefix[low]!;
        mapped.set(mappedLine, row);
      }
    }
    if (singleLine) {
      // Typing normally edits a line without changing line numbers. Only
      // anchors on changed lines can move; unrelated document regions need
      // no work in the common one-keystroke case.
      const editsByLine = new Map<number, Edit[]>();
      for (const e of sorted) {
        const lineEdits = editsByLine.get(e.startLine) ?? [];
        lineEdits.push(e);
        editsByLine.set(e.startLine, lineEdits);
      }
      for (const [line, lineEdits] of editsByLine) {
        const group = this.anchors.get(line);
        if (!group) continue;
        lineEdits.reverse();
        if (!Array.isArray(group)) {
          let dirty = false;
          for (const e of lineEdits) {
            const sc = e.startColumn ?? 0,
              ec = e.endColumn ?? Number.MAX_SAFE_INTEGER;
            if (group.column < sc) continue;
            if (group.column >= ec && e.newLastColumn !== undefined)
              group.column = e.newLastColumn + group.column - ec;
            else {
              dirty = true;
              break;
            }
          }
          if (dirty) {
            group.id = -1;
            this.anchors.delete(line);
            this.anchorCount--;
          }
          continue;
        }
        const next: Anchor[] = [];
        for (const a of group) {
          let dirty = false;
          for (const e of lineEdits) {
            const sc = e.startColumn ?? 0,
              ec = e.endColumn ?? Number.MAX_SAFE_INTEGER;
            if (a.column < sc) continue;
            if (a.column >= ec && e.newLastColumn !== undefined)
              a.column = e.newLastColumn + a.column - ec;
            else {
              dirty = true;
              break;
            }
          }
          if (!dirty) next.push(a);
          else a.id = -1;
        }
        next.sort((a, b) => a.column - b.column);
        this.anchorCount += next.length - group.length;
        if (next.length === 1) this.anchors.set(line, next[0]!);
        else if (next.length) this.anchors.set(line, next);
        else this.anchors.delete(line);
      }
    } else {
      // Newline edits can move anchors. Index their endpoint lines and strict
      // interiors once; each anchor then handles only edits touching its line
      // plus one prefix delta for all earlier lines.
      const editsByLine = new Map<number, Edit[]>();
      const interiors: { start: number; end: number }[] = [];
      const addLineEdit = (line: number, edit: Edit) => {
        const group = editsByLine.get(line) ?? [];
        group.push(edit);
        editsByLine.set(line, group);
      };
      for (const e of sorted) {
        addLineEdit(e.startLine, e);
        if (e.endLine !== e.startLine) addLineEdit(e.endLine, e);
        if (e.endLine - e.startLine > 1) {
          const start = e.startLine + 1,
            end = e.endLine - 1,
            last = interiors.at(-1);
          if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
          else interiors.push({ start, end });
        }
      }
      const anchors: Anchor[] = [];
      for (const group of this.anchors.values())
        if (Array.isArray(group)) anchors.push(...group);
        else anchors.push(group);
      const mappedAnchors = new Map<number, AnchorGroup>();
      let mappedAnchorCount = 0;
      for (const a of anchors) {
        const oldLine = a.line;
        let low = 0,
          high = interiors.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (interiors[mid]!.start <= oldLine) low = mid + 1;
          else high = mid;
        }
        const interior = interiors[low - 1];
        if (interior && oldLine <= interior.end) {
          a.id = -1;
          continue;
        }

        let dirty = false;
        const local = editsByLine.get(oldLine);
        if (local)
          for (let i = local.length - 1; i >= 0; i--) {
            const e = local[i]!;
            const sc = e.startColumn ?? 0,
              ec = e.endColumn ?? Number.MAX_SAFE_INTEGER;
            if (a.line > e.endLine)
              a.line += e.newLines - (e.endLine - e.startLine);
            else if (a.line >= e.startLine) {
              if (a.line === e.startLine && a.column < sc) continue;
              if (
                a.line === e.endLine &&
                a.column >= ec &&
                e.newLastColumn !== undefined
              ) {
                a.line = e.startLine + e.newLines;
                a.column = e.newLastColumn + a.column - ec;
              } else {
                dirty = true;
                break;
              }
            }
          }
        if (dirty) {
          a.id = -1;
          continue;
        }
        low = 0;
        high = byEnd.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (byEnd[mid]!.endLine < oldLine) low = mid + 1;
          else high = mid;
        }
        a.line += deltaPrefix[low]!;

        const group = mappedAnchors.get(a.line);
        if (!group) mappedAnchors.set(a.line, a);
        else if (Array.isArray(group)) group.push(a);
        else mappedAnchors.set(a.line, [group, a]);
        mappedAnchorCount++;
      }
      for (const [line, group] of mappedAnchors)
        if (Array.isArray(group)) {
          group.sort((a, b) => a.column - b.column);
          if (group.length === 1) mappedAnchors.set(line, group[0]!);
        }
      this.anchors = mappedAnchors;
      this.anchorCount = mappedAnchorCount;
    }
    this.rows = mapped;
    if (!singleLine) this.estimated = mappedEstimated;
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
      regionEpoch = this.regionEpoch,
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
        !old.dirty &&
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
        const oldLink = old ? this.regionLinks.get(old) : undefined;
        const sameRegionState =
          old?.dirty &&
          oldLink?.epoch === regionEpoch &&
          oldLink.anchor.id > 0 &&
          old.input.equals(input) &&
          old.output.equals(result.ruleStack);
        if (old) this.forgetRegion(old);
        const row: Row = {
          text,
          input,
          output: result.ruleStack,
          tokens: result.tokens,
          hasBoundary:
            sameRegionState && old.hasBoundary === false
              ? false
              : result.tokens.some(isBoundary),
        };
        this.rows.set(n, row);
        if (sameRegionState) this.rememberRegion(row, oldLink.anchor, regionEpoch);
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
        this.forgetRegion(overflow);
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
      let scanned = 0,
        regionAnchor: Anchor | undefined;
      const checkpoints: Row[] = [];
      let checkpointStride = 64;
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
        this.stats.regionRowsScanned++;
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
          let a = this.anchorAt(n, t.startIndex);
          if (a && a.path !== insertion.path) {
            this.removeAnchor(a);
            a = undefined;
          }
          if (!a) {
            if (!this.fit(row, 128)) return unknown("cache-limit");
            a = {
              line: n,
              column: t.startIndex,
              id: ++sequence,
              path: insertion.path,
            };
            this.addAnchor(a);
          }
          regionAnchor = a;
          break outer;
        }
        const linked = this.regionLinks.get(r);
        if (
          linked &&
          linked.epoch === regionEpoch &&
          linked.anchor.id > 0 &&
          linked.anchor.path === insertion.path &&
          (linked.anchor.line < line ||
            (linked.anchor.line === line && linked.anchor.column < column))
        ) {
          regionAnchor = linked.anchor;
          this.stats.regionLinkHits++;
          break outer;
        }
        if ((scanned - 1) % checkpointStride === 0) {
          if (checkpoints.length === 256) {
            // Keep samples across the whole scanned prefix as the region grows.
            // Stopping at 256 clustered every link near the original query.
            for (let i = 0; i < checkpoints.length; i += 2)
              checkpoints[i / 2] = checkpoints[i]!;
            checkpoints.length /= 2;
            checkpointStride *= 2;
          }
          if ((scanned - 1) % checkpointStride === 0) checkpoints.push(r);
        }
      }
      if (regionAnchor) {
        let newLinks = 0;
        for (const checkpoint of checkpoints)
          if (!this.regionLinks.has(checkpoint)) newLinks++;
        if (newLinks) this.fit(row, newLinks * REGION_LINK_BYTES);
        for (const checkpoint of checkpoints)
          this.rememberRegion(checkpoint, regionAnchor, regionEpoch);
        region = `${kind}:${regionAnchor.id}`;
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
