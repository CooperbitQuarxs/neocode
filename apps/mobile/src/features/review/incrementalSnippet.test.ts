import { createHighlighterCore } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import typescript from "@shikijs/langs/typescript";
import dark from "@shikijs/themes/github-dark-default";
import { describe, expect, it } from "vite-plus/test";

import { createIncrementalSnippet } from "./incrementalSnippet";
import { highlightCodeSnippet } from "./shikiReviewHighlighter";
import { createReviewTokenizer, IncompleteReviewHighlightingError } from "./reviewTokenization";

const highlighter = await createHighlighterCore({
  langs: [typescript],
  themes: [dark],
  engine: createJavaScriptRegexEngine(),
});
const rendered = (lines: ReturnType<typeof highlighter.codeToTokensBase>) =>
  lines.map((line) => line.map(({ content, color, fontStyle }) => ({ content, color, fontStyle })));
const options = { lang: "typescript", theme: "github-dark-default" };

describe("incremental snippet highlighting", () => {
  it("matches full highlighting through partial lines, multiline syntax, edits and truncation", async () => {
    const highlight = createIncrementalSnippet(highlighter, options.lang, options.theme);
    const source = "/* comment\nstill comment */\nconst text = `first\nsecond ${42}`;\n";
    for (let end = 1; end <= source.length; end++) {
      const code = source.slice(0, end);
      expect(rendered(highlight.read(code) ?? (await highlight(code)))).toEqual(
        rendered(highlighter.codeToTokensBase(code, options)),
      );
    }
    for (const code of ['const other = "new";\n', "const other", source, source.slice(0, 20)]) {
      expect(rendered(highlight.read(code) ?? (await highlight(code)))).toEqual(
        rendered(highlighter.codeToTokensBase(code, options)),
      );
    }
  });

  it("carries grammar state across batches and overlapping updates", async () => {
    const highlight = createIncrementalSnippet(highlighter, options.lang, options.theme);
    const code = "/*\n" + "still a comment\n".repeat(410) + "*/\nconst value = 42;";
    const first = highlight(code);
    const next = highlight("const changed = true;\n");
    expect(rendered(await first)).toEqual(rendered(highlighter.codeToTokensBase(code, options)));
    expect(rendered(await next)).toEqual(
      rendered(highlighter.codeToTokensBase("const changed = true;\n", options)),
    );
    const last = 'const changed = true;\nconst tail = "ok";';
    expect(rendered(await highlight(last))).toEqual(
      rendered(highlighter.codeToTokensBase(last, options)),
    );
  });

  it("reuses completed token rows on warm reads and falls back for large updates", async () => {
    const session = {};
    const input = { language: "ts", theme: "dark" as const, session };
    const code = "const a = 1;\nconst b = 2;";
    expect(highlightCodeSnippet.read({ ...input, code })).toBeUndefined();
    const first = await highlightCodeSnippet({ ...input, code });
    const nextCode = code + "\nconst c = 3;";
    const next = highlightCodeSnippet.read({ ...input, code: nextCode })!;
    expect(next[0]).toBe(first[0]);
    expect(next).toEqual(
      await highlightCodeSnippet({ code: nextCode, language: "ts", theme: "dark" }),
    );
    expect(
      highlightCodeSnippet.read({ ...input, code: nextCode + "\n" + "const x = 1;\n".repeat(210) }),
    ).toBeUndefined();
    expect(highlightCodeSnippet.read({ ...input, code: nextCode, theme: "light" })).toBeUndefined();
  });

  it("resets session on language, theme, CRLF, long-line and empty input changes", async () => {
    const session = {};
    const cases = [
      { code: "/* hello\nworld */", language: "ts", theme: "dark" as const },
      { code: "/* hello\nworld */\nconst n = 3;", language: "ts", theme: "light" as const },
      { code: "hello\nworld", language: "text", theme: "light" as const },
      { code: "const n = 2;\r\nconst m = 3;", language: "ts", theme: "dark" as const },
      { code: "a".repeat(1100), language: "ts", theme: "dark" as const },
      { code: "", language: "ts", theme: "dark" as const },
      { code: "const fresh = true;\n", language: "ts", theme: "dark" as const },
    ];
    for (const input of cases)
      expect(await highlightCodeSnippet({ ...input, session })).toEqual(
        await highlightCodeSnippet(input),
      );
  });
});

