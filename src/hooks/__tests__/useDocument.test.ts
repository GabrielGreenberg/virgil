// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { ReactNode } from "react";
import React from "react";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", () => ({
  readDocBundle: (...args: unknown[]) => mockRead(...args),
  writeDocBundle: (...args: unknown[]) => mockWrite(...args),
}));

import { useDocument } from "../useDocument";
import {
  ANCHOR_MINT_META,
  markAnchorMint,
} from "@/lib/anchor-mint-signal";
import type { Transaction } from "@tiptap/pm/state";
import { DocPipeline } from "@/components/editor-layout/DocPipeline";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";
import {
  flushPendingForDoc,
  __resetForTests as resetFlushers,
} from "@/lib/multi-window/pending-saves";

const EMPTY_CONTENT: JSONContent = { type: "doc", content: [] };
const SAMPLE_CONTENT: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "hello" }],
    },
  ],
};
const PRIOR_DOC_CONTENT: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "this is the previous doc's text" }],
    },
  ],
};
const NEW_DOC_CONTENT: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "fresh content from disk" }],
    },
  ],
};

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  mockRead.mockResolvedValue({ content: EMPTY_CONTENT, editorState: {} });
  resetPipelines();
  resetFlushers();
});

/** Build a minimal TipTap-editor stub. `useDocument.onUpdate` now takes
 *  an Editor (not a JSON snapshot) so it can defer `getJSON()` into its
 *  own debounce timer; the stub satisfies the shape that flush paths
 *  (`getJSON`, `isDestroyed`) read. */
function makeMockEditor(content: JSONContent): Editor {
  return {
    getJSON: () => content,
    isDestroyed: false,
  } as unknown as Editor;
}

/** A transaction stub carrying ONLY a `getMeta` reader, enough for the
 *  anchor-mint gate. `mint=true` stamps the anchor-mint meta (via the same
 *  `markAnchorMint`-equivalent key the production mint sites set); `mint=false`
 *  is a plain keystroke tx with no meta. */
function makeTx(mint: boolean): Transaction {
  const meta: Record<string, unknown> = {};
  if (mint) meta[ANCHOR_MINT_META] = true;
  return {
    getMeta: (key: string) => meta[key],
  } as unknown as Transaction;
}

/** Wrap a test component in a DocPipeline ancestor so useDocument can
 *  read its handle from context. Mirrors the production wrap in
 *  `EditorLayout.tsx` / `library/components/PaperRender.tsx`. */
function withPipeline(docId: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(
      DocPipeline,
      { docId, key: docId, children },
    );
  };
}

describe("useDocument autosave persistence", () => {
  it("flushes pending debounced edits on unmount", async () => {
    const { result, unmount } = renderHook(() => useDocument(), {
      wrapper: withPipeline("doc-1"),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
    });
    // Debounce is 1500 ms; we unmount immediately, well inside that window.
    expect(mockWrite).not.toHaveBeenCalled();

    unmount();
    // The unmount cleanup fires the pending save synchronously.
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1));
    const [handle, content] = mockWrite.mock.calls[0];
    expect(handle.docId).toBe("doc-1");
    expect(content).toEqual(SAMPLE_CONTENT);
  });

  it("flushes pending edits on pagehide", async () => {
    const { result } = renderHook(() => useDocument(), {
      wrapper: withPipeline("doc-1"),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
    });
    expect(mockWrite).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide"));
    });

    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1));
    expect(mockWrite.mock.calls[0][1]).toEqual(SAMPLE_CONTENT);
  });

  it("registers a flusher reachable via flushPendingForDoc", async () => {
    const { result } = renderHook(() => useDocument(), {
      wrapper: withPipeline("doc-1"),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
    });
    expect(mockWrite).not.toHaveBeenCalled();

    // External caller (e.g. useFiles.flushOutgoing during a doc switch)
    // can drive the flush before the pipeline ends.
    await act(async () => {
      await flushPendingForDoc("doc-1");
    });

    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite.mock.calls[0][1]).toEqual(SAMPLE_CONTENT);
  });

  it("does not double-write when the debounce timer subsequently fires", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useDocument(), {
        wrapper: withPipeline("doc-1"),
      });
      // Advance past any sync-y mount work.
      await vi.runOnlyPendingTimersAsync();

      act(() => {
        result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
      });

      await act(async () => {
        await flushPendingForDoc("doc-1");
      });
      expect(mockWrite).toHaveBeenCalledTimes(1);

      // Advance past the 1500 ms debounce — there should be NO second write
      // because flushPending cleared latestContentRef.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(mockWrite).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates a pipeline lazily on first render so saves work immediately", async () => {
    // No explicit `beginDocPipeline` call before the render — the
    // DocPipeline wrapper opens the pipeline during render. Saves must
    // work from the first edit, not just after some separate effect.
    const { result } = renderHook(() => useDocument(), {
      wrapper: withPipeline("doc-1"),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
    });
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide"));
    });
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1));
    expect(mockWrite.mock.calls[0][1]).toEqual(SAMPLE_CONTENT);
  });

  it("unregisters the flusher on unmount", async () => {
    const { result, unmount } = renderHook(() => useDocument(), {
      wrapper: withPipeline("doc-1"),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    unmount();
    // After unmount, flushPendingForDoc is a no-op — no stale writes.
    await act(async () => {
      await flushPendingForDoc("doc-1");
    });
    // Only writes from the unmount itself; since nothing was pending,
    // there should be zero writes.
    expect(mockWrite).not.toHaveBeenCalled();
  });
});

