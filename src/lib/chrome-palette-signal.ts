/**
 * **"The app's chrome palette on `:root` just changed."** (task 890)
 *
 * The user's Colors preferences (`PREF_TO_CSS` — `--topbar-bg`, `--topbar-border`,
 * …) are written onto the parent document's `:root` by ONE effect in
 * `EditorLayout`, and every surface in the parent document follows them for free
 * through `var()`. A same-origin IFRAME does not: it has its own `:root`, so a
 * surface rendered in one (the vendored pdf.js viewer, `PdfView`) must be TOLD
 * when the palette moves and copy the live values across itself.
 *
 * This is that telling — a plain listener set, fired once per palette write
 * (never per keystroke: the writing effect is gated on the prefs object). A
 * listener reads the live tokens with `getComputedStyle(document.documentElement)`;
 * the signal carries no payload, so it can never disagree with `:root`.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe; returns the unsubscribe. */
export function subscribeChromePalette(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called by the `:root` palette writer AFTER its writes have landed. */
export function notifyChromePaletteChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // One torn-down follower must not starve the rest.
    }
  }
}
