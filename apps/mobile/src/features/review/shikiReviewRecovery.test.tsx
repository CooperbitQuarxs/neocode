import type { HighlighterCore } from "@shikijs/core";
import * as Cause from "effect/Cause";
import type * as Atom from "effect/unstable/reactivity/Atom";
import { AtomRegistry } from "effect/unstable/reactivity";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useHighlightedCode, type HighlightedCode } from "../../../modules/t3-markdown-text/src/useHighlightedCode";
import { highlightNativeReviewDiffVisibleRows } from "../diffs/nativeReviewDiffHighlighter";
import type { NativeReviewDiffFile } from "../diffs/nativeReviewDiffTypes";
import type { NativeReviewDiffRow } from "../diffs/nativeReviewDiffSurface";
import { createSourceHighlightAtomFamily } from "../files/sourceHighlightingState";
import { createMarkdownCodeHighlightAtomFamily } from "../threads/markdownCodeHighlightState";
import type { ReviewRenderableLineRow } from "./reviewModel";
import { IncompleteReviewHighlightingError } from "./reviewTokenization";
import { highlightCodeSnippet, highlightReviewSelectedLines, highlightSourceFile } from "./shikiReviewHighlighter";

type Grammar = ReturnType<HighlighterCore["getLanguage"]>;
type RawResult = ReturnType<Grammar["tokenizeLine2"]>;

const control = vi.hoisted(() => ({
  cutoff: undefined as ((line: string, budget: number | undefined) => boolean) | undefined,
  jobs: [] as Array<() => void>,
  waiters: [] as Array<(job: () => void) => void>,
  calls: [] as Array<{ line: string; budget: number | undefined }>,
}));

vi.mock("./reviewIdle", () => ({
  scheduleIdle(callback: () => void) {
    const waiter = control.waiters.shift();
    if (waiter) waiter(callback);
    else control.jobs.push(callback);
    return 0;
  },
}));

// Exercise the native adapter entry without claiming a native engine/device measurement.
vi.mock("react-native-shiki-engine", async () => {
  const { createJavaScriptRegexEngine } = await import("@shikijs/engine-javascript");
  return { isNativeEngineAvailable: () => true, createNativeEngine: createJavaScriptRegexEngine };
});

vi.mock("@shikijs/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shikijs/core")>();
  return {
    ...actual,
    createHighlighterCore: async (...args: Parameters<typeof actual.createHighlighterCore>) => {
      const highlighter = await actual.createHighlighterCore(...args);
      const getLanguage = highlighter.getLanguage;
      const injected = new WeakSet<Grammar>();
      highlighter.getLanguage = (...languageArgs) => {
        const grammar = getLanguage(...languageArgs);
        if (!injected.has(grammar)) {
          const original = grammar.tokenizeLine2;
          grammar.tokenizeLine2 = function (...tokenArgs) {
            // The test controls cutoff outcomes, not elapsed wall time.
            const result: RawResult = original.call(this, tokenArgs[0], tokenArgs[1], 0);
            control.calls.push({ line: tokenArgs[0], budget: tokenArgs[2] });
            return control.cutoff?.(tokenArgs[0], tokenArgs[2])
              ? { ...result, tokens: result.tokens.slice(0, 2), stoppedEarly: true }
              : result;
          };
          injected.add(grammar);
        }
        return grammar;
      };
      return highlighter;
    },
  };
});

const code = "const answer: number = 42;";
const input = { code, language: "ts", theme: "dark" as const };
const sourceInput = { path: "answer.ts", contents: code, theme: "dark" as const };

function takeJob(): Promise<() => void> {
  const job = control.jobs.shift();
  return job ? Promise.resolve(job) : new Promise((resolve) => control.waiters.push(resolve));
}

function cutOnce(target = code) {
  let armed = true;
  control.cutoff = (line) => {
    if (!armed || line !== target) return false;
    armed = false;
    return true;
  };
}

function terminalAtom<A, E>(
  registry: ReturnType<typeof AtomRegistry.make>,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
) {
  return new Promise<AsyncResult.AsyncResult<A, E>>((resolve) => {
    const stop = registry.subscribe(atom, (value) => {
      if (AsyncResult.isSuccess(value) || AsyncResult.isFailure(value)) {
        stop();
        resolve(value);
      }
    });
  });
}

beforeEach(() => {
  control.calls.length = 0;
  control.jobs.length = 0;
  control.waiters.length = 0;
  control.cutoff = undefined;
});
afterEach(() => {
  control.cutoff = undefined;
  vi.unstubAllGlobals();
});

