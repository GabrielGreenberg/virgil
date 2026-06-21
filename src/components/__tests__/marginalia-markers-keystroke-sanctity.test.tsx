// @vitest-environment jsdom
//
// CHIP-B — keystroke sanctity for the resolver-driven marginalia marker memo.
//
// The marker builder in `EditorPane.marginaliaMarkers` now runs
// `buildResolveIndex(editor)` + `resolveCardAnchor(card, …)` per recompute.
// That O(doc) work MUST stay off the typing path: the memo is gated on
// `useStructuralRevisions` counters (`rev.anchors` / `rev.blocks`) plus the
// reactive `editor` + the card arrays — never on a raw `editor.on('update')`
// counter. A structurally-null keystroke (typing inside a paragraph) fires no
// DocStructureBus event → those counters stay flat → the memo's deps are
// referentially unchanged → React's `useMemo` returns the SAME object → no
// recompute, no `buildResolveIndex` call, no marker churn.
//
// This test mirrors the real memo's dependency array and body in a
// `renderHook` harness (the same `useStructuralRevisions` + `useMemo` shape
// EditorPane uses), and asserts:
//   1. typing N plain chars leaves the bus `emitCount` FLAT (no structural
//      work), and
//   2. the memo returns an IDENTICAL reference before/after typing (no
//      recompute), while a structural edit (a new block) DOES bump it.
//
// The storage stub guards the extension-barrel/@/lib/storage gotcha.
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

import { Editor } from "@tiptap/core";
import { useMemo } from "react";
import { renderHook, act } from "@testing-library/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { getBus } from "@/lib/tiptap/doc-structure";
import { useStructuralRevisions } from "@/hooks/useStructuralRevisions";
import {
  buildResolveIndex,
  resolveCardAnchor,
} from "@/links/resolve-card-anchor";
import type { CardWithLinks } from "@/links/links";
import type { Link } from "@/links/_shared/types";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  };
}

function mountDoc(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "P1" },
          content: [{ type: "text", text: "The first paragraph." }],
        },
        {
          type: "paragraph",
          attrs: { uuid: "P2" },
          content: [{ type: "text", text: "The second paragraph." }],
        },
      ],
    },
  });
}

function mountThreeDoc(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "P1" },
          content: [{ type: "text", text: "The first paragraph." }],
        },
        {
          type: "paragraph",
          attrs: { uuid: "P2" },
          content: [{ type: "text", text: "The second paragraph." }],
        },
        {
          type: "paragraph",
          attrs: { uuid: "P3" },
          content: [{ type: "text", text: "The third paragraph." }],
        },
      ],
    },
  });
}

function modeACard(id: string, uuid: string): CardWithLinks & { id: string } {
  const link: Link = {
    id: `link-${uuid}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "paragraph",
      textObjectIds: [uuid],
      margin: { side: "right" },
    },
    target: { type: "card", ref: { kind: "note", id } },
    createdAt: "",
  };
  return { id, links: [link] };
}

/**
 * A healthy MULTI-anchor Mode-A card: N separate clean Mode-A paragraph links
 * (the shape `clearTextAnchorLink` leaves when a multi-paragraph selection-note
 * loses its Mode-B mark and each surviving textObjectId becomes its own
 * paragraph anchor). The resolver binds to the FIRST live uuid only, so the
 * render glue must iterate the stored pids to keep a marker per paragraph.
 */
function multiModeACard(
  id: string,
  uuids: string[],
): CardWithLinks & { id: string } {
  const links: Link[] = uuids.map((uuid) => ({
    id: `link-${uuid}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "paragraph",
      textObjectIds: [uuid],
      margin: { side: "right" },
    },
    target: { type: "card", ref: { kind: "note", id } },
    createdAt: "",
  }));
  return { id, links };
}

