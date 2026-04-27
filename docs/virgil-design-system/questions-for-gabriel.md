# Questions for Gabriel

Items I deferred during the autonomous run because they need your judgment (or the design Claude's). Numbered roughly by impact. Full context for each lives in [migration-feedback.md](migration-feedback.md).

> **Status update (2026-04-26):** Most items below have since been resolved. Each question now carries a status tag — `RESOLVED`, `MANUAL CHECK`, or `STILL OPEN` — so the residue is small and obvious.

## 1. Was `comment: themeFromAccent(DEFAULT_PANEL_COLORS.revision)` intentional? — `RESOLVED`

The Pass 6 patch in `panel-theme.ts.patch.md` specifies that the `comment` card kind derives from the `revision` accent (purple, `#9333ea`). The legacy `comment` row was stone (`bg-stone-100/60`, `border-stone-400`), and its only consumer in this codebase is the SearchPanel result card — which I deliberately set to `comment` in Pass 2 to get a *neutral* selection border.

I deviated from the patch and used `DEFAULT_PANEL_COLORS.todo` (stone) for `comment`. If you/the design Claude actually meant purple, swap one line in [src/components/panel-primitives.tsx](src/components/panel-primitives.tsx) `CARD_THEMES.comment`.

If you confirm purple, also reconsider Pass 2's SearchPanel choice — search results would now have a purple selection border, which probably isn't what we want. Two follow-ups in that case:
- Map `result.scope` to the appropriate `CARD_THEMES` key per scope (footnote → footnote, note → note, etc.) so each result wears its kind's theme color.
- Or pick a different neutral kind. None of `footnote/note/archive/todo/bib/citation/aiRequest/cut/example` is truly neutral; we'd need a new `CARD_THEMES.neutral`.

**Resolution.** Purple was the patch's correct intent. The merger is now codified in [src/components/panel-primitives.tsx:135-138](src/components/panel-primitives.tsx) — comment and revision are a single accent-purple identity. The SearchPanel concern was solved by the per-scope map (Q2).

## 2. Should SearchPanel cards track per-scope theme? — `RESOLVED`

Right now `themedCard(CARD_THEMES.comment, selected)` gives every search result the same stone selection border. The existing inline `borderLeftColor` (`SCOPE_COLOR[result.scope]`) already differentiates per scope at rest — but selection collapses to a single neutral.

If you want each search result to wear its source kind's theme on selection (footnote red, note emerald, etc.), wire a `SearchScope → CARD_THEMES key` map in [src/panels/Search/SearchPanel.tsx:725](src/panels/Search/SearchPanel.tsx:725). ~15 lines.

**Resolution.** Done. [SearchPanel.tsx:710-721](src/panels/Search/SearchPanel.tsx) carries a `SCOPE_TO_CARD_THEME` map; each result wears its source kind's theme on selection.

## 3. Does `iconbtn-*` need a dark-context variant? — `RESOLVED`

`iconbtn-*` hovers to `--surface-muted-strong` (light grey). On colored card headers (red-100, emerald-100, amber-100, etc.) — where `TargetIcon` and `TargetFileIcon` live — the legacy `hover-on-dark` overlay (`rgba(0,0,0,0.04)`) was visually softer. Subtle clash post-Pass-4 on colored headers.

Options:
- Add an `iconbtn-on-dark` variant with the dark-overlay hover (clean, ~10 lines in globals.css).
- Scope a per-context override in CSS: `[data-card-selected="true"] .iconbtn-md:hover { background-color: rgba(0,0,0,0.04); }` (less explicit, fragile).
- Live with it. The shift is small (light tint → light grey on tinted bg).

Pass 6 reworked the card-header shape; this is a Pass 6 follow-up if you want it.

**Resolution.** First option taken. `iconbtn-on-dark` lives at [src/app/globals.css:294-305](src/app/globals.css) and is adopted by `TargetIcon` / `TargetFileIcon` in [src/components/panel-primitives.tsx:1481,1512](src/components/panel-primitives.tsx).

## 4. Does `iconbtn-*` need an accent / active variant? — `RESOLVED`

Many topbar / sidebar-strip / tab buttons in [src/components/EditorLayout.tsx](src/components/EditorLayout.tsx) couldn't migrate to `iconbtn-*` because they have:
- `hover:text-[var(--accent)]` (accent text on hover, not muted-grey).
- `bg-[var(--accent-light)] shadow-[inset_0_0_0_1px_rgba(...)]` on active state (toggle-on look).
- Stateful coloring `aria-pressed`-style with the accent color.

Spec's `iconbtn-*[aria-pressed="true"]` uses `--pod-dark` (grey), not accent. Roughly 10 sites stay hand-rolled.

Options:
- Add `iconbtn-accent` / `iconbtn-toggle` variants (modest globals.css addition).
- Codify a `<Button variant="toggle">` for the toggle case — Pass 5's button variants don't model toggle yet either.
- Live with hand-rolled topbar buttons. They're a small surface and the spec's "five variants" is satisfied.

**Resolution.** First option taken in two waves.
- `iconbtn-toggle` ([globals.css:307-318](src/app/globals.css)) covers the active-state toggles. Adopted at six EditorLayout sites + the drag-drop target.
- `iconbtn-accent` ([globals.css:320-328](src/app/globals.css)) covers hover-to-accent on light parents. Adopted at the Open-folder "+", Preferences palette, and Version-info chrome buttons.
- Sites deliberately left hand-rolled: focus-view exit chip (always-active, not a hover); Zen mode toggle (text-only pill); AI requests button (sky color, not accent); Code/Visual switch and Compile (icon+text pills, not pure icon buttons).

## 5. Confirm the Pass 5 visual rebrands — `MANUAL CHECK`

Modal footers and several primary actions changed visual:
- Old `primary` / `accent` (filled grey-800 or filled accent-brown) → new `primary` (filled accent-brown). Modal "Save", "Submit", "Confirm" etc. all rebrand to brown.
- Old `danger` (filled `#b45757`) → new `danger` (soft red bg, red text, thin red border). Confirm/discard buttons read less aggressive.
- Old `bg-emerald-600 white` Accept (suggestion flow) → `<Button variant="warm">` (soft accent-light-bg with accent text). Accept reads as "warm yes" rather than "green check".
- Old `bg-stone-700 white` Submit (AI window, BibEntryCard Save, etc.) → `<Button variant="primary">` (filled brown).

Eyeball each in dev preview before considering Pass 5 truly done. The migration spec asked for these shifts, so the rebrands are intended; the question is whether the *result* looks right in context.

**Status.** Manual eyeball pass against the [virgil-data/doc_devtest](virgil-data/doc_devtest/) sample is still needed.

## 6. Should `error` and `comment` re-color when their proxy panel is re-colored? — `RESOLVED`

Pass 6 set:
- `error: themeFromAccent(DEFAULT_PANEL_COLORS.footnote)` — error cards inherit the footnote accent.
- `comment: themeFromAccent(DEFAULT_PANEL_COLORS.todo)` — my deviation; comment inherits todo.

So if a user picks a custom footnote color, error cards re-tint too. Same with comment ↔ todo. This is the patch's intended coupling but might surprise users.

Decide:
- Keep coupling (current state).
- Decouple: hardcode error and comment accents in `CARD_THEMES`, like `aiRequest: themeFromAccent("#0ea5e9")`.

**Resolution.** `error` was decoupled to a hardcoded `#b45757` in [panel-primitives.tsx:143](src/components/panel-primitives.tsx). `comment` was merged with `revision` (Q1) so it tracks the user-customizable revision color — which is intended, since revisions and comments share an identity.

## 7. Did Pass 1's `--citation-bg` shift cause any visible drift? — `MANUAL CHECK`

Pass 1 changed `--citation-bg`'s static fallback from `#fdf8e1` to `#fef9e7` (slightly warmer cream). At runtime it's overridden by [src/lib/preferences-tree.ts:351](src/lib/preferences-tree.ts:351) for any user with citation prefs set, so most users won't see it. Worth confirming on a fresh user (no preferences applied) that citations look right.

**Status.** Fresh-user check (private/incognito browser, no IndexedDB prefs) still pending.

## 8. Reference baseline? — `STILL OPEN` (decision)

`MIGRATION.md` originally said "verify visually against `reference.html`." That file doesn't exist. I removed the reference from the doc. If you'd rather have a screenshot baseline (so future migrations can diff visually), capturing it now while we're at a clean state — would take maybe 10 minutes with `preview_screenshot` over each panel — would set up future passes for visual-regression checking.

**Recommendation.** Defer unless another design-system pass is imminent. The repo has no visual-regression infrastructure (no Storybook, no Chromatic), so a screenshot folder would only serve human eyeballing. If yes, capture under `docs/virgil-design-system/baseline-2026-04/`.

---

## Status

All seven migration passes shipped (commits `46dfc5a` → `4740333`). Cleanup work also shipped: `pnpm typecheck` script, redundant `transition-colors` sweep, MIGRATION.md corrections, the pre-existing `migrate-card.test.ts:73` revision/CardKind error fix.

**2026-04-26 follow-up pass:**
- Q1, Q2, Q3, Q4, Q6 closed (see resolutions above).
- `iconbtn-accent` variant added to close the residual half of Q4.
- Q5 and Q7 remain manual visual checks.
- Q8 awaits a yes/no decision.

Working tree is clean. tsc clean (no errors), `next build` clean, vitest 29/29.

[migration-feedback.md](migration-feedback.md) is the running log of every flag I raised across the seven passes — read it for any context that's not in this file.
