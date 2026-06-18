// @vitest-environment jsdom
//
// T5 Pillar A — `useLivePosResolver`: the shared id→live-pos resolver promoted
// from OmniViewPanel's inline `resolvePos`. These pins assert the two contracts
// the keystroke-sanctity rule turns on:
//
//   1. SNAPSHOT-IDENTITY CACHE — the id→pos map rebuilds ONCE per snapshot
//      identity, never per resolver call within one snapshot, and NEVER on
//      plain typing (the bus emits nothing → no structural work). We probe the
//      rebuild via a spy on the caller's `keyOf` (called once per entry per
//      rebuild), so N resolver calls within one snapshot = ONE rebuild.
//   2. LIVE POSITIONS — after a structural insert ABOVE an atom, the resolver
//      returns the atom's NEW position (the observer re-maps positions every
//      transaction; the resolver reads the fresh snapshot), not the baked one.
//
// Built on the real main-editor stack (Footnote + Citation atoms + the
// DocStructureObserver/bus), the borrowed-atoms-smoke / structural-edit pattern.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Figure / graphics / tex-block React NodeViews transitively import
// `@/lib/storage`; stub it (the smoke-test pattern).
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

import { Editor, type Content } from "@tiptap/core";
import { renderHook } from "@testing-library/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { getBus } from "@/lib/tiptap/doc-structure";
import { cardPopKey } from "@/panels/panel-registry";
import { useLivePosResolver, type LivePosKind } from "@/hooks/useLivePosResolver";

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

// A paragraph with a footnote atom + a citation atom, plus a trailing
// paragraph. Both atoms land in the DocStructure snapshot with positions.
function makeContent(): Content {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { uuid: "uuid-para-1" },
        content: [
          { type: "text", text: "Body text " },
          { type: "footnote", attrs: { footnoteId: "fn-1", number: 1 } },
          { type: "text", text: " and " },
          {
            type: "citation",
            attrs: { citationId: "c1", command: "\\cite{foo}", displayText: "Foo 2020" },
          },
        ],
      },
      {
        type: "paragraph",
        attrs: { uuid: "uuid-para-2" },
        content: [{ type: "text", text: "Second." }],
      },
    ],
  };
}

function mount(): { editor: Editor; cleanup: () => void } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: makeContent(),
  });
  return { editor, cleanup: () => { editor.destroy(); element.remove(); } };
}

const FN_KEY = cardPopKey("footnote", "fn-1");
const CITE_KEY = cardPopKey("citation", "c1");

let editor: Editor;
let cleanup: () => void;

/**
 * The editor-attached `DocStructureBus` snapshot is seeded EMPTY and is first
 * populated on the initial structural emit (the observer maps the plugin's
 * `buildInitial` structure forward and emits it — AGENTS "Initial population":
 * the counters/bus are silent on load, so live-pos consumers fall back to a
 * baked pos until the first structural change). Live-pos resolution matters
 * precisely AFTER editing starts, so warm the bus with one structural tx and
 * record the atom positions in the now-live snapshot. A no-op structural edit
 * (toggle a heading-level attr-free insert+delete) would be fiddly; instead we
 * append a trailing paragraph at the END so the warm-up doesn't shift the
 * atoms' positions we then assert against.
 */
function warmBus(): void {
  const end = editor.state.doc.content.size;
  editor
    .chain()
    .insertContentAt(end, { type: "paragraph", content: [{ type: "text", text: "Z" }] })
    .run();
}

beforeEach(() => {
  const m = mount();
  editor = m.editor;
  cleanup = m.cleanup;
  return () => cleanup();
});

