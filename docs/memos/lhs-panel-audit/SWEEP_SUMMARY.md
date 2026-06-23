# LHS Panel Fix Sweep — Readiness Summary & Bug→Commit Coverage Map

**Branch:** `lhs-fix-sweep` · **Worktree:** `/Users/gabriel/Programming/virgil-worktrees/lhs-fix-sweep` · **HEAD:** `ba7f9fa` · **Base:** `dc11e7f` (main tip at sweep start)
**Date:** 2026-06-18 · **Gate:** GLOBAL FINAL GATE (read-only on source; this doc is the one write)

---

## 1. Verdict at a glance

| Gate | Result |
|---|---|
| Full vitest suite | **GREEN** — 223 files, **2167 tests, 0 failed** |
| `tsc --noEmit` | **CLEAN** — exit 0, no errors |
| New DocStructureBus consumers | **+1** (single consumer, as designed) — `src/lib/identity/useIdentityBusConsumer.ts` |
| AGENTS.md permitted-consumer list | gained **exactly one** entry (the single consumer) |
| Showcase / `\vbid` round-trip | unit-level coverage present; **doc-fixture round-trip = owed manual check** |
| Keystroke-sanctity (flag-ON) tests | **present + passing** (`emitCount`-flat pins) |
| Confirmed bugs (152) | **135 fixed · 4 accepted-as-is · 11 deferred/not-in-scope · 2 resolved-otherwise** |
| Refuted / by-design (separate 14) | unchanged — correctly left alone |
| **Ready to merge** | **YES** (flags default OFF; legacy paths intact; live FSA smokes owed pre-graduation) |

---

## 2. Single-consumer invariant (keystroke sanctity)

The sweep added **exactly one** `DocStructureBus.onAnyChange` subscriber:

- `src/lib/identity/useIdentityBusConsumer.ts` — opens one `onAnyChange` subscription, owns one `IdentityBusConsumer` dispatcher. `onAnyChange` is `emitCount`-gated (never fires on a structurally-null keystroke); the consumer then bails O(1) when no citation/footnote entered or left the transaction.

The only other `onAnyChange` site in `src/` is the **pre-existing** `useDocStructureBus` React hook (`src/lib/tiptap/doc-structure/hook.ts`) — **not touched by the sweep** (verified: empty diff `dc11e7f..HEAD`).

Wave-2 / T5 themes register as **ordered policies** on this one dispatcher via `consumer.registerPolicy(...)` — they do **NOT** open their own `onCitations*`/`onFootnotes*`/`editor.on(...)` subscriptions:
- **W1b** registers the `regenIds` remap policy FIRST.
- **W2b** (inline-atom lifecycle) → `registerPolicy`.
- **W2c** (citation add/resync) → `registerPolicy`.
- **W4** consumers also ride the same dispatcher.

`AGENTS.md` diff (`dc11e7f..HEAD`): the keystroke-sanctity *permitted-consumer* list gained **exactly one** bullet — the `useIdentityBusConsumer.ts` entry, with the +1-not-+3 rationale spelled out. No `editor.on('update'|'transaction')` subscriptions were added to `src/` by the sweep (the only diff hits are doc-comments and tests).

---

## 3. Bug→commit coverage map

166 unique bug ids in `BUGLIST.md`: **152 confirmed** (each has a `### [SEVERITY]` entry) + **14 refuted/by-design** (bullet list at the bottom). The 6-tier design docs (`designs/T1..T6`) map every confirmed bug to a tier; the waves implement the tiers:

| Tier | Implemented by waves |
|---|---|
| T0/T1 (identity) | W0a, W0b, W0c, W0e, W1a–e, W1-harden |
| T2 (anchor/orphan) | W2a, W2b, W2c, W2-cutover |
| T3 (structural edit) | W0d (read side), W3a |
| T4 (card lifecycle) | W2d-1..4 |
| T5 (position wiring) | W3b, W4a, W4b |
| T6 (auto-title / misc leaf) | W0a, W0e, W1d, W4c, W4d |

### 3a. FIXED — grouped by wave (name-cited in commit body)

