# Card-drop / marginalia anchor bug — diagnosis + fix plan

**Owner:** card-system maintenance manager · **Started:** 2026-06-17 · **Mode:** ultracode manager session
**Status:** 🔬 DIAGNOSED (6-lens adversarial workflow + clue agent). Awaiting Gabriel's scope nod, then chip dispatch.
**Predecessor:** `docs/memos/anchor-persistence-bug/SYNTHESIS.md` (the P1/P2/P3 fix) — this memo is the **post-fix** diagnosis: the bug survived P1/P2/P3.

> CENTRAL PRINCIPLE (Gabriel): unified/deep/architectural; capture the whole class; restore Mode-A/Mode-B symmetry; no surgical patches.

---

## The bug (user repro)
Re-anchor a Note (header drop-button OR gutter pin-drag) → (a) margin item appears ~10s then **disappears** (live, no reload); (b) reload **loses** the re-anchor (reverts/orphans). Plus general "margin items don't persist / dropped cards won't sit."

## Root causes (ranked)

### RC1 — Mode-B fold poisons re-anchored **selection-origin** notes  [HIGH] → CHIP-A · the common reload-loss
A Note born from a text selection is a single `{targetKind:'linkedRange', textRange:{anchorId,textSnapshot}, textObjectIds}` link. On re-anchor:
`applyDrop` → `preserveModeBAnchor` (writes `card.originalAnchor` ONLY, leaves the textRange link) → `removeLinkedAnchor` (strips the **mark from the editor only**) → `addTextObjectLink(id, P_new, 'paragraph', snapshot)` — but `addTextObjectLink` finds the **surviving linkedRange link** (`modeBIdx !== -1`) and **folds `P_new` into its `textObjectIds`, returning early WITHOUT threading `paragraphSnapshot`.**
Net card state: `{targetKind:'linkedRange', textObjectIds:[…,P_new], textRange:{OLD}}`, **no paragraphSnapshot**.
On reload: (i) `reconcileModeAAnchors` short-circuits `if (targetKind==='linkedRange') return link` → **P1 never heals it**; (ii) `getTextAnchor` still returns the OLD anchorText → `EditorLayout.applyLinkedAnchors` re-applies the mark **by text search at P_old** → the note **visibly reverts** to the old paragraph.
Evidence: `links.ts:1372-1392`, `text-object-side-reanchor.ts:68-94`, `useNotes.ts:368-389`, `links.ts:1230`, `links.ts:1044-1061`, `EditorLayout.tsx:3163-3214`.

