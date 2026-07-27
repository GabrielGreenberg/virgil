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
import { DOMSerializer } from "@tiptap/pm/model";
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

// ─────────────────────────────────────────────────────────────────────────────
// Task 232: pin the STRUCTURAL facets (nodeName / domType / domClass / idAttr),
// not just `selectable`. Task 063 verified these four "against the live nodes" by
// HAND and left them free to drift. The blast radius: the grab gesture builds
// `ATOM_DOM_SELECTOR` from `domType` and resolves the kind via
// `atomMetaForDomType(el.getAttribute("data-type"))` (inline-atom-grab.ts); a
// NodeView renaming its `data-type`/class silently kills `InlineAtomGrab` for
// that kind, with no test to catch it — the exact gap 063 closed for
// `selectable`, left open here.
//
// The four atom nodes now DERIVE these facets from ATOM_REGISTRY
// (footnote/citation/label + math's inline branch), so a NodeView can no longer
// diverge from the SSOT by construction. This test is the floor that still
// catches a stale registry row, a `nodeName` typo, or any FUTURE atom that
// reverts to a divergent literal — assert the render output against the registry
// via the schema's own `toDOM` (DOMSerializer, which uses renderHTML, not the
// editor-view NodeView), the same faithful-render approach the `selectable` pin
// uses for the live schema. displayMath is intentionally absent (a block, not an
// inline atom — the registry correctly omits it).
describe("ATOM_REGISTRY structural facets ↔ live schema/render parity (task 232)", () => {
  const kinds = Object.keys(ATOM_REGISTRY) as AtomKind[];
  const serializer = DOMSerializer.fromSchema(schema);

  it.each(kinds)(
    "%s: registry nodeName resolves to a live schema node",
    (kind) => {
      const meta = ATOM_REGISTRY[kind];
      expect(
        schema.nodes[meta.nodeName],
        `schema is missing atom node "${meta.nodeName}" (ATOM_REGISTRY.${kind}.nodeName)`,
      ).toBeTruthy();
    },
  );

  it.each(kinds)(
    "%s: renderHTML/toDOM emits data-type === registry.domType and class ⊇ registry.domClass",
    (kind) => {
      const meta = ATOM_REGISTRY[kind];
      const node = schema.nodes[meta.nodeName].create();
      const el = serializer.serializeNode(node) as HTMLElement;
      expect(el.getAttribute("data-type")).toBe(meta.domType);
      expect(el.classList.contains(meta.domClass)).toBe(true);
    },
  );

  // idAttr is only meaningful for the Card-bearing atoms (footnote/citation);
  // ref/inline-math own no Card and declare it `null`. A non-null idAttr MUST be
  // a real declared attr on the schema node — the by-id float/drop path reads
  // `node.attrs[meta.idAttr]` (stack-pull.ts), so a stale name silently misses.
  it.each(kinds.filter((k) => ATOM_REGISTRY[k].idAttr !== null))(
    "%s: non-null registry.idAttr is a declared attr on the schema node",
    (kind) => {
      const meta = ATOM_REGISTRY[kind];
      const attrs = schema.nodes[meta.nodeName].spec.attrs ?? {};
      expect(Object.keys(attrs)).toContain(meta.idAttr!);
    },
  );
});
