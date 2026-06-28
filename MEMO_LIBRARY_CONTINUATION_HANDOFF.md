# Library effort — continuation handoff (next session)

**Paste this whole file as the opening prompt of a fresh session to resume exactly where we left off.**
You are continuing a 16-feature Library improvement effort for Virgil (the "6 deep moves"). The first
run landed 11 features + 2 partials to **local `main`, NOT pushed**. This session picks up the
remaining work. **The non-negotiable operating mode is WORKFLOW-HEAVY for every aspect of
build + validate** — see §4. That is the point of this handoff.

---

## §0 · TL;DR state

- Branch: **`main`** only (phase branches merged + deleted). HEAD `f25dcd68`, **27 commits ahead of
  `origin/main`, UNPUSHED** (Gabriel's convention — never push from a session; release via
  `/cleanup-virgil` when he says so).
- **tsc 0 · vitest 3046 pass / 1 skip / 0 fail · prefs-coverage OK · build mirrors current · no
  net-new lint.** Everything is committed and green.
- **Everything OWES a live FSA feel-check** — nothing this effort built was eyeballed in a browser
  (the dev-server port was held by another chat). Gabriel is walking it now.
- Working tree intentionally shows only Gabriel's OWN concurrent files (`MEMO_BUG_BACKLOG.md`
  modified, `MEMO_FOCUS_BAND_SECTION_END.md` untracked) — **do not touch or commit them.**

## §1 · READ FIRST (in order)

1. **MEMO_LIBRARY_OVERNIGHT_DIGEST.md** → § "☀️ MORNING DIGEST (PHASE Z)" — the complete run record:
   merge log (shas), final feature status, decisions taken, the live-eyeball checklist, the
   "Deferred (supervised follow-ups)" section with exact F#4 writer-side steps.
2. **MEMO_LIBRARY_FEATURE_WISHLIST.md** — the durable per-feature spec + **status markers** (✅/◑/NOT
   STARTED) updated through run 1. The source of truth for each remaining feature's scope.
3. **MEMO_LIBRARY_FEATURES_LITE_PLAN.md** — the 6-deep-move framing.
4. **AGENTS.md** + its "Keystroke sanctity" section (HARD constraint).
5. **library/AGENTS.md** (= `library/CLAUDE.md`, symlink) — catalog/bib-states/concurrency/build
   mirrors/Reader-inheritance/the dev-preview recipe.
6. **library/READER_INHERITANCE.md** — F#11/F#16-touching work must obey it.
7. The promote-defaults trio for any new global pref: `src/lib/dev-prefs-registry.json`,
   `tools/promote-defaults.mjs`, `tools/check-prefs-coverage.mjs` (F#13 already added the first
   library entry — copy its shape).

## §2 · What already landed (don't redo) — local `main`, unpushed

| merge sha | features |
|---|---|
| `e3b0744f` | F#12 (`--control-selected` taupe token + `-ink` AA fix), F#6 (toast lifecycle), F#5/F#7 (shared `RowMenu` primitive) |
| `607e9b8b` (+fix `6e41d7b0`) | F#1 (2-row dashboard), F#2 (verified→authenticated), F#3 (pre-digital auth route engine+skill+tests), F#4 **reader-side** layered model |
| `0e45eafa` | F#14 bib-imp fold, F#9 list column |
| `1bb50490` | F#13 column-order SSOT + global pref + promote-defaults + drag → **DM-3 complete** |
| `cc1810df` | F#16 Reader top bar (View menu + functional back/forward) |
| `ee8ed084` | F#11 **core** — `<BibEntryChrome>` + cohesive responsive PaperHeader pod + text page-picker; completes F#9 |
| `d73624d6` | F#16 breadcrumb (Reader section-path) + F#14 facet sub-bar sort → **F#16 & F#14 complete** |

**Fully landed (11):** F#1 F#2 F#3 F#5 F#6 F#7 F#9 F#12 F#13 F#14 F#16.
**Deep moves done:** DM-1, DM-2, DM-3 complete; DM-5 substantial.

## §3 · Remaining work — PICK UP HERE (each via the §4 workflow loop)

Ordered by suggested value/independence. **Confirm priority with Gabriel; he can live-verify now.**

1. **F#10 — pdf.js viewer (DM-6, decided Option B).** Vendor pdf.js's **prebuilt** viewer to
   `public/pdfjs/` (download the matching `pdfjs-<ver>-dist.zip` from the mozilla/pdf.js GitHub
   release — **NOT** node_modules; **needs network → may HARD-STOP if unavailable; if so, surface it
   and skip**), point `library/components/PdfView.tsx` at `/pdfjs/web/viewer.html` via
   `PDFViewerApplication.open({url, originalUrl})`, add `public/pdfjs/web/virgil-overrides.css`
   remapping pdf.js vars → Virgil tokens + hiding annotate/print/editor groups. **Unlocks F#11's PDF
   page-picker.** Browser-verify-only (no headless proof) → land the code, flag the live check.

