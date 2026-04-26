# MIGRATION.md

Pass-by-pass execution plan. **Do one pass per PR.** Don't combine.

After each pass: run `pnpm typecheck`, `pnpm build`, `pnpm test` if
tests exist. Open the app, click through all panels, verify visually
against `reference.html`. Report changes back before starting the next
pass.

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
- Every panel that calls `panelCard(...)` without passing a theme — sweep
  `src/panels/`.

Concrete changes:

1. Delete `CARD_SELECTED`, `CARD_SELECTED_FOOTNOTE`, `_NOTE`, `_TODO`,
   `_CUT`. Replace with a single `themedCard(theme, selected, extra)`
   that reads `theme.borderSelected`.
2. Update `panelCard(selected)` to require a theme:
   `panelCard(theme, selected, extra)`. The signature change forces
   compile errors at every call site.
3. Walk compile errors: at each call site, supply the correct theme
   from `CARD_THEMES`.

**Verify.** Every card kind selects with its theme color. There is no
amber-bordered card anywhere except `aiRequest` (which is sky, so really
nowhere). Run through every panel: footnotes, notes, archive, todo, bib,
citations, comments, AI requests, cut, errors, examples.

---

## Pass 3 — Hover

**Goal.** Codify hover. Sweep `hover:bg-stone-*`.

Files touched:
- `src/components/panel-primitives.tsx`, `src/components/PanelHeader.tsx`,
  `src/components/TopBar.tsx`, `src/panels/*` (most).

Concrete changes:

1. The classes are already in `globals.css` from Pass 1.
2. Grep `hover:bg-stone-` in `src/`. For each match:
   - On a light bg (white, surface, surface-muted): replace with
     `hover-on-light`.
   - On a darker pod bg (pod-panel, header-bg, topbar-bg): replace with
     `hover-on-dark`.
3. Sweep arbitrary opacity hovers (`hover:bg-stone-100/70` etc.). All
   become `hover-on-light` or `hover-on-dark`.
4. Remove inline `style={{ background: ... }}` hover handlers if any.

**Verify.** Hover states are uniform. No more "this menu row hovers
slightly differently than the next."

---

## Pass 4 — Icon button

**Goal.** Sweep hand-rolled icon buttons.

Files touched:
- Wherever an icon-only button exists: panel headers, top bar, card
  chrome (popout, trash), modal headers, menu items.

Concrete changes:

1. The `iconbtn-*` classes are already in `globals.css` from Pass 1.
2. Replace each hand-rolled `<button className="p-1 rounded …">` with
   `<button className="iconbtn-md …">` (or `-sm` / `-lg` per
   `03-spacing-and-icons.md`).
3. Confirm the inner SVG is sized correctly: `14` for sm, `16` for md,
   `20` for lg.
4. The trash button uses `iconbtn-sm text-danger hover:bg-danger-soft`.
5. Remove now-redundant `transition-colors` and `focus:ring-*` —
   `iconbtn-*` includes them.

**Verify.** Every icon button has the same hit area. Hover backgrounds
match. Focus rings match.

---

## Pass 5 — Buttons

**Goal.** Five variants, three sizes, codified.

Files touched:
- New: `src/components/Button.tsx` (or extend `panel-primitives.tsx`).
- Sweep: `bg-blue-*`, `bg-emerald-*`, `bg-red-*` in `src/panels` and
  `src/components`. Modal footers especially.

Concrete changes:

1. Add `<Button variant size>` per `07-buttons-and-inputs.md`.
2. Replace blue/emerald "apply" buttons → `<Button variant="warm">`.
3. Replace stone/grey "cancel" buttons → `<Button variant="ghost">`.
4. Replace red "delete" buttons → `<Button variant="danger">`.
5. Replace any "the primary action" → `<Button variant="primary">`.
6. Confirm each modal has at most one primary.

**Verify.** Spot-check every modal footer. Spot-check Apply / Discard
buttons in suggestion flow. Spot-check delete confirmations.

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

---

## Order discipline

Pass 1 must land before Pass 2. Pass 6 should land after Pass 5 (which
is after Pass 4). Pass 7 is always last.

If a pass introduces a regression, **revert** rather than patching the
next pass to compensate.
