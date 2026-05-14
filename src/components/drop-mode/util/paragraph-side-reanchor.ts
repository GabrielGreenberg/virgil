/**
 * Generic factory for paragraph-side re-anchor specs.
 *
 * All attachment-card kinds (note, todo, quotation, archive, cutter
 * comment, cutter suggestion, revision, revision suggestion) share the
 * same drop-mode shape: a vertical gutter bar alongside the target
 * paragraph; on release, re-anchor the card to that paragraph; if it
 * was already anchored to a different one, confirm first.
 *
 * Each panel calls this factory with its kind label (used in the modal
 * copy) and a getter that pulls its `ParagraphAnchorApi` sub-bag off
 * the `DropCtx`. The resulting spec is registered in
 * `drop-mode/registry.ts`.
 */

import { removeLinkedAnchor } from "@/links/links";
import type { DropCtx, DropSpec, ParagraphAnchorApi } from "../types";

export interface ParagraphSideSpecOptions {
  /** Human label shown in the confirm modal ("note", "todo", …). */
  kindLabel: string;
  /** Pulls the relevant sub-bag off the per-doc DropCtx. Returning
   *  undefined → spec silently no-ops (e.g. Reader mode). */
  getApi: (ctx: DropCtx) => ParagraphAnchorApi | undefined;
}

export function paragraphSideReanchorSpec(
  opts: ParagraphSideSpecOptions,
): DropSpec {
  return {
    allowedPlacements: ["paragraph-side"],
    targetScope: "main-only",
    classifyDrop(placement, cardKey, ctx) {
      if (placement.kind !== "paragraph-side") return { kind: "no-op" };
      const api = opts.getApi(ctx);
      if (!api) return { kind: "no-op" };
      const id = extractId(cardKey);
      if (!id || !api.exists(id)) return { kind: "no-op" };
      const current = api.getAnchorParagraphIds(id);
      if (current.length === 1 && current[0] === placement.paragraphId) {
        return { kind: "no-op" };
      }
      if (current.length === 0) {
        return { kind: "apply" };
      }
      return {
        kind: "confirm",
        title: `Re-anchor this ${opts.kindLabel}?`,
        message: `This ${opts.kindLabel} is currently anchored to a different paragraph. Re-anchor to this paragraph instead?`,
        confirmLabel: "Re-anchor",
      };
    },
    applyDrop(placement, cardKey, ctx) {
      if (placement.kind !== "paragraph-side") return;
      const api = opts.getApi(ctx);
      if (!api) return;
      const id = extractId(cardKey);
      if (!id || !api.exists(id)) return;
      // Phase 4: if the card carries a Mode B textRange anchor, snapshot
      // it onto `card.originalAnchor` BEFORE remove+add wipes the link.
      // Then strip the corresponding linkedAnchor mark from the editor
      // so the orphaned tint doesn't linger over text the card no longer
      // points at. Mark cleanup uses the main editor — Mode B anchors
      // live in the main doc by construction (a card-body linkedAnchor
      // mark wouldn't have been the anchor for a main-doc-anchored
      // card).
      const strippedAnchorId = api.preserveModeBAnchor?.(id) ?? null;
      if (strippedAnchorId && ctx.mainEditor) {
        try {
          removeLinkedAnchor(ctx.mainEditor, strippedAnchorId);
        } catch {
          // The mark might already be gone (orphaned); ignore.
        }
      }
      const current = api.getAnchorParagraphIds(id);
      for (const pid of current) {
        if (pid !== placement.paragraphId) {
          api.removeParagraphLink(id, pid);
        }
      }
      if (!current.includes(placement.paragraphId)) {
        api.addParagraphLink(id, placement.paragraphId);
      }
    },
    postDrop: "keep",
  };
}

function extractId(cardKey: string): string | null {
  const sep = cardKey.indexOf(":");
  return sep > 0 ? cardKey.slice(sep + 1) : null;
}
