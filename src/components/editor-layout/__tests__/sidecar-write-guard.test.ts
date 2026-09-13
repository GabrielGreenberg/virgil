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
 * Since task 556 this permit is a READER of the one derivation in
 * `@/lib/host-writability` — the same set the storage funnels ask for a
 * `library-paper:` doc — so what it says YES to is what reaches disk. The
 * AGREEMENT of the two layers is pinned in `reader-writability.test.ts`; this
 * suite pins the permit's own answers.
 *
 * Pure logic — chrome-config.ts and the leaf have only type-only imports, so
 * this runs in the default `node` env with no DOM / no heavy module graph.
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

  it("refuses non-card state under READER_CHROME too (a read-mostly host persists ONLY its editable card sidecars)", () => {
    // RENEGOTIATED (task 556). This leg used to assert TRUE here — "non-card
    // state is out of scope for this card guard" — while the storage funnel one
    // layer below refused every one of these writes for a `library-paper:` doc.
    // That was the fork the task closed: a permit that says YES to a write the
    // funnel will refuse is not a permit, and `usePersistentState` stamped its
    // `hasMutatedRef` on the strength of it (hiding the sidecar for the doc,
    // the hazard its own comment names). The Reader's view state is
    // session-only BY DESIGN (`library/READER_INHERITANCE.md`) and a paper's
    // settings belong to the library, so the honest answer at BOTH layers is
    // NO — the effective behaviour (nothing but `notes.json` reaches disk) is
    // unchanged; what changed is that the permit now SAYS so.
    expect(isSidecarWriteAllowed(READER_CHROME, "focus.json")).toBe(false);
    expect(isSidecarWriteAllowed(READER_CHROME, "document-settings.json")).toBe(false);
    expect(isSidecarWriteAllowed(READER_CHROME, "dictionary.json")).toBe(false);
    expect(isSidecarWriteAllowed(READER_CHROME, "something-nobody-declared.json")).toBe(false);
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
