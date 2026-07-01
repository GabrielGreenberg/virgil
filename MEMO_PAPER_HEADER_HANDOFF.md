# Library detail-view UI polish — session handoff (next session)

**Paste this whole file as the opening prompt of a fresh session to resume.**
Ultramode manager; WORKFLOW-HEAVY for build+validate; verify visual changes LIVE
in the dev preview (restart the preview to beat Turbopack HMR staleness — it was
stale repeatedly this session; a `preview_stop` + `preview_start` is the reliable
fix). Branch-per-phase in the MAIN checkout, `merge --no-ff`, explicit `git add`
(NEVER `-A` — the checkout is shared; concurrent files below must stay untouched).
**Never push** unless Gabriel says so.

## §0 · State

- Branch **`main`** only. HEAD **`d651d21e`**, **~23 commits ahead of `origin/main`,
  UNPUSHED**. tsc 0 · full vitest **3217 pass / 1 skip / 0 fail** · eslint clean.
- Gabriel drives the SAME checkout live — a concurrent **`pending-ai-changes`**
  effort keeps advancing `main` (e.g. `b4dea0c4`). **Verify HEAD before any write.**
  A foreign branch **`claude/eloquent-bhabha-e6defc`** exists — preserve it.
- Working tree intentionally shows only Gabriel's concurrent files — **do not touch
  or commit**: `package.json`, `tsconfig.json`, `library-data/.virgil/.skill-bundle-version.json`
  (dev-server churn), and 5 untracked memos (`MEMO_COMMENT_CHROME_AUDIT_*`,
  `MEMO_EXPEX_DROP_BAR_*`, `MEMO_GUTTER_GRIP_UNIFY_*`, `MEMO_REPORT_MARGIN_ICON_*`,
  `MEMO_UI_GEOMETRY_BUGSWEEP_*`) + `scripts/predev-clear-stale-lock.mjs`.

## §1 · What landed this session (local `main`, unpushed)

All Library **detail-view + list UI polish**, each: workflow (Implement→Review) →
diff-gate → **live preview verification** → branch → `merge --no-ff`.

| area | commit / merge | what |
|---|---|---|
| List STATUS cell | `85ce1242` / `d0e88ad4` | STATUS → **4 aligned mini-columns** of glyph-only pills (✓/—/!/⋯/✓✓/≈/↻/MS), one per facet under the pdf/idx/bib/imp header, always-filled (new `BibNotImportedPill`). Shared `STATUS_SUBGRID` SSOT drives header + rows. `long`/`compact` pill modes in `StatusPill.tsx`. |
| List STATUS header | `cef015a4` / `f7eef286` | One-line facet rail (dropped the "STATUS" word + the bottom bars); **selected column/facet gets a taupe `--control-selected-tint` bg highlight** (not just text colour). Drag-reorder preserved on the facet segments. **Composite statusRank sort trigger removed** (per-facet sort only) — flag if missed. |
| Paper header | `10800164` / `99b383ed` | **3-column** detail card: **bib** \| **full-phrase status pills** (Deep Indexed / Authenticated / Bibliography imported…) + AI-requests dropdown \| **page count** + picker + view toggle. New `long` full-phrase pill mode; `BibEntryChrome.showStatusRow` opt-out. Responsive stack < 560px. |
| Paper header refine | `e71b13c0` / `d651d21e` | **auto-APA** (removed the "more" button); **title on its own line**; **dropped membership lozenges** (`BibEntryChrome.showMembershipChips`); **raw citekey** (`bringhurst1992`, not `@book{…}`) + copy; **3 equal columns** (`repeat(3,minmax(0,1fr))`, verified 187/187/187); **narrow (maxWidth 620) + centered** over the text pod (verified center==viewport center); **Text/PDF toggle pinned top-right** (absolute, `paddingTop:26` clearance). |

(Earlier in the broader effort, on `main`: tab baseline-seam `15f18932`, and the
whole 16-feature Library effort — see `MEMO_LIBRARY_OVERNIGHT_DIGEST.md`.)

**Touch-points:** `library/components/PaperHeader.tsx`, `library/components/StatusPill.tsx`,
`library/components/LeftList.tsx`, `library/lib/list-columns.ts`,
`src/components/library/bib-entry-chrome.tsx`, `library/components/LeftListRow.tsx`.

## §2 · DEFERRED — the one ask NOT done: page selector → top-of-text-bar

**Ask:** "move the page selector into the top-of-text-bar (to the LEFT of the
back/forward button)." Deliberately NOT built — it crosses the shared editor
reader-inheritance boundary AND the target is context-ambiguous. Full findings:

- The **paper header PagePicker was KEPT in col 3** (not removed) so nothing regresses.
- The "top-of-text-bar" = the **shared EditorPane in-card chrome band**
  (`src/components/EditorPane.tsx`, `POD_HEADER_H = 26`, render ~lines 5607–5680;
  the `SectionLozenge` breadcrumb renders left ~line 5633).
- **The back/forward para-nav lives in that band's `menuBar` half**
  (`EditorPane.tsx:5675` `onParaNavBack`/`onParaNavForward`) — and **the Library
  Reader OMITS the `menuBar` bundle** (per `READER_INHERITANCE.md`). Confirmed live:
  in the Reader detail panel there is **NO back/forward** (`navButtons: []`). It only
  exists in the **full-editor paper-tab** (open-in-tab), which is the shared editor
  chrome (affects the main app too).
- There IS a sanctioned generic slot precedent: `EditorPane.leftMarginPrelude`
  (a `React.ReactNode` slot the Reader fills with its `PageScrollStrip`) — but it's
  the LEFT MARGIN (vertical), not the top band.

**Clean path (recommended) — needs a decision first:**
1. **Ask Gabriel which context** he means: (a) the Reader detail panel (which today
   has no back/forward — would need para-nav added there too, bigger), or (b) the
   full-editor paper-tab top bar (shared chrome + main-app impact).
2. If (b) / general: add a **generic `chromeHeaderLeading?: React.ReactNode` slot** to
   the EditorPane chrome band (render it left of the breadcrumb/para-nav, mirroring
   the existing `leftMarginPrelude` pattern — a GENERIC slot, so it does NOT put
   Reader-specific code in the shared layer). Thread the Library `PagePicker` into it
   from `RightDetail` → `PaperRender` → `EditorPane` (RightDetail already owns
   `pgmarkPages` + `viewMode`). Then remove the PagePicker from PaperHeader col 3
   (col 3 becomes just the page-count label).
3. Keystroke-sanctity: the band is O(1); a `ReactNode` slot adds no per-keystroke work.

## §3 · How to verify live

`preview_start` (`virgil-dev`) → **restart to beat stale HMR** → Library tab →
Central Library → open an indexed paper. `bringhurst1992` (deep-indexed, "12 pages",
Authenticated) via **open-in-tab** gives the WIDE 3-up header; `genette1997` in the
narrow detail panel gives the stacked layout. Detail panel is ~330px (stacks < 560px);
open-in-tab is full width (3-up, pod caps at 620 centered).

## §4 · Guardrails

Explicit `git add <paths>` only. Verify `main` tip before every merge (concurrent
`pending-ai-changes`). Don't touch Gabriel's concurrent files/branch. Reader work
must obey `library/READER_INHERITANCE.md` (no Reader-specific render code in the
shared editor — use `READER_CHROME` / generic slots). Never push unless told.
