/**
 * Unified orphan-detection plugin for Links.
 *
 * Phase 1+: absorbs the footnote orphan detector at
 * `tiptap-extensions.ts` lines 667–698 and `LinkedAnchorGuard` at
 * 1551–1597. Emits one event — `virgil-link-orphaned` with
 * `{ linkId, linkKind }` — replacing per-kind `virgil-footnote-orphaned`
 * and `virgil-anchor-orphaned`.
 *
 * Phase 0: stub. The legacy per-kind plugins still fire their own
 * events; feature hooks still listen per-kind.
 */

export const LINK_ORPHANED_EVENT = "virgil-link-orphaned";

export interface LinkOrphanedDetail {
  linkId: string;
  linkKind: "footnote" | "citation" | "anchor";
}