describe("complete mobile highlighting consumers", () => {
  it("keeps the real source atom pending until unchanged content recovers", async () => {
    const expected = await highlightSourceFile(sourceInput);
    cutOnce();
    const registry = AtomRegistry.make();
    const atom = createSourceHighlightAtomFamily()(sourceInput);
    const unmount = registry.mount(atom);
    const completed = terminalAtom(registry, atom);
    try {
      const retry = await takeJob();
      expect(AsyncResult.isSuccess(registry.get(atom))).toBe(false);
      retry();
      const result = await completed;
      expect(AsyncResult.isSuccess(result)).toBe(true);
      if (AsyncResult.isSuccess(result)) expect(result.value).toEqual(expected);
      expect(control.calls.filter((call) => call.line === code).map((call) => call.budget)).toEqual([500, 500, 1_000]);
      expect(registry.get(atom)).toEqual(result);
    } finally {
      unmount();
      registry.dispose();
    }
  });

  it("keeps the real Markdown atom pending instead of caching a partial snippet", async () => {
    const expected = await highlightCodeSnippet(input);
    cutOnce();
    const registry = AtomRegistry.make();
    const atom = createMarkdownCodeHighlightAtomFamily()({ ...input, enabled: true });
    const unmount = registry.mount(atom);
    const completed = terminalAtom(registry, atom);
    try {
      const retry = await takeJob();
      expect(AsyncResult.isSuccess(registry.get(atom))).toBe(false);
      retry();
      const result = await completed;
      expect(AsyncResult.isSuccess(result)).toBe(true);
      if (AsyncResult.isSuccess(result)) expect(result.value).toEqual(expected);
    } finally {
      unmount();
      registry.dispose();
    }
  });

  it("recovers ordinary snippets and independently interrupted selected addition/deletion requests", async () => {
    const expected = await highlightCodeSnippet(input);
    cutOnce();
    const snippet = highlightCodeSnippet(input);
    (await takeJob())();
    expect(await snippet).toEqual(expected);

    const lines: ReviewRenderableLineRow[] = [
      { kind: "line", id: "add", oldLineNumber: null, newLineNumber: 1, content: code, change: "add", additionTokenIndex: 0, deletionTokenIndex: null, comparison: null },
      { kind: "line", id: "delete", oldLineNumber: 1, newLineNumber: null, content: "const before: number = 41;", change: "delete", additionTokenIndex: null, deletionTokenIndex: 0, comparison: null },
    ];
    const request = { filePath: "answer.ts", lines, theme: "dark" as const };
    const selectedExpected = await highlightReviewSelectedLines(request);
    const stopped = new Set<string>();
    control.cutoff = (line) => {
      if (stopped.has(line)) return false;
      stopped.add(line);
      return true;
    };
    const selected = highlightReviewSelectedLines(request);
    const additionRetry = await takeJob();
    const deletionRetry = await takeJob();
    deletionRetry();
    additionRetry();
    expect(await selected).toEqual(selectedExpected);
  });

  it.each(["javascript", "native"] as const)(
    "withholds cacheable native-review row patches until %s tokenization completes",
    async (engine) => {
      const files: NativeReviewDiffFile[] = [
        { id: "file", path: "answer.ts", language: "typescript", additions: 1, deletions: 0 },
      ];
      const rows: NativeReviewDiffRow[] = [
        { kind: "line", id: "row", fileId: "file", content: code, change: "add", oldLineNumber: null, newLineNumber: 1 },
      ];
      const request = { files, rows, engine, scheme: "dark" as const, firstRowIndex: 0, lastRowIndex: 0 };
      const expected = await highlightNativeReviewDiffVisibleRows(request);
      cutOnce();
      let fulfilled: Awaited<ReturnType<typeof highlightNativeReviewDiffVisibleRows>> | undefined;
      const pending = highlightNativeReviewDiffVisibleRows(request).then((result) => {
        fulfilled = result;
        return result;
      });
      const retry = await takeJob();
      expect(fulfilled).toBeUndefined();
      retry();
      expect((await pending).tokensByRowId).toEqual(expected.tokensByRowId);
      expect(fulfilled?.tokensByRowId).toEqual(expected.tokensByRowId);

      control.cutoff = () => true;
      const incomplete = highlightNativeReviewDiffVisibleRows(request);
      const rejected = expect(incomplete).rejects.toBeInstanceOf(IncompleteReviewHighlightingError);
      (await takeJob())();
      await rejected;
      expect(control.jobs).toHaveLength(0);
      control.cutoff = undefined;
      expect((await highlightNativeReviewDiffVisibleRows(request)).tokensByRowId).toEqual(expected.tokensByRowId);
    },
  );

  it("fences a newly admitted grammar before its first snippet tokenization", async () => {
    const pythonCode = "answer = 42";
    cutOnce(pythonCode);
    const request = { ...input, code: pythonCode, language: "py" };
    const pending = highlightCodeSnippet(request);
    (await takeJob())();
    const recovered = await pending;
    expect(recovered).toEqual(await highlightCodeSnippet(request));
    expect(recovered.flat().map((token) => token.content).join("")).toBe(pythonCode);
    expect(control.calls.slice(0, 2).map((call) => call.budget)).toEqual([500, 1_000]);
  });

  it("retries a source batch without replaying earlier batches or losing multiline state", async () => {
    const contents = "/* start\n" + "comment\n".repeat(199) + "closing */\nconst n = 1;";
    const request = { ...sourceInput, contents };
    const expected = await highlightCodeSnippet({ ...input, code: contents, session: {} });
    control.calls.length = 0;
    cutOnce("closing */");
    const pending = highlightSourceFile(request);
    (await takeJob())();
    expect(await pending).toEqual(expected);
    expect(control.calls.filter((call) => call.line === "/* start")).toHaveLength(1);
    expect(control.calls.filter((call) => call.line === "closing */").map((call) => call.budget)).toEqual([500, 1_000]);
  });

  it("reports persistent cutoff through the source atom failure path without retrying forever", async () => {
    control.cutoff = () => true;
    const registry = AtomRegistry.make();
    const atom = createSourceHighlightAtomFamily()(sourceInput);
    const unmount = registry.mount(atom);
    const completed = terminalAtom(registry, atom);
    try {
      (await takeJob())();
      const result = await completed;
      expect(AsyncResult.isFailure(result)).toBe(true);
      if (AsyncResult.isFailure(result)) {
        expect(Cause.squash(result.cause)).toEqual(
          expect.objectContaining({ cause: expect.any(IncompleteReviewHighlightingError) }),
        );
      }
      expect(control.jobs).toHaveLength(0);
      expect(control.calls.map((call) => call.budget)).toEqual([500, 1_000]);
      control.cutoff = undefined;
      expect(await highlightSourceFile(sourceInput)).toEqual(await highlightCodeSnippet(input));
    } finally {
      unmount();
      registry.dispose();
    }
  });

  it("rejects persistent snippet cutoff with its typed incomplete error", async () => {
    control.cutoff = () => true;
    const pending = highlightCodeSnippet(input);
    const failure = expect(pending).rejects.toBeInstanceOf(IncompleteReviewHighlightingError);
    (await takeJob())();
    await failure;
    expect(control.jobs).toHaveLength(0);
  });

  it("keeps the 1,000-character boundary eligible and skips only the intentional long line", async () => {
    const eligible = "const answer = 42;".padEnd(1_000, " ");
    const long = "x".repeat(1_001);
    const expected = await highlightCodeSnippet({ ...input, code: eligible });
    control.calls.length = 0;
    cutOnce(eligible);
    const pending = highlightSourceFile({ ...sourceInput, contents: `${long}\n${eligible}` });
    (await takeJob())();
    expect(await pending).toEqual([[{ content: long, color: null, fontStyle: null }], ...expected]);
    expect(control.calls.map((call) => call.line)).toEqual([eligible, eligible]);
    control.cutoff = () => true;
    expect(await highlightCodeSnippet({ ...input, language: "unknown-language" })).toEqual([
      [{ content: code, color: null, fontStyle: null }],
    ]);
  });

  it("commits complete recovered tokens through the native Markdown hook and reuses only that result", async () => {
    const hookCode = code + "\nconst seed = true;";
    const expected = await highlightCodeSnippet({ ...input, code: hookCode });
    const document = { nodeType: 9, addEventListener() {}, removeEventListener() {} };
    const container = { nodeType: 1, tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: document, addEventListener() {}, removeEventListener() {} };
    vi.stubGlobal("document", document);
    vi.stubGlobal("window", { document, HTMLIFrameElement: EventTarget });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const root = createRoot(container as unknown as HTMLElement);
    let committed: HighlightedCode | null = null;
    let renders = 0;
    function Probe({ source = hookCode }: { source?: string }) {
      const tokens = useHighlightedCode(source, "ts", "dark", highlightCodeSnippet);
      useLayoutEffect(() => { committed = tokens; renders += 1; });
      return null;
    }
    cutOnce();
    try {
      await act(() => root.render(<Probe />));
      const retry = await takeJob();
      expect(committed).toBeNull();
      const pendingRenders = renders;
      await act(async () => retry());
      expect(committed).toEqual(expected);
      expect(renders).toBeGreaterThan(pendingRenders);
      const calls = control.calls.length;
      await act(() => root.render(<Probe />));
      expect(committed).toEqual(expected);
      expect(control.calls).toHaveLength(calls);

      const tail = "const more = 1;";
      const appended = hookCode + "\n" + tail;
      const appendedExpected = await highlightCodeSnippet({ ...input, code: appended });
      control.calls.length = 0;
      control.cutoff = (line, budget) => line === tail && budget === 500;
      await act(() => root.render(<Probe source={appended} />));
      const appendRetry = await takeJob();
      expect(committed).not.toEqual(appendedExpected);
      expect(control.jobs).toHaveLength(0);
      await act(async () => appendRetry());
      expect(committed).toEqual(appendedExpected);
      expect(control.calls.filter((call) => call.line === tail).map((call) => call.budget)).toEqual([500, 500, 1_000]);

      const persistentCode = "const persistent = true;";
      const persistentExpected = await highlightCodeSnippet({ ...input, code: persistentCode });
      control.cutoff = () => true;
      await act(() => root.render(<Probe source={persistentCode} />));
      const persistentRetry = await takeJob();
      await act(async () => persistentRetry());
      expect(committed).toBeNull();
      expect(control.jobs).toHaveLength(0);
      control.cutoff = undefined;
      await act(() => root.render(<Probe key="recovered" source={persistentCode} />));
      expect(committed).toEqual(persistentExpected);
    } finally {
      await act(() => root.unmount());
    }
  });
});
