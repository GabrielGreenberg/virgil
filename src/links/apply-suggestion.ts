/**
 * Phase 0 — the pure, headless, client-side AI-change applicator.
 *
 * Splices an AI suggestion into the LIVE TipTap doc and wraps the changed
 * region in a light-blue `pending-ai-change` `linkedAnchor` mark, so the user
 * can Keep (finalize) or Revert (undo) it later from the UI (built in a later
 * phase). This module is intentionally UI-free and React-free: just three pure
 * functions over an `Editor` plus the minimal shared-SSOT it needs.
 *
 * It is the in-browser mirror of the headless `editor/scripts/apply_response.py`
 * `_replace_span_in_tex` splice. To keep the two from drifting, the stale guard
 * here ports that function's verbatim-match contract exactly:
 *
 *   - serialize the anchored paragraph's inline content to LaTeX,
 *   - require `originalText` to appear VERBATIM (exact substring, byte-for-byte)
 *     in that serialization — otherwise refuse, untouched, with
 *     `{ ok: false, reason: "stale" }`,
 *   - splice the FIRST verbatim occurrence only (the Python's `str.find` +
 *     single replace),
 *   - re-parse the WHOLE spliced paragraph inline string (never prefix/suffix
 *     separately) and replace the paragraph's inner content in one PM tx,
 *     preserving the block node and its `uuid`.
 *
 * Because the serialization includes the inline `\vcid{…}` / `\vfid{…}` /
 * `\vlid{…}` markers, an `originalText` that was clipped mid-marker can't match
 * verbatim — so the stale guard ALSO naturally refuses a marker-straddling span.
 *
 * That protects the READ span. The WRITE span is guarded symmetrically: a
 * `replacement` is refused (same `{ ok:false, reason:"stale" }`, doc untouched)
 * when it CONTAINS any internal marker token (`containsInternalMarker`), because
 * concatenating one into the paragraph serialization and reparsing it would mint
 * a phantom `linkedAnchor` / citation / footnote atom that no card owns. Both
 * sides of the splice thus refuse suspicious marker text — the applicator only
 * ever reparses marker text it emitted itself.
 *
 * REUSE, don't reinvent: `findNodeByUuid` + `editStructuredNodeByUuid`
 * (structural-edit.ts) address + replace the paragraph by uuid;
 * `serializeParagraphInline` (latex-serializer.ts) + `parseInlineContent`
 * (latex-parser.ts) are the round-trip pair; `reanchorByText` +
 * `removeLinkedAnchor` (links.ts) stamp / unstamp the blue mark.
 */

import type { Editor, JSONContent } from "@tiptap/react";
import type { Fragment, Node as PMNode } from "@tiptap/pm/model";
import {
  findNodeByUuid,
  editStructuredNodeByUuid,
} from "@/lib/tiptap/structural-edit";
import {
  serializeParagraphInline,
  containsInternalMarker,
} from "@/lib/latex-serializer";
import {
  parseInlineContent,
  applyLinkedAnchorBoundaries,
} from "@/lib/latex-parser";
import { reanchorByText, removeLinkedAnchor } from "@/links/links";
import { defaultTintForLinkedAnchorKind } from "@/cards/legacy-token-crosswalk";

/** Replace a span with new text, or (replacement === "") delete it. A `delete`
 *  is just a `replace` whose replacement is empty, but the apply/keep split
 *  differs (see below), so the caller names the intent explicitly. */
export type ApplyMode = "replace" | "delete";

/** Which suggestion family the applied change belongs to — the EXPLICIT
 *  `data-link-card` token (card IDENTITY) stamped on the blue mark. Both families
 *  share the single `pending-ai-change` kind (which drives tint/behaviour only),
 *  so the family is NOT recoverable from the kind: it must be threaded from the
 *  host/hook that owns the card (revisions → "revision-suggestion", cutter →
 *  "cutter-suggestion"). Threading it keeps the in-text mark's token in lockstep
 *  with the gutter marker + panel/omni card so the three-surface hover halo
 *  resolves for BOTH families. */
export type PendingChangeFamily = "revision-suggestion" | "cutter-suggestion";

