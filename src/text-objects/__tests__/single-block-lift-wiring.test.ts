/**
 * Deterministic lock for the bodyless-kinds prose + atom lift wiring.
 *
 * Chip 1 (memo L3g): blockquote + codeBlock — editable single-block prose
 * floats on the shared `SingleBlockBody`.
 * Chip 2 (memo L3h): displayMath — the FIRST read-only / first atom kind on
 * the SAME `SingleBlockBody` ("view & move only", decision D: pop out to see
 * the rendered KaTeX + drag it; the formula is edited on the page via the
 * KaTeX popover, so the float has no write-back).
 * Chip 3 (memo L3i): latexComment — the FIRST EDITABLE atom kind on the SAME
 * `SingleBlockBody` (decision A, "fully editable, first-class": pop out the
 * `%comment`, edit it, it round-trips to the source via the float's own
 * `editableAtomView` → onUpdate → write-back). The atom×editable cross-product.
 *
 * Before a kind is migrated it falls to `popoutKeyForLift`'s
 * `default: return null` (lift is a no-op) and carries no `liftMode`
 * (instant-popout default) with a null float body. This pins all three
 * touch-points per kind so a regression that drops a `popoutKeyForLift` case,
 * un-flips `liftMode`, or loses the body registration fails loudly.
 * Float-schema membership for these kinds is already covered by
 * `src/lib/__tests__/editor-extensions.test.ts` (`EXPECTED_FLOAT_ORDER`) —
 * not re-asserted here.
 */
import { describe, it, expect, vi } from "vitest";

// The float-body barrel transitively imports the editor-extensions factory,
// which imports `@/lib/storage` (figure / graphics / tex-block NodeViews).
// storage.ts picks its backend with a raw `require("@/lib/storage-fsa")` the
// vitest resolver can't follow; we never CALL storage here, so a stub is
// enough — same pattern as linked-range-popout-fidelity.test.ts.
vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { popoutKeyForLift } from "../TextObjectGrabHandle";
import {
  TEXT_OBJECT_REGISTRY,
  textObjectPopoutKey,
} from "../text-object-registry";
import type { TextObjectKind } from "../types";
// The per-kind config behind the shared body — pins the read-only contract
// (displayMath editable:false; blockquote/codeBlock editable:true) without
// having to render the body.
import { SINGLE_BLOCK_CONFIG } from "../floats/single-block-body";
// Side-effect import: runs every `registerFloatBody(...)`, including the
// SingleBlockBody registrations for blockquote / codeBlock / displayMath.
import "../floats";

const MIGRATED: TextObjectKind[] = ["blockquote", "codeBlock"];

describe("bodyless-kinds Chip 1 — blockquote + codeBlock lift wiring (L3g)", () => {
  it("popoutKeyForLift returns the canonical key for both kinds (was null)", () => {
    for (const kind of MIGRATED) {
      const key = popoutKeyForLift({ kind, id: "ab12" });
      expect(key).toBe(textObjectPopoutKey({ kind, id: "ab12" }));
      expect(key).toBe(`textobject:${kind}:ab12`);
    }
  });

  it("still returns null for a not-yet-migrated bodyless kind (control)", () => {
    // figureBlock is one of the bodyless kinds still on `default: return null`.
    // (displayMath WAS this control until Chip 2 / L3h migrated it — moved to
    // its own block below.) Keeps the switch provably specific, not a blanket
    // non-null.
    expect(popoutKeyForLift({ kind: "figureBlock", id: "ab12" })).toBeNull();
  });

  it("flips liftMode to lifted-overlay for both kinds (was undefined)", () => {
    for (const kind of MIGRATED) {
      expect(TEXT_OBJECT_REGISTRY[kind].liftMode).toBe("lifted-overlay");
    }
  });

  it("registers ONE shared float body for both kinds (the ListBody precedent)", () => {
    const bqBody = TEXT_OBJECT_REGISTRY.blockquote.floatBodyComponent;
    const codeBody = TEXT_OBJECT_REGISTRY.codeBlock.floatBodyComponent;
    expect(typeof bqBody).toBe("function");
    // Same component instance drives both kinds (kind is resolved from the
    // cardKey inside the body), not two hand-rolled bodies.
    expect(bqBody).toBe(codeBody);
    expect((bqBody as { name?: string }).name).toBe("SingleBlockBody");
  });

  it("keeps blockquote + codeBlock editable (Chip 2's read-only mode didn't touch them)", () => {
    // Chip 2 added a read-only mode to the shared body; the prose kinds must
    // stay editable (byte-identical behavior, write-back intact).
    expect(SINGLE_BLOCK_CONFIG.blockquote?.editable).toBe(true);
    expect(SINGLE_BLOCK_CONFIG.codeBlock?.editable).toBe(true);
  });
});

