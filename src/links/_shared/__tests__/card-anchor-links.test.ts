// @vitest-environment node
//
// Task 1133 — "which card locates `ref` in the editor?" has ONE answer,
// `anchorCardOfRef` (task 1505: a card for the anchor authority, not a link
// list for a private ladder), and both hooks that ask it (the anchor-highlight
// reconciler and placement) call it. Before, placement carried its own copy
// that never learned the applied-change rung, so selecting an APPLIED
// suggestion card aligned the document to the stale original link (degraded to
// the whole paragraph) instead of the AI-written span the wash paints.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { anchorCardOfRef } from "../card-anchor-links";
import type { EntityCollectionSlots } from "@/cards/entity-collections";
import type { Link } from "../types";
import { CARD_ATOMS } from "@/lib/tiptap/atom-registry";

const STALE: Link = {
  id: "orig-link",
  kind: "anchor",
  anchor: {},
  target: {},
} as never;

const APPLIED = {
  id: "rs1",
  kind: "suggestion",
  status: "applied",
  appliedChange: {
    anchorId: "anc-blue-1",
    anchorUuid: "para-uuid-1",
    replacement: "The revised (AI) sentence.",
    originalText: "The original sentence.",
  },
  links: [STALE],
};

const empty = (): EntityCollectionSlots => ({
  notes: [],
  highlights: [],
  cutterCards: [],
  comments: [],
  todoItems: [],
  archiveSnippets: [],
  reportCards: [],
  examples: [],
});

describe("anchorCardOfRef — the one ref → anchor-card resolver", () => {
  it("an APPLIED revision suggestion resolves to its live appliedChange span, not the stale link", () => {
    const c = { ...empty(), comments: [APPLIED] };
    const links = anchorCardOfRef({ kind: "revision-suggestion", id: "rs1" }, c)!.links!;
    expect(links).toHaveLength(1);
    expect(links[0].id).toBe("anc-blue-1");
    expect(links[0].anchor).toMatchObject({
      type: "textObject",
      targetKind: "linkedRange",
      textRange: { anchorId: "anc-blue-1" },
    });
  });

  it("an APPLIED cutter suggestion resolves the same way", () => {
    const c = { ...empty(), cutterCards: [APPLIED] };
    const links = anchorCardOfRef({ kind: "cutter-suggestion", id: "rs1" }, c)!.links!;
    expect(links.map((l) => l.id)).toEqual(["anc-blue-1"]);
  });

  it("a pending suggestion falls back to its persisted links", () => {
    const c = { ...empty(), comments: [{ ...APPLIED, status: "pending" }] };
    expect(anchorCardOfRef({ kind: "revision-suggestion", id: "rs1" }, c)!.links).toEqual([STALE]);
  });

  it("every Card-bearing atom kind synthesizes an inline-atom link from the registry row", () => {
    for (const m of CARD_ATOMS) {
      const [link] = anchorCardOfRef({ kind: m.kind, id: "x1" }, empty())!.links!;
      expect(link.anchor).toEqual({ type: "inline-atom", nodeName: m.nodeName, pos: null });
      expect(link.target).toEqual({ type: "card", ref: { kind: m.kind, id: "x1" } });
    }
  });

  it("a missing entity resolves to no card", () => {
    expect(anchorCardOfRef({ kind: "note", id: "nope" }, empty())).toBeNull();
  });

  it("both hooks call the one resolver and carry no private copy", () => {
    for (const f of ["usePlacement.ts", "useAnchorHighlightReconciler.ts"]) {
      const src = readFileSync(join(__dirname, "..", f), "utf8");
      expect(src, f).toMatch(/anchorCardOfRef\(/);
      expect(src, f).not.toMatch(/function linkForInlineAtom|function getAnchorLinks|function linksForRef/);
    }
  });
});
