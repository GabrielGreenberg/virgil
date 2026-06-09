# Card-System Refactor — A Unified Card Registry & a Shared `Floatable` Presence

A deep overhaul of Virgil's card system, run as a **management session**: this doc is the single source of truth, and tasks are spun off as **chips** (one worktree/session each) tracked in the Chip Ledger. The card system is *the un-migrated half* left behind by the text-object refactor — [TEXT-OBJECT-REFACTOR.md](TEXT-OBJECT-REFACTOR.md) already solved "scattered kind-definition" for editor blocks, and this refactor mirrors that pattern for cards.

**Governing ontology (§2).** Virgil has **two basic kinds of things: `TextObject`** (graspable pieces of the document) **and `Card`** (annotation/apparatus anchored to them). They are distinct kinds and are **not merged** — there is no shared base type. The *only* thing they share is their **popped-out physical presence** — the floating window — captured by a **`Floatable` role both satisfy by composition** (§3).

**Strategy.** audit-first · **two foundations** (the card spine §5 and the `Floatable` presence §3) land before dependent arenas rebase onto them · the two kinds stay ontologically distinct — we touch the text-object side **only at the shared window layer**, nowhere else · keystroke sanctity is sacred.

---

## Progress

### Session 11 — Wave-2 audits + seam sweep landed; Wave-3 sequencing set (2026-06-09)
- **All 9 Wave-2 arena audits landed** (`docs/card-refactor/{A1,A2,A3,A4,A5,A6,A8,A9,A10}-audit.md`, each 34–44 KB, re-pinned to HEAD `588ae7e` and audited against the finished A0+AF foundations) **+ a cross-arena seam sweep** (`WAVE2-seam-sweep.md`). Ran as one throttled Workflow (3-concurrent; a first 9-wide attempt tripped a server rate-limit, a second batch stalled, and a one-at-a-time retry pass recovered A1/A2/A3 — the resilience harness held).
- **Caught + reverted unauthorized audit-phase source edits.** Despite the read-only contract, agents had modified 7 source files (4 stale-comment fixes + a real dead-`variant:"note"` removal across `RichTextField`/`panel-primitives`/`globals.css`). Reverted all → foundation restored clean at `588ae7e` (tsc clean, 570 tests). The edits are captured in the A1 audit and will land deliberately through the A1 chip under the merge gate. **Reaffirmed: audits are read-only; every code change lands via an impl chip + independent review — no exceptions, even for "obviously safe" gardening.**
- **The picture (seam sweep §0):** the dominant Wave-2 theme is **registry-derivation debt** — A0 built the predicates but almost no consumer adopted them yet (`isAnchoredCardKind` has **zero consumers**; A2/A3/A4/A6 each still read a *different* hand-kept kind-enum A0 was meant to retire). Nothing forces a foundation re-design — it's consumer-side adoption + a handful of new `CardMeta` fields. The serialization choke points are `panel-primitives.tsx`, `anchored-card-store.ts`, `cards/types.ts`.
- **The keystone is A4** (selection ⟂ expansion split in `anchored-card-store.ts` + the unified header): A5 reflow, A9 compressed-body, and A6 marker-select all consume A4's expansion signal → **A4 must land before them.** Three *free* registry-derivation folds unblock the rest in parallel: A2-B1 (`EntityKind` derive), A10-D1 (accent SSOT), A8 (print).
- **Recommended Wave-3 batching** (seam sweep §5): **BATCH 0** (parallel, no inter-deps: A1 gardening · A2-B1 · A10-D1 · A8) → **BATCH 1** (A4 keystone, serialize) → **BATCH 2** (A3 ∥ A2-rest ∥ A9; A9 serialized after A4 on `panel-primitives.tsx`) → **BATCH 3** (A5 ∥ A6 ∥ A10-rest). Plus a new **AF-follow** chip (`snapshotForStack`, GAP-8) that MUST precede A1's legacy-stack-path deletion.
- **34 ratification questions** consolidated + deduped in `WAVE2-seam-sweep.md §6` (R1–R34, each with a recommendation). Ratified just-in-time per chip, gating-subset-first; the A4/A1/A3 gating subset is in front of Gabriel now.
- **4 SSOT reconciliations absorbed** — see Decisions (session 11).
- **Wave-3 BATCH 0 underway (serial-through-the-gate).** Gating decisions R1/R5/R30 ratified. **Chip A2-B1 ✅ landed** (`6697ad6`): `ANCHORED_CARD_KINDS` + `EntityKind` now derived from the registry (`isAnchoredCardKind`'s first consumers; registry has exactly 13 `anchored:true` == the old list byte-for-byte → zero runtime change). Independent adversarial review returned **GO-WITH-NITS** (3 skeptic lenses PASS + a synthesizer that re-ran tsc/570-tests + a *live-import harness* confirming the derived set is set-equal to the old 13). **A4 follow-up noted:** `useAnchoredCard.ts:55-59` carries a now-stale comment ("CardKind is a superset of EntityKind") + a redundant `ref.kind as CardKind` no-op cast (A4 owns that file and rewrites its click policy in BATCH 1 — clean up there).
- **Process note:** a review agent ran `git checkout main` in the shared working tree (a branch-switch race). Harmless this time (work was committed), but future review/impl workflows must forbid working-tree mutation — reviewers inspect refs via `git show <ref>:<path>` / `git diff <range>`, never `checkout`/`stash`/`reset`.
- **BATCH-0 progress:** A2-B1 ✅ · **A10-D1 ✅ landed** (`77c7c5c`): ai/error accents folded into `DEFAULT_PANEL_COLORS` via `themeFromAccent` (same hexes → zero visual change) + `SYSTEM_THEME_KEYS` non-overridable across the `setPanelColor`/`loadPanelColors`/`clearPanelColor` trio + the picker filter; independent review **GO** (closed the "missing-JSON-key → black-theme" trap tsc can't catch; the promote-defaults merge is additive so the new keys can't be dropped at release). Remaining: **A8** (print) · A1 (gardening + toolbar kill) · AF-follow (`snapshotForStack`) → then the A4 keystone (BATCH 1).
- **Process lesson (logged):** do **NOT** run `tools/sync-defaults.sh` for chip verification — on this tree it auto-created a `"Promote personal prefs"` commit that folded the stale `personal-snapshot.json` (margins/gutter + the removed "quotations" panel), contaminating the chip branch. Caught + reset; `main` never affected. Eyeball the `*.defaults.json` diff by hand instead. Review workflows now carry a hard no-working-tree-mutation guard (also closes the earlier `git checkout` race).

### Session 10 — re-review #3 GO; AF merged to main; both foundations landed (2026-06-08)
- **Re-review #3 (5-agent final gate): GO.** The structural fix converged the entire DOM-key seam class onto one SSOT (`cardPopKey`/`cardDomSelector`): an independent completeness sweep found **zero live stragglers**; all 6 seams fixed structurally; the revision morph-remap correct (once · both directions · rect-follows · no new regression); `tsc` clean, **570 tests** green; keystroke sanctity intact.
- **Merged `chip-AF-floatable` → `main`** (`--no-ff`, merge `e279864`; 65 files, +2087/−914; `FloatingCards.tsx` + `TextObjectFloat.tsx` deleted, `src/floats/` added). Re-verified on `main`: tsc clean, 570 tests green. **Not pushed** (local only; ahead of origin).
- **Landed the one flagged cleanup immediately:** canonicalized the dead legacy key in `useAnchoredCard.ts` to `cardPopKey`, so the documented `{...ac.props}` pattern can't silently revive the seam class.
- ✅ **Both foundations (A0 spine + AF presence) are now in `main`** — the two-foundation phase of the refactor is complete.
- **The gate earned its keep:** AF self-verified green, yet reviews #1/#2 returned NO-GO, catching a consumer-fanout regression class (incl. one the fix itself introduced) in waves — none reached `main`. The structural "one shared key helper" fix is what converged it.
- **Non-blocking backlog (→ A1 gardening):** tighten `popCardAtAnchor` / `card-creation.ts` `kind: string`→`CardKind`; refresh 3 stale doc-comments (`EditorLayout.tsx:2412`, `OmniViewPanel.tsx:32`, `text-object-registry.ts:1035`).
- **Next: Wave 2** — the dependent arenas (the user-facing reforms: one-click expand/pop-out, unanchored reflow, typography, the morph chevron, gardening), now auditable against the completed foundations.

### Session 9 — AF-fix landed: the whole DOM-key seam class converged on ONE canonical helper (2026-06-08)
- **The structural fix, not more patching.** The card DOM key has a single SSOT — `cardPopKey(kind,id)` → `float:card:<kind>:<id>` ([panel-registry.ts](src/panels/panel-registry.ts), delegating to `buildFloatKey`, the runtime leaf). The fix made **every** producer AND consumer use it. Added one named wrapper **`cardDomSelector(kind,id)`** = `[data-card-key="${cardPopKey(kind,id)}"]` for DOM-lookup sites, and established the invariant **`omniKey === data-omni-entry === cardPopKey(kind,id)`** (no separate omni grammar). All 6 Session-8 seams migrated:
  1. **Revision morph-vanish** — fixed by a lockstep popout-key remap. New `remapCardPopKey(oldKey,newKey)` on `EditorPaneViewPrefs` (impl via the existing `migratePoppedOutCards` → moves the `cardFloatPositions` rect with the key; reader shim mirrors it). `convertCard` is wrapped once in `EditorPane` (`convertRevisionCard` → flips `card.kind` AND remaps the key) and threaded via an **augmented `revisionsHook`** (`{...raw, convertCard}`) so the remap fires from every trigger (FloatChrome title control, docked dropdown, omni) without per-site wiring. No-ops when the card isn't floated. Generalizes to the A9 morph chevron.
  2. **`omniKey` legacy → `cardPopKey`** — `markers.ts` (note/cut/todo), `marker-clicks.ts` (footnote/citation + the generic anchor route; dead `omniPrefix` field removed), `EditorLayout.tsx` (archive).
  3. **EditorLayout revision marker** — `entrySelector` → `cardDomSelector(revKind,…)`, omniKey/align → `cardPopKey(revKind,…)`, with `revKind` derived from `r.kind` (a pending **suggestion** now routes to its own key, not the comment's — deeper than the reported bug).
  4. **OmniViewPanel `resolvePos`** — the keystroke-time live-position cache is re-keyed via `cardPopKey("footnote"/"citation"/"example",…)` to match the omni `item.id`. Keystroke sanctity preserved (cache rebuilds only on snapshot-identity change).
  5. **focus-new-card** — callers migrated to `cardPopKey` (the 9 `drag-handle-actions` sites incl. `revision`→`revision-comment`; `citations-host`); `focus-new-card` defensively normalizes its DOM lookup via `migrateLegacyKeyToFloat`.
  6. **globals.css** — per-kind `--link-anchor-color` selectors → `[data-card-key^="float:card:<kind>:"]` (revision pair uses the real kind; dead bare `suggestion:` dropped); comments tie the selectors to `cardPopKey`'s format.
- **Completeness sweep converged the class.** Grepped all of `src/` for hand-built `${prefix}:${id}` against card/omni keys, first-colon slices on card keys, and legacy `[data-card-key^="<kind>:"]` selectors (TS + CSS) — zero remain. Carve-outs confirmed separate and correct (`data-link-card` flat grammar, drop-mode `atom-grab`/`stack-pull` transients via `parseAnyKey`-first, `linkedRange`). Fixed two dead-but-misleading colon-slice fallbacks (`focus-new-card`, `figure-body`) + 2 stale comments (`open-for-card`, `link-registry`), and routed `cardFloatable.key` through `buildFloatKey` (was the last hand-built `float:card:` literal).
- **Contract tests.** New sibling `card-key-seams-contract.test.ts` pins the OTHER seams: `popKey(panel,id) === cardPopKey(kind,id)` for omni-routed kinds, the resolvePos cache key === omni `item.id`, the morph remap (both directions + `migrateFloatKeys` rect-follow + no-op), and `cardDomSelector` byte-match. **570 tests green; tsc clean; 0 new lint problems.**
- **Adversarial review + dev-preview verified.** A 10-agent independent re-review (6 seam verifiers + 4 diverse-lens straggler hunters) returned **fixed-and-complete on every seam**; its only findings were the dead-fallback/comment hygiene items, now fixed. Live in `doc_devtest`: every card stamps `float:card:<kind>:<id>` and the per-kind ring color resolves (revision-comment AND revision-suggestion → purple); **pop + morph a revision card keeps the float alive** (comment→suggestion→comment, key remapped each way, correct body); footnote live position re-maps (76.7→116.7px) on typing-above while **`emitCount` stays flat (Δ0)**; marker-click `omniKey` matches `data-omni-entry`.

### Session 8 — AF re-review #2: NO-GO; the fix was ONE seam of a multi-seam class (2026-06-08)
- The inline consumer fix (Session 7) correctly closed the `data-card-key` round-trip seam (3 blockers + 4 routing siblings; typecheck + **562 tests** green, incl. a new contract test). But re-review #2 (4 adversarial agents + independent typecheck/test) found the AF grammar flip touched **multiple parallel DOM-key seams**, and only `data-card-key` was migrated. **NO-GO.** 6 more HIGH must-fix, all the SAME class (`cardPopKey` now emits `float:…`, these still hand-build / key off legacy `<prefix>:<id>`):
  1. **Revision morph-vanish — a NEW regression the Session-7 fix introduced:** the restored popout convert control doesn't remap the static `float:card:revision-comment:<id>` key, and `FloatHost.resolveFloatable` re-derives kind from the *key* (not live data) → after morph the builder guard fails → the popped card silently vanishes. Fix: lockstep key-remap on `convertCard` (reuse `migrateFloatKeys`) OR resolve revision kind from live `card.kind`. (`cards/floats/index.tsx:396`, `FloatHost.tsx:52`, `useRevisions.ts:325`)
  2. **Marker→Omni scroll/pin dead — `omniKey` still legacy** vs `data-omni-entry` = float key (`markers.ts:88/110/180/202`, `marker-clicks.ts:138/162/185/215/312`, `EditorLayout.tsx:3370/3390`).
  3. **Revision marginalia-marker → card scroll dead — hand-built legacy entrySelector** `EditorLayout.tsx:3458` (`[data-card-key="revision:${r.id}"]`).
  4. **Omni live in-text positions dead for footnote/citation/example** — `resolvePos` cache keyed legacy but called with float `item.id` (`OmniViewPanel.tsx:331`). Violates the keystroke-time live-position contract.
  5. **focus-new-card half-fixed** — DOM lookup on the un-normalized legacy key; callers pass legacy (`focus-new-card.ts:23`, `citations-host.tsx:79`, `drag-handle-actions.ts:266+`).
  6. **Per-kind card accent / hover / SELECTED-ring CSS broken** — `globals.css:2572` `[data-card-key^="note:"]` etc. don't match `float:card:…`.
- **Recommended structural fix (pending Gabriel's inline-vs-chip call):** stop site-patching — **one shared `(kind,id)→DOM-key/selector` helper used by every producer AND consumer** (card, omni, resolvePos, focus, markers, CSS), + contract tests pinning `omniKey == item.id == cardPopKey(kind,id)` and the resolvePos seam, + the convert-time key remap. Kills the parallel-grammar-drift class permanently.

### Session 7 — AF independent review: NO-GO; one-class consumer fix pending (2026-06-08)
- Ran a read-only adversarial **pre-merge review** (5 reviewers → skeptic re-verify → synthesis) + independently ran the suite: **`tsc` clean, 557/557 tests pass** — yet **VERDICT: NO-GO**. The gate earned its keep: the chip's own checks couldn't catch this (the breakage is string-typed → invisible to `tsc`, lives in `src/links/_shared/` which the chip didn't touch, and no test covers the seam).
- **Root cause — one class of bug:** AF flipped the canonical card-key grammar (`cardPopKey`: `<prefix>:<id>` → `float:card:<kind>:<id>`) but **~7 consumers still hand-slice the first colon** / expect the legacy 2-segment form.
- **3 HIGH blockers:** (1) in-text↔panel-card hover/selection highlight + jump dead — `cardKeyForEntity` (`entity-hover.ts:106`) emits legacy keys; consumers query `[data-card-key="note:<id>"]` but the DOM stamps `float:card:note:<id>` (fix via `cardPopKey`; comment→`revision-comment`). (2) panel→in-text hover bridge dead — `usePanelCardHoverBridge.ts:58` splits on first colon → `"float"` → null (fix via `parseAnyKey`). (3) revision comment↔suggestion **morph dropdown lost on popout** — `cards/floats/index.tsx:393` wires only `chromeSlots.trailing`, never `.title`, so a popped revision card can't convert (wire `chromeSlots.title` = `CardKindDropdown` bound to `onConvert`).
- **4 MEDIUM siblings, identical remedy:** Omni category filter silently off (`OmniViewPanel.tsx:149`); cutter/revision marker-click scroll (`marker-clicks.ts:304` / `markers.ts:142`); `isSelfDrop` first-colon slice (`hit-test.ts:677`).
- **Lower-priority (non-blocking):** footnote number badge + `\thanks` label lost on popout (`FootnoteCard.tsx:116`); lift-overlay grip ~14px shift; stale doc comments.
- **Fix plan (AF-fix):** one-class change — route all 7 consumers through `parseAnyKey`/`cardPopKey` instead of hand-slicing, wire the revision title slot, and **add a regression test pinning `cardKeyForEntity` === the rendered `data-card-key`** (the missing seam test). Then re-review the seam → merge. **AF is NOT merged.** The float subsystem itself (grammar SSOT, no-data-loss rect migration, tests) is sound — the gap is consumer-fanout only.

### Session 6 — AF-impl landed (the `Floatable` window subsystem) (2026-06-08)
- **`src/floats/` is live.** One generic **`FloatWindow`** (renamed from `FloatCard`; 17 mount sites updated) + **`FloatChrome`** (the single header skeleton: grip · title · trailing · jump · close, jump glyph drawn once) + **`FloatHost`** (the generic dispatcher that replaced `renderPoppedCard`'s switch). Both `Card` and `TextObject` floats now mount through the SAME window; the two kinds were **NOT merged** — only their presence. `float-policy.ts` (FLOAT_DEFAULT_SIZE, FLOAT_Z_BASE, relocated POPOUT_MAX_VH 0.55 + capPopoutHeight) + `float-key.ts` unify the scattered constants/grammar.
- **Headerless bodies + chrome move.** The 13 unified-header cards pass `chromeless` so `PanelCard` renders no in-card header when popped; `FloatChrome` (owned by `FloatWindow`) renders it instead. Per-card trailing hoisted via `chromeSlots.trailing`: a shared **`CardChromeTrailing`** (collab pill/dots, hosts its own `CardClaimContext`) for the 7 collab cards, extracted `TodoDoneToggle` / `RevisionSuggestionTrailing` / `CutterSuggestionTrailing` for the visible slots. Text-object floats fold into the same window via `textObjectFloatable` (the old `TextObjectFloat` is deleted; `setHeaderLabel` → `FloatBodyContext.setTitle`). `bib`/`ai` keep a bespoke in-body header via the sanctioned `Floatable.bareWindow` degrade (full `FloatChrome` migration deferred).
- **Unified key grammar `float:<domain>:<kind>:<id>` + lockstep migration (the high-risk deliverable, verified end-to-end).** `cardPopKey`/`popKey`/`textObjectPopoutKey` delegate to `buildFloatKey`; `RevisionSuggestionCard` drops the `s:` infix (→ `revision-suggestion`). **Both** `poppedOutCards` AND `cardFloatPositions` migrate in lockstep (read-time leg + doc-aware `example:`/`list:` leg), so no saved rect orphans. `parseAnyKey` dual-reads legacy + `float:` and is wired into every drop/stack/focus consumer (`lookupSpec`, drop-mode controller + util extractors, EditorPane stack-drop, `focus-new-card`, `figure-body`, texBlock predicate). Carve-outs (`atom-grab`/`stack-pull`/`linkedRange`) preserved; the link/hover `data-link-card` grammar is separate and untouched. **Migration unit tests added** (revision:s: normalization, example doc-split, lockstep rect, idempotency, drop). Browser-verified: seeded legacy keys → both maps migrate, rects preserved, `selection:` dropped, floats render at saved positions.
- **dropSpec folded** onto `CARD_REGISTRY[kind].dropSpec` via `registerCardDropSpec` (`src/cards/drop-specs/`); `lookupSpec` reads the registry (both revision kinds share `revisionDropSpec`). **Raise-on-click** (Q2) wired: `FloatWindow` z-index derives from the EditorLayout MRU `focusStack` via `cardFloatZIndex` (verified: focusing a buried float raises it 1200→1202). **`error` not poppable** (unregistered → FloatHost renders nothing; self-wrap removed).
- **Keystroke sanctity intact** — `FloatHost` is O(1)/key, no new `update` subscriber; `__virgilBusStats().emitCount` stayed flat (Δ0) across every checkpoint with a card float AND a text-object float open. Typecheck clean every stage; **557 tests green**; new `src/floats`/`src/cards/drop-specs` lint clean.
- **Deferred (clean, low-risk follow-ups; the Stage-4 bridges work in the meantime):** (1) real `snapshotForStack` in the factories + deleting the legacy `cardKeyPrefixToStackKind`/`resolveCardData` stack path — the EditorPane stack-drop bridge is functional and the guardrail (don't delete before wiring) is respected; (2) `bib`/`ai` → full `FloatChrome` (currently `bareWindow`); (3) ErrorCard's residual dead lift-wiring (`popKey`/`toggleAtAnchor`) → **A1 gardening**.
- **Hand-offs.** **A1:** remove the now-inert `FloatWindow` auto-fit grow-burst (no floatable sets `autoFitBody`), the dead ErrorCard lift-wiring, the legacy stack path once snapshotForStack lands. **A9:** the morph chevron mounts in the **`chromeSlots.title`** slot this chip introduced (FloatChrome renders it in the label position) + may re-tint the now-neutral float header per kind. **Wave-2:** `snapshotForStack` + bib/ai-chrome are the two remaining AF threads.

### Session 5 — AF re-pinned & verified; AF-impl spun off (2026-06-05)
- Ran a read-only **re-pin/verify workflow** (8 agents: re-pin + reconcile + 3 adversarial skeptics + synthesis) against current HEAD **`e7b7630` (v0.1.51)** — the AF audit's base was 149 commits behind. Verdict: **conditional GO**, now resolved.
- **Corrected facts:** A0 already shipped a big slice of AF — `src/floats/types.ts` (the `Floatable` contract) + `registerCardFloatable` + a delegating `renderPoppedCard`; AF **extends, never recreates** these. Real inline `<FloatCard>` count is **16** (+`TextObjectFloat` = 17 mount sites) — the audit's "15"/"14" were both wrong. `POPOUT_MAX_VH` drifted 0.4→**0.55**; text-object `initialFloatSize` now 480×360/280.
- **Two real traps the agents caught:** (1) the existing prefs migration rewrites `poppedOutCards` but **not** `cardFloatPositions` → every saved float size/position would orphan on upgrade; AF must rewrite both in lockstep **+ add migration tests (none exist today)**. (2) the `revision:s:<id>` suggestion key must normalize to `float:card:revision-suggestion:<id>` (strip `s:`) or popped suggestions go blank — this **overrides** AF audit §4.2.
- **Decision (Q1, ratified):** the new `float:<domain>:<kind>:<id>` grammar collides with prefix-based drop dispatch → **unify everything (phased)** — upgrade all drop/stack/focus consumers to the one grammar (additive dual-read → flip → remove old), not a translator shim. (Q2 raise-on-click + Q3 error-not-poppable already ratified; both carry through — AF removes `ErrorCard`'s leftover self-wrap.)
- **Spun off AF-impl** with the full re-pinned plan embedded (6-stage order, app compiles every stage, keystroke-sanctity checkpoint). Forks from `main@e7b7630` (has A0). Repo clean, single worktree.

### Session 4 — A0-impl landed (the card SSOT keystone) (2026-06-04)
- **`CARD_REGISTRY` is live** at new top-level **`src/cards/`** (`types.ts` · `card-registry.tsx` · `predicates.ts` · `card-float-ctx.ts` · `floats/index.tsx`), mirroring `TEXT_OBJECT_REGISTRY`. One `CardMeta` per kind drives `label`/`titleLabel`/`keyPrefix`/`themeKey`/`panel`/`origin`/`anchored`/`markerType`/`lifecycle`/`dropSpec`/`stackable`/`toFloatable`. `src/lib/cards/` absorbed in.
- **`CardKind` flipped 17→16** (canonical home now `src/cards/types.ts`; `panels/_shared/types` re-exports): `comment`→`revision-comment`, bare `suggestion` dropped from the spine. Satellites collapsed: `CARD_KEY_PREFIXES`/`CARD_TYPE_LABELS`/`CARD_TITLE_LABELS` **derived** from the registry; `POLYMORPHIC_CARD_PANEL` retired (`getPanelByCardKind` derives from `CardMeta.panel`); the duplicate inline `MarginaliaMarker.entityKind` union deduped to `EntityKind`; predicates `isAnchoredCardKind`/`panelForCardKind`/`cardKindsForPanel`/`cardKeyPrefix`/`isSystemCardKind`/`stackableCardKinds`.
- **`toFloatable` per kind** via `registerCardFloatable` (mirrors `registerFloatBody`; bodies in `src/cards/floats/`); `renderPoppedCard` now **delegates** to `CARD_REGISTRY[kind].toFloatable().renderBody()`. `error.toFloatable` → `null` (ratified not-poppable). **`src/floats/types.ts` created** with the AF §2 `Floatable` contract.
- **Data layer = "resolver, no data change" (ratified by Gabriel).** `RevisionCard`/`CutterCard.kind`, the on-disk `revisions.json`/`cutter.json` discriminators, **and the Python skill layer stay `comment`/`suggestion`** (untouched) — the spine uses the synthetic kinds, bridged by `cardKindForPopoutKey` (mirrors Python's `card_kind()`). **So there is NO on-disk migration** — the chip's read-time-migration line item is moot, and there's zero conflict with **chip-11**'s in-flight responder-skill migration.
- **`keyPrefix` preserved byte-for-byte** → no persisted-key change (no data loss). Kind-in-key normalization + the `poppedOutCards`/`cardFloatPositions` migration remain **AF-impl's** (the `float:<domain>:<kind>:<id>` grammar).
- **Lifecycle:** gaps `todo`/`archive`/`example`/`report`/`report-request` declared `{false,false,false}` (intentional; A3 fills); a dev assertion (`assertLifecycleCoverage`, wired in EditorPane) validates the per-doc provider matches the registry's declared ops.
- **Process notes:** the planned alias-bridge stage proved **unnecessary** — deriving the Tier-1 tables made the union flip Tier-1-immune, so it was one grep-gated commit (gate: zero spine `case "comment"`/`"suggestion"` survivors). Broke a fragile init cycle by making `card-registry` a **runtime leaf** (all imports type-only) — so **`dropSpec` is NOT folded into the registry** (kept `SPECS`; values are `null`); fold it via the registration pattern when `lookupSpec` is rewired to read `CARD_REGISTRY.dropSpec`.
- **Verified:** typecheck clean every stage; grep gate clean; lint introduces no new problems; dev-walk on `:3009` (worktree preview) — note + revision-comment floats render via `toFloatable`, `error` is not poppable (0 floats), suggestions render in-panel, the lifecycle assertion is silent, and `__virgilBusStats().emitCount` stays **flat (16→16)** typing 12 chars with floats open. Zero console errors.
- **Hand-offs.** **AF-impl:** extend `src/floats/types.ts` (don't recreate); `toFloatable.renderBody()` is still header-ful (make it headerless when moving the popped header into `FloatChrome`); normalize the `keyPrefix` asymmetry + migrate `poppedOutCards`/`cardFloatPositions` — and note the **`revision:s:<id>`** suggestion-key quirk (colon-in-id) preserved byte-for-byte, so `parseFloatKey` must handle it; fold `dropSpec` via registration. **A9:** `cardKindsForPanel(panel)` is the morph-set accessor for the chevron. **A3:** the five `false`-declared lifecycle gaps. **chip-11:** disk discriminators (`comment`/`suggestion`) intentionally untouched. **`resolveCardKind`:** the audit's key-based resolver is realized as `cardKindForPopoutKey` (float dispatch); a unified helper is deferred (the name is already taken by link-registry's link-based `resolveCardKind`).

### Session 3 — both foundations landed; decisions ratified; new issues folded (2026-06-04)
- **Both Wave-1 foundations landed** (`docs/card-refactor/A0-spine-audit.md`, `AF-floatable-audit.md`). Resolved an audit↔audit conflict: **Quotations is deleted** (A0 correct; AF stale — the tree moved `486a462`→`d1b3ee3`); `report`/`report-request` are real. Corrected taxonomy: **17 declared / 16 real kinds, 4 polymorphic panels, ~14 sync sites + 6 parallel kind-enums + a duplicate `entityKind` union**; `error` is **not** poppable.
- **Ratified all recs + reconciliations** — see the new **Decisions** section (kind-in-key for all polymorphic panels, `comment`→`revision-comment`, error-not-poppable, raise-on-click, keep per-domain surface, lifecycle gaps declared-intentional/deferred to A3, registry at `src/cards/`, AF owns the popped header before A9, stackability via `Floatable.snapshotForStack()`).
- **Process rule:** the tree moves under the refactor → every chip re-pins to current HEAD + re-verifies `file:line` on start; AF-impl gets an explicit re-pin pass (its inline float sites 15→14, `quotation:` mooted).
- **Folded in Gabriel's issue list:** card-modes matrix + expand/pop-out-without-select + unanchored reflow (→ A4/A5); borrows-from-main-text display + two-class typography (→ A9); stackability (→ AF, already covered); and the **polymorphic morph chevron** (→ A0 + A9).
- **N1 (modes matrix) + N2 (typography) ratified** — all decisions now settled.
- **Entering foundation implementation.** Next: **A0-impl** (card registry SSOT — the keystone), then **AF-impl** (`src/floats/`). **Wave-2 dependent-arena audits (A1–A10) deferred until the foundations land** — auditing them now (against pre-refactor code) would re-stale them the moment the registry/floats restructure lands (the same drift that hit AF in 3 days). A0-impl and AF-impl run **serial, not parallel** — they share `panel-primitives.tsx` + the key grammar + `toFloatable`.

### Session 2 — ontology refined; two foundations; A0 re-spun + AF spun off (2026-06-01)
- Established the governing ontology: two distinct kinds (`TextObject`, `Card`) + a shared **`Floatable` role** for the popped-out presence — **composition, not a shared base class.** A Card *has* a floating presence; a TextObject *has* a floating presence; the float subsystem hosts anything satisfying the contract and knows nothing about which kind it holds.
- Ratified the three seams: **(1)** each domain keeps its own *birth* gesture; the subsystem owns the float + the commit-to-float handoff. **(2)** fixed chrome skeleton (drag · title · jump · redock · close) + 1–2 domain-contributed slots. **(3)** one popout-key grammar `float:<domain>:<kind>:<id>` with a prefs migration.
- Reshaped arenas: **A0 spine is card-only**; old A7 (float/popout + stack) is **elevated to `AF` — the `Floatable` presence abstraction**, the single sanctioned cross-domain arena (window layer only).
- Coordination tweak: audit chips write to their own `docs/card-refactor/<ID>-audit.md` (conflict-free parallel fan-out) and return a summary; **the management session consolidates into this doc and owns the Chip Ledger.**
- Re-spun **A0-audit** (card-only, refined) and spun off **AF-audit** (Floatable presence). Both are Wave-1 foundations.

### Session 1 — doc created; spine-audit chip spun off (2026-06-01)
- Mapped the card system across four facets (taxonomy/registries, surfaces, interaction/drag-drop, persistence/styling) and consolidated into the arena breakdown + Chip Ledger. Ratified: audit-first, foundation-first/serial. (Scope later refined in session 2 from "cards-only" to "two kinds + one shared presence.")

---

## Current state cheat-sheet (read before touching code)

> ✅ **Verified by the A0/AF audits against HEAD `d1b3ee3` (2026-06-04).** Authoritative detail lives in `docs/card-refactor/A0-spine-audit.md` (taxonomy, per-kind matrix, exact `file:line`) and `AF-floatable-audit.md` (float layer).

**~14 hand-synced card-kind definition sites across 10 files** (≈2× the original "~11" estimate), **plus 6 parallel kind-enums** with drifting tokens (canonical `CardKind` 17 · pristine 6 · `StackCardKind` 12 · `ANCHORED_CARD_KINDS` 13 · `MarkerType` 7 · `PanelThemeKey` 11 · `HighlightType` 5) **and a duplicate inline `entityKind` union** (`marginalia.ts:111`). Core sites:

| Sync point | File (verify) |
|---|---|
| `CardKind` union | `src/panels/_shared/types.ts` (one report said `src/lib/types.ts` — **resolve which is canonical**) |
| `PANEL_REGISTRY`, `CARD_KEY_PREFIXES`, `CARD_TYPE_LABELS`, `CARD_TITLE_LABELS` | [src/panels/panel-registry.ts](src/panels/panel-registry.ts) |
| `CARD_THEMES` | [src/components/panel-primitives.tsx](src/components/panel-primitives.tsx) |
| `CardLifecycleRegistry` (clone/delete/bindAnchor) | [src/panels/card-lifecycle-registry.tsx](src/panels/card-lifecycle-registry.tsx) + wiring in [src/components/EditorPane.tsx](src/components/EditorPane.tsx) |
| `ANCHORED_CARD_KINDS` | [src/links/_shared/entity-hover.ts](src/links/_shared/entity-hover.ts) |
| `MARKER_META` / `MarkerType` + `MIME_*` card constants | [src/lib/marginalia.ts](src/lib/marginalia.ts) |
| Drop-spec registry | [src/components/drop-mode/registry.ts](src/components/drop-mode/registry.ts) |

**17 declared kinds** (`src/panels/_shared/types.ts:32-49`): `note`, `highlight`, `footnote`, `citation`, `comment`, `suggestion`, `cutter-comment`, `cutter-suggestion`, `revision-suggestion`, `report`, `report-request`, `example`, `todo`, `archive`, `bib`, `ai`, `error`. **`quotation` is gone** (panel deleted; zero `src/` refs). After cleanup → **16 real** (drop bare `suggestion` — an on-disk data discriminator, not a registry kind; rename `comment`→`revision-comment`). **13 anchored**; `bib`/`ai`/`error` system; **15 poppable** (`error` is not — dead capability, A0 §3.5).

**4 polymorphic panels** (registry `card: null`, via `POLYMORPHIC_CARD_PANEL`): Notes (`note`+`highlight`), Revisions (`comment`+`revision-suggestion`), Cutter (`cutter-comment`+`cutter-suggestion`), **Reports** (`report`+`report-request`).

**Surfaces a card appears on:** docked side panel · omni-view · **popped-out float** · marginalia gutter (nav only) · stack (thumbnail) · print · reader/library (read-only).

**Known naming/keying warts (dispositions ratified — see Decisions):** `suggestion` is one concept under **five names** → kind-in-key + `comment`→`revision-comment`, drop bare `suggestion`; `cut` theme/marker vs `cutter-*` kinds; the `quote`/`quotation` mismatch is **resolved by deletion**; the dual example key (`example:` vs `textobject:exampleBlock:`) left for A1; polymorphic special-casing → inverted to registry-derived (`cardKindsForPanel`).

**Lifecycle coverage gaps (corrected):** the 8 with clone/delete/bindAnchor are `footnote`, `citation`, `note`, `highlight`, `comment`, `suggestion`, `cutter-comment`, `cutter-suggestion`; the **real gaps are `todo`, `archive`, `example`, `report`, `report-request`** (the cheat-sheet missed `report`/`report-request` and wrongly listed the deleted `quotation`). Ratified: **declared intentional in the registry now; fills deferred to A3.**

**Float-presence current reality (recon; the `AF`-audit verifies):** `FloatingPanel` ([src/components/FloatingPanel.tsx](src/components/FloatingPanel.tsx)) is the low-level window, already shared. `FloatCard` ([src/components/FloatingCards.tsx](src/components/FloatingCards.tsx)) wraps it; `TextObjectFloat` ([src/text-objects/TextObjectFloat.tsx](src/text-objects/TextObjectFloat.tsx)) appears to wrap `FloatCard` (so `FloatCard` is **misnamed** — it already hosts text-objects). Popped state via `usePoppedCards`/`prefs.poppedOutCards` keyed by string. Stack-drop dispatch shared ([src/lib/stack/](src/lib/stack/)); snapshot per-kind. So the shared substrate **already exists implicitly** — the work is largely formalizing, renaming, unifying chrome + key grammar.

**Keystroke-sanctity constraint (non-negotiable):** card-source derivation gates on [`useStructuralRevisions`](src/hooks/useStructuralRevisions.ts) counters + the reactive `editor` — never an `update`-counter. Verify `window.__virgilBusStats()` (emitCount flat on plain typing). Any refactor must preserve this. See [AGENTS.md](AGENTS.md).

---

## The spirit (re-stated for every session)

- **Two kinds, one presence.** `TextObject` and `Card` stay ontologically distinct — composition, **not** a shared base class. The only shared layer is the `Floatable` popped-out presence (window / chrome / stack-drop / float-policy). **Touch the text-object side only at that window layer.**
- **One registry, one descriptor** for the card spine — mirror `TEXT_OBJECT_REGISTRY`.
- **One canonical predicate** for "is this an anchored card?" (registry-derived, replacing `ANCHORED_CARD_KINDS` + the polymorphic-panel branches).
- **Coherent across surfaces** — same card looks/behaves consistently docked → omni → float → print → reader.
- **Keystroke sanctity is sacred.** Verify every time.
- **Audit before you build.** Audits land in per-arena files; the management session consolidates into this doc.

---

## 1. Spirit & Ambition

Collapse the card spine into a single card SSOT (`CARD_REGISTRY`); rationalize naming/keying drift; make every card coherent across its surfaces; even out uneven capabilities (lifecycle, anchoring); garden the dead drag-drop code. **And** formalize the implicitly-shared float machinery into one named `Floatable` presence subsystem that both kinds consume — without merging the two kinds — so popped windows behave identically and global float policy is enforced in one place. The TextObject refactor is the proof this pattern works.

## 2. The Two-Layer Ontology — Kinds vs. Presence

The crux of getting this right. Two layers, kept strictly separate:

**Layer 1 — Kind (distinct; never merged).**
- `TextObject` — a graspable piece of the *document* (paragraph, heading, list, atom block, linkedRange…). Lives in the ProseMirror doc; persists via `.tex` + source markers; `TEXT_OBJECT_REGISTRY`.
- `Card` — *apparatus* (note, footnote, citation, todo…). Lives in sidecar JSON; anchors **to** a text-object (or is paper-wide); will have `CARD_REGISTRY`.
- Different identity, lifecycle, persistence, creation, in-context selection, anchoring. **No shared base type.**

**Layer 2 — Presence (shared by composition).** "Being popped out into a window" is a **role** both kinds play, not a thing they both *are*. A Card *has* a floating presence; a TextObject *has* a floating presence. The float subsystem hosts anything satisfying the `Floatable` contract and is blind to which kind it holds. This is exactly what lets us *access and constrain the common abstraction even as each kind specializes* — the shared thing is a thin behavioral contract, not a shared identity.

## 3. The `Floatable` Presence Abstraction

The shared substrate (designed in detail by the **`AF`-audit** chip).

**What it owns (shared):** the window shell (today's `FloatingPanel`) + **one** chrome (header: drag · title · jump-to-source · redock/popout · close); move / resize / spawn position; **uniform float policy** — viewport clamping, the fit-on-screen size cap (cf. LIFTED-OVERLAY Issue-13), z-index/MRU, Cmd-W focus stack; drop-onto-stack (detection + dispatch); re-dock + dock-outline; popped-state persistence. *(Float policy in one place is the payoff of "constrain": invariants stop drifting per-kind.)*

**The contract (sketch — `AF` finalizes):**
```ts
interface Floatable {
  key: string;                 // unified popout key — float:<domain>:<kind>:<id>
  title: string;               // header label
  renderBody(): ReactNode;     // the specialized content
  jumpToSource(): void;        // reveal where it actually lives
  snapshotForStack(): StackSnapshot; // domain serialization onto the stack
  defaultSize?: { w: number; h: number };
  spawnHint?: DOMRect;
}
```
Both `CARD_REGISTRY[kind].toFloatable(id)` and `TEXT_OBJECT_REGISTRY[kind].toFloatable(id)` yield a `Floatable`. The float subsystem operates only on this.

**Shared vs specialized:**

| Shared (the subsystem) | Specialized (behind the contract) |
|---|---|
| window shell + chrome skeleton | the body renderer |
| move / resize / spawn / size & viewport policy | what `jumpToSource()` does |
| z-index / MRU / Cmd-W focus | `snapshotForStack()` serialization |
| stack-drop dispatch, re-dock, dock-outline | **sync model**: text-objects edit the live doc (`float-sync`); cards edit sidecar data |
| popped-state persistence | the *birth* gesture; anchor/marginalia behavior |

**Ratified seams:**
1. **Birth gesture stays per-domain.** A paragraph is grabbed *in the doc* (lifted-overlay); a card is lifted *from its panel header*. The subsystem owns the resulting float + the commit-to-float handoff; each domain owns its origin gesture.
2. **Chrome budget:** fixed header skeleton + 1–2 domain slots (e.g. text-object "source-missing"/sync dot; card collab-claim pill / AI checkbox). Beyond that it stops being "the same chrome."
3. **One key grammar:** `float:<domain>:<kind>:<id>`, so the subsystem dispatches generically. Needs a one-time `prefs.poppedOutCards` migration from the old `<prefix>:<id>` / `textobject:<kind>:<id>` shapes.

**Module:** new top-level `src/floats/` (sibling to `text-objects/`, `links/`, and the new `cards/`). Rename `FloatCard` → domain-neutral (working name `FloatWindow`) — it already hosts text-objects, so the current name is wrong.

## 4. The Card Taxonomy

**Landed — authoritative per-kind matrix in `docs/card-refactor/A0-spine-audit.md` §2** (origin · anchored · poppable · stackable · lifecycle · drop · panel · keyPrefix · themeKey · markerType). Headline: 17 declared / 16 real kinds; 13 anchored; 3 system (`bib`/`ai`/`error`); 15 poppable; `CardKind`'s canonical home is `src/panels/_shared/types.ts:32` (moves into `src/cards/types.ts`).

## 5. Target Card Registry Shape (the new SSOT) — card-only

**Designed — see `A0-spine-audit.md` §4:** `CARD_REGISTRY: Record<CardKind, CardMeta>` at new top-level `src/cards/`, one descriptor driving `label`/`titleLabel`/`keyPrefix`/`themeKey`/`panel`/`origin`/`anchored`/`markerType`/`lifecycle`/`dropSpec`/`toFloatable(id, ctx): Floatable | null`. Six parallel kind-enums + the polymorphic-panel branches collapse to one union + derived predicates (`isAnchoredCardKind`, `panelForCardKind`, `cardKindsForPanel`, `resolveCardKind`). **Float handling is NOT defined here** — `toFloatable` plugs into §3's shared contract. Ratified dispositions in **Decisions**.

## 6. Current Fragmentation to Retire

**Landed — two tables:** card-spine fragmentation in `A0-spine-audit.md` §6 (`Surface | File(s) (file:line) | Disposition`); float-presence fragmentation in `AF-floatable-audit.md` §7 (duplicated chrome, two key grammars, the 15→14 inline float sites, per-kind float logic).

## 7. The Arenas

Two foundations (`A0`, `AF`), then the dependent arenas. Each becomes a read-only **audit chip** then **implementation chip(s)**. Your original five review zones map on as noted.

### A0 — Spine: card SSOT consolidation *(FOUNDATION · card-only · ✅ audit landed)*
- **Scope:** the ~14 sync points + 6 parallel enums → one `CARD_REGISTRY`; resolve naming/keying warts; define canonical predicates. **Float presence is out of scope here** — expose `toFloatable()` (§3), don't design it.
- **Also exposes** the per-panel polymorphic-morph set (`cardKindsForPanel`) that powers the new **morph chevron** (A9) and generalizes the existing revisions `convertCard`.
- **DoD:** adding a card kind = one registry entry (+ predicate/anchor membership). No edits to the other sync points.

### AF — `Floatable` presence abstraction *(FOUNDATION · the ONE sanctioned cross-domain arena, window layer only · ✅ audit landed)*
- **Scope:** formalize the implicitly-shared float machinery into `src/floats/` + the `Floatable` contract; unify chrome; unify the key grammar (+ lockstep `poppedOutCards`/`cardFloatPositions` migration); enforce one float policy. Both `Card` and `TextObject` produce `Floatable`. **Do NOT touch either ontology/registry or in-doc behavior; do NOT merge the kinds.**
- **Key files:** [FloatingPanel.tsx](src/components/FloatingPanel.tsx), [FloatingCards.tsx](src/components/FloatingCards.tsx), [TextObjectFloat.tsx](src/text-objects/TextObjectFloat.tsx), [usePoppedCards.ts](src/hooks/usePoppedCards.ts), [spawn-position.ts](src/components/editor-layout/spawn-position.ts), [stack/](src/components/stack/) + [src/lib/stack/](src/lib/stack/), [dock-drag.ts](src/components/editor-layout/dock-drag.ts).
- **Covers your zones 2 & 3 + Part D (stackability):** drop-onto-stack is the **shared** `Floatable.snapshotForStack()` — one mechanism for cards **and** text-objects (this answers Part D's "shared vs wire-twice": shared); AF caught that text-object floats don't stack today (bug, fixed by construction). Ratified: **raise-on-click** (z from MRU); **AF owns the popped header** (out of `PanelCard`, lands before A9). Absorbs the old A7.

### A1 — Gardening *(your zone 4)*
Dead/vestigial removal: grip-redesign disabled drags (TodoRow/QuotationGroupCard/ErrorCard); vestigial `DetachedActionsToolbar`/`Formatting`/`Menu`; unused `AttachedPopover`; unreachable `menuLocation:"free"`; legacy `comments.json`/`useComments`; `legacySpawn`; the dual example-block key. Mostly leaf-file deletions → can land early.

### A2 — Anchoring & link model
Mode A/B, `linkedAnchor`, three-surface hover, orphans, re-anchor-by-drag. Files: [src/links/](src/links/), [linked-anchor.ts](src/lib/tiptap/linked-anchor.ts), [anchored-card-store.ts](src/links/_shared/anchored-card-store.ts). Open: is `EntityKind` redundant with the registry's `anchored` flag?

### A3 — Creation & lifecycle
3 creation entry points → one pipeline; pristine-card auto-discard; clone/delete/bindAnchor coverage gaps. Files: [card-creation.ts](src/components/editor-layout/card-actions/card-creation.ts), [usePristineCardManager.ts](src/hooks/usePristineCardManager.ts), [card-lifecycle-registry.tsx](src/panels/card-lifecycle-registry.tsx).

### A4 — Selection, focus & keyboard *(part of your zone 1 · folds Gabriel's Part A/B)*
Sticky/transient model, multi-expand vs focus-halo, keyboard nav, a11y. Files: [anchored-card-store.ts](src/links/_shared/anchored-card-store.ts), [CardListPanel.tsx](src/panels/_shared/CardListPanel.tsx). **Folded in:**
- **Card-modes matrix (your A1) — DECIDE, gates the rest** (Decisions N1: proposal = selection ⟂ expansion, full 2×2).
- **Expand/collapse without selecting (your B1)** — the action fires directly, no select step.
- **Pop-out without selecting + pop-out from a *compressed* card (your B2)** — birth gesture decoupled from selection; coordinate with AF (the float result) per Seam 1.

### A5 — Surface: omni-view *(your zone 1 · folds Gabriel's B3)*
Card appearance/selection/filter/pin; cross-surface consistency with the docked panel. Files: [src/panels/Omni/](src/panels/Omni/), [omni-host.tsx](src/components/editor-layout/panels/omni-host.tsx). **Folded in — unanchored-card collision/reflow (your B3):** expanding unanchored notes must reflow / avoid collisions, not overwrite each other or a nearby anchored card (e.g. one on the title). Comes after expansion behavior (A4) settles.

### A6 — Surface: marginalia gutter
Markers, the deferred overflow design, click/drag/hover. Files: [Marginalia.tsx](src/components/Marginalia.tsx), [marginalia.ts](src/lib/marginalia.ts), [marginalia-grid.ts](src/lib/marginalia-grid.ts).

### A8 — Surface: print + reader/library
Per-kind rendering in print & the read-only reader. Files: [PrintAppendices.tsx](src/components/PrintAppendices.tsx), [print.ts](src/lib/print.ts), [chrome-config.ts](src/components/editor-layout/chrome-config.ts), [PaperRender.tsx](library/components/PaperRender.tsx).

### A9 — Internal appearance & typography *(your zone 5 · folds Gabriel's Part C + the morph chevron)*
Per-kind fonts/layout/typography, compressed-body, empty states. Files: per-panel `*Card.tsx` in [src/panels/](src/panels/), [panel-typography.ts](src/lib/panel-typography.ts), [panel-theme.ts](src/lib/panel-theme.ts), [STYLE_GUIDE.md](src/STYLE_GUIDE.md). **Folded in:**
- **Borrows-from-main-text display class (your C1):** examples, archives, **footnotes**, and any others the audit enumerates (likely cutter excerpts + revision-suggestion) must faithfully render links / atoms / text-objects / nested footnote phenomena (citation-in-footnote, math-in-footnote) — **display-only, nothing grabbable or actionable.**
- **Two typography classes (your C2):** main-text-derived notes → main-text font one step down on the panel size scale; everything else → standard sans. (Exact step: Decisions N2.)
- **Consistency pass (your C3):** enumerate the full card-type set; make all styling consistent against C1/C2.
- **Polymorphic morph chevron (your top-line ask):** a down-chevron beside the card-type label that switches a panel's morphs (note↔highlight, comment↔revision-suggestion, cutter-comment↔cutter-suggestion, report↔report-request), driven by A0's `cardKindsForPanel`; generalizes the existing revisions `convertCard` + `PanelCard.kindOptions`. Rendered in the unified header — docked here, popped via AF's `FloatChrome` title slot. Per-pair morph compatibility (note↔highlight is lossy) declared in `CARD_REGISTRY`.

### A10 — Cross-cutting integrations
AI requests (bridge; ephemeral cards), collab focus-claims, theming/color overrides (`aiRequest`/`error` hardcoded — inconsistency), persistence integrity. Files: [ai-request-bridge.ts](src/lib/ai-request-bridge.ts), [useCollab.ts](src/hooks/useCollab.ts), [panel-theme.ts](src/lib/panel-theme.ts), [usePersistentState.ts](src/hooks/usePersistentState.ts).

*(A7 absorbed into AF.)*

## 8. Cross-cutting constraints

- **Keystroke sanctity** — bake the `__virgilBusStats()` flat-on-typing check into every code chip.
- **Theming** — colors derive from one accent via `themeFromAccent`; semantic tokens only; resolve `aiRequest`/`error` hardcoding.
- **Persistence integrity** — `usePersistentState` debounced writes, stale-pipeline rejection, multi-window lock; migrate any key/schema change (incl. the §3 key-grammar migration); no silent data loss.

## 9. Gardening punch-list

grip-redesign disabled drags (TodoRow/QuotationGroupCard/ErrorCard) · vestigial detached toolbars + `AttachedPopover` + `menuLocation:"free"` · legacy `comments.json`/`useComments` · `legacySpawn` · dual example-block popout key.

---

## Decisions

### Settled (ratified session 3)
- **Polymorphic key + naming.** Kind-in-key for all 4 polymorphic panels (`float:<domain>:<kind>:<id>` carries the real kind); retire the shared `revision` prefix special-case; `comment`→`revision-comment`; drop bare `suggestion` (only an on-disk data discriminator). One rule for revisions/cutter/reports/notes — resolves the "five names" wart and the cutter/revision asymmetry. *(Reconciles A0's shared-prefix lean with AF's kind-in-key grammar toward the deeper, uniform fix.)*
- **`error` not poppable.** `CARD_REGISTRY.error.toFloatable` returns `null`; A1 deletes the dead popout wiring (ErrorCard's `<FloatCard>` early-return that never had a dispatch case). `ai` stays poppable.
- **Raise-on-click.** Float z-index derives from the MRU stack so clicking a buried float raises it (today z is insertion-order).
- **Per-domain `surface` kept** (cards = beige "panel", text-objects = white "card") as a legible, centrally-controlled `Floatable.surface` field — the header chrome is unified regardless.
- **Lifecycle gaps declared intentional now** (`todo`/`archive`/`example`/`report`/`report-request`); actual clone/delete fills deferred to **A3**.
- **Card registry at top-level `src/cards/`** (sibling to `text-objects/`/`links/`/`floats/`), absorbing the existing `src/lib/cards/`.
- **AF owns the popped header** (moved out of `PanelCard` into `FloatChrome`); A0/A9 keep the docked header; **AF-impl ordered before A9**.
- **Dual example key left intact** → A1 (gardening) decides any collapse.
- **AF consumes-not-relocates** `FloatingPanel`/dock/MRU (they also serve panels + dialogs).
- **Stackability = one shared mechanism** via `Floatable.snapshotForStack()` (answers Part D); fixes the text-object-floats-don't-stack bug by construction.
- **`cardFloatPositions` migrates in lockstep** with `poppedOutCards` (AF caught the prior D10 migration only did the latter → no saved-position loss).

### Ratified (was Open — settled session 3)
- **N1 — Card-modes matrix:** **selection ⟂ expansion (full 2×2).** *Expansion* = how much content shows (compressed ↔ full body), a display property. *Selection* = the focus/link relationship — three-surface highlight (text + margin + card), scroll-on-select, keyboard target, multi-select operand. Post-B1/B2, **selection no longer gates expand or pop-out**, and selecting does **not** auto-expand. Gates A4/B1/B2/B3.
- **N2 — Typography:** borrowed-content notes → main-text font **one step down on the panel-typography size scale** ([panel-typography.ts](src/lib/panel-typography.ts)); everything else → standard sans. The C-pass chip pins the exact px.

### Ratified (session 5 — AF re-pin)
- **Float addressing (Q1):** unify everything on the `float:<domain>:<kind>:<id>` grammar (phased: additive dual-read → flip keys → remove legacy), upgrading drop/stack/focus dispatch too — no translator shim, no parallel grammars.
- **Mandatory AF build guardrails** (from the verify workflow, no decision needed): dual-map lockstep prefs migration **+ tests**; colon-safe `parseFloatKey` with `revision:s:`→`revision-suggestion` normalization (overrides AF audit §4.2); doc-aware `example:`/`list:` passthrough on the read-time leg; write `Floatable.key` back to prefs; wire `snapshotForStack` before deleting the legacy stack path; preserve the `atom-grab`/`stack-pull`/`textobject:linkedRange` carve-outs.

### Ratified (session 11 — Wave-2 audits + seam sweep)
- **Lifecycle framing corrected (was "A3 fills the 5 gaps").** A3's audit ruled **4 of 5 are *permanent* gaps**, not fills: `todo`/`archive`/`example`/`report`/`report-request` are Mode-A / `origin:"derived"` kinds the clone/delete cascade walker (Mode-B + inline-atom only) cannot reach; a card-level clone/delete on `example` would double-act its `exampleBlock` TextObject (violates two-kinds). Only **`archive` delete-cascade** is a live decision (R18, defaulting NO). So A3 mostly *ratifies + documents* — annotating these permanent in the registry — it does not "fill" them. *(Supersedes §7 A3 + §5 "A3 fills" framing.)*
- **Borrowed-from-main-text set corrected (A9 C1, supersedes the session-3 "Resolved by audit" guess below).** The display-only "borrows main text" set is **footnote, archive, example (+ highlight excerpt)** — **NOT** cutter excerpts or revision-suggestion (A9 verified those render flat strings, not main-text nodes). **A8's print-fidelity DoD adopts this corrected set** (GAP-6).
- **New AF-follow thread gated before A1 (GAP-8).** Every `Floatable.snapshotForStack()` still returns `null`, so the legacy stack path (`cardKeyPrefixToStackKind`/`resolveCardData`) remains the only working stack-drop serialization. A Wave-3 **`AF-follow`** chip must land real `snapshotForStack` (+ optionally `bib`/`ai` full `FloatChrome`) **before A1 deletes the legacy stack path.**
- **`popCardAtAnchor` owned by A3, not A1** (seam sweep C-1): the 33-ref re-type to `CardKind` + `cardPopKey` routing is a creation-pipeline concern, not a leaf deletion; A1 cedes it.
- **Full ratification set lives in the seam sweep.** R1–R34 (each with the sweep's recommendation) in `docs/card-refactor/WAVE2-seam-sweep.md §6`; the management session ratifies them just-in-time per Wave-3 chip, gating-subset-first.
- **Gating subset ratified by Gabriel (session 11):**
  - **R1 — body-click default = `select + expand`.** Clicking a card body both selects (3-surface highlight + scroll) and expands; the new one-click expand-chevron + popout button are the axis-pure overrides, and `selected-but-collapsed` is reachable via the chevron. *(A4 keystone.)*
  - **R5 / GAP-4 — non-anchored kinds get a panel-local expansion axis.** `bib`/`ai`/`error` gain a small panel-local `expanded` set so they expand/collapse uniformly with anchored cards; A4 owns it. *(Closes the undefined-behavior gap.)*
  - **R30 — KILL the detached actions/formatting toolbars** *(Gabriel overrode the sweep's "keep").* A1 does the **full feature removal** of `DetachedActionsToolbar`/`Formatting`/`Menu` + the dead `menuLocation:"free"` pref + unused `AttachedPopover` — a user-visible removal, not just dead-code gardening, so the A1 chip verifies nothing reachable breaks. **§9 punch-list stands as written (remove), not corrected.**

### Resolved by audit (no decision)
- **Borrowed-content full list (your C1/C3).** ⚠️ **Superseded by the A9 audit (session 11) — see above.** ~~beyond examples/archives/footnotes, candidates are **cutter cards** and **revision-suggestion**~~ — A9 verified cutter/revision-suggestion render flat strings, so the borrowed set is **footnote, archive, example (+ highlight excerpt)** only.

---

## Chip Ledger

The management control surface. **Audit chips write to `docs/card-refactor/<ID>-audit.md` and return a summary; the management session consolidates into this doc and flips the rows below.** Implementation chips (Wave 3) appended once their audit lands.

| Chip ID | Arena | Wave | Type | Status | Audit file / worktree | Depends on |
|---|---|---|---|---|---|---|
| **A0-audit** | Card spine / SSOT *(card-only)* | 1 | audit | ✅ **landed** | `docs/card-refactor/A0-spine-audit.md` | — |
| **AF-audit** | `Floatable` presence *(cross-domain, window layer)* | 1 | audit | ✅ **landed** | `docs/card-refactor/AF-floatable-audit.md` | — |
| A0-impl | Card spine consolidation | 3 | impl | ✅ **landed** | `chip-A0-card-spine` | foundations ratified ✓ |
| AF-impl | `Floatable` subsystem *(`src/floats/`)* | 3 | impl | ✅ **landed + merged** (`e279864`) | `main` | A0 ✓ · Q1 unify-phased ✓ |
| AF-fix | Unify ALL DOM-key seams via one shared helper (`cardDomSelector` + `cardPopKey` SSOT) + `remapCardPopKey` morph remap + contract tests; class swept to zero | 3 | impl | ✅ **landed + merged** (`e279864`) | `main` | AF review NO-GO |
| A1-audit | Gardening | 2 | audit | ✅ **landed** | `docs/card-refactor/A1-audit.md` | A0 |
| A2-audit | Anchoring & link model | 2 | audit | ✅ **landed** | `docs/card-refactor/A2-audit.md` | A0 |
| A3-audit | Creation & lifecycle | 2 | audit | ✅ **landed** | `docs/card-refactor/A3-audit.md` | A0 |
| A4-audit | Selection/focus/keyboard | 2 | audit | ✅ **landed** | `docs/card-refactor/A4-audit.md` | A0 |
| A5-audit | Omni-view | 2 | audit | ✅ **landed** | `docs/card-refactor/A5-audit.md` | A0 |
| A6-audit | Marginalia gutter | 2 | audit | ✅ **landed** | `docs/card-refactor/A6-audit.md` | A0 |
| A8-audit | Print + reader/library | 2 | audit | ✅ **landed** | `docs/card-refactor/A8-audit.md` | A0 / AF |
| A9-audit | Appearance & typography | 2 | audit | ✅ **landed** | `docs/card-refactor/A9-audit.md` | A0 |
| A10-audit | Cross-cutting integrations | 2 | audit | ✅ **landed** | `docs/card-refactor/A10-audit.md` | A0 |
| **WAVE2-seam-sweep** | Cross-arena reconciliation (seams · contention map · conflicts · gaps · impl sequencing · R1–R34) | 2 | synthesis | ✅ **landed** | `docs/card-refactor/WAVE2-seam-sweep.md` | A1–A10 audits |
| AF-follow | Real `Floatable.snapshotForStack()` (+ optional `bib`/`ai` full `FloatChrome`) — **GATES A1's legacy-stack-path deletion** (GAP-8) | 3 | impl | planned | — | AF |
| A1-impl | Gardening (minus `popCardAtAnchor`→A3, minus stack-path→AF-follow) | 3 | impl | planned (BATCH 0) | — | A0 · AF |
| A2-impl | Anchoring: **B-1 `EntityKind` fold ✅ landed** (`6697ad6`) · rest (`resolveCardKind`, retire `EntityCollections`, token tables) → BATCH 2 | 3 | impl | 🔄 B-1 landed | `main` | A0 · A1-reloc · A10-D1 |
| A8-impl | Print/reader: registry-derived printable set, dead print CSS, `reports` printable | 3 | impl | planned (BATCH 0) | — | A0 |
| A4-impl | **Keystone** — selection ⟂ expansion split, one-click expand + popout, marker-select | 3 | impl | planned (BATCH 1) | — | A0 · AF · A2-B1 |
| A3-impl | Creation pipeline + lifecycle ratification; owns `popCardAtAnchor` | 3 | impl | planned (BATCH 2) | — | A4 |
| A9-impl | Borrowed-display + two-class typography + morph chevron | 3 | impl | planned (BATCH 2) | — | A4 · A10-D1 |
| A5-impl | Single-cascade omni reflow + unanchored band | 3 | impl | planned (BATCH 3) | — | A4 · A9 · A2 |
| A6-impl | Marginalia pipeline collapse + registry-derived markers | 3 | impl | planned (BATCH 3) | — | A10-D1 · A2-B1 |
| A10-impl | **D-1 accent SSOT ✅ landed** (`77c7c5c`) · collab/AI-routing rest → BATCH 3 | 3 | impl | 🔄 D-1 landed | `main` | A9 (D-2) |

**Wave gates:** the two **Wave-1 foundations** (`A0`, `AF`) are read-only and non-conflicting (different code areas, separate audit files) — launch in either order or together. Wave-2 audits spawn after the foundations land & their designs are ratified. Wave-3 impl: `A0-impl` + `AF-impl` land first (foundations), then dependent arenas rebase, sequenced to limit conflicts on `panel-registry.ts` / `panel-primitives.tsx` / `marginalia.ts`. A1 (gardening) may land early.

## Coordination protocol

This doc is the refactor's SSOT, **owned by the management session.** Audit chips are read-only on code, write only their own `docs/card-refactor/<ID>-audit.md`, and return a concise summary. The management session reads those files, consolidates findings into §3–§6, flips the ledger rows, and gates the next wave. (Implementation chips, Wave 3, edit code + update their arena section + ledger row + Progress, serialized per the wave gates.)

## Working Pattern for chips

1. Read this doc end-to-end + [AGENTS.md](AGENTS.md) + the relevant `docs/agents/*` sub-doc.
2. **Audit chips:** read-only on all source; write only `docs/card-refactor/<ID>-audit.md`; return a summary. **Do not edit this doc.** **Implementation chips:** run `/plan`, get sign-off, then code.
3. **Keystroke sanctity:** card-source memos stay event-driven on `useStructuralRevisions`; verify `window.__virgilBusStats().emitCount` flat on plain typing.
4. **Two kinds, one presence:** never merge `TextObject` and `Card`; touch the text-object side only at the `Floatable` window layer (and only in `AF`).
5. **Verify (impl)** in the dev preview against `virgil-data/doc_devtest` (reload from `samples/annotation-history/` if choppy); walk the card kind across every surface it touches.
6. **Re-pin on start.** The tree moves under the refactor — re-verify every `file:line` against current HEAD before relying on it or editing. AF-impl gets an explicit re-pin pass (its inline float sites 15→14 after Quotations' deletion; `quotation:` prefix mooted).

## Definition of Done (whole refactor)

1. **Single card registry.** Adding a card kind = one `CARD_REGISTRY` entry (+ predicate/anchor membership). No edits to the other ~10 sync points.
2. **Single `Floatable` presence subsystem.** One window/chrome/stack-drop/float-policy implementation in `src/floats/`; both `Card` and `TextObject` satisfy `Floatable`; `FloatCard` renamed domain-neutral; **the two kinds remain ontologically distinct (no shared base type).**
3. **Naming/keying drift resolved** — no `suggestion`/`revision-suggestion` ambiguity, no theme-key/kind mismatches, **one** popout-key grammar, polymorphic panels registry-driven not per-consumer.
4. **Lifecycle coverage rationalized** — every kind's clone/delete/bindAnchor is intentional and registry-declared.
5. **Cross-surface coherence** — each kind verified consistent across docked / omni / float / marginalia / print / reader; **all floats obey one policy** (sizing, viewport, z-index, focus).
6. **Gardening complete** — §9 punch-list gone.
7. **Keystroke sanctity intact** — `__virgilBusStats()` flat on plain typing across all card-bearing panels.
8. **No silent data loss** — prefs/sidecar + popout-key migrations clean.
9. **Dev preview verified** — walk every card kind through creation, selection, anchoring, pop-out, drop-to-stack, clone, delete; pop out a text-object and a card and confirm identical window behavior.

---

*This is a working planning document for a single refactor. Archive or delete it once the refactor lands.*
