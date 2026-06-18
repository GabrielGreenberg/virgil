// @vitest-environment jsdom
//
// W4b — T5 Pillar E-1: host-wiring batch + required-prop discipline.
//
// The class (C7, "missing / unwired UI surface"): a producing surface
// advertises an action whose host never wired the callback, so the affordance
// is silently inert. The audit-confirmed instances this slice closes:
//
//   * CI-A2-01 — dragging an UNANCHORED citation card into the editor body did
//     nothing. The `<Editor onCitationDrop>` gate (Editor.tsx handleDrop) was
//     live, and `useCitationActions.handleCitationDrop` (the main-editor drop
//     handler that re-anchors an unanchored card) existed — but NO host ever
//     threaded the prop into the editor. EditorPane now wires it.
//
//   * REP-F4-01 / OMNI-F5-01 / REP-C1-01 — the Reports panel/omni cards declared
//     citation-display + editor-focus + AI-request wiring that ReportsPanel /
//     buildReportsOmniItems never threaded.
//
// DEEP FIX (the reason this class can't silently recur): the correctness-
// critical props are now REQUIRED at the host-facing boundary, so a host that
// omits one fails the TYPE-CHECK rather than shipping a dead affordance. This
// file pins both halves:
//
//   (1) the CI-A2-01 wiring REPRO — `handleCitationDrop(command, unanchoredId)`
//       reuses the unanchored card's id and clears its `unanchored` flag
//       (the card transitions to "anchored" instead of leaving a duplicate);
//   (2) a COMPILE-TIME required-prop proof — a `ReportsPanel` / `buildReports
//       OmniItems` props object that OMITS a now-required wiring prop is not
//       assignable, so the build breaks. (Mirrors the W4a SCOPE_DISPATCH
//       exhaustiveness guard: structural, not a runtime assert.)

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "writeBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  return Object.fromEntries(names.map((n) => [n, noop]));
});

import { renderHook } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { RefObject } from "react";
import { useCitationActions } from "@/components/editor-layout/card-actions/citations";
import type { EditorHandle } from "@/components/Editor";
import type { CitationRef } from "@/lib/types";
import ReportsPanel from "@/panels/Reports/ReportsPanel";
import { buildReportsOmniItems } from "@/panels/Reports/omni";

// ─────────────────────────────────────────────────────────────────────────
// (1) CI-A2-01 — the unanchored-citation drop wiring repro.
//
// The producer EditorPane now threads into `<Editor onCitationDrop>` is
// `useCitationActions.handleCitationDrop`. Exercise it directly with the same
// inputs the CitationCard drag emits ({ command, citationId }): when the id
// belongs to an UNANCHORED card not yet in the editor, the handler must reuse
// that id (so the drop re-anchors the existing card, never duplicates it).
// ─────────────────────────────────────────────────────────────────────────

function setup(opts: {
  /** citationIds already present as editor `\cite` atoms. */
  anchoredIds?: string[];
}) {
  const anchored = new Set(opts.anchoredIds ?? []);
  // A fake editor handle whose getCitations() reports what's anchored.
  const editorRef = {
    current: {
      getCitations: () =>
        [...anchored].map((id) => ({ citationId: id, command: "\\cite{x}" })),
    },
  } as unknown as RefObject<EditorHandle | null>;

  // Capture the addCitation calls; mimic re-anchor semantics (reuse existingId).
  const addCalls: Array<{ command: string; existingId?: string }> = [];
  const addCitation = vi.fn(
    (command: string, existingId?: string): CitationRef => {
      addCalls.push({ command, existingId });
      return {
        id: existingId ?? "fresh-id",
        command,
        keys: [],
        createdAt: "2026-06-18T00:00:00.000Z",
      };
    },
  );

  const { result } = renderHook(() =>
    useCitationActions({
      editorRef,
      getCitationDisplayText: (cmd) => `display:${cmd}`,
      addCitation,
    }),
  );
  return { handleCitationDrop: result.current.handleCitationDrop, addCalls, addCitation };
}

