"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useEditorRefContextOrNull } from "@/components/editor-layout/contexts/editor-ref";
import { getBus } from "@/lib/tiptap/doc-structure/bus";
import type { AnchorEntry } from "@/lib/tiptap/doc-structure/types";
import { readLinkedAnchorText } from "@/lib/linked-anchor-range";
import { isAnchorableNode } from "@/lib/marginalia";

/**
 * The LIVE text under the `linkedAnchor` mark `anchorId`, or `null` when no
 * text in the document carries it (task 700).
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
 *   - the covering-block set is re-derived on STRUCTURAL emits only
 *     (`onAnyChange` — a split/merge, an anchor added or removed).
 * `setState` with an unchanged string bails, so typing inside the block but
 * outside the mark re-renders nothing.
 */
export function useLinkedAnchorText(anchorId: string | null | undefined): string | null {
  const editor = useEditorRefContextOrNull()?.editorInstance ?? null;
  const [text, setText] = useState<string | null>(() => readLive(editor, anchorId));

  useEffect(() => {
    if (!editor || !anchorId) {
      setText(null);
      return;
    }
    const bus = getBus(editor);
    if (!bus) {
      setText(readLive(editor, anchorId));
      return;
    }
    let blockUnsubs: Array<() => void> = [];
    let coveredKey = "";
    const refresh = () => setText(readLive(editor, anchorId));
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
    const unsubAny = bus.onAnyChange(() => {
      resubscribe();
      refresh();
    });
    return () => {
      unsubAny();
      for (const u of blockUnsubs) u();
    };
  }, [editor, anchorId]);

  return text;
}

function readLive(editor: Editor | null, anchorId: string | null | undefined): string | null {
  if (!editor || !anchorId || editor.isDestroyed) return null;
  const bus = getBus(editor);
  if (!bus) return readLinkedAnchorText(editor.state.doc, anchorId);
  const entry = bus.structure.anchors.get(anchorId);
  if (!entry) return null;
  return readLinkedAnchorText(editor.state.doc, anchorId, entry);
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
