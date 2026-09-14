// Task 545 — the WORDS that reach the user for every interruption state, and
// the writer attribution they branch on. Pure: every input is a store
// snapshot, so this is a render-fact test with no DOM.
//
// No pre-545 suite could see the class: each badge suite drives ONE channel
// and asserts its own pill's phrase, so "the same event described five ways"
// was unrepresentable in all of them — and none of them could ask who WROTE
// the bytes, because nothing recorded the pen's release.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  deriveDocumentInterruption,
  interruptionPillLabel,
  conflictOutcomeNotice,
  type InterruptionInputs,
} from "@/lib/document-interruption";
import {
  attributeExternalWriter,
  clearCoworkPen,
  coworkPenReleaseFromContext,
  COWORK_WRITER_WINDOW_AFTER_MS,
  COWORK_WRITER_WINDOW_BEFORE_MS,
  getCoworkPenLastRelease,
  noteCoworkPen,
  noteCoworkPenRelease,
  type CoworkPenState,
} from "@/lib/cowork-pen";
import {
  describeBlockReason,
  interruptionKindForReason,
  UNSAVED_WARN_MS,
  type SaveStateView,
} from "@/lib/save-state";
import {
  INTERRUPTION_TONE,
  TONE_PALETTE,
  paletteForTone,
  toneForInterruptionKind,
  type InterruptionKind,
} from "@/lib/interruption-tone";
import type { UnsavedBlockReason } from "@/lib/unsaved-work";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExternalChangeState } from "@/lib/disk-watcher";
import type { PreservationNotice } from "@/lib/preservation-notice";

const NOW = 1_700_000_000_000;

const clean: ExternalChangeState = { changes: [], severity: null, detectedAt: null, paused: false };
function external(severity: "change" | "conflict", over: Partial<ExternalChangeState> = {}): ExternalChangeState {
  return {
    changes: [{ relPath: "main.tex", role: "tex", kind: "modified" }],
    severity,
    detectedAt: NOW - 2_000,
    paused: false,
    ...over,
  };
}
function save(over: Partial<SaveStateView> = {}): SaveStateView {
  return { tier: "clean", ageMs: 0, reason: null, lastLandedAt: null, escalated: false, ...over };
}
function held(over: Partial<CoworkPenState> = {}): CoworkPenState {
  return { holder: "claude", since: NOW - 500, expiresAt: NOW + 29_500, source: "pen-context", ...over };
}
function notice(over: Partial<PreservationNotice> = {}): PreservationNotice {
  return {
    docId: "doc-1", source: "load", region: "body", before: 400, after: 120, lost: 280,
    allowed: 4, at: NOW, refusals: 1, acknowledged: false, ...over,
  };
}
function inputs(over: Partial<InterruptionInputs> = {}): InterruptionInputs {
  return { docId: "doc-1", pen: null, penLastReleasedAt: null, external: clean, preservation: null, save: save(), now: NOW, ...over };
}

afterEach(() => clearCoworkPen());

/* ── The writer question ────────────────────────────────────────────── */

describe("attributeExternalWriter", () => {
  it("names the AI while the pen is HELD — the change IS the commit", () => {
    expect(attributeExternalWriter({ detectedAt: NOW, pen: held(), lastReleasedAt: null, now: NOW })).toBe("virgil-ai");
  });
  it("names the AI for a release shortly BEFORE the change was noticed", () => {
    expect(attributeExternalWriter({ detectedAt: NOW, pen: null, lastReleasedAt: NOW - 4_000, now: NOW })).toBe("virgil-ai");
    expect(attributeExternalWriter({ detectedAt: NOW, pen: null, lastReleasedAt: NOW - COWORK_WRITER_WINDOW_BEFORE_MS, now: NOW })).toBe("virgil-ai");
  });
  it("names the AI for a release learned shortly AFTER (the 5 s pen poll lags the 3 s watcher)", () => {
    expect(attributeExternalWriter({ detectedAt: NOW, pen: null, lastReleasedAt: NOW + 4_000, now: NOW })).toBe("virgil-ai");
    expect(attributeExternalWriter({ detectedAt: NOW, pen: null, lastReleasedAt: NOW + COWORK_WRITER_WINDOW_AFTER_MS + 1, now: NOW })).toBe("unknown");
  });
  it("fails toward UNKNOWN: no trace, an old release, a hold that expired, no detection time", () => {
    expect(attributeExternalWriter({ detectedAt: NOW, pen: null, lastReleasedAt: null, now: NOW })).toBe("unknown");
    expect(attributeExternalWriter({ detectedAt: NOW, pen: null, lastReleasedAt: NOW - COWORK_WRITER_WINDOW_BEFORE_MS - 1, now: NOW })).toBe("unknown");
    expect(attributeExternalWriter({ detectedAt: NOW, pen: held({ expiresAt: NOW - 1 }), lastReleasedAt: null, now: NOW })).toBe("unknown");
    expect(attributeExternalWriter({ detectedAt: null, pen: null, lastReleasedAt: NOW, now: NOW })).toBe("unknown");
  });
});

