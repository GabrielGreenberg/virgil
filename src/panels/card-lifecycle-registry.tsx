"use client";

/**
 * Per-CardKind lifecycle SSOT. Sister of [panel-registry.ts](./panel-registry.ts).
 * Mirrors the
 * `registerFloatBody` / `floatBodyComponent` slot pattern in
 * [src/text-objects/text-object-registry.ts](../text-objects/text-object-registry.ts).
 *
 * Unlike the float-body registry (module-global, single-shot at boot),
 * card lifecycle ops are PER-DOC — each sidecar hook is per-document, so
 * the registry is built per pane and handed in. It has exactly ONE door,
 * `useCardLifecycleApi`: it holds the live map in a ref, so the API object
 * is identity-stable while its payload moves, and the dispatcher reads
 * `get(kind)` at click time and always sees the current document's ops.
 *
 * ONE DOOR, stated because there used to be two. A React-context half
 * (`CardLifecycleProvider` + `useCardLifecycle`) shipped beside it and was
 * never called — `EditorPane` builds the registry and constructs the API
 * directly, since the only consumers are hooks it already owns, not a
 * distant subtree. The header above described the context path in the
 * present tense for months ("the registry flows through React context";
 * "add one entry in EditorPane's `CardLifecycleProvider value={…}`") while
 * no provider existed anywhere in the app — the same defect shape task 634
 * killed on the panel registry. Both exports are gone (task 635), and this
 * module is now in `card-spine-export-census.test.ts`'s population, so a
 * second unread door cannot be re-published quietly. If a distant subtree
 * ever needs the API, thread it or add a provider THEN.
 *
 * Adding a new card kind:
 *   1. Make sure the kind is in `CardKind` (it already is — this is just
 *      a behavior slot, not a type extension).
 *   2. Ensure the per-doc hook (e.g. `useFootnotes`) exposes a `clone(id)`
 *      and a `delete(id)`.
 *   3. Declare the ops on the kind's `CARD_REGISTRY` row (`lifecycle`), and
 *      add one entry to EditorPane's `cardLifecycleRegistry` memo. The two
 *      must agree exactly: `assertLifecycleCoverage` says so at dev runtime
 *      and `lifecycle-coverage-assertion.test.ts` says so in CI, by reading
 *      that memo's literal out of `EditorPane.tsx`.
 *
 * The drag-handle dispatcher's duplicate/delete walkers ([src/text-objects/duplicate-slice.ts](../text-objects/duplicate-slice.ts),
 * [src/text-objects/delete-range.ts](../text-objects/delete-range.ts)) iterate
 * the doc and call `get(kind)?.clone(id)` / `.delete(id)`. They contain
 * zero per-kind branches; an unregistered kind is a silent no-op.
 */

import { useMemo, useRef } from "react";
import type { CardKind } from "./_shared/types";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { panelForCardKind } from "@/cards/predicates";
import type { PristineCardManager } from "@/hooks/usePristineCardManager";
import type { CarryCard } from "@/hooks/useDormantRevival";

/** A delete that CAN decline — resolves `false` when the lifecycle executor's
 *  SETTLE prompt was cancelled and the card survives (task 238). Every
 *  `makeUnbridgingDelete` composition has this shape. Named once so a table
 *  whose caller ACTS on the answer (`deleteMarginItem` strips the inline mark
 *  only on a commit) can demand it: a `(id) => void` assigned there is a type
 *  error, not a delete whose refusal is silently read as success (task 1119). */
export type DeclinableCardDelete = (id: string) => Promise<boolean>;

