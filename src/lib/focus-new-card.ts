/**
 * Drop the caret into the main editable field of a newly-created card
 * (note body, footnote body, citation command input, todo title,
 * comment textarea, …). The card mounts asynchronously after the
 * underlying React state update, so we retry across a few frames
 * before giving up.
 *
 * Shared between the drag-handle action dispatcher and the editor's
 * command-input bridge (so typing `\cite ` / invoking the slash-popup
 * `\cite` lands the caret on the new card's merged search input, just
 * like the drag-handle path does).
 */
import { parseAnyKey, migrateLegacyKeyToFloat } from "@/floats/float-key";

export function focusNewCard(cardKey: string): void {
  // Normalize to the canonical `float:card:<kind>:<id>` grammar the card stamps
  // on `data-card-key`, so a caller that still passes a legacy `<prefix>:<id>`
  // key (or already-canonical key — idempotent) resolves the DOM either way.
  const domKey = migrateLegacyKeyToFloat(cardKey);
  // The canonical card kind (drives `pickFocusTarget`), via the dual-read parser.
  // `parseAnyKey` resolves both legacy and `float:` grammars, so no colon-slice
  // fallback is needed (slicing a `float:card:<kind>:<id>` key would yield the
  // "float" domain, not the kind); an unparseable key → "" → the default target.
  const kind = parseAnyKey(domKey)?.kind ?? "";
  let attempts = 0;
  const MAX_ATTEMPTS = 12;
  const tryFocus = () => {
    const card = document.querySelector<HTMLElement>(
      `[data-card-key="${CSS.escape(domKey)}"]`,
    );
    if (!card) {
      if (++attempts < MAX_ATTEMPTS) requestAnimationFrame(tryFocus);
      return;
    }
    const target = pickFocusTarget(card, kind);
    if (!target) {
      if (++attempts < MAX_ATTEMPTS) requestAnimationFrame(tryFocus);
      return;
    }
    try {
      target.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
    // Contenteditable / ProseMirror: drop the caret at the end of the
    // existing content so the user starts typing into the body, not
    // before it.
    if (target.isContentEditable) {
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
      } catch {
        /* ignore */
      }
    } else if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      // Place caret at end of any pre-seeded text.
      try {
        const len = target.value.length;
        target.setSelectionRange(len, len);
      } catch {
        /* ignore */
      }
    }
  };
  // Two RAFs to let React commit + the panel re-render before we hunt
  // for the card.
  requestAnimationFrame(() => requestAnimationFrame(tryFocus));
}

/** Pick the most-likely "main editing field" inside a card's DOM,
 *  per card kind. Order of preference inside each kind matches the
 *  way each card lays out its primary editable. */
function pickFocusTarget(card: HTMLElement, kind: string): HTMLElement | null {
  const findEditable = () =>
    card.querySelector<HTMLElement>('[contenteditable="true"]');
  const findTextarea = () => card.querySelector<HTMLTextAreaElement>("textarea");
  const findTextInput = () =>
    card.querySelector<HTMLInputElement>(
      'input[type="text"], input:not([type])',
    );

  switch (kind) {
    case "note":
    case "footnote":
    case "archive":
    case "report":
    case "report-request":
      // Rich-text body lives in a contenteditable ProseMirror element.
      return findEditable() ?? findTextarea() ?? findTextInput();
    case "todo":
      // Todo text lives in the title input.
      return findTextInput() ?? findTextarea() ?? findEditable();
    case "revision":
    case "revision-comment":
    case "cutter-comment":
    case "revision-suggestion":
    case "cutter-suggestion":
      // Comment/suggestion cards use a textarea for the dialogue/body.
      return findTextarea() ?? findEditable() ?? findTextInput();
    case "citation":
      // Citation cards show the merged "Add from library…" input on
      // empty rows; prefer that. Fall back to clicking the CODE Edit
      // affordance if the card has no empty row.
      {
        const input = findTextInput() ?? findTextarea();
        if (input) return input;
        const editBtn = Array.from(
          card.querySelectorAll<HTMLButtonElement>("button"),
        ).find((b) => /^\s*edit\s*$/i.test(b.textContent ?? ""));
        if (editBtn) {
          editBtn.click();
          // Retry on next frame so the input rendered by Edit mode can
          // be found.
          return null;
        }
        return findEditable();
      }
    default:
      return findEditable() ?? findTextarea() ?? findTextInput();
  }
}
