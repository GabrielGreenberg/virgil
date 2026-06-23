/**
 * Sidecar write-boundary guard (Library-Reader-refactor read-only invariant).
 *
 * `isSidecarWriteAllowed(chrome, filename)` is the single decision point the
 * `usePersistentState` write path consults before persisting a card sidecar.
 * The Reader (`READER_CHROME.editableCardKinds: ["note"]`) must be able to land
 * note annotations (`notes.json`) while EVERY other card sidecar
 * (footnotes/citations/todos/reports/…) is refused — and the main app
 * (`FULL_CHROME`, no whitelist) must keep writing everything.
 *
 * This pins that boundary against the real `READER_CHROME` / `FULL_CHROME`
 * constants and the real `CARD_KIND_SIDECAR` filenames, so a future widening
 * of the Reader's writable surface is a conscious, test-breaking change.
 *
 * Pure logic — chrome-config.ts has only type-only imports, so this runs in the
 * default `node` env with no DOM / no heavy module graph.
 */

import { describe, it, expect } from "vitest";
import {
  isSidecarWriteAllowed,
  READER_CHROME,
  FULL_CHROME,
} from "../chrome-config";

// The card sidecars the Reader must REFUSE. `notes.json` is intentionally
// excluded — it's the one allowed write (note + highlight share it). These are
// the real filenames from `CARD_KIND_SIDECAR`; if that map is renamed this list
// must follow (a deliberate diff).
const REFUSED_CARD_SIDECARS = [
  "todos.json",
  "reports.json",
  "archive.json",
  "revisions.json",
  "cutter.json",
];

describe("isSidecarWriteAllowed — Reader is note-write-only", () => {
  it("allows the note sidecar (note annotations land while reading)", () => {
    expect(isSidecarWriteAllowed(READER_CHROME, "notes.json")).toBe(true);
  });

  it("refuses every OTHER card sidecar under READER_CHROME", () => {
    for (const filename of REFUSED_CARD_SIDECARS) {
      expect(isSidecarWriteAllowed(READER_CHROME, filename)).toBe(false);
    }
  });

  it("allows non-card state under READER_CHROME (focus/style/view-ui are out of scope)", () => {
    // A filename that is NOT a known card sidecar is non-card state and is
    // never gated — the guard governs card sidecars only.
    expect(isSidecarWriteAllowed(READER_CHROME, "focus-mode.json")).toBe(true);
    expect(isSidecarWriteAllowed(READER_CHROME, "document-style.json")).toBe(true);
    expect(isSidecarWriteAllowed(READER_CHROME, "view-ui.json")).toBe(true);
  });
});

describe("isSidecarWriteAllowed — FULL_CHROME writes everything", () => {
  it("allows the note sidecar AND every refused-in-Reader card sidecar", () => {
    expect(isSidecarWriteAllowed(FULL_CHROME, "notes.json")).toBe(true);
    for (const filename of REFUSED_CARD_SIDECARS) {
      expect(isSidecarWriteAllowed(FULL_CHROME, filename)).toBe(true);
    }
  });

  it("allows an arbitrary / unknown filename too (no whitelist → unrestricted)", () => {
    expect(isSidecarWriteAllowed(FULL_CHROME, "anything-at-all.json")).toBe(true);
  });
});