2. **F#8 + F#15 — folder tabs (DM-4).** Both rewrite `library/components/panel-tabs/PanelFolderTab.tsx`
   + `folder-path.ts`. F#8 = the clipped-stroke horizontal SVG gutter (mirror the existing
   `svgH = TAB_H + 1` vertical precedent); F#15 = the Chrome-style flex-compress (SVG-flex inversion,
   ellipsized inactive tabs, always-attached active tab). **Land them together + re-verify the seam.**
   Whole point is a **1×/2× DPR pixel-perfect** result → MUST be eyeballed; implement the geometry but
   do not consider it done until Gabriel pixel-checks. (Wishlist §F#8/§F#15 have the exact spec.)

3. **F#4 writer-side — finish sources-only (supervised, partly destructive).** Reader-side is done;
   this is the perf-win half. Exact steps in the digest's "Deferred (supervised follow-ups)":
   (4) stop Python writers minting reference rows (gate `merge_paper_references._upsert_catalog_row`
   + `triage_apply._upsert_catalog_row_bib_only` to holdings-only; write the `% bib.state` comment
   instead of requiring a catalog row); (5) relax the merge shrinkage-guard
   (`merge_bibs_postflight._check_catalog`); (6) **DESTRUCTIVE** one-time prune of `present:false`
   rows — back-fill the comment BEFORE deleting; ship **dry-run-first, do NOT auto-run on the real
   library.** Also reconcile the non-standard `bib.state="needs-reauth"` written by
   `apply_metadata_mismatch_policy.py` (the bib-index reader drops it → "none"). Python pipeline →
   edit `library/scripts` sources + `npm run build:library-bundle`; locks via the CLI shims.

4. **F#11 fast-follows.** (a) **PDF page-picker** — once F#10 lands, bind the existing PagePicker
   adapter seam in `PaperHeader.tsx` to `PDFViewerApplication` (pagesCount/page/pagechanging). (b)
   **Editor Bibliography-panel `<BibEntryChrome>` adoption** — assessed **risky-defer** last run (low
   marginal value: BibliographyPanel already shares `LibraryStatusRow`+`LibraryMembershipChips`; only
   a ~15-line headline duplicates). Prereqs if pursued: add an `embedded/noDrag` mode + `dragHandle`/
   `titleStyle` slots to `<BibEntryChrome>` to avoid drag-on-drag on the data-loss-grade `BibEntryCard`.

5. **F#3 migration (optional).** The pre-digital route is built but was NOT mass-run on the real
   `master.bib`. If Gabriel wants the ~13 existing `canonical` rows re-evaluated, run
   `/library/authenticate-bib <citekey>` on them (it now routes through the pre-digital corroboration);
   needs network. Don't bulk-mutate blindly.

6. **Push / release.** After Gabriel's live walk + sign-off → push, or run `/cleanup-virgil` (heed the
   `release_prefs_snapshot_gotcha` — don't let promote-defaults fold a stale snapshot).

## §4 · THE PROCESS — WORKFLOW-HEAVY FOR EVERYTHING (the load-bearing part)

**Ultracode is on. Use the Workflow tool for every substantive build + validate step. The main loop
must hold only plans, diffs, and the merge gate — NEVER whole files.** The first run bloated context
by reading files inline; the corrected, proven cadence below kept the main loop lean across F#16,
F#13, F#11, F#14:

**Per feature/phase, run ONE Workflow with these stages (subagents own the files):**
1. **Map** (read-only `Explore`/agent, `effort:'high'`) → returns a *structured plan* (JSON schema):
   exact file:line touch-points, the approach, an honest **risk verdict**, and keystroke/inheritance
   considerations. Never read the target files in the main loop yourself.
2. **Implement** (one agent, sequential — never parallel agents editing the same tree) → makes the
   edits, runs `npx tsc --noEmit` (must be 0) + a **targeted** `npx vitest run <relevant files>`
   (NOT the full suite — too slow), adds focused guard tests, returns a structured summary +
   verbatim results. **Instruct it to STOP and report rather than leave a broken tree**, and to
   **DEFER (no changes) if the risk verdict is risky** — correctness over completeness.
3. **Review** (adversarial skeptic agent, `effort:'high'`) → returns findings (schema: file/line/
   severity/issue/fix). For bigger diffs use a multi-dimension review (one agent per concern) and
   **independently verify each finding** (a second agent, default `real=false` unless confirmed)
   before trusting it — this caught a CRITICAL F#4 bug, a double-derivation, a breadcrumb gap.

**Then in the main loop (cheap — diffs + targeted reads only):**
4. **Diff-gate:** read ONLY the correctness-critical hunks of `git --no-pager diff` (e.g. the SSOT
   helper, the new component, the shared-state owner) — your judgment gate on unsupervised code.
   Objectively confirm invariants (e.g. `grep` that a "single owner" hook has exactly one call site).
5. **Fix findings:** delegate to a focused **fix agent** (keeps file-reading out of main context); it
   fixes + re-runs tsc + targeted vitest.
6. **Full verify (main loop):** `npx tsc --noEmit` (0) · `npx vitest run` (full, expect 3046+/0 fail) ·
   `npx eslint <changed files>` (no NET-new — relocated/pre-existing patterns are OK; verify by
   comparing) · `node tools/check-prefs-coverage.mjs` if a pref changed · `npm run
   build:library-bundle` if `library/skills`|`library/scripts` changed.
7. **Commit + merge:** **`git add <explicit paths>` — NEVER `git add -A`** (the shared checkout has
   Gabriel's concurrent files; `-A` swept them in once and had to be reverted). Branch-per-phase **in
   the main checkout** (`git checkout -b phaseN-…`; NOT a separate worktree — symlinked node_modules
   panics Turbopack and Workflow subagents edit the main cwd anyway). Commit on the branch, then
   `git checkout main && git merge --no-ff`. End commit messages with the Co-Authored-By line.
8. **Update records:** flip the feature's status in `MEMO_LIBRARY_FEATURE_WISHLIST.md` + append a
   per-phase entry to `MEMO_LIBRARY_OVERNIGHT_DIGEST.md` (sha + verify status + OWED live checks).

**Workflow scripting gotchas (learned the hard way):** plain JS only (no TS types); **no backticks
inside prompt template literals** (terminates the string — use string concatenation `CTX + "..."`);
`Date.now()`/`Math.random()` are unavailable in scripts; pass structured `schema` so agents return
validated JSON; sequential `await agent()` calls avoid same-tree edit races.

## §5 · Guardrails (every phase)

- **Keystroke sanctity** (AGENTS.md): nothing per-keystroke proportional to doc size. New
  scroll/poll services must be RAF-coalesced or wall-clock (DiskWatcher class), never an
  `editor.on('update')` doc-walk. Re-verify with `window.__virgilBusStats()` flat on typing.
- **Reader-inheritance** (READER_INHERITANCE.md): no Reader-specific render code in
  `library/components/`; channel through the shared `EditorPane` layer / `READER_CHROME` /
  `reader-view-prefs.ts` named bundles.
- **Build mirrors**: edit `library/skills`+`library/scripts` sources; `npm run build:library-bundle`;
  never hand-edit `public/skill-bundle/**` or `.claude/commands/library/**`.
- **Python locks**: write master.bib/catalog/inbox via the CLI shims (`_tools.py`,
  `update_master_bib_entry.py`, `update_catalog_entry.py`), never direct.
- **Concurrent checkout**: Gabriel edits the same tree live → verify HEAD before writes, preserve his
  files/branches, explicit `git add` only.
- **Don't push** unless Gabriel says so.

## §6 · Decisions already made — DO NOT re-litigate (confirm only if asked)

- F#3 confidence model: authenticate a pre-digital work when **≥2 independent sources agree on
  title+author** OR **1 authoritative catalog + publisher match**; per-record bar = book-title sim
  ≥0.85 + author overlap + year ≤5y; **year gate `<1980`** (reconciled from docs' ~1950). Fail-closed
  to the `canonical` descriptor. Tune `score_predigital` in `bib_auth.py` if Gabriel wants a different
  bar. (NOT mass-run on the real lib — re-runnable via `/library/authenticate-bib`.)
- F#4 = sources-only / layered-hybrid; reader-side done, writer-side is §3 item 3.
- F#1 dashboard: strict binary (Authenticated vs Non-authenticated = bibEntries − authenticated).
- F#12 repointed the **global** `.iconbtn-toggle`/`.topbarbtn` aria-pressed rules to the taupe family
  (app-wide), not just the 6 library controls — confirm Gabriel's happy with the breadth.
- F#5 shared menu primitive lives at `library/components/RowMenu.tsx` (imported cross-silo by
  `src/components/library/MyPapersPod.tsx`).
- F#11 editor-Bibliography-panel adoption: risky-defer (§3 item 4b).

## §7 · Quick orientation commands (run once at session start)

```
git -C /Users/gabriel/Programming/virgil log --oneline -12
git -C /Users/gabriel/Programming/virgil status --short      # expect only Gabriel's 2 files
npx --prefix /Users/gabriel/Programming/virgil tsc --noEmit   # expect 0
```
Then read §1, confirm priority with Gabriel, and start the §4 loop on the chosen item.
