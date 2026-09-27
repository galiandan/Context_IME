import type { IGrammar, IToken, StateStack } from "vscode-textmate";
export type Kind = "code" | "string" | "comment" | "unknown";
export interface Classification {
  kind: Kind;
  region: string;
  reason?: string;
}
export function scopeKind(scopes: readonly string[], language: string): Kind {
  let kind: Kind = "code";
  for (const scope of scopes) {
    if (scope.startsWith("invalid")) {
      // Fixed JS/TS grammar marks the synthetic EOL space as an illegal newline in an open quote.
      // The insertion immediately before that newline is still string content.
      if (
        kind === "string" &&
        /^invalid\.illegal\.newline\.(js|ts)$/.test(scope)
      )
        continue;
      return "unknown";
    }
    if (scope.startsWith("comment")) kind = "comment";
    else if (
      /^(meta\.interpolation|meta\.embedded|source\..+\.embedded)|^meta\.template\.expression/.test(
        scope,
      )
    )
      kind = "code";
    else if (
      scope.startsWith("string") ||
      scope.startsWith("meta.string.quoted")
    )
      // The pinned C/C++ grammars color header-name tokens as strings.
      // They are include paths, not editable prose, even before the closing delimiter.
      kind =
        ((language === "c" || language === "cpp") &&
          /^string\.quoted\.(?:other\.lt-gt|double)\.include\.(?:c|cpp)$/.test(
            scope,
          )) ||
        /regexp|regex/.test(scope) ||
        ((language === "c" || language === "cpp") && /single|char/.test(scope))
          ? "code"
          : "string";
    else if (
      /constant\.character/.test(scope) &&
      (language === "c" || language === "cpp")
    )
      kind = "code";
  }
  return kind;
}
export function scopePath(scopes: readonly string[]): string {
  const clean = scopes.filter((s) => !s.startsWith("punctuation"));
  let end = -1;
  clean.forEach((s, i) => {
    if (
      s.startsWith("string") ||
      s.startsWith("meta.string.quoted") ||
      s.startsWith("comment")
    )
      end = i;
  });
  return clean.slice(0, end + 1).join(" ");
}
function tokenAtLeft(tokens: readonly IToken[], column: number): IToken | undefined {
  let low = 0,
    high = tokens.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (tokens[mid]!.endIndex < column) low = mid + 1;
    else high = mid;
  }
  const token = tokens[low];
  return token && token.startIndex < column ? token : undefined;
}
function tokenAtRight(
  tokens: readonly IToken[],
  column: number,
): IToken | undefined {
  let low = 0,
    high = tokens.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (tokens[mid]!.endIndex <= column) low = mid + 1;
    else high = mid;
  }
  const token = tokens[low];
  return token && token.startIndex <= column ? token : undefined;
}
function insertionToken(token: IToken, language: string) {
  const kind = scopeKind(token.scopes, language);
  return {
    kind,
    path:
      kind === "string" || kind === "comment" ? scopePath(token.scopes) : "",
  };
}
export function atInsertion(
  grammar: IGrammar,
  text: string,
  column: number,
  input: StateStack,
  tokens: IToken[],
  language: string,
  timeLimit = 5,
): { kind: Kind; path: string; reason?: string } {
  const unknown = { kind: "unknown" as const, path: "" };
  if (column < 0 || column > text.length) return unknown;
  const left = tokenAtLeft(tokens, column);
  const right = tokenAtRight(tokens, column);
  // Ordinary content fast path. Delimiters and token boundaries need the same-grammar probe.
  if (
    left === right &&
    left &&
    column > left.startIndex &&
    column < Math.min(left.endIndex, text.length) &&
    !left.scopes.some((s) => /punctuation|escape/.test(s))
  )
    return insertionToken(left, language);
  // A neutral space preserves code/string semantics; never propagate this artificial stack.
  const probe = grammar.tokenizeLine(
    text.slice(0, column) + " " + text.slice(column),
    input,
    timeLimit,
  );
  if (probe.stoppedEarly) return { ...unknown, reason: "tokenizer-timeout" };
  const token = tokenAtRight(probe.tokens, column);
  // Splitting a multi-character delimiter is ambiguous rather than an inferred string.
  if (
    right &&
    column > right.startIndex &&
    right.scopes.some((s) => /punctuation.*(begin|end)/.test(s)) &&
    right.endIndex - right.startIndex > 1
  )
    return unknown;
  return token
    ? insertionToken(token, language)
    : unknown;
}
