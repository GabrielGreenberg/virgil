// @vitest-environment jsdom
//
// TASK 369 — the two renderers of a card's anchor answer from ONE authority.
//
// A paragraph-anchored card is drawn twice: as a MARGIN MARKER
// (`EditorPane.marginaliaMarkers`) and as an OMNI CARD (`panels/*/omni.tsx`).
// Before this task the margin routed every card through the four-rung
// anchor-recovery SSOT while every omni builder ran a bare live-uuid lookup, so
// the two agreed ONLY on rung 1. For a card whose stored uuid has died but
// whose `paragraphSnapshot` still matches a live paragraph — the ordinary
// outcome of a `%!v:` anchor failing to round-trip, and ARMED FOR EVERY ARCHIVE
// CLIP, since archive links are created with a snapshot — the margin painted an
// ordinary marker beside the recovered paragraph while the omni row was binned
// `pos: null` into the orphan strip. Marker in the margin, card nowhere near it.
//
// Every leg here drives the REAL editor, the REAL authority
// (`buildCardAnchorPass`) and BOTH REAL readers — the margin's
// (`buildMarginMarkerRows` / `marginAnchorIndex`, which `EditorPane` calls) and
// the omni's (`buildOmniAnchorRows`, which the six paragraph-anchored builders
// call) — plus one real builder end-to-end. No pre-369 suite could see this:
// each of them drives ONE surface, with the other's answer unrepresentable.
//
// The defect legs REIMPLEMENT the retired bare-uuid rule locally rather than
// re-parameterising the live one, so they fail for the reason they name.
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
  const mod: Record<string, unknown> = { isDevStorage: () => false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  buildCardAnchorPass,
  buildMarginMarkerRows,
  marginAnchorIndex,
} from "@/links/card-anchor-rows";
import { buildOmniAnchorRows } from "@/panels/_shared/omni-anchor-rows";
import { getLinkedTextObjectIds, type CardWithLinks } from "@/links/links";
import type { Link } from "@/links/_shared/types";
import type { ArchivedSnippet } from "@/lib/types";
import { buildArchiveOmniItems } from "@/panels/Archive/omni";

const P1_TEXT = "The first paragraph.";
const P2_TEXT = "The second paragraph.";

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

/** A two-paragraph doc whose live uuids are `P1` / `P2`. */
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
          content: [{ type: "text", text: P1_TEXT }],
        },
        {
          type: "paragraph",
          attrs: { uuid: "P2" },
          content: [{ type: "text", text: P2_TEXT }],
        },
      ],
    },
  });
}

/** The same doc, with a live `linkedAnchor` mark carrying `anchorId` on P2. */
function mountDocWithMark(anchorId: string): Editor {
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
          content: [{ type: "text", text: P1_TEXT }],
        },
        {
          type: "paragraph",
          attrs: { uuid: "P2" },
          content: [
            {
              type: "text",
              text: P2_TEXT,
              marks: [{ type: "linkedAnchor", attrs: { anchorId } }],
            },
          ],
        },
      ],
    },
  });
}

/** A Mode-A paragraph link with an optional text snapshot. */
function paraLink(uuid: string, snapshot?: string): Link {
  return {
    id: `link-${uuid}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "paragraph",
      textObjectIds: [uuid],
      ...(snapshot ? { paragraphSnapshot: snapshot } : {}),
    },
    target: { type: "card", ref: { kind: "archive", id: "c1" } },
    createdAt: "2026-01-01T00:00:00.000Z",
  } as Link;
}

/** A Mode-B `linkedRange` link: a live mark anchorId + stored paragraph ids. */
function rangeLink(anchorId: string, ...pids: string[]): Link {
  return {
    id: `link-${anchorId}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: pids,
      textRange: { anchorId, textSnapshot: "" },
    },
    target: { type: "card", ref: { kind: "archive", id: "c1" } },
    createdAt: "2026-01-01T00:00:00.000Z",
  } as Link;
}

function snippet(id: string, links: Link[]): ArchivedSnippet {
  return {
    id,
    title: "",
    content: { type: "doc", content: [] },
    createdAt: "2026-01-01T00:00:00.000Z",
    links,
  };
}

/** The RETIRED rule, restated locally: "anchored" iff a stored pid is live. */
function preFixAnchored(card: CardWithLinks, live: Set<string>): boolean {
  return getLinkedTextObjectIds(card).some((u) => live.has(u));
}

const noop = () => {};
const noopId = (_id: string | null) => {};

function archiveArgs(
  snippets: ArchivedSnippet[],
  resolveCardRows: ReturnType<typeof buildCardAnchorPass>["resolve"],
) {
  return {
    archiveSnippets: snippets,
    selectedArchiveId: null,
    setSelectedArchiveId: noopId,
    jumpToCard: noop,
    resolveCardRows,
    updateArchiveSnippet: noop,
    updateArchiveSnippetTitle: noop,
    handleDeleteArchive: noop,
    setOverrideEditor: noop,
    getCitationDisplayText: () => "",
    onCitationCreated: () => null,
  };
}

