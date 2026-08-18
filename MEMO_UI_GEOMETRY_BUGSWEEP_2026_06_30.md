# UI-geometry bug sweep — 2026-06-30

Bug-catcher session. Four bugs submitted (UI geometry / Library chrome). Research
only — **no code edited**. A separate bug-cleaning session should act from this.
HEAD at diagnosis time: `a69ea9e5` (main, clean).

> **CENTRAL DESIGN PRINCIPLE** (applies to all four): prefer the DEEP UNIFIED
> architectural fix that captures the bug *class* and improves the app over a
> surgical one-off patch. The deep fix is given first; the surgical version is
> recorded only for contrast / fallback.

## Running list

1. Library inner-tab outline overruns the pod corner — **DIAGNOSED** (root cause likely; needs live pixel/DPR confirm)
2. Central dashboard: drop the standalone "Sources" card — **FIX-SKETCHED** (trivial, safe)
3. FULL-APP rounded-corner uniformity — **FIX-SKETCHED** (token-scale proposal + migration map below)
4. Library PDF view: inset + thin manila border — **FIX-SKETCHED** (deep = shared framed-viewer surface)

Method: 8-agent read-only workflow (`bug-catcher-ui-geometry-sweep`, run
`wf_70de7580-6df`) — 3 focused bug diagnoses + a 4-lane app-wide radius sweep +
a synthesis pass. Bug #1 + bug #2 were re-verified by hand (the bug-#1 agent ran
on Haiku and its pixel theory didn't survive scrutiny; the bug-#2 agent returned
a placeholder stub).

---

## Bug #1 — Library inner-tab outline overruns the pod corner — `DIAGNOSED`

**Symptom (screenshot):** in the inner library tab strip, two short stray ~1px
vertical line stubs appear at the top corner where the active manila folder tab
meets the panel pod frame (red arrows in the user's screenshot, sitting in the
inter-panel gutter near the top). Reads as the tab's outline "overrunning" the
pod's rounded corner.

