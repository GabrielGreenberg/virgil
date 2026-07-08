// @vitest-environment jsdom
//
// Parity pin for the TEXT_OBJECT_REGISTRY block-atom facets (task 2026-07-06-066).
//
// The former `isAtomBlock` flag did DOUBLE DUTY — it encoded both "select this as
// a whole-node NodeSelection" (selection mode) AND "this is a meaningful block
// atom for heading/block-convert gating + the empty-content archive bail"
// (lifecycle gating). `latexComment` wanted DIFFERENT answers on each axis: since
// the task-017 atom→block remodel it is a CONTENT-bearing block (`content:
// "text*"`) — so it must resolve to an inner caret/text range (selection = NOT a
// node) while STILL being a nonsensical heading target (gating = meaningful). The
// flag drifted to `true` and mis-classed it as a selection-atom.
//
// The split (`selectsAsNode` + `isMeaningfulBlockAtom`) fixes that. This test pins
// the SELECTION facet to the LIVE editor schema's `isAtom` for every block kind,
// so `selectsAsNode` can never drift from schema atomicity again — the same
// "generic pin replaces a hand-set literal" move as the 063 `selectable` parity.
//
// The extension barrel transitively imports `@/lib/storage` (via the figure /
// graphics / tex-block NodeView components), whose backend pick does a raw
// `require("@/lib/storage-fsa")` vitest's resolver can't follow. We never CALL a
// storage fn (only build the schema), so a wholesale stub is enough — same
// pattern as atom-selectable-parity.test.ts / borrowed-schema.test.ts.
import { describe, it, expect, vi } from "vitest";

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

import { getSchema } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { TEXT_OBJECT_REGISTRY } from "../text-object-registry";
import type { TextObjectKind } from "../types";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

const schema: Schema = getSchema(buildEditorExtensions(mainCtx()));

/** The block kinds whose registry `kind` name IS the schema node name. Excludes
 *  `linkedRange` — a MARK, not a node (it has no atomicity to parity-check). */
const NODE_KINDS = (Object.keys(TEXT_OBJECT_REGISTRY) as TextObjectKind[]).filter(
  (kind) => !TEXT_OBJECT_REGISTRY[kind].isRange,
);

describe("TEXT_OBJECT_REGISTRY selection facet ↔ live schema atomicity (task 066)", () => {
  it.each(NODE_KINDS)(
    "%s: selectsAsNode matches the live schema node's isAtom",
    (kind) => {
      const type = schema.nodes[kind];
      expect(type, `schema is missing node "${kind}"`).toBeTruthy();
      expect(TEXT_OBJECT_REGISTRY[kind].selectsAsNode).toBe(type.isAtom);
    },
  );

  // Spell out the intended split so a diff to any single row is self-explaining.
  it("the three true atoms select as a node; latexComment (content block) does NOT", () => {
    expect(schema.nodes.displayMath.isAtom).toBe(true);
    expect(schema.nodes.texBlock.isAtom).toBe(true);
    expect(schema.nodes.graphicsBlock.isAtom).toBe(true);
    // The regression this task closes: latexComment is a content-bearing block
    // (NOT a schema atom) since the task-017 remodel, so it must select as text.
    expect(schema.nodes.latexComment.isAtom).toBe(false);
    expect(TEXT_OBJECT_REGISTRY.latexComment.selectsAsNode).toBe(false);
  });

  // The gating facet is NOT a pure schema property — figureBlock is meaningful
  // for destructive-confirm yet must stay "ok" for the block/heading gates, so it
  // is `isMeaningfulBlockAtom:false` while the four true meaningful atoms are true.
  it("the gating facet keeps latexComment meaningful even though its schema node is not an atom", () => {
    expect(TEXT_OBJECT_REGISTRY.latexComment.isMeaningfulBlockAtom).toBe(true);
    expect(schema.nodes.latexComment.isAtom).toBe(false);
    // figureBlock: meaningful-for-confirm but NOT gated (stays "ok").
    expect(TEXT_OBJECT_REGISTRY.figureBlock.isMeaningfulBlockAtom).toBe(false);
  });
});