describe("useDocument architectural guarantees", () => {
  it("throws when mounted outside a <DocPipeline> ancestor", () => {
    // The throw IS the wall: any future caller that forgets the wrap
    // crashes loudly with the directive in the error message.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useDocument())).toThrow(
        /useDocWriteHandle: no <DocPipeline> ancestor/,
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("does not leak prior doc content into the new doc when the pipeline-wrapper key changes", async () => {
    // This is the cross-doc autosave bug. Before the fix:
    //  1. EditorPane mounts with docId=A, TipTap loads A's content.
    //  2. docId switches to B without remounting EditorPane.
    //  3. TipTap retains A's content; user types -> save writes A's
    //     content into B's file.
    //
    // The wall is the `<DocPipeline key={docId}>` boundary, which
    // forces a full remount on doc switch. This test simulates that
    // remount and asserts:
    //   a. After remount, useDocument is bound to the NEW docId.
    //   b. A pending edit triggered on the new doc's mount writes to
    //      the new doc's file with the new content — not the old one.

    // Distinct content per doc so the test can tell which one was saved.
    mockRead.mockImplementation((id: string) => {
      if (id === "doc-old") return Promise.resolve({ content: PRIOR_DOC_CONTENT, editorState: {} });
      return Promise.resolve({ content: NEW_DOC_CONTENT, editorState: {} });
    });

    // Mount with docId=doc-old, type something, unmount before save fires.
    const { result: result1, unmount: unmount1 } = renderHook(
      () => useDocument(),
      { wrapper: withPipeline("doc-old") },
    );
    await waitFor(() => expect(result1.current.loading).toBe(false));
    act(() => {
      result1.current.onUpdate(makeMockEditor(PRIOR_DOC_CONTENT));
    });
    unmount1();
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1));
    // Pending edit for doc-old lands in doc-old's file. No leak yet.
    expect(mockWrite.mock.calls[0][0].docId).toBe("doc-old");
    expect(mockWrite.mock.calls[0][1]).toEqual(PRIOR_DOC_CONTENT);

    // Now mount with the NEW docId — fresh wrapper, fresh pipeline,
    // fresh hook instance. The DocPipeline `key={docId}` change in
    // production gives us this exact lifecycle.
    const { result: result2 } = renderHook(() => useDocument(), {
      wrapper: withPipeline("doc-new"),
    });
    await waitFor(() => expect(result2.current.loading).toBe(false));

    // The new mount loaded fresh content for doc-new — not doc-old's.
    expect(result2.current.content).toEqual(NEW_DOC_CONTENT);

    // Edit on the new doc -> save targets doc-new with new content.
    act(() => {
      result2.current.onUpdate(makeMockEditor(NEW_DOC_CONTENT));
    });
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide"));
    });
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(2));
    expect(mockWrite.mock.calls[1][0].docId).toBe("doc-new");
    expect(mockWrite.mock.calls[1][1]).toEqual(NEW_DOC_CONTENT);
    // Critical: doc-new's file was never written with doc-old's content.
    const docNewWrites = mockWrite.mock.calls.filter(
      (c) => c[0].docId === "doc-new",
    );
    for (const [, content] of docNewWrites) {
      expect(content).not.toEqual(PRIOR_DOC_CONTENT);
    }
  });

  it("uses the docId from the surrounding DocPipeline, not from a stale ref", async () => {
    // beginDocPipeline outside the wrapper would create a pipeline
    // for "other-doc" — useDocument must ignore it and use the
    // wrapper's docId instead.
    beginDocPipeline("other-doc");
    const { result } = renderHook(() => useDocument(), {
      wrapper: withPipeline("doc-1"),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
    });
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide"));
    });
    await waitFor(() => expect(mockWrite).toHaveBeenCalledTimes(1));
    expect(mockWrite.mock.calls[0][0].docId).toBe("doc-1");
  });
});

