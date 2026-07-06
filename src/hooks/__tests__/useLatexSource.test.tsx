// @vitest-environment jsdom
//
// Unit tests for useLatexSource (P5 item 4 — doc-agnostic .tex source feed).
//
// The hook serializes the LIVE TipTap doc to `.tex` on a debounced tick, framed
// by the doc's on-disk preamble/postamble, independent of whether the code pane
// is mounted. We mock at the three IO/serialize boundaries so the test is
// deterministic and fast:
//   - `@/lib/storage`   → `readTex` returns a controllable promise.
//   - `@/lib/latex-serializer` → `serializeToLatex` returns a marker string
//     derived from its args, so we can assert it ran with which preamble.
//   - `@/lib/latex-parser` → `extractPreambleAndPostamble` returns fixed frames.
//
// The mock also guards the extension-barrel/@/lib/storage gotcha (the hook
// imports `readTex` from `@/lib/storage`, whose real module pulls in
// `@/lib/storage-fsa`).

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

// ── Controllable readTex promise ──────────────────────────────────────────
let readTexResolve: (text: string) => void;
let readTexReject: (err: unknown) => void;
let readTexPromise: Promise<string>;

function freshReadTexPromise() {
  readTexPromise = new Promise<string>((res, rej) => {
    readTexResolve = res;
    readTexReject = rej;
  });
}
freshReadTexPromise();

const readTex = vi.fn((_docId: string) => readTexPromise);

vi.mock("@/lib/storage", () => ({
  readTex: (docId: string) => readTex(docId),
}));

// serializeToLatex returns a MARKER derived from its args so we can assert both
// that it ran and with which preamble/postamble.
const serializeToLatex = vi.fn(
  (
    doc: unknown,
    opts?: { preamble?: string; postamble?: string; bibFamily?: unknown },
  ) => `SER:${JSON.stringify(doc)}:${opts?.preamble ?? ""}:${opts?.postamble ?? ""}`,
);
vi.mock("@/lib/latex-serializer", () => ({
  serializeToLatex: (
    doc: unknown,
    opts?: { preamble?: string; postamble?: string; bibFamily?: unknown },
  ) => serializeToLatex(doc, opts),
}));

const extractPreambleAndPostamble = vi.fn(
  (_text: string): { preamble?: string; postamble?: string } => ({
    preamble: "PRE",
    postamble: "POST",
  }),
);
vi.mock("@/lib/latex-parser", () => ({
  extractPreambleAndPostamble: (text: string) => extractPreambleAndPostamble(text),
}));

import { useLatexSource } from "../useLatexSource";
import type { UseLatexSourceOptions } from "../useLatexSource";
import type { Editor } from "@tiptap/react";

// ── Fake editor ────────────────────────────────────────────────────────────
interface FakeEditor {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  getJSON: () => { doc: number };
  /** Invoke every captured 'update' handler (simulate a doc change). */
  fireUpdate: () => void;
  /** The captured 'update' handlers. */
  updateHandlers: Array<() => void>;
}

function makeFakeEditor(): FakeEditor {
  const updateHandlers: Array<() => void> = [];
  const on = vi.fn((event: string, cb: () => void) => {
    if (event === "update") updateHandlers.push(cb);
  });
  const off = vi.fn((event: string, cb: () => void) => {
    if (event === "update") {
      const i = updateHandlers.indexOf(cb);
      if (i !== -1) updateHandlers.splice(i, 1);
    }
  });
  return {
    on,
    off,
    getJSON: () => ({ doc: 1 }),
    updateHandlers,
    fireUpdate: () => updateHandlers.slice().forEach((h) => h()),
  };
}

/** Flush all microtasks so a resolved readTex `.then` chain runs. */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function baseProps(
  editor: FakeEditor | null,
  overrides: Partial<UseLatexSourceOptions> = {},
): UseLatexSourceOptions {
  return {
    editor: editor as unknown as Editor | null,
    docId: "doc-1",
    codeViewActive: false,
    debounceMs: 300,
    ...overrides,
  };
}

