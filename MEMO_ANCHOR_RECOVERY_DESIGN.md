# Unified anchor-recovery SSOT — implementation contract

**Owner:** card-system maintenance manager · **2026-06-17** · **Mode:** ultracode manager session
**Diagnosis:** [MEMO_CARD_DROP_MARGIN_FIX.md](MEMO_CARD_DROP_MARGIN_FIX.md) (RC1–RC4). **Gabriel's call:** go deepest — collapse the 3 recovery owners into 1 SSOT + retire the dual-mount second-WRITER seam; build for both note origins.
**Chosen architecture:** HYBRID on Proposal A1 (one pure `resolveCardAnchor()` SSOT every consumer calls), grafting A2's normalize-at-capture-and-compare data discipline + A1's uuid-strictly-before-snapshot ordering; **rejecting A3's bus reactor** (the bug is a *reload* bug — `buildInitial` emits nothing on load, so a structural-diff reactor does zero work at the exact moment the bug fires; it would add 2 subscribers + save-loop risk to fix what the load-priming pass already fixes).

> Resolver runs ONLY where O(doc) already runs today (load-once reconcile + the structurally-gated marginaliaMarkers memo). NO new `editor.on` / DocStructureBus subscriber. Keystroke sanctity is structural, not vigilance-based.

---

## THE SSOT — `src/links/resolve-card-anchor.ts` (NEW, pure, no React)
```ts
export type AnchorSource = 'uuid' | 'mark' | 'snapshot' | 'orphan';
export interface CardAnchorResolution {
  paragraphId: string | null; mode: 'A' | 'B' | null;
  source: AnchorSource; confidence: 'high' | 'low';
  liveAnchorId: string | null; // the Mode-B anchorId still backing the card, for mark re-apply
}
export interface ResolveIndex {
  uuidToParagraph: Set<string>;
  anchorIdToParagraph: Map<string, string>;     // anchorId -> live paragraph uuid
  snapshotToParagraph: (normalizedSnapshot: string) => string | null;
}
export function buildResolveIndex(editor): ResolveIndex;   // ONE O(doc) walk/pass: live uuids + linkedAnchor-mark->paragraph + normalized-textContent->uuid (first-match-wins, dup-detectable). Reuses collectLiveUuids.
export function resolveCardAnchor(card, editor, index): CardAnchorResolution;  // ladder below
export function normalizeParagraphText(s): string;         // trim + collapse internal ws + strip zero-width; SAME form at capture & index (CHIP-D)
export function reconcileCardToResolved<T>(card: T, res): { card: T; changed: boolean }; // lone pure mutator the load pass calls
```
**Priority ladder (uuid STRICTLY before snapshot):** (1) Mode-A `textObjectIds[0] ∈ uuidToParagraph` → `{mode:'A',source:'uuid',high}`; (2) Mode-B `textRange.anchorId` resolves via `anchorIdToParagraph` → `{mode:'B',source:'mark',liveAnchorId,high}`; (3) any link's `paragraphSnapshot`/`textRange.textSnapshot` normalized-hits `snapshotToParagraph` → `{source:'snapshot',low}`; (4) else `{paragraphId:null,source:'orphan',low}`.
`reconcileCardToResolved`: source==='snapshot' → rewrite `textObjectIds[0]` (or convert a snapshot-relocated Mode-B → clean Mode-A) to `res.paragraphId` + restamp snapshot; source==='uuid' → backfill a missing/stale snapshot; else no-op. **Idempotent** (2nd pass → changed:false; no save loop). Legacy `reconcileModeAAnchors`/`findParagraphIdBySnapshot`/`isModeAOrphaned` become thin shims over the resolver (kept exported for their tests) or deleted as tests migrate.

