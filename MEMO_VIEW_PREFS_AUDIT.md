# View-Preference Persistence — Audit + Fix Handoff

**Ask (user, 2026-06-19, ultracode manager session):** make ALL view/display preferences
survive reload — editor three-dots View menu, every panel three-dots menu, and any other
display pref. Concrete report: "Paragraph titles" toggle always ON after reload. User wanted
a thorough cross-surface audit BEFORE any changes. Central principle: unified, deep,
architectural fix that captures the whole class — not surgical patches.

## Audit (DONE — no code changed)

Full audit doc: **[docs/memos/view-prefs-persistence-audit/AUDIT.md](docs/memos/view-prefs-persistence-audit/AUDIT.md)**
(6-finder workflow: 82 prefs inventoried, 18 non-persisted candidates adversarially verified →
5 false-positives + 4 transient-by-design dropped → **5 confirmed reload-loss bugs**).

### The root pattern
`useViewPrefs` (`src/hooks/useViewPrefs.ts`) is the canonical persisted store — global slice
(`GLOBAL_PREF_KEYS`, `virgil-view-prefs/global`, cross-window mirrored) + per-window slice
(`virgil-view-prefs/window/<id>`), with a proven `legacyMigrations` mechanism (:373+) that already
absorbed marginalia/dividers/omni from standalone keys. **The bug class:** a few toggles bypass
every store via plain `useState(initial)` — no persist-write, no load-read — so they reset on reload.
`MenuBar` ViewMenu is purely presentational (`checked`/`onToggle` props), so persistence is decided
entirely by where the backing state lives in `EditorLayout`. New toggles naturally reach for
`useState`, work in-session, and silently lose state on reload.

### The 5 confirmed bugs
1. **Paragraph titles** (THE report) — `EditorLayout.tsx:896` `useState(true)` → useViewPrefs (global). P0
2. **% comments / LaTeX comments** (twin, adjacent line) — `EditorLayout.tsx:897` → useViewPrefs (global). P0
3. **Bibliography "Cited only / Full"** filter — `BibliographyPanel.tsx:109` `useState("cited")` → useViewPrefs (per-window or per-doc). P1
4. **Library paper Text/PDF view mode** — `RightDetail.tsx:44` `useState("text")` + unconditional force-reset at :50-53 (worst: loses state even on intra-session paper switch) → view-session-store (`paper:<citekey>`). P1
5. **Popped-out PANELS return docked** — `useViewPrefs.ts:637` hard-resets `poppedOutPanels: []` on load (rect+mode DO persist; cards survive, panels don't). P2 — design decision, not a clear bug.

Plus a **Library parity gap** (not a loss): `LibraryView` nav/middle/papers sizes survive via 3
standalone `useState`+localStorage pairs while the unified store dead-seeds `layout.*` nobody reads.

### Recommended deep fix (AUDIT.md §6)
A single typed **VIEW_PREF_REGISTRY** (`src/lib/view-prefs/registry.ts`): each entry declares
kind/scope/default/menu/label. Generate `ViewPrefs` + `DEFAULT_PREFS` + `GLOBAL_PREF_KEYS` FROM the
registry; ViewMenu maps over registry entries auto-wiring `checked=prefs[key]`/`onToggle=setPref(key)`.
A new toggle = one registry entry that persists by construction. Mirror on Library
(view-session-store). Regression guard: AST/lint test that no View-menu row is fed by hand-rolled
`useState` + a round-trip unit test per registry entry (would have caught all 5).

## Open product decisions (asked user — see §7)
Scope of par-titles/%comments (global vs per-doc); Bibliography filter scope; Library Text/PDF scope;
should popped-out panels re-float; should Pref/Helper mode persist.

## Status: audit complete, awaiting user scoping answers before implementation. NOT started coding.
