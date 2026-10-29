/**
 * Drop the caret into the PRIMARY field of a newly-created card — the one the
 * card itself stamps (`data-card-primary-field`, task 1358): note body,
 * footnote body, citation library input, todo title, suggestion textarea, ….
 * Which kinds are focused on create is `CARD_REGISTRY[kind].createFocus`
 * (`focusesBodyOnCreate`), not this module. The card mounts asynchronously after the
 * underlying React state update, so we retry across a few frames
 * before giving up.
 *
 * ## The caller OWNS the retry (task 1146)
 *
 * Every frame of the retry is scheduled through the CALLER's `ViewLifetime`
 * (`useViewLifetime` in the requesting hook/component), so the chain can never
 * outlive the surface that asked for the focus — the React half of
 * docs/agents/laws/a-nodeview-owns-its-timers-lifetime.md. MAX_ATTEMPTS is
 * still the wall-clock bound; the owner's disposal is the OUTER bound. The
 * unowned chain this replaces (up to 14 free-running RAFs) kept firing after
 * an unmount — under a loaded full vitest run, after jsdom's teardown, where
 * `CSS.escape` threw six unhandled errors and turned the gate red.
 *
 * Focus is one per window, so a NEWER request supersedes a pending one (the
 * user created a second card before the first's body mounted): at most one
 * chain is ever armed, and it is cancelled by whichever comes first — success,
 * exhaustion, supersession, or the owner's disposal.
 *
 * Shared between the drag-handle action dispatcher and the editor's
 * command-input bridge (so typing `\cite ` / invoking the slash-popup
 * `\cite` lands the caret on the new card's merged search input, just
 * like the drag-handle path does).
 */
import { attrSelector } from "@/lib/attr-selector";
import { migrateLegacyKeyToFloat } from "@/floats/float-key";
import { cardStampsPrimaryField, findCardPrimaryField } from "@/lib/card-primary-field";
import { isPaneElementVisible } from "@/lib/keep-alive/pane-visibility";
import type { ViewLifetime, ViewTimer } from "@/lib/tiptap/view-lifetime";

/** The one pending request (focus is window-global — see the header). */
let pendingRequest: { cancel: () => void } | null = null;

/** Test/diagnostic probe: is a focus retry currently armed? */
export function hasPendingCardFocus(): boolean {
  return pendingRequest !== null;
}

export function focusNewCard(cardKey: string, owner: ViewLifetime): void {
  pendingRequest?.cancel();
  // Normalize to the canonical `float:card:<kind>:<id>` grammar the card stamps
  // on `data-card-key`, so a caller that still passes a legacy `<prefix>:<id>`
  // key (or already-canonical key — idempotent) resolves the DOM either way.
  const domKey = migrateLegacyKeyToFloat(cardKey);
  let attempts = 0;
  const MAX_ATTEMPTS = 12;
  let frame: ViewTimer | null = null;
  let settled = false;
  let unregister: () => void = () => {};
  const request = { cancel };
  function cancel() {
    if (settled) return;
    settled = true;
    owner.clear(frame);
    unregister();
    if (pendingRequest === request) pendingRequest = null;
  }
  const schedule = (fn: () => void) => {
    if (!settled) frame = owner.requestAnimationFrame(fn);
  };
  const retry = () => {
    if (++attempts < MAX_ATTEMPTS) schedule(tryFocus);
    else cancel();
  };
  const tryFocus = () => {
    if (settled) return;
    // A card can render in MULTIPLE places at once — the docked panel AND the
    // omni margin. `querySelector` returns the first in DOM order, which may be
    // a HIDDEN (compressed / `display:none` keep-alive) instance whose body
    // isn't mounted. Pick the VISIBLE one (`isPaneElementVisible`, the ONE
    // keep-alive visible rung) so we focus a real body, not a collapsed twin.
    // Fall back to the first match (jsdom lays nothing out, and tests mount a
    // single instance anyway).
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(attrSelector("data-card-key", domKey)),
    );
    const card =
      candidates.find(isPaneElementVisible) ?? candidates[0] ?? null;
    if (!card) {
      retry();
      return;
    }
    const target = pickFocusTarget(card);
    if (!target) {
      retry();
      return;
    }
    cancel();
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
  pendingRequest = request;
  unregister = owner.onDispose(cancel);
  // Two RAFs to let React commit + the panel re-render before we hunt
  // for the card.
  schedule(() => schedule(tryFocus));
}

/** The field to focus inside a freshly-created card. The card NAMES it — its
 *  stamped `data-card-primary-field` (task 1358); while that stamp's field has
 *  not mounted yet (a RichTextField's editor is async) this returns `null` and
 *  the caller retries. Only a card that stamps nothing (a kind added without a
 *  stamp — `create-focus-census.test.tsx` fails that for every `createFocus:
 *  "body"` kind) falls back to the first editable field in DOM order. */
function pickFocusTarget(card: HTMLElement): HTMLElement | null {
  if (cardStampsPrimaryField(card)) return findCardPrimaryField(card);
  return (
    card.querySelector<HTMLElement>('[contenteditable="true"]') ??
    card.querySelector<HTMLTextAreaElement>("textarea") ??
    card.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')
  );
}
