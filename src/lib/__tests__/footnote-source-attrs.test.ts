// @vitest-environment jsdom
/**
 * Task 947 — a footnote's MARKUP survives archive → re-place.
 *
 * Archiving a `\thanks{…}` or a `\footnote[3]{…}` used to capture only the
 * body into `footnotes.json`; the re-anchor rebuilt a plain `\footnote{…}`, so
 * the acknowledgement took a number (renumbering every later footnote) and the
 * `[3]` vanished. These tests pin:
 *
 *  1. the CENSUS — every attr the real `footnote` node declares is classified
 *     as carried or derived, exactly once (a new attr fails CI until it is);
 *  2. the REBUILD — the real `footnoteDropSpec`, fed by the real
 *     `buildInlineAtomCardApis` from a ref carrying the markup, creates an atom
 *     that serializes back to `\thanks{` / `\footnote[3]{`, and the `\thanks`
 *     re-placed before another footnote does not push that footnote's number.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { getSchema } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { Footnote } from "@/lib/tiptap/footnote";
import { footnoteDropSpec } from "@/panels/Footnotes/drop-spec";
import { buildInlineAtomCardApis } from "@/components/drop-mode/atom-card-apis";
import type { DropCtx, Placement } from "@/components/drop-mode/types";
import { serializeToLatex } from "@/lib/latex-serializer";
import { footnoteNumbersFor } from "@/lib/footnote-numbering";
import type { FootnoteRef } from "@/lib/types";
import {
  FOOTNOTE_CARRIED_ATTRS,
  FOOTNOTE_DERIVED_ATTRS,
  FOOTNOTE_MARKUP_ATTRS,
  footnoteMarkupEqual,
  footnoteMarkupNodeAttrs,
  pickFootnoteMarkupAttrs,
} from "../footnote-source-attrs";

const schema = getSchema([Document, Paragraph, Text, Footnote]);

describe("footnote source attrs — the census (task 947)", () => {
  it("every attr of the real footnote node is carried XOR derived", () => {
    const declared = Object.keys(schema.nodes.footnote.spec.attrs ?? {}).sort();
    const carried = [...FOOTNOTE_CARRIED_ATTRS];
    const derived = [...FOOTNOTE_DERIVED_ATTRS];
    expect(carried.filter((a) => (derived as string[]).includes(a))).toEqual([]);
    expect([...carried, ...derived].sort()).toEqual(declared);
  });

  it("the markup attrs are carried", () => {
    for (const a of FOOTNOTE_MARKUP_ATTRS) {
      expect(FOOTNOTE_CARRIED_ATTRS as readonly string[]).toContain(a);
    }
  });

  it("record spelling: defaults are absent, malformed values read as absent", () => {
    expect(pickFootnoteMarkupAttrs({ thanks: false, numberOverride: null })).toEqual({});
    expect(pickFootnoteMarkupAttrs({ thanks: "yes", numberOverride: "" })).toEqual({});
    expect(pickFootnoteMarkupAttrs({ thanks: true })).toEqual({ thanks: true });
    expect(pickFootnoteMarkupAttrs({ numberOverride: "3" })).toEqual({ numberOverride: "3" });
    expect(footnoteMarkupNodeAttrs({})).toEqual({ thanks: false, numberOverride: null });
    expect(footnoteMarkupEqual({}, { thanks: undefined })).toBe(true);
    expect(footnoteMarkupEqual({}, { numberOverride: "3" })).toBe(false);
  });
});

// ── The rebuild ──────────────────────────────────────────────────────────

const BODY = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Thanks to the reviewers." }] }],
};

function liveEditor(doc: PMNode) {
  let state = EditorState.create({ schema, doc });
  const editor = {
    schema,
    get state() {
      return state;
    },
    view: {
      editable: true,
      get state() {
        return state;
      },
      nodeDOM: () => null,
      dispatch: (tr: Transaction) => {
        state = state.apply(tr);
      },
      focus: () => {},
    },
  } as unknown as Editor;
  return { editor, getState: () => state };
}

/** The ctx `EditorPane` builds, its sources reading a parked `footnotes.json`. */
function ctxFromRefs(editor: Editor, refs: FootnoteRef[]): DropCtx {
  const find = (id: string) => refs.find((r) => r.id === id);
  return {
    mainEditor: editor,
    atomCards: buildInlineAtomCardApis({
      footnoteContentFor: (id) => (find(id)?.content as never) ?? null,
      footnoteMarkupFor: (id) => pickFootnoteMarkupAttrs(find(id)),
      markFootnoteAnchored: () => {},
      citationCommandFor: () => null,
      markCitationAnchored: () => {},
    }),
  } as unknown as DropCtx;
}