## Owner-retirement plan (RC4)
- **reconcile:** keep the `useReconcileModeAAnchors` SHELL verbatim (the `hasMutatedRef` data-loss fix: bail on `cards.length===0 ∥ liveUuids.size===0`, compute outside `update()`, call `update()` only on `anyChanged` — `useReconcileModeAAnchors.ts:60-95`). Swap inner call → `reconcileCardToResolved(c, resolveCardAnchor(c, editor, index))`, `index = buildResolveIndex(editor)` built ONCE/pass. The 6 per-panel calls (`EditorPane.tsx:1113-1118`) stay behind `modeAReconciledDocRef + allCardSidecarsLoaded` (load-bearing for the FSA reload bug — do NOT weaken).
- **modeBReapply:** RETIRE `EditorLayout.applyLinkedAnchors` recovery effect (`EditorLayout.tsx:3163-3214`). Its mark re-apply MOVES into the EditorPane reconcile pass (which already mounts notes+highlights/todos/cutter/revisions/reports/archive). mode:'B' with surviving `liveAnchorId` → no re-apply needed; mark GONE → re-apply via `reanchorByText`, driven from EditorPane's live arrays. **PRESERVE highlights-applied-LAST ordering** (`:3196-3206`) so a highlight inside a broader revision/cutter selection wins overlap and `LinkedAnchorGuard` fires no spurious orphan-strip. Same kind set: note+todo+revision+cutter+highlight.
- **renderCull:** marker's `textObjectId` becomes `resolver.paragraphId` (`EditorPane.tsx` marginaliaMarkers memo `:1742-1953` — replace bare `getLinkedTextObjectIds[0]` AND delete the inline revision anchorId-walk `:1794-1840`, subsumed by `anchorIdToParagraph`). `getMetrics`-null (`marginalia-grid.ts:102-104`) + `uuidToPos`-undefined (`useInTextPositions.ts:38-45`) keep skipping genuinely-offscreen blocks, but unresolved-uuid is no longer their call. orphan → visible "unanchored — click to re-pin" (wire `isModeAOrphaned` generalized to both modes). FIX registry observe-miss: in `syncObservedSet` (`useMarginaliaRegistry.ts:348-367`) do NOT fold a uuid into `lastUuidSet` when `resolveDomForUuid` returned null + `io.observe` skipped — keep in a `pendingObserve` set retried next sync.
- **dualMount:** the only load-bearing recovery WRITER in EditorLayout is `applyLinkedAnchors`; once it moves (RC-B), EditorLayout's parity mounts do no recovery write. Retiring the parity HOOK mounts (routing EditorLayout's remaining non-recovery reads through paneState) is **E5 — separate/later/optional, highest blast, orthogonal to the bug.**

