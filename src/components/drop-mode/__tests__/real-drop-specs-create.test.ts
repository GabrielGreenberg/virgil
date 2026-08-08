// @vitest-environment jsdom
/**
 * Chip F — FOLD 1: REAL-SPEC test for the "anchor the unanchored" inline-atom
 * CREATE branch.
 *
 * The sibling `inline-atom-create.test.ts` drives a HAND-ROLLED `createAtom`
 * stub against the shared factory — it proves the factory's plumbing (classify
 * ⇒ apply, no fresh id, decline ⇒ no-op) but NOT the real per-panel factories'
 * substantive logic. This file imports the REAL `footnoteDropSpec` and
 * `citationDropSpec` and exercises THEIR `createAtom` bodies end-to-end:
 *
 *  - footnote → a node with `footnoteId === <card id>` AND **the card's REAL
 *    BODY**, read from `ctx.atomCards.footnote` (task 233). This file used to
 *    assert the hard-coded EMPTY body as expected — pinning a data-loss bug as
 *    the contract: re-placing an archived footnote planted an empty atom, and
 *    since `getFootnotes()` re-derives the panel (and the serialized
 *    `\footnote{}`) from the node, the user's text was destroyed in both. The
 *    empty doc is now only the NO-ACCESSOR fallback, asserted separately;
 *  - footnote → the drop also calls `onAnchored(id)`, so the card sheds the
 *    `unanchored`/`archived` intent that would otherwise leave it listed a
 *    second time as a parked duplicate of the now-live footnote;
 *  - citation with a valid `commandFor(id)` → a node with
 *    `citationId === <card id>` and the RESOLVED `command`;
 *  - citation whose `commandFor(id)` returns '' OR `\cite{}` (keyless) →
 *    DECLINES (classify no-op, apply inert) — the real decline guard +
 *    `parseCiteCommand` keyless check;
 *  - NO fresh id is minted in ANY case (the inserted id === the card id passed).
 *
 * Reuses the live-EditorState + storage-mock harness pattern from the sibling
 * test. The schema carries minimal `footnote`/`citation` atoms whose attrs
 * mirror the real nodes (footnote: content+number+footnoteId; citation:
 * command+displayText+citationId) so the real factories' `schema.nodes.X.create`
 * resolves exactly as it does against the live editor schema.
 */

import { describe, expect, it } from "vitest";
import { vi } from "vitest";

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

import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { footnoteDropSpec } from "@/panels/Footnotes/drop-spec";
import { citationDropSpec } from "@/panels/Citations/drop-spec";
import type { DropCtx, Placement } from "../types";

// Minimal schema whose `footnote`/`citation` atoms mirror the REAL nodes'
// attrs — so the real factories' `schema.nodes.X.create({...})` resolves the
// node type and attrs exactly as it would against the live editor schema.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
    footnote: {
      group: "inline",
      inline: true,
      atom: true,
      selectable: false,
      // Mirror footnote.ts: content (the body doc, default null), number,
      // footnoteId.
      attrs: { content: { default: null }, number: { default: 1 }, footnoteId: { default: "" } },
      parseDOM: [{ tag: "span[data-type=footnote]" }],
      toDOM: () => ["span", { "data-type": "footnote" }, "1"],
    },
    citation: {
      group: "inline",
      inline: true,
      atom: true,
      selectable: false,
      // Mirror citation.ts: command, displayText, citationId.
      attrs: { command: { default: "" }, displayText: { default: "" }, citationId: { default: "" } },
      parseDOM: [{ tag: "span[data-type=citation]" }],
      toDOM: () => ["span", { "data-type": "citation" }, "[1]"],
    },
  },
});

function docWithoutAtom(): PMNode {
  return schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("alpha bravo")]),
    schema.node("paragraph", null, [schema.text("charlie delta")]),
  ]);
}

