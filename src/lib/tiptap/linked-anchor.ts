import { Mark, Extension, mergeAttributes } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Fragment as PMFragmentCtor, Slice as PMSliceCtor, type Node as PMNode2, type Fragment as PMFragment } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import type { MutableRefObject } from "react";
import { readPendingDiff } from "@/lib/tiptap/doc-structure";
import { reparentedUuids } from "@/lib/tiptap/block-uuid-backfill";
import { linkedAnchorRenderAttrs } from "@/lib/tiptap/linked-anchor-attrs";
import { linkKindSelector } from "@/links/link-dom-contract";

// ─────────────────────────────────────────────────────────────────────────────
// LinkedAnchor — invisible mark placed on a text range. Used by Notes,
// Revisions, and Cutter to link a side-panel card to a specific selection.
// The mark is *app state*, not document state: stripped on .tex export,
// re-applied on load from sidecar JSON snapshots. `inclusive: false` so
// typing at the edges does not extend the range.
// ─────────────────────────────────────────────────────────────────────────────

export const LinkedAnchor = Mark.create({
  name: "linkedAnchor",
  inclusive: false,
  spanning: true,

  addAttributes() {
    return {
      // Legacy attrs kept in JSON for persistence but not emitted to HTML —
      // data-link-* carry the same information for parsers.
      anchorId: { default: "", renderHTML: () => ({}) },
      // `kind` drives the per-kind colour fallback in renderHTML. The
      // sentinel value "transient" marks the plain selection grab's
      // cardless range handle — renderHTML then omits data-link-card so the
      // anchor is invisible (see linked-anchor-attrs.ts).
      //
      // E-5 status (A6): this attr is otherwise render-inert — anchor
      // colour is keyed off `data-link-card`'s kind token (normally from
      // `linkCard`; `kind` is only the LEGACY fallback when `linkCard` is
      // empty — see linked-anchor-attrs.ts) and the highlight palette
      // resolves through the panel-theme path, so `kind` itself paints
      // nothing directly. It can't be removed yet: the legacy fallback and
      // the load-bearing "transient" sentinel still read it. Removal is
      // deferred to the keyspace/link-schema unification (A2/A10).
      kind: { default: "note", renderHTML: () => ({}) },
      linkId: { default: "", renderHTML: () => ({}) },
      linkKind: { default: "anchor", renderHTML: () => ({}) },
      linkCard: { default: "", renderHTML: () => ({}) },
      // Persistent highlight tint (Adobe-style). When set, CSS paints the
      // anchored text unconditionally — independent of the hover/selection-
      // driven highlight states for other card kinds.
      //
      // TWO value shapes, and the distinction is the point (task 174):
      //  - an ACCENT SENTINEL (`accent:<token>`, from `accentTintForToken`) —
      //    "this band is the kind's LIVE theme accent". Emitted as the data
      //    attr ALONE; the matching globals.css rule sets `--tint-color` from
      //    `var(--link-anchor-accent-<token>)`, so a panel-color override
      //    repaints the band with no re-stamp and no doc walk. This is the
      //    default highlight band — a resolved hex here would freeze theme
      //    state into the document, which is exactly what the amber literal
      //    did.
      //  - a LITERAL HEX — a genuinely per-instance hue (the `#bfdbfe`
      //    pending-AI-change / pending-AI-request bands; a future per-card
      //    `highlightColor`). Emitted as an inline `--tint-color`, which beats
      //    the sentinel stylesheet rule.
      tintColor: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-tint-color"),
        renderHTML: (attrs: Record<string, unknown>) => {
          const tint = attrs.tintColor;
          if (typeof tint !== "string" || !tint) return {};
          // The value rides sidecar JSON, so guard the inline-style CSS sink —
          // only a strict hex colour is interpolated. A sentinel (and any
          // unrecognised value) emits the data attr only: CSS resolves the
          // sentinel, and anything else falls through to the amber `var()`
          // fallback. No untrusted text in `style`.
          const safe = /^#[0-9a-fA-F]{3,8}$/.test(tint);
          return safe
            ? { "data-tint-color": tint, style: `--tint-color: ${tint}` }
            : { "data-tint-color": tint };
        },
      },
      // Delete-mode signal for a pending AI change (Phase 4, Part B). When the
      // applicator stamps the blue mark over the ORIGINAL text of a pure
      // DELETION (a cutter cut whose suggested_text is empty), it sets this so
      // CSS can render the range struck-through-in-blue (a preview of what Keep
      // will remove), distinct from a replacement's plain blue highlight. Render-
      // only; like `tintColor` it is app-state (stripped on `.tex` export and
      // re-stamped on load from the card's `appliedChange.mode`).
      pendingDelete: {
        default: null,
        parseHTML: (el: HTMLElement) =>
          el.getAttribute("data-pending-delete") === "true" ? true : null,
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.pendingDelete ? { "data-pending-delete": "true" } : {},
      },
    };
  },

  parseHTML() {
    // Accept both the historical `data-anchor-id` tag and the new
    // `data-link-id` when `data-link-kind="anchor"`.
    return [
      { tag: "span[data-anchor-id]" },
      { tag: `span${linkKindSelector("anchor")}` },
    ];
  },

  renderHTML({ mark, HTMLAttributes }) {
    // Attribute policy (incl. the transient/cardless rule) lives in the
    // pure, unit-tested `linkedAnchorRenderAttrs`. A transient anchor (the
    // plain selection grab's invisible range handle) omits data-link-card
    // so no per-kind colour rule paints it; every other anchor is
    // byte-identical to before.
    return [
      "span",
      mergeAttributes(HTMLAttributes, linkedAnchorRenderAttrs(mark.attrs)),
      0,
    ];
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// LinkedAnchorGuard — watches the doc for vanishing linkedAnchor ids and
// dispatches `virgil-anchor-orphaned` so each feature hook can clear the
// dead anchorId on its matching item. Also strips the mark from pasted
// slices to prevent duplicate-id collisions via copy-paste.
// ─────────────────────────────────────────────────────────────────────────────

export const LinkedAnchorGuard = Extension.create({
  name: "linkedAnchorGuard",

  addProseMirrorPlugins() {
    // Capture the live view so the deferred dispatch can re-check anchor
    // liveness against the FINAL, fully-committed doc — the mark-level twin of
    // TextObjectOrphanGuard's settled-doc recheck below. The root-cause fix
    // lives in the step-inspector (an interior char-delete inside a marked run
    // no longer false-reports the surviving anchor as removed), but this recheck
    // is the safety net: if any future step path re-introduces a false positive
    // in `removedAnchors`, firing the orphan event would make the feature hooks
    // (useNotes / useCutter / useRevisions / useReports) PERMANENTLY strip a
    // still-valid anchor link — silent data loss. Re-checking the settled doc in
    // the `setTimeout(0)` skips any anchorId whose mark is actually still live.
    let liveView: EditorView | null = null;
    return [
      new Plugin({
        key: new PluginKey("linkedAnchorGuard"),
        view(v) {
          liveView = v;
          return {
            update(v2) {
              liveView = v2;
            },
            destroy() {
              liveView = null;
            },
          };
        },
        // [cost: O(1)/tx — docChanged + observer-diff removedAnchors gate; O(doc) descendants only on an anchor-removal transaction, and then inside a setTimeout off the dispatch, never on plain typing] (task 433 census)
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          // Read the diff already computed by DocStructureObserver
          // (which runs before us). No doc walks — just the typed
          // delta the observer published.
          const diff = readPendingDiff(newState);
          if (!diff || diff.removedAnchors.length === 0) return null;
          setTimeout(() => {
            // Build the set of anchorIds still live in the settled doc ONCE. An
            // id present here survived (interior edit) and is NOT an orphan — skip
            // its event so the sweep doesn't strip a valid link. O(doc), but only
            // on an anchor-removal transaction, never the plain-typing path.
            // Fallback (no view): dispatch all, matching prior behavior.
            const doc = liveView?.state.doc ?? null;
            let liveAnchorIds: Set<string> | null = null;
            if (doc) {
              liveAnchorIds = new Set<string>();
              doc.descendants((node) => {
                if (node.isText && node.marks.length > 0) {
                  for (const mark of node.marks) {
                    if (mark.type.name !== "linkedAnchor") continue;
                    const aid = (mark.attrs as { anchorId?: string }).anchorId ?? "";
                    if (aid) liveAnchorIds!.add(aid);
                  }
                }
                return true;
              });
            }
            for (const a of diff.removedAnchors) {
              if (liveAnchorIds && liveAnchorIds.has(a.id)) continue; // survived
              window.dispatchEvent(
                new CustomEvent("virgil-anchor-orphaned", {
                  detail: { anchorId: a.id, kind: a.kind },
                }),
              );
            }
          }, 0);
          return null;
        },
        props: {
          transformPasted(slice) {
            const rebuild = (frag: PMFragment): PMFragment => {
              const out: PMNode2[] = [];
              frag.forEach((n) => {
                if (n.isText) {
                  const filtered = n.marks.filter((m) => m.type.name !== "linkedAnchor");
                  out.push(filtered.length === n.marks.length ? n : n.mark(filtered));
                } else {
                  out.push(n.copy(rebuild(n.content)));
                }
              });
              return PMFragmentCtor.fromArray(out);
            };
            return new PMSliceCtor(rebuild(slice.content), slice.openStart, slice.openEnd);
          },
        },
      }),
    ];
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// TextObjectOrphanGuard — sibling of LinkedAnchorGuard for Mode A links.
//
// Mode B (linkedAnchor marks) and Mode A (paragraphId / textObjectIds
// fields on the card itself) are two different schema mechanisms for
// anchoring a card to text. LinkedAnchorGuard above sweeps Mode B on
// mark removal. This plugin sweeps Mode A on BLOCK removal — when a
// paragraph / heading / listItem / etc. vanishes from the doc, Mode A
// cards that had recorded its uuid as `paragraphId` / `textObjectIds`
// are notified so they can drop the stale link.
//
// Pattern: read `diff.removedBlocks` from DocStructureObserver (already
// computed, O(1) per transaction), emit `virgil-textobject-orphaned`
// CustomEvents in a `setTimeout(0)` so the transaction commits first.
// Each Mode A hook (useTodos / useReports / useExamples / useArchive)
// listens and sweeps its own `links[]`. The handler MUST be O(removed)
// per event — pre-build an inverted index inside each hook so the
// listener doesn't walk every card on every removal.
//
// Overlap with MarginaliaAnchorGuard (below): that guard re-inserts a
// uuid-bearing empty paragraph when an *anchored* block vanishes, so an
// anchored block MOSTLY does not become an orphan. Two cases fall through
// to this guard and MUST: a deliberate lifecycle removal (LIFECYCLE_DELETE_META),
// and a removal whose resurrection would be a total no-op (task 367's EXCEPTION 2
// — an empty uuid-only paragraph the user is deliberately deleting). Both are
// handled correctly here by construction rather than by care, because the
// deferred sweep below re-reads the SETTLED doc: a block the anchor guard
// declined to resurrect is genuinely gone, so its event fires.
// This guard is the safety net for blocks Mode-A-anchored but NOT
// margin-tracked — common for cascade-extended deletions that swallow
// a wrapper (list / exampleBlock) whose uuid was anchored. See
// ACTION-MENU-DIAGNOSIS.md cluster C3.
// ─────────────────────────────────────────────────────────────────────────────

export const TextObjectOrphanGuard = Extension.create({
  name: "textObjectOrphanGuard",

  addProseMirrorPlugins() {
    // Capture the live view so the deferred dispatch can re-check liveness
    // against the FINAL, fully-committed doc — after every appendTransaction,
    // crucially MarginaliaAnchorGuard's resurrection (it re-inserts a same-uuid
    // placeholder when an *anchored* block is incidentally removed).
    // MarginaliaAnchorGuard is registered AFTER this guard, so at this plugin's
    // `appendTransaction` time the resurrection hasn't run yet and `newState`
    // still shows the block as removed. Firing the orphan event off that stale
    // view made the Mode-A sweep (useTodos / useArchive) PERMANENTLY strip a
    // link the resurrection had just kept valid — silent data loss on an
    // incidental edit. Re-checking the settled doc in the `setTimeout(0)` (after
    // the whole dispatch commits) skips any uuid that is actually still live.
    let liveView: EditorView | null = null;
    return [
      new Plugin({
        key: new PluginKey("textObjectOrphanGuard"),
        view(v) {
          liveView = v;
          return {
            update(v2) {
              liveView = v2;
            },
            destroy() {
              liveView = null;
            },
          };
        },
        // [cost: O(1)/tx — docChanged + observer-diff removedBlocks gate; O(doc) descendants only on a block-removal transaction, and then inside a setTimeout off the dispatch, never on plain typing] (task 433 census)
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const diff = readPendingDiff(newState);
          if (!diff || diff.removedBlocks.length === 0) return null;
          const removed = diff.removedBlocks;
          setTimeout(() => {
            // Build the set of uuids still live in the settled doc ONCE. A uuid
            // present here was resurrected (or re-added by a later edit) and is
            // NOT an orphan — skip its event so the sweep doesn't strip a valid
            // link. O(doc), but only on a block-removal transaction (removed.length
            // > 0), never the plain-typing path. Fallback (no view): dispatch all,
            // matching the prior unconditional behavior.
            const doc = liveView?.state.doc ?? null;
            let liveUuids: Set<string> | null = null;
            if (doc) {
              liveUuids = new Set<string>();
              doc.descendants((node) => {
                const u = (node.attrs as { uuid?: string | null } | undefined)
                  ?.uuid;
                if (u) liveUuids!.add(u);
                return true;
              });
            }
            for (const block of removed) {
              if (liveUuids && liveUuids.has(block.uuid)) continue; // resurrected
              window.dispatchEvent(
                new CustomEvent("virgil-textobject-orphaned", {
                  detail: { uuid: block.uuid, typeName: block.typeName },
                }),
              );
            }
          }, 0);
          return null;
        },
      }),
    ];
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// LIFECYCLE_DELETE_META — set on a `tr` that performs a DELIBERATE lifecycle
// removal of a block (the Archive / Delete drag-handle actions in
// `drag-handle-actions.ts`). MarginaliaAnchorGuard early-returns on any
// transaction carrying this meta, so the user's explicit intent to remove an
// anchored block is honoured instead of being silently undone by the guard's
// re-insert. This is the ONE case where the "preserve the uuid through
// incidental edits" contract should NOT apply — the archive path reanchors its
// snippet to the previous block and TextObjectOrphanGuard sweeps any Mode-A
// card whose anchor disappears, so nothing is left dangling. Do NOT broaden
// the bypass beyond archive/delete: an incidental edit that happens to remove
// an anchored block MUST still resurrect (the guard's legitimate job).
export const LIFECYCLE_DELETE_META = "virgilLifecycleDelete";

// ─────────────────────────────────────────────────────────────────────────────
// MarginaliaAnchorGuard — prevents paragraph deletion from orphaning the
// cards attached to it. When a UUID-bearing block vanishes and it had
// any kind of card anchor — a marginalia margin marker (tracked via the
// shared `anchoredUuidsRef`) OR an inline `linkedAnchor` mark inside it
// (notes / cuts / revisions text-range anchors) — the plugin re-inserts
// an empty paragraph carrying the same UUID at the deletion site. The
// card's `links[].anchor.textObjectIds` entry therefore stays valid and
// no card silently goes orphan through editor edits.
//
// EXCEPTION 1: a transaction tagged with `LIFECYCLE_DELETE_META` (the Archive /
// Delete drag-handle actions) is a deliberate removal — the guard bypasses it
// so the block actually goes. See the meta declaration above.
//
// EXCEPTION 2 — THE NO-OP IDENTITY (task 367). A preservation guard may restore
// what a removal LOST; it may not restore the removal itself. The remedy here is
// always the same node — `paragraph({ uuid })`, empty, every other attr at its
// default — so whenever the vanished block WAS already exactly that node, the
// re-insert reproduces the guard's own input and the document ends BYTE-IDENTICAL.
// That is not a preservation: it is a silent, total, permanent veto of the user's
// keystroke. Press Backspace once, ten times, a hundred — nothing moves, nothing
// is said, and the only escape is the grab-handle Delete (the one path that
// carries the meta above). Gabriel hit exactly this twice in one paper: a stray
// `%!v:XXXX` anchor line parses to an empty uuid-bearing paragraph, and an
// anchored one is an invisible block that cannot be removed.
//
// So where the resurrection would be a total no-op the guard STANDS DOWN and the
// removal lands. Nothing is lost that the guard was protecting: the card's anchor
// is swept by TextObjectOrphanGuard above — which re-reads the SETTLED doc, so it
// sees this block as genuinely gone and fires — into the orphan strip, re-pinnable,
// which is precisely the outcome the one user-reachable deletion path (grab-handle
// Delete) already produces for the same block. Consistency, not new risk.
//
// The predicate IS the law, not a proxy for it: `removed.eq(replacement)` asks the
// literal question "would re-inserting reproduce what vanished?" — so it needs no
// hand-listed conditions and it follows automatically if the remedy's shape ever
// changes. It fails OPEN (resurrect, today's behaviour) on any node it cannot read
// back, because a needless resurrection is the status quo while a wrong stand-down
// orphans a card. Note an empty paragraph carrying a `parTitle` is NOT this case:
// the title is visible, dropping it changes the document, so the gesture HAS an
// effect and the guard keeps preserving.
//
// To remove a card entirely, the user explicitly deletes it from the
// margin (see `deleteMarginItem` in `src/lib/cards/delete-margin-item.ts`)
// or via the panel's trash button. This is the unified contract behind
// "cut down on unanchored cards".
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Would resurrecting `entry` reproduce the node that vanished, exactly?
 *
 * `oldDoc` is the document BEFORE the dispatched batch, which is the coordinate
 * space `StructureDiff.removedBlocks[].pos` is expressed in (the guard maps those
 * positions FORWARD through every docChanged mapping to place its insert, so they
 * are pre-batch by construction). O(depth) per removed block — a `nodeAt`, never a
 * walk — and only on a transaction that removed a block, so the typing path is
 * untouched (keystroke sanctity).
 *
 * Fails OPEN — `false`, i.e. "resurrect" — on a position that reads back as
 * something else or as nothing at all. The uuid re-check is what makes that
 * honest: without it a stale position would silently compare the WRONG node.
 */
function resurrectionWouldBeANoOp(
  oldDoc: PMNode2,
  entry: { uuid: string; pos: number },
  paraType: import("@tiptap/pm/model").NodeType,
): boolean {
  let removed: PMNode2 | null = null;
  try {
    removed = oldDoc.nodeAt(entry.pos);
  } catch {
    return false;
  }
  if (!removed) return false;
  if ((removed.attrs as { uuid?: string | null } | undefined)?.uuid !== entry.uuid) {
    return false;
  }
  // The exact node this guard would put back. `Node.eq` compares type, attrs,
  // marks AND content — so this is the whole question in one call.
  return removed.eq(paraType.create({ uuid: entry.uuid }));
}

export const MarginaliaAnchorGuard = Extension.create<{
  anchoredUuidsRef: MutableRefObject<Set<string>>;
}>({
  name: "marginaliaAnchorGuard",

  addOptions() {
    return {
      anchoredUuidsRef: { current: new Set() } as MutableRefObject<Set<string>>,
    };
  },

  addProseMirrorPlugins() {
    const { anchoredUuidsRef } = this.options;
    return [
      new Plugin({
        key: new PluginKey("marginaliaAnchorGuard"),
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;

          // A deliberate lifecycle removal (Archive / Delete) carries
          // LIFECYCLE_DELETE_META — the user intends the block to go, so
          // do NOT resurrect its uuid. O(1) meta read per transaction; runs
          // before any diff work (keystroke sanctity).
          if (transactions.some((t) => t.getMeta(LIFECYCLE_DELETE_META))) {
            return null;
          }

          // Consume the typed diff already computed by
          // DocStructureObserver — no doc walks needed.
          const diff = readPendingDiff(newState);
          if (!diff) return null;
          if (
            diff.removedBlocks.length === 0 &&
            diff.removedAnchors.length === 0
          ) {
            return null;
          }

          // A block "needs preserving" if it had a margin marker
          // (anchoredUuidsRef) or hosted any linkedAnchor mark
          // (signalled by removedAnchors that landed in the same range).
          const anchored = anchoredUuidsRef.current;
          // Track which removed-block UUIDs hosted a linkedAnchor we
          // also saw vanish. We can't recompute it after the fact, so
          // be conservative: if any anchor was removed, treat all
          // removed blocks as candidates (the orphan-event consumer
          // for inline anchors clears the card anyway; preserving the
          // paragraph here keeps margin cards consistent).
          const anchorVanished = diff.removedAnchors.length > 0;

          // EXCEPTION 3 (task 499) — an identity that is not LOST needs no
          // resurrection. A container-changing gesture (Shift-Tab out of a
          // list, Backspace at an item's start, toggle-list-off, blockquote-off,
          // bullet ⇄ numbered) DISSOLVES the container and hands its uuid to the
          // block that succeeded it, in the same transaction
          // (`block-uuid-backfill`'s re-parent transfer). Resurrecting there
          // does not preserve anything — it puts an EMPTY paragraph carrying the
          // uuid above the user's own lifted text, and the net, seeing the id
          // live again, mints a stranger for the text. Verbatim the reported
          // bug. This is the sibling of EXCEPTION 2: there the resurrection
          // reproduced the removal (a silent veto of the gesture), here it
          // fights a successor that already exists. The predicate is read from
          // the transactions' own steps, so it gives the same answer whichever
          // of the two plugins the appendTransaction chain runs first.
          const conserved = reparentedUuids(transactions);

          const paraType = newState.schema.nodes.paragraph;
          if (!paraType) return null;

          type Vanished = { uuid: string; pos: number };
          const vanished: Vanished[] = [];
          for (const b of diff.removedBlocks) {
            if (!anchored.has(b.uuid) && !anchorVanished) continue;
            // EXCEPTION 2 (see the header): a resurrection that reproduces the
            // vanished node is a silent veto, not a preservation. Stand down.
            // The `anchorVanished` half needs no separate argument — an EMPTY
            // paragraph has no text for a `linkedAnchor` mark to sit on, so the
            // inline-anchor justification is vacuous for exactly this shape.
            if (resurrectionWouldBeANoOp(oldState.doc, b, paraType)) continue;
            if (conserved.has(b.uuid)) continue; // EXCEPTION 3 — it has a successor
            vanished.push({ uuid: b.uuid, pos: b.pos });
          }
          if (vanished.length === 0) return null;
          const tr = newState.tr;
          const docChangedMappings = transactions
            .filter((t) => t.docChanged)
            .map((t) => t.mapping);

          // Map each vanished block's old start-position forward
          // through the transaction mapping. Bias -1 lands the
          // placeholder at the deletion site, not past it.
          type InsertSpec = { pos: number; uuid: string };
          const inserts: InsertSpec[] = [];
          const docSize = tr.doc.content.size;
          for (const v of vanished) {
            let pos = v.pos;
            for (const m of docChangedMappings) {
              pos = m.map(pos, -1);
            }
            if (!Number.isFinite(pos) || pos < 0) pos = docSize;
            if (pos > docSize) pos = docSize;
            inserts.push({ pos, uuid: v.uuid });
          }

          inserts.sort((a, b) => b.pos - a.pos);
          for (const spec of inserts) {
            const emptyPara = paraType.create({ uuid: spec.uuid });
            const insertPos = Math.min(spec.pos, tr.doc.content.size);
            try {
              tr.insert(insertPos, emptyPara);
            } catch {
              try {
                tr.insert(tr.doc.content.size, emptyPara);
              } catch {
                /* give up — better than crashing the doc */
              }
            }
          }
          tr.setMeta("addToHistory", false);
          return tr.steps.length > 0 ? tr : null;
        },
      }),
    ];
  },
});
