# Action-menu anchor bugs (BUG1 + BUG2) — adversarial review verdict

<!-- review lead memo. Worktree: /Users/gabriel/Programming/virgil-wt/action-menu-anchor-fix
     (branch action-menu-anchor-fix), staged diff. Verified against the live worktree
     code, not just the diff hunks. typecheck clean; the BUG1/BUG2 targeted suites pass. -->

## ⚠️ POST-REVIEW HARDENING (added after the workflow run)

The review's VERIFY stage was partially **rate-limited** by the API — 11 verify
agents errored, INCLUDING two `high`-severity findings that were therefore dropped
from the synthesis (it only saw 1 confirmed `low`). The orchestrator manually
adjudicated both against the live code; **both were REAL and are now FIXED:**

1. **[HIGH → FIXED] `linkCard` token divergence in the BUG1 reconcile.** The reconcile
   stamped `linkCard = "comment:<id>"` for revisions (via `legacyKindToCardKindString`),
   but the canonical mark grammar is `<spineCardKind>:<id>` (`linkCardKey`), which
   `parseLinkCardKey` consumers (`delete-range.ts:204`, `drag-handle-actions.ts:1122`,
   `duplicate-slice.ts:138`, `collectLinksFromEditor` `links.ts:216`) slice to a spine
   `CardKind`. `"comment"` is NOT a spine kind → `lifecycle.get("comment")` is undefined
   → a block delete silently failed to remove a reloaded revision card, and
   `collectLinksFromEditor` minted an invalid `ref.kind`. **Fix:** the reconcile now
   re-stamps **kind + tintColor only** and PRESERVES the live (empty-on-load) `linkCard`,
   matching the proven historical restore — colour comes from the KIND render-fallback
   (`dataLinkCardTokenForLegacyMarkKind` → `comment:`) and consumer kind from
   `legacyAnchorKindToCardKind` → `revision-comment`. Locked by a new consumer test
   (`collectLinksFromEditor` on a reloaded revision → `revision-comment`). See the
   `linkCard policy` block in `apply-linked-anchors.ts`. *(The pre-existing
   CSS-token-vs-spine-kind inconsistency for revisions — `updateLinkedAnchorCard`
   writes `revision-comment:<id>` which the CSS `[data-link-card^="comment:"]` rule did
   not match — was initially a separate follow-up and is now **FIXED**: the
   `data-link-card` token namespace was unified onto the spine kind (crosswalk
   `legacyDataKind` → `revision-comment`/`revision-suggestion`; globals.css matches the
   spine tokens via the SSOT `--link-anchor-accent-revision-*` vars; `comment:` kept as
   a legacy alias). Full suite 2282 green.)*

