# Feature: include footnote cards in the per-card archive functionality (+ panel UX)

**Status:** `ROOT-CAUSE-FOUND` / `DESIGN-READY` (HARDENED) — diagnosis only, NOT implemented. Bug-catcher session 2026-06-25; investigate→adversarial-verify workflow.
**Confidence:** HIGH on diagnosis; the deep-fix shape is directionally right but **ships on a stale premise and misses one collision** — see "Adversarial corrections (MUST HEED)". Treat the corrected version below as the real spec.
**Worktree:** TBD. Touches the footnote subsystem + EditorPane + predicates — a fresh worktree is cleanest.

---

## Request (user)

> "Footnote cards should be included in the archive-card functionality (the bottom-right-corner archive button, present in notes, etc.) — with corresponding UX in the panel."

This is the follow-up to the deferral recorded in [[card_archive_status]] ("DEFERRED — footnote archiving (panel surfacing) + lifecycle").

---

## Root cause: it's a missing RENDER PATH, not (any longer) a missing data model

Most of the citation-mirrored scaffolding **already exists** and routes footnote:
- `FootnoteRef.archived` exists ([types.ts](src/lib/types.ts), documented like `CitationRef.archived`).
- `useFootnotes.setArchived` exists ([useFootnotes.ts:137-149](src/hooks/useFootnotes.ts:137)) and already mirrors the flag to disk.
- `useFootnotes.syncFromEditor` already preserves non-editor footnotes ([useFootnotes.ts:213-235](src/hooks/useFootnotes.ts:213)).
- EditorPane already routes footnote through `setArchivedForKind` ([:4351](src/components/EditorPane.tsx:4351)), `spliceAndArchiveAtom` ([:4372-4391](src/components/EditorPane.tsx:4372)), the archive confirm dialog ([:4472-4483](src/components/EditorPane.tsx:4472)), and `archivedIds` ([:2301](src/components/EditorPane.tsx:2301)) — so `cardArchive.isArchived(footnoteId)` already returns true.
- `archiveRemovesAtom("footnote")` already returns true ([predicates.ts:70](src/cards/predicates.ts:70)).

**Two seams were never closed:**
1. **`isArchivable` still excludes footnote** ([predicates.ts:61-62](src/cards/predicates.ts:61): `… && k !== "footnote"`). `EditableCard` gates the archive button on `isArchivable(kind) && cardArchive.enabled` ([panel-primitives.tsx:969](src/components/panel-primitives.tsx:969)) — so **no archive button renders** on a footnote card. Flipping this predicate is *necessary and sufficient* for the button (FootnoteCard already passes `kind="footnote"`; the confirm dialog already special-cases footnote).
2. **The Footnotes panel sources from the live editor, not the ref list.** `footnoteInfos = innerRef.current?.getFootnotes()` ([EditorPane.tsx:3768](src/components/EditorPane.tsx:3768)) walks live `\footnote{}` nodes ([Editor.tsx:990-1007](src/components/Editor.tsx:990)); `FootnoteInfo` carries no `archived` flag. This is the *only* list fed to the panel ([:6397](src/components/EditorPane.tsx:6397), [:6738](src/components/EditorPane.tsx:6738), [:6913](src/components/EditorPane.tsx:6913), omni). So when archiving splices the `\footnote{}` out (`deleteFootnote`, [:4383](src/components/EditorPane.tsx:4383)), the footnote **vanishes from the panel entirely** — there is no "Archives" render path. Its body survives on disk in `footnotes.json` but is **UI-unrecoverable**.

Contrast Citations (the working template): the panel is **ref-backed** — `items={orderedCitations}` (anchored + unanchored + archived) + `getArchived` + `<CardViewModeMenuItems kind="citations">` ([CitationsPanel.tsx:339,362-364](src/panels/Citations/CitationsPanel.tsx:339)), filtered by `filterByArchiveView` ([CardListPanel.tsx:94-97](src/panels/_shared/CardListPanel.tsx:94)). Archiving sets `{archived,unanchored}` ([useCitations.ts:254-267](src/hooks/useCitations.ts:254)); `syncFromEditor` carries forward `prev.citations.filter(isUnanchored)` ([:582](src/hooks/useCitations.ts:582)) so the atomless ref is never dropped/resurrected.

