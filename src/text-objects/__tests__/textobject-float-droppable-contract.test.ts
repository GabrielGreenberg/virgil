// @vitest-environment jsdom
/**
 * Architectural pin (Chip 2/3): the text-object float drop button appears IFF a
 * working drop spec exists AND that spec can actually MOVE the floated kind.
 *
 * `text-object-floatable` sets `canDrop: true` on EVERY text-object float, so
 * `FloatChrome` renders the (re)anchor drop button for every kind that can pop
 * out (i.e. every kind with a registered `floatBodyComponent`). Pressing it
 * drives `LiftHost.beginLift({terminalPolicy:"float"})`, which starts a drop
 * session keyed on the float's `float:textobject:<kind>:<id>` key — the same
 * key `lookupSpec` resolves against. If a poppable kind had no drop spec, the
 * button would render but its press would no-op (a session with no spec), a
 * silent dead control.
 *
 * Two-layer contract:
 *
 *   1. lookupSpec resolves SOMETHING for every poppable kind. This alone is
 *      WEAK (Chip-3 adversarial finding): `lookupSpec` returns
 *      `textObjectDropSpec` as a CATCH-ALL for every non-`linkedRange`
 *      textobject key (`registry.ts` — the `if (parsed.domain ===
 *      "textobject") { … return textObjectDropSpec; }` branch never hits
 *      `undefined`), so "every floatable kind → a defined spec" is VACUOUSLY
 *      true and can't fail. We keep the `.toBeDefined()` assertion as a floor
 *      but no longer rely on it for teeth.
 *
 *   2. The REAL teeth: for every poppable kind, the registry entry carries the
 *      fields `textObjectDropSpec.applyDrop` reads to MOVE that kind. Reading
 *      `specs/textobject.ts`, `applyDrop` → `locate` → `resolveMoveSource`
 *      touches exactly two registry fields:
 *        • `TEXT_OBJECT_REGISTRY[kind].dropAdapter` — REQUIRED. `applyDrop`
 *          calls it unconditionally to decide wrap-vs-direct; a missing/null
 *          adapter throws at the call site, so the press would crash rather
 *          than move. We assert it's a callable function per poppable kind.
 *        • `collectMoveSource` — OPTIONAL. When absent, `resolveMoveSource`
 *          falls back to the default single-node-by-uuid walk. We assert it's
 *          EITHER a function OR absent (never some other truthy non-callable
 *          that would blow up `resolveMoveSource`), so the default resolution
 *          provably applies for the kinds that omit it.
 *
 * TEETH PROOF: temporarily nulling one kind's `dropAdapter` in a scratch run
 * turns its row RED (the `typeof … === "function"` assertion fails) — proving
 * the new check is load-bearing where the old `.toBeDefined()` loop was inert.
 * The `linkedRange → textRangeMoveDropSpec` identity assertion and the
 * floor-count guard are retained.
 */

import { describe, it, expect } from "vitest";

// The drop registry's module graph reaches `@/lib/storage` (registry → card
// drop-specs). Nothing in storage is exercised here; a no-op Proxy lets the
// graph load (the controller-commit-flush.test precedent).
import { vi } from "vitest";
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "__esModule" ? true : prop === "then" ? undefined : noop,
    },
  );
});

// Side-effect import: runs every `registerFloatBody(kind, Component)` so the
// registry's `floatBodyComponent` slots reflect the production wiring.
import "@/text-objects/floats";

import { TEXT_OBJECT_REGISTRY } from "@/text-objects/text-object-registry";
import { lookupSpec } from "@/components/drop-mode/registry";
import { buildFloatKey } from "@/floats/float-key";
import type { TextObjectKind } from "@/text-objects/types";

const POPPABLE_KINDS = (
  Object.keys(TEXT_OBJECT_REGISTRY) as TextObjectKind[]
).filter((kind) => TEXT_OBJECT_REGISTRY[kind].floatBodyComponent != null);

describe("text-object float drop button ⇔ a working, MOVE-capable drop spec", () => {
  it("registers a float body for at least the known poppable kinds (guards the side-effect import)", () => {
    // If the side-effect import silently failed (no registrations), the loops
    // below would be empty and vacuously pass — this is the floor that keeps
    // the contract honest.
    expect(POPPABLE_KINDS.length).toBeGreaterThanOrEqual(10);
  });

  it.each(POPPABLE_KINDS)(
    "%s: lookupSpec resolves a defined drop spec for its float key (floor; see header — weak by itself)",
    (kind) => {
      const key = buildFloatKey({ domain: "textobject", kind, id: "x" });
      const spec = lookupSpec(key);
      expect(spec).toBeDefined();
    },
  );

  it.each(POPPABLE_KINDS)(
    "%s: the registry carries the fields textObjectDropSpec.applyDrop reads to MOVE the kind",
    (kind) => {
      const meta = TEXT_OBJECT_REGISTRY[kind];
      // `dropAdapter` is REQUIRED — `applyDrop` calls
      // `TEXT_OBJECT_REGISTRY[src.kind].dropAdapter(...)` unconditionally
      // (specs/textobject.ts). A missing/null adapter would throw on the press
      // rather than move. THIS is the load-bearing assertion (the `.toBeDefined`
      // loop above is vacuous — see the header). Null one kind's `dropAdapter`
      // in a scratch run and this row goes RED.
      expect(
        typeof meta.dropAdapter,
        `${kind}.dropAdapter must be callable so applyDrop can resolve wrap-vs-direct`,
      ).toBe("function");
      // `collectMoveSource` is OPTIONAL — when absent, `resolveMoveSource`
      // (specs/textobject.ts) falls back to the default single-node-by-uuid
      // walk. Pin that it's EITHER a callable OR genuinely absent, so a kind
      // that omits it provably gets the default resolution (and a future kind
      // can't set it to a truthy non-function that would blow up
      // `resolveMoveSource`).
      const cms = meta.collectMoveSource;
      expect(
        cms === undefined || typeof cms === "function",
        `${kind}.collectMoveSource must be a function or absent (default single-node resolution)`,
      ).toBe(true);
    },
  );

  it("at least one poppable kind relies on the DEFAULT single-node move resolution (collectMoveSource omitted)", () => {
    // Confirms the optional-field branch of the contract isn't dead: the spec's
    // default resolution path actually serves real kinds (paragraph, lists,
    // blocks — only `heading` overrides `collectMoveSource`).
    const defaulted = POPPABLE_KINDS.filter(
      (kind) => TEXT_OBJECT_REGISTRY[kind].collectMoveSource === undefined,
    );
    expect(defaulted.length).toBeGreaterThan(0);
  });

  it("the linkedRange float key routes specifically to the text-range move spec", async () => {
    // Edge case the chip calls out: linkedRange is floatable and must route to
    // `textRangeMoveDropSpec` (not the generic textObjectDropSpec). Pin the
    // exact spec identity so a regression that drops the linkedRange branch in
    // `lookupSpec` is caught (it would fall through to textObjectDropSpec and
    // skip the transient-anchor cleanup).
    const { textRangeMoveDropSpec } = await import(
      "@/components/drop-mode/specs/text-range-move"
    );
    const key = buildFloatKey({
      domain: "textobject",
      kind: "linkedRange",
      id: "a1",
    });
    expect(lookupSpec(key)).toBe(textRangeMoveDropSpec);
  });
});