describe("marginalia marker memo — keystroke sanctity (CHIP-B)", () => {
  it("plain typing leaves emitCount flat AND the resolver-driven memo identity stable; a structural edit recomputes it", () => {
    const editor = mountDoc();
    const bus = getBus(editor);
    expect(bus).toBeTruthy();

    // A stable card array (the real memo deps are the card arrays + counters).
    const cards = [modeACard("c1", "P1"), modeACard("c2", "P2")];

    // Mirror the real memo: build the resolve index + resolve each card,
    // gated on the SAME deps EditorPane uses (`editor`, `rev.anchors`,
    // `rev.blocks`, the card array).
    // The harness intentionally mirrors the EXACT dep shape of the EditorPane
    // memo (reactive editor + structural counters + card array) so the
    // identity-stability assertion is faithful — the lint rule flags those as
    // "unnecessary" only because `editor`/`cards` are module-scoped in this
    // test, which is the whole point of the harness.
    /* eslint-disable react-hooks/exhaustive-deps */
    const { result } = renderHook(() => {
      const rev = useStructuralRevisions(editor);
      const markers = useMemo(() => {
        const index = buildResolveIndex(editor);
        return cards.map((c) => ({
          id: c.id,
          textObjectId: resolveCardAnchor(c, editor, index).paragraphId,
        }));
      }, [editor, rev.anchors, rev.blocks, cards]);
      return markers;
    });
    /* eslint-enable react-hooks/exhaustive-deps */

    const before = result.current;
    // Sanity: the resolver bound both cards to their live paragraphs.
    expect(before.map((m) => m.textObjectId)).toEqual(["P1", "P2"]);

    // ── (1) Type N plain characters inside a paragraph (structurally null).
    // Prime once (first insert can fault in a one-time structural artifact),
    // then measure steady-state typing.
    const typePos = 2; // inside "The first paragraph."
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText("x", typePos));
    });
    const emitBefore = bus!.emitCount;

    act(() => {
      for (let i = 0; i < 8; i++) {
        editor.view.dispatch(editor.state.tr.insertText("y", typePos + 1 + i));
      }
    });

    // emitCount flat → no structural work on the typing path.
    expect(bus!.emitCount).toBe(emitBefore);
    // Memo identity unchanged → NO recompute, NO buildResolveIndex call.
    expect(result.current).toBe(before);

    // ── (2) A real structural edit (insert a new uuid'd block) DOES bump the
    // counter → the memo recomputes (identity changes). Proves the gate is
    // wired, not merely never firing.
    act(() => {
      const tr = editor.state.tr;
      const para = editor.schema.nodes.paragraph.create(
        { uuid: "P3" },
        editor.schema.text("A third paragraph."),
      );
      tr.insert(editor.state.doc.content.size, para);
      editor.view.dispatch(tr);
    });

    expect(bus!.emitCount).toBeGreaterThan(emitBefore);
    expect(result.current).not.toBe(before);

    editor.destroy();
  });

  it("resolver-driven marker mapping: live-uuid card → unanchored:false on its live pid; an all-dead card → unanchored:true on its first stored pid (surfaced, not vanished)", () => {
    const editor = mountDoc(); // live paragraphs P1, P2

    // Replicates `EditorPane.marginaliaMarkers`'s `resolveMarkerPids` glue
    // (EditorPane.tsx ~:1824-1862): resolve each card through the SSOT, flag
    // orphans, and on a resolved card emit ONE marker per LIVE stored pid
    // (seeded with `res.paragraphId`, then every live raw pid, deduped
    // order-stable) so a multi-anchor Mode-A card keeps a marker per paragraph.
    // This mirror MUST be kept in sync with the production helper; the keystroke-
    // sanctity dep-array mirror above tracks EditorPane's marginaliaMarkers memo
    // dep array (~:2021-2046) in the same way.
    const resolveMarkerPids = (
      c: CardWithLinks,
      pids: string[],
    ): Array<{ pid: string; unanchored: boolean }> => {
      const index = buildResolveIndex(editor);
      const ready = index.uuidToParagraph.size > 0;
      if (!ready) return pids.map((pid) => ({ pid, unanchored: false }));
      const res = resolveCardAnchor(c, editor, index);
      if (res.source === "orphan") {
        return pids.length > 0 ? [{ pid: pids[0], unanchored: true }] : [];
      }
      if (res.paragraphId) {
        const livePids = pids.filter((p) => index.uuidToParagraph.has(p));
        const seen = new Set<string>();
        const out: Array<{ pid: string; unanchored: boolean }> = [];
        for (const pid of [res.paragraphId, ...livePids]) {
          if (seen.has(pid)) continue;
          seen.add(pid);
          out.push({ pid, unanchored: false });
        }
        return out;
      }
      return pids.map((pid) => ({ pid, unanchored: false }));
    };

    // (a) Live-uuid card → bound to its live paragraph, NOT orphan.
    const live = modeACard("c1", "P1");
    expect(resolveMarkerPids(live, ["P1"])).toEqual([
      { pid: "P1", unanchored: false },
    ]);

    // (b) All-dead card: uuid not in the doc, no mark, no snapshot match →
    // resolver returns `orphan` → marker SURFACES (unanchored:true) on its
    // first stored (now-dead) pid rather than being culled (the RC2 vanish).
    const dead = modeACard("c2", "P-dead-uuid");
    expect(resolveMarkerPids(dead, ["P-dead-uuid"])).toEqual([
      { pid: "P-dead-uuid", unanchored: true },
    ]);

    editor.destroy();
  });

  it("multi-anchor Mode-A card with TWO live anchors [P1,P3] yields TWO markers (note:P1 + note:P3), not one (the BLOCKER regression)", () => {
    const editor = mountThreeDoc(); // live paragraphs P1, P2, P3

    // Same `resolveMarkerPids` mirror as the production helper (resolved branch
    // emits one entry per live stored pid, seeded with res.paragraphId).
    const resolveMarkerPids = (
      c: CardWithLinks,
      pids: string[],
    ): Array<{ pid: string; unanchored: boolean }> => {
      const index = buildResolveIndex(editor);
      const ready = index.uuidToParagraph.size > 0;
      if (!ready) return pids.map((pid) => ({ pid, unanchored: false }));
      const res = resolveCardAnchor(c, editor, index);
      if (res.source === "orphan") {
        return pids.length > 0 ? [{ pid: pids[0], unanchored: true }] : [];
      }
      if (res.paragraphId) {
        const livePids = pids.filter((p) => index.uuidToParagraph.has(p));
        const seen = new Set<string>();
        const out: Array<{ pid: string; unanchored: boolean }> = [];
        for (const pid of [res.paragraphId, ...livePids]) {
          if (seen.has(pid)) continue;
          seen.add(pid);
          out.push({ pid, unanchored: false });
        }
        return out;
      }
      return pids.map((pid) => ({ pid, unanchored: false }));
    };

    // The resolver binds this card to its FIRST live uuid (P1) only — the
    // resolved branch must still emit a marker for P3 from the stored pids,
    // else P3's marker silently vanishes (re-introduces RC2) and the per-pid
    // detach affordance breaks.
    const card = multiModeACard("note1", ["P1", "P3"]);
    const entries = resolveMarkerPids(card, ["P1", "P3"]);

    // TWO markers, both anchored (not orphan), order-stable P1→P3.
    expect(entries).toEqual([
      { pid: "P1", unanchored: false },
      { pid: "P3", unanchored: false },
    ]);

    // Marker-id derivation is `<kind>:<pid>` (EditorPane keys markers that
    // way), so the two markers get DISTINCT ids — the property that lets the
    // margin render + key both.
    const ids = entries.map((e) => `note:${e.pid}`);
    expect(ids).toEqual(["note:P1", "note:P3"]);
    expect(new Set(ids).size).toBe(2);

    editor.destroy();
  });
});
