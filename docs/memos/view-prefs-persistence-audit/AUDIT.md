# View-Preference Persistence Audit

**Goal:** every view/display preference should survive a page reload.
**Reported bug:** the "Paragraph titles" toggle in the editor's three-dots **View** menu is always ON after reload; toggling it off does not persist.

**Date:** 2026-06-19
**Method:** 6 per-surface finders + adversarial end-to-end verification of every non-persisted candidate. Each preference was traced from its menu control → its backing state declaration → its store, checking BOTH that a change is *written* to a persistent store AND that on load the value is *read back*. A toggle "survives reload" only if both halves are present. Key claims were re-verified against the live code while writing this memo.

---

## 1. Executive summary

Virgil already has a strong, well-factored persistence substrate for view preferences: the canonical `useViewPrefs` store splits prefs into a **global** slice (mirrored across windows) and a **per-window** slice, with a clean `legacyMigrations` mechanism that has already absorbed several standalone localStorage toggles. The overwhelming majority of view controls — marginalia, dividers, heading labels, section indicator, highlights, dock layout, panel widths, page width, margins, omni filters, per-card archive view — flow through this store (or a sibling durable store) and **do** survive reload.

The reported bug is **not a substrate failure**. It is a small number of toggles that **bypass every store** by declaring their state as a plain `useState(initial)` with no persistent write and no load-time read. These reset to their hard-coded default on every reload. The audit found **5 genuine, confirmed reload-loss bugs of this class** (plus 4 cases that look like the bug mechanically but are correctly transient by design, and several near-misses verified as false positives).

The two headline offenders are literally adjacent lines:

```ts
// src/components/EditorLayout.tsx
896  const [showParTitles, setShowParTitles] = useState(true);     // "Paragraph titles" — THE reported bug
897  const [showLatexComments, setShowLatexComments] = useState(true); // "% comments" — identical defect
```

Every sibling toggle one block below them reads from `prefs.*` (useViewPrefs); these two never do. The fix is the *exact* pattern already used for marginalia/dividers/heading-labels: fold them into `useViewPrefs`. The recommended deep fix goes one step further — a single typed **view-preference registry** that both the menu rows and the persistence layer derive from, so this class of bug cannot recur.

---

## 2. Complete inventory

Legend — **Survives?**: ✅ yes (write + read-back present) · ❌ no (resets on reload) · 🟡 by-design transient (resets, correctly).

### Surface F1 — Editor three-dots "View" menu (`MenuBar.tsx` ViewMenu)

| Preference | Control (file:line) | State source (file:line) | Store | Scope | Survives? | Notes |
|---|---|---|---|---|---|---|
| **Paragraph titles** | MenuBar.tsx:685 | EditorLayout.tsx:896 | plain useState | session | ❌ | **THE REPORTED BUG.** `useState(true)`; only consumer is chrome-config.ts:72 (`hide-par-titles` class). No store read/write. |
| **% comments (LaTeX comments)** | MenuBar.tsx:686 | EditorLayout.tsx:897 | plain useState | session | ❌ | Identical defect; consumer chrome-config.ts:73 (`hide-latex-comments`). |
| Current section (indicator) | MenuBar.tsx:687 | EditorLayout.tsx:910 (`prefs.showSectionIndicator`) | useViewPrefs (global) | global | ✅ | GLOBAL_PREF_KEYS; legacyMigration present. |
| Labels (heading-kind) | MenuBar.tsx:688 | EditorLayout.tsx:911 (`prefs.showHeadingLabels`) | useViewPrefs (global) | global | ✅ | GLOBAL_PREF_KEYS; legacyMigration. |
| Marginalia — master | MenuBar.tsx:693 | EditorLayout.tsx:905 (`prefs.showMarginalia`) | useViewPrefs (global) | global | ✅ | legacyMigration `virgil-show-marginalia`. |
| Marginalia per-type (note/archive/todo) | MenuBar.tsx:694-703 | EditorLayout.tsx:906-909 (`prefs.hiddenMarginaliaTypes`) | useViewPrefs (global) | global | ✅ | Set round-trips as array. |
| Highlights — master | MenuBar.tsx:709 | EditorLayout.tsx (setShowHighlights :680) | useViewPrefs (global) | global | ✅ | GLOBAL_PREF_KEYS. |
| Highlights per-type (note/todo/comment/cut) | MenuBar.tsx:710-724 | EditorLayout.tsx:1166-1168 (`prefs.hiddenHighlightTypes`) | useViewPrefs (global) | global | ✅ | Set round-trips. |
| Show dividers for… (per-level) | MenuBar.tsx:732-741 | EditorLayout.tsx:912-915 (`prefs.dividerLevels`) | useViewPrefs (global) | global | ✅ | legacyMigration `virgil-divider-levels`. |
| Divider width (Full/Mid/Text) | MenuBar.tsx:743-751 | EditorLayout.tsx:916 (`prefs.dividerWidth`) | useViewPrefs (global) | global | ✅ | legacyMigration `virgil-divider-width`. |
| Margins… (action) | MenuBar.tsx:763 | EditorLayout.tsx:951 (enterMarginEditMode) | — | — | n/a | Action row (no checked state). NOTE: handler is a no-op stub right now; underlying margin values persist (global). |
| Fonts… (action) | MenuBar.tsx:770 | EditorLayout.tsx:922 (setFontsOpen) | usePreferences | global | n/a | Action launcher; dialog-open useState is correctly ephemeral. Font values persist via usePreferences. |
| Close all panels (action) | MenuBar.tsx:776 | EditorLayout.tsx:668 (closeAllPanels) | useViewPrefs (window) | per-window | n/a | Action; its effect (cleared dock) persists per-window. |