## Drop-commit changes (CHIP-A + C)
- `applyDrop` (`text-object-side-reanchor.ts:54-96`): after `preserveModeBAnchor` + `removeLinkedAnchor` + `removeTextObjectLink(old)`, ADD a `clearModeB` step (new optional `clearModeB?(id)` on `ParagraphAnchorApi`, `drop-mode/types.ts:92`, wired in EditorPane notes/highlights bag → existing `notesHook` `clearTextAnchorLink`/`links.ts:1484` which converts linkedRange→paragraph preserving pids) so the surviving linkedRange link converts to clean paragraph + `getTextAnchor` returns null. THEN `captureParagraphSnapshot(ctx.mainEditor, placement.paragraphId)` (already present `:89-92`) + `addTextObjectLink` with it.
- `addTextObjectLink` (`links.ts:1358-1410`): GATE the Mode-B fold (`modeBIdx!==-1`, `:1379-1392`) on `targetKind!=='paragraph'` → a paragraph re-anchor falls through to the fresh Mode-A branch (`:1393-1409`) threading `paragraphSnapshot`. Belt-and-suspenders with `clearModeB`.
- Controller `finishApply` (`controller.ts:324`, ONE per mouseup): CHIP-C adds an unconditional `ctx.requestAnchorFlush?(placement.paragraphId)` after applyDrop, independent of whether `ensureAnchorUuid` minted (`anchor-uuid.ts:76` early-returns w/o a mint tx on an already-uuid'd target → today NO flush). Gate to `classifyDrop!=='no-op'`; coalesce with any hover mint-flush by paragraphId (no double-flush). Wire → EditorPane → `useDocument` flushNow (same entry the anchor-mint signal uses). NEVER per pointermove (`handleMove` stays read-only).

## Make-or-break verdicts (resolved by code-read)
- **captureParagraphSnapshot is NON-NULL at re-anchor in prod** (the test null is a harness artifact — `ctx.mainEditor` is a LIVE getter `DropModeProvider.tsx:101`; `placement.paragraphId` came from `hitTest` on that same editor; node carries the uuid via `ensureAnchorUuid`). Null degrades gracefully to UUID-only durability (backfilled next load). **CHIP-A MUST add a real-`new Editor` end-to-end test asserting non-null snapshot lands.**
- **DEFERRING_PARENTS container mis-mint is ALREADY FIXED** (`hit-test.ts:171-189` delegates to `ensureAnchorUuid`/`resolveAnchorableNode` honoring `anchor-uuid.ts:47-49`) — do NOT spend a chip on it; only keep `normalizeParagraphText` container-consistent (CHIP-D).
- Data model is **ADDITIVE — no schema bump, no migration**. The resolver tolerates every legacy shape incl. the RC1 hybrid (resolves via uuid rung on P_new → legacy poisoned cards self-heal on first load). Highlights stay Mode-B (NOT converted by CHIP-A — exclude `kind==='highlight'`). Do NOT adopt A2's highlight two-link merge (backlog).

## Keystroke sanctity
Recovery gates on what gates today: load reconcile runs ONCE/doc-open behind `modeAReconciledDocRef + docContentReady + allCardSidecarsLoaded`; the render resolver lives in the marginaliaMarkers `useMemo` keyed on card arrays + `rev.anchors` + `rev.blocks` (`useStructuralRevisions`/DocStructureBus). A plain keystroke mints no uuid, adds/removes no block → counters flat → memo doesn't recompute. `buildResolveIndex` runs once/recompute building ONE index vs today's N inline per-card walks — a net REDUCTION. NO new subscriber. CHIP-C flush fires once in `finishApply` (mouseup). Assert: typing N chars leaves `__virgilBusStats().emitCount` flat + `__marginaliaStats()` marker count stable + marginaliaMarkers recompute count 0. Step-inspector MOVE-collapse (`step-inspector.ts:577-600`: same-uuid delete+insert → changedBlocks) proves a block MOVE doesn't spuriously bump `rev.blocks` — assert in a test.

---

## STAGED CHIP PLAN
| Chip | Title | Deps | Gate | Files |
|---|---|---|---|---|
| **R0** | Pure resolver SSOT (resolver+index+normalize+reconcileCardToResolved) + exhaustive unit tests; no consumers wired | none | unit-only | `links/resolve-card-anchor.ts` (NEW) + test |
| **A** | Re-anchor CONVERTS Mode-B→clean Mode-A (fold-gate `targetKind!=='paragraph'` + `clearModeB` + exclude highlight) + real-editor snapshot E2E test | none | full-adversarial | `links.ts`, `text-object-side-reanchor.ts`, `drop-mode/types.ts`, `EditorPane.tsx`, `useNotes.ts`, drop-mode test |
| **RC-A** | Resolver-driven load reconcile (swap body, keep data-loss-safe shell) | R0, A | full-adversarial | `useReconcileModeAAnchors.ts`, `links.ts`, mode-a-reconcile test |
| **B** | Render: marker `textObjectId` from resolver + snapshot fallback + orphan surfacing + registry observe-miss fix | R0 | full-adversarial | `EditorPane.tsx`, `marginalia-grid.ts`, `useInTextPositions.ts`, `useMarginaliaRegistry.ts`, `links.ts` |
| **RC-B** | Move Mode-B mark re-apply into EditorPane pass; retire `EditorLayout.applyLinkedAnchors` (highest-blast recovery chip) | R0, RC-A | full-adversarial | `EditorLayout.tsx`, `EditorPane.tsx` |
| **C** | Flush `%!v:` on every re-anchor COMMIT, not only on a fresh mint | A | single-skeptic | `controller.ts`, `drop-mode/types.ts`, `EditorPane.tsx`, `useDocument.ts` |
| **D** | Normalization-tolerant snapshot match folded into the resolver | R0 | unit-only | `resolve-card-anchor.ts`, `links.ts`, test |
| **E5** | (OPTIONAL/LATER) Retire EditorLayout dual-mount: route remaining reads through paneState | RC-B | full-adversarial | `EditorLayout.tsx` |
| **CK** | (separate low-pri) migrateCardLinks normalization gap — legacy `target.ref.kind` token passes through un-normalized though funnel has the spine `kind` arg | none | unit-only | `links/migrate-card.ts`, `cards/legacy-token-crosswalk.ts` |

**Waves:** W1 = R0 ∥ A (disjoint files). W2 = RC-A, B, C, D (after R0+A; cluster to avoid links.ts/EditorPane.tsx collisions). W3 = RC-B (alone; highest blast). E5/CK = deferred follow-ups.
**Per-chip teeth** (temp-revert → RED): see the design output; each chip prompt carries its own. **All teeth are unit/integration — NO live preview** (bugs mask in the dev backend). RC-B + A carry the two highest-value teeth (un-re-anchored-Mode-B-mark-survives; real-editor snapshot lands).

## Open verifications (carry into the relevant chip)
1. EditorPane reconcile pass can re-apply Mode-B marks for ALL FIVE kinds (note/todo/revision/cutter/highlight); confirm the revision branch's anchorId is reachable from `revisionsHook.cards` with the same editor handle as the old inline walk (`:1797-1819`). [RC-B]
2. `buildResolveIndex.anchorIdToParagraph` is ONE O(doc) walk, not per-card; build the index at the TOP of the memo before per-card loops. [B, RC-A]
3. Grep `getTextAnchor`/`getAnchorSummary` note/highlight consumers — after conversion a re-anchored note's badge flips selection→paragraph; confirm DESIRED, not a regression. [A]
4. CHIP-C flush entry == the `flushNow` anchor-mint-signal uses; commit that ALSO armed a hover mint-flush coalesces to one write (dedupe by paragraphId / single pending-flush flag). [C]
5. `reconcileCardToResolved` idempotent E2E: run load pass twice → 2nd pass changed:false for every card (no save loop). [RC-A]
6. Converting Mode-B→Mode-A in applyDrop leaves no dangling linkedAnchor mark for a multi-textRange card (today ≤1/card; confirm `removeLinkedAnchor(strippedAnchorId)` covers the single anchorId). [A]

## Risks & guards
- **RC-B highest blast:** miss a kind or drop highlights-LAST → un-re-anchored Mode-B marks lost on reload (NEW regression). GUARD: full-adversarial gate + explicit overlap-ordering test; cover the identical kind set, highlights last.
- **CHIP-D normalization widens match set** → duplicated-text collision. GUARD: uuid-rung STRICTLY before snapshot; whole-paragraph (not substring); first-match-wins documented; position disambiguator = backlog.
- **CHIP-C flush perf:** gate to `classifyDrop!=='no-op'` + coalesce by paragraphId; once/mouseup.
- **Orphan affordance (B)** is NEW UI: STYLE_GUIDE pass + `liveUuids.size===0`/not-on-load early-out so it never false-flags during editor-mount gap.
- **Resolver in the memo:** keep the existing no-raw-counter contract comment (`EditorPane.tsx:1730-1740`); add the resolver to it explicitly.

---

## PROGRESS + REFINEMENTS (live, 2026-06-17)

**Base:** local `main` was at `569a35a` at dispatch (22 commits ahead of origin `0159f37` "Release v0.1.55", all unpushed). **Worktree tooling bases new worktrees off origin/main `0159f37`, which PREDATES P1/P2/P3 — every chip MUST rebase its branch onto current local `main` before building** (both W1 chips hit this and self-corrected; bake this into future chip prompts).

**Wave 1 — MERGED, main green (tsc 0):**
- `R0` → merge `b7ec2c6`. Pure resolver SSOT, 20 tests. **Resolver has a rung "2b"** (beyond the literal 4-rung ladder): a poisoned `linkedRange` link with a DEAD mark but a LIVE uuid in `textObjectIds` resolves `{source:'uuid',mode:'A'}` — runs strictly AFTER the mark rung (healthy Mode-B not hijacked; guard test) and BEFORE snapshot. This is what self-heals the RC1 hybrid for ALL kinds.
- `A` → merge `51f2b86`. Mode-B→Mode-A conversion (notes). Adversarial verdict SHIP-WITH-NITS. tsc 0, 236 drop-mode/links/hooks tests pass.

**RC-A scope AUGMENTED (carry into the RC-A+D chip):**
1. **Editor-aware snapshot backfill.** R0's pure `reconcileCardToResolved(card,res)` has no editor → on `source:'uuid'` it only CANONICALIZES an existing snapshot; a MISSING snapshot stays missing. RC-A (which has `editor`) MUST layer a `captureParagraphSnapshot` backfill for missing snapshots (thread live text in, or call capture in the load pass after reconcile).
2. **HYBRID CLEANUP = the class fix for non-note kinds.** CHIP-A wired `clearModeB` for NOTES only. A re-anchored Mode-B todo/revision/cutter/report lands in an inert hybrid double-link `[{linkedRange,OLD}, {paragraph,[P_new],snap}]` (RC1 unfixed for them, not worsened). RC-A's reconcile MUST: when a card resolves Mode-A via the uuid rung (incl. rung 2b) yet still carries a `linkedRange` link whose anchorId is DEAD, **strip/convert that dead link to a clean Mode-A link**. This heals todo/revision/cutter/report uniformly on load — the unified class fix, no per-kind write-side patching. (Keeps `getTextAnchor` null afterward so the Mode-B re-apply can't revert them.)
3. **Fold CHIP-D in.** Apply `normalizeParagraphText` at `captureParagraphSnapshot` (`links.ts ~108-124`) so newly-captured snapshots are stored in the SAME normalized form the resolver index uses → the snapshot rung actually ties after a round-trip. (R0 already normalizes inside the index; this closes the capture side.)

