/**
 * CENSUS — the margin-handler bundles' POPULATION covers every card kind that
 * can hold a paragraph link (task 1473).
 *
 * `buildMarginItemHandlers` is read two ways: the margin Delete asks a bundle
 * by ID, and the archive carry / displaced-anchor retarget
 * (`src/cards/retarget-anchors.ts`) ask its COLLECTION which cards name a
 * removed uuid. A card kind that sits in no bundle's `cards` is therefore
 * carried nowhere and re-homed nowhere — it stays active, pointing at a
 * paragraph that now lives in the archive. That was the highlight: the notes
 * bundle was fed `useNotes().notes` (kind `note` only), while a highlight the
 * drop-mode re-anchor had moved onto a paragraph held a pid link with no mark.
 *
 * Every bundle is fed one record of EACH kind its panel stores (the registry's
 * `panel`, the stored token `storedKindForCardKind` names), and the census
 * asserts every such record is in the bundle's collection, found by id, and
 * classified back to its own kind. Then every ANCHORED kind must belong to some
 * bundle, or be exempt for a reason the registry itself states.
 */
import { describe, it, expect } from "vitest";
import {
  buildMarginItemHandlers,
  type BuildMarginItemHandlersDeps,
  type MarginItemKind,
} from "@/cards/delete-margin-item";
import {
  CARD_KINDS,
  cardKindsForPanel,
  isAnchoredCardKind,
  storedKindForCardKind,
} from "@/cards/predicates";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { panelForMarkerType } from "@/cards/marker-meta";
import { CARD_ATOMS } from "@/lib/tiptap/atom-registry";
import type { CardKind } from "@/cards/types";

/** Which dep slot feeds each bundle — typed total over `MarginItemKind`, so a
 *  new marker namespace must name its slot here. */
const DEP_SLOT: Record<MarginItemKind, keyof BuildMarginItemHandlersDeps> = {
  note: "notes",
  archive: "archive",
  cut: "cutter",
  todo: "todos",
  revision: "revisions",
  report: "reports",
};
const BUNDLES = Object.keys(DEP_SLOT) as MarginItemKind[];

/** One record per kind the bundle's panel stores, spelled as stored. */
function recordsFor(bundle: MarginItemKind) {
  return cardKindsForPanel(panelForMarkerType(bundle)).map((kind) => ({
    expected: kind,
    record: {
      id: `${bundle}:${kind}`,
      kind: storedKindForCardKind(kind)?.stored ?? kind,
      links: [],
    },
  }));
}

const noop = () => {};
const del = async () => true;
const doors = {
  addCardParagraphId: noop,
  removeCardParagraphId: noop,
  detachAnchorSources: noop,
  deleteCard: del,
};
const rows = (b: MarginItemKind) => recordsFor(b).map((r) => r.record) as never[];

const handlers = buildMarginItemHandlers({
  notes: { cards: rows("note"), ...doors, deleteNote: del },
  archive: { snippets: rows("archive"), ...doors, addParagraphId: noop, removeParagraphId: noop, deleteSnippet: del },
  cutter: { cards: rows("cut"), ...doors },
  todos: { items: rows("todo"), ...doors, addParagraphId: noop, removeParagraphId: noop, deleteItem: del },
  revisions: { cards: rows("revision"), ...doors },
  reports: { cards: rows("report"), ...doors },
});

describe("margin-handler population CENSUS (task 1473)", () => {
  for (const bundle of BUNDLES) {
    for (const { expected, record } of recordsFor(bundle)) {
      it(`${bundle} bundle holds and classifies a stored ${expected}`, () => {
        const h = handlers[bundle];
        expect(h.cards.map((c) => c.id)).toContain(record.id);
        expect(h.findCard(record.id)?.id).toBe(record.id);
        const ck = typeof h.contentKind === "function" ? h.contentKind(h.findCard(record.id)!) : h.contentKind;
        expect(ck).toBe(expected);
      });
    }
  }

  it("every anchored card kind lives in some bundle, or is exempt by the registry", () => {
    const covered = new Set<CardKind>(BUNDLES.flatMap((b) => recordsFor(b).map((r) => r.expected)));
    const atomKinds = new Set<CardKind>(CARD_ATOMS.map((a) => a.kind));
    const uncovered = CARD_KINDS.filter(isAnchoredCardKind).filter((k) => !covered.has(k));
    for (const k of uncovered) {
      // An inline atom's anchor IS its node in the text: it travels with the
      // slice itself, never by a pid on a sidecar record. A `derived` kind
      // mirrors a TextObject harvested from the document and holds no link.
      const exempt = atomKinds.has(k) || CARD_REGISTRY[k].origin === "derived";
      expect(exempt, `${k} can hold a paragraph link but no margin bundle holds it`).toBe(true);
    }
  });
});
