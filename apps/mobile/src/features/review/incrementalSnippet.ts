import type { HighlighterCore } from "@shikijs/core";

import { getReviewTokenizer } from "./reviewTokenization";

type Tokens = ReturnType<HighlighterCore["codeToTokensBase"]>;
type TokenRequest = {
  code: string;
  options: Parameters<HighlighterCore["codeToTokensBase"]>[1];
};

/** A code block owns this session. Only completed lines survive the next update. */
export function createIncrementalSnippet(
  highlighter: HighlighterCore,
  language: string,
  theme: string,
  tokenizer = getReviewTokenizer(highlighter),
) {
  const options = { lang: language, theme };
  let cached:
    | {
        prefix: string;
        tokens: Tokens;
        state: ReturnType<HighlighterCore["getLastGrammarState"]>;
      }
    | undefined;
  let revision = 0;

  function* tokenize(code: string): Generator<TokenRequest | undefined, Tokens, Tokens> {
    const currentRevision = ++revision;
    const previous = cached && code.startsWith(cached.prefix) ? cached : undefined;
    const end = code.lastIndexOf("\n") + 1;
    let state = previous?.state;
    const tokens = [...(previous?.tokens ?? [])];
    const completed = code.slice(previous?.prefix.length ?? 0, end);
    if (completed) {
      const lines = completed.slice(0, -1).split("\n");
      for (let offset = 0; offset < lines.length; offset += 200) {
        const batch = yield {
          code: lines.slice(offset, offset + 200).join("\n"),
          options: { ...options, ...(state ? { grammarState: state } : {}) },
        };
        state = highlighter.getLastGrammarState(batch);
        tokens.push(...batch);
        if (offset + 200 < lines.length) yield;
      }
    }
    if (currentRevision === revision) {
      cached = state ? { prefix: code.slice(0, end), tokens, state } : undefined;
    }
    const tail = yield {
      code: code.slice(end),
      options: { ...options, ...(state ? { grammarState: state } : {}) },
    };
    return [...tokens, ...tail];
  }
  const highlight = async (code: string) => {
    const work = tokenize(code);
    let next = work.next();
    while (!next.done) {
      if (next.value) {
        const { code, options } = next.value;
        next = work.next(await tokenizer.tokenize(code, options));
      } else {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        next = work.next();
      }
    }
    return next.value;
  };
  // A small append can finish during render. A cutoff neither escapes render
  // nor schedules recovery; the existing asynchronous effect owns that work.
  highlight.read = (code: string) => {
    if (!cached || !code.startsWith(cached.prefix)) return undefined;
    const tail = code.slice(cached.prefix.length);
    if (tail.length > 2_000 || tail.split("\n").length > 200) return undefined;
    const work = tokenize(code);
    let next = work.next();
    while (!next.done) {
      if (!next.value) return undefined;
      const batch = tokenizer.read(next.value.code, next.value.options);
      if (!batch) return undefined;
      next = work.next(batch);
    }
    return next.value;
  };
  return highlight;
}