**Nits to clean in a later chip (RC-B or a cleanup):** (a) misleading comment in `text-object-side-reanchor.ts` (says highlight "no-ops" — only `clearModeB` no-ops; `addTextObjectLink` still adds a link); (b) CHIP-A's e2e harness mutates a synchronous `noteApi`, not the live `useNotes` hook (verified harmless out-of-band, but a real-hook test would be stronger).

**HIGHLIGHT POLICY (decided 2026-06-17, supersedes the earlier "highlights stay Mode-B" line above + in MEMO_CARD_DROP_MARGIN_FIX.md:59):** a **re-anchored** highlight legitimately becomes **Mode-A**. The drop-button design already intends a paragraph re-anchor of a highlight to lose its range to `originalAnchor`; the RC-A hybrid-cleanup converting it is CORRECT (NOT converting would leave the RC1 reload-revert alive for highlights). The "stay Mode-B" rule applies only to the NON-re-anchor write path (initial create / a normal Mode-B highlight is never auto-converted; the resolver's mark rung keeps a healthy live-mark highlight as mode:'B'). **RC-B must NOT exclude highlights from the cleanup; it must handle healthy live-mark highlights LAST in the moved re-apply.**

**Wave 2 sequencing — UPDATED (RC-B PROMOTED tightly after RC-A per the RC-A skeptic):**
- **W2a — RC-A+D ✅ MERGED `fe7a64c`** (full-adversarial SHIP-WITH-NITS; main green tsc 0 / 248 dir-tests / 1763 full). buildResolveIndex does 2 card-count-independent O(doc) walks; normalize moved to leaf `_shared/normalize-text.ts`; legacy fns test-only.
- **W2b — RC-B NEXT (full-adversarial WORKFLOW review, alone):** retire `EditorLayout.applyLinkedAnchors` (`:3163-3214`), move Mode-B mark re-apply into the EditorPane reconcile pass (resolver `liveAnchorId`-driven; only re-apply for resolver mode:'B' with a missing mark; healthy highlights LAST so overlap wins + `LinkedAnchorGuard` fires no spurious orphan-strip). Closes the doc-side stray-mark/transient-revert window RC-A left open. Highest blast → multi-lens adversarial review, not a single skeptic. Files: `EditorLayout.tsx`, `EditorPane.tsx`.
- **W2c — B (full-adversarial) ∥ C (single-skeptic)** after RC-B: B = render resolver-driven marker + snapshot fallback + orphan surfacing (use `resolver.source==='orphan'`, avoid touching `links.ts isModeAOrphaned`) + registry observe-miss fix; C = commit-flush. Disjoint `EditorPane.tsx` regions (B ~1742 memo; C ~1358 drop bag).
- **Deferred:** `E5` (dual-mount reader retirement), `CK` (legacy-token normalization).
