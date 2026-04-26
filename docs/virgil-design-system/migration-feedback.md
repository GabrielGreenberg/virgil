# Migration feedback — issues flagged during execution

Running notes accumulated while executing the passes in [MIGRATION.md](MIGRATION.md). Each item is something a future executor or the design author should know — corrections to the plan, environmental gotchas, or judgment calls made on the executor's discretion.

Format: `[STATUS] Title` — `STATUS` is one of `OPEN` (needs action), `INFO` (just-so-you-know), or `RESOLVED-LATER` (deferred to a later pass).

---

## Pass 1 — Tokens

### `[OPEN] pnpm typecheck is not a script in package.json`
MIGRATION.md and the design Claude's per-pass prompts both say "run `pnpm typecheck`". That script doesn't exist in [package.json](../../package.json). Available scripts: `dev`, `dev:preview`, `build`, `start`, `preview:pages`, `lint`, `test`, `test:watch`. I've been running `./node_modules/.bin/tsc --noEmit` directly.
**Action:** add `"typecheck": "tsc --noEmit"` to `package.json`, or change the migration doc to say "run `pnpm exec tsc --noEmit` and `pnpm build`."

### `[INFO] pnpm is not on this machine's PATH`
Shell runs `node`/`npm` from `/usr/local/bin/` but `pnpm` is not installed globally. I've been running locally via `./node_modules/.bin/<tool>`. Not a migration issue — just a reason my command lines diverged from the spec.

### `[INFO] --citation-bg fallback shift is shadowed at runtime`
MIGRATION.md says Pass 1 should render "pixel-for-pixel identical." The aliasing changes `--citation-bg` from `#fdf8e1` → `var(--amber-50) = #fef9e7`. In practice this fallback is shadowed at runtime by `src/lib/preferences-tree.ts:351-352` which derives `--citation-bg` and `--footnote-bg` from user citation/footnote text colors via `deriveLight()`. So the fallback shift only ever shows for a fresh user with no preferences applied. The "renders identically" claim is functionally true; the literal token diff is not.

### `[OPEN] No reference.html baseline exists`
MIGRATION.md instructs "verify visually against `reference.html`" after each pass, but no such file exists in the repo. I've been falling back to manual click-through plus DOM probes via the dev preview.
**Action:** either generate a `reference.html` baseline (or screenshot set) before further passes, or drop that line from the migration doc.

### `[INFO] No Storybook / no visual-regression tests`
The repo has 4 unit tests covering storage roundtrips only — no UI snapshot, no e2e, no visual regression. Manual click-through is the only safety net for visual regressions in this migration. Worth knowing if a later pass needs a wider safety margin.

---

## Pass 2 — Selection (themedCard)

### `[INFO] Pass 2 was less risky than the migration plan claimed`
MIGRATION.md says the signature change "forces compile errors at every call site," implying a wide sweep. In practice only one external direct caller (`src/panels/Search/SearchPanel.tsx:725`) needed updating. All `EditableCard` consumers go through `<PanelCard theme={…}>`, so the rewrite is fully internalized to `PanelCard`. Worth correcting the migration doc so future executors don't expect more breakage than they get.

### `[OPEN] SearchPanel cards now use the `comment` (stone) theme`
Search results are heterogeneous (footnotes, notes, todos, citations, …). The old `panelCard()` always rendered amber; I picked `CARD_THEMES.comment` (stone) as a neutral default for the rewrite. The existing `borderLeftColor` inline style still differentiates per scope.
**Decision needed:** is stone-bordered "comment-themed" right for search? Or should each result wear the theme of its source kind (`footnote → red`, `note → emerald`, …)? If yes, wire `themedCard(scopeToTheme(result.scope), selected)` with a `SearchScope → CARD_THEMES key` map.