describe("useLivePosResolver — resolution", () => {
  it("resolves footnote + citation ids to their snapshot positions (cardPopKey id space)", () => {
    warmBus();
    const { result } = renderHook(() => useLivePosResolver(editor, cardPopKey));
    const resolve = result.current;

    const structure = getBus(editor)!.structure;
    const fnPos = structure.footnotes.find((f) => f.id === "fn-1")!.pos;
    const citePos = structure.citations.find((c) => c.id === "c1")!.pos;

    expect(resolve(FN_KEY)).toBe(fnPos);
    expect(resolve(CITE_KEY)).toBe(citePos);
    // An id the snapshot doesn't carry → undefined (caller falls back to a
    // baked pos via `resolvePos(id) ?? item.pos`).
    expect(resolve(cardPopKey("footnote", "no-such"))).toBeUndefined();
  });
});

describe("useLivePosResolver — snapshot-identity cache (keystroke sanctity)", () => {
  it("rebuilds the map ONCE per snapshot, regardless of resolver-call count", () => {
    // Spy `keyOf`: it's called once per indexed entry per REBUILD. The doc has
    // 1 footnote + 1 citation + 0 examples → 2 keyOf calls per rebuild.
    warmBus();
    const keyOf = vi.fn((kind: LivePosKind, id: string) => cardPopKey(kind, id));
    const { result } = renderHook(() => useLivePosResolver(editor, keyOf));
    const resolve = result.current;

    resolve(FN_KEY); // first call → ONE rebuild
    const afterFirst = keyOf.mock.calls.length;
    expect(afterFirst).toBe(2);

    // Many more calls within the SAME snapshot → no further rebuild.
    for (let i = 0; i < 20; i++) {
      resolve(FN_KEY);
      resolve(CITE_KEY);
    }
    expect(keyOf.mock.calls.length).toBe(afterFirst);
  });

  it("plain typing leaves emitCount flat (no structural work) and the resolver still tracks the live pos", () => {
    warmBus();
    const bus = getBus(editor)!;
    const { result } = renderHook(() => useLivePosResolver(editor, cardPopKey));
    const resolve = result.current;

    const beforePos = resolve(FN_KEY)!;
    expect(beforePos).toBeGreaterThan(0);

    const emitBefore = bus.emitCount;

    // Type several plain characters at the very START of the doc — this shifts
    // BOTH atoms' positions but is structurally null (no add/remove/reorder),
    // so the bus emits NOTHING.
    for (let i = 0; i < 8; i++) {
      editor.view.dispatch(editor.state.tr.insertText("y", 1));
    }
    // Plain typing fired ZERO structural emits (the bus invariant the cache
    // gating piggybacks on — a structurally-null tx leaves `emitCount` flat).
    expect(bus.emitCount).toBe(emitBefore);

    // The resolver reads the per-tx-mapped live snapshot, so the footnote pos
    // has advanced by exactly the 8 inserted chars.
    const afterPos = resolve(FN_KEY)!;
    expect(afterPos).toBe(beforePos + 8);
    // And it still matches the live snapshot truth (positions are re-mapped
    // every transaction even though no structural event fired).
    const liveFnPos = bus.structure.footnotes.find((f) => f.id === "fn-1")!.pos;
    expect(afterPos).toBe(liveFnPos);
  });
});

describe("useLivePosResolver — live position after a structural insert above", () => {
  it("returns the atom's NEW position after a paragraph is inserted before it", () => {
    warmBus();
    const { result } = renderHook(() => useLivePosResolver(editor, cardPopKey));
    const resolve = result.current;

    const before = resolve(CITE_KEY)!;

    // Insert a brand-new paragraph at the very top — a structural edit that
    // shifts every later position down.
    editor
      .chain()
      .insertContentAt(0, { type: "paragraph", content: [{ type: "text", text: "Prepended." }] })
      .run();

    const after = resolve(CITE_KEY)!;
    expect(after).toBeGreaterThan(before);
    // Matches the live snapshot truth (the resolver rebuilt off the new snapshot).
    const liveCitePos = getBus(editor)!.structure.citations.find((c) => c.id === "c1")!.pos;
    expect(after).toBe(liveCitePos);
  });
});
