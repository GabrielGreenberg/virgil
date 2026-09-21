// @vitest-environment jsdom
//
// Task 099 — `cloneComment`/`cloneSuggestion` build a hand-enumerated literal
// for the duplicate and used to DROP the record-level `archived` envelope field
// (both `RevisionRequestCard` and `RevisionSuggestionCard` carry it), so
// duplicating an ARCHIVED comment/suggestion produced an ACTIVE clone that
// re-appeared out from under "View Archives". This is the 058/060/064/069/072/076
// envelope-drop family; the fix routes every clone literal through the shared
// `carryCardEnvelope` SSOT (also used by the morph chokepoint).
//
// The intentional resets are pinned too: `aiRequest`→false (comment) and
// `links`→[] (rewire walker) are cleared; a suggestion clone resets
// `status`→"pending".
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule({
    readSidecar: (...a: unknown[]) => mockRead(...a),
    readSidecarIfExists: (...a: unknown[]) => mockRead(...a),
    writeSidecar: (...a: unknown[]) => mockWrite(...a),
  }),
);

import { useRevisions } from "../useRevisions";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  __resetForTests();
});

const base = { createdAt: "2026-01-01T00:00:00.000Z", links: [] };

describe("useRevisions clone carries the archived envelope (task 099)", () => {
  it("cloneComment keeps archived:true, resets aiRequest, clears links, mints a fresh id", async () => {
    beginDocPipeline("doc-rc");
    mockRead.mockResolvedValue({
      cards: [
        {
          kind: "comment",
          id: "rc-src",
          archived: true,
          text: "keep me",
          content: {},
          aiRequest: true,
          selectedText: "span",
          ...base,
        },
      ],
    });
    const { result } = renderHook(() => useRevisions("doc-rc"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    let newId: string | null = null;
    act(() => {
      newId = result.current.cloneComment("rc-src");
    });
    expect(newId).toBeTruthy();
    await waitFor(() => expect(result.current.cards.length).toBe(2));

    const clone = result.current.cards.find((c) => c.id === newId)!;
    expect(clone.kind).toBe("comment");
    expect(clone.id).not.toBe("rc-src");
    expect(clone.archived).toBe(true);
    expect((clone as { aiRequest?: boolean }).aiRequest).toBe(false);
    expect(clone.links).toEqual([]);
  });

  it("cloneSuggestion keeps archived:true, resets status→pending, clears links, mints a fresh id", async () => {
    beginDocPipeline("doc-rs");
    mockRead.mockResolvedValue({
      cards: [
        {
          kind: "suggestion",
          id: "rs-src",
          archived: true,
          author: "ai",
          original_text: "old",
          suggested_text: "new",
          explanation: "why",
          user_text: "",
          instructions: "",
          status: "accepted",
          selectedText: "span",
          ...base,
        },
      ],
    });
    const { result } = renderHook(() => useRevisions("doc-rs"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    let newId: string | null = null;
    act(() => {
      newId = result.current.cloneSuggestion("rs-src");
    });
    expect(newId).toBeTruthy();
    await waitFor(() => expect(result.current.cards.length).toBe(2));

    const clone = result.current.cards.find((c) => c.id === newId)!;
    expect(clone.kind).toBe("suggestion");
    expect(clone.id).not.toBe("rs-src");
    expect(clone.archived).toBe(true);
    expect((clone as { status?: string }).status).toBe("pending");
    expect(clone.links).toEqual([]);
  });

  it("a NON-archived comment clones active (no archived leakage)", async () => {
    beginDocPipeline("doc-rc2");
    mockRead.mockResolvedValue({
      cards: [{ kind: "comment", id: "rc2", text: "t", content: {}, ...base }],
    });
    const { result } = renderHook(() => useRevisions("doc-rc2"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    let newId: string | null = null;
    act(() => {
      newId = result.current.cloneComment("rc2");
    });
    await waitFor(() => expect(result.current.cards.length).toBe(2));
    const clone = result.current.cards.find((c) => c.id === newId)!;
    expect(clone.archived).toBeFalsy();
  });
  // ── Task 694: the CAPTURE PAIR travels with the clone ───────────────────
  // `selectedText` is the plain `doc.textBetween` line; `selectedContent` is
  // the RICH capture of the same instant (task 488). A clone is not a
  // re-capture — `bindAnchor` re-attaches the LINK and never rewrites the
  // card's capture — so a dropped rich half is gone permanently and the
  // duplicate's "Original" renders flat.
  it("cloneComment carries the RICH capture, not just the flattened line", async () => {
    beginDocPipeline("doc-cap1");
    const rich = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", marks: [{ type: "italic" }], text: "wonder" }],
        },
      ],
    };
    mockRead.mockResolvedValue({
      cards: [
        {
          kind: "comment",
          id: "cap-src",
          text: "t",
          content: {},
          selectedText: "wonder",
          selectedContent: rich,
          ...base,
        },
      ],
    });
    const { result } = renderHook(() => useRevisions("doc-cap1"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    let newId: string | null = null;
    act(() => {
      newId = result.current.cloneComment("cap-src");
    });
    await waitFor(() => expect(result.current.cards.length).toBe(2));
    const clone = result.current.cards.find((c) => c.id === newId)!;
    expect(clone.selectedText).toBe("wonder");
    expect(clone.selectedContent).toEqual(rich);
  });

  it("cloneSuggestion carries the RICH capture too", async () => {
    beginDocPipeline("doc-cap2");
    const rich = { type: "doc", content: [{ type: "paragraph" }] };
    mockRead.mockResolvedValue({
      cards: [
        {
          kind: "suggestion",
          id: "caps-src",
          author: "human",
          original_text: "old",
          suggested_text: "new",
          explanation: "",
          user_text: "",
          instructions: "",
          status: "pending",
          selectedText: "old",
          selectedContent: rich,
          ...base,
        },
      ],
    });
    const { result } = renderHook(() => useRevisions("doc-cap2"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    let newId: string | null = null;
    act(() => {
      newId = result.current.cloneSuggestion("caps-src");
    });
    await waitFor(() => expect(result.current.cards.length).toBe(2));
    const clone = result.current.cards.find((c) => c.id === newId)!;
    expect(clone.selectedText).toBe("old");
    expect(clone.selectedContent).toEqual(rich);
  });

  // A pre-488 record has no rich half. The clone must not GROW the key — the
  // sidecar shape never held `selectedContent: undefined`, and a written null
  // field is what `setAppliedChange`'s deliberate key-drop exists to avoid.
  it("a pre-488 card (no rich half) clones WITHOUT the key, not with undefined", async () => {
    beginDocPipeline("doc-cap3");
    mockRead.mockResolvedValue({
      cards: [
        {
          kind: "comment",
          id: "cap3-src",
          text: "t",
          content: {},
          selectedText: "plain words",
          ...base,
        },
      ],
    });
    const { result } = renderHook(() => useRevisions("doc-cap3"));
    await waitFor(() => expect(result.current.cards.length).toBe(1));

    let newId: string | null = null;
    act(() => {
      newId = result.current.cloneComment("cap3-src");
    });
    await waitFor(() => expect(result.current.cards.length).toBe(2));
    const clone = result.current.cards.find((c) => c.id === newId)!;
    expect(clone.selectedText).toBe("plain words");
    expect("selectedContent" in clone).toBe(false);
  });
});