describe("the release trace", () => {
  it("reads `released_at` off a RELEASED record and nothing off a held or absent one", () => {
    expect(coworkPenReleaseFromContext({ holder: null, released_at: new Date(NOW).toISOString() })).toBe(NOW);
    expect(coworkPenReleaseFromContext({ holder: "claude", acquired_at: new Date(NOW).toISOString() })).toBeNull();
    expect(coworkPenReleaseFromContext(null)).toBeNull();
    expect(coworkPenReleaseFromContext({ holder: null })).toBeNull();
  });
  it("is monotonic per doc — a stale record re-read every poll never moves it back", () => {
    noteCoworkPenRelease("doc-1", NOW);
    noteCoworkPenRelease("doc-1", NOW - 60_000);
    expect(getCoworkPenLastRelease("doc-1")).toBe(NOW);
    expect(getCoworkPenLastRelease("doc-2")).toBeNull();
  });
  it("estimates a release when a SEEN hold simply vanishes (a record deleted rather than rewritten)", () => {
    noteCoworkPen("doc-1", held(), NOW);
    noteCoworkPen("doc-1", null, NOW + 5_000);
    expect(getCoworkPenLastRelease("doc-1")).toBe(NOW + 5_000);
    // …but a release record that already named a time for THIS hold wins.
    noteCoworkPen("doc-1", held({ since: NOW + 10_000 }), NOW + 10_000);
    noteCoworkPenRelease("doc-1", NOW + 10_400);
    noteCoworkPen("doc-1", null, NOW + 15_000);
    expect(getCoworkPenLastRelease("doc-1")).toBe(NOW + 10_400);
  });
});

/* ── The words ──────────────────────────────────────────────────────── */

