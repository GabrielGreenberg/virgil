// Unit tests for the autosave PAUSE door (DESIGN §4; widened by task 489).
// The door is the single gate every BACKGROUND write path in useDocument
// (debouncedSave / flushNow / saveWithDelimiters / saveNowRequested) consults
// before writing, so a pending external change — or a cowork skill mid-commit
// — pauses autosave instead of clobbering disk. The TERMINAL flushes (pagehide
// / unmount / beforeunload) deliberately do NOT consult it; that carve-out is
// verified by inspection of useDocument.ts.
//
// Task 489 renegotiated the door's SHAPE in place, and the renegotiation is the
// point rather than a rename: the pre-489 `shouldPauseAutosave` returned a
// boolean, so every one of the four call sites hard-coded
// `noteSaveBlocked(docId, "conflict")` on the next line — four copies of one
// mapping, and the shape in which a second pause SOURCE gets a wrong voice on
// the save-state channel. The predicate that decides to pause is the thing that
// knows why, so it now says so.

import { describe, it, expect, afterEach } from "vitest";
import { autosavePauseReason } from "@/lib/autosave-pause";
import { clearCoworkPen, noteCoworkPen } from "@/lib/cowork-pen";

function fakeWatcher(unresolved: boolean) {
  return { hasUnresolvedChange: () => unresolved };
}

const DOC = "doc-1";

function holdPen(msFromNow = 30_000) {
  noteCoworkPen(DOC, {
    holder: "claude",
    since: Date.now(),
    expiresAt: Date.now() + msFromNow,
    source: "pen-context",
  });
}

afterEach(() => clearCoworkPen());

describe("autosavePauseReason · the conflict rung", () => {
  it("pauses while a watcher reports an unresolved external change", () => {
    expect(autosavePauseReason(fakeWatcher(true), DOC)).toBe("conflict");
  });

  it("does NOT pause once the change is resolved (autosave resumes)", () => {
    expect(autosavePauseReason(fakeWatcher(false), DOC)).toBe(null);
  });

  it("does NOT pause when there is no watcher (no provider / no doc open)", () => {
    expect(autosavePauseReason(null, DOC)).toBe(null);
    expect(autosavePauseReason(undefined, DOC)).toBe(null);
  });

  it("flips with the watcher: paused → resumes after the change clears", () => {
    let unresolved = true;
    const watcher = { hasUnresolvedChange: () => unresolved };
    expect(autosavePauseReason(watcher, DOC)).toBe("conflict");
    // User resolves (Reload or Dismiss) → watcher clears.
    unresolved = false;
    expect(autosavePauseReason(watcher, DOC)).toBe(null);
  });
});

describe("autosavePauseReason · the cowork rung (task 489)", () => {
  it("pauses while a cowork skill holds this document's pen", () => {
    holdPen();
    expect(autosavePauseReason(null, DOC)).toBe("cowork");
  });

  it("resumes the moment the pen is released", () => {
    holdPen();
    expect(autosavePauseReason(null, DOC)).toBe("cowork");
    noteCoworkPen(DOC, null);
    expect(autosavePauseReason(null, DOC)).toBe(null);
  });

  it("is per-DOCUMENT: a hold on another paper pauses nothing here", () => {
    holdPen();
    expect(autosavePauseReason(null, "other-doc")).toBe(null);
  });

  // The warm keep-alive case, and the reason the cowork rung takes `docId`
  // rather than riding the watcher: the watcher is null for every doc but the
  // ACTIVE one, so a skill committing against a BACKGROUND paper would have no
  // way to pause that paper's autosave through the conflict rung at all.
  it("pauses a warm (watcher-less) document a skill is committing to", () => {
    holdPen();
    expect(autosavePauseReason(null, DOC)).toBe("cowork");
  });

  it("cowork OUTRANKS conflict while the pen is held, and yields after", () => {
    const watcher = fakeWatcher(true);
    holdPen();
    // Both are true — a skill's own write IS the kind of external change the
    // watcher detects — and while the pen is held the transient, self-clearing
    // statement is the truer one.
    expect(autosavePauseReason(watcher, DOC)).toBe("cowork");
    noteCoworkPen(DOC, null);
    // …and the standing conflict is still there to say afterwards.
    expect(autosavePauseReason(watcher, DOC)).toBe("conflict");
  });

  // Fail toward RELEASING: an expiry is re-checked at READ time, not only at
  // publish time, because the pause is asked at debounce-fire — far more often
  // than the 5 s poll that publishes it.
  it("stops pausing once the hold's expiry has passed, without a re-poll", () => {
    holdPen(-1);
    expect(autosavePauseReason(null, DOC)).toBe(null);
  });

  it("returns null for a null docId (no paper open)", () => {
    holdPen();
    expect(autosavePauseReason(null, null)).toBe(null);
    expect(autosavePauseReason(null, undefined)).toBe(null);
  });
});
