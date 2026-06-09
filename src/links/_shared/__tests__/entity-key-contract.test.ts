import { describe, it, expect } from "vitest";
import {
  cardKeyForEntity,
  ANCHORED_CARD_KINDS,
  type EntityCollections,
} from "../entity-hover";
import { parseAnyKey } from "@/floats/float-key";
import { cardPopKey, getPanelByCardKind } from "@/panels/panel-registry";
import type { CardKind } from "@/panels/_shared/types";

/**
 * The seam the AF pre-merge review (NO-GO) caught: AF flipped the canonical
 * card-key grammar to `float:card:<kind>:<id>` (via `cardPopKey`), but the
 * `src/links/_shared/` consumers still hand-built / first-colon-sliced the
 * legacy `<prefix>:<id>` shape. The divergence is string-typed (invisible to
 * tsc) and no test covered it, so panel-card↔in-text hover, selection, jump,
 * the Omni category filter, and the cutter/revision marker scroll silently
 * broke. This test pins the contract so it can't regress unnoticed again.
 */

// cardKeyForEntity ignores its collections arg; an empty bag suffices.
const EMPTY: EntityCollections = {
  notes: [],
  cutterCards: [],
  comments: [],
  todos: [],
  archiveSnippets: [],
  examples: [],
};

describe("entity-key ↔ data-card-key contract (AF float grammar)", () => {
  it("cardKeyForEntity == what the card actually stamps (cardPopKey) for every anchored kind", () => {
    for (const kind of ANCHORED_CARD_KINDS) {
      const id = `id-${kind}`;
      const entityKey = cardKeyForEntity({ kind, id }, EMPTY);
      // The reconciler/placement query `[data-card-key="${entityKey}"]`; the DOM
      // stamps `cardPopKey(kind, id)`. These MUST be byte-identical.
      expect(entityKey).toBe(cardPopKey(kind, id));
      expect(entityKey).toBe(`float:card:${kind}:${id}`);
    }
  });

  it("the produced key round-trips through parseAnyKey (the hover-bridge / isSelfDrop path)", () => {
    for (const kind of ANCHORED_CARD_KINDS) {
      const id = "uuid-1234";
      const key = cardKeyForEntity({ kind, id }, EMPTY)!;
      const parsed = parseAnyKey(key);
      expect(parsed).not.toBeNull();
      expect(parsed!.domain).toBe("card");
      expect(parsed!.kind).toBe(kind);
      expect(parsed!.id).toBe(id); // colon-safe: never "card:<kind>:<id>"
    }
  });

  it("revision comment vs suggestion stay distinct (the s:-infix trap)", () => {
    expect(cardKeyForEntity({ kind: "revision-comment", id: "x" }, EMPTY)).toBe(
      "float:card:revision-comment:x",
    );
    expect(cardKeyForEntity({ kind: "revision-suggestion", id: "x" }, EMPTY)).toBe(
      "float:card:revision-suggestion:x",
    );
    expect(parseAnyKey("float:card:revision-suggestion:x")!.kind).toBe(
      "revision-suggestion",
    );
  });

  it("hover-bridge anchored check: a parsed card key's kind is in the anchored set", () => {
    const anchored = new Set<string>(ANCHORED_CARD_KINDS);
    for (const kind of ANCHORED_CARD_KINDS) {
      const parsed = parseAnyKey(cardKeyForEntity({ kind, id: "i" }, EMPTY)!);
      expect(parsed!.domain).toBe("card");
      expect(anchored.has(parsed!.kind)).toBe(true);
    }
  });

  it("omni categoryOf path: each anchored kind resolves to an owning panel", () => {
    for (const kind of ANCHORED_CARD_KINDS) {
      const parsed = parseAnyKey(cardKeyForEntity({ kind, id: "i" }, EMPTY)!);
      const panel = getPanelByCardKind(parsed!.kind as CardKind);
      expect(panel, `no owning panel for ${kind}`).not.toBeNull();
    }
  });
});
