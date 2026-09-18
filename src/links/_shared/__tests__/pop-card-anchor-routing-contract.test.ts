import { describe, it, expect } from "vitest";
import { cardPopKey } from "@/panels/panel-registry";
import { migrateLegacyKeyToFloat } from "@/floats/float-key";
import { CARD_KINDS } from "@/cards/predicates";
import { LEGACY_TOKEN_CROSSWALK } from "@/cards/legacy-token-crosswalk";

/**
 * A3 Commit B pin-test (WS4). `popCardAtAnchor` was re-typed from
 * `(cardKind: string, …)` → `(kind: CardKind, …)` and re-routed from
 * `migrateLegacyKeyToFloat(\`${cardKind}:${id}\`)` to `cardPopKey(kind, id)`.
 *
 * The two routes MUST emit byte-identical float keys for every card kind, or a
 * popped card's float key drifts from the `data-card-key` the card stamps (the
 * AF parallel-grammar class of bug). The one divergent pair is the revision
 * comment/suggestion split (the legacy `revision` prefix canonicalizes to
 * `revision-comment`); the `"revision"` → `"revision-comment"` caller change in
 * EditorPane + card-creation rides on this equivalence, so it's pinned here.
 */
describe("popCardAtAnchor routing: cardPopKey ≡ legacy migrateLegacyKeyToFloat", () => {
  it("emits the same float key for every CardKind (keyed on the legacy prefix)", () => {
    for (const kind of CARD_KINDS) {
      const id = `id-${kind}`;
      // `migrateLegacyKeyToFloat` deliberately DEFERS the doc-aware-only
      // `example:`/`list:` prefixes untouched (float-key §134). `example` is
      // origin:derived (no creation factory, never passed to popCardAtAnchor),
      // so the legacy migrator never canonicalized it — the equivalence
      // doesn't apply. cardPopKey still emits the canonical key, which the
      // second assertion pins.
      if (kind !== "example") {
        // The OLD popCardAtAnchor fed `${<legacy-prefix>}:${id}` through the
        // migrator. The new path builds `cardPopKey(kind, id)` directly.
        // The legacy `<prefix>:<id>` shape, built from the FROZEN prefix column
        // (`LEGACY_TOKEN_CROSSWALK.legacyKeyPrefix`). It used to be read through
        // `cardKeyPrefix(kind)` off a live `CARD_REGISTRY` facet, which read as
        // the current key grammar and was nobody's (task 634): the live grammar
        // has no prefix segment, and these strings exist only so this parity can
        // be asked of stored pre-AF prefs.
        const legacy = migrateLegacyKeyToFloat(
          `${LEGACY_TOKEN_CROSSWALK[kind].legacyKeyPrefix}:${id}`,
        );
        expect(cardPopKey(kind, id)).toBe(legacy);
      }
      expect(cardPopKey(kind, id)).toBe(`float:card:${kind}:${id}`);
    }
  });

  it("pins the divergent revision pair (the `\"revision\"` → `\"revision-comment\"` caller change)", () => {
    // The legacy `revision` prefix (what the OLD `popCardAtAnchor(\"revision\", …)`
    // call passed) maps to the revision-comment kind.
    expect(migrateLegacyKeyToFloat("revision:x")).toBe("float:card:revision-comment:x");
    expect(cardPopKey("revision-comment", "x")).toBe("float:card:revision-comment:x");
    // …and the suggestion stays distinct under its own prefix.
    expect(migrateLegacyKeyToFloat("revision-suggestion:x")).toBe(
      "float:card:revision-suggestion:x",
    );
    expect(cardPopKey("revision-suggestion", "x")).toBe("float:card:revision-suggestion:x");
    // The two never collide.
    expect(cardPopKey("revision-comment", "x")).not.toBe(
      cardPopKey("revision-suggestion", "x"),
    );
  });
});
