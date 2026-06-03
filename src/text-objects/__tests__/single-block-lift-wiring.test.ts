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
 * Chip 4 (memo L3j): titleField — the LAST prose-shaped kind on the SAME
 * `SingleBlockBody` (decision C: include; editable + content-bearing like
 * blockquote, so NO emptyAttrs). The one wrinkle was the float schema:
 * titleField was the lone bodyless kind that was main-only, so its node was
 * promoted into the float stack (editor-extensions.ts) — that promotion is
 * locked by editor-extensions.test.ts (EXPECTED_FLOAT_ORDER / MAIN_ONLY_NAMES),
 * not re-asserted here.
 * Chip 5 (memo L3k): listItem — the FIRST SUB-OBJECT. NOT a `SingleBlockBody`
 * kind: a bare item is `group:"textObject"` (not block), so it gets its OWN
 * `ListItemBody` (wrap-seed + inner-targeted write-back) plus a marker-rescue
 * `renderGhost`. This block pins the three touch-points AND that the body is
 * distinct from the shared `SingleBlockBody`. The wrap-seed→inner-write
 * round-trip itself is locked in `list-item-inner-writeback.test.ts`.
 *
 * Chip 7 (memo L3n): figureBlock + graphicsBlock — the FINAL kind migration.
 * The figure's OWN lifted-overlay float renders the shared FigureVisual via a
 * new `figureFloat` NodeView mode (figureBlock = editable caption + read-only
 * image; graphicsBlock = read-only image), on ONE shared `FigureBody`. With
 * these two, ALL 16 graspable kinds lift — so the per-chip "figureBlock is the
 * still-null control" assertions are RETIRED, replaced by the exhaustiveness
 * block at the bottom (every kind lifts; the switch stays specific via an
 * invalid-kind guard).
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

  it("default branch returns null for a non-graspable kind (specificity guard)", () => {
    // figureBlock WAS the still-null control through Chips 1-6, but L3n migrated
    // it (and graphicsBlock) — the last two — so every real TextObjectKind now
    // lifts. The switch must still be provably specific (a blanket `return
    // textObjectPopoutKey(ref)` default would be a regression), so an invalid
    // kind still hits `default: return null`. Full-set exhaustiveness is locked
    // in the L3n "all 16 kinds lift" block below.
    expect(
      popoutKeyForLift({ kind: "notAKind" as TextObjectKind, id: "ab12" }),
    ).toBeNull();
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
});

describe("bodyless-kinds Chip 4 — titleField lift wiring (L3j)", () => {
  it("popoutKeyForLift now returns the canonical key (was the default null)", () => {
    const key = popoutKeyForLift({ kind: "titleField", id: "ab12" });
    expect(key).toBe(textObjectPopoutKey({ kind: "titleField", id: "ab12" }));
    expect(key).toBe("textobject:titleField:ab12");
  });

  it("flips liftMode to lifted-overlay (was undefined)", () => {
    expect(TEXT_OBJECT_REGISTRY.titleField.liftMode).toBe("lifted-overlay");
  });

  it("reuses the SAME shared SingleBlockBody as the prose + atom kinds (one body, many kinds)", () => {
    const titleBody = TEXT_OBJECT_REGISTRY.titleField.floatBodyComponent;
    expect(typeof titleBody).toBe("function");
    // The same component instance every other migrated kind uses — kind is
    // resolved from the cardKey inside the body, not a bespoke title body.
    expect(titleBody).toBe(TEXT_OBJECT_REGISTRY.blockquote.floatBodyComponent);
    expect(titleBody).toBe(TEXT_OBJECT_REGISTRY.latexComment.floatBodyComponent);
    expect((titleBody as { name?: string }).name).toBe("SingleBlockBody");
  });

  it("is EDITABLE + content-bearing — editable:true, NO emptyAttrs (the last prose-shaped kind, like blockquote)", () => {
    // titleField is editable like the prose kinds, but — unlike the atom kinds
    // (displayMath/latexComment) — it is content-bearing (`content:"inline*"`),
    // so it carries NO emptyAttrs: `emptyBlockFor` builds `{type, content:[]}`,
    // valid for `inline*`. This pins that the body treats it as a content block,
    // not an attr-based atom.
    expect(SINGLE_BLOCK_CONFIG.titleField?.editable).toBe(true);
    expect(SINGLE_BLOCK_CONFIG.titleField?.emptyAttrs).toBeUndefined();
  });
});

