# MIGRATION.md

Pass-by-pass execution plan. **Do one pass per PR.** Don't combine.

After each pass: run `pnpm typecheck`, `pnpm build`, `pnpm test`. Open
the app, click through all panels, verify visually. Report changes
back before starting the next pass. (Notes from execution live in
[migration-feedback.md](migration-feedback.md) and inform the
corrections inlined below.)

---

## Pass 1 — Tokens

**Goal.** New token block in `globals.css`. No component code changes.

Files touched:
- `src/app/globals.css` (replace the `:root` token block; see
  `patches/globals.css.patch.md`).
- `src/STYLE_GUIDE.md` (replace with `11-style-guide.md`).

Concrete changes:

1. Add the warm-amber consolidation: `--amber-50`, `--amber-100`,
   `--amber-200`, `--amber-500`. Citations, bibliography, and quotes
   use these.
2. Add the footnote scale: `--footnote-50`, `--footnote-100`,
   `--footnote-200`, `--footnote-300`, `--footnote-500`. Existing
   `--footnote-bg`, `--footnote-color` alias into the scale.
3. Replace `.footnote-marker[data-card-selected="true"]` and the
   citation selector's `rgba(251, 191, 36, 0.9)` with
   `var(--ring-drag-target)`.
4. Add `hover-on-light` and `hover-on-dark` utility classes
   (used in Pass 3).
5. Add `iconbtn-sm`, `iconbtn-md`, `iconbtn-lg` utility classes
   (used in Pass 4).

**Verify.** App renders identically to before this pass. The new
classes are unused; the new tokens are unused. This pass is purely
additive to the foundation.

---

## Pass 2 — Selection

**Goal.** Delete the amber `CARD_SELECTED` default. Every card uses its
theme.

Files touched:
- `src/components/panel-primitives.tsx`.
- Direct callers of `panelCard()` outside the centralized PanelCard
  render path. **Note from execution:** in this codebase that meant
  exactly **one** site (`src/panels/Search/SearchPanel.tsx`) — every
  other panel routes through `<PanelCard theme={...}>`, which renders
  the new `themedCard(theme, ...)` internally. Don't expect a wide
  compile-error sweep.

Concrete changes:

1. Delete `CARD_SELECTED`, `CARD_SELECTED_FOOTNOTE`, `_NOTE`, `_TODO`,
   `_CUT`. Replace with a single `themedCard(theme, selected, extra)`
   that reads `theme.borderSelected`.
2. Update `PanelCard`'s internal call from `theme.cardClass(...)` to
   `themedCard(theme, ...)`. (`theme.cardClass` is removed.)
3. Update direct external callers of `panelCard(selected)` — pass a
   theme. SearchPanel results are heterogeneous; default to
   `CARD_THEMES.comment` (stone) since per-result coloring is already
   handled by an inline `borderLeftColor` style.

**Verify.** Every card kind selects with its theme color. There is no
amber-bordered card anywhere except `aiRequest` (which is sky, so really
nowhere). Run through every panel: footnotes, notes, archive, todo, bib,
citations, comments, AI requests, cut, errors, examples.

---

## Pass 3 — Hover

**Goal.** Codify hover. Sweep neutral hover-bg utilities.

Files touched:
- `src/components/panel-primitives.tsx`, `src/components/MenuBar.tsx`,
  `src/components/EditorLayout.tsx`, `src/panels/*` (most).

Concrete changes:

1. The classes are already in `globals.css` from Pass 1.
2. **In this codebase, the real surface is `hover:bg-surface*`,
   not `hover:bg-stone-*`.** Stone-backgrounded buttons are filled
   primary buttons (Pass 5 territory). The neutral row/menu hovers
   are spelled `hover:bg-surface-muted`, `hover:bg-surface-muted-strong`,
   and `hover:bg-surface/{15,30,40,60,70}` (~110 sites). Sweep:
   - `hover:bg-surface-muted` and `-muted-strong` → `hover-on-light`.
   - `hover:bg-surface/N` (any N) → `hover-on-dark` (these sit on
     darker pod / topbar / colored-header backgrounds).
