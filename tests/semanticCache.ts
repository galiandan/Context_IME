import { DocumentCache, type DocumentView } from "../src/context/cache";
import type { IGrammar } from "vscode-textmate";

// Semantic fixtures must not depend on CI load or lazy regex compilation.
// Runtime limits stay enabled in production and are tested independently.
export class SemanticCache extends DocumentCache {
  constructor(document: DocumentView, grammar?: IGrammar, budgetMs = Infinity) {
    super(document, grammar, budgetMs, 0);
  }
}
