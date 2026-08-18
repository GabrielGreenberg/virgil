# Card +T title prompt should follow the page-level title toggle — 2026-06-30

Bug-catcher session. One item. Research only — **no code edited** (checkout
live-driven, HEAD 1b776636). For the bug-cleaning session.

## Status: `ROOT-CAUSE-FOUND` (high confidence)

**Request:** "The +T title prompt should go away for cards if it is turned off for
the page (and on if on)." When the page-level card-title toggle is OFF, cards must
not show the hover-revealed **+T** add-title prompt; when ON, they should.

## Root cause — card titles have no page-level pref; the paragraph analog does

`CardBodyTitle` (the +T empty-title prompt, [panel-primitives.tsx:596-673](src/components/panel-primitives.tsx#L596)) **unconditionally** renders the +T button whenever no title is set (`!hasTitle`, the render at ~:656-671, wrapped in `.card-title-add-only`). It has **no page-level visibility control** — no pref, no class, no CSS gate. So the card +T ignores the page toggle entirely.

The **parallel paragraph-title feature already has exactly this control**, and is the pattern to mirror:
- Pref: `showParTitles` — [VIEW_PREF_REGISTRY registry.ts:66](src/components/editor-layout/view-prefs/registry.ts#L66) (kind `toggle`, scope `global`, default `true`).
- Class: `viewToggleClasses` emits `.hide-par-titles` when it's false — [chrome-config.ts:72](src/components/editor-layout/chrome-config.ts#L72).
- CSS: [globals.css:3950](src/app/globals.css#L3950) `.hide-par-titles .par-title-annotation { display: none }`.

Card titles have no `showCardTitles` pref, no `.hide-card-titles` class, and no CSS — hence the reported inconsistency (the page toggle governs paragraph +T but not card +T).

## Deep fix — mirror `showParTitles` as a registry-driven global pref

Do it via **CSS-class propagation** (not a new prop threaded through every `EditableCard` caller) — the view-toggle classes already reach the editor-pane column and float popouts, so a class on the shared ancestor propagates for free and survives reload + popout via the existing `VIEW_PREF_REGISTRY` SSOT ([[view_prefs_persistence_audit_status]]).

1. **Add the pref** — `registry.ts` (near :66): `showCardTitles: { kind: "toggle", scope: "global", default: true, label: "Card titles", menu: "display" }`. **The `useViewPrefs.defaults.json` default MUST stay byte-identical** (the promote-defaults pipeline — see [[release_prefs_snapshot_gotcha]]).
2. **Emit the class** — `chrome-config.ts` (~:72): `if (menuBar.showCardTitles === false) tokens.push("hide-card-titles")`.
3. **Hide the +T** — `globals.css` (near :3950): `.hide-card-titles .card-title-add-only { display: none !important; }`.

**Target `.card-title-add-only`, NOT `.card-title-input`** — so the toggle hides only the empty-title +T PROMPT while EXISTING set titles stay visible, matching the paragraph-title behavior (where only the +T hides, not set titles). Confirm this is the intended semantics against the paragraph precedent (very likely — "the +T prompt should go away," not "hide all titles").

**Surgical = essentially the same three edits** (it's already the minimal mirror of the paragraph pattern). No prop threading needed if `.hide-card-titles` lands on the same ancestor that already carries `.hide-par-titles`.

## Live-verify (dev preview OK for this one; also confirm persistence)
- Page-level card-title toggle OFF → no +T prompt on any card; **existing set card titles still visible**.
- Toggle ON → +T reappears on empty-title cards.
- Reload → pref persists (global scope). Pop out a card float → the `.hide-card-titles` class reaches the float so the pref propagates there too.
- Confirm the toggle lives in the same menu/group as the paragraph "titles" toggle (`menu: "display"`) so the two read as siblings.
