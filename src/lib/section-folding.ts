import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { readPendingDiff, diffHasStructuralEntries } from "@/lib/tiptap/doc-structure";
import { txPreservesTopLevelNodeDecorations } from "@/lib/pm-map-safety";

export interface SectionFoldingState {
  folded: Set<string>;
  /** Cached hide decorations for everything under a folded heading —
   *  rebuilt on fold change / structural change / map-unsafe tx, otherwise
   *  carried forward with DecorationSet.map (typing-latency fix 2b: the
   *  props.decorations hook used to recompute the whole set on EVERY view
   *  update while any fold was active — the focus-view file header called
   *  this out as the bad pattern). */
  decoSet: DecorationSet;
  /** Cached top-level child indices hidden by the current folds — the
   *  artifact getHiddenTopLevelIndices serves. Only structural changes can
   *  alter indices, and those rebuild, so map-forwarded keystrokes keep it. */
  hiddenIdx: ReadonlySet<number>;
}

export const sectionFoldingPluginKey = new PluginKey<SectionFoldingState>(
  "sectionFolding",
);

/**
 * Keystroke-sanctity gate (#29a): can this transaction have changed the fold
 * state? A fold changes ONLY via (1) an explicit fold-meta on this plugin
 * (toggle / collapseAll / expandAll / setFolded) or (2) a docChanged tx (the
 * apply reducer prunes dead fold UUIDs when a folded heading is deleted).
 *
 * The section-fold persister in `useEditorUIState.ts` (an
 * `editor.on("transaction")` subscriber) gates on THIS so a structurally-null
 * keystroke (typing inside a paragraph: no fold meta, no docChanged) does ZERO
 * fold work. (The fold-chevron doc-wide resync no longer rides a transaction
 * subscriber at all — it moved to the shared plugin `view()` below, #29 nit-3 —
 * which uses its own O(1) `folded`-set reference bail rather than this
 * predicate.)
 */
export function transactionTouchesFold(tr: Transaction): boolean {
  return tr.getMeta(sectionFoldingPluginKey) !== undefined || tr.docChanged;
}

type Meta =
  | { action: "toggle"; uuid: string }
  | { action: "collapseAll" }
  | { action: "expandAll" }
  | { action: "setFolded"; uuids: string[] };

/**
 * Collect the UUIDs of every top-level heading in the document. Folding only
 * applies to top-level headings (direct children of the doc) since that's
 * where the chevron is rendered.
 */
function collectHeadingUuids(doc: PMNode): string[] {
  const uuids: string[] = [];
  doc.forEach((node) => {
    if (node.type.name === "heading" && node.attrs?.uuid) {
      uuids.push(node.attrs.uuid as string);
    }
  });
  return uuids;
}

/**
 * Returns the list of top-level block ranges that should be hidden because
 * they sit under a folded heading. A folded heading hides everything until
 * the next heading of the same or higher (smaller-level-number) level.
 */
function computeFoldedChildIndices(
  doc: PMNode,
  folded: Set<string>,
): Set<number> {
  const hidden = new Set<number>();
  if (folded.size === 0) return hidden;
  // Stack of active fold levels. A heading at level L closes every active
  // fold whose level is >= L. Blocks inside any active fold are hidden,
  // including nested sub-headings.
  const foldStack: number[] = [];
  doc.forEach((node, _offset, i) => {
    if (node.type.name === "heading") {
      const level = node.attrs.level as number;
      while (foldStack.length > 0 && foldStack[foldStack.length - 1] >= level) {
        foldStack.pop();
      }
      if (foldStack.length > 0) hidden.add(i);
      const uuid = node.attrs.uuid as string | null;
      if (uuid && folded.has(uuid)) {
        foldStack.push(level);
      }
    } else if (foldStack.length > 0) {
      hidden.add(i);
    }
  });
  return hidden;
}

export function getSectionFoldingState(
  state: EditorState,
): SectionFoldingState {
  return (
    sectionFoldingPluginKey.getState(state) ?? {
      folded: new Set<string>(),
      decoSet: DecorationSet.empty,
      hiddenIdx: EMPTY_HIDDEN_INDICES,
    }
  );
}

export function isHeadingFolded(state: EditorState, uuid: string): boolean {
  return getSectionFoldingState(state).folded.has(uuid);
}

const EMPTY_HIDDEN_INDICES: ReadonlySet<number> = new Set<number>();

/**
 * Set of top-level doc child indices that are currently hidden because they
 * sit under a folded heading. Reference-stable empty set when nothing is
 * folded, suitable for use as a memo dependency.
 */