### Surface F2 — Per-panel three-dots (kebab) menus

| Preference | Control (file:line) | State source (file:line) | Store | Scope | Survives? | Notes |
|---|---|---|---|---|---|---|
| View Active/Archives/All (card archive-view) | CardViewModeMenu.tsx:20 | EditorPane.tsx:3922 → useViewPrefs `cardArchiveView` | useViewPrefs (window) | per-window | ✅ | Canonical good wiring (Notes/Citations/Cutter/Reports/Revisions/Todo/Archive). Not rendered in Footnotes/Examples. |
| **Bibliography filter: Cited only / Full** | BibliographyPanel.tsx:600-617 | BibliographyPanel.tsx:109 | plain useState | session | ❌ | **BUG.** `useState("cited")`, no store. Resets to "cited". Same class as showParTitles. |
| Outline view menu (5 show* + collapsed) | OutlinePanel.tsx:1722-1756 | OutlinePanel.tsx:1571-1576 | localStorage `virgil-outline-prefs` | global | ✅ | Plain useState but hydrated/saved via own localStorage store. Durable (could fold into useViewPrefs for consistency). |
| Outline "Edit" mode | OutlinePanel.tsx:1765-1777 | OutlinePanel.tsx:1578 | plain useState | session | 🟡 | Deliberately excluded from outline-prefs; a transient editing posture. Resets correctly. |
| WordCount category includes | WordCountPanel.tsx (useWordCountConfig) | useWordCountConfig.ts | localStorage `virgil-wordcount-config` | global | ✅ | Own localStorage store; durable. |
| Omni per-side category filter + Default view | OmniViewPanel.tsx:199-236 | omniCategories (props from useViewPrefs) | useViewPrefs (global) | global | ✅ | Values come as props; absorbed legacy `virgil-omni-categories`. |
| Omni bin expand toggles (unanchored/outside-focus) | OmniViewPanel.tsx:283-292, :338 | OmniViewPanel.tsx:274, :338 | plain useState | session | 🟡 | Ratified default-collapsed disclosure pills. Resets correctly. |
| Errors panel filter box | ErrorsPanel.tsx:121-127 | ErrorsPanel.tsx:51 | plain useState | session | 🟡 | Free-text search over an ephemeral error list; SHOULD clear on reload. |
| Citations Package / Style | CitationsPanel.tsx:255-282 | props (document settings) | document-settings | per-document | ✅ | Not panel-local; LaTeX preamble setting, round-trips with the doc. |

### Surface F3 — Layout / Dock / Omni / Split / Strip