---

## Deep, unified fix — collapse footnote + citation onto ONE "atom-backed archivable card" lifecycle

1. **Storage:** archived footnote body lives in `footnotes.json` (`FootnoteRef.content` + `archived:true`), NOT `archive.json` (matches citations; `updateFootnoteContent` already mirrors the body — but see data-loss trap #1). Routing through `archive.json` would split the SSOT and diverge from the `/editor/archive-card` skill (which refuses footnote/citation).
2. **Add `unanchored` to `FootnoteRef`** (mirror `CitationRef.unanchored`); `setArchived(id,true)` also sets `unanchored:true`.
3. **Tighten `useFootnotes.syncFromEditor`** carry-forward from the permissive `!editorIds.has(f.id)` to `!editorIds.has(f.id) && (f.unanchored || f.archived)` — keep BOTH disjuncts.
4. **Invoke `footnotesHook.syncFromEditor`** from EditorPane (but heed correction #3 — it's mount-only for citations).
5. **Source the panel from a MERGED list:** join live `footnoteInfos` (anchored: number/pos/title/thanks) with `footnotesHook.footnoteRefs` (adds archived/unanchored ref-only cards; stamps `archived` onto anchored ones). Gate the memo on the `rev.footnotes` structural counter + `footnoteRefs` (keystroke sanctity — never a raw update counter).
6. **Panel UX:** add `<CardViewModeMenuItems kind="footnotes">` to `FootnotePanel` headerLeading + a `getArchived` that reads the **resolved** archived flag (NOT `it.data.archived` — see correction #5); extend the `anchored | orphan` union ([FootnotePanel.tsx:21-23](src/panels/Footnotes/FootnotePanel.tsx:21)) with an archived member. Skip archived footnotes in `omni.tsx` (in-doc surface).
7. **Unarchive** clears `archived` (leaves `unanchored`) → an unanchored panel card the user re-places via the existing footnote drop-mode controller; re-anchor clears `unanchored` (mirror `useCitations.addCitation` [:205-212](src/hooks/useCitations.ts:205)).

---

## ⚠️ Adversarial corrections (MUST HEED — these change the spec)

1. **The "footnote ids regenerate on parse" premise is FALSE.** Footnote ids round-trip stably via the serializer's `\vfid{<id>}` ([latex-serializer.ts:411-412,713-714](src/lib/latex-serializer.ts:411)) + parser's `pendingFootnoteId` ([latex-parser.ts:172-177,498](src/lib/latex-parser.ts:172)). (Citations are the same via `\vcid{}` — the citation `setArchived`/`syncFromEditor` comments that say ids "regenerate" are themselves stale.) The keep-`(unanchored||archived)` filter is still correct, but **re-derive its rationale from stable-id round-trip, do not copy the stale comment.**

2. **LOAD-BEARING MISS — the flag-ON orphan double-creation.** Under `virgil:inline-atom-lifecycle` ON, `spliceAndArchiveAtom` dispatches the suppress-orphan event **only on the flag-OFF path** ([EditorPane.tsx:4374-4382](src/components/EditorPane.tsx:4374)). On the flag-ON path the orphan is minted synchronously by `makeInlineAtomLifecyclePolicy` off the structural diff ([inline-atom-lifecycle-policy.ts:166-189](src/links/_shared/inline-atom-lifecycle-policy.ts:166)) with **zero archive-awareness** — so archiving a footnote-with-content produces BOTH an archived `FootnoteRef` AND an `OrphanedFootnote` for the same id → the body double-surfaces and the panel collides on `footnoteId`. **The fix MUST add an archive-suppression seam to the policy** (an `archivedSuppress: Set<string>` the removal branch honors), since a plain `clearOrphan(id)` callback races the policy's synchronous `upsertOrphan` on the same diff. Files the original design missed: [inline-atom-lifecycle-policy.ts](src/links/_shared/inline-atom-lifecycle-policy.ts), [useInlineAtomLifecycle.ts](src/links/_shared/useInlineAtomLifecycle.ts), [footnote-sync.ts](src/components/editor-layout/event-bridges/footnote-sync.ts). **Test BOTH flag states.**

3. **`syncFromEditor` is MOUNT-ONLY for citations** (`[editor]` dep, [EditorPane.tsx:1764-1769](src/components/EditorPane.tsx:1764)), not per-parse. Placing footnote sync there gives reload-coherence only; the **merged memo** (not the sync) is what keeps the panel live. If per-parse reconcile is wanted, gate an explicit one on `rev.footnotes`.

4. **External-edit data-loss.** A `\footnote{}` removed via code-view / Overleaf sync does NOT call `deleteFootnote`, so its `footnotes.json` row lingers with no flags. Once sync is called + tightened, that content-bearing row is **silently dropped**. Recommend: route "absent + has content + not archived" → the **orphan store**, not delete — unifying the two atomless states instead of trading invisibility for data-loss.

5. **Panel `getArchived` inconsistency.** The design's `getArchived={(it)=>!!it.data.archived}` is wrong — `FootnoteItem.data` is a `FootnoteInfo` with no `archived`. The merge must resolve `archived` from the ref and `getArchived` must read that resolved field.

6. **Collab / multi-doc keep-alive — under-analyzed.** A whole-state `footnotes.json` writer firing from a hidden warm pane risks clobbering (cf. the per-doc orphan bleed history [[orphan_footnote_perdoc_status]]). Apply the same `docId`-scoping discipline the orphan store earned.

**Highest-risk data check:** confirm `FootnoteRef.content` holds the LATEST body at archive time (`updateFootnoteContent` is deliberately not pristine-dirty-marking, task_9768c44e territory) — else an archived footnote could show stale/empty text.

---

## Files to change (corrected superset)

| File | Edit |
|---|---|
| [predicates.ts](src/cards/predicates.ts:61) | Remove `&& k !== "footnote"` from `isArchivable`; delete the stale EXCEPTION comment (:52-60). |
| [types.ts](src/lib/types.ts) | Add `unanchored?: boolean` to `FootnoteRef`. |
| [useFootnotes.ts](src/hooks/useFootnotes.ts:137) | `setArchived(true)` → also `unanchored:true`; tighten `syncFromEditor` filter to `(f.unanchored \|\| f.archived)`; add re-anchor branch clearing `unanchored`; route absent+content+unflagged → orphan (correction #4). |
| [EditorPane.tsx](src/components/EditorPane.tsx:3768) | Invoke footnote sync (heed #3); build merged `footnoteCards` memo (gate on `rev.footnotes`+refs); thread into panel/omni call sites; add policy archive-suppress wiring (#2). |
| [FootnotePanel.tsx](src/panels/Footnotes/FootnotePanel.tsx:21) | Add `CardViewModeMenuItems kind="footnotes"` + resolved `getArchived`; extend the item union with an archived member. |
| [omni.tsx](src/panels/Footnotes/omni.tsx) | Skip archived footnotes in the in-doc surface. |
| [inline-atom-lifecycle-policy.ts](src/links/_shared/inline-atom-lifecycle-policy.ts:166) | **(MISSED by original design)** add archive-suppression so flag-ON archiving doesn't mint an orphan. |
| FootnoteCard.tsx | Likely no change for the button; optional archived/unanchored badge + jump-off when no live pos. |

## Repro & tests
- **Repro:** in `doc_devtest` (annotation-history has footnotes), expand a footnote card → no archive glyph (only trash), and the 3-dot menu has no "View Active/Archives/All" (Citations does). That's the gap.
- **Tests:** `setArchived` sets both flags + `syncFromEditor([])` keeps archived / drops non-archived absent; re-anchor clears `unanchored` (no dup); `isArchivable('footnote')===true`; archiving removes from Active / surfaces in Archives with body intact + not jumpable; **orphan coexistence under BOTH flag states** (the #2 collision); keystroke-sanctity guard on the merged memo.