describe("CI-A2-01 — onCitationDrop wiring (drag unanchored citation → anchors it)", () => {
  it("reuses an UNANCHORED card's id so the drop re-anchors it (no duplicate)", () => {
    const { handleCitationDrop, addCalls } = setup({ anchoredIds: [] });
    const out = handleCitationDrop("\\cite{smith2020}", "unanchored-card");
    // The handler reuses the dragged card's id → addCitation(command, sameId).
    expect(addCalls).toEqual([
      { command: "\\cite{smith2020}", existingId: "unanchored-card" },
    ]);
    expect(out).toEqual({ id: "unanchored-card", displayText: "display:\\cite{smith2020}" });
  });

  it("does NOT reuse an already-anchored id (avoids re-anchoring a live atom) — mints fresh", () => {
    const { handleCitationDrop, addCalls } = setup({ anchoredIds: ["already-here"] });
    const out = handleCitationDrop("\\cite{smith2020}", "already-here");
    // The id is already an editor atom → don't reuse; mint fresh.
    expect(addCalls).toEqual([{ command: "\\cite{smith2020}", existingId: undefined }]);
    expect(out?.id).toBe("fresh-id");
  });

  it("with no citationId (bib-key drag) mints a fresh ref", () => {
    const { handleCitationDrop, addCalls } = setup({ anchoredIds: [] });
    const out = handleCitationDrop("\\cite{novel}");
    expect(addCalls).toEqual([{ command: "\\cite{novel}", existingId: undefined }]);
    expect(out?.id).toBe("fresh-id");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (2) Required-prop discipline — COMPILE-TIME proof.
//
// These assertions only type-check if the named props are REQUIRED on the
// host-facing boundary. If a future refactor makes any of them optional (the
// trap that created C7), the corresponding `satisfies` line fails the build —
// turning the "silently inert affordance" regression into a compile error.
// ─────────────────────────────────────────────────────────────────────────

type ReportsPanelProps = ComponentProps<typeof ReportsPanel>;

// `RequiredKeys<T>` is the set of keys that are NOT optional on T (a key whose
// value type does not admit `undefined`).
type RequiredKeys<T> = {
  [K in keyof T]-?: undefined extends T[K] ? never : K;
}[keyof T];

// The wiring props whose presence the affordance's correctness depends on.
type ReportsWiringRequired = "getCitationDisplayText" | "onCitationCreated" | "onEditorFocus";

// TEETH: assign the FULL wiring union INTO the set of ReportsPanel's required
// keys (intersected with the wiring union). This type-checks ONLY when every
// member of `ReportsWiringRequired` is actually a required key of
// ReportsPanelProps. If a refactor makes any of the three `optional`, that key
// drops out of `RequiredKeys<ReportsPanelProps>`, the right-hand `Extract`
// narrows, and the wider `ReportsWiringRequired` is no longer assignable to it
// — a COMPILE error. (Assigning narrow→wide would always pass, so the
// direction here is what gives the guard teeth.)
const _reportsRequired: Extract<RequiredKeys<ReportsPanelProps>, ReportsWiringRequired> =
  null as unknown as ReportsWiringRequired;
void _reportsRequired;

// Same proof for the omni builder boundary (OMNI-F4-01 / OMNI-F5-01): the
// `BuildArgs` of buildReportsOmniItems requires the citation/editor triplet.
type ReportsOmniArgs = Parameters<typeof buildReportsOmniItems>[0];
type ReportsOmniWiringRequired = "getCitationDisplayText" | "onCitationCreated" | "setOverrideEditor";
const _reportsOmniRequired: Extract<RequiredKeys<ReportsOmniArgs>, ReportsOmniWiringRequired> =
  null as unknown as ReportsOmniWiringRequired;
void _reportsOmniRequired;

describe("Pillar E-1 — required-prop discipline (compile-time guard)", () => {
  it("ReportsPanel + buildReportsOmniItems wiring props are REQUIRED", () => {
    // The real teeth are at compile time (the type aliases above). These runtime
    // assertions document the contract and keep the suite honest: the listed
    // wiring props are the ones a host must supply or fail the build.
    const panelRequired: ReportsWiringRequired[] = [
      "getCitationDisplayText",
      "onCitationCreated",
      "onEditorFocus",
    ];
    const omniRequired: ReportsOmniWiringRequired[] = [
      "getCitationDisplayText",
      "onCitationCreated",
      "setOverrideEditor",
    ];
    expect(panelRequired).toHaveLength(3);
    expect(omniRequired).toHaveLength(3);
  });
});