/** Per-kind lifecycle operations.
 *
 *  `clone(sourceId)` returns the new id, or null if the source id was
 *  not found (or the kind opts out of clone).
 *
 *  `delete(id)` REPORTS WHETHER IT COMMITTED (task 636). It used to be
 *  declared `void` and documented as fire-and-forget, which was true until the
 *  SETTLE obligation made a delete declinable: `makeUnbridgingDelete` returns
 *  `Promise<boolean>`, and `Promise<boolean>` is assignable wherever `void`
 *  was, so the registry went on promising a delete that always happens while
 *  wiring five kinds whose delete can refuse. The range walker believed the
 *  declaration and deleted the user's text beside a prompt that had not been
 *  answered yet. The type now says the truth; the walkers' actual guarantee is
 *  structural — `settleRangeCardObligations` discharges every declinable
 *  obligation over a range BEFORE the walk fires any delete (see
 *  [delete-range.ts](../text-objects/delete-range.ts)).
 *
 *  `bindAnchor(id, paragraphId, anchorId, anchorText)` re-attaches a
 *  Mode B text-range anchor to a card. The duplicate dispatcher calls
 *  this on the freshly-cloned card after the clone slice lands, so the
 *  clone's `links[]` points at its own `linkedAnchor` mark (which
 *  carries a freshly-minted anchorId) and card→editor jump-to works.
 *  WHICH KINDS IMPLEMENT IT IS DERIVED, NOT LISTED: exactly the kinds
 *  `carriesModeBAnchor` answers true for (`@/cards/mode-b-collections`,
 *  itself derived from `anchored` + the crosswalk's `legacyDataKind`).
 *  This doc used to enumerate six of them by hand and that list went
 *  stale — it named neither todo nor the two report kinds, all three of
 *  which carry the mark (task 721). Implementations MUST be idempotent —
 *  a second call with the same `anchorId` is a no-op. See
 *  ACTION-MENU-DIAGNOSIS.md cluster C2. */
export interface CardLifecycle {
  clone(sourceId: string): string | null;
  /** `void` for a kind whose delete cannot refuse (footnote, citation); a
   *  {@link DeclinableCardDelete} otherwise. */
  delete(id: string): void | ReturnType<DeclinableCardDelete>;
  bindAnchor?(
    id: string,
    paragraphId: string,
    anchorId: string,
    anchorText: string,
  ): void;
  /** ARCHIVE-CARRY (task 1194): an archive capture took the text `keys` names
   *  into snippet `snippetId`. The card is not deleted — those links go
   *  DORMANT (`@/links/dormant` `markDormant`) and come back when the snippet
   *  is restored. Not an ending event: nothing is settled or unbridged. Only
   *  the kinds whose `CARD_REGISTRY` row declares `lifecycle.carry` wire it;
   *  every other kind keeps `delete` (atoms) or the Mode-A re-home (archive). */
  carry?: CarryCard;
}

export type CardLifecycleRegistry = Partial<Record<CardKind, CardLifecycle>>;

/** Stable API surface read by consumers. The underlying registry can
 *  change identity each render without forcing a consumer re-render —
 *  `get` always reads the latest via a ref. */
export interface CardLifecycleApi {
  get(kind: CardKind): CardLifecycle | null;
}

/** **Does an ARCHIVE carry this kind's cards with the passage?** (task 1270)
 *  The ONE travel question every leg of the capture asks — the Mode-A re-home's
 *  `keep`, the Mode-A carry, the Mode-B mark record and the range card half —
 *  so a card is always exactly one of carried (dormant, recorded by its links)
 *  or re-homed / deleted (the 491 / 393 answers), never neither. It asks what
 *  the kind DECLARES (`CARD_REGISTRY[kind].lifecycle.carry`) AND what this
 *  host has WIRED: a kind declared to travel in a host whose table lacks the op
 *  takes the non-travelling answer rather than being skipped by one leg and
 *  dropped by another. (The mismatch itself is `assertLifecycleCoverage`'s.) */
export function cardKindTravels(kind: CardKind, lifecycle: CardLifecycleApi): boolean {
  return CARD_REGISTRY[kind]?.lifecycle.carry === true && !!lifecycle.get(kind)?.carry;
}

/** The ONE door to a pane's card lifecycle ops (see the file header):
 *  `EditorPane` builds the per-doc registry and hands the API this returns
 *  into its dispatcher hooks. Identity is stable across renders; only the ref's
 *  payload changes, so the api object can be a useCallback/useMemo dep
 *  without cascading re-renders. */
export function useCardLifecycleApi(
  registry: CardLifecycleRegistry,
  pristine?: PristineCardManager | null,
): CardLifecycleApi {
  const ref = useRef<CardLifecycleRegistry>(registry);
  ref.current = registry;
  const pristineRef = useRef<PristineCardManager | null>(pristine ?? null);
  pristineRef.current = pristine ?? null;
  return useMemo<CardLifecycleApi>(
    () => ({
      get: (kind) => {
        const ops = ref.current[kind] ?? null;
        const manager = pristineRef.current;
        if (!ops || !manager) return ops;
        return withPristineClone(ops, kind, manager);
      },
    }),
    [],
  );
}

