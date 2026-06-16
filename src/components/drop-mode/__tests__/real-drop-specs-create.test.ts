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
 *  - footnote → a node with `footnoteId === <card id>` AND the canonical
 *    content doc (`{ type: "doc", content: [{ type: "paragraph" }] }`, number 0);
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

    it("classifyDrop returns `apply` (no atom + real createAtom)", () => {
      const h = liveEditor(docWithoutAtom());
      const d = footnoteDropSpec.classifyDrop(
        inlineCursor(h.editor, 3),
        FN_KEY,
        { mainEditor: h.editor } as unknown as DropCtx,
      );
      expect(d.kind).toBe("apply");
      expect(d.kind).not.toBe("confirm");
    });

    it("applyDrop inserts a footnote carrying the card's EXISTING id + the canonical content doc", () => {
      const h = liveEditor(docWithoutAtom());
      expect(findAtom(h.getState().doc, "footnote")).toBeNull();

      footnoteDropSpec.applyDrop(
        inlineCursor(h.editor, 3),
        FN_KEY,
        { mainEditor: h.editor } as unknown as DropCtx,
      );

      const atom = findAtom(h.getState().doc, "footnote");
      expect(atom).not.toBeNull();
      // (a) footnoteId === the card id — NO fresh id minted.
      expect(atom!.node.attrs.footnoteId).toBe(FN_ID);
      // The canonical empty-body content doc the `\footnote` create path builds.
      expect(atom!.node.attrs.content).toEqual({
        type: "doc",
        content: [{ type: "paragraph" }],
      });
      // number 0 — the renumber pass assigns the live number.
      expect(atom!.node.attrs.number).toBe(0);
      // Landed at the drop position; single insert transaction.
      expect(atom!.from).toBe(3);
      expect(h.dispatched).toHaveLength(1);
      expect(h.dispatched[0].docChanged).toBe(true);
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
        citations: { commandFor: (id: string) => (id === CITE_ID ? command : null) },
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
      expect(h.dispatched).toHaveLength(1);
    });
  });

  // ── Citation: keyless / empty command DECLINES ────────────────────────
  describe("citationDropSpec (real factory) — keyless/empty declines", () => {
    const CITE_ID = "cite-empty-9q";
    const CITE_KEY = `float:card:citation:${CITE_ID}`;

    function ctxWithCommand(editor: Editor, command: string | null): DropCtx {
      return {
        mainEditor: editor,
        citations: { commandFor: (id: string) => (id === CITE_ID ? command : null) },
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