3. **Preserve** `hover:bg-surface-muted/50` on `CARD_DEFAULT` —
   that's the unselected card's resting hover, conceptually different
   from row/menu hovers.
4. Don't sweep:
   - Filled-button stones (`hover:bg-stone-700/800/900`) — Pass 5.
   - Colored accent hovers (`hover:bg-blue-50`, `hover:bg-sky-50`,
     `hover:bg-red-50`, etc.) — intentional category cues.
   - `hover:bg-edge-subtle` — filled-button state on Suggestions.
5. No inline JS bg hover handlers exist in this repo (`setHoveredAnchorId`
   tracks marginalia state, not bg).

**Verify.** Hover states are uniform. No more "this menu row hovers
slightly differently than the next."

**Caveat:** the new utilities use a `transition: background-color
120ms ease-out` shorthand. If a swept site also has Tailwind's
`transition-colors`, the shorthand takes over and text-color hover
animations stop. Pass 4's icon-button cleanup removes the redundant
`transition-colors` for icon buttons; do the same sweep for the row /
menu hover sites here, or as a follow-up.

---

## Pass 4 — Icon button

**Goal.** Sweep hand-rolled icon buttons.

In scope:
- Centralized icon-button definitions in `src/components/panel-primitives.tsx`:
  `POPOUT_BUTTON_CLASS`, `PanelClose`, `CardTrashButton`, `ItemMenu`
  trigger (right-aligned, card-level), `TargetIcon`, `TargetFileIcon`.
- Modal header close X (PreferencesModal, AIWindow refresh + close).
- Menu items with the canonical "small grey square + icon" pattern.

Out of scope (these are NOT icon-only buttons in spec terms):
- Topbar / sidebar-strip / tab-close buttons that have accent-text
  hover or stateful `aria-pressed`-style active styling
  (`bg-[var(--accent-light)]` + inset shadow). `iconbtn-*` doesn't
  model those.
- `PanelHeader` Add (blue) and AI-request (sky) buttons — colored
  accent hovers are intentional category cues.
- Formatting toolbars (BibEntryCard, RichTextField, MenuBar, floating
  toolbar shell) — they have their own active-state styling and a
  dark-context inverted variant that `iconbtn-*` can't express.
- Outline chevrons (10×10 / 12×12 SVGs) — sub-spec sizes by design.
- `ItemMenu` panel-header trigger (align="left") — bare-button by
  design (no rounded lozenge).

Concrete changes:

1. The `iconbtn-*` classes are already in `globals.css` from Pass 1.
2. Replace each in-scope hand-rolled `<button className="p-1 rounded …">`
   with `<button className="iconbtn-md …">` (or `-sm` / `-lg` per
   `03-spacing-and-icons.md`).
3. Confirm the inner SVG is sized correctly: `14` for sm, `16` for md,
   `20` for lg.
4. The trash button uses `iconbtn-sm iconbtn-danger`.
5. Remove now-redundant `transition-colors` and `focus:ring-*` —
   `iconbtn-*` includes them.

**Verify.** Every icon button has the same hit area. Hover backgrounds
match. Focus rings match.

**Known visual shift:** `TargetIcon` / `TargetFileIcon` live inside
colored card headers (red-100, emerald-100, amber-100). The legacy
`hover-on-dark` overlay (rgba(0,0,0,0.04)) becomes a solid
`--surface-muted-strong` (light grey) under `iconbtn-md`. Subtle
clash on tinted headers; address with an `iconbtn-on-dark` variant
if needed.

---

## Pass 5 — Buttons

**Goal.** Five variants, three sizes, codified.

Files touched:
- `panel-primitives.tsx` (new `<Button>` component).
- `src/app/globals.css` (expose `--color-accent` and
  `--color-accent-light` in `@theme inline` so `bg-accent` /
  `text-accent` work as Tailwind utilities).
- `system-dialog.tsx` (refactor `SystemDialogButton` to wrap `<Button>`
  so every modal-footer button picks up the new variants without
  changing call sites).
- Sweep: `bg-blue-*`, `bg-emerald-*`, `bg-red-*`, `bg-stone-700/800` in
  `src/panels` and `src/components`. Modal footers especially.

Concrete changes:

1. Add `<Button variant size>` per `07-buttons-and-inputs.md`.
2. Replace blue/emerald "apply" buttons → `<Button variant="warm">`.
3. Replace stone/grey "cancel" buttons → `<Button variant="ghost">`.
4. Replace red "delete" buttons → `<Button variant="danger">`.
5. Replace any "the primary action" → `<Button variant="primary">`.
6. Confirm each modal has at most one primary.
7. Refactor `SystemDialogButton` to be a thin wrapper around `Button`
   (legacy variant names map: `accent` → `primary`).

**Verify.** Spot-check every modal footer. Spot-check Apply / Discard
buttons in suggestion flow. Spot-check delete confirmations.

**Known shift:** legacy modal "primary" was filled stone-800
(grey-black). New "primary" is filled accent-brown. Every modal
footer rebrands. Old "danger" was filled #b45757; new "danger" is
soft (bg-danger-soft + text-danger + thin red border). Less
aggressive — the migration's intended tone shift.

**Out of scope:** toggle buttons with stateful active styling
(sidebar strips, top-bar mode toggles) don't fit the 5 variants and
stay hand-rolled. A future "toggle" variant could subsume them.

---

## Pass 6 — Theme shape

**Goal.** Collapse `CARD_THEMES` to five tokens per theme. Pre-mix
header tints.

Files touched:
- `src/lib/panel-theme.ts` (extend `deriveCardPalette` to return
  `headerDefault`, `headerSelected`, `borderSelected`,
  `separatorSelected`).
- `src/components/panel-primitives.tsx` (`CARD_THEMES` rewrite).
- See `patches/panel-theme.ts.patch.md` and `patches/marginalia.ts.patch.md`.

Concrete changes:

1. Extend `DerivedCardPalette` to include `headerDefault` and
   `headerSelected` as solid hexes (currently they're rgba-with-alpha;
   pre-mix to solid by composing over white).
2. Rewrite `CARD_THEMES` so each row has only `accent`. The factory
   `themeFromAccent(accent)` builds the rest.
3. Delete the `override` field on `CardTheme` and the
   `cardOverrideStyle` / `headerOverrideStyle` /
   `separatorOverrideStyle` helpers. User-picked colors now replace
   `accent` and re-derive.
4. Sweep `bg-red-100/60`, `bg-emerald-100/50`, etc. — they're now
   inline `style={{ backgroundColor: theme.headerDefault }}`.
5. Sweep `MARKER_META` to use the same `accent` colors as `CARD_THEMES`.
   The two registries should agree on the per-kind color.

**Verify.** Every theme renders correctly. The user's color picker
still works (re-derives the whole palette). Cards in dark-mode-of-cards
(if any) still render.

---

## Pass 7 — Cleanup

**Goal.** Codemod stone-* → ink-* / edge-*. Final pass.

Files touched:
- `src/**/*.tsx`, `src/**/*.ts`, `src/**/*.css`.

Concrete changes:

1. Run the codemod from `10-audit.md` item 7.
2. Visual diff every panel and the editor. The diff should be **zero
   pixels** — the codemod is name-only.
3. Remove dead utility imports.
4. Update `STYLE_GUIDE.md` if anything in `11-style-guide.md` has
   drifted during the migration.

**Verify.** A reviewer should be able to `git grep "stone-"` in `src/`
and find nothing in `*.tsx` or `*.ts`. CSS may still reference stone-*
fallbacks; that's fine for now.

**Realistic surface size:** the audit estimated ~200 stone-* sites in
`*.tsx`. Reality after earlier passes is ~63 (31 text-stone, 26
border-stone, 6 bg-stone). Earlier passes' Tailwind-utility adoption
already swept most of the audit's projected count.

---

## Order discipline

Pass 1 must land before Pass 2. Pass 6 should land after Pass 5 (which
is after Pass 4). Pass 7 is always last.

If a pass introduces a regression, **revert** rather than patching the
next pass to compensate.

---

## Execution notes

[migration-feedback.md](migration-feedback.md) collects per-pass
flags (typos in patches, surface-size corrections, deferred
follow-ups). The corrections inlined in this doc come from that file;
read it for context if a step seems off vs. what you actually find
in the codebase.
