// @vitest-environment jsdom
/**
 * Task 259 — the stack-carry facet, pinned to the mechanism.
 *
 * "Which card kinds the Stack carries" was hand-restated in six parallel places
 * that had to stay in lockstep with nothing holding them together, and every one
 * of the switches failed SILENTLY: the card dropped onto the Stack fine and
 * VANISHED on pull, with no compile error, no runtime error and no failing test.
 * Alone among the drop-adjacent facets, the Stack had no coverage guard —
 * `assertMorphCoverage`, `assertContentCoverage`, `assertDropFacetCoverage` and
 * `assertPanelTypographyCoverage` each pin their facet to the real mechanism.
 * The cluster had already visibly drifted: `example` declared `stackable: true`
 * with a `() => null` snapshot, an empty placement list and a no-op pull branch.
 *
 * The fix declares the vocabulary ONCE (`STACK_CARD_KINDS`,
 * `src/lib/stack/card-kinds.ts`) and derives or pins everything else. The
 * compiler covers what it can — `CARD_PLACEMENTS` is a `Record` over the union,
 * `StackCardSnapshot` is pinned by an `Exact` assertion in `lib/stack/types`,
 * and the `snapshotCard` / `summarizeStackItem` / `applyCardDrop` switches now
 * carry `never` checks. This suite covers the rest, in two tiers:
 *
 *   • the BOOT assertion (`assertStackCoverage`) on the static mirrors — silent
 *     on the real registry, and loud on each drift shape individually, so a
 *     future edit that guts one branch of it fails here;
 *   • the MECHANISMS a boot assertion structurally cannot reach — a built
 *     `Floatable`'s `snapshotForStack`, the `snapshotCard` dispatcher, and the
 *     real `applyCardDrop` branch driven against a recording `StackPullApi`.
 *     That last leg is the one that catches the ORIGINAL shape: a kind that is
 *     declared everywhere and whose pull does nothing.
 *
 * (The per-kind snapshot ROUND-TRIP through each float builder lives in
 * `float-snapshot.test.ts`, which derives its list from the same facet.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readStackItemMock } = vi.hoisted(() => ({ readStackItemMock: vi.fn() }));
vi.mock("@/hooks/useStack", () => ({ readStackItem: readStackItemMock }));

import { CARD_REGISTRY, assertStackCoverage } from "../card-registry";
import { CARD_KINDS } from "../predicates";
import type { CardKind } from "../types";
import {
  CARD_KIND_BY_STACK_CARD_KIND,
  STACK_CARD_KINDS,
  isStackableCardKind,
  stackCardKindFor,
  type StackCardKind,
  type StackItem,
} from "@/lib/stack/types";
import { snapshotCard } from "@/lib/stack/snapshot";
import { stackPullDropSpec } from "@/components/drop-mode/specs/stack-pull";
import type { DropCtx, Placement, StackPullApi } from "@/components/drop-mode/types";

/** Run `fn` with `console.error` captured. */
function errorsFrom(fn: () => void): string[] {
  const real = console.error;
  const calls: string[] = [];
  console.error = (...args: unknown[]) => {
    calls.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.error = real;
  }
  return calls;
}

/** Temporarily overwrite a registry facet, restoring it afterwards. */
function withFacet<K extends keyof (typeof CARD_REGISTRY)[CardKind]>(
  kind: CardKind,
  facet: K,
  value: (typeof CARD_REGISTRY)[CardKind][K],
  fn: () => void,
) {
  const prior = CARD_REGISTRY[kind][facet];
  CARD_REGISTRY[kind][facet] = value;
  try {
    fn();
  } finally {
    CARD_REGISTRY[kind][facet] = prior;
  }
}

