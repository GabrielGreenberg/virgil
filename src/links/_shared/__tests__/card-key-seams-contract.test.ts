import { describe, it, expect } from "vitest";
import {
  cardPopKey,
  cardDomSelector,
  popKey,
} from "@/panels/panel-registry";
import {
  parseAnyKey,
  buildFloatKey,
  migrateFloatKeys,
} from "@/floats/float-key";
import { CARD_REGISTRY } from "@/cards/card-registry";

/**
 * Companion to `entity-key-contract.test.ts`. That file pins the
 * `data-card-key` round-trip; this one pins the OTHER parallel-grammar seams
 * the AF re-review (NO-GO #2) found — all the same class (`cardPopKey` emits
 * `float:card:<kind>:<id>`, but omni-routing / resolvePos / focus / the morph
 * remap each hand-built or first-colon-sliced the legacy `<prefix>:<id>`):
 *
 *  - the marker→omni scroll/pin `omniKey` MUST equal the omni item id, which is
 *    `cardPopKey(kind,id)` (markers.ts / marker-clicks.ts / EditorLayout);
 *  - the OmniViewPanel `resolvePos` live-position cache key MUST equal the omni
 *    item id (footnote/citation/example), or live positions never re-map;
 *  - a revision card that morphs while popped MUST have its stored popout key
 *    remapped in lockstep (rect follows key), or `FloatHost` re-derives the old
 *    kind from the stale key and the float vanishes;
 *  - `cardDomSelector(kind,id)` MUST be the byte-exact `[data-card-key=…]`.
 */

// Single-kind omni panels: the omni item id is `popKey(panel,id)`, the
// marker-click `omniKey` is `cardPopKey(kind,id)`. These MUST be byte-identical
// or the scroll/pin queries `[data-omni-entry="${omniKey}"]` miss.
const OMNI_SINGLE_KIND = [
  { panel: "footnotes", kind: "footnote" },
  { panel: "citations", kind: "citation" },
  { panel: "examples", kind: "example" },
  { panel: "todo", kind: "todo" },
  { panel: "archive", kind: "archive" },
] as const;

// Polymorphic omni panels stamp `cardPopKey(card.kind,id)` directly (the real
// kind, not the panel's primary), so the marker→omni key must use the same.
const POLYMORPHIC_KINDS = [
  "note",
  "highlight",
  "revision-comment",
  "revision-suggestion",
  "cutter-comment",
  "cutter-suggestion",
  "report",
  "report-request",
] as const;

describe("omni-routing grammar: omniKey === item.id === cardPopKey(kind,id)", () => {
  it("single-kind panels: popKey(panel,id) === cardPopKey(kind,id) === float:card:<kind>:<id>", () => {
    for (const { panel, kind } of OMNI_SINGLE_KIND) {
      const id = `id-${kind}`;
      // omni item id (what `data-omni-entry` is stamped with)…
      const omniItemId = popKey(panel, id);
      // …and the marker-click omniKey (now built via cardPopKey)…
      const markerOmniKey = cardPopKey(kind, id);
      // …MUST be the same string, and the canonical float grammar.
      expect(markerOmniKey).toBe(omniItemId);
      expect(markerOmniKey).toBe(`float:card:${kind}:${id}`);
      expect(markerOmniKey).toBe(buildFloatKey({ domain: "card", kind, id }));
    }
  });

  it("polymorphic panels: cardPopKey(kind,id) carries the REAL kind, not the panel primary", () => {
    for (const kind of POLYMORPHIC_KINDS) {
      const id = "p-1";
      const key = cardPopKey(kind, id);
      expect(key).toBe(`float:card:${kind}:${id}`);
      const parsed = parseAnyKey(key);
      expect(parsed?.domain).toBe("card");
      expect(parsed?.kind).toBe(kind); // revision-comment ≠ revision-suggestion
      expect(parsed?.id).toBe(id);
    }
  });

  it("revision: comment and suggestion never collapse to a shared `revision:` omniKey", () => {
    const id = "rev-9";
    expect(cardPopKey("revision-comment", id)).not.toBe(
      cardPopKey("revision-suggestion", id),
    );
    // The legacy bug: both built `revision:${id}` → omni routed the wrong card.
    expect(cardPopKey("revision-comment", id)).toBe(`float:card:revision-comment:${id}`);
    expect(cardPopKey("revision-suggestion", id)).toBe(
      `float:card:revision-suggestion:${id}`,
    );
  });
});

