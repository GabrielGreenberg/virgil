# Overnight handoff — Library features build

This file is a **paste-ready prompt** to launch the autonomous overnight implementation of the
16-feature library wishlist. Copy everything in the block below into a fresh session (ideally with
**ultracode on** and a generous token budget). It is written to run **unattended**: it surfaces
decisions **at the start** (a ledger) and **at the end** (a morning digest), and never blocks
mid-run.

---

````text
You are implementing a 16-feature Library improvement effort for Virgil, AUTONOMOUSLY and OVERNIGHT.
Work unattended to completion; I (Gabriel) will review in the morning.

═══ CENTRAL DESIGN PRINCIPLE (overrides everything else) ═══
Produce UNIFIED, DEEP, ARCHITECTURAL solutions that capture a RANGE of related phenomena. Avoid
superficial, surgical patches. Whenever reasonable, reach for the DEEPEST solution that ALSO improves
the app generally. The 16 features are deliberately framed as SIX deep architectural moves, not 16
patches — build the deep move once; the surface features fall out of it. If you find yourself writing
a one-off patch, stop and ask whether there's a unifying abstraction that subsumes it and its
neighbors.

═══ READ FIRST (in this order) ═══
1. MEMO_LIBRARY_FEATURES_LITE_PLAN.md          — the grouping into 6 deep moves + phasing + open decisions (your map)
2. MEMO_LIBRARY_FEATURE_WISHLIST.md            — full per-feature scope, DECISIONS, file:line touch-points, cross-cutting section (the durable spec)
3. AGENTS.md  +  its "Keystroke sanctity" section   — the per-keystroke invariant (HARD constraint)
4. library/CLAUDE.md  +  library/AGENTS.md     — the Library subsystem: catalog, bib states, concurrency, build mirrors, Reader inheritance, the dev-preview recipe
5. library/READER_INHERITANCE.md               — the Reader pattern (F#11/F#16 must obey it)
6. src/STYLE_GUIDE.md  +  docs/agents/glossary.md   — design tokens + terminology (note the "source vs reference" and "My Papers pod" entries)
7. docs/architecture/VIRGIL.md  +  docs/agents/overview.md   — the architecture spine
8. The promote-defaults trio (for F#13): src/lib/dev-prefs-registry.json, tools/promote-defaults.mjs, tools/check-prefs-coverage.mjs

The wishlist's per-feature "Scope & touch-points" already cite exact files/lines from prior research
workflows. Those workflow outputs lived in /tmp and are gone — the WISHLIST is the source of truth;
re-derive from the cited files if you need more.

═══ OPERATING MODE (unattended) ═══
• PHASE A — START LEDGER (do this first, before any code). Read everything above. Produce a
  "Decisions & Assumptions Ledger": every open decision across the 16 features, each marked either
  (i) DEFAULT-TAKEN (state the default you'll use + 1-line rationale — use the "lean" defaults in the
  wishlist) or (ii) NEEDS-GABRIEL. For NEEDS-GABRIEL items, since I'm asleep: pick the most
  reasonable, architecture-respecting option, document it LOUDLY in the ledger, and PROCEED. Only
  HARD-STOP a single feature (not the whole run) if proceeding would be destructive/irreversible with
  no safe default — skip it and continue with the rest. Write the ledger to
  MEMO_LIBRARY_OVERNIGHT_DIGEST.md as you start.
• THROUGHOUT — never stop to ask. Take documented defaults. Keep moving.
• PHASE Z — MORNING DIGEST. Append to MEMO_LIBRARY_OVERNIGHT_DIGEST.md: what landed (per phase, with
  commit shas), every decision/assumption you made, explicit QUESTIONS FOR GABRIEL, anything deferred
  or blocked, and the verification status (tsc / vitest / lint / live).

═══ ALREADY DECIDED (do not re-litigate) ═══
• F#4  → catalog membership = SOURCES-ONLY, layered-hybrid (catalog=holdings; master.bib+bib-index.json
         =reference universe; bib.state in the master.bib "% bib.state" comment, projected into
         bib-index.json; search+stats over bib-index). Migration MUST back-fill the comment from any
         row whose state predates it BEFORE pruning rows (the one data-loss risk).
• F#3  → pre-digital ("canonical") works become a ROUTE to `authenticated` via metadata +
         citing-work triangulation (OpenAlex/Crossref/Semantic Scholar reverse-citation + book
         catalogs); NO fetch/OCR of digitized copies. canonical stops being a terminal auth state.
• F#10 → swap the native PDF iframe for pdf.js's PREBUILT viewer (vendored to public/pdfjs/ from the
         matching mozilla/pdf.js release zip — NOT node_modules), restyled to Virgil tokens.
• F#12 → new `--control-selected: #8a7355` token (warm taupe), repoint the 6 segmented controls; leave
         global `--accent` untouched.