describe("assertStackCoverage — the boot pin on the declared facet", () => {
  it("is SILENT on the real registry", () => {
    const errs = errorsFrom(assertStackCoverage);
    expect(errs, errs.join("\n")).toHaveLength(0);
  });

  it("fires when a kind declares stackable:true outside the Stack vocabulary", () => {
    // The `example` shape, verbatim: declared stackable, carried by nothing.
    expect(isStackableCardKind("example")).toBe(false);
    const errs = withFacetErrors("example", "stackable", true);
    expect(errs.join("\n")).toMatch(/example[\s\S]*stackable=true[\s\S]*does NOT carry/);
  });

  it("fires when a kind the Stack DOES carry declares stackable:false", () => {
    // The opposite drift, and the one a "just make it consistent" edit invites:
    // silencing the guard by flipping the declaration on a kind that really does
    // round-trip would leave every derived consumer (float-snapshot's fixture
    // sweep, the docked affordances) skipping a live kind.
    const errs = withFacetErrors("note", "stackable", false);
    expect(errs.join("\n")).toMatch(/note[\s\S]*stackable=false[\s\S]*DOES carry/);
  });

  it("fires when a stackable kind is not poppable", () => {
    // The only capture path is a popped float's `snapshotForStack`, so a
    // stackable non-poppable kind could never reach the Stack at all.
    const errs = withFacetErrors("note", "poppable", false);
    expect(errs.join("\n")).toMatch(/note[\s\S]*stackable but not poppable/);
  });

  it("fires when two Stack kinds collapse onto one CardKind", () => {
    // The bridge is total over the vocabulary by TYPE, but nothing in the type
    // stops two members mapping to the same `CardKind` — and the derived inverse
    // map keeps only one, so the other's snapshots would be built under a name
    // no consumer resolves. The `bib` ↔ `bibliography` rename is exactly the
    // shape that invites this.
    const prior = CARD_KIND_BY_STACK_CARD_KIND.bibliography;
    CARD_KIND_BY_STACK_CARD_KIND.bibliography = "note";
    try {
      const errs = errorsFrom(assertStackCoverage);
      expect(errs.join("\n")).toMatch(/both map to card kind "note"/);
    } finally {
      CARD_KIND_BY_STACK_CARD_KIND.bibliography = prior;
    }
  });

  function withFacetErrors<K extends keyof (typeof CARD_REGISTRY)[CardKind]>(
    kind: CardKind,
    facet: K,
    value: (typeof CARD_REGISTRY)[CardKind][K],
  ): string[] {
    let errs: string[] = [];
    withFacet(kind, facet, value, () => {
      errs = errorsFrom(assertStackCoverage);
    });
    return errs;
  }
});

describe("the vocabulary bridge", () => {
  it("maps every Stack kind onto a real CardKind, injectively", () => {
    const seen = new Set<CardKind>();
    for (const s of STACK_CARD_KINDS) {
      const k = CARD_KIND_BY_STACK_CARD_KIND[s];
      expect(CARD_KINDS, `${s} → ${k}`).toContain(k);
      expect(seen.has(k), `${s} → ${k} (already claimed)`).toBe(false);
      seen.add(k);
      expect(stackCardKindFor(k)).toBe(s);
    }
  });

  it("`bib` is the ONE name the two vocabularies disagree on", () => {
    // Pinned because it is the reason the facet can't be derived from the kind
    // name, and the reason a hand-written `k === "bib" ? "bibliography" : k` kept
    // reappearing at call sites.
    const renamed = STACK_CARD_KINDS.filter(
      (s) => (CARD_KIND_BY_STACK_CARD_KIND[s] as string) !== s,
    );
    expect(renamed).toEqual(["bibliography"]);
    expect(stackCardKindFor("bib")).toBe("bibliography");
  });

  it("the registry facet and the vocabulary agree on every kind", () => {
    for (const k of CARD_KINDS) {
      expect(CARD_REGISTRY[k].stackable, `${k}`).toBe(isStackableCardKind(k));
    }
  });
});

describe("snapshotCard covers the whole vocabulary", () => {
  it.each([...STACK_CARD_KINDS])(
    "%s builds a card payload (never a silent null)",
    (cardKind) => {
      // Pre-259 this switch ended in `default: return null`, so a vocabulary
      // member with no case here produced NO stack item at all: the float's
      // drop gesture closed the window and nothing appeared on the Stack.
      const item = snapshotCard(cardKind, { key: "k", keys: [] }, { docId: "d" });
      expect(item).not.toBeNull();
      expect(item!.payload.kind).toBe("card");
      expect(
        (item!.payload as Extract<StackItem["payload"], { kind: "card" }>).card
          .cardKind,
      ).toBe(cardKind);
    },
  );
});