describe("resolvePos cache key === omni item.id (the keystroke-time live-position seam)", () => {
  // OmniViewPanel.resolvePos builds its DocStructure→pos map keyed by
  // cardPopKey(kind, structureEntry.id); useInTextPositions looks it up with the
  // omni item.id = popKey(panel, id). A mismatch = positions never re-map.
  it("footnote / citation / example: cache key (cardPopKey) === item.id (popKey)", () => {
    const id = "struct-1";
    expect(cardPopKey("footnote", id)).toBe(popKey("footnotes", id));
    expect(cardPopKey("citation", id)).toBe(popKey("citations", id));
    expect(cardPopKey("example", id)).toBe(popKey("examples", id));
  });
});

describe("morph-survives: convert remaps the popout key in lockstep (rect follows)", () => {
  it("both directions parse to the post-morph kind", () => {
    const id = "card-7";
    const commentKey = cardPopKey("revision-comment", id);
    const suggestionKey = cardPopKey("revision-suggestion", id);
    // comment → suggestion
    expect(parseAnyKey(suggestionKey)?.kind).toBe("revision-suggestion");
    // suggestion → comment
    expect(parseAnyKey(commentKey)?.kind).toBe("revision-comment");
  });

  it("migrateFloatKeys moves BOTH the key list AND the saved rect to the new key", () => {
    const id = "card-7";
    const oldKey = cardPopKey("revision-comment", id);
    const newKey = cardPopKey("revision-suggestion", id);
    const rect = { x: 10, y: 20, width: 300, height: 200 };
    const remap = (k: string) => (k === oldKey ? newKey : k);

    const result = migrateFloatKeys([oldKey], { [oldKey]: rect }, remap);

    expect(result.changed).toBe(true);
    expect(result.keys).toEqual([newKey]);
    // The rect must follow the key — never orphan (a popped→morphed card keeps
    // its position) and never linger under the dead key.
    expect(result.positions[newKey]).toEqual(rect);
    expect(result.positions[oldKey]).toBeUndefined();
    // And the surviving key resolves to the NEW kind → FloatHost renders the
    // suggestion body instead of the vanished comment.
    expect(parseAnyKey(result.keys[0])?.kind).toBe("revision-suggestion");
  });

  it("a no-op morph (key absent) leaves prefs untouched", () => {
    const oldKey = cardPopKey("revision-comment", "not-popped");
    const newKey = cardPopKey("revision-suggestion", "not-popped");
    const remap = (k: string) => (k === oldKey ? newKey : k);
    // No popped key matches → changed:false, so the EditorLayout wrapper skips
    // the prefs write (morphing a docked-only card touches nothing).
    const result = migrateFloatKeys([], {}, remap);
    expect(result.changed).toBe(false);
  });
});