function placeAt(editor: Editor, pos: number): Placement {
  return {
    kind: "inline-cursor",
    editor,
    pos,
    rect: { x: 0, y: 0, width: 0, height: 0 },
  } as unknown as Placement;
}

/** Re-place the parked ref `id` at `pos` through the REAL drop spec. */
function rePlace(refs: FootnoteRef[], id: string, doc: PMNode, pos: number) {
  const h = liveEditor(doc);
  footnoteDropSpec.applyDrop(placeAt(h.editor, pos), `float:card:footnote:${id}`, ctxFromRefs(h.editor, refs));
  return h.getState().doc;
}

function footnotesIn(doc: PMNode) {
  const out: Record<string, unknown>[] = [];
  doc.descendants((n) => {
    if (n.type.name === "footnote") out.push(n.attrs);
    return true;
  });
  return out;
}

const parked = (id: string, extra: Partial<FootnoteRef>): FootnoteRef => ({
  id,
  content: BODY,
  createdAt: "2026-10-05T00:00:00.000Z",
  archived: false,
  unanchored: true,
  ...extra,
});

describe("re-placing an archived footnote rebuilds its markup (task 947)", () => {
  it("a parked `\\thanks` comes back as `\\thanks`, uncounted", () => {
    const later = schema.nodes.footnote.create({ footnoteId: "fn-later", content: BODY });
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("Title"), schema.text(" body"), later]),
    ]);
    const out = rePlace([parked("fn-thx", { thanks: true })], "fn-thx", doc, 6);

    const fns = footnotesIn(out);
    const thx = fns.find((a) => a.footnoteId === "fn-thx");
    expect(thx?.thanks).toBe(true);
    expect(serializeToLatex(out.toJSON())).toContain("\\thanks{");
    // The acknowledgement is not counted, so the footnote after it is still 1.
    expect(footnoteNumbersFor(fns)).toEqual([0, 1]);
  });

  it("a parked `\\footnote[3]` keeps its mark", () => {
    const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("alpha bravo")])]);
    const out = rePlace([parked("fn-3", { numberOverride: "3" })], "fn-3", doc, 3);
    expect(footnotesIn(out)[0]?.numberOverride).toBe("3");
    expect(serializeToLatex(out.toJSON())).toContain("\\footnote[3]{");
  });

  it("CONTROL a plain parked footnote is rebuilt plain", () => {
    const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("alpha bravo")])]);
    const out = rePlace([parked("fn-plain", {})], "fn-plain", doc, 3);
    const tex = serializeToLatex(out.toJSON());
    expect(tex).toContain("\\footnote{");
    expect(tex).not.toContain("\\thanks");
    expect(tex).not.toContain("\\footnote[");
  });
});

describe("a stack pull carries the markup (task 947)", () => {
  it("the footnote pull seed keeps `thanks` and `numberOverride`", async () => {
    const { pullSeed } = await import("@/lib/stack/pull-seed");
    const { POPULATED_SNAPSHOT_DATA } = await import("@/lib/stack/__tests__/_pull-fixtures");
    const seed = pullSeed("footnote", POPULATED_SNAPSHOT_DATA.footnote as never);
    expect(pickFootnoteMarkupAttrs(seed)).toEqual({ thanks: true, numberOverride: "3" });
  });
});