### RC2 — Render-layer cull (`getMetrics(uuid)===null`)  [MEDIUM] → CHIP-B · the 10s-vanish
The marker is emitted from links, but its RENDER is gated by `marginalia-grid.ts:102-104` `const node = getMetrics(m.textObjectId); if (!node) continue;`. `getMetrics` returns null in two regimes — **the card LINK stays intact** (so it persists in the sidecar, presents as appears-then-vanishes, no reload):
- (a) **near-zone eviction:** the re-anchored block leaves the IntersectionObserver near-zone (±800px) on any incidental scroll/reflow → `state.cache.delete(uuid)` (`useMarginaliaRegistry.ts:415-423`).
- (b) **first-paint observe miss:** `syncObservedSet` (on the mint's `onBlocksAdded`) calls `resolveDomForUuid` (querySelector `[data-uuid=X]`); if the decoration hasn't painted, `io.observe` is skipped BUT the uuid is still recorded in `lastUuidSet`, so `if (state.lastUuidSet.has(uuid)) continue` (`:350`) means it's **never re-observed**.
There is **no active link-deleting actor and no ~10s timer** (all 6 lenses ruled out reconcile/save/autosave as a live-doc uuid remover — reconcile is once-per-doc-latched + idempotent `EditorPane.tsx:1109-1130`; save runs `assignUuids` on a detached `getJSON()` copy, never `setContent`s the live editor). The vanish is a **pure render-layer cull with no snapshot fallback at measure time.**
Evidence: `marginalia-grid.ts:102-104`, `useMarginaliaRegistry.ts:348-367,415-423`, `marginalia-blocks.ts:45-52`, `EditorPane.tsx:1742-1773`.

### RC3 — Clean Mode-A re-anchor durability gap  [HIGH] → CHIP-C + CHIP-D
A clean Mode-A note re-anchors to a correct `{targetKind:'paragraph', [X], paragraphSnapshot}` link. Reload survival needs `%!v:X` in the `.tex` (`assignUuids` preserves only round-tripped `%!v:`). It lands via the **hover-mint flush** (`ensureAnchorUuid → markAnchorMint → flushNow`) — but `anchor-uuid` **early-returns when the node already has a uuid**, so re-anchoring onto an **already-UUID'd** paragraph dispatches **no mint tx → no flush → sidecar-only write**; if that uuid wasn't yet in `.tex`, reload re-mints a fresh one → dead anchor. The supposed backstop — the snapshot fallback — uses **strict whole-block `textContent ===`** (`links.ts:1188`), defeated by any LaTeX round-trip normalization (citations/math/emphasis/escapes/whitespace) and by `DEFERRING_PARENTS` (snapshot captured against the **container** uuid). So it fails exactly on the marked-up paragraphs users care about.
Evidence: `text-object-side-reanchor.ts:89-94`, `links.ts:108-124`, `latex-serializer.ts:831-912`, anchor-uuid early-return, `useDocument.ts:288-316`, `links.ts:1179-1195`, `storage-fsa.ts:309-316`.

### RC4 — Architectural: ONE write path, THREE divergent recovery owners  [HIGH] · the class
The drop rework unified the WRITE path (button + pin → `beginCardDropGesture` → controller → `applyDrop`). But RECOVERY is three uncoordinated owners that **disagree**: (1) `reconcileModeAAnchors` heals Mode-A only (skips linkedRange `:1230`); (2) `EditorLayout.applyLinkedAnchors` re-applies Mode-B marks **by text search** (runs from a SECOND dual-mount of the card hooks, `EditorLayout.tsx:542-594`); (3) the render layer silently culls any unresolved uuid with no fallback. `applyDrop` can leave a card in a **hybrid state** (linkedRange link → paragraph uuid, mark stripped), so the three owners pull it three ways. **No component asks "what paragraph does this card live on NOW?" and reconciles all representations to it.** `isModeAOrphaned` (`links.ts:1292-1309`) exists but is test-only/unwired. *This is why patching any single lever left the bug.*

## Four-path review (button × pin × unanchor × re-anchor)
- **Write path is byte-identical button vs pin** (both → `beginCardDropGesture` → controller → `applyDrop`); unanimous across 6 lenses (`Marginalia.tsx:261`).
- **Clean Mode-A** (any path): correct link + real snapshot; breaks only on RC3 (.tex durability) + RC2 (render cull).
- **Selection-note** (any path): RC1 — link stays linkedRange, snapshot dropped, reverts to old text on reload.
- **Worst path = pin-drag re-anchor of a selection-note:** RC1 + mark stripped from doc while link still says linkedRange → Mode-B re-apply drags to P_old.
- Pin-drag additionally **mints+flushes per throttled pointermove** during the drag (`hit-test.ts:95`) = write amplification (fold-introduced).

## Why P1/P2/P3 was insufficient
P1 only heals `targetKind!=='linkedRange'` (so ZERO coverage for the selection-note repro) + strict-`===` snapshot match (defeated by round-trip) + load-only/latched (does nothing for the live 10s-vanish). P2's flush only fires on a genuine MINT (re-anchor onto an existing uuid → no flush). P3 brought existing-uuid parity but is fire-and-forget. The bug = **link-shape poisoning (RC1) + render cull (RC2)**, not a missing paragraph-uuid write.

---

## Chip plan
| Chip | Title | Files | Deps | Gate |
|---|---|---|---|---|
| **A** | Re-anchor CONVERTS Mode-B selection-note → clean Mode-A (no fold, snapshot preserved) | `links.ts` (addTextObjectLink fold ~1372-1392), `text-object-side-reanchor.ts` (applyDrop ~54-96), `useNotes.ts` (preserveModeBAnchor + clearTextAnchorLink ~368-389), tests | none | full-adversarial |
| **B** | Render-layer snapshot fallback + orphan surfacing instead of silent `getMetrics`-null cull; fix registry first-paint observe-miss | `marginalia-grid.ts:102-104`, `useInTextPositions.ts:25-46`, `useMarginaliaRegistry.ts:348-367`, wire `isModeAOrphaned` `links.ts:1292-1309`, tests | none | full-adversarial |
| **C** | Flush `%!v:` to `.tex` on every paragraph re-anchor COMMIT, not only on a fresh mint | `text-object-side-reanchor.ts`, `drop-mode/types.ts` (flush hook), `useDocument.ts`, `anchor-mint-signal.ts`, test | none | single-skeptic |
| **D** | Normalization-tolerant snapshot match for the Mode-A reload fallback | `links.ts` (findParagraphIdBySnapshot ~1179-1195, captureParagraphSnapshot ~108-124), test | CHIP-A | unit-only |
| **E** | (separate, low-pri cleanup) migrateCardLinks normalization gap: legacy `target.ref.kind` token (`suggestion`) passes through un-normalized though the funnel has the spine `kind` arg in hand | `links/migrate-card.ts:41-43,65-71`, `cards/legacy-token-crosswalk.ts:84-87`, panel hooks, test | none | unit-only |

### Fix lever details
- **CHIP-A (L1):** make a paragraph-side re-anchor a **CONVERSION, not a fold**. In `applyDrop`, after `preserveModeBAnchor` + `removeLinkedAnchor`, ALSO `clearTextAnchorLink` so `getTextAnchor` returns null; then `addTextObjectLink` writes a fresh `{paragraph,[P_new],paragraphSnapshot}`. Gate the Mode-B fold in `addTextObjectLink` on `targetKind==='paragraph'` (don't fold a paragraph anchor into a linkedRange link). **Exclude highlights** (Mode-B by design). Restores Mode-A/B symmetry → P1 now covers it.
- **CHIP-B (L2):** (i) registry: on `resolveDomForUuid===null` for a NEW uuid, do NOT record it as handled — retry next sync (pendingObserve set / RAF re-resolve). (ii) grid: on `getMetrics===null`, if the card has a `paragraphSnapshot`, re-resolve via `findParagraphIdBySnapshot` at measure time OR surface a visible **orphan affordance** instead of vanishing. Keystroke-sane: fallback only on the cull path, memoized, never on typing.
- **CHIP-C (L3):** decouple `.tex` durability from whether a mint happened — on a successful re-anchor COMMIT, unconditionally request a doc-bundle flush for the target uuid. Flush once on mouseup, NOT per pointermove.
- **CHIP-D (L4):** trim+collapse-whitespace (and/or normalized round-trip form) comparison; keep UUID-first; capture+match the SAME normalized form; for DEFERRING_PARENTS capture against the resolved container uuid consistently.

## Open verifications (make-or-break)
1. **LIVE FSA only** (preview masks via storage-dev): reproduce the ~10s no-reload vanish in production FSA while running `window.__marginaliaStats()` + dumping `editor.state.doc` descendant uuids across 0–15s post-re-anchor — to confirm whether the vanish coincides with a scroll (near-zone eviction) or a first-paint observe miss. **CHIP-B fixes both regimes**, so this is confirmatory, not blocking.
2. **Discriminator:** is the user's repro note **selection-origin (Mode-B)** or created directly on a paragraph (Mode-A)? Fastest check: inspect the card's link `targetKind` in the sidecar after a re-anchor — `linkedRange` ⇒ RC1/CHIP-A; `paragraph` ⇒ RC3/CHIP-C+D.
3. `captureParagraphSnapshot` returns **non-null at re-anchor time in practice** (reads `ctx.mainEditor` live; landed tests always feed `null` mainEditor — end-to-end capture is UNPROVEN). CHIP-A must prove this end-to-end.
4. Confirm converting a re-anchored selection-note to Mode-A doesn't break a panel expecting it to stay linkedRange (grep `getTextAnchor` consumers for notes).
5. FSA load-writeback ordering hazard is LOW confidence (enqueues before editor mounts → likely unreachable) — do NOT prioritize a P3 ordering fix without instrumented confirmation.

## Red herring (ruled out, HIGH confidence)
The `[legacy-token-crosswalk] unknown card-kind token "suggestion"` console error is **NOT** a contributor. `useAnchorHighlightReconciler` only paints 4 selection/hover halo attrs; an unknown kind degrades to a missing accent-rail tint (no loop abort, no marker cull, no persistence). It reproduces only on the user's real pre-spine paper (the dev sample is clean — which is itself the dev-masking pattern). Filed as CHIP-E cleanup.