**Where the geometry lives:**
- [library/components/panel-tabs/folder-path.ts](library/components/panel-tabs/folder-path.ts) — the SVG path builders. The tab is a self-contained SVG silhouette: rounded top corners (`R=10`), vertical sides, and **convex swoop hooks at the bottom corners** flaring outward to a flat base. `buildActiveTabStrokePath` (`:147-163`) traces top+sides+swoops but **omits the bottom edge** so the panel frame's top border draws the seam. `STROKE_INSET=0.5` (`:49`) + the `+1` px gutters in `tabSvgGeometry` (`:75-76`) are half-pixel-crispness compensation.
- [library/components/panel-tabs/PanelFolderTab.tsx](library/components/panel-tabs/PanelFolderTab.tsx:158) — renders the SVG (fill group + stroke group + a 1px fill-bridge `<rect>` at `:174`). Active tab gets `marginBottom:-1` (`:152`) to overlap the body's top border by 1px.
- [library/components/panel-tabs/PanelTabStrip.tsx](library/components/panel-tabs/PanelTabStrip.tsx:362) — strip is `align-items:flex-end`, `overflow-x:hidden`, `padding:'0 4px 1px'`.
- [library/components/TabbedLibraryPanel.tsx](library/components/TabbedLibraryPanel.tsx:477) — the panel **body frame**: `border:1px solid var(--topbar-border)`, `border-radius:10`, `overflow:hidden`. (Same `R=10` as the tab — see deliberate exception in bug #3.)

**Root cause (architectural — confidence MEDIUM on the exact pixel mechanism,
HIGH on the structural cause):** the tab silhouette (an SVG path in the tab's
own coordinate space, shifted by a 0.5px stroke inset inside a viewBox that's
+1px oversized) and the panel body frame (a CSS rounded-rect `border-radius:10`
with `overflow:hidden`, a *separate* coordinate system one DOM level up) are
**two independent corner geometries that must tangent at the join but are
computed separately**. Nothing guarantees the tab's outer outline meets the
panel frame's rounded corner cleanly. Where they fail to tangent, a 1px stub of
one outline is left exposed against the cream gutter. The half-pixel machinery
(`STROKE_INSET`, the `+1` gutters, `marginBottom:-1`, the fill-bridge `<rect>`,
the strip's `overflow:hidden`) makes the exact alignment fragile and
DPR-sensitive.

> The Haiku agent claimed the stubs are the *top-corner* stroke being half-clipped
> by `overflow:hidden`. **Reject that as the primary cause:** the swoop feet are
> at the *bottom* (y=tabH) and the top corners sit mid-strip, not at the panel
> join. The stubs appear at the tab↔frame *junction*. The live mechanism is one
> (or a mix) of: (a) the active tab's **swoop-foot outer stroke** overshooting the
> panel frame's rounded corner; (b) the **panel frame's own vertical border**
> painting a 1px segment above where its corner arc begins (the strip sits above
> the frame, so the frame's straight side-border can show for ~1px before the
> R=10 arc starts); (c) a half-pixel seam from the `marginBottom:-1` overlap not
> landing on a device pixel.

**Deep unified fix:** make tab↔frame corner tangency a **single geometry
source of truth**. The tab corner radius, the panel-frame corner radius, and the
seam offset should derive from one shared constant set (today `R=10` is
*duplicated* as a literal in `folder-path.ts`, `PanelFolderTab.tsx`,
`TabbedLibraryPanel.tsx`, and `NavPod.tsx` — see bug #3's "manila radius set").
Promote it to a named token (`--library-manila-radius: 10px`) read by all four,
and have the folder-path math + the frame both consume it so the tab outline and
the frame corner are computed from the same origin and provably meet. While
there, move the half-pixel compensation **into the viewBox** (`viewBox="-0.5
-0.5 (svgW+1) (svgH+1)"`, drop the inset translate) so the 1px stroke lands on
integer device pixels at every DPR without an inset-shift that can overshoot the
boundary.

**Surgical fix (fallback):** clip the SVG to its own box
(`clip-path: inset(0)` / `overflow:hidden` on the `<svg>` itself, not just the
wrapper) to kill any protruding stub; or nudge the panel-frame top border to
start its arc 1px lower so no straight side-border segment shows above the
corner. Cheap but doesn't address the duplicated-geometry class.

**Verification the cleaning session must do (live, FSA — preview iframe masks
this):** open the Library tab, two inner library tabs, zoom to 300–400% on the
active tab↔panel corner; check at **DPR 1× and 2×** (the 0.5 inset is
DPR-sensitive). Determine which of (a)/(b)/(c) produces the two stubs before
committing to the surgical vs deep path. Do **not** flatten `R=10` to 8 (the
manila aesthetic is deliberate — see bug #3 exceptions).

---

## Bug #2 — Central dashboard: drop the standalone "Sources" card — `FIX-SKETCHED`

**Ask:** in the Central Library dashboard, remove the standalone "Sources /
documents on disk" stat card; the adjacent "Indexed … of N sources" card already
carries the source count, so the standalone card is redundant.

**Where:** [library/components/LibraryCentralDashboard.tsx](library/components/LibraryCentralDashboard.tsx:124) — `StatsGrid`, the "Library" `<Section>`. Today renders 4 cards: Bibliography, **Sources** (`stats.sourcesWithFile`, sub "documents on disk", `:124-128`), Indexed (`stats.indexed`, sub `of ${fmt(stats.sourcesWithFile)} sources`, `:129-133`), Deep-indexed (`:134-136`).

**Fix:** delete the `Sources` `<StatCard>` block (`:124-128`) only.
- `stats.sourcesWithFile` **must stay** — still referenced by the Indexed card's sub-label (`:130`) and the header `summarize()`. Do **not** touch [library/lib/catalog-stats.ts](library/lib/catalog-stats.ts) `computeCatalogStats`.
- **No layout fallout:** `.lib-dashboard-grid` is `grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))` ([library/styles/library.css:484](library/styles/library.css:484)) — auto-flow, so 4→3 cards reflows cleanly, no fixed column count to adjust.
- Surviving wording: the user's phrasing ("just indexed sources card, which also lists out of X sources") confirms the **Indexed** card is the keeper. `Indexed / of N sources` already reads correctly and mirrors the sibling pattern (`Deep-indexed / of N indexed`). Optional polish: relabel "Indexed" → "Indexed sources" for self-evidence, but not required.

**Confidence:** HIGH. One JSX block removal; verified no stat/layout coupling.

---

## Bug #3 — FULL-APP rounded-corner uniformity — `FIX-SKETCHED`

**Ask:** "Check ALL windows, pods, panels, cards, etc — I want the SAME geometry
for rounded corners throughout. Right now some are rounder, some are squarer."

**Diagnosis:** today ~11 distinct radii are in use (2/3/4/6/8/10/14/20px,
0.25/0.375/0.5rem, 999/9999px) and **only `--pod-radius:8px` and
`--panel-radius:14px` are tokenized** ([src/app/globals.css:65-66](src/app/globals.css:65)) — and barely referenced. Everything else is a hard literal or a Tailwind
`rounded-*` class. This is exactly the situation the STYLE_GUIDE already bans for
*colors* ("Tokens are the single source of truth; a consumer that hard-codes is a
bug") but radius never got the same treatment. Full per-site inventory captured
in the workflow output; the synthesis is below.

### The "some rounder, some squarer" the user is actually seeing (top offenders)

1. **Menus disagree with each other.** Dropdown/popover menus split between `rounded-md` (6px: MenuBar:366, PanelThemePicker, collab dropdown, BibEntryPickerMenu) and `rounded-lg` (8px: MenuBar:635 view-options, FontPicker, TexFilePicker, PreferenceModePicker). Two menus opened from the *same MenuBar* have different corner roundness. **Most visible.**
2. **Modals are an odd third roundness.** `SystemDialog` + `FontsDialog` use `rounded-xl` (12px) while the buttons/inputs inside them are 6px and the side panels beside them are 14px — 12px reads as a mistake, not a choice.
3. **Code / math blocks mismatch.** LaTeX code-block preview 6px, tiptap `<pre>` 0.375rem(6px), display-math 0.375rem(6px), but inline-math 0.25rem(4px) — adjacent surfaces in one document don't share a radius.
4. **Icon/topbar buttons (hard 4px) vs text Buttons (6px)** — sibling controls in the same toolbar are visibly squarer on the icon buttons.
5. **Token parent, literal children** — swatches/inner rows hard-code `4` inside popovers that use `var(--pod-radius)` (SelectionColorPopover, BibCard, BibEditModal).
6. **Annotation micro-family** spans 2/3/6px with no shared token (label 3px vs chips/toggles/delete 2px) — 1px diffs that read as sloppiness on tightly-grouped elements.
7. **Stack components ad-hoc**: strip 10px, thumbnail 6px, no token, no relation to 8px pod.

### Proposed unified radius scale (the DEEP fix)

Add to `globals.css :root`; **keep** the two existing tokens (widely referenced —
don't orphan/rename). Six steps total, down from ~11:

| Token | px | Usage |
|---|---|---|
| `--radius-xs` | 3px | smallest in-text/chip details: inline marks (highlight, citation/footnote/label markers), annotation chips/toggles/delete, kbd keycap, checkbox. **Collapses today's 2px AND 3px** into one micro step. |
| `--radius-sm` | 4px | small controls & inner rows: icon buttons, topbar buttons, color swatches, inner list items, scrollbar thumb, drag-handle hit area, dropdown hover items. |
| `--radius-md` | 6px | primary CONTROL radius (STYLE_GUIDE Buttons/Inputs default): all `<Button>`, inputs, segmented controls, copy buttons, tooltips, hint bubbles. (`rounded-md` already = 6px.) |
| `--pod-radius` | 8px | **KEEP.** Canonical CARD + POD + MENU + small-panel radius: cards, sub-pods, **all dropdown/popover menus** (absorbs the md-vs-lg menu split), floating menus, editor pod, code/display-math blocks (6px→8px join), figure images. (`rounded-lg` maps here.) |
| `--panel-radius` | 14px | **KEEP.** Large PANEL + MODAL tier: sidebar panel pods, docked floating panels, **system/font dialogs** (12px→14px join). |
| `--radius-pill` | 9999px | **NEW.** Fully-rounded capsules: status pills, page-scroll lozenges, pgmark chips, drag-ghost badges. Unifies 999/999px/9999px/20px-lozenge/`rounded-full`. |

### Migration (by tier — not blind find/replace)

- `2px` + `3px` micro-radii → `--radius-xs`.
- `4px`/`4` small controls/rows/swatches → `--radius-sm`; **but** any *menu* that drifted to 4px → `--pod-radius`.
- `6px`/`6` buttons/inputs/tooltips → `--radius-md`; **but** *dropdown menus* (RowMenu, AI-requests, label-ref popover) → `--pod-radius`; text-block annotation cards → `--pod-radius`.
- `0.375rem` code/display-math blocks → `--pod-radius` (joins the pod tier; fixes the inline-vs-display-math split, inline stays `--radius-sm`).
- `rounded-md` controls/inputs stay 6px (now token-backed); `rounded-md` *menus/cards* → `--pod-radius`.
- `rounded-lg` cards → `--pod-radius`; `rounded-lg` *menus* → `--pod-radius` (ends the md-vs-lg menu split).
- `rounded-xl` (12px) modals → `--panel-radius` (14px).
- `8px`/`8` literals & fallbacks → bare `--pod-radius`.
- `20/999/999px/9999px`/`rounded-full` capsules → `--radius-pill`.

### Tailwind mapping (v4 `@theme inline`, no JS config)

`rounded-sm→xs`, `rounded`(DEFAULT)`→sm`, `rounded-md→md`, `rounded-lg→--pod-radius`,
`rounded-xl→--panel-radius`, `rounded-full→pill`. Because `rounded-md`(6) and
`rounded-lg`(8) already match their targets, **most existing class usage stays
visually identical and just becomes token-backed** — the only intentional value
shifts are modals (12→14) and code/display-math (6→8), both deliberate tier joins.

### Deliberate exceptions (do NOT unify)

- **Manila radius set `R=10`** — `PanelFolderTab` (`folder-path.ts` geometry-coupled), `TabbedLibraryPanel` body frame, `NavPod`. Documented-deliberate (comment at `PanelFolderTab.tsx:21-25`: "Do NOT fix this to 8 to unify"). If anything, promote to a named `--library-manila-radius:10px` (ties into **bug #1's** deep fix) rather than collapsing to 8.
- **`--radius-pill` / `rounded-full`** capsules — must stay maximally round.
- **Perfect-circle dots & avatars** (`border-radius:50%` / `rounded-full` on a 1:1 box) — StackIcon, presence/claim/status dots, collaborator avatars, scrollbar edge cap. Circles by aspect ratio; a px token would deform non-square ones. Leave `50%`/`rounded-full`.
- **Print-mode reset** (`globals.css:4396` `--pod-radius:0 !important`) — flattened on purpose.
- **Hairlines / drop-indicator bars at 0/1px** — 1px insertion bars, not corner radii.
- **Geometry-coupled SVG path radii** (`folder-path.ts` `S`/`R` sweep constants) — touch at the geometry layer, never blanket-tokenize.

### Guard (so it doesn't drift back)

There is currently **no** ESLint enforcement of the color-literal ban (it's a
STYLE_GUIDE convention only). Add a lightweight CI/regex check flagging new
`borderRadius:<number>`, `border-radius:<px|rem>`, and arbitrary `rounded-[..]`
in `src/` + `library/` outside an allowlist (folder-path.ts, the print block,
`*.svg` paths). Document the six-token scale + exceptions in `src/STYLE_GUIDE.md`
so radius gets the same "tokens are SSOT" treatment colors already have on paper.

**Scope note for the cleaning session:** this is large but mechanical once the
tokens + Tailwind mapping land. Recommend: (1) introduce tokens + `@theme`
mapping first (near-zero visual change), verify nothing moved; (2) sweep literals
by tier in a second pass; (3) add the guard + STYLE_GUIDE entry last.

---

## Bug #4 — Library PDF view: inset + thin manila border — `FIX-SKETCHED`

**Ask:** inset the library PDF viewer slightly so a thin **manila** border runs
all the way around it, matching the docs-side PDF viewer (reachable from the
Virgil menu).

**Reference (docs-side compiled-PDF viewer):** [src/components/EditorLayout.tsx:3977-4018](src/components/EditorLayout.tsx:3977) — a **four-layer frame**: outer flex with `paddingTop/Left/Right:4` + `paddingBottom:var(--pod-gap)` (the inset), wrapping an inner div `background:#525659` + `border:var(--pod-border)` + `borderRadius:var(--pod-radius)` + `boxShadow:var(--pod-shadow)`, and the `<iframe>` filling it `border-none` + `borderRadius:var(--pod-radius)`. The 4px padding is what creates "a thin border all the way around."

**The library viewer has none of this:** [library/components/PdfView.tsx:292-299](library/components/PdfView.tsx:292) — the `<iframe>` is `width:100% height:100% border:none`, flush, mounted directly in [library/components/RightDetail.tsx](library/components/RightDetail.tsx) with no padding/border/radius.

**Manila tokens:** `--library-bg` (manila) + `--pod-radius` + `--pod-border` /
`--topbar-border`. The user wants **manila**, NOT the docs viewer's dark
`#525659` backdrop.

**Deep unified fix:** extract a single shared **framed-viewer surface**
(component `FramedViewerSurface`, or one CSS class) used by **both** the
docs compiled-PDF pane and the library PDF pane, parameterized by backdrop color
(`dark` for docs, `manila`=`var(--library-bg)` for library). Inset + border +
radius + shadow then live in **one** place and the two viewers stay symmetric
forever. Replace the hand-coded EditorLayout frame with it (`backdrop="dark"`)
and wrap PdfView in RightDetail with it (`backdrop="manila"`). **Check the
sibling Reader/PaperRender mode in RightDetail** so text-mode and PDF-mode get
the same treatment and stay symmetric (open question: user asked only about PDF,
but text mode currently scrolls edge-to-edge — likely both should match).

**Surgical fix (fallback):** wrap `<PdfView>` in RightDetail's PDF branch with an
outer `padding:4` div + inner `background:var(--library-bg)`,
`borderRadius:var(--pod-radius)`, `border:var(--pod-border)`,
`boxShadow:var(--pod-shadow)`, `overflow:hidden`. (Note: this version doesn't
fix the docs/library *duplication*.)

**Open questions:** (1) text-mode parity (frame PaperRender too?); (2) exact
manila shade — confirm `--library-bg` against a live screenshot; (3) component
vs CSS class for the shared surface (component preferred for the backdrop prop).

---

## Status summary for the cleaning session

| # | Bug | Status | Confidence | Deep fix |
|---|---|---|---|---|
| 1 | Tab outline overruns pod corner | DIAGNOSED | med (mechanism) / high (class) | one corner-geometry SSOT (`--library-manila-radius`) + viewBox half-pixel; **needs live DPR confirm** |
| 2 | Drop dashboard "Sources" card | FIX-SKETCHED | high | n/a (trivial) — delete one StatCard, keep the stat |
| 3 | App-wide radius uniformity | FIX-SKETCHED | high | 6-token radius scale + Tailwind `@theme` map + lint guard |
| 4 | Library PDF inset + manila border | FIX-SKETCHED | high | shared `FramedViewerSurface` (docs + library), backdrop-parameterized |

Note the through-line: **bugs #1, #3, #4 are all the same disease** — geometry
constants (corner radius, frame insets) duplicated across surfaces instead of
flowing from a token/primitive SSOT. The deepest move is to land the radius-token
scale (#3) first, express the manila `R=10` as a named token (resolves #1's
duplication), and route both PDF viewers through one framed surface (#4). One
architectural direction retires all three.
