import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { readPendingDiff } from "@/lib/tiptap/doc-structure";

export interface SectionFoldingState {
  folded: Set<string>;
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
 * Every `editor.on("transaction")` subscriber that mirrors fold state — the
 * per-heading fold-chevron refresher in `editor-extensions.ts` (N headings = N
 * subscribers) and the section-fold persister in `useEditorUIState.ts` — gates
 * on THIS so a structurally-null keystroke (typing inside a paragraph: no fold
 * meta, no docChanged) does ZERO fold work. Single source so the two gates
 * cannot drift.
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
    sectionFoldingPluginKey.getState(state) ?? { folded: new Set<string>() }
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
  const { folded } = getSectionFoldingState(state);
  if (folded.size === 0) return EMPTY_HIDDEN_INDICES;
  return computeFoldedChildIndices(state.doc, folded);
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

export function sectionFoldingPlugin(): Plugin<SectionFoldingState> {
  return new Plugin<SectionFoldingState>({
    key: sectionFoldingPluginKey,
    state: {
      init: () => ({ folded: new Set<string>() }),
      apply(tr, value, _oldState, newState): SectionFoldingState {
        const meta = tr.getMeta(sectionFoldingPluginKey) as Meta | undefined;
        if (meta) {
          if (meta.action === "toggle") {
            const next = new Set(value.folded);
            if (next.has(meta.uuid)) next.delete(meta.uuid);
            else next.add(meta.uuid);
            return { folded: next };
          }
          if (meta.action === "collapseAll") {
            return { folded: new Set(collectHeadingUuids(newState.doc)) };
          }
          if (meta.action === "expandAll") {
            return { folded: new Set() };
          }
          if (meta.action === "setFolded") {
            const alive = new Set(collectHeadingUuids(newState.doc));
            const next = new Set<string>();
            for (const u of meta.uuids) if (alive.has(u)) next.add(u);
            return { folded: next };
          }
        }
        // Doc may have changed — prune UUIDs that no longer exist so fold
        // state doesn't linger on removed headings.
        //
        // Cheap path via DocStructureObserver: only prune when the diff
        // says headings were actually removed. Most keystrokes (typing
        // inside any block, including a heading's text) leave the fold
        // set untouched.
        if (tr.docChanged && value.folded.size > 0) {
          const diff = readPendingDiff(newState);
          if (diff) {
            if (diff.removedHeadings.length === 0) return value;
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
            if (changed) return { folded: next };
            return value;
          }
          // Observer not installed (tests). Fall back to the full prune.
          const alive = new Set(collectHeadingUuids(newState.doc));
          let changed = false;
          const next = new Set<string>();
          for (const u of value.folded) {
            if (alive.has(u)) next.add(u);
            else changed = true;
          }
          if (changed) return { folded: next };
        }
        return value;
      },
    },
    props: {
      decorations(state) {
        const folded = this.getState(state)?.folded;
        if (!folded || folded.size === 0) return DecorationSet.empty;
        const hiddenIdx = computeFoldedChildIndices(state.doc, folded);
        if (hiddenIdx.size === 0) return DecorationSet.empty;
        const decos: Decoration[] = [];
        let offset = 0;
        state.doc.forEach((node, _o, i) => {
          if (hiddenIdx.has(i)) {
            decos.push(
              Decoration.node(offset, offset + node.nodeSize, {
                class: "section-folded",
              }),
            );
          }
          offset += node.nodeSize;
        });
        return DecorationSet.create(state.doc, decos);
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
    // SectionFoldingState (old vs new). The apply reducer above returns the
    // SAME object on a structurally-null tx (the `return value` no-op branches)
    // and a NEW object on every real change (toggle/collapseAll/expandAll/
    // setFolded/prune-with-removal), so a plain keystroke bails before any
    // querySelectorAll.
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
          // O(1) reference bail — the keystroke fast-path. `next === prev`
          // whenever the apply reducer returned the same object (no fold move).
          if (!next || next === prev) return;
          resync(next.folded);
        },
      };
    },
  });
}
