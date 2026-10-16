/**
 * Drop the caret into the main editable field of a newly-created card
 * (note body, footnote body, citation command input, todo title,
 * comment textarea, …). The card mounts asynchronously after the
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
import { parseAnyKey, migrateLegacyKeyToFloat } from "@/floats/float-key";
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
  // The canonical card kind (drives `pickFocusTarget`), via the dual-read parser.
  // `parseAnyKey` resolves both legacy and `float:` grammars, so no colon-slice
  // fallback is needed (slicing a `float:card:<kind>:<id>` key would yield the
  // "float" domain, not the kind); an unparseable key → "" → the default target.
  const kind = parseAnyKey(domKey)?.kind ?? "";
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
    const target = pickFocusTarget(card, kind);
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

/**
 * The SSOT for "creating a card of this kind should drop the caret into its
 * body" — read by the central `finishCreate` chokepoint to decide whether to
 * expand + focus a freshly-created card. It mirrors the editable-body kinds
 * `pickFocusTarget` knows how to target, with two deliberate carve-outs:
 *
 *  - `highlight` — no user-typed body (a color + range); `pickFocusTarget`
 *    returns `null` for it anyway, so it would be a harmless no-op, but gating
 *    the EXPAND keeps a bodiless highlight from being needlessly expanded.
 *  - `citation` — its create popover / library-picker owns its own focus
 *    (CHIP 4a-ii); the user's request ("drop the cursor into the new card's
 *    body") is satisfied by the popover, so we do NOT expand/focus the citation
 *    panel card.
 *
 * `example` / `bib` / `error` are system/derived kinds with no user-initiated
 * "type into the body" create gesture, so they're out too.
 *
 * Keep this in lockstep with `pickFocusTarget`'s editable kinds: a new
 * editable-body kind should appear in BOTH.
 */
const EDITABLE_BODY_KINDS: ReadonlySet<string> = new Set([
  "note",
  "footnote",
  "archive",
  "report",
  "report-request",
  "todo",
  "revision-comment",
  "revision-suggestion",
  "cutter-comment",
  "cutter-suggestion",
]);

export function cardKindHasEditableBody(kind: string): boolean {
  return EDITABLE_BODY_KINDS.has(kind);
}