export interface ApplyArgs {
  /** The uuid of the paragraph the suggestion is anchored to. */
  anchorUuid: string;
  /** The verbatim span (in the paragraph's inline-LaTeX serialization) the
   *  suggestion replaces / deletes. Must match byte-for-byte or we refuse. */
  originalText: string;
  /** The replacement text. Empty string for a pure deletion (mode "delete"). */
  replacement: string;
  mode: ApplyMode;
  /** The owning card's id — stamped into the mark's `linkCard` token so the
   *  mark is self-describing. */
  cardId: string;
  /** The anchorId to stamp on the `linkedAnchor` mark (so Keep / Revert can
   *  resolve the exact range later). */
  anchorId: string;
  /** The owning suggestion family — drives the `linkCard` token (card IDENTITY)
   *  so a cutter pending mark tokens `cutter-suggestion:<id>`, not the
   *  kind-folded `revision-suggestion:<id>`. */
  family: PendingChangeFamily;
}

export type ApplyResult =
  | { ok: true; anchorId: string }
  | { ok: false; reason: "stale" };

/** The legacy `linkedAnchor.kind` namespace value for a pending AI change. */
const PENDING_KIND = "pending-ai-change" as const;

/**
 * The blue tint the pending mark paints, single-sourced from the crosswalk so
 * apply / keep / revert and any later reload re-stamp all agree.
 */
const PENDING_TINT = defaultTintForLinkedAnchorKind(PENDING_KIND);

/** The `linkedAnchor` mark attrs we round-trip through the serialize → splice →
 *  reparse cycle. The `\vlid{id}` marker the serializer emits carries ONLY the
 *  anchorId, so the reparse alone can't recover `kind` / `tintColor` /
 *  `linkCard` / `linkId` / `linkKind` — those are captured from the LIVE
 *  paragraph (keyed by anchorId) before serializing and re-applied after the
 *  boundary resolver re-stamps the range. */
type LinkedAnchorAttrs = Record<string, unknown>;

/**
 * Snapshot every distinct live `linkedAnchor` mark on a paragraph node, keyed by
 * its `anchorId`. This is the fidelity side-channel for the serialize → splice →
 * reparse round-trip: the `.tex` `\vlid{id}` marker holds only the id, so we
 * preserve the rich attrs (tint / card / kind) out-of-band and re-apply them to
 * the resolved marks after reparse. First-seen wins per id (a single anchor's
 * runs all share one attr set).
 */
function captureLiveAnchorAttrs(node: PMNode): Map<string, LinkedAnchorAttrs> {
  const byId = new Map<string, LinkedAnchorAttrs>();
  node.descendants((child) => {
    if (!child.isText) return true;
    for (const m of child.marks) {
      if (m.type.name !== "linkedAnchor") continue;
      const id = m.attrs.anchorId as string | undefined;
      if (id && !byId.has(id)) byId.set(id, { ...m.attrs });
    }
    return true;
  });
  return byId;
}

/**
 * Build a PM `Fragment` of inline nodes from a spliced paragraph inline-LaTeX
 * string, by re-parsing the WHOLE string with `parseInlineContent` and minting
 * a throwaway `paragraph` off the live schema (the same `nodeFromJSON` →
 * `.content` pattern FigureBlockNodeView uses for captions). Returns `null` if
 * the schema rejects the parsed content (a malformed splice) so the caller can
 * bail rather than corrupt the doc.
 *
 * `parseInlineContent` surfaces every `\vlid{}` / `\vlidend{}` marker (emitted
 * when the paragraph was serialized) as a transient `_linkedAnchorBoundary`
 * sentinel node, because the full-doc `applyLinkedAnchorBoundaries` post-pass
 * that normally resolves them isn't run on a lone inline parse. We must NOT drop
 * those sentinels: each one is a PRE-EXISTING linked-range anchor (a highlight,
 * note, or another revision/cut) that coexists in this same paragraph — dropping
 * it would silently destroy that anchor (data loss). Instead we REUSE the
 * canonical resolver: wrap the parsed inline JSON in a synthetic block and run
 * `applyLinkedAnchorBoundaries`, which pairs each open/close marker locally and
 * re-stamps a `linkedAnchor` mark over the spanned text. The resolver only knows
 * the anchorId (that's all the marker carries), so we then patch each resolved
 * mark back to its full LIVE attrs (`kind` / `tintColor` / `linkCard` / …) from
 * `liveAnchorAttrs`, captured off the paragraph before serialization. Anchors
 * that were wholly inside the replaced span are correctly gone (no markers were
 * emitted for them); anchors elsewhere — and the partial overlaps the resolver
 * naturally handles — survive intact.
 */