/*
 * Chip 6 (memo L3l): exampleItem — the LAST SUB-OBJECT, a mirror of listItem
 * one wrap level deeper. NOT a `SingleBlockBody` kind AND not the same body as
 * listItem: it gets its OWN `ExampleItemBody` that wrap-seeds the item in the
 * full `exampleBlock > exampleItemList` envelope and writes back ONLY the inner
 * item's range (unwrapping two levels). Unlike listItem it carries NO
 * `renderGhost` — its marker is a real `.expex-item-marker` DOM child kept by
 * the default clone (the sub-object analog of exampleBlock). The wrap-seed →
 * inner-write round-trip itself is locked in
 * `example-item-inner-writeback.test.ts`.
 */
describe("bodyless-kinds Chip 6 — exampleItem sub-object lift wiring (L3l)", () => {
  it("popoutKeyForLift now returns the canonical key (was the default null)", () => {
    const key = popoutKeyForLift({ kind: "exampleItem", id: "ab12" });
    expect(key).toBe(textObjectPopoutKey({ kind: "exampleItem", id: "ab12" }));
    expect(key).toBe("textobject:exampleItem:ab12");
  });

  it("flips liftMode to lifted-overlay (was undefined)", () => {
    expect(TEXT_OBJECT_REGISTRY.exampleItem.liftMode).toBe("lifted-overlay");
  });

  it("registers its OWN bespoke ExampleItemBody — NOT the shared SingleBlockBody, NOT ListItemBody", () => {
    // A sub-object is a distinct shape (wrap-seed + inner-targeted write-back),
    // so it gets its own body — and exampleItem's envelope is one level deeper
    // than listItem's, so it is ALSO distinct from ListItemBody (not a shared
    // sub-object body).
    const body = TEXT_OBJECT_REGISTRY.exampleItem.floatBodyComponent;
    expect(typeof body).toBe("function");
    expect((body as { name?: string }).name).toBe("ExampleItemBody");
    expect(body).not.toBe(TEXT_OBJECT_REGISTRY.blockquote.floatBodyComponent);
    expect(body).not.toBe(TEXT_OBJECT_REGISTRY.listItem.floatBodyComponent);
  });

  it("defines NO renderGhost — the default clone lays out faithfully (unlike listItem's bullet rescue)", () => {
    // exampleItem's marker is a real `.expex-item-marker` DOM child kept by the
    // default clone, and its marker+body grid is self-contained on
    // `.expex-item-row` — so it needs no marker-rescue ghost (the sub-object
    // analog of exampleBlock, which also carries none). listItem DOES define one
    // (a bare `<li>` loses its CSS `::marker`); pin the contrast so a future
    // regression that blanket-adds/removes ghosts fails loudly.
    expect(TEXT_OBJECT_REGISTRY.exampleItem.renderGhost).toBeUndefined();
    expect(typeof TEXT_OBJECT_REGISTRY.listItem.renderGhost).toBe("function");
  });
});

describe("bodyless-kinds Chip 5 — listItem sub-object lift wiring (L3k)", () => {
  it("popoutKeyForLift now returns the canonical key (was the default null)", () => {
    const key = popoutKeyForLift({ kind: "listItem", id: "ab12" });
    expect(key).toBe(textObjectPopoutKey({ kind: "listItem", id: "ab12" }));
    expect(key).toBe("textobject:listItem:ab12");
  });

  it("flips liftMode to lifted-overlay (was undefined)", () => {
    expect(TEXT_OBJECT_REGISTRY.listItem.liftMode).toBe("lifted-overlay");
  });

  it("registers its OWN bespoke ListItemBody — NOT the shared SingleBlockBody", () => {
    // The load-bearing fact of this chip: a sub-object is a distinct shape
    // (wrap-seed + inner-targeted write-back), so it gets its own body — not
    // folded into the shared SingleBlockBody the way the prose/atom kinds were.
    const body = TEXT_OBJECT_REGISTRY.listItem.floatBodyComponent;
    expect(typeof body).toBe("function");
    expect((body as { name?: string }).name).toBe("ListItemBody");
    expect(body).not.toBe(TEXT_OBJECT_REGISTRY.blockquote.floatBodyComponent);
  });

  it("defines a marker-rescue renderGhost (the bare-<li> loses its bullet)", () => {
    // A sub-object's default clone is a detached `<li>` whose `::marker`
    // renders via the enclosing list's padding — gone when detached. The hook
    // re-wraps it in `.tiptap > ul/ol > li`; pin that it exists (the prose
    // kinds carry none).
    expect(typeof TEXT_OBJECT_REGISTRY.listItem.renderGhost).toBe("function");
    expect(TEXT_OBJECT_REGISTRY.blockquote.renderGhost).toBeUndefined();
  });
});

