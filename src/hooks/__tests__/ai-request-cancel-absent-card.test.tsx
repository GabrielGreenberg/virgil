// @vitest-environment jsdom
//
// Task 2026-09-21-697 — **Cancel works when the card is gone.**
//
// Every panel hook's `setXAiRequest` built its ADD context from a render-time
// state snapshot and then gated the WHOLE bridge call on that lookup
// (`if (card) bridge(...)`). So the AI window's Cancel — which exists for a row
// whose card is gone — did nothing at all in precisely that state: no row
// removed, no flag changed, no error, no feedback, and `/editor/review` kept
// draining the row.
//
// This suite drives the REAL setters over a seeded `ai-requests.json` whose
// linked cards are NOT in their sidecars, one per flag-bearing kind, and
// asserts the row closes anyway. Against `main` (the `if (card)` gate) every
// one of these fails: nothing is written at all.
//
// The card-PRESENT legs are the other half: they pin today's context shape so
// the refactor cannot quietly thin it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { AiRequest, AiRequestsState } from "@/lib/types";

const DISK: Record<string, unknown> = {};
const writes: Array<{ file: string; data: unknown }> = [];

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async (_docId: string, file: string, dflt: unknown) =>
    file in DISK ? DISK[file] : dflt,
  ),
  readSidecarIfExists: vi.fn(async (_docId: string, file: string) =>
    file in DISK ? DISK[file] : undefined,
  ),
  writeSidecar: vi.fn(async (_h: unknown, file: string, data: unknown) => {
    DISK[file] = data;
    writes.push({ file, data });
  }),
  mutateSidecar: vi.fn(
    async (
      _h: unknown,
      file: string,
      dflt: unknown,
      mutate: (cur: unknown) => unknown,
    ) => {
      const next = mutate(file in DISK ? DISK[file] : dflt);
      if (next === null) return null;
      DISK[file] = next;
      writes.push({ file, data: next });
      return next;
    },
  ),
}));

import { useNotes } from "../useNotes";
import { useTodos } from "../useTodos";
import { useCutter } from "../useCutter";
import { useRevisions } from "../useRevisions";
import { useReports } from "../useReports";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";

const DOC = "doc-697";

beforeEach(() => {
  __resetForTests();
  for (const k of Object.keys(DISK)) delete DISK[k];
  writes.length = 0;
});

function lastQueue(): AiRequestsState | undefined {
  return [...writes].reverse().find((w) => w.file === "ai-requests.json")
    ?.data as AiRequestsState | undefined;
}

/** Seed a bridged row whose linked card is NOT in any sidecar — the stranded
 *  state every guard in tasks 219 / 313 / 093 / 681 exists to prevent, and the
 *  one this affordance exists to recover from. */
function seedStrandedRow(row: Partial<AiRequest> & Pick<AiRequest, "kind" | "linkedTo">) {
  DISK["ai-requests.json"] = {
    requests: [
      {
        id: "req-stranded",
        text: "a question whose card has vanished",
        createdAt: "2026-01-01T00:00:00.000Z",
        status: "pending",
        ...row,
      },
    ],
  } satisfies AiRequestsState;
}

/** Each flag-bearing kind, its hook, its `setXAiRequest`, and the frozen wire
 *  routing its row carries. Table-driven so an eighth kind joins by being
 *  added here rather than by someone remembering to write a fifth copy of the
 *  same test — which is exactly how the gate reached five hooks. */