describe("every carried kind's PULL actually does something", () => {
  /**
   * The leg that catches the original shape. `applyCardDrop`'s switch was
   * non-exhaustive and the function returns void, so a kind with no branch —
   * or a branch left as a documented placeholder, which is what `example` had —
   * compiled, dispatched, and dropped the card on the floor. A `never` check
   * now covers the missing-branch half at compile time; this covers the
   * present-but-inert half, which no type can see.
   */
  const calls: string[] = [];
  const mainEditor = {} as unknown as import("@tiptap/react").Editor;
  const rec =
    (method: string) =>
    (...args: unknown[]) => {
      void args;
      calls.push(method);
      return { id: "new" } as never;
    };
  const stack: StackPullApi = {
    addNote: rec("addNote"),
    addHighlight: rec("addHighlight"),
    addTodo: rec("addTodo"),
    addArchive: rec("addArchive"),
    addRevisionComment: rec("addRevisionComment"),
    addRevisionSuggestion: rec("addRevisionSuggestion"),
    addCutterComment: rec("addCutterComment"),
    addCutterSuggestion: rec("addCutterSuggestion"),
    addFootnote: rec("addFootnote"),
    addCitation: rec("addCitation"),
    upsertBibEntry: rec("upsertBibEntry"),
    // A READ, not a factory: deliberately unrecorded, so the per-kind
    // derivations below stay a census of what a branch CREATES (task 235).
    getAnnotation: () => "",
    setAnnotation: rec("setAnnotation"),
  };
  const ctx = { mainEditor, stack } as unknown as DropCtx;
  const placement = {
    kind: "between-blocks",
    editor: mainEditor,
    insertPos: 0,
  } as unknown as Placement;

  beforeEach(() => {
    calls.length = 0;
  });

  it.each([...STACK_CARD_KINDS])("%s: the branch calls a REQUIRED factory", (cardKind) => {
    readStackItemMock.mockReturnValue({
      id: "item-1",
      capturedAt: "2026-07-31T00:00:00.000Z",
      source: { docId: null },
      payload: { kind: "card", card: { cardKind, data: { key: "k", keys: [] } } },
    } as unknown as StackItem);

    stackPullDropSpec.applyDrop(placement, "stack-pull:item-1", ctx);

    // `setAnnotation` is the one OPTIONAL member — a per-field enhancement, so a
    // branch that only called it would still lose the card on a host that
    // doesn't wire it. Require a real per-kind factory.
    expect(
      calls.filter((c) => c !== "setAnnotation"),
      `${cardKind}: the pull ran no StackPullApi factory — the card vanishes`,
    ).not.toHaveLength(0);
  });

  it("a card kind this build no longer carries is refused, not thrown on", () => {
    // `readEnvelope` validates the envelope and casts, so a persisted item from
    // another build can carry a retired kind (`example` is now one). The `never`
    // check is compile-time; the runtime arm must still return quietly.
    readStackItemMock.mockReturnValue({
      id: "item-1",
      capturedAt: "2026-07-31T00:00:00.000Z",
      source: { docId: null },
      payload: { kind: "card", card: { cardKind: "example", data: {} } },
    } as unknown as StackItem);

    expect(() =>
      stackPullDropSpec.applyDrop(placement, "stack-pull:item-1", ctx),
    ).not.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("the vocabulary itself", () => {
  it("has no member the app cannot round-trip", () => {
    // A canary on the whole design: the vocabulary is exactly the set of kinds
    // the registry declares stackable, with no allowlist standing between them.
    // (`assertContentCoverage` has an `allowedNull` set because "this kind
    // legitimately has no content" is a true statement; "this kind is stackable
    // but cannot be stacked" is not one, so there is nothing to carve out.)
    expect(new Set(CARD_KINDS.filter((k) => CARD_REGISTRY[k].stackable))).toEqual(
      new Set(STACK_CARD_KINDS.map((s) => CARD_KIND_BY_STACK_CARD_KIND[s])),
    );
    expect(STACK_CARD_KINDS).not.toContain("example" as StackCardKind);
  });
});