async function recoverySession() {
  const engine = await createHighlighterCore({
    langs: [typescript],
    themes: [dark],
    engine: createJavaScriptRegexEngine(),
  });
  let cutoff: (line: string, budget: number | undefined) => boolean = () => false;
  const jobs: Array<() => void> = [];
  const waiters: Array<(job: () => void) => void> = [];
  const calls: Array<{ line: string; budget: number | undefined }> = [];
  const tokenizer = createReviewTokenizer(engine, {
    schedule: (job) => {
      const waiter = waiters.shift();
      if (waiter) waiter(job);
      else jobs.push(job);
    },
    tokenizeLine: (grammar) => {
      const original = grammar.tokenizeLine2;
      return function (this: typeof grammar, ...args: Parameters<typeof original>) {
        // Keep wall-clock scheduling out of this injected cutoff test.
        const result = original.call(this, args[0], args[1], 0);
        calls.push({ line: args[0], budget: args[2] });
        return cutoff(args[0], args[2])
          ? {
              ...result,
              tokens: result.tokens.slice(0, 2),
              ruleStack: original.call(this, "/*", null, 0).ruleStack,
              stoppedEarly: true,
            }
          : result;
      };
    },
  });
  return {
    engine,
    highlight: createIncrementalSnippet(engine, options.lang, options.theme, tokenizer),
    arm: (next: typeof cutoff) => {
      cutoff = next;
    },
    calls,
    jobs,
    takeJob: () => {
      const job = jobs.shift();
      return job
        ? Promise.resolve(job)
        : new Promise<() => void>((resolve) => waiters.push(resolve));
    },
  };
}

describe("incremental cutoff checkpoints", () => {
  it("replays a stopped completed prefix and appends from only its recovered state", async () => {
    const session = await recoverySession();
    try {
      const code = "/* comment\nstill comment */\nconst text = `first\nsecond ${42}`;\n";
      const expected = rendered(highlighter.codeToTokensBase(code, options));
      let armed = true;
      session.arm((line) => {
        if (!armed || line !== "still comment */") return false;
        armed = false;
        return true;
      });
      const pending = session.highlight(code);
      const retry = await session.takeJob();
      // No interrupted prefix/checkpoint can make this a warm synchronous hit.
      expect(session.highlight.read(code)).toBeUndefined();
      retry();
      expect(rendered(await pending)).toEqual(expected);
      const appended = code + "const tail = text;\n";
      expect(rendered(await session.highlight(appended))).toEqual(
        rendered(highlighter.codeToTokensBase(appended, options)),
      );
    } finally {
      session.engine.dispose();
    }
  });

  it("does not let a superseded recovering prefix overwrite a newer revision", async () => {
    const session = await recoverySession();
    try {
      let armed = true;
      session.arm((line) => {
        if (!armed || line !== "still comment */") return false;
        armed = false;
        return true;
      });
      const oldCode = "/* comment\nstill comment */\nconst old = true;";
      const old = session.highlight(oldCode);
      const retry = await session.takeJob();
      const newer = "const current = true;\n";
      await session.highlight(newer);
      retry();
      expect(rendered(await old)).toEqual(rendered(highlighter.codeToTokensBase(oldCode, options)));
      expect(session.highlight.read(oldCode)).toBeUndefined();
      const appended = newer + "const next = current;";
      const read = session.highlight.read(appended);
      expect(read).toBeDefined();
      expect(rendered(read!)).toEqual(rendered(highlighter.codeToTokensBase(appended, options)));
    } finally {
      session.engine.dispose();
    }
  });

  it("returns unavailable on a synchronous cutoff without scheduling or caching stopped state", async () => {
    const session = await recoverySession();
    try {
      const prefix = "const current = true;\n";
      await session.highlight(prefix);
      const code = prefix + "const answer: number = 42;";
      session.arm(() => true);
      expect(session.highlight.read(code)).toBeUndefined();
      expect(session.jobs).toHaveLength(0);
      const pending = session.highlight(code);
      const rejected = expect(pending).rejects.toBeInstanceOf(IncompleteReviewHighlightingError);
      (await session.takeJob())();
      await rejected;
      expect(session.jobs).toHaveLength(0);
      session.arm(() => false);
      const read = session.highlight.read(code);
      expect(read).toBeDefined();
      expect(rendered(read!)).toEqual(rendered(highlighter.codeToTokensBase(code, options)));
    } finally {
      session.engine.dispose();
    }
  });

  it("retries only the interrupted batch from its complete 200-line entry checkpoint", async () => {
    const session = await recoverySession();
    try {
      const code = "/* start\n" + "comment\n".repeat(199) + "closing */\nconst n = 1;";
      let armed = true;
      session.arm((line) => {
        if (!armed || line !== "closing */") return false;
        armed = false;
        return true;
      });
      const pending = session.highlight(code);
      (await session.takeJob())();
      expect(rendered(await pending)).toEqual(
        rendered(highlighter.codeToTokensBase(code, options)),
      );
      expect(session.calls.filter((call) => call.line === "/* start")).toHaveLength(1);
      expect(
        session.calls.filter((call) => call.line === "closing */").map((call) => call.budget),
      ).toEqual([500, 1_000]);
    } finally {
      session.engine.dispose();
    }
  });

  it("does not reclassify or retry ordinary grammar failures", async () => {
    const session = await recoverySession();
    try {
      const error = new Error("grammar failed");
      session.arm(() => {
        throw error;
      });
      await expect(session.highlight("const value = 1;")).rejects.toBe(error);
      expect(session.jobs).toHaveLength(0);
    } finally {
      session.engine.dispose();
    }
  });
});