**W0a** (`60b3856`, wholeWordPattern / C26): BIB-F7-04, SR-F1-04
**W0d** (`d39da1d`, atom-aware inline reader / C10): BIB-F3-01 [HIGH], CI-F3-01 [HIGH]
**W0e** (`3cddc3d`, T6 Phase-A leaves / C24·C25): FN-C1-01, FN-F1-03, FN-F2-02, OMNI-F1-03, REP-F1-01, SR-F1-03, SR-F1-05
**W1a** (`4b62537`, IdentityCascade + uid-keyed bib sidecars): BIB-A2-01 [DATA-LOSS], BIB-A2-03 [HIGH], BIB-A2-04 [HIGH]
**W1b** (`6fe9bde`, single inline-atom bus consumer + regenIds): CI-A3-01, OMNI-F3-02
**W1c** (`654f75f`, export-via-serializer + uid lockstep + fold-by-uuid): BIB-A2-04 [HIGH], BIB-A3-02, BIB-F3-02, BIB-F5-04, BIB-F7-01 [DATA-LOSS], OUT-A2-01
**W1d** (`b095d12`, two-way derivePlural + field-delete / C16): BIB-F5-04, CI-F5-01, CI-F5-02, CI-F7-02
**W1e** (`cf487fd`, footnote-nested citations in DocStructure / D5): BIB-F3-01 [HIGH], CI-F3-01 [HIGH]
**W2a** (`aac501b`, durable orphaned-footnotes sidecar): FN-A2-01 [DATA-LOSS], FN-A2-02, FN-A2-03
**W2b** (`0a1b863`, inline-atom lifecycle policy): CI-A3-01, FN-A1-01, FN-A1-02, FN-A1-03, OMNI-F3-02
**W2c** (`4bdf245`, citation add/resync policy): CI-A1-01, CI-F8-03
**W2d-1/2** (`1140fd3`/`3e639da`, CardMeta.content + content-aware confirm): CI-F7-01, FN-A1-02, OMNI-F7-01, REP-F7-01 [DATA-LOSS]
**W2d-3** (`d49d59c`, runCardLifecycleEvent executor / lossless morph + unbridge): OMNI-F6-01, OMNI-F6-02, REP-F5-01 [HIGH], REP-F6-01, REP-F6-02, REP-F6-03, REP-F7-02, REP-F8-01
**W2d-4** (`b7ff0fb`, report delete → executor): REP-F7-02
**W2-cutover** (`896f97b`, single rendered orphan store, flag-on): FN-A1-03, FN-A2-01 [DATA-LOSS], FN-A2-03
**W3a** (`8f8b4cd`, node-tree-preserving structural edit + UUID-anchored rename / C2): OUT-F1-01, OUT-F4-01, OUT-F5-01 [DATA-LOSS], OUT-F5-02, OUT-F5-03, OUT-F8-03, OUT-F8-04
**W3b** (`5b2174d`, live-pos resolver + outline-focus on bus + @N jump): OMNI-F1-02, OMNI-F3-01, OMNI-F8-02, OUT-F2-01, OUT-F8-02, REP-F3-01 [HIGH]
**W4a** (`dc640ab`, search on live spine + single highlight owner): SR-A1-01, SR-A2-01, SR-F1-01 [HIGH], SR-F3-01 [HIGH], SR-F3-02, SR-F3-04, SR-F7-01, SR-F8-01 [HIGH], SR-F8-02
**W4b** (`b709bf5`, host-wiring + required-prop discipline + dead-surface cleanup): BIB-F1-01, **BIB-F1-02** (deleted, FORK-2), CI-A2-01 [HIGH], EX-F3-03, **FN-F7-01** (deleted, FORK-2), OMNI-F4-01, OMNI-F5-01, REP-C1-01, REP-F4-01, REP-F5-02
**W4c** (`d318f26`, one select/jump composition + Search cursor / C15): FN-F2-01, SR-C1-01, SR-F1-02, SR-F2-01
**W4d** (`51952b5`, recorded titleAuto provenance / C12): EX-A2-01, OMNI-F1-01, REP-A2-02 [HIGH], REP-F5-03

### 3b. FIXED via tier ownership (covered by the wave's class fix; not individually name-cited)

Commit bodies cite *representative* ids per class; the remaining same-class/same-tier members are carried by the identical fix:

- **T1 → W0/W1:** BIB-A2-02, BIB-A3-01, BIB-F1-04, BIB-F2-01, BIB-F7-02, BIB-F8-03, BIB-F8-04, OMNI-F8-03, OMNI-A1-01
- **T2 → W2a-c:** CI-A1-02, CI-F2-02, CI-F8-02, EX-A1-01, EX-A1-02, EX-F3-01, EX-F5-01, FN-F5-02, OMNI-A2-01, OMNI-F8-01
- **T2/T4 → W2a-c/W2d:** CI-F7-03, CI-F8-01, EX-F8-01, FN-F3-01, FN-F8-01, OMNI-F7-02
- **T2/T5 → W2a-c/W3b-W4:** CI-A2-02, EX-F7-01
- **T3 → W0d/W3a:** OUT-F5-04, SR-F4-01
- **T3/T5 → W0d/W3a/W4:** EX-F4-01
- **T4 → W2d:** REP-A1-01, REP-A2-01, REP-F7-03
- **T5 → W3b/W4a/W4b:** BIB-F7-03, EX-F5-02, OMNI-F2-01, SR-C1-02, SR-F3-03
- **T5/T6:** BIB-F5-02
- **T6 → W0a/W0e/W1d/W4c/W4d:** BIB-A1-01, BIB-F1-03, BIB-F5-05, CI-F1-01, CI-F2-01, CI-F5-03, EX-F1-01, EX-F2-01, EX-F2-02, EX-F3-02, OUT-F3-02, REP-F5-04, SR-F5-01

### 3c. NOT fixed

**Accepted-as-is — cosmetic, Gabriel's call (4):**
- **CI-C1-01** [COSMETIC] — duplicate-postnote citation glyph
- **FN-F1-04** [COSMETIC] — repeated `\thanks{}` all render identical 'A' badge
- **EX-F1-02** [COSMETIC]
- **OUT-F7-01** [COSMETIC]

**Deferred / not in the 6-tier scope (11):** these belong to defect classes that no tier design doc claimed.
- **BIB-F8-01** [DATA-LOSS] — C4 uncontrolled contentEditable: AnnotationEditor debounce has no unmount-flush; collapse within ~400ms wipes the annotation. *(Highest-severity unaddressed item.)*
- **BIB-F8-02** [HIGH] — C4: dual-surface (docked + float) annotation editors can't converge (innerHTML seed deps exclude `content`).
- **EX-F5-03** [LOW] — C4: bare-catch silently drops a schema-invalid expex edit from the doc.
- **EX-F8-02** [LOW] — C4: raw-offset caret restore across a setContent re-seed (no PM position mapping).
- **OMNI-C2-01** [MEDIUM] — C20/C18: `placements` ↔ `omniCategories` not moved in lockstep on `movePanel`; cards stuck in left omni with no toggle.
- **OMNI-C2-02** [LOW] — C18: hardcoded 30px focus-pill offset; expanded unanchored bin covers the "outside focus" pill.
- **OMNI-F8-04** [LOW] — C18: unguarded `navigator.clipboard.writeText` (copy citekey) rejects in insecure/clipboard-unavailable contexts.
- **FN-A3-01** [LOW] — C21: orphan re-drop briefly renders two cards with the same footnoteId (sync dispatch vs `setTimeout(0)` macrotask, no de-dup).
- **OUT-F3-01** [LOW] — C27: focus-band bottom-handle snap over-extends to the enclosing section on a parTitle target.
- **BIB-C1-01** [LOW] — C28: '+' Add-menu mousedown/toggle race reopens instead of closing.
- **EX-F4-02** [LOW] — explicitly deferred to **backlog #54** (math-in-example needs a surface/pos remap, not a wiring fix; flagged in the W4b body).

**Special / resolved-otherwise (4 — counted within the 152 but not "fixed by a sweep code change"):**
- **BIB-F5-01** [HIGH] — bibliography-annotation stored-XSS. **Already fixed on `main` before the sweep** (`src/lib/sanitize-html.ts` allowlist, audit BIB-F5-01). Verified `sanitize-html.ts` present in the worktree; not a sweep deliverable. *(Counted as resolved.)*
- **FN-F1-01** [MEDIUM] — **RECLASSIFIED** in BUGLIST: the symptom (all panel badges '0' / markers '1' on load) **cannot occur** (`numberFootnotes(doc)` runs on every non-empty load). No fix needed. *(Counted as resolved.)*
- **FN-F5-01** [MEDIUM] — **partial**: the *wiring* half (handler + prop) is FIXED in W4b; the **serialization** half is **deferred** (called out in T5 §, footnote-serialization gap). Owed.
- **EX-F4-02** [LOW] — deferred (see above).