| Preference | Control (file:line) | State source (file:line) | Store | Scope | Survives? | Notes |
|---|---|---|---|---|---|---|
| Strip placements (icon side/order) | EditorLayout.tsx:2773 / EditorPane.tsx:5748 | useViewPrefs.ts:74 (movePanel :987) | useViewPrefs (global) | global | ✅ | GLOBAL_PREF_KEYS:250. |
| Dock stack (open docked panels) | EditorLayout.tsx:3335 togglePanel | useViewPrefs.ts:80 dockStack | useViewPrefs (window) | per-window | ✅ | Window blob; rebuilt via clampStack on load. |
| Per-band panel heights | useViewPrefs.ts:1019/1038 | useViewPrefs.ts:85 panelHeights | useViewPrefs (window) | per-window | ✅ | Explicit override reads parsed value. |
| Panel MRU (recency) | useViewPrefs.ts:1054 | useViewPrefs.ts:90 panelMRU | useViewPrefs (window) — written, **hard-reset on load** | session | 🟡 | Written to window blob but reset to `{left:[],right:[]}` at :628 by design. LRU bookkeeping, rebuilds. |
| Side collapsed | useViewPrefs.ts:902/906 | useViewPrefs.ts:93-94 | useViewPrefs (window) | per-window | ✅ | |
| Side blank | useViewPrefs.ts:935/945 | useViewPrefs.ts:97-98 | useViewPrefs (window) | per-window | ✅ | |
| Panel column width | useViewPrefs.ts:1007 | useViewPrefs.ts:99 panelWidths | useViewPrefs (window) | per-window | ✅ | |
| Editor split toggle | EditorLayout.tsx:2516 / MenuBar.tsx:901 | useViewPrefs.ts:101 editorSplit | useViewPrefs (window) | per-window | ✅ | Rides bare `...parsed`. NOT mirrored (unlike codePaneRatio). |
| Editor split ratio | useViewPrefs.ts:1356 | useViewPrefs.ts:103 editorSplitRatio | useViewPrefs (window) | per-window | ✅ | Clamped 0.15–0.85. |
| Code-pane split ratio | useViewPrefs.ts:1360 | useViewPrefs.ts:107 codePaneRatio | useViewPrefs (global) | global | ✅ | GLOBAL_PREF_KEYS:261. Asymmetry vs editorSplit (per-window). |
| **Popped-out PANELS (floating windows)** | useViewPrefs.ts:845/1225 | useViewPrefs.ts:109 poppedOutPanels | useViewPrefs (window) — **written, hard-reset on load** | per-window | ❌ | **BUG (design-vs-intent).** Written to disk but reset to `[]` at :637. A floated panel returns docked after reload; its SIZE survives (floatPositions). See §3/§7. |
| Popped-out panel origins | useViewPrefs.ts:1172 | useViewPrefs.ts:113 poppedOutOrigins | useViewPrefs (window) — reset on load | session | 🟡 | Partner of poppedOutPanels; moot once that is cleared. |
| Floating panel rect | useViewPrefs.ts:1284 | useViewPrefs.ts:119 floatPositions | useViewPrefs (window) | per-window | ✅ | Rect survives even though open-floating state does not. |
| Panel mode (docked/floating preference) | useViewPrefs.ts:1225/1253 | useViewPrefs.ts:122 panelModes | useViewPrefs (window) | per-window | ✅ | Preferred mode persists; next open defaults floating. |
| Popped-out CARDS | useViewPrefs.ts:1291/1311 | useViewPrefs.ts:124 poppedOutCards | useViewPrefs (window) | per-window | ✅ | ASYMMETRY: cards DO survive (unlike panels). |
| Floating card rect | useViewPrefs.ts:1322 | useViewPrefs.ts:126 cardFloatPositions | useViewPrefs (window) | per-window | ✅ | |
| Page width | useViewPrefs.ts:1364 | useViewPrefs.ts:141 pageWidth | useViewPrefs (global) | global | ✅ | GLOBAL_PREF_KEYS:252; clamped 400–1600. |
| Editor margins (L/R/T/B) | useViewPrefs.ts:1368-1382 | useViewPrefs.ts:148-151 | useViewPrefs (global) | global | ✅ | GLOBAL_PREF_KEYS:253-256. |
| Topbar right-collapse | EditorLayout.tsx:4178 | useViewPrefs.ts:158 topbarRightCollapsed | useViewPrefs (window) | per-window | ✅ | |
| Omni category chips (per side) | useViewPrefs.ts:1123/1134 | useViewPrefs.ts:180 omniCategories | useViewPrefs (global) | global | ✅ | legacyMigration. |
| Omni hide-all-cards | useViewPrefs.ts:1141 | useViewPrefs.ts:182 omniHideAllCards | useViewPrefs (global) | global | ✅ | legacyMigration. |
| Per-card archive view | useViewPrefs.ts:1151 | useViewPrefs.ts:191 cardArchiveView | useViewPrefs (window) | per-window | ✅ | |
| Suppress atom-archive warning | useViewPrefs.ts:1162 | useViewPrefs.ts:194 | useViewPrefs (window) | per-window | ✅ | |