describe("card anchor: both renderers read ONE authority (task 369)", () => {
  it("snapshot-recovered card — margin AND omni land on the SAME recovered paragraph", () => {
    const editor = mountDoc();
    // Stored uuid is DEAD; the snapshot still matches live P2.
    const card = snippet("s1", [paraLink("DEAD-UUID", P2_TEXT)]);
    const pass = buildCardAnchorPass(editor);

    // Defect leg: the retired bare-uuid gate calls this card orphaned, which
    // is exactly what the omni surface used to publish while the margin
    // painted an ordinary marker beside P2.
    expect(preFixAnchored(card, new Set(["P1", "P2"]))).toBe(false);

    const marginRows = buildMarginMarkerRows(card, pass.resolve);
    const omniRows = buildOmniAnchorRows(card, "base", pass.resolve, {
      unanchored: false,
    });

    expect(marginRows).toEqual([{ pid: "P2", unanchored: false }]);
    expect(omniRows).toHaveLength(1);
    expect(omniRows[0].anchorUuid).toBe("P2");
    expect(omniRows[0].anchorState).toBe("anchored");
    expect(omniRows[0].pos).toBe(pass.posOf("P2"));
    expect(omniRows[0].pos).not.toBeNull();
    // The whole contract in one line: the two renderers name one paragraph.
    expect(omniRows[0].anchorUuid).toBe(marginRows[0].pid);
    editor.destroy();
  });

  it("the REAL archive omni builder anchors the recovered clip (end to end)", () => {
    const editor = mountDoc();
    const s = snippet("s1", [paraLink("DEAD-UUID", P2_TEXT)]);
    const pass = buildCardAnchorPass(editor);
    const items = buildArchiveOmniItems(archiveArgs([s], pass.resolve));
    expect(items).toHaveLength(1);
    expect(items[0].anchorState).toBe("anchored");
    expect(items[0].anchorUuid).toBe("P2");
    expect(items[0].pos).not.toBeNull();
    editor.destroy();
  });

  it("a genuinely dead card is surfaced ONCE by both, keyed the same", () => {
    const editor = mountDoc();
    // No snapshot and a dead uuid → nothing to recover.
    const card = snippet("s2", [paraLink("GONE")]);
    const pass = buildCardAnchorPass(editor);

    const marginRows = buildMarginMarkerRows(card, pass.resolve);
    const omniRows = buildOmniAnchorRows(card, "base", pass.resolve, {
      unanchored: false,
    });

    expect(marginRows).toEqual([{ pid: "GONE", unanchored: true }]);
    expect(omniRows).toHaveLength(1);
    expect(omniRows[0].anchorState).toBe("orphaned");
    expect(omniRows[0].pos).toBeNull();
    // Same keying on both sides: one row ⇒ no `@N` suffix, and the margin's
    // click index agrees.
    expect(omniRows[0].omniId).toBe("base");
    expect(marginAnchorIndex(card, "GONE", pass.resolve)).toBeUndefined();
    editor.destroy();
  });

  it("multi-anchor: the `@N` keying is indexed over the RESOLVED rows on both sides", () => {
    // The only shape where the RESOLVED paragraph is not a stored pid AND live
    // stored pids remain: a Mode-B link whose `linkedAnchor` mark survives in
    // P2 (rung 2) while its own stored `textObjectIds` still name live P1.
    // Rung 1 skips `linkedRange` links, so the mark wins and the shared row
    // order is [P2, P1] — where pre-369 the margin indexed the STORED pids, in
    // which P2 does not appear at all.
    const editor = mountDocWithMark("A1");
    const card = snippet("s3", [rangeLink("A1", "P1")]);
    const pass = buildCardAnchorPass(editor);

    const marginRows = buildMarginMarkerRows(card, pass.resolve);
    const omniRows = buildOmniAnchorRows(card, "base", pass.resolve, {
      unanchored: false,
    });

    expect(marginRows.map((r) => r.pid)).toEqual(["P2", "P1"]);
    expect(omniRows.map((r) => r.omniId)).toEqual(["base@0", "base@1"]);
    for (let i = 0; i < marginRows.length; i++) {
      expect(omniRows[i].anchorUuid).toBe(marginRows[i].pid);
      expect(omniRows[i].anchorState).toBe("anchored");
      expect(marginAnchorIndex(card, marginRows[i].pid, pass.resolve)).toBe(i);
    }
    // The defect leg: the retired index-over-STORED-pids has no entry for the
    // recovered paragraph, so a marker click on it pinned no omni row at all.
    expect(getLinkedTextObjectIds(card).indexOf("P2")).toBe(-1);
    editor.destroy();
  });

  it("mount gap: an empty index resolves to raw pids, never a spurious orphan", () => {
    const pass = buildCardAnchorPass(null);
    const card = snippet("s4", [paraLink("P1")]);
    expect(buildMarginMarkerRows(card, pass.resolve)).toEqual([
      { pid: "P1", unanchored: false },
    ]);
    // The omni half keeps its pre-369 gap answer: no index ⇒ no position ⇒
    // `orphaned`, which never reaches the user because `OmniViewPanel` drops
    // every `pos == null` row while `editor` is null. What matters is that the
    // MARGIN still fails OPEN (no spurious re-pin dock) — the two surfaces are
    // allowed to differ only where neither can be read.
    const omniRows = buildOmniAnchorRows(card, "base", pass.resolve, {
      unanchored: false,
    });
    expect(omniRows[0].pos).toBeNull();
  });

  it("a card with no stored anchor takes the panel's own free intent", () => {
    const editor = mountDoc();
    const pass = buildCardAnchorPass(editor);
    const card = snippet("s5", []);
    expect(buildMarginMarkerRows(card, pass.resolve)).toEqual([]);
    expect(
      buildOmniAnchorRows(card, "base", pass.resolve, { unanchored: true })[0]
        .anchorState,
    ).toBe("free");
    expect(
      buildOmniAnchorRows(card, "base", pass.resolve, { unanchored: false })[0]
        .anchorState,
    ).toBe("orphaned");
    editor.destroy();
  });
});