═══ PHASING (from the lite plan — deep-first, dependency-respecting) ═══
Phase 0 Foundations:        F#12 (token, lands FIRST), F#6 (toast), F#5+F#7 (one shared menu primitive)
Phase 1 Bibliography subsystem: F#4 + F#2 + F#3 + F#1  (DM-1 data model + DM-2 status ontology — ONE coherent pass)
Phase 2 List-table:         F#14 → F#13 → F#9  (fold bib-imp, then the order SSOT over the 9-track grid, then the open column)
Phase 3 PDF surface:        F#10  (prerequisite for F#11's page picker)
Phase 4 Reader chrome+header: F#11 + F#16  (extract <BibEntryChrome>; complete the Reader menuBar-bundle inheritance)
Phase 5 Folder-tab primitive: F#8 + F#15  (land together; EVALUATE unifying with the main-app DocumentFolderTab)
Dependencies: F#12→F#11; F#10→F#11; F#4→F#1/F#2/F#3/F#14; F#2→F#11; F#9→F#11; F#14(fold)→F#13.

═══ PER-PHASE LOOP (use ultracode / the Workflow tool — this is multi-agent-scale work) ═══
For each phase:
  1. DESIGN deeply — author the unifying abstraction (the deep move), not the surface feature. Spawn
     independent design perspectives if the solution space is wide; synthesize the best.
  2. IMPLEMENT in a dedicated worktree/branch for the phase.
  3. VERIFY — tsc 0, full vitest green, no NEW lint; live-check via the dev-preview library recipe
     (library/CLAUDE.md → "Verifying the Reader live": set localStorage virgil:force-dev-storage=1,
     seed an idb tab, open an indexed paper). Confirm keystroke sanctity where the editor is touched
     (window.__virgilBusStats() flat on plain typing).
  4. ADVERSARIALLY REVIEW the phase's diff (a skeptic pass / the code-review machinery); fix real
     findings.
  5. MERGE to local main, no-ff, NOT pushed (Gabriel's convention). Record the sha.
  6. UPDATE MEMO_LIBRARY_FEATURE_WISHLIST.md statuses for the landed features.

═══ GUARDRAILS (every phase) ═══
• KEYSTROKE SANCTITY (AGENTS.md): no per-keystroke work proportional to doc size. Consume the
  DocStructureBus diff; never walk the doc. Re-verify after F#16 (paraNav recorder) and F#14 (sort).
• READER-INHERITANCE (READER_INHERITANCE.md): F#11/F#16 go through READER_CHROME / the shared layer +
  the named READER_NOOP_HANDLERS / a new READER_MENUBAR_BUNDLE. NO Reader-specific render code in
  library/components/.
• BUILD MIRRORS: edit library/skills + library/scripts SOURCES; run `npm run build:library-bundle`;
  never hand-edit public/skill-bundle/** or .claude/commands/library/**.
• Python pipeline locks: write master.bib / catalog.json / inbox via the CLI shims (_tools.py /
  update_master_bib_entry.py / update_catalog_entry.py), never direct.
• Prefer DEEP over local: e.g. Phase 5 — strongly consider one shared folder-tab primitive for BOTH
  the library inner tabs AND the main-app DocumentFolderTab (same SVG-folder phenomenon), not a
  library-only fix. Phase 4 — <BibEntryChrome> must serve BOTH the editor Bibliography panel and the
  library, as one component.

═══ FRONT-LOADED DECISIONS (put in the START ledger; proceed with the noted lean if unanswered) ═══
• F#3 pre-digital auth (the biggest design surface): confidence model + thresholds; how many
  independent citing works must agree (weight authoritative catalogs > scraped reference lists);
  reconcile the year cutoff (code <1980 vs docs <1950 → pick one, document); migrate the ~13 existing
  canonical rows. Lean: ≥2 independent corroborations OR one authoritative catalog + publisher match;
  keep a year/no-identifier gate; re-run authentication on the canonical rows.
• F#11: include membership chips in the header (lean: yes); do the Bibliography-panel single-source
  <BibEntryChrome> adoption in the same pass (lean: yes — it's the whole point of extracting it).
• All other per-feature opens: take the wishlist "lean" defaults (listed in the lite plan's "Open
  decisions" section).

═══ ENVIRONMENT GOTCHAS ═══
• Dev server must run arm64 node (not Intel/Rosetta) or it crashes — see memory dev_server_crash.
• If correct code doesn't show in the local PWA, it's the HTTP cache, not the SW/build — DevTools →
  Clear site data.
• A worktree with symlinked node_modules can make Turbopack panic; `next dev` under webpack is fine.

GOAL: land as many of the six deep moves as cleanly as possible, deep-first, fully verified, each
phase merged to local main (no-ff, unpushed), with MEMO_LIBRARY_OVERNIGHT_DIGEST.md as the complete
record + your questions for me. Optimize for correctness and architectural depth over coverage — a
deeply-right Phase 1+2 beats a shallow all-six.
````

---

## Notes for Gabriel (not part of the prompt)

- **Sequencing freedom:** Phases 3 (PDF) and 5 (tabs) are independent — if you want a smaller first
  night, run Phase 0 + 1 only (the bibliography spine is the highest-value, highest-risk work and
  deserves a focused run). Phases 2/4 build on 1.
- **The riskiest, most-design-heavy item is F#3** (the pre-digital authentication pipeline) — it's the
  one place I'd consider doing the detailed plan *with you* before letting it run autonomously, since
  the confidence model is a judgment call. Everything else has clear defaults.
- **Decided items** (F#4, F#10, F#12, and F#3's evidence-sources) are locked in the wishlist; the
  handoff repeats them so the overnight agent doesn't re-open them.
- The handoff tells the agent to write its ledger + digest to **`MEMO_LIBRARY_OVERNIGHT_DIGEST.md`** —
  that'll be your morning read.
