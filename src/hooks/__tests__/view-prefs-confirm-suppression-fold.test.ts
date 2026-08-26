// @vitest-environment jsdom
//
// Task 492 — the RETIREMENT half, through the REAL `loadPrefs` pipeline.
//
// `suppressArchiveAtomWarning` was a per-WINDOW `ViewPrefs` field: one of three
// hand-rolled copies of "don't ask again" inside a single caller. The
// capability now lives on the confirm door, and the field is retired — but a
// retirement must not silently DROP the user's answer, so `loadPrefs` folds a
// stored `true` into the new (global) store once and then scrubs the key.
//
// The fold is gated on the new store having never been WRITTEN, which makes it
// at-most-once by construction with no second bookkeeping field. That is the
// property with teeth and the one a test of either module alone cannot see:
// without it a reload after the user pressed *Restore hidden confirmations*
// would resurrect the suppression they had just cleared, forever.
import { beforeEach, describe, expect, it, vi } from "vitest";

const WINDOW_ID = "test-window";
vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => WINDOW_ID }));
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

import { loadPrefs } from "../useViewPrefs";
import {
  __resetConfirmSuppressionsForTest,
  getSuppressedConfirms,
  isConfirmSuppressed,
  restoreAllConfirms,
} from "@/components/confirm-suppression";

const WINDOW_KEY = `virgil-view-prefs/window/${WINDOW_ID}`;

function writeWindow(blob: Record<string, unknown>) {
  localStorage.setItem(WINDOW_KEY, JSON.stringify(blob));
}

beforeEach(() => {
  localStorage.clear();
  __resetConfirmSuppressionsForTest();
});

describe("the retired atom-archive suppression folds onto the confirm door", () => {
  it("carries a stored `true` across (defect leg: the answer would be lost)", () => {
    writeWindow({ suppressArchiveAtomWarning: true });
    loadPrefs();
    expect(isConfirmSuppressed("archive-atom-marker")).toBe(true);
  });

  it("a stored `false` folds nothing", () => {
    writeWindow({ suppressArchiveAtomWarning: false });
    loadPrefs();
    expect(getSuppressedConfirms()).toEqual([]);
  });

  it("scrubs the key so it can never round-trip back into the live prefs", () => {
    writeWindow({ suppressArchiveAtomWarning: true });
    const prefs = loadPrefs();
    expect(
      (prefs as unknown as Record<string, unknown>).suppressArchiveAtomWarning,
    ).toBeUndefined();
  });

  it("DEFECT: a RESTORE survives the next load — the fold is at-most-once", () => {
    writeWindow({ suppressArchiveAtomWarning: true });
    loadPrefs();
    expect(isConfirmSuppressed("archive-atom-marker")).toBe(true);

    // The user presses "Restore hidden confirmations" in Preferences. The blob
    // still carries the legacy key (nothing has rewritten it yet).
    restoreAllConfirms();
    loadPrefs();
    expect(isConfirmSuppressed("archive-atom-marker")).toBe(false);
  });
});