function inlineFragmentFromLatex(
  editor: Editor,
  inlineLatex: string,
  liveAnchorAttrs: Map<string, LinkedAnchorAttrs>,
): Fragment | null {
  // Wrap in a synthetic block so the resolver (which walks `node.content`) can
  // pair `\vlid`/`\vlidend` sentinels locally and stamp marks over the span.
  const block: JSONContent = {
    type: "paragraph",
    content: parseInlineContent(inlineLatex),
  };
  applyLinkedAnchorBoundaries(block);
  // Restore the full live attrs the marker round-trip dropped. The resolver
  // stamped a placeholder `{ anchorId, kind: "note", linkId: anchorId }`; swap
  // in the captured tint / card / kind for any id we knew about (a re-parsed
  // anchor with no live capture keeps the placeholder, which is the same
  // behaviour the full-doc load relies on the sidecar to re-hydrate later).
  const restoreAttrs = (nodes: JSONContent[] | undefined): void => {
    if (!nodes) return;
    for (const n of nodes) {
      if (n.marks) {
        for (let k = 0; k < n.marks.length; k++) {
          const mk = n.marks[k];
          if (mk.type !== "linkedAnchor") continue;
          const id = mk.attrs?.anchorId as string | undefined;
          const live = id ? liveAnchorAttrs.get(id) : undefined;
          if (live) n.marks[k] = { type: "linkedAnchor", attrs: { ...live } };
        }
      }
      restoreAttrs(n.content);
    }
  };
  restoreAttrs(block.content);

  try {
    const para = editor.state.schema.nodeFromJSON({
      type: "paragraph",
      content: block.content ?? [],
    });
    return para.content;
  } catch {
    return null;
  }
}

/**
 * Serialize the uuid-anchored paragraph to inline LaTeX and confirm
 * `originalText` appears verbatim. Returns the serialized string + the index of
 * the FIRST occurrence, or `null` if the paragraph is missing / not a paragraph
 * / the span doesn't match (the stale + marker-straddle refusal class).
 *
 * Ports `_replace_span_in_tex`'s verbatim contract: `text.find(match)` in the
 * anchored paragraph's serialization. (The Python scopes the search to the
 * paragraph by `%!v:` markers; here the serialization IS exactly that one
 * paragraph, so the scoping is structural, not by marker.)
 */
function locateSpan(
  editor: Editor,
  anchorUuid: string,
  originalText: string,
): { serialized: string; index: number } | null {
  const hit = findNodeByUuid(editor, anchorUuid);
  if (!hit) return null;
  if (hit.node.type.name !== "paragraph") return null;
  const serialized = serializeParagraphInline(hit.node.toJSON());
  // An empty `originalText` can't be located meaningfully (and `indexOf("")`
  // is 0, a false positive) — treat it as stale.
  if (originalText.length === 0) return null;
  const index = serialized.indexOf(originalText);
  if (index === -1) return null;
  return { serialized, index };
}

/**
 * Splice `originalText → replacement` in the paragraph's serialized inline
 * LaTeX (first verbatim occurrence only) and replace the paragraph's inner
 * content with the re-parsed result, preserving the block node + its uuid.
 * Returns true on a dispatched edit, false on any no-op (uuid gone, schema
 * rejection). `addToHistory: true` — a genuine user-undoable text splice.
 *
 * This is the shared text-mutation half of apply (replace) / keep (delete) —
 * both run the identical serialize → string-replace → reparse → replace-inner
 * pipeline; only the (originalText, replacement) pair differs.
 */
function spliceParagraphInner(
  editor: Editor,
  anchorUuid: string,
  serialized: string,
  index: number,
  originalText: string,
  replacement: string,
): boolean {
  // Capture the LIVE linkedAnchor mark attrs (tint / card / kind) of any
  // pre-existing in-paragraph anchor BEFORE the reparse, so `inlineFragmentFromLatex`
  // can restore them onto the resolved marks — the `\vlid{id}` round-trip alone
  // only carries the id. Captured off the current node; an anchor wholly inside
  // the replaced span emits no marker post-splice and is correctly not restored.
  const hit = findNodeByUuid(editor, anchorUuid);
  if (!hit || hit.node.type.name !== "paragraph") return false;
  const liveAnchorAttrs = captureLiveAnchorAttrs(hit.node);

  const newLatex =
    serialized.slice(0, index) +
    replacement +
    serialized.slice(index + originalText.length);
  const nextFrag = inlineFragmentFromLatex(editor, newLatex, liveAnchorAttrs);
  if (!nextFrag) return false;
  return editStructuredNodeByUuid(editor, anchorUuid, {
    assertType: "paragraph",
    editInlineContent: () => nextFrag,
  });
}

