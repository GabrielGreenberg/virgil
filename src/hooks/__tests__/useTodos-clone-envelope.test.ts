// @vitest-environment jsdom
//
// Task 721 — `useTodos.cloneTodo`, the op the duplicate walker calls when a
// `linkedAnchor` mark naming a todo rides a duplicated slice.
//
// There was no clone at all until this task, because the registry row declared
// `lifecycle.clone: false` on a premise its own SSOT refutes (a todo DOES carry
// a Mode-B text-range mark — `carriesModeBAnchor("todo")`). So duplicating a
// passage carried its note and silently dropped its todo.
//
// Pinned here, the same contract every sibling clone keeps
// (`useNotes-clone-envelope`, `useReports-clone-envelope`):
//   - the record-level envelope (`archived`) is CARRIED via `carryCardEnvelope`;
//   - every authored field is carried — BOTH user-typed fields (`text`, `notes`),
//     the `titleAuto` provenance bit, and the `done` state;
//   - `aiRequest` is RESET (a duplicated todo must not file a second inbox row)
//     and `links` CLEARED (the walker rewires the clone's anchor via
//     `bindAnchor` after the slice lands);
//   - a fresh id, and null for an id that isn't there.
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

import { useTodos } from "../useTodos";
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

const SOURCE = {
  id: "t-src",
  archived: true,
  text: "Check the Peirce citation",
  titleAuto: false,
  notes: "the 1878 paper, not the 1877 one",
  done: true,
  aiRequest: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  links: [
    {
      kind: "anchor" as const,
      anchorId: "anc-src",
      text: "the span",
      paragraphIds: ["para-src"],
    },
  ],
};

describe("useTodos.cloneTodo (task 721)", () => {
  it("carries the envelope + every authored field, resets aiRequest, clears links", async () => {
    beginDocPipeline("doc-ct");
    mockRead.mockResolvedValue({ items: [SOURCE] });
    const { result } = renderHook(() => useTodos("doc-ct"));
    await waitFor(() => expect(result.current.items.length).toBe(1));

    let newId: string | null = null;
    act(() => {
      newId = result.current.cloneTodo("t-src");
    });
    expect(newId).toBeTruthy();
    await waitFor(() => expect(result.current.items.length).toBe(2));

    const clone = result.current.items.find((i) => i.id === newId)!;
    expect(clone.id).not.toBe("t-src");
    // Envelope + authored content preserved:
    expect(clone.archived).toBe(true);
    expect(clone.text).toBe(SOURCE.text);
    expect(clone.notes).toBe(SOURCE.notes);
    expect(clone.titleAuto).toBe(false);
    expect(clone.done).toBe(true);
    // Intentionally reset / cleared:
    expect(clone.aiRequest).toBe(false);
    expect(clone.links).toEqual([]);
    // The source is untouched.
    const src = result.current.items.find((i) => i.id === "t-src")!;
    expect(src.aiRequest).toBe(true);
    expect(src.links).toEqual(SOURCE.links);
  });

  it("returns null for an id that isn't there (the walker strips the mark)", async () => {
    beginDocPipeline("doc-ct2");
    mockRead.mockResolvedValue({ items: [SOURCE] });
    const { result } = renderHook(() => useTodos("doc-ct2"));
    await waitFor(() => expect(result.current.items.length).toBe(1));
    let out: string | null = "not-null";
    act(() => {
      out = result.current.cloneTodo("nope");
    });
    expect(out).toBeNull();
    expect(result.current.items.length).toBe(1);
  });
});
