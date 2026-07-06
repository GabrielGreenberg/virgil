// @vitest-environment jsdom
//
// Unit tests for useDiagnostics (P5 item 4 — per-doc diagnostics apparatus).
//
// We mock ONLY `@/hooks/useLatexLint` so the lint output is deterministic and we
// avoid its heavy async unified-latex dynamic import. Everything else
// (mergeLatexErrors / findParagraphUuids / paragraphForLine / pruneExpanded /
// pruneDismissed) is REAL — they're pure.
//
// The `sourceText` fixture embeds `%!v:<4-hex>` paragraph sidecar comments so
// `findParagraphUuids` resolves line ranges (see src/lib/latex-paragraph-map.ts:
// a UUID block runs from the first non-empty content line up to and including the
// line carrying the `%!v:<hex>` marker).

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { RefObject } from "react";

import { makeErrorId, type LatexError } from "@/lib/latex-errors";

// ── Controllable lint output ────────────────────────────────────────────────
let MOCK_LINT_ERRORS: LatexError[] = [];
const useLatexLintMock = vi.fn(() => MOCK_LINT_ERRORS);
vi.mock("@/hooks/useLatexLint", () => ({
  useLatexLint: () => useLatexLintMock(),
}));

import { useDiagnostics } from "../useDiagnostics";
import type {
  UseDiagnosticsOptions,
  DiagnosticsEditorHandle,
} from "../useDiagnostics";
import type { Editor } from "@tiptap/react";

// ── Fixture source ──────────────────────────────────────────────────────────
// Line 1: content line for paragraph aaaa (start)
// Line 2: the %!v:aaaa marker (end)         → range aaaa = [1, 2]
// Line 3: blank (resets the block)
// Line 4: content line for paragraph bbbb (start)
// Line 5: the %!v:bbbb marker (end)         → range bbbb = [4, 5]
// Line 6: a very long line (>140 chars) to exercise snippet truncation
const LONG_LINE = "L".repeat(200);
const SOURCE_TEXT = [
  "First paragraph body text here.", // 1
  "More of paragraph one. %!v:aaaa", // 2
  "", // 3
  "Second paragraph body.", // 4
  "End of paragraph two. %!v:bbbb", // 5
  LONG_LINE, // 6
].join("\n");

// Errors keyed to known lines in SOURCE_TEXT.
function lintErr(line: number, message: string, detail?: string): LatexError {
  return {
    id: makeErrorId({ source: "lint", line, message, ordinal: line }),
    source: "lint",
    severity: "warning",
    line,
    message,
    detail,
  };
}
function compileErr(line: number, message: string): LatexError {
  return {
    id: makeErrorId({ source: "compile", line, message, ordinal: line, salt: "r1" }),
    source: "compile",
    severity: "error",
    line,
    message,
  };
}

// ── Fake editor handle ──────────────────────────────────────────────────────
function makeHandleRef(editor: Editor | null): {
  ref: RefObject<DiagnosticsEditorHandle | null>;
  scrollToParagraphId: ReturnType<typeof vi.fn>;
} {
  const scrollToParagraphId = vi.fn<(paragraphId: string) => void>();
  const handle: DiagnosticsEditorHandle = {
    getEditor: () => editor,
    scrollToParagraphId,
  };
  return { ref: { current: handle }, scrollToParagraphId };
}

function baseOptions(
  overrides: Partial<UseDiagnosticsOptions> = {},
): UseDiagnosticsOptions {
  return {
    editor: null,
    editorHandleRef: makeHandleRef(null).ref,
    sourceText: SOURCE_TEXT,
    compileErrors: [],
    knownBibKeys: [],
    ...overrides,
  };
}

