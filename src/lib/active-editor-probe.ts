import type { Editor } from "@tiptap/react";

/**
 * Resolve which editor a dev/verification probe (`window.__virgilBusStats`,
 * `window.__marginaliaStats`) should read when multiple are mounted at once
 * (multi-doc keep-alive). Precedence:
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
 */
export function pickProbeEditor(editors: Iterable<Editor>): Editor | null {
  const live = [...editors].filter((e) => !e.isDestroyed);
  if (live.length === 0) return null;
  const focused = live.find((e) => e.isFocused);
  if (focused) return focused;
  const visible = live.find((e) => {
    const dom = e.view?.dom as HTMLElement | undefined;
    return dom != null && dom.offsetHeight > 0;
  });
  if (visible) return visible;
  return live.length === 1 ? live[0] : null;
}
