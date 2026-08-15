import type { Editor } from "@tiptap/react";

/**
 * The ONE "which editor is active?" ladder, shared by every module-level
 * registry that has to answer it (multi-doc keep-alive mounts N `EditorPane`s
 * at once — one visible, the rest `display:none`). Precedence:
 *
 *  1. the FOCUSED editor — the one being typed into (the keystroke-sanctity
 *     check cares about this);
 *  2. else the VISIBLE editor — its keep-alive slot is `display:flex` so its
 *     ProseMirror DOM has `offsetHeight > 0`; warm/hidden slots are
 *     `display:none` ⇒ `offsetHeight === 0`. This is the load-bearing fallback:
 *     when the dev runs the probe from the DevTools console, NO editor is
 *     focused, and a focus-only resolver would return null exactly then;
 *  3. else, if exactly one editor is live, that one;
 *  4. else null (genuinely ambiguous — don't guess).
 *
 * `pickActiveByEditor` is the general form: a registry keyed by something OTHER
 * than the editor (a pane token, a handle) passes its entries plus an accessor
 * and gets the winning ENTRY back, so it never has to map to editors, pick, and
 * search back — a dance each such registry would otherwise re-derive. An entry
 * whose accessor answers `null` (a pane whose editor hasn't been created yet, a
 * view-less legacy slot) simply doesn't participate; the caller decides what to
 * do when nothing wins.
 */
export function pickActiveByEditor<T>(
  items: Iterable<T>,
  getEditor: (item: T) => Editor | null | undefined,
): T | null {
  const live = [...items].filter((it) => {
    const e = getEditor(it);
    return e != null && !e.isDestroyed;
  });
  if (live.length === 0) return null;
  const focused = live.find((it) => getEditor(it)!.isFocused);
  if (focused) return focused;
  const visible = live.find((it) => {
    const dom = getEditor(it)!.view?.dom as HTMLElement | undefined;
    return dom != null && dom.offsetHeight > 0;
  });
  if (visible) return visible;
  return live.length === 1 ? live[0] : null;
}

/**
 * Resolve which editor a dev/verification probe (`window.__virgilBusStats`,
 * `window.__marginaliaStats`) should read. The identity case of
 * {@link pickActiveByEditor}.
 */
export function pickProbeEditor(editors: Iterable<Editor>): Editor | null {
  return pickActiveByEditor(editors, (e) => e);
}
