/**
 * Generic factory for paragraph-side re-anchor specs.
 *
 * All attachment-card kinds (note, todo, report, archive, cutter
 * comment, cutter suggestion, revision, revision suggestion) share the
 * same drop-mode shape: a vertical margin bar alongside the target
 * paragraph; on release, re-anchor the card to that paragraph — moving
 * it from any paragraph it was anchored to before, without a confirm
 * (task 1423: a reversible move asks nothing).
 *
 * Each panel calls this factory with a getter that pulls its
 * `ParagraphAnchorApi` sub-bag off the `DropCtx`. The resulting spec is registered in
 * `drop-mode/registry.ts`.
 */

import {
  removeLinkedAnchor,
  captureParagraphSnapshot,
  getLinkedTextObjectIds,
} from "@/links/links";
import { buildCardAnchorPass } from "@/links/card-anchor-rows";
import { parseAnyKey } from "@/floats/float-key";
import type { DropCtx, DropSpec, ParagraphAnchorApi } from "../types";

export interface ParagraphSideSpecOptions {
  /** Pulls the relevant sub-bag off the per-doc DropCtx. Returning
   *  undefined → spec silently no-ops (e.g. Reader mode). */
  getApi: (ctx: DropCtx) => ParagraphAnchorApi | undefined;
}

export function textObjectSideReanchorSpec(
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
      // "Already there?" is asked of the AUTHORITY (task 1506): the block the
      // card is anchored on NOW. Its stored pids are a record — a moved Mode-B
      // highlight's birth block among them — so reading them here ignored a
      // drop on the birth block as "already there" while the card sat
      // elsewhere. O(doc) once, at release (classifyDrop is a commit-time
      // decision, never per pointer move).
      const card = api.getCard(id);
      const live = card ? buildCardAnchorPass(ctx.mainEditor).anchorBlocksOf(card) : [];
      if (live.length === 1 && live[0] === placement.paragraphId) {
        return { kind: "no-op" };
      }
      // A card anchored elsewhere MOVES — no confirm (task 1423). The move is
      // reversible (drag it back) and destroys nothing: a Mode-B range anchor
      // is converted, not lost (`applyDrop` below keeps the captured passage
      // and snapshots `originalAnchor`). A drop spec may `confirm` only a drop
      // that destroys content, and only with `tone: "danger"` — the policy
      // `drop-confirm-policy-census.test.ts` pins. Gabriel: "Don't prompt with
      // a dialogue box on moving an anchor."
      return { kind: "apply" };
    },
    applyDrop(placement, cardKey, ctx) {
      if (placement.kind !== "paragraph-side") return false;
      const api = opts.getApi(ctx);
      if (!api) return false;
      const id = extractId(cardKey);
      if (!id || !api.exists(id)) return false;
      // Phase 4: if the card carries a Mode B textRange anchor, snapshot
      // it onto `card.originalAnchor` BEFORE remove+add wipes the link
      // (note/highlight only — the kinds whose type records one).
      const preservedAnchorId = api.preserveModeBAnchor?.(id) ?? null;
      // RC1 / task 698: a paragraph re-anchor MOVES the card, so its old
      // Mode-B anchor is RELEASED — the surviving `linkedRange` link is
      // converted to a clean Mode-A `paragraph` link BEFORE the fresh anchor
      // lands (otherwise `addTextObjectLink` folds P_new into the dead
      // textRange link, dropping the snapshot, and the card reverts to the old
      // paragraph on reload). Every adapter must answer this (`modeB` is
      // required); only an INTRINSICALLY Mode-B kind (highlights) keeps its
      // link, and says why at its own site. The captured passage is left
      // alone: a re-anchor is not a re-capture.
      const releasedAnchorId =
        api.modeB.policy === "release" ? api.modeB.release(id) : null;
      // Strip the corresponding linkedAnchor mark from the editor so the
      // orphaned tint doesn't linger over text the card no longer points at.
      // Mark cleanup uses the main editor — Mode B anchors live in the main
      // doc by construction (a card-body linkedAnchor mark wouldn't have been
      // the anchor for a main-doc-anchored card).
      const strippedAnchorId = releasedAnchorId ?? preservedAnchorId;
      if (strippedAnchorId && ctx.mainEditor) {
        try {
          removeLinkedAnchor(ctx.mainEditor, strippedAnchorId);
        } catch {
          // The mark might already be gone (orphaned); ignore.
        }
      }
      // The WRITE removes stored links, so it reads the stored pids — the only
      // thing `removeTextObjectLink` can remove.
      const card = api.getCard(id);
      const current = card ? getLinkedTextObjectIds(card) : [];
      for (const pid of current) {
        if (pid !== placement.paragraphId) {
          api.removeTextObjectLink(id, pid);
        }
      }
      if (!current.includes(placement.paragraphId)) {
        // Capture the target paragraph's text so the fresh Mode-A link is
        // self-healing: if this just-minted paragraph UUID never reaches
        // the `.tex` (the 1500 ms autosave loses the race to a reload),
        // the reload reconciler re-finds the paragraph by this snapshot
        // instead of silently orphaning the card. `ctx.mainEditor` is the
        // SSOT for the live target paragraph's text.
        const snapshot = captureParagraphSnapshot(
          ctx.mainEditor,
          placement.paragraphId,
        );
        // The drop placement is always paragraph-side → targetKind "paragraph".
        api.addTextObjectLink(id, placement.paragraphId, "paragraph", snapshot);
      }
      return true;
    },
    postDrop: "keep",
  };
}

function extractId(cardKey: string): string | null {
  // Colon-safe via the dual-read parser (handles `float:card:<kind>:<id>` and
  // the legacy `<prefix>:<id>` shape).
  return parseAnyKey(cardKey)?.id ?? null;
}
