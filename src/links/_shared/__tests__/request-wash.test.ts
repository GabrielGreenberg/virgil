// @vitest-environment jsdom
//
// The OPEN-AI-request wash (src/links/_shared/request-wash.ts) — task
// 2026-07-03-021's blue band, re-carried as a DECORATION by task 667.
//
// Builds the REAL main editor stack (the apply-suggestion.test.ts pattern) so
// the schema, uuid backfill, the LaTeX serializer and the decoration plugin all
// behave faithfully. The contracts pinned here are the law's
// (`transient-state-is-never-document-content.md`) made concrete for this
// signal:
//   (a) flipping `aiRequest` ON paints a band over the card's WHOLE anchored
//       region; OFF (or deleting the card) clears it,
//   (b) it is NOT document content — the toggle changes no doc, moves no
//       caret, and leaves the serialized `.tex` byte-identical (no `\vlid`),
//   (c) a MODE-B request card is washed too (the mark carrier had to skip it),
//   (d) the band survives the orphan reaper, which no longer exempts anything
//       by a `pending-ai-*` name,
//   (e) reload needs no re-stamp: the wash is re-derived from the records.
//
// Every leg here fails against the pre-667 tree: the module it imports did not
// exist, and the behaviours it asserts (no caret move, no `\vlid`, a Mode-B
// wash, no reaper exemption) were each the opposite.

import { describe, it, expect, vi } from "vitest";

// Figure / graphics / tex-block React NodeViews transitively import
// `@/lib/storage`; stub it (the structural-edit + apply-suggestion pattern).
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor, type Content } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import { parseLatex } from "@/lib/latex-parser";
import { createLinkedAnchor, type Link } from "@/links/links";
import { reapOrphanLinkedAnchors } from "@/links/_shared/useLinkedAnchorReconciler";
import {
  paintRequestWash,
  requestWashTargets,
  requestWashKey,
  isRequestCard,
  REQUEST_WASH_CHANNEL,
  REQUEST_WASH_COLOR,
  type RequestWashCardLike,
} from "@/links/_shared/request-wash";
import { transientHighlightKeyFor } from "@/lib/tiptap/transient-highlight";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

const PARA_UUID = "a1b2";
const OTHER_UUID = "c3d4";
const CARD_ID = "note-abc";
const PARA_TEXT = "The quick brown fox jumps.";
const OTHER_TEXT = "A second, unrelated paragraph.";

function makeContent(): Content {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { uuid: PARA_UUID },
        content: [{ type: "text", text: PARA_TEXT }],
      },
      {
        type: "paragraph",
        attrs: { uuid: OTHER_UUID },
        content: [{ type: "text", text: OTHER_TEXT }],
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

/** A Mode-A anchor link (paragraph target, NO textRange). */
function modeALink(uuid: string): Link {
  return {
    id: `link-${uuid}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "paragraph",
      textObjectIds: [uuid],
    },
    target: { type: "card", ref: { kind: "note", id: CARD_ID } },
    createdAt: "",
  };
}

/** A Mode-B anchor link (linkedRange target, has textRange). */
function modeBLink(uuid: string, anchorId = "range-1", snapshot = "quick brown"): Link {
  return {
    id: `link-b-${uuid}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: [uuid],
      textRange: { anchorId, textSnapshot: snapshot },
    },
    target: { type: "card", ref: { kind: "note", id: CARD_ID } },
    createdAt: "",
  };
}

function note(over: Partial<RequestWashCardLike>): RequestWashCardLike {
  return { id: CARD_ID, kind: "note", aiRequest: true, links: [modeALink(PARA_UUID)], ...over };
}

/** The live wash bands, as `{from,to}` pairs. */
function bands(editor: Editor): Array<{ from: number; to: number }> {
  const set = transientHighlightKeyFor(REQUEST_WASH_CHANNEL).getState(editor.state);
  if (!set) return [];
  return set.find().map((d) => ({ from: d.from, to: d.to }));
}

/** The document text the wash currently covers. */
function washedText(editor: Editor): string {
  return bands(editor)
    .map((b) => editor.state.doc.textBetween(b.from, b.to, "\n"))
    .join("");
}