/**
 * Insert a NEW paragraph directly AFTER the block anchored by `anchorUuid`,
 * carrying the parsed `inlineLatex` as its content. Pure insert — the anchored
 * block's own range `[pos, pos+nodeSize)` is never touched, so the original
 * paragraph survives byte-for-byte; the new paragraph lands at the boundary
 * right after it. Returns false (no-op) when the uuid doesn't resolve.
 *
 * The inserted paragraph carries NO `uuid` attr: `BlockUuidBackfill`
 * (block-uuid-backfill.ts) mints a fresh, collision-free `%!v:` id in its
 * `appendTransaction` — the keystroke-safe path for programmatic insertion —
 * so we must NOT hand-mint one (that would risk a collision the backfill can't
 * detect). This is the non-destructive "Insert below" primitive behind the
 * retired 4-field AI fallback: the suggestion is dropped as a sibling paragraph
 * rather than spliced over the (possibly returned / re-anchored) original.
 *
 * `parseInlineContent` yields a single paragraph's worth of inline nodes; a
 * multi-paragraph `suggested_text` would need block-splitting first (out of
 * scope — the AI fallback replacement is single-paragraph by construction).
 */
export function insertParagraphAfter(
  editor: Editor,
  anchorUuid: string,
  inlineLatex: string,
): boolean {
  const hit = findNodeByUuid(editor, anchorUuid);
  if (!hit) return false;
  const insertPos = hit.pos + hit.node.nodeSize;
  const content = parseInlineContent(inlineLatex);
  // insertContentAt dispatches a ReplaceStep that inserts a bare paragraph;
  // BlockUuidBackfill (registered right after DocStructureObserver) backfills
  // its uuid in the same transaction batch.
  return editor
    .chain()
    .insertContentAt(insertPos, { type: "paragraph", content })
    .run();
}

/**
 * Apply a pending AI change.
 *
 * - **replace**: stale-guard `originalText`, splice `originalText → replacement`
 *   into the paragraph (undoable text edit), then stamp the blue
 *   `pending-ai-change` mark over the INSERTED `replacement` region (mark stamp
 *   is NOT undoable — `addToHistory:false`, inside `reanchorByText`).
 * - **delete** (replacement === ""): does NOT mutate text. Stale-guards
 *   `originalText`, then stamps the blue mark over the ORIGINAL region (a
 *   pending-delete preview). `keepPendingChange` later removes the text.
 *
 * Returns `{ ok:false, reason:"stale" }` WITHOUT touching the doc when
 * `originalText` isn't present verbatim (also covers a marker-straddling span),
 * or when `replacement` carries an internal marker token (the write-side mirror
 * of that guard — it would reparse into a phantom anchor / atom).
 */