2. **[HIGH → FIXED] Sidecar READ ERROR → orphan-reaper mass data loss.** `usePersistentState`'s
   loader `.catch` set `loaded=true` with an EMPTY collection on a real read error (corrupt/
   truncated sidecar JSON, transient FSA error — `readSidecarIfExists` returns null only
   for NotFound, else throws). That flipped `allCardSidecarsLoaded` true with a NON-
   authoritative alive-set, so the synchronous reaper stripped that kind's live `\vlid`
   marks and autosaved the loss. (Pre-existing latent at HEAD via the old `setTimeout`
   reaper; this change's synchronous + load-pass reapers amplify it.) **Fix:** added a
   distinct `loadError` signal to `usePersistentState` + the six card hooks; gated the
   DESTRUCTIVE reaper (both the hook `ready` prop and the EditorPane load-pass call) on
   `!anyCardSidecarLoadError`, while the CONSTRUCTIVE reconcile keeps running on partial
   data. Locked by a regression test.

Also landed: the LOW polish (#1 below) — the `next === prev` no-op guard in
`usePersistentState.update` — since it is the direct consequence of dropping the
orphan-listener kind gates. After these, the change is ship-ready as judged below.

---

## Overall verdict: **SHIP-READY** (ship-with-one-optional-polish)

The fix is correct on both of its highest-risk axes — BUG1 reconcile correctness and
load-order data-loss safety — and clean on keystroke sanctity. There are **no
blockers and no high/medium findings.** One **LOW** finding (a redundant byte-identical
sidecar write per orphan-event burst) is real but is neither data loss nor a
keystroke-path cost; it can land in this PR or a trivial follow-up. The fix may ship
as-is.

The two owed manual smokes (production-FSA BUG1 reload round-trip; live BUG2 gesture on
heading/listItem caret) remain — they are the user-only verification the preview masks,
not review blockers.

---

## Must-fix items

**None.** Nothing blocks ship.

## Optional polish (LOW — may ship in this PR or a one-line follow-up)

1. **Redundant byte-identical sidecar write on every orphan event from the 4
   non-owning panels** — `src/hooks/usePersistentState.ts:202-225` (`update`).
   *One-line fix:* short-circuit inside the `setState` updater — `const next =
   fn(prev); if (next === prev) return prev;` BEFORE arming the debounced persist, and
   move `hasMutatedRef.current = true` inside that gate.
   *Why low:* dropping the orphan-listener kind gates (the deliberate BUG1 fix) means
   all five panels now call `clearCardAnchor(anchorId)` unconditionally; four of them
   self-filter to a state no-op (`if (!prev.cards.some(...)) return prev;`) — but
   `usePersistentState.update` has no `next === prev` guard, so it still arms a
   debounced `writeSidecar` (`storage-fsa.ts:211-221` — unconditional `JSON.stringify`
   + file write) and stamps `hasMutatedRef`. Result: ~1 redundant identical write per
   non-owning panel per orphan-event *burst* (the per-hook debounce coalesces a
   multi-anchor reload into one), ~300 ms after a reload/orphan gesture. NOT data
   loss (identical bytes), NOT keystroke-path (`virgil-anchor-orphaned` fires only from
   `LinkedAnchorGuard.appendTransaction` when `diff.removedAnchors.length > 0`,
   `linked-anchor.ts:95-109`, which bails on a plain keystroke). The fix is a net win:
   it also stops every other early-returning `update(prev => …unchanged…)` call site
   from churning a write and from spuriously arming the loader-stomp guard.
   *Plan-wording nit:* IMPLEMENTATION_PLAN §1 ("drop the kind gate … fires no write")
   is wrong at the persistence layer — it leaves *card state* unchanged but still
   schedules a write. Reword to "leaves card state unchanged" and, if the persist gate
   above lands, "and (with the next===prev guard) fires no write."

---

## The two highest-risk properties — explicitly confirmed

### (1) BUG1 reconcile correctness — kind / linkCard token / tint restored for EVERY kind ✅ CONFIRMED

- `applyLinkedAnchorsImpl` (`src/links/_shared/apply-linked-anchors.ts`) is the single
  shared implementation (production handle + tests import it — the prior hand-copied
  test mirror is retired, so they cannot drift). Policy is correct: **absent** →
  `reanchorByText` with kind+cardId+tint; **present & disagrees** (kind OR linkCard OR
  tintColor) → re-stamp the resolved range in place with authoritative attrs and
  `addToHistory:false`; **present & agrees** → no-op (idempotent).
- The `linkCard` token is built via the SHARED `legacyKindToCardKindString`
  (`links.ts:828`, now exported) — the SAME function create-time uses — so the
  re-stamped token is byte-identical to create. `authoritativeLinkCard` returns `""`
  when `cardId` is absent, matching create's empty-linkCard fallback.
- `cardKindToLegacyAnchorKind` (`links.ts:421`) is now **exhaustive** with NO `default`
  — TypeScript enforces all 16 `CardKind`s are handled; the nine anchor-bearing kinds
  map to their real `LinkedAnchorKind` (the old lossy `default:"note"` that mislabeled
  revision-suggestion/report/report-request is gone), the seven non-anchor kinds return
  `null`. The `?? "note"` at the create site (`links.ts:385`) is correctly documented
  as unreachable-defensive.
- Reports are now in RC-B (`buildModeBReapplyRecords` collects `arrays.reports`,
  splitting `report` / `report-request`, AFTER cutters and BEFORE highlights;
  highlights stay strictly LAST for overlap last-wins). This closes a latent BUG1
  instance the plan flagged.
- Tint is kind-derived through the single SSOT `defaultTintForLinkedAnchorKind`
  (highlight → `#fbbf24`, else null), with a non-null per-card `highlightColor`
  override winning — restoring the deferred highlight-tint persistence. The three
  create-site `#fbbf24` literals now route through the SSOT.
- Cutter kind detection (`(c).kind === "suggestion" ? "cutter-suggestion" :
  "cutter-comment"`) is correct: cutter suggestion cards carry `kind:"suggestion"`
  (`useCutter.ts:80,216`), so the reconcile stamps the right `LinkedAnchorKind`.
- `reanchorByText` now also sets `addToHistory:false` (a previously-latent gap noted in
  the plan) and threads `tintColor` into the setMark attrs.
- The end-to-end `linked-anchor-kind-roundtrip.test.ts` drives the REAL serializer →
  parser → `applyLinkedAnchorsImpl` and asserts the parsed `kind:"note"` corruption is
  re-stamped to the true kind + token across revision/todo/cutter/report/highlight.
  The full targeted suite (41 tests across 5 files + 5 reanchor tests) passes;
  `tsc --noEmit` clean.

### (2) Load-order data-loss safety — no live annotation reaped on any load / doc-switch path ✅ CONFIRMED

The synchronous, kind-gate-free reaper is the headline data-loss risk (a sweep against
an empty/partial alive-set would reap every live annotation). It is correctly gated on
both surfaces:

- **The hook** (`useLinkedAnchorReconciler`) takes a `ready` prop and bails
  (`if (!ready) return;`) until it is true; the call site passes
  `ready: allCardSidecarsLoaded && docContentReady` (`EditorPane.tsx:3803`).
  `allCardSidecarsLoaded` ANDs all six sidecar `.loaded` flags (notes/todos/cutter/
  revisions/reports/archive, `EditorPane.tsx:1334-1340`). The `ready` JSDoc explicitly
  documents the empty-alive-set mass-reap hazard and why the old `setTimeout(0)` debounce
  masked it.
- **The load-pass reaper** runs LAST inside the once-per-doc effect that is itself
  gated `if (!editor || !docContentReady || !allCardSidecarsLoaded) return;` and latched
  on `modeAReconciledDocRef` (`EditorPane.tsx:1342-1344`), AFTER `reapplyModeBAnchors`
  and the six `reconcileAnchors` — so a just-re-applied healthy mark is in the alive-set
  built from the now-reconciled collections and is not reaped.
- **Archived cards are safe.** The per-card `archived` flag is a view filter only; the
  filtered hooks (`notesHook` etc.) spread `...notesHookRaw`, so `notesHook.notes ===
  notesHookRaw.notes` — archived cards remain in the collections that feed BOTH
  alive-sets. An archived card's `linkedAnchor` is therefore in the alive-set and is
  NOT reaped.
- **Create is safe.** A `createLinkedAnchor` → `addCard` gesture commits the mark and
  the card into its collection in ONE synchronous handler, so the alive-set memo
  already contains the new anchorId by the time the layout effect re-runs (documented
  + regression-pinned). The mark/card never split across two React commits.
- The `isDestroyed`-only guard (NOT `isInitialized`) is deliberate and correct: TipTap
  flips `isInitialized` inside a `setTimeout(0)` after the `create` emit, but the
  view+state exist from the constructor, so the load-time reap must run on the first
  synchronous layout pass.

Both `reapOrphanLinkedAnchors` and `applyLinkedAnchorsImpl` are load/gesture-time only
— neither subscribes to `editor.on('update'|'transaction')`; the hook is keyed on the
six collection identities (structural-change memos, silent on a plain keystroke). The
orphan listeners fire only on `virgil-anchor-orphaned`, dispatched only when
`removedAnchors.length > 0`. **Keystroke sanctity is intact.**

---

## What was checked and found clean

- **BUG2 dispatch correctness.** `resolveAnchorUuidAndKind` returns the real anchorable
  node's `type.name` (guaranteed `isTextObjectKind`, else `"paragraph"`); both
  menu-open paths (Cmd-/ keydown + `openMenu` button) thread `resolved.kind` onto
  `menuTarget` and into `ActionsMenuPanel.nodeKind`, with the old `if (!uuid) return;`
  gate preserved as `if (!resolved) return;`. `runAction` cursor-mode emits
  `{kind: nodeKind, id}`; `resolveRefRange` resolves heading (line/section via
  `forAction`), the linkedRange/atom-block branches, and the generic uuid→content-range
  walk for every other kind — so a heading/listItem/blockquote/codeBlock caret now lands
  a Mode-A card instead of silently no-oping. Negative test locks the pre-fix flattened
  `{kind:"paragraph"}` no-op.
- **Probe↔dispatch asymmetry is intentional and safe.** The applicability probe stays a
  `{kind:"cursor"}` ref (so `highlight` correctly greys at a caret) while dispatch uses
  the real kind; both derive from the ONE `menuTarget`, so they cannot diverge on
  identity. Documented at both sites.
- **The `ensureAnchorUuidNode` refactor** correctly avoids a stale node re-read after
  `setNodeMarkup` (returns the pre-mint node — `type.name` is invariant across the
  mint — plus the freshly minted uuid). `ensureAnchorUuid` is preserved as a thin
  wrapper, so its ~existing callers are unaffected.
- **The five orphan listeners** each now drop the kind gate and keep `if (!anchorId)
  return;`; each `clearCardAnchor` (verified in useNotes, and per the plan's pre-flight
  in useTodos/useRevisions/useReports/useCutter) self-filters by anchorId membership
  with a no-match early-return, so a stale-kind event cannot mis-mutate a non-owning
  panel's state (only schedule the redundant write of finding #1).
- **`reanchorByText` uuid-scoped, atom-aware path** maps the char hit to doc positions
  with a per-child offset walk (doc pos advances by `nodeSize` for ALL children incl.
  atoms; char index only for text), with the legacy doc-wide first-match preserved as
  the fallback for no-uuid callers. Tests confirm scoping (same snapshot in two
  paragraphs → lands in the stored one) and atom-spanning correctness.
- **Back-compat:** the `\vlid{X}` marker shape is unchanged (variant i.b, not i.a), so
  every existing `.tex` round-trips identically; the reconcile is a purely
  sidecar-driven attr correction on the parsed doc.
- **Map exhaustiveness / no behavior pin on the old wrong value:** the targeted suites
  (anchor-kind-maps, get-text-anchor-card-kind, drag-handle-dispatch-nits,
  reapply-mode-b-anchors, reap-orphan-linked-anchors, orphan-kind-gate-dropped,
  reanchor-uuid-scoped, linked-anchor-kind-roundtrip) all pass; no test pinned the old
  `default:"note"` value.

---

## Owed (user-only, not review gates)

- Production-FSA BUG1 reload smoke (real `.tex` round-trip on disk) — the preview masks
  anchor persistence (`storage-dev` writes load-minted UUIDs back to `.tex`); the
  serialize→parse→RC-B unit test is the validation, but a live disk round-trip should
  confirm no production-only snapshot-drop race bypasses the reconcile.
- Live BUG2 gesture: cursor-on-heading → Comment and cursor-on-listItem → Note must
  each create a card (these gestures ARE faithful in the preview).