beforeEach(() => {
  MOCK_LINT_ERRORS = [];
  useLatexLintMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useDiagnostics", () => {
  it("allLatexErrors merges lint + compile per mergeLatexErrors", () => {
    // lint on line 4, compile on line 6 → both survive (different lines), sorted.
    MOCK_LINT_ERRORS = [lintErr(4, "lint on 4")];
    const compile = [compileErr(6, "compile on 6")];
    const { result } = renderHook(() =>
      useDiagnostics(baseOptions({ compileErrors: compile })),
    );

    const all = result.current.allLatexErrors;
    expect(all.map((e) => e.message)).toEqual(["lint on 4", "compile on 6"]);
    expect(all.map((e) => e.source)).toEqual(["lint", "compile"]);

    // A lint diagnostic on the SAME line as a compile one is dropped (compiler
    // authoritative) — verify the merge rule directly.
    MOCK_LINT_ERRORS = [lintErr(6, "lint on 6 dropped")];
    const { result: r2 } = renderHook(() =>
      useDiagnostics(baseOptions({ compileErrors: [compileErr(6, "compile on 6")] })),
    );
    expect(r2.current.allLatexErrors.map((e) => e.message)).toEqual(["compile on 6"]);
  });

  it("errorSnippets maps each error id to the trimmed source line, truncated at 140 chars", () => {
    const err4 = lintErr(4, "on 4");
    const err6 = lintErr(6, "long line");
    MOCK_LINT_ERRORS = [err4, err6];
    const { result } = renderHook(() => useDiagnostics(baseOptions()));

    const snippets = result.current.errorSnippets;
    // Line 4 = "Second paragraph body." (trimmed, short).
    expect(snippets.get(err4.id)).toBe("Second paragraph body.");
    // Line 6 = 200 'L's → truncated to 140 chars + ellipsis.
    const long = snippets.get(err6.id)!;
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBe(141); // 140 chars + the ellipsis
    expect(long.slice(0, 140)).toBe("L".repeat(140));
  });

  it("paragraphByErrorId maps errors whose line falls in a %!v: range to that uuid", () => {
    // line 1 → aaaa (range [1,2]); line 5 → bbbb (range [4,5]); line 6 → none.
    const eA = lintErr(1, "in aaaa");
    const eB = lintErr(5, "in bbbb");
    const eNone = lintErr(6, "outside any range");
    MOCK_LINT_ERRORS = [eA, eB, eNone];
    const { result } = renderHook(() => useDiagnostics(baseOptions()));

    const map = result.current.paragraphByErrorId;
    expect(map.get(eA.id)).toBe("aaaa");
    expect(map.get(eB.id)).toBe("bbbb");
    expect(map.has(eNone.id)).toBe(false);
  });

  it("dismissError adds to dismissedErrorIds, clears matching selection, prunes expansion", () => {
    const e = lintErr(4, "dismiss me");
    MOCK_LINT_ERRORS = [e];
    const { result } = renderHook(() => useDiagnostics(baseOptions()));

    // Select + expand the error first.
    act(() => {
      result.current.setSelectedErrorId(e.id);
      result.current.expandError(e.id);
    });
    expect(result.current.selectedErrorId).toBe(e.id);
    expect(result.current.expandedErrorIds.has(e.id)).toBe(true);

    act(() => {
      result.current.dismissError(e.id);
    });
    expect(result.current.dismissedErrorIds.has(e.id)).toBe(true);
    // Selection cleared because it matched.
    expect(result.current.selectedErrorId).toBeNull();
    // Expansion pruned for the dismissed card.
    expect(result.current.expandedErrorIds.has(e.id)).toBe(false);
  });

  it("dismissError does NOT clear a non-matching selection", () => {
    const e1 = lintErr(1, "one");
    const e2 = lintErr(4, "two");
    MOCK_LINT_ERRORS = [e1, e2];
    const { result } = renderHook(() => useDiagnostics(baseOptions()));

    act(() => {
      result.current.setSelectedErrorId(e1.id);
    });
    act(() => {
      result.current.dismissError(e2.id);
    });
    // e1 stays selected — only a matching id clears.
    expect(result.current.selectedErrorId).toBe(e1.id);
  });

  it("expandError is idempotent; toggleErrorExpanded flips on/off", () => {
    const e = lintErr(4, "expand");
    MOCK_LINT_ERRORS = [e];
    const { result } = renderHook(() => useDiagnostics(baseOptions()));

    act(() => {
      result.current.expandError(e.id);
    });
    const setAfterFirstAdd = result.current.expandedErrorIds;
    expect(setAfterFirstAdd.has(e.id)).toBe(true);

    // Idempotent add → same set identity (no churn).
    act(() => {
      result.current.expandError(e.id);
    });
    expect(result.current.expandedErrorIds).toBe(setAfterFirstAdd);

    // Toggle off, then on.
    act(() => {
      result.current.toggleErrorExpanded(e.id);
    });
    expect(result.current.expandedErrorIds.has(e.id)).toBe(false);
    act(() => {
      result.current.toggleErrorExpanded(e.id);
    });
    expect(result.current.expandedErrorIds.has(e.id)).toBe(true);
  });

  it("pruneDismissed effect drops a dismissed id once it's gone from the live list", () => {
    const e = lintErr(4, "will disappear");
    MOCK_LINT_ERRORS = [e];
    const { result, rerender } = renderHook(
      (props: UseDiagnosticsOptions) => useDiagnostics(props),
      { initialProps: baseOptions() },
    );

    act(() => {
      result.current.dismissError(e.id);
    });
    expect(result.current.dismissedErrorIds.has(e.id)).toBe(true);

    // The error is now GONE from the live list (a different error surfaces).
    const other = lintErr(1, "different error");
    MOCK_LINT_ERRORS = [other];
    act(() => {
      rerender(baseOptions());
    });
    // Its dismissal is pruned (the id is absent from the non-empty live set).
    expect(result.current.dismissedErrorIds.has(e.id)).toBe(false);
  });

  it("pruneDismissed empty-list guard: a dismissal survives a transient empty error list", () => {
    const e = lintErr(4, "dismiss then empty");
    MOCK_LINT_ERRORS = [e];
    const { result, rerender } = renderHook(
      (props: UseDiagnosticsOptions) => useDiagnostics(props),
      { initialProps: baseOptions() },
    );

    act(() => {
      result.current.dismissError(e.id);
    });
    expect(result.current.dismissedErrorIds.has(e.id)).toBe(true);

    // Live error list goes transiently EMPTY (mid-compile). The guard must NOT
    // wipe the session dismissal.
    MOCK_LINT_ERRORS = [];
    act(() => {
      rerender(baseOptions({ compileErrors: [] }));
    });
    expect(result.current.allLatexErrors.length).toBe(0);
    expect(result.current.dismissedErrorIds.has(e.id)).toBe(true);
  });

  it("jumpToErrorVisual selects the error and scrolls to its paragraph (with retries)", () => {
    vi.useFakeTimers();
    const e = lintErr(1, "jump target"); // line 1 → paragraph aaaa
    MOCK_LINT_ERRORS = [e];
    const { ref, scrollToParagraphId } = makeHandleRef(null);
    const { result } = renderHook(() =>
      useDiagnostics(baseOptions({ editorHandleRef: ref })),
    );

    act(() => {
      result.current.jumpToErrorVisual(e);
    });

    // Selection set immediately.
    expect(result.current.selectedErrorId).toBe(e.id);
    // Immediate scroll fired for the resolvable paragraph.
    expect(scrollToParagraphId).toHaveBeenCalledWith("aaaa");
    const immediateCalls = scrollToParagraphId.mock.calls.length;
    expect(immediateCalls).toBe(1);

    // The 200ms + 500ms retries fire.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(scrollToParagraphId.mock.calls.length).toBe(3); // immediate + 2 retries
    for (const call of scrollToParagraphId.mock.calls) {
      expect(call[0]).toBe("aaaa");
    }
  });

  it("jumpToErrorVisual does not scroll when the error has no resolvable paragraph", () => {
    vi.useFakeTimers();
    const e = lintErr(6, "no paragraph"); // line 6 → outside any %!v: range
    MOCK_LINT_ERRORS = [e];
    const { ref, scrollToParagraphId } = makeHandleRef(null);
    const { result } = renderHook(() =>
      useDiagnostics(baseOptions({ editorHandleRef: ref })),
    );

    act(() => {
      result.current.jumpToErrorVisual(e);
      vi.advanceTimersByTime(500);
    });

    expect(result.current.selectedErrorId).toBe(e.id);
    expect(scrollToParagraphId).not.toHaveBeenCalled();
  });

  it("returns a stable object identity across a no-op re-render", () => {
    MOCK_LINT_ERRORS = [lintErr(4, "stable")];
    // Reuse ONE options object (stable array/ref identities) across the rerender
    // — that's the invariant the hook's `useMemo` return guards: with stable
    // inputs (same lintErrors reference from the mock, same compileErrors array,
    // same sourceText), every derived member and thus the return object keep
    // their identity. (Fresh input arrays each render would legitimately
    // recompute `allLatexErrors` and cascade a new object — not what we test.)
    const props = baseOptions();
    const { result, rerender } = renderHook(
      (p: UseDiagnosticsOptions) => useDiagnostics(p),
      { initialProps: props },
    );

    const before = result.current;
    act(() => {
      rerender(props);
    });
    expect(result.current).toBe(before);
  });
});