export function applyPendingChange(editor: Editor, args: ApplyArgs): ApplyResult {
  const { anchorUuid, originalText, replacement, mode, cardId, anchorId, family } =
    args;

  // Write-side mirror of the `originalText` verbatim guard: refuse a
  // `replacement` that embeds any internal Virgil marker (`\vlid` / `\vlidend`
  // / `\vcid` / `\vfid`). Splicing it into the serialized paragraph and
  // reparsing would mint a phantom `linkedAnchor` / citation / footnote atom no
  // card owns (a `\vlid{id}` reusing a colocated anchor's id even splits its
  // range into two marks Keep/Revert can't fully unset). A well-behaved
  // suggestion never emits these — so a marker-bearing one lands as `stale`,
  // the correct non-destructive outcome. Trivially passes for a delete
  // (replacement === ""), but guarded unconditionally so both verbs are safe.
  if (containsInternalMarker(replacement)) return { ok: false, reason: "stale" };

  const located = locateSpan(editor, anchorUuid, originalText);
  if (!located) return { ok: false, reason: "stale" };

  if (mode === "delete") {
    // No text mutation — stamp the blue mark over the ORIGINAL region so the
    // user previews exactly what Keep will remove. `pendingDelete:true` so CSS
    // renders the struck-through-in-blue deletion preview (Part B); `family` so
    // the linkCard token carries the real family (Part A).
    reanchorByText(
      editor,
      PENDING_KIND,
      originalText,
      anchorId,
      cardId,
      PENDING_TINT,
      anchorUuid,
      { linkCardToken: family, pendingDelete: true },
    );
    return { ok: true, anchorId };
  }

  // replace: splice the text first (undoable), then mark the inserted region.
  const spliced = spliceParagraphInner(
    editor,
    anchorUuid,
    located.serialized,
    located.index,
    originalText,
    replacement,
  );
  if (!spliced) return { ok: false, reason: "stale" };

  // Stamp the blue mark over the freshly-inserted `replacement` text, scoped to
  // the anchored paragraph (reanchorByText's uuid-scoped path) so a span that
  // happens to recur elsewhere isn't mis-marked. `family` so the linkCard token
  // carries the real family (Part A); NOT a delete (a replacement renders as the
  // plain blue highlight, no strikethrough).
  reanchorByText(
    editor,
    PENDING_KIND,
    replacement,
    anchorId,
    cardId,
    PENDING_TINT,
    anchorUuid,
    { linkCardToken: family },
  );
  return { ok: true, anchorId };
}

export interface RevertArgs {
  anchorUuid: string;
  originalText: string;
  replacement: string;
  mode: ApplyMode;
  anchorId: string;
}

/**
 * Revert a pending AI change (the Revert action).
 *
 * - **replace**: remove the blue mark, then splice `replacement → originalText`
 *   to restore the paragraph byte-for-byte. (Mark removal first so a stray mark
 *   never lingers on the restored text.)
 * - **delete**: the text was never mutated — just remove the blue mark.
 */
export function revertPendingChange(editor: Editor, args: RevertArgs): void {
  const { anchorUuid, originalText, replacement, mode, anchorId } = args;

  // Drop the pending mark in both modes.
  removeLinkedAnchor(editor, anchorId);

  if (mode === "delete") return; // text was never touched

  // replace: restore the original text. Splice `replacement → originalText` in
  // the (now mark-free) paragraph serialization. Locate the replacement that
  // apply inserted; if it's gone (user already edited), this is a safe no-op.
  const located = locateSpan(editor, anchorUuid, replacement);
  if (!located) return;
  spliceParagraphInner(
    editor,
    anchorUuid,
    located.serialized,
    located.index,
    replacement,
    originalText,
  );
}

export interface KeepArgs {
  anchorUuid: string;
  mode: ApplyMode;
  anchorId: string;
  originalText: string;
  replacement: string;
}

/**
 * Finalize a pending AI change (the Keep action). Must leave NO residual blue
 * marker, so the serialized `.tex` byte-matches the headless Python accept.
 *
 * - **replace**: the text is already spliced — just unset the blue mark over the
 *   range. Nothing else to do.
 * - **delete**: remove the struck `originalText` (splice `originalText → ""` via
 *   the same serialize/parse/replace-inner path) AND unset the mark.
 */
export function keepPendingChange(editor: Editor, args: KeepArgs): void {
  const { anchorUuid, mode, anchorId, originalText } = args;

  // Drop the blue mark FIRST in both modes. This both leaves no residual
  // `\vlid` marker in the `.tex` AND — crucially for delete mode — clears the
  // mark before the splice serializes the paragraph, so the serialization is
  // clean inline LaTeX (no `\vlid…\vlidend` boundary markers, which the
  // inline reparse would otherwise surface as un-schema'd sentinel nodes).
  removeLinkedAnchor(editor, anchorId);

  if (mode === "delete") {
    // Remove the struck text via the same serialize → splice → reparse path.
    // The mark is already gone, so the serialization is plain text. If the span
    // is gone (the user edited it away), this is a safe no-op.
    const located = locateSpan(editor, anchorUuid, originalText);
    if (located) {
      spliceParagraphInner(
        editor,
        anchorUuid,
        located.serialized,
        located.index,
        originalText,
        "",
      );
    }
  }
}