/** PRISTINE-NESS TRAVELS WITH THE CLONE (task 960). A card created blank is
 *  registered pristine so a click-away discards it; a clone of it is just as
 *  blank, so it must be just as discardable. This is the ONE door every
 *  duplicate walker clones through, so the rule is stated here once rather
 *  than re-decided (or forgotten) in each hook's `clone*` — before this, every
 *  `clone*` copied the card and none consulted the tracker, so the source was
 *  swept on click-away and its empty twin persisted in the sidecar forever.
 *  The bucket is the owning panel (`panelForCardKind`, the same derivation
 *  `EditorPane` uses to hand each hook its tracker), so the clone lands in the
 *  very Set the source's own discard sweep reads. A clone of a COMMITTED
 *  source is untouched. */
function withPristineClone(
  ops: CardLifecycle,
  kind: CardKind,
  manager: PristineCardManager,
): CardLifecycle {
  const bucket = panelForCardKind(kind);
  if (!bucket) return ops;
  const tracker = manager.forKind(bucket);
  return {
    ...ops,
    clone: (sourceId) => {
      const id = ops.clone(sourceId);
      if (id && tracker.isPristine(sourceId)) tracker.markNew(id);
      return id;
    },
  };
}

/** Dev-only: verify a per-doc lifecycle registry provides EXACTLY the ops the
 *  card registry declares (`CardMeta.lifecycle` — clone / delete / bindAnchor).
 *  A declared-but-unwired op — or a wired-but-undeclared one — is silent
 *  capability drift; this makes it loud.
 *
 *  WHICH KINDS ARE ALL-FALSE IS NOT ENUMERATED HERE. It is derived, and
 *  `lifecycle-cascade-criterion.test.ts` derives it: a kind is cascade-capable
 *  exactly when a walker can REACH it — it rides an inline atom
 *  (footnote / citation) or it carries a Mode-B text-range mark
 *  (`carriesModeBAnchor`). Everything else is all-false because nothing walks
 *  over it: `archive` (R18 — anchored but mark-less, so it survives its
 *  anchor paragraph's deletion), `example` (R19 — an origin:derived mirror of
 *  its exampleBlock TextObject), and the non-anchored system kinds
 *  `bib` / `error` / `ai`. This paragraph used to carry a hand-written list
 *  instead, and it was the SECOND copy of the rationale task 721 had to
 *  correct: it called todo / report / report-request permanent gaps on a
 *  premise their own registry rows had borrowed and the derivation refutes.
 *  Say what the criterion is; never re-list who satisfies it.
 *
 *  Call from the site that builds the registry (`EditorPane`), right beside
 *  `useCardLifecycleApi`. This fires on every dev render, so drift is loud
 *  within minutes of an author touching either side — but it is dev-only and
 *  its subject is a component-local literal, so CI could never see it. That
 *  half is `lifecycle-coverage-assertion.test.ts`'s "real registry" leg, which
 *  reads the memo's literal out of `EditorPane.tsx` and runs the same
 *  comparison at build time. */
export function assertLifecycleCoverage(registry: CardLifecycleRegistry): void {
  if (process.env.NODE_ENV === "production") return;
  for (const k of Object.keys(CARD_REGISTRY) as CardKind[]) {
    const declared = CARD_REGISTRY[k].lifecycle;
    const e = registry[k];
    const has = {
      clone: !!e?.clone,
      delete: !!e?.delete,
      bindAnchor: !!e?.bindAnchor,
      carry: !!e?.carry,
    };
    if (
      declared.clone !== has.clone ||
      declared.delete !== has.delete ||
      declared.bindAnchor !== has.bindAnchor ||
      declared.carry !== has.carry
    ) {
      console.error(
        `[CardLifecycle] "${k}": registry declares ${JSON.stringify(declared)} ` +
          `but the provider has ${JSON.stringify(has)}`,
      );
    }
  }
}