const KINDS = [
  {
    label: "note",
    panel: "notes" as const,
    wireKind: "note" as const,
    render: () => renderHook(() => useNotes(DOC)),
    cancel: (h: { setNoteAiRequest: (i: string, v: boolean, m: "toggle") => void }) =>
      h.setNoteAiRequest("card-gone", false, "toggle"),
  },
  {
    label: "highlight",
    panel: "notes" as const,
    wireKind: "highlight" as const,
    render: () => renderHook(() => useNotes(DOC)),
    cancel: (h: { setHighlightAiRequest: (i: string, v: boolean, m: "toggle") => void }) =>
      h.setHighlightAiRequest("card-gone", false, "toggle"),
  },
  {
    label: "todo",
    panel: "todos" as const,
    wireKind: "todo" as const,
    render: () => renderHook(() => useTodos(DOC)),
    cancel: (h: { setAiRequest: (i: string, v: boolean, m: "toggle") => void }) =>
      h.setAiRequest("card-gone", false, "toggle"),
  },
  {
    label: "cutter-comment",
    panel: "cutter" as const,
    wireKind: "suggestion" as const,
    render: () => renderHook(() => useCutter(DOC)),
    cancel: (h: { setCommentAiRequest: (i: string, v: boolean, m: "toggle") => void }) =>
      h.setCommentAiRequest("card-gone", false, "toggle"),
  },
  {
    label: "revision-comment",
    panel: "revisions" as const,
    wireKind: "suggestion" as const,
    render: () => renderHook(() => useRevisions(DOC)),
    cancel: (h: { setCommentAiRequest: (i: string, v: boolean, m: "toggle") => void }) =>
      h.setCommentAiRequest("card-gone", false, "toggle"),
  },
  {
    label: "report-request",
    panel: "reports" as const,
    wireKind: "report" as const,
    render: () => renderHook(() => useReports(DOC)),
    cancel: (h: { setRequestAiRequest: (i: string, v: boolean, m: "toggle") => void }) =>
      h.setRequestAiRequest("card-gone", false, "toggle"),
  },
] as const;

describe("Cancel on a card-linked row whose card is ABSENT still closes the row (697)", () => {
  for (const k of KINDS) {
    it(`${k.label}: the row is removed even though the card is not in its sidecar`, async () => {
      beginDocPipeline(DOC);
      seedStrandedRow({
        kind: k.wireKind,
        linkedTo: { panel: k.panel, cardId: "card-gone" },
      });

      const hook = k.render();
      await waitFor(() => expect(hook.result.current.loaded).toBe(true));
      // Precondition: the card really is absent from the panel's state.
      expect(
        JSON.stringify(hook.result.current).includes("card-gone"),
      ).toBe(false);

      writes.length = 0;
      await act(async () => {
        (k.cancel as (h: unknown) => void)(hook.result.current);
      });

      await waitFor(() => expect(lastQueue()).toBeDefined());
      expect(lastQueue()!.requests).toEqual([]);
    });
  }

  it("a sidecar READ ERROR does not make Cancel inert either", async () => {
    // `loadError` leaves the hook at its empty default while `ai-requests.json`
    // reads fine — so every card in that panel looks absent for the session,
    // and every Cancel in it used to be a no-op. One of the task's named
    // members, and the reason the recovery affordance has to work without the
    // card rather than merely usually.
    beginDocPipeline(DOC);
    seedStrandedRow({
      kind: "todo",
      linkedTo: { panel: "todos", cardId: "card-gone" },
    });
    DISK["todos.json"] = "not json at all, the read throws";

    const hook = renderHook(() => useTodos(DOC));
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));

    writes.length = 0;
    await act(async () => {
      hook.result.current.setAiRequest("card-gone", false, "toggle");
    });

    await waitFor(() => expect(lastQueue()).toBeDefined());
    expect(lastQueue()!.requests).toEqual([]);
  });

  it("a PRESENT card's context is unchanged — the rich payload still reaches the row", async () => {
    beginDocPipeline(DOC);
    const hook = renderHook(() => useTodos(DOC));
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));

    let id = "";
    await act(async () => {
      id = hook.result.current.addItemFromSeed({ text: "write the conclusion" }).id;
    });
    await act(async () => {
      hook.result.current.addParagraphId(id, "para-7");
    });
    await act(async () => {
      hook.result.current.setAiRequest(id, true, "toggle");
    });

    await waitFor(() => expect(lastQueue()?.requests.length).toBe(1));
    const row = lastQueue()!.requests[0];
    expect(row.kind).toBe("todo");
    expect(row.text).toBe("write the conclusion");
    expect(row.paragraphIds).toEqual(["para-7"]);
    expect(row.linkedTo).toEqual({ panel: "todos", cardId: id });
  });
});