describe("deriveDocumentInterruption", () => {
  it("is NULL for a clean document and for no document at all", () => {
    expect(deriveDocumentInterruption(inputs())).toBeNull();
    expect(deriveDocumentInterruption(inputs({ docId: null, pen: held() }))).toBeNull();
  });

  it("the cowork hold: live tone, its own identity, nothing to do but wait", () => {
    const v = deriveDocumentInterruption(inputs({ pen: held() }))!;
    expect(v.kind).toBe("cowork-hold");
    expect(v.tone).toBe("live");
    expect(v.title).toMatch(/Virgil is editing this paper/);
    expect(v.body).toMatch(/read-only/);
    expect(v.body).toMatch(/saving is paused/i);
    expect(v.recommended).toBeNull();
    expect(v.alternatives).toEqual([]);
    // Gabriel: its own front end — never the word "collaborator".
    expect(`${v.title} ${v.body}`.toLowerCase()).not.toContain("collaborator");
  });

  it("an AI-attributed CONFLICT names Virgil's AI and phrases both doors as outcomes", () => {
    const v = deriveDocumentInterruption(
      inputs({ external: external("conflict"), penLastReleasedAt: NOW - 3_000, save: save({ tier: "blocked", reason: "conflict", ageMs: 4_000 }) }),
    )!;
    expect(v.kind).toBe("conflict");
    expect(v.writer).toBe("virgil-ai");
    expect(v.title).toMatch(/Virgil's AI edited this paper while you had unsaved changes/);
    expect(v.body).not.toMatch(/another app/i);
    expect(v.body).toMatch(/history folder/);
    // YOUNG unsaved work (under the warn threshold): the AI's edits are what
    // the user asked for; their own version is one click behind.
    expect(v.recommended?.id).toBe("take-disk");
    expect(v.recommended?.label).toBe("Use Virgil's edits");
    expect(v.alternatives.map((a) => a.id)).toEqual(["keep-mine"]);
  });

  it("…and recommends the user's OWN version once the unsaved work is real writing", () => {
    const v = deriveDocumentInterruption(
      inputs({ external: external("conflict"), penLastReleasedAt: NOW - 3_000, save: save({ tier: "blocked", reason: "conflict", ageMs: UNSAVED_WARN_MS + 1 }) }),
    )!;
    expect(v.writer).toBe("virgil-ai");
    expect(v.recommended?.id).toBe("keep-mine");
    expect(v.alternatives.map((a) => a.id)).toEqual(["take-disk"]);
  });

  it("an UNKNOWN-writer conflict keeps the honest general answer and recommends keeping mine", () => {
    const v = deriveDocumentInterruption(
      inputs({ external: external("conflict"), save: save({ tier: "blocked", reason: "conflict", ageMs: 90_000 }) }),
    )!;
    expect(v.writer).toBe("unknown");
    expect(v.title).toMatch(/changed outside Virgil while you were editing/);
    expect(v.body).toMatch(/another app or a sync service/i);
    expect(v.body).toMatch(/1 minute of unsaved edits/);
    expect(v.recommended?.id).toBe("keep-mine");
    expect(v.recommended?.label).toBe("Keep my version");
    expect(v.alternatives[0]?.label).toBe("Use the disk version");
  });

  it("a CHANGE with nothing unsaved is informational and recommends loading it", () => {
    const v = deriveDocumentInterruption(inputs({ external: external("change") }))!;
    expect(v.kind).toBe("disk-change");
    expect(v.tone).toBe("info");
    expect(v.body).toMatch(/no unsaved edits/);
    expect(v.recommended?.id).toBe("reload");
    expect(v.alternatives.map((a) => a.id)).toEqual(["dismiss"]);
    const ai = deriveDocumentInterruption(inputs({ external: external("change"), penLastReleasedAt: NOW - 1_000 }))!;
    expect(ai.title).toBe("Virgil's AI finished editing this paper");
    expect(ai.recommended?.label).toBe("Load Virgil's edits");
  });

  it("a REMOVED file says so and does not offer to load what is not there", () => {
    const v = deriveDocumentInterruption(
      inputs({ external: external("change", { changes: [{ relPath: "main.tex", role: "tex", kind: "removed" }] }) }),
    )!;
    expect(v.title).toMatch(/removed from disk/);
    expect(v.recommended?.id).toBe("dismiss");
    expect(v.alternatives).toEqual([]);
  });

  it("a PAUSED watcher (permission lost) says nothing here — the permission gate owns that", () => {
    expect(deriveDocumentInterruption(inputs({ external: external("change", { paused: true }) }))).toBeNull();
  });

  it("a preservation REFUSAL is danger, routes to the badge's own decision, and a serialize refusal offers nothing to save", () => {
    const v = deriveDocumentInterruption(inputs({ preservation: notice() }))!;
    expect(v.kind).toBe("preservation");
    expect(v.tone).toBe("danger");
    expect(v.title).toMatch(/not saving/i);
    expect(v.body).toMatch(/file on disk is unchanged/i);
    expect(v.recommended?.id).toBe("review");
    // The reason it routes by names a flow in the ONE table (task 392).
    expect(describeBlockReason(v.recommended!.reason!).flow).not.toBeNull();
    const ser = deriveDocumentInterruption(inputs({ preservation: notice({ source: "serialize", reason: "Unknown node type: x" }) }))!;
    expect(ser.title).toMatch(/can't write/);
    expect(ser.recommended).toBeNull();
    // Acknowledged → gone.
    expect(deriveDocumentInterruption(inputs({ preservation: notice({ acknowledged: true }) }))).toBeNull();
  });

  it("a failed write is danger with a retry", () => {
    const v = deriveDocumentInterruption(inputs({ save: save({ tier: "blocked", reason: "error", ageMs: 30_000 }) }))!;
    expect(v.kind).toBe("save-error");
    expect(v.tone).toBe("danger");
    expect(v.recommended?.id).toBe("retry");
    expect(v.body).toMatch(/emergency copy/);
  });

  it("PRIORITY: the hold outranks a refusal, a refusal outranks a conflict", () => {
    const all = inputs({
      pen: held(),
      preservation: notice(),
      external: external("conflict"),
      save: save({ tier: "blocked", reason: "conflict", ageMs: 5_000 }),
    });
    expect(deriveDocumentInterruption(all)!.kind).toBe("cowork-hold");
    expect(deriveDocumentInterruption({ ...all, pen: null })!.kind).toBe("preservation");
    expect(deriveDocumentInterruption({ ...all, pen: null, preservation: null })!.kind).toBe("conflict");
  });

  it("the pill label and the band agree about the writer", () => {
    const ai = deriveDocumentInterruption(inputs({ external: external("conflict"), penLastReleasedAt: NOW - 1_000, save: save({ tier: "blocked", reason: "conflict", ageMs: 1_000 }) }))!;
    expect(interruptionPillLabel(ai, "a few seconds")).toBe("Virgil's AI edited this paper · unsaved edits · a few seconds unsaved");
    const unk = deriveDocumentInterruption(inputs({ external: external("conflict"), save: save({ tier: "blocked", reason: "conflict", ageMs: 1_000 }) }))!;
    expect(interruptionPillLabel(unk, null)).toBe("Changed on disk · unsaved edits");
    expect(interruptionPillLabel(deriveDocumentInterruption(inputs({ pen: held() }))!, null)).toBe("Virgil is editing this paper…");
  });

  it("the outcome notice: silent when everything went through, danger only where a version is gone", () => {
    const archive = { slot: "s", disk: ["main.tex"], mine: "unsaved-main.tex" };
    expect(conflictOutcomeNotice({ choice: "keep-mine", archive, applied: true })).toBeNull();
    expect(conflictOutcomeNotice({ choice: "keep-mine", archive, applied: false })?.tone).toBe("default");
    const gone = conflictOutcomeNotice({ choice: "take-disk", archive: null, applied: true })!;
    expect(gone.tone).toBe("danger");
    expect(gone.title).toMatch(/no history copy/);
  });
});

/* ── The register (task 571) ────────────────────────────────────────── */

describe("the tone register · ONE table for the band and the save badge", () => {
  // Pre-571 the band held a private tone → token switch and the save badge
  // re-derived its colour from its TIER (`blocked ⇒ danger`), so for ONE
  // document in ONE state the band painted amber and the save pill red. Both
  // read `interruption-tone.ts` now; these legs pin that the badge's answer
  // for a REASON is the band's answer for the KIND that reason presents as.
  function inputsFor(reason: UnsavedBlockReason): InterruptionInputs {
    switch (reason) {
      case "cowork":
        return inputs({ pen: held() });
      case "preservation":
        return inputs({ preservation: notice() });
      case "conflict":
        return inputs({
          external: external("conflict"),
          save: save({ tier: "blocked", reason: "conflict", ageMs: 4_000 }),
        });
      case "error":
        return inputs({ save: save({ tier: "blocked", reason: "error", ageMs: 4_000 }) });
    }
  }
  const REASONS: UnsavedBlockReason[] = ["cowork", "preservation", "conflict", "error"];

  it.each(REASONS)("%s — the badge's tone IS the band's tone for that state", (reason) => {
    const band = deriveDocumentInterruption(inputsFor(reason));
    expect(band, `the ${reason} inputs must derive a view`).not.toBeNull();
    expect(band!.kind).toBe(interruptionKindForReason(reason));
    expect(describeBlockReason(reason).tone).toBe(band!.tone);
    // …and both read the table rather than each other.
    expect(band!.tone).toBe(INTERRUPTION_TONE[band!.kind]);
  });

  it("every kind has a tone, and the register is what STYLE_GUIDE says it is", () => {
    const kinds: InterruptionKind[] = ["cowork-hold", "preservation", "conflict", "save-error", "disk-change"];
    for (const k of kinds) expect(toneForInterruptionKind(k), k).toBe(INTERRUPTION_TONE[k]);
    // The alarm ramp is reserved for the two states in which the user's work
    // is on no disk and nothing is coming to put it there.
    expect(Object.entries(INTERRUPTION_TONE).filter(([, t]) => t === "danger").map(([k]) => k).sort())
      .toEqual(["preservation", "save-error"]);
    expect(INTERRUPTION_TONE["cowork-hold"]).toBe("live");
    expect(INTERRUPTION_TONE.conflict).toBe("warning");
    expect(INTERRUPTION_TONE["disk-change"]).toBe("info");
  });

  it("every palette token is a var() that globals.css defines", () => {
    const globals = readFileSync(join(__dirname, "..", "..", "app", "globals.css"), "utf8");
    for (const [tone, palette] of Object.entries(TONE_PALETTE)) {
      for (const [slot, value] of Object.entries(palette)) {
        const m = /^var\((--[a-z0-9-]+)\)$/.exec(value);
        expect(m, `${tone}.${slot} = ${value}`).not.toBeNull();
        expect(globals, `${tone}.${slot} → ${m![1]} is undefined`).toMatch(new RegExp(`${m![1]}:\\s*[^;]+;`));
      }
    }
    // `live` and `warning` share tokens BY DESIGN — the breathing glyph is what
    // separates them, and it is the one pill's to carry (STYLE_GUIDE).
    expect(paletteForTone("live")).toEqual(paletteForTone("warning"));
    expect(paletteForTone("danger").bg).toBe("var(--danger-soft)");
  });
});
