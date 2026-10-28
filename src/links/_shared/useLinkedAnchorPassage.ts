"use client";

import { useEffect, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { Fragment, Node as PMNode } from "@tiptap/pm/model";
import { useEditorRefContextOrNull } from "@/components/editor-layout/contexts/editor-ref";
import { getBus } from "@/lib/tiptap/doc-structure/bus";
import type { AnchorEntry } from "@/lib/tiptap/doc-structure/types";
import { resolveLinkedAnchorRange } from "@/lib/linked-anchor-range";
import { captureRangeContent } from "@/lib/tiptap/slice-capture";
import { isAnchorableNode } from "@/lib/marginalia";

/**
 * The passage under a `linkedAnchor` mark as it reads NOW, in BOTH currencies
 * a quoting card needs (task 1324).
 *
 *  - `text` — the PLAIN read, `doc.textBetween(from, to, " ")`: the same
 *    currency the create path captured `textSnapshot` in, so it compares equal
 *    to the stored recovery key when nothing was edited (task 700). It is a
 *    MATCH key, not display: Virgil declares no `leafText`, so every inline
 *    atom (citation, inline math, footnote marker, label) contributes nothing
 *    to it and every mark is gone.
 *  - `content` — the RICH read, the live range through the shared capture leaf
 *    (`captureRangeContent`, the same cut + normalize the Mode-B display
 *    capture and the archive door take). This is what a reader is shown: it
 *    keeps the passage's marks and its inline atoms, and is fed to
 *    `CapturedPassage`'s rich rung.
 */
export interface LinkedAnchorPassage {
  text: string;
  content: JSONContent;
}

/** The live passage plus the cut it was read from — the bail signature. */
interface LivePassage extends LinkedAnchorPassage {
  fragment: Fragment;
}

/**
 * The LIVE passage under the `linkedAnchor` mark `anchorId`, or `null` when no
 * text in the document carries it (task 700; rich half task 1324).
 *
 * A card that shows "the passage it is anchored to" must show what that
 * passage says NOW. The stored `textRange.textSnapshot` is the recovery key
 * for a LOST mark, frozen at create/re-anchor — rendering it meant an edit
 * inside a highlight never reached its card.
 *
 * Keystroke sanctity. No per-transaction subscriber and no doc walk:
 *   - the mark's range comes off the DocStructure snapshot (`anchors`, mapped
 *     per transaction by the observer), and the read walks ONLY that range;
 *   - the re-read is woken by the bus's PER-BLOCK content channel for the
 *     block(s) the range covers (`onBlockContentChanged` — a keyed dispatch,
 *     content-only, never counted in `emitCount`), so typing elsewhere wakes
 *     nothing and typing inside the passage costs O(passage);
 *   - the covering-block set is re-derived on STRUCTURAL emits (`onAnyChange`
 *     — a split/merge, an anchor added or removed) AND on this anchor's own
 *     extent channel (`onAnchorExtentChanged` — keyed, uncounted, task 1330).
 *     The second is load-bearing: a passage that MOVES (a text drag-drop into
 *     another block, or its undo) is a `changedAnchors` entry, which wakes no
 *     structural watcher — without it the subscription stayed keyed on the
 *     block the passage LEFT, and typing inside the moved run reached nothing.
 * A wake whose range content is `Fragment.eq` to the last read keeps the SAME
 * object, so typing inside the block but outside the mark re-renders nothing
 * and re-captures nothing.
 */
export function useLinkedAnchorPassage(
  anchorId: string | null | undefined,
): LinkedAnchorPassage | null {
  const editor = useEditorRefContextOrNull()?.editorInstance ?? null;
  const [passage, setPassage] = useState<LivePassage | null>(() =>
    readLive(editor, anchorId, null),
  );

  useEffect(() => {
    if (!editor || !anchorId) {
      setPassage(null);
      return;
    }
    const refresh = () => setPassage((prev) => readLive(editor, anchorId, prev));
    const bus = getBus(editor);
    if (!bus) {
      refresh();
      return;
    }
    let blockUnsubs: Array<() => void> = [];
    let coveredKey = "";
    const resubscribe = () => {
      const entry = bus.structure.anchors.get(anchorId);
      const uuids = entry && !editor.isDestroyed ? coveringBlockUuids(editor.state.doc, entry) : [];
      const key = uuids.join("|");
      if (key === coveredKey) return;
      coveredKey = key;
      for (const u of blockUnsubs) u();
      blockUnsubs = uuids.map((uuid) => bus.onBlockContentChanged(uuid, refresh));
    };
    resubscribe();
    refresh();
    const rederive = () => {
      resubscribe();
      refresh();
    };
    const unsubAny = bus.onAnyChange(rederive);
    const unsubExtent = bus.onAnchorExtentChanged(anchorId, rederive);
    return () => {
      unsubAny();
      unsubExtent();
      for (const u of blockUnsubs) u();
    };
  }, [editor, anchorId]);

  return passage;
}

function readLive(
  editor: Editor | null,
  anchorId: string | null | undefined,
  prev: LivePassage | null,
): LivePassage | null {
  if (!editor || !anchorId || editor.isDestroyed) return null;
  // The live door (task 926): snapshot-bounded, and it resolves the anchor's
  // deferred maps without materializing the whole snapshot.
  const { state } = editor;
  const range = resolveLinkedAnchorRange(state, anchorId);
  if (!range) return null;
  const { doc } = state;
  const fragment = doc.slice(range.from, range.to).content;
  if (prev && prev.fragment.eq(fragment)) return prev;
  return {
    text: doc.textBetween(range.from, range.to, " "),
    content: captureRangeContent(doc, range.from, range.to),
    fragment,
  };
}

/** Every anchorable block uuid the range touches — the enclosing ancestors of
 *  its start plus any anchorable node inside it — i.e. every uuid the step
 *  inspector could attribute an edit inside the passage to. O(range). */
function coveringBlockUuids(doc: PMNode, entry: AnchorEntry): string[] {
  const size = doc.content.size;
  const from = Math.max(0, Math.min(entry.from, size));
  const to = Math.max(from, Math.min(entry.to, size));
  const out = new Set<string>();
  const $from = doc.resolve(from);
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    const uuid = (node.attrs as { uuid?: string | null }).uuid;
    if (uuid && isAnchorableNode(node.type)) out.add(uuid);
  }
  doc.nodesBetween(from, to, (node) => {
    if (node.isText) return false;
    const uuid = (node.attrs as { uuid?: string | null }).uuid;
    if (uuid && isAnchorableNode(node.type)) out.add(uuid);
    return true;
  });
  return [...out].sort();
}