### Surface F4 — Global app-chrome modes

| Preference | Control (file:line) | State source (file:line) | Store | Scope | Survives? | Notes |
|---|---|---|---|---|---|---|
| **Paragraph titles** | MenuBar.tsx:685 | EditorLayout.tsx:896 | plain useState | session | ❌ | Same bug (duplicate finding). |
| **% comments / LaTeX comments** | MenuBar.tsx:686 | EditorLayout.tsx:897 | plain useState | session | ❌ | Same bug (duplicate finding). |
| Zen mode | EditorLayout.tsx ~:3939 | useZenMode.ts:41 | localStorage `virgil-zen-mode` | global | ✅ | Own store; on + L/R margins round-trip; legacy-bool migration. |
| Focus view / focus mode | outline/card actions | useFocusMode.ts:173 (usePersistentState) | per-doc sidecar `focus.json` | per-document | ✅ | active/locked/start/end persist; legacy index migration. |
| Preference / style-editor mode | EditorLayout.tsx:986 | usePreferenceMode.ts:91 | localStorage `virgil-pref-mode` | global | ✅ | Boolean round-trips. (UX question: should a debug mode persist?) |
| Helper mode | EditorLayout.tsx:4036 | useHelperMode.ts:7 | localStorage `virgil-helper-mode` | global | ✅ | |
| Word-count config | WordCount panel / Outline | useWordCountConfig.ts:80 | localStorage `virgil-wordcount-config` | global | ✅ | Cross-instance CustomEvent sync. |
| Fonts dialog — families/sizes | FontsDialog.tsx | usePreferences.ts | localStorage `virgil-editor-prefs` | global | ✅ | Styling store. |
| Fonts dialog — footnote family/size | FontsDialog.tsx:450/457 | panel-typography.ts:307 | localStorage `virgil-panel-typography` | global | ✅ | Loaded once at EditorLayout.tsx:81. |
| Section folds | fold chevrons | useEditorUIState.ts:84 | per-doc sidecar `editor-state.json` | per-document | ✅ | foldedSections + lastParagraphId. |
| Active split pane (focus) | EditorLayout.tsx:719 | EditorLayout.tsx:719 | plain useState | session | 🟡 | Transient caret-pane focus; resets to "top" correctly. The split ON/OFF itself persists. |
| Dark mode / theme toggle | — | — | — | — | n/a | **No such control exists** anywhere in the codebase. |

### Surface F5 — Library view preferences