// The keystroke-sanctity TEETH for the anchor-mint flush. An anchor-UUID mint
// transaction must persist the doc IMMEDIATELY (so a freshly minted paragraph
// UUID lands on the card's fast clock), while a plain edit must NOT — it stays
// on the normal 1500 ms debounce. Both legs are proven below.
describe("useDocument anchor-mint immediate flush (keystroke sanctity teeth)", () => {
  it("FLUSHES IMMEDIATELY on an anchor-mint transaction — no 1500 ms wait", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useDocument(), {
        wrapper: withPipeline("doc-1"),
      });
      await vi.runOnlyPendingTimersAsync();

      // A mint tx (tagged via markAnchorMint) arrives. The write must land NOW,
      // synchronously inside onUpdate — without advancing past the debounce.
      act(() => {
        result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT), makeTx(true));
      });

      // No timer advance. The flush fired on the mint tx itself.
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockWrite).toHaveBeenCalledTimes(1);
      expect(mockWrite.mock.calls[0][0].docId).toBe("doc-1");
      expect(mockWrite.mock.calls[0][1]).toEqual(SAMPLE_CONTENT);

      // And the now-cancelled debounce does NOT double-write when time passes.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(mockWrite).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("DOES NOT flush on a plain edit — stays on the 1500 ms debounce", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useDocument(), {
        wrapper: withPipeline("doc-1"),
      });
      await vi.runOnlyPendingTimersAsync();

      // A plain keystroke tx (no mint meta). The flush must NOT fire.
      act(() => {
        result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT), makeTx(false));
      });

      // Right after the edit — still well inside the debounce window — there is
      // NO write. This is the keystroke-sanctity gate proving it does not fire.
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockWrite).not.toHaveBeenCalled();

      // Only after the full 1500 ms debounce does the normal autosave land.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(mockWrite).toHaveBeenCalledTimes(1);
      expect(mockWrite.mock.calls[0][1]).toEqual(SAMPLE_CONTENT);
    } finally {
      vi.useRealTimers();
    }
  });

  it("also does not flush when onUpdate is called with NO transaction (legacy callers)", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useDocument(), {
        wrapper: withPipeline("doc-1"),
      });
      await vi.runOnlyPendingTimersAsync();

      // Legacy callers (e.g. EditorLayout's handleUpdate) pass only the editor.
      // The gate must treat a missing tx as "not a mint" → debounce only.
      act(() => {
        result.current.onUpdate(makeMockEditor(SAMPLE_CONTENT));
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockWrite).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(mockWrite).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// Unit-level guard for the signal predicate itself — the single source of the
// mint vs keystroke distinction. If this drifts, the flush gate drifts.
describe("anchor-mint-signal predicate", () => {
  it("isAnchorMintTransaction is true ONLY for a markAnchorMint-tagged tx", async () => {
    const { isAnchorMintTransaction } = await import(
      "@/lib/anchor-mint-signal"
    );
    // A real-ish tr stub markAnchorMint can stamp.
    const store: Record<string, unknown> = {};
    const trStub = {
      setMeta: (k: string, v: unknown) => {
        store[k] = v;
        return trStub;
      },
      getMeta: (k: string) => store[k],
    } as unknown as Transaction;

    expect(isAnchorMintTransaction(trStub)).toBe(false); // untagged
    markAnchorMint(trStub);
    expect(isAnchorMintTransaction(trStub)).toBe(true); // tagged
    expect(isAnchorMintTransaction(makeTx(false))).toBe(false);
    expect(isAnchorMintTransaction(null)).toBe(false);
    expect(isAnchorMintTransaction(undefined)).toBe(false);
  });
});