/** Every `linkedAnchor` anchorId live in the doc. */
function anchorIds(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.descendants((node) => {
    if (!node.isText) return true;
    for (const m of node.marks) {
      if (m.type.name !== "linkedAnchor") continue;
      const id = m.attrs.anchorId as string | undefined;
      if (id && !out.includes(id)) out.push(id);
    }
    return true;
  });
  return out;
}

describe("(a) the wash paints, clears, and tracks its card", () => {
  it("paints a band over the WHOLE anchored paragraph when aiRequest is on", () => {
    const { editor, cleanup } = mount();
    try {
      paintRequestWash(editor, [note({})]);
      expect(washedText(editor)).toBe(PARA_TEXT);
      const [band] = requestWashTargets(editor, [note({})]);
      expect(band.color).toBe(REQUEST_WASH_COLOR);
      // A REGION band: text typed into the washed paragraph belongs to it.
      expect(band.inclusive).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("clears when the flag goes off, and when the card is gone", () => {
    const { editor, cleanup } = mount();
    try {
      paintRequestWash(editor, [note({})]);
      expect(bands(editor)).toHaveLength(1);
      paintRequestWash(editor, [note({ aiRequest: false })]);
      expect(bands(editor)).toHaveLength(0);
      paintRequestWash(editor, [note({})]);
      expect(bands(editor)).toHaveLength(1);
      paintRequestWash(editor, []); // card deleted
      expect(bands(editor)).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it("follows a re-anchored card to its new paragraph", () => {
    const { editor, cleanup } = mount();
    try {
      paintRequestWash(editor, [note({})]);
      expect(washedText(editor)).toBe(PARA_TEXT);
      paintRequestWash(editor, [note({ links: [modeALink(OTHER_UUID)] })]);
      expect(washedText(editor)).toBe(OTHER_TEXT);
    } finally {
      cleanup();
    }
  });

  it("paints one band, not two, when two cards wash the same region", () => {
    const { editor, cleanup } = mount();
    try {
      paintRequestWash(editor, [
        note({}),
        note({ id: "note-2", links: [modeALink(PARA_UUID)] }),
      ]);
      expect(bands(editor)).toHaveLength(1);
    } finally {
      cleanup();
    }
  });
});

describe("(b) the wash is NOT document content (the law)", () => {
  it("toggling the flag changes no document and moves no caret", () => {
    const { editor, cleanup } = mount();
    try {
      // Caret parked in paragraph B, far from the card's anchor (paragraph A).
      const caret = editor.state.doc.content.size - 3;
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, caret),
        ),
      );
      const docBefore = JSON.stringify(editor.state.doc.toJSON());

      let sawDocChange = false;
      const seen: boolean[] = [];
      editor.on("transaction", ({ transaction }) => {
        seen.push(true);
        if (transaction.docChanged) sawDocChange = true;
      });

      paintRequestWash(editor, [note({})]);

      // The wash arrived...
      expect(washedText(editor)).toBe(PARA_TEXT);
      // ...on exactly one META-ONLY transaction.
      expect(seen).toHaveLength(1);
      expect(sawDocChange).toBe(false);
      // The document is untouched and the caret never left paragraph B. (The
      // mark carrier failed BOTH: `reanchorByText` selected the anchored
      // paragraph to stamp, then parked the caret at its start.)
      expect(JSON.stringify(editor.state.doc.toJSON())).toBe(docBefore);
      expect(editor.state.selection.from).toBe(caret);
    } finally {
      cleanup();
    }
  });

  it("leaves NO `\\vlid` residue in the user's .tex", () => {
    const { editor, cleanup } = mount();
    try {
      const texBefore = serializeBodyOnly(editor.state.doc.toJSON());
      paintRequestWash(editor, [note({})]);
      const texAfter = serializeBodyOnly(editor.state.doc.toJSON());
      // INVERTED from the pre-667 leg, which pinned the residue as expected:
      // the mark round-tripped its anchorId into the user's only copy as a bare
      // `\vlid`, for a signal the document does not own.
      expect(texAfter).toBe(texBefore);
      expect(texAfter).not.toContain("\\vlid");
      expect(anchorIds(editor)).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it("needs no re-stamp after a serialize → reparse round-trip (reload)", () => {
    const { editor, cleanup } = mount();
    try {
      paintRequestWash(editor, [note({})]);
      const tex = serializeBodyOnly(editor.state.doc.toJSON());
      editor.commands.setContent(parseLatex(tex) as Content);
      // A decoration does not survive a setContent, and nothing expects it to:
      // the wash is re-DERIVED from the same `aiRequest === true` record, which
      // is all the old "persistence via a real mark" ever actually did.
      paintRequestWash(editor, [note({})]);
      expect(washedText(editor)).toBe(PARA_TEXT);
    } finally {
      cleanup();
    }
  });
});

describe("(c) a Mode-B request card is washed too", () => {
  it("washes the card's own range, and leaves its linkedAnchor untouched", () => {
    const { editor, cleanup } = mount();
    try {
      // Give the card a real Mode-B anchor over "quick brown".
      const from = PARA_TEXT.indexOf("quick brown") + 1;
      const to = from + "quick brown".length;
      const rec = createLinkedAnchor(editor, "note", { from, to }, CARD_ID);
      expect(rec).not.toBeNull();
      const idsBefore = anchorIds(editor);
      expect(idsBefore).toContain(rec!.anchorId);

      const card = note({ links: [modeBLink(PARA_UUID, rec!.anchorId)] });
      // The mark carrier answered `false` here and painted nothing — a second
      // `linkedAnchor` would have clobbered the card's own.
      expect(isRequestCard(card)).toBe(true);
      paintRequestWash(editor, [card]);

      expect(washedText(editor)).toBe("quick brown");
      // The card's own anchor survived: a decoration cannot collide with a mark.
      expect(anchorIds(editor)).toEqual(idsBefore);
    } finally {
      cleanup();
    }
  });

  it("prefers the Mode-B range over the block the range lives in", () => {
    const { editor, cleanup } = mount();
    try {
      const from = PARA_TEXT.indexOf("quick brown") + 1;
      const rec = createLinkedAnchor(
        editor,
        "note",
        { from, to: from + "quick brown".length },
        CARD_ID,
      );
      // Both links present: the range wins — that is what the card is anchored to.
      paintRequestWash(editor, [
        note({ links: [modeALink(PARA_UUID), modeBLink(PARA_UUID, rec!.anchorId)] }),
      ]);
      expect(washedText(editor)).toBe("quick brown");
    } finally {
      cleanup();
    }
  });
});

describe("(d) the orphan reaper needs no exemption", () => {
  it("leaves the wash alone with an EMPTY alive-set — there is nothing to reap", () => {
    const { editor, cleanup } = mount();
    try {
      paintRequestWash(editor, [note({})]);
      expect(washedText(editor)).toBe(PARA_TEXT);
      // The pre-667 reaper had to skip `pending-ai-request` BY NAME: the wash
      // mark had no card text-anchor, so it was an orphan by every honest test
      // this sweep applies. Sweep with nothing alive at all.
      reapOrphanLinkedAnchors(editor, new Set<string>());
      expect(washedText(editor)).toBe(PARA_TEXT);
      expect(anchorIds(editor)).toHaveLength(0);
    } finally {
      cleanup();
    }
  });
});

describe("classification + the re-run gate", () => {
  it("isRequestCard is true for BOTH anchor modes, false without a flag or an anchor", () => {
    expect(isRequestCard(note({}))).toBe(true);
    expect(isRequestCard(note({ links: [modeBLink(PARA_UUID)] }))).toBe(true);
    expect(isRequestCard(note({ aiRequest: false }))).toBe(false);
    expect(isRequestCard(note({ links: [] }))).toBe(false);
  });

  it("requestWashKey changes on flag / anchor / membership, and only then", () => {
    const base = requestWashKey([note({})]);
    expect(requestWashKey([note({})])).toBe(base); // same set → same key
    expect(requestWashKey([note({ kind: "todo" })])).toBe(base); // unrelated edit
    expect(requestWashKey([note({ aiRequest: false })])).not.toBe(base);
    expect(requestWashKey([note({ links: [modeALink(OTHER_UUID)] })])).not.toBe(base);
    expect(requestWashKey([])).not.toBe(base);
  });
});
