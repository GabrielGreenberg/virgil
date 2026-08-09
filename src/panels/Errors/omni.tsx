"use client";

import type { LatexError } from "@/lib/latex-errors";
import { cardPopKey } from "@/panels/panel-registry";
import type { OmniItem } from "@/panels/_shared/types";
import { resolveAnchorState } from "@/links/anchor-state";
import { ErrorCard, errorTitle } from "./ErrorCard";
import type { ErrorJump } from "./error-jump";

interface BuildArgs {
  errors: LatexError[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  /** Maps `err.id` → paragraph anchor uuid (when the error's source line
   *  was resolved to a paragraph). Used to look up the omni item's `pos`. */
  paragraphByErrorId: Map<string, string>;
  /** Source-snippet preview, keyed by `err.id`. */
  snippets: Map<string, string>;
  anchoredIds: Set<string>;
  dismissedIds: Set<string>;
  onDismiss: (id: string) => void;
  /** The omni mirror is a VISUAL mount, so it forwards the same `"anchor"`
   *  capability the docked panel does (task 125) — handler + semantics
   *  together, straight from `useDiagnostics`. */
  jump: ErrorJump;
  findParagraphPos: (uuid: string | null) => number | null;
  /** Panel-local expansion for errors (R5: `error` is non-anchored, so it has
   *  no shared-cardStore slot — the omni host owns this surface's expand set,
   *  independent of selection). */
  expandedIds: Set<string>;
  onExpand: (id: string) => void;
  onToggleExpanded: (id: string) => void;
}

/** Build OmniItems for LaTeX errors. Anchors errors whose source line
 *  resolved to a paragraph; surfaces the rest as unanchored. Dismissed
 *  errors are skipped (matches ErrorsPanel's visibility filter). */
export function buildErrorOmniItems(a: BuildArgs): OmniItem[] {
  const items: OmniItem[] = [];

  for (const err of a.errors) {
    if (a.dismissedIds.has(err.id)) continue;
    const isSelected = a.selectedId === err.id;
    const omniId = cardPopKey("error", err.id);
    const paraId = a.paragraphByErrorId.get(err.id) ?? null;
    const pos = a.findParagraphPos(paraId);
    // No resolved source paragraph ⇒ the error carries deliberate-free intent
    // (`free`). A resolved paragraph that no longer maps to a live pos ⇒
    // orphaned; a live pos ⇒ anchored. The free-condition (`paraId == null`) is
    // threaded through the SSOT as `unanchored` so the 3-way lives in
    // `resolveAnchorState`, not an inline formula.
    const anchorState = resolveAnchorState(pos, { unanchored: paraId == null });

    items.push({
      id: omniId,
      pos,
      // Paragraph-anchored errors enroll in the SAME live-pos engine as every
      // other paragraph-anchored omni kind (note/todo/report): `anchorUuid`
      // lets `buildParagraphAnchorMap`/`useLivePosResolver` re-resolve a LIVE
      // position from the DocStructureObserver snapshot each transaction, so an
      // edit in an earlier paragraph no longer leaves the error on a STALE
      // baked `pos` (OMNI-F1-02) that mis-bins it in a collapsed section or the
      // focus band. `free` errors (`paraId == null`) carry no anchor intent, so
      // they get no `anchorUuid` and keep `pos: null` — unchanged.
      anchorUuid: paraId ?? undefined,
      anchorState,
      content: (
        <ErrorCard
          key={omniId}
          err={err}
          title={errorTitle(err)}
          snippet={a.snippets.get(err.id)}
          selected={isSelected}
          expanded={a.expandedIds.has(err.id)}
          onExpand={() => a.onExpand(err.id)}
          onToggleExpanded={() => a.onToggleExpanded(err.id)}
          hasAnchor={a.anchoredIds.has(err.id)}
          jumpMode={a.jump.mode}
          onSelect={a.setSelectedId}
          onJump={() => a.jump.jump(err)}
          onDismiss={a.onDismiss}
          extraDataAttrs={{ "data-omni-entry": omniId }}
        />
      ),
    });
  }

  return items;
}