| Preference | Control (file:line) | State source (file:line) | Store | Scope | Survives? | Notes |
|---|---|---|---|---|---|---|
| Catalog search/filter query | LeftList.tsx:293-306 | view-session-store.ts:633 (useListView) | view-session-store | per-panel (libId) | ✅ | debounced + pagehide flush. |
| Catalog column sort | LeftList.tsx:217-226 | view-session-store.ts:633 | view-session-store | per-panel (libId) | ✅ | Legacy global key now seed-only. |
| Catalog row scroll | LeftList.tsx:139-167 | view-session-store.ts:633 scrollTop | view-session-store | per-panel (libId) | ✅ | Quiet write (keystroke-sanctity). |
| Catalog column widths | LeftList.tsx:228-282 | view-session-store.ts:684 (useLayoutPrefs) | view-session-store | global | ✅ | Shared across lists. |
| Row "last viewed" ack | LeftList.tsx:210 | row-viewed-store.ts:14/37 | localStorage `virgil-library-row-viewed-at` | global | ✅ | Per-machine ack state. |
| Selected rows + anchor | LibraryView.tsx:265-266 | view-session-store.ts:579 | view-session-store | per-panel | ✅ | Stale-key prune on load. |
| Left active-tab override (pin) | useLibraryTabs.ts:423-433 | view-session-store.ts (leftPinnedActiveId) | view-session-store | per-window | ✅ | Singleton scope only. |
| Open library tabs per panel | useLibraryTabs.ts:446-493 | library-store savePanelTabs/loadPanelTabs | localStorage `virgil-library-panel-tabs` | per-window | ✅ | Deliberately separate from unified store. |
| Library pin flags | useLibraryTabs.ts:736-766 | loadIdSet `*-pinned` keys | localStorage | per-window | ✅ | Unified store seeds these but never reads them back (dead seed; not a loss). |
| Project "Cited only" toggle | TabbedLibraryPanel.tsx:593-598 | project-library-context.tsx:86 → view-session-store.ts:694 | view-session-store | global | ✅ | Survives reload AND remount (the canonical bug the unified store fixed). |
| Navigator column width | LibraryView.tsx:225-228 | LibraryView.tsx:103 (useState + localStorage) | localStorage `virgil-library-nav-width` | per-window | ✅ | **Parity gap:** survives via standalone useState+key, bypasses unified store (which has a dead-seeded `layout.navWidth`). |
| Middle/file-column width | LibraryView.tsx:179-182 | LibraryView.tsx:102 (useState + localStorage) | localStorage `virgil-library-left-width` | per-window | ✅ | Parity gap (dead `layout.middleWidth` seed). |
| My Papers pod height | LibraryView.tsx:186-224 | LibraryView.tsx:104 (useState + localStorage) | localStorage `virgil-library-papers-height` | per-window | ✅ | Parity gap (dead `layout.papersHeight` seed). |
| **Paper detail view mode (Text/PDF)** | PaperHeader.tsx:376-380 | RightDetail.tsx:44 | plain useState | session | ❌ | **BUG.** `useState("text")`; *worse* — an effect (RightDetail.tsx:50-53) force-resets to "text" on every paper switch. No store. |
| Bib-entry expand/collapse (more/less) | PaperHeader.tsx:276-292 | PaperHeader.tsx:63 | plain useState | session | 🟡 | Transient per-row disclosure peek; reasonably resets. |
| Reader rail state (active panel / widths / popouts / omni) | PaperRender.tsx:363 | reader-view-prefs.ts:85-115 | ref-only (session) | session | 🟡 | Intentional by Reader-inheritance design. EXCEPTION: panel SIDE placement DOES persist (shared global useViewPrefs). |

### Surface F6 — Substrate map (stores)

| Store | localStorage / sidecar key | Scope | Survives? |
|---|---|---|---|
| useViewPrefs (global) | `virgil-view-prefs/global` | global | ✅ |
| useViewPrefs (window) | `virgil-view-prefs/window/<id>` | per-window | ✅ |
| usePreferences | `virgil-editor-prefs` | global | ✅ |
| useEditorUIState (folds) | per-doc `editor-state.json` | per-document | ✅ |
| document-settings | per-doc `virgil/document-settings.json` | per-document | ✅ |
| Outline prefs | `virgil-outline-prefs` | global | ✅ |
| WordCount config | `virgil-wordcount-config` | global | ✅ |
| Zen mode | `virgil-zen-mode` | global | ✅ |
| Pref mode | `virgil-pref-mode` | global | ✅ |
| Helper mode | `virgil-helper-mode` | global | ✅ |
| Panel typography | `virgil-panel-typography` | global | ✅ |
| Panel theme (colors) | `virgil-panel-colors` | global | ✅ |
| Library view-session | `virgil-library-view-session` | per-panel/global | ✅ |
| Library panel tabs | `virgil-library-panel-tabs[/<scope>]` | per-window | ✅ |
| Library row-viewed | `virgil-library-row-viewed-at` | global | ✅ |
| Library nav/left/papers sizes | `virgil-library-{nav,left,papers}-*` | per-window | ✅ (parity gap) |

---

## 3. Confirmed reload-loss bugs (prioritized)

