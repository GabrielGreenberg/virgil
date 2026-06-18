// @vitest-environment jsdom
/**
 * Architectural pin (Chip 2): the text-object float drop button appears IFF a
 * working drop spec exists.
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
 * This test pins the biconditional: for EVERY `TextObjectKind` with a
 * registered float body, `lookupSpec(buildFloatKey({domain:"textobject", kind,
 * id}))` is defined. Importing `@/text-objects/floats` runs every
 * `registerFloatBody(...)` side-effect so the registry reflects production.
 *
 * TEETH: the assertion is per-poppable-kind, not a blanket "textobject keys
 * resolve" — a future kind that registers a float body but whose key fails to
 * route (e.g. a new domain split or a kind dropped from the `lookupSpec`
 * textobject branch) goes RED. Verified by temporarily asserting the inverse
 * (`toBeUndefined()`) in a scratch run: it failed for all 16 kinds, then
 * reverted.
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

describe("text-object float drop button ⇔ a working drop spec", () => {
  it("registers a float body for at least the known poppable kinds (guards the side-effect import)", () => {
    // If the side-effect import silently failed (no registrations), the loop
    // below would be empty and vacuously pass — this is the floor that keeps
    // the contract honest.
    expect(POPPABLE_KINDS.length).toBeGreaterThanOrEqual(10);
  });

  it.each(POPPABLE_KINDS)(
    "%s: lookupSpec resolves a defined drop spec for its float key",
    (kind) => {
      const key = buildFloatKey({ domain: "textobject", kind, id: "x" });
      const spec = lookupSpec(key);
      expect(spec).toBeDefined();
    },
  );

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
