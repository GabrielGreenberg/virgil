// @vitest-environment jsdom
//
// Parity pin for the ATOM_REGISTRY `selectable` facet (task 2026-07-06-063).
//
// `selectable` is a per-kind BEHAVIORAL facet: whether ProseMirror may rest a
// `NodeSelection` on the atom leaf (which triggers a ~100px scrollIntoView jump
// footnote/citation deliberately avoid; inlineMath legitimately wants it for its
// `.selected` chrome + single-node-float selection). Before this pin the flag
// lived only as a hand-set literal (or an UNSET default) in each node file, and
// `labelRef` silently rode PM's `selectable:true` default with none of the need
// footnote/citation opt out of. The registry now DECLARES the intent; this test
// asserts the LIVE editor schema matches it for every atom kind, so the property
// cannot drift per-node again. Same "generic pin replaces hand-maintained
// duplication" move as the 044 grep-allowlist and 057 registry↔JSON equality.
//
// The extension barrel transitively imports `@/lib/storage` (via the figure /
// graphics / tex-block NodeView components), whose backend pick does a raw
// `require("@/lib/storage-fsa")` vitest's resolver can't follow. We never CALL a
// storage fn (only build the schema), so a wholesale stub is enough — same
// pattern as borrowed-schema.test.ts / editor-extensions.test.ts.
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
import { ATOM_REGISTRY, type AtomKind } from "@/lib/tiptap/atom-registry";

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

/**
 * PM's governing predicate for whether a `NodeSelection` can rest on a
 * non-text node (`NodeSelection.isSelectable`): the spec value defaults to
 * TRUE, so anything that isn't explicitly `false` is selectable. Reading the
 * effective boolean (rather than the raw `spec.selectable`, which is `undefined`
 * for a kind that keeps the default) makes the pin behavior-faithful — it can't
 * false-fail when a selectable atom declares its intent implicitly.
 */
function effectiveSelectable(nodeName: string): boolean {
  const type = schema.nodes[nodeName];
  expect(type, `schema is missing atom node "${nodeName}"`).toBeTruthy();
  return type.spec.selectable !== false;
}

describe("ATOM_REGISTRY selectable facet ↔ live schema parity (task 063)", () => {
  const kinds = Object.keys(ATOM_REGISTRY) as AtomKind[];

  it.each(kinds)(
    "%s: schema selectability matches the registry facet",
    (kind) => {
      const meta = ATOM_REGISTRY[kind];
      expect(effectiveSelectable(meta.nodeName)).toBe(meta.selectable);
    },
  );

  // Spell out the intended split so a diff to any single row is self-explaining.
  it("footnote / citation / ref opt OUT of NodeSelection; inline-math opts IN", () => {
    expect(ATOM_REGISTRY.footnote.selectable).toBe(false);
    expect(ATOM_REGISTRY.citation.selectable).toBe(false);
    expect(ATOM_REGISTRY.ref.selectable).toBe(false);
    expect(ATOM_REGISTRY["inline-math"].selectable).toBe(true);
  });

  // The regression this task closes: labelRef used to ride PM's default `true`.
  it("labelRef's live schema node is NOT selectable (the fixed drift)", () => {
    expect(schema.nodes.labelRef.spec.selectable).toBe(false);
    expect(effectiveSelectable("labelRef")).toBe(false);
  });

  // Guard the deliberate outlier: inlineMath MUST stay selectable for its
  // NodeView chrome + single-node-float selection (the refuted "flip all" case).
  it("inlineMath's live schema node stays selectable", () => {
    expect(effectiveSelectable("inlineMath")).toBe(true);
  });
});
