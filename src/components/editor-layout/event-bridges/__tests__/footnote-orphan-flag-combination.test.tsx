// @vitest-environment jsdom
//
// The flag COMBINATION that used to drop footnote orphan records on the floor
// (task 2026-09-18-646).
//
// `virgil:inline-atom-lifecycle` and `virgil:identity-cascade` were written as
// independent switches, but they are nested: the lifecycle reconciler registers
// as a POLICY on the identity-bus consumer, and `useIdentityBusConsumer`
// returns `null` whenever the cascade flag is off — so no policy can register.
// Meanwhile every handler in `useFootnoteOrphanBridges` opens with
// `if (isInlineAtomLifecycleOn()) return;`.
//
// Lifecycle ON + cascade OFF therefore disabled BOTH orphan writers at once:
// the legacy bridges bailed *because the new flag was on*, and the reconciler
// never registered *because there was no consumer*. A deleted footnote was
// dropped instead of recorded as an orphan — no error, no warning, and no
// guard anywhere against the combination.
//
// The `requires` edge on the registry row is what makes that state
// unrepresentable: the child flag reads OFF unless its parent is on, so the
// legacy bridges stay live and the record is still written. These pins drive
// the REAL bridge hook with the flags in real `localStorage`, so they fail if
// the edge is ever dropped from the row.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { OrphanedFootnote } from "@/lib/types";
import { clearFlagOverrides } from "@/lib/feature-flags";
import { useFootnoteOrphanBridges } from "../footnote-sync";

const DOC = "docA";

function setup() {
  let current: OrphanedFootnote[] = [];
  const setOrphanedFootnotes = vi.fn(
    (u: OrphanedFootnote[] | ((p: OrphanedFootnote[]) => OrphanedFootnote[])) => {
      current = typeof u === "function" ? u(current) : u;
    },
  );
  renderHook(() =>
    useFootnoteOrphanBridges({ docId: DOC, store: { setOrphanedFootnotes } }),
  );
  return { getOrphans: () => current };
}

const fireOrphaned = (footnoteId: string) =>
  window.dispatchEvent(
    new CustomEvent("virgil-footnote-orphaned", {
      detail: { footnoteId, content: { type: "doc", content: [] }, docId: DOC },
    }),
  );

describe("footnote orphan record survives every reachable flag combination", () => {
  beforeEach(() => {
    localStorage.clear();
    clearFlagOverrides();
  });
  afterEach(() => {
    localStorage.clear();
    clearFlagOverrides();
    vi.restoreAllMocks();
  });

  it("lifecycle ON + cascade OFF — the legacy bridge still records the orphan", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem("virgil:inline-atom-lifecycle", "1");
    // cascade deliberately left unset (OFF) — the combination that lost data.

    const { getOrphans } = setup();
    act(() => fireOrphaned("fn-dropped"));

    expect(getOrphans().map((o) => o.footnoteId)).toEqual(["fn-dropped"]);
  });

  it("both flags OFF — the legacy bridge records it (the shipped default)", () => {
    const { getOrphans } = setup();
    act(() => fireOrphaned("fn-legacy"));
    expect(getOrphans().map((o) => o.footnoteId)).toEqual(["fn-legacy"]);
  });

  it("both flags ON — the bridge stands down and the reconciler owns the write", () => {
    localStorage.setItem("virgil:identity-cascade", "1");
    localStorage.setItem("virgil:inline-atom-lifecycle", "1");

    const { getOrphans } = setup();
    act(() => fireOrphaned("fn-reconciled"));

    // The legacy writer is correctly silent here — this is the one combination
    // in which something ELSE (the bus reconciler) is the writer.
    expect(getOrphans()).toEqual([]);
  });

  it("cascade ON + lifecycle OFF — the legacy bridge records it", () => {
    localStorage.setItem("virgil:identity-cascade", "1");
    const { getOrphans } = setup();
    act(() => fireOrphaned("fn-cascade-only"));
    expect(getOrphans().map((o) => o.footnoteId)).toEqual(["fn-cascade-only"]);
  });
});