// A9 generalized the revision-only `convertRevisionCard` morph-remap to a
// kind-agnostic `convertCardWithRemap` that ALL 4 pairs fire through. This
// pins the SAME float-survival contract for a NON-revision pair (cutter) — the
// regression class an adversarial review flagged is "the generalization broke
// the float remap for one of the new pairs". The morph.to SSOT (CardMeta) is
// also pinned so the chokepoint resolves the right target kind.
describe("morph-remap generalizes to a non-revision pair (cutter)", () => {
  it("CARD_REGISTRY.morph wires the cutter pair both directions", () => {
    expect(CARD_REGISTRY["cutter-comment"].morph?.to).toBe("cutter-suggestion");
    expect(CARD_REGISTRY["cutter-suggestion"].morph?.to).toBe("cutter-comment");
    // Both share the cutter panel (so the chevron's cardKindsForPanel options
    // always include the target).
    expect(CARD_REGISTRY["cutter-comment"].panel).toBe("cutter");
    expect(CARD_REGISTRY["cutter-suggestion"].panel).toBe("cutter");
  });

  it("both directions parse to the post-morph kind (rect follows the new key)", () => {
    const id = "cut-7";
    const commentKey = cardPopKey("cutter-comment", id);
    const suggestionKey = cardPopKey("cutter-suggestion", id);
    // comment → suggestion
    expect(parseAnyKey(suggestionKey)?.kind).toBe("cutter-suggestion");
    // suggestion → comment
    expect(parseAnyKey(commentKey)?.kind).toBe("cutter-comment");
    // …and never collapse to a shared prefix (the revision-pair bug class).
    expect(commentKey).not.toBe(suggestionKey);
  });

  it("migrateFloatKeys moves BOTH the key list AND the saved rect on a cutter morph", () => {
    const id = "cut-7";
    const oldKey = cardPopKey("cutter-comment", id);
    const newKey = cardPopKey("cutter-suggestion", id);
    const rect = { x: 12, y: 24, width: 320, height: 210 };
    const remap = (k: string) => (k === oldKey ? newKey : k);

    const result = migrateFloatKeys([oldKey], { [oldKey]: rect }, remap);

    expect(result.changed).toBe(true);
    expect(result.keys).toEqual([newKey]);
    // The rect follows the key — a popped→morphed cutter card keeps its window.
    expect(result.positions[newKey]).toEqual(rect);
    expect(result.positions[oldKey]).toBeUndefined();
    expect(parseAnyKey(result.keys[0])?.kind).toBe("cutter-suggestion");
  });

  it("no-op when the cutter card isn't floated (remap touches nothing)", () => {
    const oldKey = cardPopKey("cutter-suggestion", "not-popped");
    const newKey = cardPopKey("cutter-comment", "not-popped");
    const remap = (k: string) => (k === oldKey ? newKey : k);
    const result = migrateFloatKeys([], {}, remap);
    expect(result.changed).toBe(false);
  });

  it("the report pair (lossy) also carries the morph.to SSOT both ways", () => {
    // The morph now declares its dropped-field set (T4 §3.2). report →
    // report-request drops title + byline; the reverse drops the aiRequest flag
    // (which is why a report-request→report morph unbridges the inbox).
    expect(CARD_REGISTRY.report.morph).toEqual({
      to: "report-request",
      lossy: true,
      drops: ["title", "byline"],
    });
    expect(CARD_REGISTRY["report-request"].morph).toEqual({
      to: "report",
      lossy: true,
      drops: ["aiRequest"],
    });
    // note⇄highlight is lossy in ONE direction only (R14 / REP-F6-03): note →
    // highlight drops the body + title, but highlight → note is lossless (a
    // highlight has no user content), so its `morph.to` SSOT rides a non-lossy
    // facet with no confirm.
    expect(CARD_REGISTRY.note.morph?.lossy).toBe(true);
    expect(CARD_REGISTRY.highlight.morph?.lossy).toBe(false);
  });
});

describe("cardDomSelector is the byte-exact data-card-key selector", () => {
  it("== `[data-card-key=\"${cardPopKey(kind,id)}\"]` for every routed kind", () => {
    for (const kind of [
      "note",
      "footnote",
      "citation",
      "todo",
      "archive",
      "revision-comment",
      "revision-suggestion",
      "cutter-comment",
      "cutter-suggestion",
    ] as const) {
      const id = `id-${kind}`;
      expect(cardDomSelector(kind, id)).toBe(
        `[data-card-key="${cardPopKey(kind, id)}"]`,
      );
    }
  });
});