/*
 * Chip 7 (memo L3n): figureBlock + graphicsBlock — the FINAL kind migration.
 * The figure's OWN lifted-overlay float renders the shared FigureVisual via a
 * new `figureFloat` NodeView mode: figureBlock = EDITABLE caption + read-only
 * image (decision B); graphicsBlock (atom) = read-only image (≈ displayMath).
 * ONE shared `FigureBody` serves both (the ListBody precedent). No
 * `renderGhost` — the default clone + warm object-URL is faithful (like
 * exampleItem). With these two, ALL 16 graspable kinds lift; the figureBlock
 * "still-null control" the earlier chips leaned on is retired in favor of the
 * exhaustiveness block below. L4 (retire the staging machinery) is next.
 */
describe("bodyless-kinds Chip 7 — figureBlock + graphicsBlock figure lift wiring (L3n)", () => {
  const FIGURE_KINDS: TextObjectKind[] = ["figureBlock", "graphicsBlock"];

  it("popoutKeyForLift now returns the canonical key for both (was the still-null control)", () => {
    for (const kind of FIGURE_KINDS) {
      const key = popoutKeyForLift({ kind, id: "ab12" });
      expect(key).toBe(textObjectPopoutKey({ kind, id: "ab12" }));
      expect(key).toBe(`textobject:${kind}:ab12`);
    }
  });

  it("flips liftMode to lifted-overlay for both (was undefined)", () => {
    for (const kind of FIGURE_KINDS) {
      expect(TEXT_OBJECT_REGISTRY[kind].liftMode).toBe("lifted-overlay");
    }
  });

  it("registers ONE shared FigureBody for both kinds — NOT SingleBlockBody, NOT a sub-object body", () => {
    const figBody = TEXT_OBJECT_REGISTRY.figureBlock.floatBodyComponent;
    const gfxBody = TEXT_OBJECT_REGISTRY.graphicsBlock.floatBodyComponent;
    expect(typeof figBody).toBe("function");
    // Same component instance drives both kinds (kind resolved from the cardKey
    // inside the body), the ListBody precedent for bullet/ordered lists.
    expect(figBody).toBe(gfxBody);
    expect((figBody as { name?: string }).name).toBe("FigureBody");
    // A figure float is its own shape (editable caption + read-only image via
    // the figureFloat NodeView mode), neither the shared prose/atom body nor a
    // sub-object body.
    expect(figBody).not.toBe(
      TEXT_OBJECT_REGISTRY.blockquote.floatBodyComponent,
    );
    expect(figBody).not.toBe(TEXT_OBJECT_REGISTRY.listItem.floatBodyComponent);
  });

  it("defines NO renderGhost for either — the default clone + warm object-URL is faithful", () => {
    // A figure's DOM cloneNodes faithfully: the `<img src>` is a string attr so
    // the clone reuses the warm object-URL (no re-decode, Issue-7b), figure CSS
    // is class-scoped (reaches the `.tiptap` ghost), and L3e.2's React-NodeView
    // margin reset already covers `.node-figureBlock`/`.node-graphicsBlock`. So
    // neither needs a marker-rescue ghost (unlike listItem's bare-`<li>`).
    expect(TEXT_OBJECT_REGISTRY.figureBlock.renderGhost).toBeUndefined();
    expect(TEXT_OBJECT_REGISTRY.graphicsBlock.renderGhost).toBeUndefined();
  });
});

describe("bodyless-kinds — ALL 16 graspable kinds now lift (L3n completes the set)", () => {
  // After L3n there is no still-null graspable kind left, so the per-chip
  // "figureBlock is the control" assertions are retired in favor of this
  // exhaustiveness lock: EVERY TextObjectKind lifts (non-null popoutKey +
  // lifted-overlay) AND the switch stays provably specific (an invalid kind
  // still hits `default: return null`, so a regression to a blanket non-null
  // default fails here). L4 retires the now-unconditional liftMode staging.
  const ALL_KINDS: TextObjectKind[] = [
    "paragraph",
    "heading",
    "bulletList",
    "orderedList",
    "blockquote",
    "codeBlock",
    "displayMath",
    "titleField",
    "latexComment",
    "texBlock",
    "figureBlock",
    "graphicsBlock",
    "exampleBlock",
    "listItem",
    "exampleItem",
    "linkedRange",
  ];

  it("covers exactly the 16 distinct graspable kinds", () => {
    expect(ALL_KINDS.length).toBe(16);
    expect(new Set(ALL_KINDS).size).toBe(16);
  });

  it("every kind returns a non-null popoutKeyForLift AND carries liftMode lifted-overlay", () => {
    for (const kind of ALL_KINDS) {
      expect(popoutKeyForLift({ kind, id: "ab12" })).toBe(
        `textobject:${kind}:ab12`,
      );
      expect(TEXT_OBJECT_REGISTRY[kind].liftMode).toBe("lifted-overlay");
    }
  });

  it("keeps the switch provably specific — an invalid kind still hits default: null", () => {
    expect(
      popoutKeyForLift({ kind: "notAKind" as TextObjectKind, id: "ab12" }),
    ).toBeNull();
  });
});