beforeEach(() => {
  readTex.mockClear();
  serializeToLatex.mockClear();
  extractPreambleAndPostamble.mockClear();
  extractPreambleAndPostamble.mockReturnValue({ preamble: "PRE", postamble: "POST" });
  freshReadTexPromise();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useLatexSource", () => {
  it("sourceText is null before the editor is ready / preamble resolves", async () => {
    // No editor at all → null.
    const noEditor = renderHook((p: UseLatexSourceOptions) => useLatexSource(p), {
      initialProps: baseProps(null),
    });
    expect(noEditor.result.current.sourceText).toBeNull();
    noEditor.unmount();

    // Editor present but readTex not yet resolved → still null.
    const editor = makeFakeEditor();
    const { result } = renderHook((p: UseLatexSourceOptions) => useLatexSource(p), {
      initialProps: baseProps(editor),
    });
    expect(result.current.sourceText).toBeNull();
    expect(serializeToLatex).not.toHaveBeenCalled();
  });

  it("seeds sourceText via serializeToLatex(getJSON, {preamble, postamble}) once readTex resolves", async () => {
    const editor = makeFakeEditor();
    const { result } = renderHook((p: UseLatexSourceOptions) => useLatexSource(p), {
      initialProps: baseProps(editor),
    });

    expect(result.current.sourceText).toBeNull();

    await act(async () => {
      readTexResolve("DISK-TEX");
      await readTexPromise;
      await Promise.resolve();
    });

    // Preamble threaded from the parsed disk text. bibFamily is null (no
    // getBibFamily passed → body-derived family).
    expect(extractPreambleAndPostamble).toHaveBeenCalledWith("DISK-TEX");
    expect(serializeToLatex).toHaveBeenCalledWith(
      { doc: 1 },
      { preamble: "PRE", postamble: "POST", bibFamily: null },
    );
    expect(result.current.sourceText).toBe(`SER:${JSON.stringify({ doc: 1 })}:PRE:POST`);
  });

  it("falls back to a default-preamble serialize when readTex rejects", async () => {
    const editor = makeFakeEditor();
    const { result } = renderHook((p: UseLatexSourceOptions) => useLatexSource(p), {
      initialProps: baseProps(editor),
    });

    await act(async () => {
      readTexReject(new Error("disk gone"));
      await readTexPromise.catch(() => {});
      await Promise.resolve();
    });

    // Serialized with undefined preamble/postamble (the marker collapses to "").
    expect(serializeToLatex).toHaveBeenCalledWith(
      { doc: 1 },
      { preamble: undefined, postamble: undefined, bibFamily: null },
    );
    expect(result.current.sourceText).toBe(`SER:${JSON.stringify({ doc: 1 })}::`);
  });

  it("debounces editor updates — a burst of N updates serializes at most once", async () => {
    vi.useFakeTimers();
    const editor = makeFakeEditor();
    const { result } = renderHook((p: UseLatexSourceOptions) => useLatexSource(p), {
      initialProps: baseProps(editor, { debounceMs: 300 }),
    });

    // Resolve the preamble read (drive the microtask queue under fake timers).
    await act(async () => {
      readTexResolve("DISK-TEX");
      await readTexPromise;
    });
    // The load-time seed serialize.
    const seedCalls = serializeToLatex.mock.calls.length;
    expect(seedCalls).toBe(1);

    // Fire the update handler N times WITHOUT advancing the clock: keystroke
    // sanctity means the handler only RESETS a timer, so no serialize yet.
    act(() => {
      editor.fireUpdate();
      editor.fireUpdate();
      editor.fireUpdate();
      editor.fireUpdate();
    });
    expect(serializeToLatex.mock.calls.length).toBe(seedCalls); // still just the seed

    // Advance past the debounce once → exactly ONE more serialize for the burst.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(serializeToLatex.mock.calls.length).toBe(seedCalls + 1);
    expect(result.current.sourceText).toBe(`SER:${JSON.stringify({ doc: 1 })}:PRE:POST`);
  });

  it("self-seeds on load with codeViewActive (no external feed yet); ongoing update-serialize stays suppressed; setSourceText overrides", async () => {
    vi.useFakeTimers();
    const editor = makeFakeEditor();
    const { result } = renderHook((p: UseLatexSourceOptions) => useLatexSource(p), {
      initialProps: baseProps(editor, { codeViewActive: true }),
    });

    // Load seed: with codeViewActive but NO external feed yet, the pane SELF-SEEDS
    // from TipTap so a cold code-view-open never leaves diagnostics empty (the
    // bubble-not-ready race). The code view's feed later overrides.
    await act(async () => {
      readTexResolve("DISK-TEX");
      await readTexPromise;
    });
    expect(serializeToLatex).toHaveBeenCalledTimes(1);
    expect(result.current.sourceText).toBe(`SER:${JSON.stringify({ doc: 1 })}:PRE:POST`);

    // An editor update while codeViewActive does NOT serialize (the ongoing feed
    // is owned by the code view; the debounced update-serialize is suppressed).
    act(() => {
      editor.fireUpdate();
      vi.advanceTimersByTime(300);
    });
    expect(serializeToLatex).toHaveBeenCalledTimes(1); // still just the seed

    // The imperative setter (the code view's direct feed) overrides sourceText.
    act(() => {
      result.current.setSourceText("X");
    });
    expect(result.current.sourceText).toBe("X");
  });

  it("defers the load seed when an external feed arrived first (no overwrite of fresh code text)", async () => {
    const editor = makeFakeEditor();
    const { result } = renderHook((p: UseLatexSourceOptions) => useLatexSource(p), {
      initialProps: baseProps(editor, { codeViewActive: true }),
    });

    // The code view feeds its raw text BEFORE the disk read resolves.
    act(() => {
      result.current.setSourceText("RAW-CODE");
    });
    expect(result.current.sourceText).toBe("RAW-CODE");

    // Disk read resolves: the load seed must DEFER (an external feed took over)
    // and NOT overwrite the fresher raw code text.
    await act(async () => {
      readTexResolve("DISK-TEX");
      await readTexPromise;
      await Promise.resolve();
    });
    expect(serializeToLatex).not.toHaveBeenCalled();
    expect(result.current.sourceText).toBe("RAW-CODE");
  });

  it("threads bibFamily from getBibFamily into the serialize (line-number parity)", async () => {
    const editor = makeFakeEditor();
    const { result } = renderHook((p: UseLatexSourceOptions) => useLatexSource(p), {
      initialProps: baseProps(editor, { getBibFamily: () => "natbib" as never }),
    });
    await act(async () => {
      readTexResolve("DISK-TEX");
      await readTexPromise;
      await Promise.resolve();
    });
    expect(serializeToLatex).toHaveBeenCalledWith(
      { doc: 1 },
      { preamble: "PRE", postamble: "POST", bibFamily: "natbib" },
    );
    expect(result.current.sourceText).toBe(`SER:${JSON.stringify({ doc: 1 })}:PRE:POST`);
  });

  it("setSourceText bails an identical value (no state-identity churn)", async () => {
    const editor = makeFakeEditor();
    const { result } = renderHook(
      (p: UseLatexSourceOptions) => useLatexSource(p),
      { initialProps: baseProps(editor, { codeViewActive: true }) },
    );

    await flushMicrotasks();

    act(() => {
      result.current.setSourceText("SAME");
    });
    expect(result.current.sourceText).toBe("SAME");
    const returnRef = result.current;

    // Setting the same value again returns the SAME state reference (the setter's
    // `prev === text ? prev : text` bail), so the memoized hook return is
    // identity-stable — no downstream churn. (Render count is NOT asserted:
    // React may still invoke the component once on a state-equality bailout.)
    act(() => {
      result.current.setSourceText("SAME");
    });
    expect(result.current.sourceText).toBe("SAME");
    expect(result.current).toBe(returnRef); // same returned object identity
  });

  it("returns a stable object identity across a no-op re-render", async () => {
    const editor = makeFakeEditor();
    const { result, rerender } = renderHook(
      (p: UseLatexSourceOptions) => useLatexSource(p),
      { initialProps: baseProps(editor) },
    );

    await flushMicrotasks();
    const before = result.current;

    // Re-render with identical props → sourceText unchanged → same object ref.
    rerender(baseProps(editor));
    expect(result.current).toBe(before);
  });

  it("removes the update handler via editor.off on unmount", async () => {
    const editor = makeFakeEditor();
    const { unmount } = renderHook((p: UseLatexSourceOptions) => useLatexSource(p), {
      initialProps: baseProps(editor),
    });

    await flushMicrotasks();
    // The hook subscribed exactly one 'update' handler.
    const updateSubscribe = editor.on.mock.calls.find((c) => c[0] === "update");
    expect(updateSubscribe).toBeTruthy();
    expect(editor.updateHandlers.length).toBe(1);

    unmount();

    // off("update", handler) called with the same callback → handler removed.
    const offUpdate = editor.off.mock.calls.find((c) => c[0] === "update");
    expect(offUpdate).toBeTruthy();
    expect(offUpdate![1]).toBe(updateSubscribe![1]);
    expect(editor.updateHandlers.length).toBe(0);
  });
});