describe("bodyless-kinds Chip 2 — displayMath READ-ONLY atom lift wiring (L3h)", () => {
  it("popoutKeyForLift now returns the canonical key (was the L3g 'still null' control)", () => {
    const key = popoutKeyForLift({ kind: "displayMath", id: "ab12" });
    expect(key).toBe(textObjectPopoutKey({ kind: "displayMath", id: "ab12" }));
    expect(key).toBe("textobject:displayMath:ab12");
  });

  it("flips liftMode to lifted-overlay (was undefined)", () => {
    expect(TEXT_OBJECT_REGISTRY.displayMath.liftMode).toBe("lifted-overlay");
  });

  it("reuses the SAME shared SingleBlockBody as the prose kinds (one body, many kinds)", () => {
    const mathBody = TEXT_OBJECT_REGISTRY.displayMath.floatBodyComponent;
    expect(typeof mathBody).toBe("function");
    // Not a bespoke atom body — the same component instance the prose kinds use.
    expect(mathBody).toBe(TEXT_OBJECT_REGISTRY.blockquote.floatBodyComponent);
    expect((mathBody as { name?: string }).name).toBe("SingleBlockBody");
  });

  it("is READ-ONLY — editable:false, so the body wires no onUpdate / write-back (decision D)", () => {
    // The load-bearing decision of this chip: displayMath is "view & move
    // only" — the equation is edited on the page via the KaTeX popover, never
    // in the float. editable:false is what both suppresses write-back AND
    // (because the float editor mounts non-editable) makes the in-float
    // math-click edit bridge inert.
    expect(SINGLE_BLOCK_CONFIG.displayMath?.editable).toBe(false);
    // Atom kinds seed an attr-based empty fallback, not a content-bearing one.
    expect(SINGLE_BLOCK_CONFIG.displayMath?.emptyAttrs).toEqual({ latex: "" });
  });
});

describe("bodyless-kinds Chip 3 — latexComment EDITABLE atom lift wiring (L3i)", () => {
  it("popoutKeyForLift now returns the canonical key (was the default null)", () => {
    const key = popoutKeyForLift({ kind: "latexComment", id: "ab12" });
    expect(key).toBe(textObjectPopoutKey({ kind: "latexComment", id: "ab12" }));
    expect(key).toBe("textobject:latexComment:ab12");
  });

  it("flips liftMode to lifted-overlay (was undefined)", () => {
    expect(TEXT_OBJECT_REGISTRY.latexComment.liftMode).toBe("lifted-overlay");
  });

  it("reuses the SAME shared SingleBlockBody as the prose + math kinds (one body, many kinds)", () => {
    const cmtBody = TEXT_OBJECT_REGISTRY.latexComment.floatBodyComponent;
    expect(typeof cmtBody).toBe("function");
    // Not a bespoke atom body — the same component instance every other kind uses.
    expect(cmtBody).toBe(TEXT_OBJECT_REGISTRY.blockquote.floatBodyComponent);
    expect(cmtBody).toBe(TEXT_OBJECT_REGISTRY.displayMath.floatBodyComponent);
    expect((cmtBody as { name?: string }).name).toBe("SingleBlockBody");
  });

  it("is EDITABLE — editable:true + attr-based emptyAttrs (decision A, the atom×editable cross-product)", () => {
    // The load-bearing decision of this chip: latexComment is "fully editable,
    // first-class" — pop out the `%comment`, edit it, it round-trips. editable:true
    // wires onUpdate / write-back (unlike displayMath's read-only mode); emptyAttrs
    // makes it an atom (attr-based empty seed/fallback, unlike the prose kinds).
    expect(SINGLE_BLOCK_CONFIG.latexComment?.editable).toBe(true);
    expect(SINGLE_BLOCK_CONFIG.latexComment?.emptyAttrs).toEqual({ text: "" });
  });

  it("keeps figureBlock as the still-null control (the switch stays provably specific)", () => {
    // figureBlock is still on `popoutKeyForLift`'s `default: return null` and
    // carries no liftMode — so a future regression that blanket-returns non-null
    // (or blanket-flips liftMode) still fails loudly here.
    expect(popoutKeyForLift({ kind: "figureBlock", id: "ab12" })).toBeNull();
    expect(TEXT_OBJECT_REGISTRY.figureBlock.liftMode).toBeUndefined();
  });
});
