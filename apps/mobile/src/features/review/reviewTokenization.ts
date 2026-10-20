import type { HighlighterCore } from "@shikijs/core";

import { scheduleIdle } from "./reviewIdle";

type Grammar = ReturnType<HighlighterCore["getLanguage"]>;
type TokenizeLine = Grammar["tokenizeLine2"];
type TokenOptions = Parameters<HighlighterCore["codeToTokensBase"]>[1];

class TokenizationCutoff extends Error {}

export class IncompleteReviewHighlightingError extends Error {
  readonly _tag = "IncompleteReviewHighlightingError";

  constructor() {
    super("Syntax highlighting remained incomplete after its scheduled retry.");
    this.name = "IncompleteReviewHighlightingError";
  }
}

const fencedGrammars = new WeakSet<Grammar>();

/** Throw before Shiki can associate interrupted tokens with a grammar checkpoint. */
function fenceGrammar(grammar: Grammar, tokenizeLine?: (grammar: Grammar) => TokenizeLine): void {
  if (fencedGrammars.has(grammar)) return;
  const delegate = tokenizeLine?.(grammar) ?? grammar.tokenizeLine2;
  grammar.tokenizeLine2 = function (this: Grammar, ...args: Parameters<TokenizeLine>) {
    const result = delegate.apply(this, args);
    if (result.stoppedEarly) throw new TokenizationCutoff();
    return result;
  };
  fencedGrammars.add(grammar);
}

export function createReviewTokenizer(
  highlighter: HighlighterCore,
  options: {
    readonly schedule?: (callback: () => void) => unknown;
    readonly tokenizeLine?: (grammar: Grammar) => TokenizeLine;
  } = {},
) {
  const schedule = options.schedule ?? scheduleIdle;
  const attempt = (code: string, tokenOptions: TokenOptions, budget: number) => {
    const language = tokenOptions.lang;
    if (language && language !== "text" && language !== "plain" && language !== "plaintext") {
      const grammar = highlighter.getLanguage(language);
      fenceGrammar(grammar, options.tokenizeLine);
    }
    return highlighter.codeToTokensBase(code, { ...tokenOptions, tokenizeTimeLimit: budget });
  };

  return {
    async tokenize(code: string, tokenOptions: TokenOptions) {
      try {
        return attempt(code, tokenOptions, 500);
      } catch (error) {
        if (!(error instanceof TokenizationCutoff)) throw error;
      }
      await new Promise<void>((resolve) => schedule(resolve));
      try {
        // Replay the entire batch from its original complete entry state.
        return attempt(code, tokenOptions, 1_000);
      } catch (error) {
        if (!(error instanceof TokenizationCutoff)) throw error;
        throw new IncompleteReviewHighlightingError();
      }
    },
    read(code: string, tokenOptions: TokenOptions) {
      try {
        return attempt(code, tokenOptions, 500);
      } catch (error) {
        if (!(error instanceof TokenizationCutoff)) throw error;
        return undefined;
      }
    },
  };
}

const tokenizers = new WeakMap<HighlighterCore, ReturnType<typeof createReviewTokenizer>>();

export function getReviewTokenizer(highlighter: HighlighterCore) {
  let tokenizer = tokenizers.get(highlighter);
  if (!tokenizer) {
    tokenizer = createReviewTokenizer(highlighter);
    tokenizers.set(highlighter, tokenizer);
  }
  return tokenizer;
}
