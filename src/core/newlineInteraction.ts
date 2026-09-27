interface Position {
  line: number;
  character: number;
}
interface Change {
  range: { start: Position; end: Position };
  text: string;
}
interface Snapshot {
  editor: object;
  version: number;
  position: Position;
}
const same = (a: Position, b: Position) =>
  a.line === b.line && a.character === b.character;
/** A single-use correlation, not permission to process arbitrary unknown selection events. */
export class NewlineInteraction {
  private last?: Snapshot;
  private pending?: Snapshot;
  note(editor: object, version: number, position: Position) {
    this.last = { editor, version, position };
    this.pending = undefined;
  }
  change(
    editor: object,
    version: number,
    changes: readonly Change[],
    eligible: boolean,
    reason: unknown,
  ) {
    this.pending = undefined;
    const last = this.last;
    this.last = undefined;
    const change = changes[0];
    if (
      !eligible ||
      reason !== undefined ||
      !last ||
      last.editor !== editor ||
      last.version + 1 !== version ||
      changes.length !== 1 ||
      !change ||
      !same(change.range.start, change.range.end) ||
      !same(last.position, change.range.start) ||
      !/^\r?\n[\t ]*$/.test(change.text)
    )
      return;
    this.pending = {
      editor,
      version,
      position: {
        line: change.range.start.line + 1,
        character: change.text.split("\n")[1]!.length,
      },
    };
  }
  consume(
    editor: object,
    version: number,
    position: Position,
    kind: unknown,
  ): boolean {
    const pending = this.pending;
    this.pending = undefined;
    return (
      kind === undefined &&
      !!pending &&
      pending.editor === editor &&
      pending.version === version &&
      same(pending.position, position)
    );
  }
  reset() {
    this.last = undefined;
    this.pending = undefined;
  }
}