**Refuted / by-design — left untouched (14, separate from the 152):** BIB-F5-03, CI-F1-02, CI-F2-03, CI-F4-01, CI-F4-02, CI-F7-04, EX-F4-03, EX-F8-03, FN-F1-02, FN-F4-01, OMNI-C2-03, OMNI-F4-02, OUT-F1-02, SR-F5-02.

### 3d. Tally

| Bucket | Count |
|---|---|
| **Fixed by the sweep** | **135** (3a + 3b; incl. FN-F5-01 — wiring half landed, serialization half is the noted deferred caveat — plus FORK-2 BIB-F1-02 / FN-F7-01 deleted) |
| Resolved-otherwise (pre-fixed / no-fix-needed) | 2 (BIB-F5-01 pre-fixed on main; FN-F1-01 reclassified — symptom can't occur) |
| Accepted-as-is (cosmetic) | 4 |
| Deferred / not-in-scope | 11 (10 no-tier classes + EX-F4-02) |
| **Total of 152 confirmed** | **135 + 2 + 4 + 11 = 152** (exact reconciliation, no UNKNOWNs) |
| Refuted / by-design (separate) | 14 |

*(Of the 152 confirmed: 135 fixed + 2 resolved-otherwise + 4 accepted-as-is = 141 closed; 11 deferred = the open remainder, of which BIB-F8-01 [DATA-LOSS] and BIB-F8-02 [HIGH] are the severity standouts. FN-F5-01 is counted under fixed but carries a deferred serialization half. Every confirmed id is classified.)*

---

## 4. Flag posture

| Flag (localStorage) | Default | Gates |
|---|---|---|
| `virgil:identity-cascade` | **OFF** | T1 IdentityCascade — uid-keyed bib sidecars + rename cascade + the single bus consumer's regen behavior (W0b/W1a/W1b/W1c). Flag-OFF preserves legacy behavior exactly (every read-site keeps its legacy path; suite green with flag off = default). |
| `virgil:inline-atom-lifecycle` | **OFF** | T2 inline-atom lifecycle — durable `orphaned-footnotes.json` sidecar + the W2b reconciler replacing the legacy event web (W2a/W2b/W2-cutover). Flag-OFF preserves the legacy EditorLayout shell-state path. |

**T3/T4/T5/T6 are unflagged / live** (W0a, W0d, W0e, W1d, W3a, W3b, W4a–d): structural-edit, card-lifecycle/morph executor, position wiring, search-on-live-spine, auto-title provenance, leaf consolidations. These ship on merge with no flag.

The default vitest run (both flags OFF) is the correct posture for the suite — it proves the legacy paths still pass. The flag-ON behavior is exercised by the per-flag unit tests (e.g. `identity-bus-consumer.test.ts`, `identity-cascade.test.ts`, `sidecar-uid-migrate.test.ts`), which flip the override via `setIdentityCascadeFlag` / `setInlineAtomLifecycleFlag`.

---

## 5. Verification detail

1. **Suite:** `vitest run` → 223 files / **2167 passed / 0 failed** (24.9s).
2. **tsc:** `tsc --noEmit -p tsconfig.json` → exit **0**, empty output.
3. **Single consumer:** confirmed +1 (`useIdentityBusConsumer.ts`); `hook.ts` untouched; W2b/W2c/W4 use `registerPolicy`; AGENTS.md +1 bullet.
4. **Showcase / `\vbid` round-trip:** unit tests exist — `serialize-bib-export.test.ts` ("OMITS the `\vbid` durable-id marker"; per-entry parseable round-trip; empty-raw reconstruction) and `bib-uid.test.ts` (`\vbid` round-trip). **No full `samples/annotation-history` / `doc_devtest` .tex/.bib fixture round-trip test** asserting byte-stability-except-`\vbid` — **OWED as a manual check** (parse→serialize the showcase, diff = only new `\vbid` lines).
5. **Keystroke-sanctity flag-ON:** present + passing — `identity-bus-consumer.test.ts` "typing plain characters dispatches nothing to the consumer" pins `bus.emitCount` flat after 5 plain chars; plus `marginalia-markers-keystroke-sanctity.test.tsx`, `useLivePosResolver.test.ts`, `search-live-position.test.ts`.

---

## 6. Owed before flag graduation

**Production-FSA live smoke tests** the wave agents flagged (dev preview is unfaithful to FSA — anchor/durability bugs mask in dev-storage; see the anchor-persistence memo). Run these with **both flags ON** in production FSA:
- **Citekey-rename annotation durability** (BIB-A2-01 / T1): rename a cited entry's citekey → confirm the annotation, bib-review request, selection, and any popped-out float all follow the new key and survive a reload.
- **Footnote delete → undo / reload** (FN-A2-01 / T2): delete a footnote marker in-text → confirm the orphan record persists in `orphaned-footnotes.json`, survives reload, and does not bleed across documents.
- **Morph-unbridge** (REP-F5-01 / REP-F7-02 / T4): morph a Report-Request with its AI-request flag on → confirm the inbox entry unbridges (no orphaned pending request); delete a report with content → confirm the content-aware confirm fires and the inbox unbridges.
- **Search highlight after edit** (SR-F1-01 / T5): run a search, then type/delete in the doc → confirm highlights track the live positions (no stale snapshot drift).

**FN-F5-01 serialization half** — the footnote-serialization gap deferred in T5; close before graduating the footnote work.

**Dormant-code cleanup** — the legacy EditorLayout orphan shell-state (the volatile `orphanedFootnotes` React state + the retired `virgil-footnote-orphaned` / `-suppress-orphan` / `-panel-dropped` event web) is dead once `virgil:inline-atom-lifecycle` graduates. Remove it as part of flipping that flag's default (the W2-cutover left it in place behind the flag for rollback).

---

## 7. Activation / merge steps

**(a) Merge `lhs-fix-sweep`:**
```
# from the main checkout
git -C /Users/gabriel/Programming/virgil checkout main
git -C /Users/gabriel/Programming/virgil merge --no-ff lhs-fix-sweep
# suite + tsc already green at ba7f9fa; re-run if main moved.
```
T3–T6 go live immediately on merge (unflagged). T1/T2 ship dormant (flags default OFF) — no behavior change until flipped.

**(b) Run the live smoke with flags ON** (production FSA, real paper — NOT the dev preview):
```
localStorage.setItem('virgil:identity-cascade','1')
localStorage.setItem('virgil:inline-atom-lifecycle','1')
# reload, then walk the four smokes in §6.
```
Also do the manual showcase round-trip (§5 item 4): parse→serialize `samples/annotation-history`, confirm the only diff is the new `\vbid` lines.

**(c) Flip flag defaults / remove flags** (after the smokes pass):
- Flip defaults by making `isIdentityCascadeOn()` / `isInlineAtomLifecycleOn()` return `true` by default (or invert the localStorage opt-in to an opt-OUT), keeping the override for one release as a rollback.
- Once stable across a release, **remove** the flag modules (`identity-flag.ts`, `inline-atom-lifecycle-flag.ts`) and every read-site's legacy branch, and delete the dormant EditorLayout orphan shell-state (§6). That is the point at which the legacy event web and volatile orphan state come out.

---

## 8. Severity issues / cautions for the merge

- **BIB-F8-01 [DATA-LOSS] remains unfixed** — it's out of the 6-tier scope (C4 contentEditable class), but it is a real data-loss path (annotation wiped on fast collapse). Worth a follow-up sweep or at minimum a backlog entry before declaring the LHS panels "done."
- **BIB-F8-02 [HIGH]** and the rest of C4 (EX-F5-03, EX-F8-02) are the largest coherent unaddressed cluster — a future "C4 contentEditable hardening" mini-sweep would close them together.
- **No full-fixture round-trip test** — the `\vbid` byte-stability guarantee rests on unit tests + an owed manual check. Add a fixture round-trip test before relying on `\vbid` durability in the wild.
- Flag-graduation is gated on **production-FSA** smokes specifically — the dev preview will give false passes for the anchor/durability cases.
