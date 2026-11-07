/**
 * rewriteTexOutOfBand — the ONE door for rewriting the paper's `.tex` outside
 * the editor's own save (task 1501).
 *
 * Three gestures replace bytes the editor's model does not own wholesale: the
 * Style dropdown (`useDocumentStyle.setStyle` — the preamble), the doc-type
 * control (`setDocumentClass` — the `\documentclass` name), and the compile
 * path's class-mismatch prompt (`runCompileForDoc`). Each used to hand-roll
 * the same sequence, and the copies had already drifted: the compile copy
 * read the file, then AWAITED A USER DIALOG for as long as the user liked,
 * then wrote a rewrite of the bytes it read BEFORE the dialog — overwriting
 * anything a cowork skill, another window or a sync client landed meanwhile.
 *
 * The door's contract, in order:
 *  1. **Drain** (`drainDoc`): every pending debounced write lands first — the
 *     bundle autosave, and the code pane's bridge, whose `settle` flusher
 *     (task 559) commits a preamble edit still sitting in its debounce. (This
 *     is why the old pre-write "will-change" event is gone: the drain already
 *     IS that flush.)
 *  2. **Resolve the handle at write time** (task 1277): never a mount-time
 *     capture, which a pane's unmount turns stale.
 *  3. **Transform a FRESH read inside the write queue** (`rewriteTex`): the
 *     read and the write are one critical section, so the transform's base
 *     is the file as it stands — compare-and-swap, not read-then-hope.
 *     A caller that must ASK the user decides first and calls this AFTER the
 *     answer; the transform is pure and synchronous.
 *  4. **Tell the code pane** (`dispatchTexDelimitersChanged`) when bytes
 *     actually changed, so an open code view re-reads its delimiter closure
 *     instead of persisting the stale preamble back.
 *
 * A `StalePipelineError` (the doc closed mid-gesture) propagates: the callers
 * word it, each in its own register.
 */

import { drainDoc, rewriteTex, type TexTransform } from "@/lib/storage";
import { getActiveHandle } from "@/lib/multi-window/doc-pipeline";
import { dispatchTexDelimitersChanged } from "@/lib/tex-delimiters-event";

export type TexRewriteOutcome = "written" | "unchanged" | "undecodable" | "no-handle";

export async function rewriteTexOutOfBand(
  docId: string,
  transform: TexTransform,
): Promise<TexRewriteOutcome> {
  await drainDoc(docId);
  const handle = getActiveHandle(docId);
  if (!handle) return "no-handle";
  const result = await rewriteTex(handle, transform);
  if (result === "written") dispatchTexDelimitersChanged(docId);
  return result;
}