export function getHiddenTopLevelIndices(
  state: EditorState,
): ReadonlySet<number> {
  const s = sectionFoldingPluginKey.getState(state);
  // Plugin installed → serve the cached artifact (no doc walk).
  if (s) return s.folded.size === 0 ? EMPTY_HIDDEN_INDICES : s.hiddenIdx;
  return EMPTY_HIDDEN_INDICES;
}

/** Are there any headings currently folded? */
export function hasFolded(state: EditorState): boolean {
  return getSectionFoldingState(state).folded.size > 0;
}

/** Are there any top-level headings not folded? (used to enable collapseAll) */
export function hasExpanded(state: EditorState): boolean {
  const { folded } = getSectionFoldingState(state);
  const all = collectHeadingUuids(state.doc);
  return all.some((u) => !folded.has(u));
}

/**
 * Build the fold artifacts in ONE top-level walk: the hidden indices AND the
 * hide decorations. Runs on fold changes / structural changes / map-unsafe
 * txs (user- or edit-paced), never on a plain keystroke.
 */
function buildFoldArtifacts(
  doc: PMNode,
  folded: Set<string>,
): { decoSet: DecorationSet; hiddenIdx: ReadonlySet<number> } {
  const hiddenIdx = computeFoldedChildIndices(doc, folded);
  if (hiddenIdx.size === 0) {
    return { decoSet: DecorationSet.empty, hiddenIdx: EMPTY_HIDDEN_INDICES };
  }
  const decos: Decoration[] = [];
  let offset = 0;
  doc.forEach((node, _o, i) => {
    if (hiddenIdx.has(i)) {
      decos.push(
        Decoration.node(offset, offset + node.nodeSize, {
          class: "section-folded",
        }),
      );
    }
    offset += node.nodeSize;
  });
  return { decoSet: DecorationSet.create(doc, decos), hiddenIdx };
}

