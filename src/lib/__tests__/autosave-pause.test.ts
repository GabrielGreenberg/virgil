// Unit tests for the autosave-clobber guard predicate (DESIGN §4). The
// predicate is the single gate every BACKGROUND write path in useDocument
// (debouncedSave / flushNow / flushAnchorCommit) consults before writing, so a
// pending external change pauses autosave instead of clobbering disk. The
// TERMINAL flushes (pagehide / unmount / beforeunload) deliberately do NOT
// consult it — that carve-out is verified by inspection of useDocument.ts.

import { describe, it, expect } from "vitest";
import { shouldPauseAutosave } from "@/lib/autosave-pause";

function fakeWatcher(unresolved: boolean) {
  return { hasUnresolvedChange: () => unresolved };
}

describe("shouldPauseAutosave", () => {
  it("pauses while a watcher reports an unresolved external change", () => {
    expect(shouldPauseAutosave(fakeWatcher(true))).toBe(true);
  });

  it("does NOT pause once the change is resolved (autosave resumes)", () => {
    expect(shouldPauseAutosave(fakeWatcher(false))).toBe(false);
  });

  it("does NOT pause when there is no watcher (no provider / no doc open)", () => {
    expect(shouldPauseAutosave(null)).toBe(false);
    expect(shouldPauseAutosave(undefined)).toBe(false);
  });

  it("flips with the watcher: paused → resumes after the change clears", () => {
    let unresolved = true;
    const watcher = { hasUnresolvedChange: () => unresolved };
    expect(shouldPauseAutosave(watcher)).toBe(true);
    // User resolves (Reload or Dismiss) → watcher clears.
    unresolved = false;
    expect(shouldPauseAutosave(watcher)).toBe(false);
  });
});