/** Find the first atom of `name` in a doc, or null when none exists. */
function findAtom(
  doc: PMNode,
  name: "footnote" | "citation",
): { node: PMNode; from: number; to: number } | null {
  let found: { node: PMNode; from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === name) {
      found = { node, from: pos, to: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  return found;
}

/** Mock editor whose `view.dispatch` truly applies to a live EditorState. */
function liveEditor(doc: PMNode) {
  let state = EditorState.create({ schema, doc });
  const dispatched: Transaction[] = [];
  const editor = {
    schema,
    get state() {
      return state;
    },
    view: {
      get state() {
        return state;
      },
      nodeDOM: () => null,
      dispatch: (tr: Transaction) => {
        dispatched.push(tr);
        state = state.apply(tr);
      },
      focus: () => {},
    },
  } as unknown as Editor;
  return { editor, dispatched, getState: () => state };
}

function inlineCursor(editor: Editor, pos: number): Placement {
  return {
    kind: "inline-cursor",
    editor,
    pos,
    rect: { x: 0, y: 0, width: 0, height: 0 },
  } as unknown as Placement;
}

describe("Chip F FOLD 1 — REAL footnote/citation drop specs (anchor the unanchored)", () => {
  // ── Footnote ──────────────────────────────────────────────────────────
  describe("footnoteDropSpec (real factory)", () => {
    const FN_ID = "fn-real-7k";
    const FN_KEY = `float:card:footnote:${FN_ID}`;
    /** The card's real body — the thing the pre-233 factory threw away. */
    const BODY = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Smith (2020) argues X" }] },
      ],
    };
    const EMPTY_BODY = { type: "doc", content: [{ type: "paragraph" }] };

    /** A ctx wired the way `EditorPane` wires it: the footnotes hook supplies
     *  the card's live body + the anchor reconcile. `anchored` records the
     *  `onAnchored(id)` calls so the reconcile half is asserted too. */
    function ctxWithBody(
      editor: Editor,
      content: unknown,
      anchored: string[] = [],
    ): DropCtx {
      return {
        mainEditor: editor,
        atomCards: {
          footnote: {
            atomAttrsFor: (id: string) => (id === FN_ID ? { content } : { content: EMPTY_BODY }),
            onAnchored: (id: string) => anchored.push(id),
          },
        },
      } as unknown as DropCtx;
    }

    it("classifyDrop returns `apply` (no atom + real createAtom)", () => {
      const h = liveEditor(docWithoutAtom());
      const d = footnoteDropSpec.classifyDrop(
        inlineCursor(h.editor, 3),
        FN_KEY,
        ctxWithBody(h.editor, BODY),
      );
      expect(d.kind).toBe("apply");
      expect(d.kind).not.toBe("confirm");
    });

    it("applyDrop preserves the CARD'S BODY in the new atom (task 233 — the data-loss fix)", () => {
      const h = liveEditor(docWithoutAtom());
      const anchored: string[] = [];
      expect(findAtom(h.getState().doc, "footnote")).toBeNull();

      footnoteDropSpec.applyDrop(
        inlineCursor(h.editor, 3),
        FN_KEY,
        ctxWithBody(h.editor, BODY, anchored),
      );

      const atom = findAtom(h.getState().doc, "footnote");
      expect(atom).not.toBeNull();
      // (a) footnoteId === the card id — NO fresh id minted.
      expect(atom!.node.attrs.footnoteId).toBe(FN_ID);
      // (b) THE FIX: the body survives the re-place. Fails on main, which
      // hard-coded the empty doc here — and since `getFootnotes()` re-derives
      // both the panel and the serialized `\footnote{}` from this attr, the
      // text was gone from the document, not merely from the card.
      expect(atom!.node.attrs.content).toEqual(BODY);
      expect(atom!.node.attrs.content).not.toEqual(EMPTY_BODY);
      // number 0 — the renumber pass assigns the live number.
      expect(atom!.node.attrs.number).toBe(0);
      // Landed at the drop position.
      expect(atom!.from).toBe(3);
      // (c) the reconcile half: the card is anchored now, so its hook is told
      // exactly once, with its own id.
      expect(anchored).toEqual([FN_ID]);
      // FOLD 2 undo-park: a selection-only parking tr at the insert pos
      // precedes the insert (addToHistory:false, TextSelection, not docChanged).
      expect(h.dispatched).toHaveLength(2);
      expect(h.dispatched[0].docChanged).toBe(false);
      expect(h.dispatched[0].getMeta("addToHistory")).toBe(false);
      expect(h.dispatched[0].selection.constructor.name).toBe("TextSelection");
      expect(h.dispatched[1].docChanged).toBe(true);
    });

    it("no accessor wired → DECLINES rather than plant an empty body (a lossy rebuild refuses)", () => {
      const h = liveEditor(docWithoutAtom());
      const ctx = { mainEditor: h.editor } as unknown as DropCtx;
      // A declared-but-unwired accessor is loud in dev — a silent no-op drop
      // reads as "the gesture is broken" with no way to tell why.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Falling back to the empty create shape here would BE task 233: the body
      // is unread in footnotes.json, the empty atom serializes an empty
      // `\footnote{}` into the .tex, and the ref then drops off the atomless
      // list because its atom is live — the text reachable from nowhere.
      // Refusing leaves the card parked with its text.
      expect(footnoteDropSpec.classifyDrop(inlineCursor(h.editor, 3), FN_KEY, ctx).kind).toBe(
        "no-op",
      );
      footnoteDropSpec.applyDrop(inlineCursor(h.editor, 3), FN_KEY, ctx);

      expect(findAtom(h.getState().doc, "footnote")).toBeNull();
      expect(h.dispatched).toHaveLength(0);
      expect(warn).toHaveBeenCalled();
      expect(String(warn.mock.calls[0][0])).toContain("atomCards.footnote");
      warn.mockRestore();
    });

    it("does NOT reconcile a drop into a NON-main editor (the panel couldn't corroborate it)", () => {
      // `targetScope: "any-editor"` — a card body can host a footnote atom. But
      // the panel resolves "anchored?" from the MAIN doc only, so clearing the
      // parked intent for an atom it can't see would hide the card from both
      // the anchored list and the atomless one.
      const h = liveEditor(docWithoutAtom());
      const other = liveEditor(docWithoutAtom());
      const anchored: string[] = [];
      const ctx = {
        ...(ctxWithBody(h.editor, BODY, anchored) as unknown as Record<string, unknown>),
        mainEditor: h.editor,
      } as unknown as DropCtx;

      footnoteDropSpec.applyDrop(inlineCursor(other.editor, 3), FN_KEY, ctx);

      // The atom still lands where the user dropped it …
      expect(findAtom(other.getState().doc, "footnote")).not.toBeNull();
      // … but the card stays parked.
      expect(anchored).toEqual([]);
    });

    it("a genuinely empty card body anchors as the empty doc (no false decline)", () => {
      const h = liveEditor(docWithoutAtom());
      const anchored: string[] = [];
      footnoteDropSpec.applyDrop(
        inlineCursor(h.editor, 3),
        FN_KEY,
        ctxWithBody(h.editor, EMPTY_BODY, anchored),
      );
      const atom = findAtom(h.getState().doc, "footnote");
      expect(atom).not.toBeNull();
      expect(atom!.node.attrs.content).toEqual(EMPTY_BODY);
      expect(anchored).toEqual([FN_ID]);
    });
  });

  // ── Citation: valid command ───────────────────────────────────────────
  describe("citationDropSpec (real factory) — valid command", () => {
    const CITE_ID = "cite-real-3m";
    const CITE_KEY = `float:card:citation:${CITE_ID}`;
    const COMMAND = "\\cite{smith2020}";

    /** A ctx whose citations.commandFor(id) resolves a real `\cite{key}`. */
    function ctxWithCommand(editor: Editor, command: string | null): DropCtx {
      return {
        mainEditor: editor,
        atomCards: {
          citation: {
            atomAttrsFor: (id: string) => ({ command: id === CITE_ID ? command : null }),
          },
        },
      } as unknown as DropCtx;
    }

    it("classifyDrop returns `apply` when commandFor resolves a valid command", () => {
      const h = liveEditor(docWithoutAtom());
      const d = citationDropSpec.classifyDrop(
        inlineCursor(h.editor, 3),
        CITE_KEY,
        ctxWithCommand(h.editor, COMMAND),
      );
      expect(d.kind).toBe("apply");
      expect(d.kind).not.toBe("confirm");
    });

    it("applyDrop inserts a citation with citationId === card id and the RESOLVED command", () => {
      const h = liveEditor(docWithoutAtom());
      expect(findAtom(h.getState().doc, "citation")).toBeNull();

      citationDropSpec.applyDrop(
        inlineCursor(h.editor, 3),
        CITE_KEY,
        ctxWithCommand(h.editor, COMMAND),
      );

      const atom = findAtom(h.getState().doc, "citation");
      expect(atom).not.toBeNull();
      // (b) citationId === card id (NO fresh id) + the resolved command.
      expect(atom!.node.attrs.citationId).toBe(CITE_ID);
      expect(atom!.node.attrs.command).toBe(COMMAND);
      expect(atom!.node.attrs.displayText).toBe("");
      expect(atom!.from).toBe(3);
      // FOLD 2 undo-park: parking tr (selection-only, addToHistory:false) then
      // the insert.
      expect(h.dispatched).toHaveLength(2);
      expect(h.dispatched[0].docChanged).toBe(false);
      expect(h.dispatched[0].getMeta("addToHistory")).toBe(false);
      expect(h.dispatched[1].docChanged).toBe(true);
    });
  });

  // ── Citation: keyless / empty command DECLINES ────────────────────────
  describe("citationDropSpec (real factory) — keyless/empty declines", () => {
    const CITE_ID = "cite-empty-9q";
    const CITE_KEY = `float:card:citation:${CITE_ID}`;

    function ctxWithCommand(editor: Editor, command: string | null): DropCtx {
      return {
        mainEditor: editor,
        atomCards: {
          citation: {
            atomAttrsFor: (id: string) => ({ command: id === CITE_ID ? command : null }),
          },
        },
      } as unknown as DropCtx;
    }

    it("an empty command ('') → classify no-op + apply inert (real decline guard)", () => {
      const h = liveEditor(docWithoutAtom());
      const d = citationDropSpec.classifyDrop(
        inlineCursor(h.editor, 3),
        CITE_KEY,
        ctxWithCommand(h.editor, ""),
      );
      expect(d.kind).toBe("no-op");

      citationDropSpec.applyDrop(
        inlineCursor(h.editor, 3),
        CITE_KEY,
        ctxWithCommand(h.editor, ""),
      );
      expect(findAtom(h.getState().doc, "citation")).toBeNull();
      expect(h.dispatched).toHaveLength(0);
    });

    it("a keyless command ('\\cite{}') → classify no-op + apply inert (real parseCiteCommand keyless check)", () => {
      const h = liveEditor(docWithoutAtom());
      const d = citationDropSpec.classifyDrop(
        inlineCursor(h.editor, 3),
        CITE_KEY,
        ctxWithCommand(h.editor, "\\cite{}"),
      );
      expect(d.kind).toBe("no-op");

      citationDropSpec.applyDrop(
        inlineCursor(h.editor, 3),
        CITE_KEY,
        ctxWithCommand(h.editor, "\\cite{}"),
      );
      expect(findAtom(h.getState().doc, "citation")).toBeNull();
      expect(h.dispatched).toHaveLength(0);
    });

    it("an absent citations bag (commandFor unavailable) → declines (no-op)", () => {
      const h = liveEditor(docWithoutAtom());
      const d = citationDropSpec.classifyDrop(
        inlineCursor(h.editor, 3),
        CITE_KEY,
        { mainEditor: h.editor } as unknown as DropCtx,
      );
      expect(d.kind).toBe("no-op");

      citationDropSpec.applyDrop(
        inlineCursor(h.editor, 3),
        CITE_KEY,
        { mainEditor: h.editor } as unknown as DropCtx,
      );
      expect(findAtom(h.getState().doc, "citation")).toBeNull();
      expect(h.dispatched).toHaveLength(0);
    });
  });
});