export function sectionFoldingPlugin(): Plugin<SectionFoldingState> {
  return new Plugin<SectionFoldingState>({
    key: sectionFoldingPluginKey,
    state: {
      init: () => ({
        folded: new Set<string>(),
        decoSet: DecorationSet.empty,
        hiddenIdx: EMPTY_HIDDEN_INDICES,
      }),
      // [cost: O(1)/tx — meta check, then docChanged + folded.size === 0 bail, then an O(removedHeadings) prune off the observer diff; DecorationSet.map with the SAME folded/hiddenIdx references on an in-block keystroke; O(doc) buildFoldArtifacts (DecorationSet.create) only on a fold change, a structural diff entry, or a map-unsafe top-level replace] (task 433 census)
      // With no observer diff (observer not installed — tests) the prune falls back to an O(headings) collectHeadingUuids walk; a stated, tagged exemption.
      apply(tr, value, oldState, newState): SectionFoldingState {
        // A real fold change rebuilds the artifacts from the new fold set.
        const rebuiltWith = (folded: Set<string>): SectionFoldingState => ({
          folded,
          ...buildFoldArtifacts(newState.doc, folded),
        });

        const meta = tr.getMeta(sectionFoldingPluginKey) as Meta | undefined;
        if (meta) {
          if (meta.action === "toggle") {
            const next = new Set(value.folded);
            if (next.has(meta.uuid)) next.delete(meta.uuid);
            else next.add(meta.uuid);
            return rebuiltWith(next);
          }
          if (meta.action === "collapseAll") {
            return rebuiltWith(new Set(collectHeadingUuids(newState.doc)));
          }
          if (meta.action === "expandAll") {
            return rebuiltWith(new Set());
          }
          if (meta.action === "setFolded") {
            const alive = new Set(collectHeadingUuids(newState.doc));
            const next = new Set<string>();
            for (const u of meta.uuids) if (alive.has(u)) next.add(u);
            return rebuiltWith(next);
          }
        }
        if (!tr.docChanged || value.folded.size === 0) return value;

        // Doc changed with folds active. Prune fold UUIDs that no longer
        // exist (cheap path via the observer diff), then decide whether the
        // cached artifacts survive a `.map()` or must rebuild:
        //   - fold set changed (prune) → rebuild
        //   - structural diff entries (blocks/headings entered/left/changed
        //     — fold extents may differ) → rebuild
        //   - map-unsafe tx (a top-level node replace would DROP a node
        //     decoration under .map(), silently un-hiding a block — the
        //     shared focus-view discriminator) → rebuild
        //   - plain in-block keystroke → decoSet.map + SAME folded/hiddenIdx
        //     references (the chevron view's bail keys off `folded`).
        const diff = readPendingDiff(newState);
        let folded = value.folded;
        if (diff) {
          if (diff.removedHeadings.length > 0) {
            const removed = new Set(diff.removedHeadings.map((h) => h.uuid));
            let changed = false;
            const next = new Set<string>();
            for (const u of value.folded) {
              if (removed.has(u)) {
                changed = true;
                continue;
              }
              next.add(u);
            }
            if (changed) folded = next;
          }
        } else {
          // Observer not installed (tests). Fall back to the full prune.
          const alive = new Set(collectHeadingUuids(newState.doc));
          let changed = false;
          const next = new Set<string>();
          for (const u of value.folded) {
            if (alive.has(u)) next.add(u);
            else changed = true;
          }
          if (changed) folded = next;
        }

        if (folded !== value.folded) return rebuiltWith(folded);
        if (
          (diff && diffHasStructuralEntries(diff)) ||
          !txPreservesTopLevelNodeDecorations(tr, oldState.doc, newState.doc)
        ) {
          return rebuiltWith(value.folded);
        }
        return {
          folded: value.folded,
          decoSet: value.decoSet.map(tr.mapping, newState.doc),
          hiddenIdx: value.hiddenIdx,
        };
      },
    },
    props: {
      decorations(state) {
        // O(1): the cached set (focus-view pattern — this hook used to
        // recompute the fold walk on every view update while folded).
        return this.getState(state)?.decoSet ?? DecorationSet.empty;
      },
    },
    // Shared fold-chevron refresher (#29 nit-3). This single plugin-view is
    // the ONE replacement for the deleted N per-heading `on("transaction")`
    // subscribers in editor-extensions.ts — each heading NodeView used to
    // register its own subscriber (N headings = N subscribers), which is the
    // keystroke-sanctity nit this fix closes. ProseMirror instantiates one
    // pluginView per EditorView (main + mirror), so each pane's chevrons get
    // resynced against their own DOM scope.
    //
    // Keystroke fast-path: update() does an O(1) reference-compare of the
    // `folded` SET (old vs new). The apply reducer above keeps the same set
    // reference on every no-fold-change branch (including the per-keystroke
    // decoSet .map carry-forward) and swaps it on every real change
    // (toggle/collapseAll/expandAll/setFolded/prune-with-removal), so a
    // plain keystroke bails before any querySelectorAll.
    //
    // DOM-timing assumption: `data-uuid` (stamped by the UuidAttrDecorator,
    // src/lib/tiptap/uuid-attr.ts) must be live on the heading wrapper before
    // resync reads it. It is: a heading mints its uuid (ensureAnchorUuid) on a
    // SEPARATE earlier transaction than the fold-toggle tx, so by the time a
    // fold meta arrives the uuid attr is already on the DOM.
    view(editorView: EditorView) {
      const resync = (folded: Set<string>) => {
        const chevrons =
          editorView.dom.querySelectorAll<HTMLElement>(".heading-fold-chevron");
        chevrons.forEach((btn) => {
          const uuid =
            btn.closest("[data-uuid]")?.getAttribute("data-uuid") ?? null;
          const isFolded = uuid ? folded.has(uuid) : false;
          if (btn.classList.contains("is-folded") !== isFolded) {
            btn.classList.toggle("is-folded", isFolded);
            btn.title = isFolded ? "Unfold section" : "Fold section";
          }
        });
      };
      // Load-time paint: the apply reducer doesn't fire a fold change on doc
      // load, so paint the initial state once here (covers restore-from-prefs
      // where NodeViews mounted unfolded before a setFolded meta arrives).
      resync(getSectionFoldingState(editorView.state).folded);
      return {
        update(view: EditorView, prevState: EditorState) {
          const next = sectionFoldingPluginKey.getState(view.state);
          const prev = sectionFoldingPluginKey.getState(prevState);
          // O(1) reference bail — the keystroke fast-path. Keyed off the
          // `folded` SET reference (not the state object): with the cached
          // decoSet the state object legitimately churns per keystroke
          // while folded (the .map carry-forward), but `folded` keeps its
          // reference on every no-fold-change branch and is replaced on
          // every real change (toggle/collapseAll/expandAll/setFolded/
          // prune-with-removal).
          if (!next || next.folded === prev?.folded) return;
          resync(next.folded);
        },
      };
    },
  });
}
