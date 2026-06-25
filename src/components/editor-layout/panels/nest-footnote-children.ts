/**
 * nest-footnote-children — stamp `parentCardId` + reorder omni items so a
 * footnote-owned card nests under its footnote card (bib-under-cite style).
 *
 * PHASE 1 — citations only. A `\cite` that lives inside a footnote body is
 * tagged `nestedInFootnoteId` on the DocStructureObserver `CitationEntry`
 * (`structure.citations[].nestedInFootnoteId`, load-only `buildInitial`). That
 * datum is already in the structure snapshot — this module is PURE rendering
 * plumbing: it does NO doc walk. The host derives the
 * `citationId → footnoteId` map from the snapshot under a structural gate
 * (`useStructuralRevisions().citations`), so it never runs on a plain keystroke
 * (keystroke sanctity — see AGENTS.md "Card-source derivation").
 *
 * The transform is intentionally NOT containment: a nested cite stays a
 * STANDALONE omni item (it keeps cascading as its own card, sharing its host
 * footnote's `pos`). All this does is:
 *   1. stamp `parentCardId` = the footnote's omni-item id (the
 *      `cardPopKey("footnote", footnoteId)` key the footnote builder uses), so
 *      `OmniViewPanel` can indent it + route it to the footnote's filter
 *      category; and
 *   2. REORDER `items` so each child immediately follows its parent footnote
 *      item — the cascade's stable sort on equal `naturalTop` then preserves
 *      parent→child order (two nested cites under one footnote stay in order).
 *
 * Orphan fallback: a nested cite whose host footnote item is MISSING from
 * `items` (footnote deleted / not built) is left UNCHANGED (no `parentCardId`)
 * so it degrades to a normal flat card rather than dropping.
 *
 * PHASE 2 — DOCKED SURFACE (implemented below): the same `nestedInFootnoteId`
 * datum, applied to the kind-segregated docked Citations panel
 * (`buildNestedFootnoteInfoMap` + `partitionDockedCitations`). A footnote-nested
 * cite is pulled out of the flat docked list and rendered as an indented child
 * tagged with its host footnote — the docked analog of the omni nesting.
 *
 * NOT A CARD KIND — `\ref`: a `\ref` (the `labelRef` inline atom) does NOT
 * surface as a panel card anywhere (no `ref`/`labelRef` `CardKind`, no Ref
 * panel, no ref omni builder — `card-actions/ref.ts` is the inline-atom CREATE
 * action only). So although a `\ref` CAN now live inside a footnote body and
 * round-trips through the serializer, there is no ref card to nest. Refs are
 * intentionally out of scope here; only citations have a nestable card. Block
 * cards (examples) are likewise out — footnote bodies hold only inline content.
 */

import { cardPopKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import type { DocStructure } from "@/lib/tiptap/doc-structure/types";

/**
 * Pure: derive the `nestedChildId → footnoteId` map from a structure snapshot.
 *
 * PHASE 1: keyed by the citation's `id` (the citation node's `citationId`,
 * which is the SAME id space the omni citation builder keys its items by —
 * `popKey("citations", cit.id)`), valued by the host footnote's id. Only
 * citations carrying `nestedInFootnoteId` contribute.
 *
 * O(citations) and snapshot-derived — the CALLER must gate this behind a
 * structural counter (`useStructuralRevisions().citations`, which bumps on
 * citation add/remove/reorder AND on footnote-body edits) so it is not run per
 * keystroke. This function itself does no DOM/doc work.
 */
export function buildNestedFootnoteChildMap(
  structure: DocStructure,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const cit of structure.citations) {
    if (cit.nestedInFootnoteId) {
      map.set(cit.id, cit.nestedInFootnoteId);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// PHASE 2a — GENERALIZED container nesting (footnote OR example).
//
// Phase 1 nested a footnote-body `\cite` under its footnote card. Phase 2a
// generalizes "footnote owner" → "container owner": a `\cite` inside an
// EXAMPLE block nests under the example's omni card, with the IDENTICAL render
// treatment (16px indent, ordered under the parent). The owner fact is the
// generalized `CitationEntry.nestedInContainerId = { kind, id }` the load-only
// `buildInitial` pass stamps for BOTH kinds. This is still PURE rendering
// plumbing keyed off the snapshot — no doc walk; the host gates it on the same
// `useStructuralRevisions().citations` counter so it never runs per keystroke.
// ---------------------------------------------------------------------------

/** The kind of card a nested cite hangs under, and the CardKind whose omni key
 *  the container's card uses. */
type ContainerKind = "footnote" | "example";

/** A resolved nesting parent: the container kind + its address (the host
 *  footnote id, or the example block id = its `ExampleEntry.id`). */
export interface NestedContainer {
  kind: ContainerKind;
  /** Host footnote id, or example block id. */
  id: string;
}

/** The CardKind whose `cardPopKey` yields a container's omni-item id. */
function containerCardKind(kind: ContainerKind): "footnote" | "example" {
  // Footnote omni items key on `cardPopKey("footnote", footnoteId)`; example
  // omni items on `cardPopKey("example", exampleId)` (= `popKey("examples",…)`).
  return kind === "footnote" ? "footnote" : "example";
}

/**
 * Pure: derive `citationId → NestedContainer` from a structure snapshot — the
 * generalized (footnote OR example) counterpart of `buildNestedFootnoteChildMap`.
 * Only citations carrying `nestedInContainerId` contribute. Snapshot-derived,
 * O(citations); the CALLER gates it on `useStructuralRevisions().citations` (no
 * doc work, never per keystroke).
 */
export function buildNestedContainerChildMap(
  structure: DocStructure,
): Map<string, NestedContainer> {
  const map = new Map<string, NestedContainer>();
  for (const cit of structure.citations) {
    if (cit.nestedInContainerId) {
      map.set(cit.id, {
        kind: cit.nestedInContainerId.kind,
        id: cit.nestedInContainerId.id,
      });
    }
  }
  return map;
}

/**
 * Pure: the generalized analog of `nestFootnoteChildren` — stamp `parentCardId`
 * + reorder so each container-nested cite immediately follows its container's
 * omni item (footnote OR example card). Identical render treatment for both
 * kinds; identity-stable when nothing nests (returns the SAME `items` ref).
 *
 * Resolution: each child's omni id is `cardPopKey("citation", citId)`; its
 * parent's omni id is `cardPopKey(<container card kind>, containerId)`. A child
 * whose parent card is ABSENT from `items` (example/footnote deleted, owner
 * resolves null) is left UNCHANGED — it degrades to a flat top-level card
 * rather than dropping (graceful degradation, matching Phase 1).
 */
export function nestContainerChildren(
  items: OmniItem[],
  childToContainer: ReadonlyMap<string, NestedContainer>,
): OmniItem[] {
  if (childToContainer.size === 0) return items;

  // Index items by id for O(1) parent-existence checks.
  const byId = new Map<string, OmniItem>();
  for (const it of items) byId.set(it.id, it);

  // childItemId → parentItemId, and parentItemId → ordered childItemIds.
  const childItemToParentItem = new Map<string, string>();
  const parentToChildItems = new Map<string, string[]>();

  for (const [citId, container] of childToContainer) {
    const childItemId = cardPopKey("citation", citId);
    const parentItemId = cardPopKey(containerCardKind(container.kind), container.id);
    // Both the child cite card AND its container card must be present in the
    // current items for nesting to apply; otherwise leave the child flat.
    if (!byId.has(childItemId) || !byId.has(parentItemId)) continue;
    childItemToParentItem.set(childItemId, parentItemId);
    const arr = parentToChildItems.get(parentItemId);
    if (arr) arr.push(childItemId);
    else parentToChildItems.set(parentItemId, [childItemId]);
  }

  if (childItemToParentItem.size === 0) return items;

  // Stamp `parentCardId` on resolved children (new object, don't mutate input).
  const stamped = new Map<string, OmniItem>();
  for (const it of items) {
    const parentItemId = childItemToParentItem.get(it.id);
    stamped.set(
      it.id,
      parentItemId ? { ...it, parentCardId: parentItemId } : it,
    );
  }

  // Reorder: walk the original order; emit each non-child item once, and splice
  // a container's owned children in immediately after it.
  const childItemIds = new Set(childItemToParentItem.keys());
  const out: OmniItem[] = [];
  for (const it of items) {
    if (childItemIds.has(it.id)) continue;
    out.push(stamped.get(it.id)!);
    const ownedChildren = parentToChildItems.get(it.id);
    if (ownedChildren) {
      for (const childItemId of ownedChildren) {
        out.push(stamped.get(childItemId)!);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// DOCKED SURFACE — the same nesting fact, applied to the kind-segregated
// docked panels (Phase 2 / Part B + Phase 2a generalization).
//
// Omni threads every kind through ONE list, so a container-nested cite can sit
// directly beneath its footnote/example card there (`nestContainerChildren`
// above). The DOCKED surface lists each kind in its OWN panel (Footnotes panel,
// Examples panel, Citations panel), so the container card isn't present in the
// Citations panel to sit under. The faithful docked analog — sanctioned by the
// feature memo §4d / §5a ("suppressed from the flat docked Citations list +
// surfaced under the container") — keeps a nested cite in its HOME (Citations)
// panel but pulls it OUT of the flat top-level ordering and renders it as an
// indented child, tagged with its host container ("in footnote N" / "in example
// N"), grouped after the flat cites. This reuses the SAME snapshot-gated
// `nestedInContainerId` datum (no new doc walk) and the SAME 16px (`ml-4`)
// indent token as Omni, so the two surfaces stay unified. Phase 2a generalizes
// the original footnote-only path to ALSO cover example-nested cites, mirroring
// the omni `buildNestedContainerChildMap` generalization above.
// ---------------------------------------------------------------------------

/** The host-container context a docked nested cite carries for its label —
 *  generalized over footnote OR example (Phase 2a). */
export interface NestedContainerInfo {
  /** Which kind of container the cite lives inside. Drives the label
   *  ("in footnote N" vs "in example N") and the indent affordance. */
  kind: ContainerKind;
  /** Host container's address — the `footnoteId` (footnote) or the
   *  `ExampleEntry.id` (example), the same id its card is keyed by. */
  id: string;
  /** Host container's current display number, for the "in {kind} N" label —
   *  the footnote's numeric `number`, or the example's `number` (which can be a
   *  string label, e.g. "(3a)"). `null` when the container isn't in the
   *  snapshot (degrades to a numberless label rather than dropping the
   *  nesting). */
  number: string | number | null;
}

/** Back-compat alias — the original footnote-only docked info shape. Retained
 *  for any caller/test that still asks for the footnote-shaped value via
 *  `buildNestedFootnoteInfoMap`. */
export interface NestedFootnoteInfo {
  /** Host footnote's `footnoteId` (the same id the footnote card is keyed by). */
  footnoteId: string;
  /** Host footnote's current `number` attribute, for the "in footnote N"
   *  label. `null` when the footnote isn't in the snapshot (degrades to a
   *  numberless label rather than dropping the nesting). */
  footnoteNumber: number | null;
}

/**
 * Pure: derive `citationId → NestedContainerInfo` from a structure snapshot —
 * the generalized (footnote OR example) docked-surface counterpart of
 * `buildNestedContainerChildMap`, enriched with the host container's live
 * display number so the docked Citations panel can label a nested cite
 * "in footnote N" / "in example N" without taking a dependency on the Footnotes
 * or Examples panel's data. Only citations carrying `nestedInContainerId`
 * contribute.
 *
 * Number resolution: a footnote-kind cite resolves its number from
 * `structure.footnotes` (by id); an example-kind cite from `structure.examples`
 * (by id). A container missing from the snapshot yields `number: null` (the
 * cite still nests, just without a numeric label) — the degrade path.
 *
 * O(citations + footnotes + examples), snapshot-derived. The CALLER must gate
 * this behind the `useStructuralRevisions().citations` counter (which bumps on
 * footnote-/example-body edits too) so it never runs per keystroke. Does no
 * DOM/doc work.
 */
export function buildNestedContainerInfoMap(
  structure: DocStructure,
): Map<string, NestedContainerInfo> {
  const numberByFootnoteId = new Map<string, number>();
  for (const fn of structure.footnotes) numberByFootnoteId.set(fn.id, fn.number);
  const numberByExampleId = new Map<string, string | number | null>();
  for (const ex of structure.examples) numberByExampleId.set(ex.id, ex.number);

  const map = new Map<string, NestedContainerInfo>();
  for (const cit of structure.citations) {
    const container = cit.nestedInContainerId;
    if (!container) continue;
    const number =
      container.kind === "footnote"
        ? numberByFootnoteId.get(container.id) ?? null
        : numberByExampleId.get(container.id) ?? null;
    map.set(cit.id, { kind: container.kind, id: container.id, number });
  }
  return map;
}

/**
 * Pure: the footnote-only docked info map — the legacy back-compat shape,
 * keyed off `nestedInFootnoteId` (NOT the generalized `nestedInContainerId`),
 * so it stays byte-identical to the original even for a cite carrying only the
 * legacy field. Retained for any caller/test that still asks for the
 * footnote-only `{ footnoteId, footnoteNumber }` shape; the live docked
 * Citations panel now uses the generalized `buildNestedContainerInfoMap`.
 */
export function buildNestedFootnoteInfoMap(
  structure: DocStructure,
): Map<string, NestedFootnoteInfo> {
  const numberByFootnoteId = new Map<string, number>();
  for (const fn of structure.footnotes) numberByFootnoteId.set(fn.id, fn.number);

  const map = new Map<string, NestedFootnoteInfo>();
  for (const cit of structure.citations) {
    if (!cit.nestedInFootnoteId) continue;
    map.set(cit.id, {
      footnoteId: cit.nestedInFootnoteId,
      footnoteNumber: numberByFootnoteId.get(cit.nestedInFootnoteId) ?? null,
    });
  }
  return map;
}

/**
 * Pure: split an ordered docked-citations array into the flat (top-level) cites
 * and the container-nested children, preserving the input order WITHIN each
 * group. The nested group carries each cite's resolved info value so the panel
 * can render the "in footnote N" / "in example N" affordance. Generic over the
 * info value (`V`) so it serves both the generalized `NestedContainerInfo` and
 * the legacy `NestedFootnoteInfo` shapes.
 *
 * Identity-stable when nothing nests: returns the SAME `citations` reference as
 * `topLevel` (and an empty `nested`) so a doc with no nested cites pays zero
 * churn and the panel's memoized list stays cached.
 *
 * A cite tagged nested whose host container is GONE (not in `infoByCitationId`)
 * stays in `topLevel` — it degrades to a normal flat card rather than dropping,
 * matching the omni orphan-fallback.
 */
export function partitionDockedCitations<T extends { id: string }, V>(
  citations: readonly T[],
  infoByCitationId: ReadonlyMap<string, V>,
): { topLevel: readonly T[]; nested: Array<{ citation: T; info: V }> } {
  if (infoByCitationId.size === 0) {
    return { topLevel: citations, nested: [] };
  }
  const topLevel: T[] = [];
  const nested: Array<{ citation: T; info: V }> = [];
  for (const cit of citations) {
    const info = infoByCitationId.get(cit.id);
    if (info !== undefined) nested.push({ citation: cit, info });
    else topLevel.push(cit);
  }
  // Nothing actually resolved a present host → identity-stable passthrough.
  if (nested.length === 0) return { topLevel: citations, nested: [] };
  return { topLevel, nested };
}

/**
 * Pure: given the assembled omni `items` and a `childId → footnoteId` nesting
 * map, return a NEW array with:
 *   - `parentCardId` stamped on each child whose parent footnote item exists;
 *   - items reordered so each child immediately follows its parent footnote.
 *
 * Identity-stable when nothing nests: returns the SAME `items` reference if no
 * child resolved a present parent (so a doc with no footnote-nested cites pays
 * zero churn and downstream memos stay cached).
 *
 * The child id space is the OMNI-ITEM id of the citation card. The map is keyed
 * by the raw citation id; we resolve it to the citation's omni key via
 * `cardPopKey("citation", citId)` so we never have to re-derive item keys.
 *
 * PHASE 2a: this footnote-only entry point now DELEGATES to the generalized
 * `nestContainerChildren` (the single transform engine) by lifting the
 * `childId → footnoteId` map into the `{ kind:"footnote", id }` container shape.
 * Behavior is byte-for-byte the same for footnotes; the duplicated reorder/stamp
 * logic lives in ONE place. Retained so the Phase 1 callers/tests keep working.
 */
export function nestFootnoteChildren(
  items: OmniItem[],
  childToFootnoteId: ReadonlyMap<string, string>,
): OmniItem[] {
  if (childToFootnoteId.size === 0) return items;
  const containerMap = new Map<string, NestedContainer>();
  for (const [citId, footnoteId] of childToFootnoteId) {
    containerMap.set(citId, { kind: "footnote", id: footnoteId });
  }
  return nestContainerChildren(items, containerMap);
}