### `[RESOLVED-LATER] override field is preserved`
The user-color picker pipeline (`cardOverrideStyle`, `headerOverrideStyle`, `separatorOverrideStyle`, `useCardTheme`'s `override` injection) is untouched in Pass 2 — it reads `theme.override.selectedBorder`, independent of the new `borderSelected` field. **Pass 6** plans to collapse `CARD_THEMES` to five tokens per theme and rework the override system; that's where this gets revisited.

---

## Pass 3 — Hover

### `[OPEN] transition-colors is now redundant on swept elements`
The `.hover-on-light` rule uses the shorthand `transition: background-color 120ms ease-out`, which overrides Tailwind's `transition-colors` (`transition: color, background-color, border-color, … 150ms cubic-bezier(...)`) when both apply to the same element. Net effect: text-color / border-color hovers no longer animate — only the bg does. **Pass 3 didn't strip `transition-colors`** because MIGRATION.md only mentions doing so in **Pass 4** (for icon buttons specifically: "Remove now-redundant `transition-colors` and `focus:ring-*`").
**Action:** either expand Pass 4's `transition-colors` cleanup to also cover the menu/list-row hover sites swept in Pass 3, or do a separate Pass 3.5 sweep. The visual regression is subtle (text/border hover changes are now instant instead of 150ms-tweened) but real.

### `[INFO] Pass 3's `hover:bg-stone-` grep found the wrong surface`
MIGRATION.md Pass 3 step 2 says: *"Grep `hover:bg-stone-` in `src/`. For each match: …"*. That grep returns 7 hits in this codebase, **all of which are dark-filled primary buttons** (`bg-stone-700` → `hover:bg-stone-800`, the "Save" / "Open folder" / "Cancel" patterns). Those are button-state hovers, not the neutral row/menu hovers Pass 3 actually targets — those use `hover:bg-surface*` patterns (~110 sites). I executed Pass 3 against `hover:bg-surface*` per the spirit of the goal ("uniform hover"); the literal `hover:bg-stone-` step would have done nothing visible.
**Action:** update MIGRATION.md Pass 3 step 2 to grep for `hover:bg-surface` and `hover:bg-surface-muted*` instead of `hover:bg-stone-`.

### `[INFO] No inline JS hover handlers in the codebase`
Pass 3 step 4 ("Remove inline `style={{ background: ... }}` hover handlers if any") had nothing to sweep. The only `setHoveredAnchorId`-style handlers in the codebase track marginalia anchor state, not bg colors. Step is effectively a no-op for this repo.

### `[INFO] Cooler-to-stronger neutral merge`
`hover:bg-surface-muted` (`#fafaf9`) and `hover:bg-surface-muted-strong` (`#f5f5f4`) both became `hover-on-light` (which lands on `--surface-muted-strong` = `#f5f5f4`). Menu rows that previously hovered to a slightly cooler off-white now hover slightly stronger. ~5 luminance units. Uniform per Pass 3's spec; flagging only because the diff isn't strictly value-preserving.

### `[INFO] CARD_DEFAULT's hover:bg-surface-muted/50 was preserved`
This one site in `panel-primitives.tsx:41` is the unselected card's resting hover (the whole card brightens slightly when the cursor is over it). Conceptually different from menu/row hovers, so I left it alone. Could be revisited if the migration wants strict uniformity here too.

---

## Pass 4 — Icon buttons

### `[OPEN] iconbtn-* has no dark-context variant`
The `.iconbtn-sm/md/lg` utility hovers to `--surface-muted-strong` (light grey). On colored card headers (`bg-red-100`, `bg-emerald-100`, `bg-amber-100` …) — where `TargetIcon` and `TargetFileIcon` live — this creates a light-grey patch on hover where the original used `rgba(0, 0, 0, 0.04)` overlay (subtle darken). I converted those two icons in Pass 4 anyway because they fit the rest of `iconbtn-*`'s contract. The visual shift is small but real.
**Action:** add an `iconbtn-on-dark` variant (or similar) that swaps the hover bg to the dark-overlay model, OR scope a per-context override (e.g. `[data-card-selected="true"] .iconbtn-md:hover { background-color: rgba(0,0,0,0.04); }`). Worth revisiting in Pass 6 when card headers are reworked.

### `[OPEN] iconbtn-* doesn't model accent or active states`
Many topbar/strip/tab buttons in `EditorLayout.tsx` couldn't convert because they have:
- `hover:text-[var(--accent)]` (accent text on hover, not muted-grey)
- `bg-[var(--accent-light)] shadow-[inset_0_0_0_1px_rgba(...)]` on active state
- `aria-pressed="true"` styled with theme accent, not the default `--pod-dark`

The spec's `aria-pressed="true"` styling for `iconbtn-*` uses `--pod-dark` (grey) which is the wrong color for these toggles. Pass 5's button-variant system might subsume some of these, but accent-text icon buttons specifically don't have a clean home. **Action:** either codify an `iconbtn-accent` variant, or accept that some icon buttons stay hand-rolled and document the convention.

### `[INFO] Pass 4's stated surface is narrower than the codebase's icon-button surface`
MIGRATION.md Pass 4 names: "panel headers, top bar, card chrome (popout, trash), modal headers, menu items." But the codebase also has formatting toolbars (BibEntryCard, RichTextField, MenuBar) and sub-spec chevrons (OutlinePanel) that look like icon buttons but have legitimate reasons not to use `iconbtn-*` (different colors, different sizes, accent semantics, dark-variant context). Leaving them out is right — but the migration doc could be more explicit about which call sites are in scope vs out. **Action:** edit MIGRATION.md Pass 4 to say "out of scope: formatting toolbars and dense-context chevrons."

### `[OPEN] transition-colors cleanup is partial`
The five centralized conversions in `panel-primitives.tsx` had their `transition-colors` removed (since `iconbtn-*` provides `transition: bg + color`). The Pass 3 hover sweep (~110 sites) still carries redundant `transition-colors`, which the [Pass 3 feedback already flagged](#open-transition-colors-is-now-redundant-on-swept-elements). Pass 4 was the natural moment for that broader cleanup; per spec ("Remove now-redundant `transition-colors` and `focus:ring-*`") the icon-button class strips it for icon buttons but not for the menu rows / list items from Pass 3. **Action:** sweep `transition-colors` from sites that now have `hover-on-light` or `hover-on-dark`. Mechanical.

---

## Cross-cutting themes

### `[OPEN] Migration doc's "wide sweep" framing has been over-conservative twice`
- Pass 2: predicted compile errors at every call site → only one site needed updating.
- Pass 3: predicted `hover:bg-stone-` was the surface → real surface was `hover:bg-surface*`.

In both cases I followed the spirit of the goal rather than the literal step. Worth a doc pass to align the spec with what the codebase actually contains.

### `[INFO] Verification cadence`
After each pass I'm running: `tsc --noEmit` + `next build` + `vitest run` + dev preview boot + DOM probe of the new utility classes. Static checks consistently flag one pre-existing tsc error in [src/links/__tests__/migrate-card.test.ts:73](../../src/links/__tests__/migrate-card.test.ts:73) (`"revision"` not in `CardKind`) — confirmed pre-existing across all passes by stashing changes and re-running. Worth fixing independently but unrelated to the migration.
