// @vitest-environment jsdom
//
// **An AUTOMATIC write asks whether its sources are TRUE, not whether they
// finished** — task 679.
//
// `useAiRequestCardMigration` converts unlinked `note`/`todo` rows in
// `ai-requests.json` into real Note/Todo cards. It is an automatic write — an
// effect, no user gesture — into THREE sidecars at once, and it used to fire on
// the first render where all three reads had merely TERMINATED:
//
//     ready: notes.loaded && todos.loaded && aiRequests.loaded
//
// `loaded` flips on a read that THREW as well as on one that succeeded, and an
// errored read leaves the collection at the EMPTY DEFAULT. So with a corrupt or
// unreadable `notes.json` the sequence was: notes = `{cards: []}`, `loaded`
// true; the migration mints cards from the request list and appends them;
// `appendCards` → `update()`, which persists unconditionally; and `notes.json`
// is rewritten as ONLY the migrated cards — every note in the paper destroyed
// by a write the user never asked for.
//
// The legs:
//   1. the gate itself — a source whose read threw is NOT authoritative;
//   2. the migration stands down, writing none of the three sidecars;
//   3. it does NOT burn the doc's one-per-session claim, so a later good read
//      in the same session still migrates;
//   4. the inbox hook HAS a `loadError` to contribute at all, and a failed
//      inbox read is voiced once on the sidecar channel rather than rendered as
//      an empty inbox.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { AiRequest, AiRequestsState } from "@/lib/types";

// ---------------------------------------------------------------------------
// A storage backend whose READ can be made to throw.
// ---------------------------------------------------------------------------
const DISK: { requests: AiRequest[] } = { requests: [] };
const readShouldThrow: { value: boolean } = { value: false };
const readError = new Error("Unexpected end of JSON input");

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async (_docId: string, _file: string, dflt: unknown) => {
    if (readShouldThrow.value) throw readError;
    return _file === "ai-requests.json" ? { requests: [...DISK.requests] } : dflt;
  }),
  writeSidecar: vi.fn(async () => {}),
  mutateSidecar: vi.fn(
    async (
      _h: unknown,
      _file: string,
      _dflt: unknown,
      mutate: (current: AiRequestsState) => AiRequestsState | null,
    ) => {
      const next = mutate({ requests: [...DISK.requests] });
      if (next === null) return null;
      DISK.requests = next.requests;
      return next;
    },
  ),
}));
vi.mock("@/lib/multi-window/doc-pipeline", () => ({
  getActiveHandle: vi.fn(() => ({ docId: "doc-679" })),
  isStalePipelineError: vi.fn(() => false),
}));

import { useAiRequests } from "@/hooks/useAiRequests";
import {
  sourcesAreAuthoritative,
  useAiRequestCardMigration,
  __resetAiRequestCardMigrationForTests,
} from "@/hooks/useAiRequestCardMigration";
import {
  getSidecarRefusal,
  resetSidecarRefusals,
} from "@/lib/sidecar-refusal";
import { describeSidecarRefusal } from "@/lib/document-interruption";

const DOC = "doc-679";

/** One unlinked `note` request — the migration's only convertible input. */
function convertibleRequest(): AiRequest {
  return {
    id: "req-1",
    kind: "note",
    text: "please expand this",
    createdAt: "2026-09-20T00:00:00.000Z",
    status: "draft",
  };
}

beforeEach(() => {
  DISK.requests = [];
  readShouldThrow.value = false;
  resetSidecarRefusals();
  __resetAiRequestCardMigrationForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
});

/* ── 1. The gate ─────────────────────────────────────────────────────── */

describe("sourcesAreAuthoritative", () => {
  it("a source whose read THREW is not authoritative, though it is `loaded`", () => {
    // The exact state the old `ready: a.loaded && b.loaded && c.loaded` read as
    // GO — and the state in which the migration is at its most destructive.
    expect(
      sourcesAreAuthoritative(
        { loaded: true, loadError: true }, // notes.json: corrupt
        { loaded: true, loadError: false },
        { loaded: true, loadError: false },
      ),
    ).toBe(false);
  });

  it("an unresolved source is not authoritative either", () => {
    expect(
      sourcesAreAuthoritative(
        { loaded: false, loadError: false },
        { loaded: true, loadError: false },
      ),
    ).toBe(false);
  });

  it("all three read cleanly → go", () => {
    expect(
      sourcesAreAuthoritative(
        { loaded: true, loadError: false },
        { loaded: true, loadError: false },
        { loaded: true, loadError: false },
      ),
    ).toBe(true);
  });
});

/* ── 2 + 3. The migration stands down, and keeps its claim ───────────── */

describe("useAiRequestCardMigration under a failed source read", () => {
  function mountMigration(sourcesAuthoritative: boolean) {
    const appendNotes = vi.fn();
    const appendTodos = vi.fn();
    const relinkRequests = vi.fn();
    const view = renderHook(() =>
      useAiRequestCardMigration({
        docId: DOC,
        sourcesAuthoritative,
        aiRequests: [convertibleRequest()],
        appendNotes,
        appendTodos,
        relinkRequests,
      }),
    );
    return { view, appendNotes, appendTodos, relinkRequests };
  }

  it("writes NONE of the three sidecars when a source read threw", () => {
    const { appendNotes, appendTodos, relinkRequests } = mountMigration(
      // `notes.json` threw: loaded, but empty and not authoritative.
      sourcesAreAuthoritative(
        { loaded: true, loadError: true },
        { loaded: true, loadError: false },
        { loaded: true, loadError: false },
      ),
    );
    expect(appendNotes).not.toHaveBeenCalled();
    expect(appendTodos).not.toHaveBeenCalled();
    expect(relinkRequests).not.toHaveBeenCalled();
  });

  it("does not burn the doc's one-per-session claim, so a later good read still migrates", () => {
    const failed = mountMigration(false);
    expect(failed.appendNotes).not.toHaveBeenCalled();
    failed.view.unmount();

    // Same session, same doc — the read succeeded this time.
    const good = mountMigration(true);
    expect(good.appendNotes).toHaveBeenCalledTimes(1);
    expect(good.appendNotes.mock.calls[0][0]).toHaveLength(1);
    expect(good.relinkRequests).toHaveBeenCalledTimes(1);
  });
});

/* ── 4. The inbox has a `loadError`, and a voice ─────────────────────── */

describe("useAiRequests on a failed initial read", () => {
  it("reports loaded AND loadError, and voices it once on the sidecar channel", async () => {
    readShouldThrow.value = true;
    const { result } = renderHook(() => useAiRequests(DOC));

    await waitFor(() => expect(result.current.loaded).toBe(true));
    // The read TERMINATED — but the empty list is the default, not the disk.
    expect(result.current.loadError).toBe(true);
    expect(result.current.requests).toEqual([]);

    const refusal = getSidecarRefusal(DOC);
    expect(refusal?.reason).toBe("unreadable");
    expect(refusal?.refusals).toBe(1);
    expect(refusal?.what).toBe("AI request list");

    // …and the band says "couldn't read", not "couldn't save": nothing was
    // lost, the user is simply being shown less than the file holds.
    const { title, body } = describeSidecarRefusal(refusal!);
    expect(title).toContain("couldn't read");
    expect(title).not.toContain("save");
    expect(body).toContain("Unexpected end of JSON input");
  });

  it("a clean read leaves loadError false", async () => {
    DISK.requests = [convertibleRequest()];
    const { result } = renderHook(() => useAiRequests(DOC));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.loadError).toBe(false);
    expect(result.current.requests).toHaveLength(1);
    expect(getSidecarRefusal(DOC)).toBeNull();
  });
});