All five are verified end-to-end (no hidden hydration; write AND read-back both absent — except #4, which writes but is deliberately reset on load).

| # | Bug | Fix at (file:line) | Recommended scope | Priority |
|---|---|---|---|---|
| 1 | **Paragraph titles** toggle resets to ON | `src/components/EditorLayout.tsx:896` (declare) → migrate to useViewPrefs | **global** (matches sibling decoration toggles) | P0 — the reported bug |
| 2 | **% comments (LaTeX comments)** toggle resets to ON | `src/components/EditorLayout.tsx:897` → migrate to useViewPrefs | **global** | P0 — fix in same pass as #1 |
| 3 | **Bibliography "Cited only / Full"** filter resets to "cited" | `src/panels/Bibliography/BibliographyPanel.tsx:109` → useViewPrefs | **per-window** (or per-document — see Open Questions) | P1 |
| 4 | **Paper detail Text/PDF view mode** resets to "text" (and force-resets on every paper switch) | `library/components/RightDetail.tsx:44` (+ remove/relax the force-reset effect at :50-53) → view-session-store | **per-document** (`paper:<citekey>`), or a global default | P1 (Library) |
| 5 | **Popped-out PANELS** return docked after reload | `src/hooks/useViewPrefs.ts:637` (the `poppedOutPanels: []` hard-reset) | **per-window** | P2 — *design decision*, not a clear bug (see §7). The rect already persists. |

Notes:
- Bugs 1 & 2 are the exact same `useState(true)` defect on adjacent lines and must be fixed together.
- Bug 4 is the worst-behaving: it doesn't even survive intra-session paper navigation because of the unconditional `setViewMode("text")` effect.
- Bug 5 is listed for completeness; whether it should be fixed is a genuine product decision (the codebase already persists the float *rect* and *mode* precisely so a re-open restores size — only the "still floating" state is deliberately dropped).

---

## 4. Persistence substrate map

### useViewPrefs — the canonical store (`src/hooks/useViewPrefs.ts`)

Two localStorage blobs, split by `GLOBAL_PREF_KEYS` (useViewPrefs.ts:247-266):

- **Global** — `localStorage["virgil-view-prefs/global"]`, mirrored across all windows via BroadcastChannel. Members: `placements`, `pageWidth`, `editor{Left,Right,Top,Bottom}Margin`, `codePaneRatio`, `showHighlights`, `hiddenHighlightTypes`, `showMarginalia`, `hiddenMarginaliaTypes`, `showSectionIndicator`, `showHeadingLabels`, `dividerLevels`, `dividerWidth`, `omniCategories`, `omniHideAllCards`.
- **Per-window** — `localStorage["virgil-view-prefs/window/<id>"]`, independent per window. Everything else: `dockStack`, `panelHeights`, `collapsed*`, `blank*`, `panelWidths`, `editorSplit`, `editorSplitRatio`, `panelModes`, `floatPositions`, `poppedOutCards`, `cardFloatPositions`, `topbarRightCollapsed`, `cardArchiveView`, `suppressArchiveAtomWarning`.

**Load pipeline** (`loadPrefs`, :334): read both blobs → merge `{...windowParsed, ...globalParsed}` (:462) → run `legacyMigrations` (:373+, absorbs old standalone keys) → return `{...DEFAULT_PREFS, ...parsed, <explicit overrides>}` (:621-642).

**The hard-reset gotcha (:621-642):** three fields are *force-emptied on every load* regardless of stored value — `panelMRU` (:628), `poppedOutPanels` (:637), `poppedOutOrigins` (:638). This is the documented "floats stay session-only" decision (:617-620). Everything else either reads from `parsed` explicitly or rides the bare `...parsed` spread and survives.

**Write pipeline** (`persist`, :683): iterates every key, buckets into global vs window slice by membership in `GLOBAL_PREF_KEYS`, writes both blobs.

### Sibling durable stores

| Store | Key | Scope | Pattern |
|---|---|---|---|
| usePreferences | `virgil-editor-prefs` | global | font/color/size styling |
| useEditorUIState | per-doc `editor-state.json` | per-document | section folds + last paragraph |
| document-settings | per-doc `virgil/document-settings.json` | per-document | styleId, citation package/style |
| Outline / WordCount / Zen / Pref / Helper / panel-typography / panel-theme | various `virgil-*` localStorage | global | self-contained useState + load/save effect |
| Library view-session-store | `virgil-library-view-session` | per-panel/global | versioned singleton, debounced + pagehide flush |

### Scope rules at a glance

- **Global** (mirrors across windows): decoration visibility, page geometry, margins, omni filters, code-pane ratio.
- **Per-window** (independent draft vs reviewer windows): dock shape, panel widths/heights, editor split, float rects, popped-out cards.
- **Per-document** (rides the paper's sidecar): section folds, focus mode, citation package/style, styleId.
- **Per-panel / per-libId** (Library): catalog query/sort/scroll/selection.

---

## 5. Architectural diagnosis — the root pattern

Every View-menu toggle has the same three-step lifecycle:

1. **INIT** — a value declared in `EditorLayout` (or a panel).
2. **WRITE** — the menu row's `onToggle` flips it.
3. **READ** — on reload the value is rehydrated from a store.

The persisting toggles do step 1 as `const showX = prefs.showX` (read from `useViewPrefs`), step 2 routes through the store's `update()`→`persist()`, and step 3 happens automatically inside `loadPrefs()`. The non-persisting toggles do step 1 as `useState(true)`, step 2 calls only the bare React setter, and step 3 **does not exist**. There is no localStorage write and no hydration effect — so the value re-initializes to its hard-coded default on every mount.

The two are *structurally indistinguishable at the menu layer*: `MenuBar`'s `ViewMenu` is purely presentational, taking `checked` + `onToggle` props for every row. Whether a row persists is decided entirely by where its backing state lives in `EditorLayout`. That's the trap: a developer adding a new toggle naturally reaches for `useState`, the menu wires up identically to its persisting neighbors, the toggle *works* in-session, and the reload-loss only surfaces later. `showParTitles`/`showLatexComments` sit literally above the block of comments (EditorLayout.tsx:899-904) explaining that the sibling toggles were *deliberately* moved into ViewPrefs — they were the two that got left behind.

**Why `legacyMigrations` is the proven fix path:** the store already contains a first-class mechanism (useViewPrefs.ts:373+) for absorbing standalone toggles into itself without losing prior user state. Marginalia (`virgil-show-marginalia`), divider levels (`virgil-divider-levels`), divider width (`virgil-divider-width`), and omni categories (`virgil-omni-categories`) were all once independent localStorage keys and were folded in via this exact mechanism. `showParTitles`/`showLatexComments` never even had a standalone key (they were pure useState), so their migration is even simpler — just a default of `true`. The pattern is battle-tested; the fix is to apply it.

---

## 6. Recommended unified deep fix

The minimal patch is "add two fields to ViewPrefs." The **deep fix** eliminates the entire bug class so it cannot recur. Both are described; ship the registry.

### 6a. Immediate correctness (do this regardless)

Fold the confirmed plain-useState view toggles into their proper scoped stores:

- **#1/#2 (par-titles, % comments)** → `useViewPrefs`, **global** slice:
  1. Add `showParTitles: boolean` and `showLatexComments: boolean` to the `ViewPrefs` interface + `DEFAULT_PREFS` (default `true`).
  2. Add both keys to `GLOBAL_PREF_KEYS` (useViewPrefs.ts:247-266) and `pickGlobal` (:290-311).
  3. Add `toggleParTitles` / `toggleLatexComments` setters via `update()`.
  4. Delete `useState` at EditorLayout.tsx:896-897; derive `const showParTitles = prefs.showParTitles` etc.; point the menu bundle's setters at the new ViewPrefs toggles. EditorPane wiring (:4738-4741) needs no change.
  5. (Optional) `legacyMigrations` entries — unnecessary since there was never a standalone key, but harmless for symmetry.
- **#3 (Bibliography filter)** → `useViewPrefs` per-window (`bibFilter`) or per-document — see Open Questions.
- **#4 (Library Text/PDF view)** → `view-session-store` keyed `paper:<citekey>`, and relax the force-reset effect (RightDetail.tsx:50-53) so it only resets when the *target* mode is unavailable (e.g. PDF-less paper), not unconditionally.

### 6b. The deep fix — a single typed view-preference registry

Replace the implicit "each toggle is whatever someone wired up" arrangement with **one declarative registry** that is the single source of truth for both rendering and persistence. Sketch:

```ts
// src/lib/view-prefs/registry.ts
export const VIEW_PREF_REGISTRY = {
  parTitles:      { kind: "toggle", scope: "global",  default: true,  menu: "view", label: "Paragraph titles" },
  latexComments:  { kind: "toggle", scope: "global",  default: true,  menu: "view", label: "% comments" },
  sectionIndicator:{ kind: "toggle", scope: "global", default: true,  menu: "view", label: "Current section" },
  headingLabels:  { kind: "toggle", scope: "global",  default: true,  menu: "view", label: "Labels" },
  // …dividers, marginalia, highlights, editorSplit, etc.
} as const satisfies Record<string, ViewPrefDef>;
```

From this one table, derive:

1. **The store shape.** `ViewPrefs`, `DEFAULT_PREFS`, and `GLOBAL_PREF_KEYS` are all *generated* from the registry (`scope: "global"` ⇒ membership in GLOBAL_PREF_KEYS). No field can exist in the menu but be missing from persistence — they come from the same source.
2. **The menu rows.** `ViewMenu` maps over `VIEW_PREF_REGISTRY` entries with `menu: "view"` and renders a `ViewToggleRow` whose `checked`/`onToggle` are wired to `prefs[key]` / `setPref(key, …)` automatically. A new toggle is one registry entry — it persists by construction.
3. **Scope routing.** Per-window vs global vs per-document is a `scope` field, so the persistence layer routes each pref to the right blob mechanically. Library parity (below) is the same idea with a different backing store.

**Why this is also an app improvement, not just a bug fix:** it collapses three places that must currently be kept in sync by hand (the `useState`/`prefs.X` declaration in EditorLayout, the `GLOBAL_PREF_KEYS` list, and the `ViewMenu` row JSX) into one typed table; it makes "is this pref global or per-window?" a single readable field instead of tribal knowledge spread across comments; and it gives a natural home for the still-separate durable stores (Outline prefs, WordCount config) to migrate into for consistency.

### 6c. Library parity

The Library already has its unified `view-session-store` (the analog of `useViewPrefs`). The fix mirrors the editor's:

- Route the **Text/PDF view mode (#4)** through `view-session-store` (`paper:<citekey>` scope), and stop the unconditional reset.
- Close the **parity gaps**: `LibraryView`'s nav/middle/papers sizes survive today via three standalone `useState` + localStorage pairs, while the unified store carries *dead-seeded* `layout.{navWidth,middleWidth,papersHeight}` fields nobody reads. Fold the three readers onto the store (low-risk; they already survive, this is coherence not correctness).

Apply the same registry idea on the Library side so a Library view pref is also a single declarative entry.

### 6d. Regression guard

Add a test/lint that fails when a View-menu row is backed by plain `useState`:

- **Static check:** an ESLint rule (or a small AST test) asserting that every `ViewToggleRow`/`ViewGroupRow` in `MenuBar.tsx` has a `checked` prop sourced from `prefs.*` (or, post-registry, from the registry-driven `useViewPref(key)` hook) — never from a local `useState` setter. With the registry, this is even simpler: assert there are *no* hand-rolled `useState` toggles feeding the View menu at all, because every row comes from `VIEW_PREF_REGISTRY`.
- **Round-trip test:** a unit test that, for every registry entry, sets a non-default value, runs `loadPrefs()` (or the Library equivalent), and asserts the value round-trips into the correct (global vs window vs doc) blob. This would have caught all five bugs and would catch any new toggle that forgets to persist.

---

## 7. Open questions for the user

1. **Scope of "Paragraph titles" and "% comments": global or per-document?** Recommended **global** to match their View-menu siblings (section indicator, labels, marginalia are all global) and because they read as a personal reading preference, not a property of a specific paper. But these decorations are arguably more document-flavored than marginalia — if you'd rather each paper remember its own par-titles/% -comments visibility, they should be per-document (sidecar) instead. Default recommendation: **global**.
2. **Bibliography "Cited only / Full" filter: per-window or per-document?** It's a property of how you want to view *this paper's* bibliography, which suggests **per-document**. But the simplest consistent home is the per-window useViewPrefs slice. Which matches your mental model?
3. **Library Text/PDF view mode: per-paper or a single global default?** Recommended **per-paper** (each source remembers Text vs PDF), which also fixes the intra-session reset. Confirm you don't instead want a single "always open in PDF" global default.
4. **Should popped-out *panels* re-float after reload?** Today the float *rect* and *mode* persist but the "is currently floating" state is intentionally dropped (panels return docked/closed). Popped-out *cards* DO survive. Do you want panels to behave like cards (re-float on reload), or is the current "return to dock, remember size" behavior correct?
5. **Should Preference (style-editor) mode and Helper mode persist across reload?** They currently do (global localStorage). For a debug/edit posture, persisting "on" across sessions can be surprising. Keep as-is, or make them session-only?
6. **Outline "Edit" mode and Omni bin expand pills** are currently transient by design. Confirm you're happy these reset on reload (they're editing/disclosure postures, not display preferences).
7. **Library Reader rail state** (which panel is open, column widths, popouts) is intentionally session-only per the Reader-inheritance architecture. If you expect the Reader to remember its rail layout like the main editor, that's a deliberate scope change to flag.
