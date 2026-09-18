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
 *  Mode B kinds (note / highlight / comment / suggestion /
 *  cutter-comment / cutter-suggestion) implement it; Mode A kinds may
 *  leave it unset. Implementations MUST be idempotent — a second call
 *  with the same `anchorId` is a no-op. See ACTION-MENU-DIAGNOSIS.md
 *  cluster C2. */
export interface CardLifecycle {
  clone(sourceId: string): string | null;
  delete(id: string): void | Promise<boolean>;
  bindAnchor?(
    id: string,
    paragraphId: string,
    anchorId: string,
    anchorText: string,
  ): void;
}

export type CardLifecycleRegistry = Partial<Record<CardKind, CardLifecycle>>;

/** Stable API surface read by consumers. The underlying registry can
 *  change identity each render without forcing a consumer re-render —
 *  `get` always reads the latest via a ref. */
export interface CardLifecycleApi {
  get(kind: CardKind): CardLifecycle | null;
}

/** Direct constructor for callers that own a registry but don't want the
 *  provider/consumer dance (e.g. `EditorPane` handing the API into a
 *  dispatcher hook). Identity is stable across renders; only the ref's
 *  payload changes, so the api object can be a useCallback/useMemo dep
 *  without cascading re-renders. */
export function useCardLifecycleApi(
  registry: CardLifecycleRegistry,
): CardLifecycleApi {
  const ref = useRef<CardLifecycleRegistry>(registry);
  ref.current = registry;
  return useMemo<CardLifecycleApi>(
    () => ({ get: (kind) => ref.current[kind] ?? null }),
    [],
  );
}

/** Dev-only: verify a per-doc lifecycle registry provides EXACTLY the ops the
 *  card registry declares (`CardMeta.lifecycle` — clone / delete / bindAnchor).
 *  A declared-but-unwired op — or a wired-but-undeclared one — is silent
 *  capability drift; this makes it loud. The all-false kinds fall in two
 *  groups: five explained gaps — 4 PERMANENT (todo / report / report-request →
 *  Mode-A paragraph-anchored; example → origin:derived mirror, R19) plus
 *  `archive` (R18: ratified NO cascade — survives anchor-paragraph deletion) —
 *  and the two `origin:"system"` kinds `bib`/`error`, trivially all-false (no
 *  user clone/delete/anchor affordance). A3 DOCUMENTS the
 *  cascade-vs-UI-delete criterion (see `CardLifecycleCapability`); it does not
 *  fill them. The E-4 criterion test pins the gaps.
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
    const has = { clone: !!e?.clone, delete: !!e?.delete, bindAnchor: !!e?.bindAnchor };
    if (
      declared.clone !== has.clone ||
      declared.delete !== has.delete ||
      declared.bindAnchor !== has.bindAnchor
    ) {
      console.error(
        `[CardLifecycle] "${k}": registry declares ${JSON.stringify(declared)} ` +
          `but the provider has ${JSON.stringify(has)}`,
      );
    }
  }
}
