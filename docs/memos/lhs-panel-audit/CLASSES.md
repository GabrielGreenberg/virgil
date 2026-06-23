# LHS Panel Audit — Defect Classes

The fix-sweep roll-up. **152 real bugs collapse into 28 defect classes.** Each class shares one root mechanism and one canonical fix locus — fixing at the locus resolves most/all members. Ordered by impact (max severity, then member count).

Severity totals: DATA-LOSS 6 · HIGH 13 · MEDIUM 56 · LOW 67 · COSMETIC 10.

---

## C1. Mutable / natural-key identity used as a join, selection, or float key
**15 bugs · max DATA-LOSS · 1 DATA-LOSS · 2 HIGH · 4 MEDIUM · 8 LOW**

- **Unifying root cause:** An entity is keyed by a value the user can change (bib citekey) or that the editor regenerates on re-parse (citation/atom id). Renames don't cascade to sidecars keyed on the old value; selection/float/occurrence state strands on the stale key.
- **Canonical fix locus:** src/hooks/useCitations.ts:281-315 updateBibKeyAndType (single rename chokepoint — extend to migrate every per-citekey sidecar) + a stable surrogate id on CitationRef/atoms so selection/float keys survive re-parse.
- **Blast radius:** Touches annotations.json, bib-review-requests.json, keyOccurrenceIdx, poppedOutCards / cardPopKey, omni item ids — every per-key sidecar and the inline-atom spine.
- **Members:** BIB-A2-01 [DATA-LOSS], BIB-A2-03 [HIGH], BIB-A2-04 [HIGH], BIB-A2-02 [MEDIUM], BIB-A3-01 [MEDIUM], OMNI-F3-02 [MEDIUM], OUT-A2-01 [MEDIUM], BIB-F2-01 [LOW], BIB-F3-02 [LOW], BIB-F7-02 [LOW], CI-A3-01 [LOW], OMNI-A1-01 [LOW], OMNI-F8-02 [LOW], OMNI-F8-03 [LOW], SR-F3-04 [LOW]

## C2. Edit a structured node via flattened plain-text input, committed with delete+insertText
**6 bugs · max DATA-LOSS · 1 DATA-LOSS · 2 MEDIUM · 3 LOW**

- **Unifying root cause:** Inline editing of a heading/title seeds a plain-text input from a flattened projection (dropping \citet, math, bold) and commits with delete+insertText instead of an attr-preserving setNodeMarkup — atoms in the heading are destroyed; index-based block addressing omits node-type asserts.
- **Canonical fix locus:** src/components/editor-layout/card-actions/editor-ops.ts handleRenameHeading/handleRenameParTitle:130-171 — edit attrs in place, never reflatten. OUT-F5-01 is DATA-LOSS.
- **Blast radius:** Outline rename (heading + parTitle) and all index-addressed structural mutators in editor-ops.ts.
- **Members:** OUT-F5-01 [DATA-LOSS], OUT-F5-04 [MEDIUM], OUT-F8-03 [MEDIUM], OUT-F5-02 [LOW], OUT-F5-03 [LOW], OUT-F8-04 [LOW]

## C3. Shell-level / volatile-only React state with no sidecar (loss on reload, no docId reset)
**5 bugs · max DATA-LOSS · 1 DATA-LOSS · 2 MEDIUM · 2 LOW**

- **Unifying root cause:** Recovery/transient collections (orphanedFootnotes) and editable card bodies live in EditorLayout/component state above the DocPipeline key boundary with no sidecar and no docId-reset effect, so they vanish on reload and can bleed across documents.
- **Canonical fix locus:** Persist to a per-doc sidecar (or lower the state under the DocPipeline key with a docId-reset effect) — orphanedFootnotes is the DATA-LOSS instance.
- **Blast radius:** Footnote recovery, example sidecar hooks, any rescued-from-deletion editable card.
- **Members:** FN-A2-01 [DATA-LOSS], EX-F5-01 [MEDIUM], FN-A2-03 [MEDIUM], EX-F7-01 [LOW], FN-F5-02 [LOW]

## C4. Uncontrolled contentEditable: unsanitized HTML, mirrored-surface seed, null-coerce write-back
**5 bugs · max DATA-LOSS · 1 DATA-LOSS · 2 HIGH · 2 LOW**

- **Unifying root cause:** Rich-text/annotation editors load persisted or AI-authored HTML without DOMPurify, seed-once from props while two instances (docked + float) drift, and a debounced writer reads a possibly-null ref coercing null→empty content.
- **Canonical fix locus:** The shared annotation/contentEditable field component (BibEntryCard annotations + ExampleCard editor) — sanitize on load, drive from a single controlled source, null-guard the debounced commit.
- **Blast radius:** BIB-F5-01 is an XSS sink; BIB-F8-01 is DATA-LOSS (annotation blanked); affects every contentEditable card body.
- **Members:** BIB-F8-01 [DATA-LOSS], BIB-F5-01 [HIGH], BIB-F8-02 [HIGH], EX-F5-03 [LOW], EX-F8-02 [LOW]

## C5. User content living outside the body JSON dropped on delete / re-anchor
**4 bugs · max DATA-LOSS · 1 DATA-LOSS · 2 MEDIUM · 1 LOW**

- **Unifying root cause:** An EditableCard carries user content outside its body JSON (report.title plus its plain-text mirror), which the delete/has-content/re-anchor paths don't account for — a titled-but-empty-body report deletes with no confirm and loses the title; Mode-B re-anchor adapters omit preserveModeBAnchor.
- **Canonical fix locus:** src/cards/has-content.ts cardHasContent (count title) + the EditableCard delete path + the Mode-B drop adapters. REP-F7-01 is DATA-LOSS.
- **Blast radius:** Reports primarily; any EditableCard with out-of-body user fields.
- **Members:** REP-F7-01 [DATA-LOSS], REP-A1-01 [MEDIUM], REP-A2-01 [MEDIUM], REP-F7-03 [LOW]

## C6. Export-via-raw vs persist-via-serializer drop (empty-raw / filter(Boolean) silent loss)
**3 bugs · max DATA-LOSS · 1 DATA-LOSS · 1 MEDIUM · 1 LOW**

- **Unifying root cause:** Consumers read entry.raw and skip the fields fallback, or run a seen-set/.filter(Boolean) that silently drops entries with raw==''; a library entry saved under a new citekey ships an empty BibTeX block on export.
- **Canonical fix locus:** src/hooks/useCitations.ts / the bib serializer — make every raw consumer fall back to serialize(fields) and drop the filter(Boolean) skips.
- **Blast radius:** 'Copy BibTeX' / 'Export all' paths; duplicate-citekey collisions.
- **Members:** BIB-F7-01 [DATA-LOSS], BIB-F8-04 [MEDIUM], BIB-F1-04 [LOW]

## C7. Missing or unwired UI surface / callback / data prop
**17 bugs · max HIGH · 1 HIGH · 9 MEDIUM · 7 LOW**

- **Unifying root cause:** A producing surface advertises an action whose host callback was never wired (drop callbacks, onCitationCreated, onEditorFocus), a spec'd preview is never built, or a host mount passes no data for a supported slice — the affordance is inert or absent.
- **Canonical fix locus:** The panel host mounts (EditorPane / *PanelHost) — thread the missing callback/data prop; build the missing surface. CI-A2-01 (host-unwired drop) is the HIGH instance.
- **Blast radius:** Crosses citations, bibliography, reports, search, omni, examples, footnotes — a host-wiring audit fixes the family.
- **Members:** CI-A2-01 [HIGH], BIB-F1-01 [MEDIUM], FN-F5-01 [MEDIUM], OMNI-F4-01 [MEDIUM], REP-C1-01 [MEDIUM], REP-F4-01 [MEDIUM], REP-F5-02 [MEDIUM], SR-A1-01 [MEDIUM], SR-F3-02 [MEDIUM], SR-F7-01 [MEDIUM], BIB-F1-02 [LOW], BIB-F7-03 [LOW], EX-F3-03 [LOW], EX-F4-02 [LOW], FN-F7-01 [LOW], OMNI-F2-01 [LOW], OMNI-F5-01 [LOW]

## C8. Lossy kind-change morph drops the aiRequest flag without unbridging the inbox
**8 bugs · max HIGH · 1 HIGH · 5 MEDIUM · 2 LOW**

- **Unifying root cause:** A kind-changing morph (report-request→report, note↔highlight, revision/cutter comment→suggestion) drops the source kind's aiRequest flag but never clears the matching pending entry in ai-requests.json, so a phantom open request lingers; deletes have the symmetric leak.
- **Canonical fix locus:** The morph dispatcher (src/cards/morphs/index) + the panel delete hooks — bridge-clear the inbox entry in the morph/delete path, not on a toggle.
- **Blast radius:** All four morph pairs and every aiRequest-bearing panel delete (notes/todos/cutter/revisions/reports).
- **Members:** REP-F5-01 [HIGH], OMNI-F6-01 [MEDIUM], REP-F6-01 [MEDIUM], REP-F6-02 [MEDIUM], REP-F7-02 [MEDIUM], REP-F8-01 [MEDIUM], OMNI-F6-02 [LOW], REP-F6-03 [LOW]

## C9. PM positions frozen in a debounced/getJSON snapshot consumed by a counter-gated render
**5 bugs · max HIGH · 1 HIGH · 2 MEDIUM · 1 LOW · 1 COSMETIC**

- **Unifying root cause:** A panel caches absolute ProseMirror offsets (or reads the 1.5s-debounced latestDoc) into a memo gated on editor identity + a structural counter, so positions go stale/empty on edits that don't bump the counter (typing earlier in the doc shifts later offsets).
- **Canonical fix locus:** Resolve live positions at measure time via getBus(editor).structure / useInTextPositions instead of replaying stored from/to; source structure from the live editor not latestDoc.
- **Blast radius:** Search highlight/jump, Outline structure, Omni fold decisions — the keystroke-sanctity position-staleness family.
- **Members:** SR-F1-01 [HIGH], OUT-F2-01 [MEDIUM], OUT-F8-02 [MEDIUM], OMNI-F1-02 [LOW], OUT-F7-01 [COSMETIC]

## C10. Descendants-only traversal blind spot for nested inline atoms
**5 bugs · max HIGH · 2 HIGH · 3 LOW**

- **Unifying root cause:** resolveLink / findInlineAtomPos / collectAnchorEls / extractText walk only direct descendants, so an atom (\cite, \ref, math) nested inside a footnote or heading is missed — mis-anchored, dropped from a flatten, or given a dead jump arrow.
- **Canonical fix locus:** The shared atom-position resolver (src/links/links.ts findInlineAtomPos + OutlinePanel.extractText) — make traversal fully recursive / descendInto footnote+heading subtrees.
- **Blast radius:** Bibliography + Citations jump arrows, Outline title flatten, Search indexing — every consumer of the shared resolver.
- **Members:** BIB-F3-01 [HIGH], CI-F3-01 [HIGH], OUT-F1-01 [LOW], OUT-F4-01 [LOW], SR-F4-01 [LOW]

## C11. Migration-orphan: producer relocated to EditorPane, consumer still reads dead EditorLayout state
**5 bugs · max HIGH · 2 HIGH · 1 MEDIUM · 2 LOW**

- **Unifying root cause:** During the EditorLayout→EditorPane split a feature's producer moved but its consumer kept reading a now-never-updated EditorLayout state (or a teardown effect stranded on the old owner), so the feature is silently inert.
- **Canonical fix locus:** src/components/EditorLayout.tsx / EditorPane.tsx — delete the dead duplicate copy and point the consumer at the live state. SR-F8-01 / SR-F3-01 (search jump dead) are HIGH.
- **Blast radius:** Search panel jump/scope/teardown cluster; audit any state that survived the split in two copies.
- **Members:** SR-F3-01 [HIGH], SR-F8-01 [HIGH], SR-C1-02 [MEDIUM], SR-F3-03 [LOW], SR-F8-02 [LOW]

## C12. Auto-title shape-detection false positive (strips a real user title on load)
**4 bugs · max HIGH · 1 HIGH · 2 MEDIUM · 1 LOW**

- **Unifying root cause:** isAutoTitle matches the '<Label> N' shape and strips it on load, so a user who legitimately types 'Report 8' / 'Note 3' loses their title after reload — five load-strip sites share the identical false positive.
- **Canonical fix locus:** src/cards/.../isAutoTitle (and the 5 callers: useReports.ts:57, useArchive.ts:28, useTodos, useNotes, useExamples) — distinguish a generated title (track a wasAutoGenerated flag) from a shape-matching user title.
- **Blast radius:** Reports (HIGH), notes, archive, todos, examples — every auto-titling kind.
- **Members:** REP-A2-02 [HIGH], OMNI-F1-01 [MEDIUM], REP-F5-03 [MEDIUM], EX-A2-01 [LOW]

## C13. Multi-anchor @N omni grammar honored in the prefix matcher but broken at the jump
**2 bugs · max HIGH · 1 HIGH · 1 MEDIUM**

- **Unifying root cause:** An omni builder emits per-anchor @N rows but the @N grammar is honored only in open-for-card.ts's prefix matcher and broken in the exact-match pin/align sites, and the per-anchor row jumps via card-level jumpToCard (wrong anchor / wrong row).
- **Canonical fix locus:** open-for-card.ts exact-match sites + the omni jump handler — carry the anchor index through to the jump.
- **Blast radius:** Reports (clearest fan-out, HIGH) and any multi-anchor card kind.
- **Members:** REP-F3-01 [HIGH], OMNI-F3-01 [MEDIUM]

## C14. Inline-atom prune-exemption leaves a dangling cardStore / float ref after delete
**10 bugs · max MEDIUM · 3 MEDIUM · 7 LOW**

- **Unifying root cause:** isInlineAtomCardKind exempts footnote+citation from the dangling-ref pruner (so a transient parse-gap won't drop a valid selection), but a genuine hard-delete then leaves a dangling cardStore selection / poppedOutCards float keyed to a dead id, with id-reuse mis-pointing risk.
- **Canonical fix locus:** src/cards/predicates.ts isInlineAtomCardKind exemption + the poppedOutCards pruner — distinguish transient parse-gap from a real delete (re-resolve once on the next structural tx).
- **Blast radius:** Footnotes + citations + examples; cardStore selection and all card-float popout keys.
- **Members:** CI-F8-01 [MEDIUM], FN-F8-01 [MEDIUM], OMNI-F8-01 [MEDIUM], CI-F2-02 [LOW], CI-F7-03 [LOW], CI-F8-02 [LOW], EX-F8-01 [LOW], FN-A1-01 [LOW], FN-F3-01 [LOW], OMNI-F7-02 [LOW]

## C15. Select/jump composition: monotonic store-select paired with a toggling onSelect, or skip-jump
**10 bugs · max MEDIUM · 4 MEDIUM · 6 LOW**

- **Unifying root cause:** A card body onClick pairs a monotonic store select (ac.onActivate) with a TOGGLE-style panel-local onSelect and/or skips the jump, so the selection halo double-sources (`ac.selected || isSelected`) or a click fails to navigate; manual selectedIdx holders skip useCycle's read-clamp.
- **Canonical fix locus:** The shared card body onClick / panel select wiring (FootnotePanel select handler) + route index holders through useCycle.
- **Blast radius:** Footnotes, citations, examples, search, outline — the docked-card select family.
- **Members:** CI-F2-01 [MEDIUM], EX-F2-01 [MEDIUM], FN-F2-01 [MEDIUM], SR-F1-02 [MEDIUM], EX-F2-02 [LOW], EX-F3-02 [LOW], OUT-F3-02 [LOW], SR-C1-01 [LOW], SR-F2-01 [LOW], SR-F5-01 [LOW]

## C16. Plural/biblatex command toggle one-way; merge-vs-replace field updater ambiguity
**8 bugs · max MEDIUM · 6 MEDIUM · 2 LOW**

- **Unifying root cause:** A state mutation lacks its symmetric inverse (HAS_PLURAL singular↔plural strands the plural arg on the reverse toggle), or one field-merge primitive (updateBibEntry) serves both 'edit some' and 'replace entirely' so deletions aren't honored; per-card derived display state isn't reconciled when bibPackage changes.
- **Canonical fix locus:** src/panels/Citations/CitationCard.tsx command toggle (round-trip the plural arg) + split updateBibEntry into merge vs replace.
- **Blast radius:** Every HAS_PLURAL command (cite/textcite/parencite/autocite/footcite/smartcite); bib edit surface.
- **Members:** BIB-A3-02 [MEDIUM], BIB-F5-04 [MEDIUM], CI-F5-01 [MEDIUM], CI-F5-02 [MEDIUM], CI-F7-01 [MEDIUM], CI-F7-02 [MEDIUM], BIB-F5-05 [LOW], CI-F5-03 [LOW]

## C17. Mount-only / counter-gated sidecar resync not driven by the structural diff
**5 bugs · max MEDIUM · 5 MEDIUM**

- **Unifying root cause:** Id-bearing sidecars sync from the editor once at mount (or on a too-narrow event), so out-of-band sidecar writes and id-regen-under-reparse leave the card list stale until a remount.
- **Canonical fix locus:** src/components/EditorPane.tsx syncFromEditor wiring (drive resync off the DocStructureBus structural counters, not editor mount).
- **Blast radius:** Citations + bibliography + search-position memos; any id-bearing sidecar hook.
- **Members:** BIB-F5-02 [MEDIUM], CI-A1-01 [MEDIUM], CI-A2-02 [MEDIUM], CI-F8-03 [MEDIUM], SR-A2-01 [MEDIUM]

## C18. Destructive delete skips confirm; unguarded clipboard; layout/glyph constants
**5 bugs · max MEDIUM · 2 MEDIUM · 2 LOW · 1 COSMETIC**

- **Unifying root cause:** A doc-mutating delete skips the confirm because cardHasContent has no case for the kind, navigator.clipboard is called unguarded, and hardcoded layout offsets/badge glyphs sit between independently-sized siblings.
- **Canonical fix locus:** cardHasContent kind coverage + a clipboard guard wrapper + the omni layout constants.
- **Blast radius:** Omni deletes/copy, footnote constant glyph — mostly LOW/COSMETIC.
- **Members:** OMNI-C2-01 [MEDIUM], OMNI-F7-01 [MEDIUM], OMNI-C2-02 [LOW], OMNI-F8-04 [LOW], FN-F1-04 [COSMETIC]

## C19. Anchor-state derived from position resolution alone, ignoring the card's intent flag
**4 bugs · max MEDIUM · 1 MEDIUM · 3 LOW**

- **Unifying root cause:** Builders compute `pos==null ? 'orphaned' : 'anchored'` and never read the card's own unanchored/free flag, so an intentionally-unanchored panel-created citation collapses into the orphaned/error bin alongside a true lost-marker.
- **Canonical fix locus:** src/panels/Citations/omni.tsx:49 buildCitationOmniItems (and the example builder) — `pos==null ? (cit.unanchored ? 'free' : 'orphaned') : 'anchored'`.
- **Blast radius:** Citations + Examples omni builders; the only intrinsically-in-text kind with a panel-created unanchored mode.
- **Members:** EX-F3-01 [MEDIUM], CI-A1-02 [LOW], EX-A1-01 [LOW], OMNI-A2-01 [LOW]

## C20. Cross-side activation / omni per-side clear gaps; has-content non-body fields
**3 bugs · max MEDIUM · 1 MEDIUM · 2 LOW**

- **Unifying root cause:** A cross-panel 'open item' side-activates a target without checking the originating panel shares that side, an omni per-side setter doesn't fully cross-clear, and has-content predicates ignore non-body fields.
- **Canonical fix locus:** The omni per-side setter + the cross-panel open handler — cross-clear and check side parity.
- **Blast radius:** Examples cross-side jump, omni right-column kinds.
- **Members:** EX-F5-02 [MEDIUM], EX-F4-01 [LOW], FN-A1-02 [LOW]

## C21. Recovery record reconstructed from an attr subset; sync-insert+deferred-remove without de-dup
**2 bugs · max MEDIUM · 1 MEDIUM · 1 LOW**

- **Unifying root cause:** A teardown→recovery record is rebuilt from only a subset of the source node's attrs (any new per-footnote attr is silently lost on recovery), and a synchronous-insert + deferred-remove seam renders an id-keyed list with no de-dup during the transient overlap.
- **Canonical fix locus:** src/lib/tiptap/footnote.ts:202 recovery snapshot — clone the full attr set; de-dup the transient list.
- **Blast radius:** Footnote recovery/teardown; any future per-footnote attr.
- **Members:** FN-A2-02 [MEDIUM], FN-A3-01 [LOW]

## C22. First-match read over an append-only request log without clear/dedup
**1 bugs · max MEDIUM · 1 MEDIUM**

- **Unifying root cause:** A per-kind request reader does a first-match .find over an append-only log that's never cleared/deduped, so it reads a stale earlier record instead of the latest matching one.
- **Canonical fix locus:** src/hooks/useBibReview.ts (and any per-kind inbox reader) — read the latest, or clear/dedup on resolve.
- **Blast radius:** Bib-review request log; any append-only inbox keyed by a repeated field.
- **Members:** BIB-F8-03 [MEDIUM]

## C23. A numbering rule implemented twice that diverges on the \thanks edge
**1 bugs · max MEDIUM · 1 MEDIUM**

- **Unifying root cause:** Footnote numbering exists in two places — parser numberFootnotes and the canonical appendTransaction renumber — that disagree on \thanks (parser counts it, canonical sets it to 0), so a paper with a \thanks shows every real footnote off-by-one until the first structural footnote op.
- **Canonical fix locus:** src/lib/latex-parser.ts:787-799 numberFootnotes — make it skip \thanks to match src/lib/tiptap/footnote.ts:235-243.
- **Blast radius:** Any paper with \thanks + footnotes (incl. the frozen showcase sample); FN-F1-01 reclassified MEDIUM.
- **Members:** FN-F1-01 [MEDIUM]

## C24. Compressed-summary clamp gap (unclamped header text / empty-blank / per-card editor)
**7 bugs · max LOW · 1 LOW · 6 COSMETIC**

- **Unifying root cause:** Card headers derive a one-line summary from arbitrary user/.bib/borrowed-body text without the shared compressed-state clamp (bespoke chrome bypasses EditableCard), or render an empty blank via `'' ?? <CardEmptyText/>` (nullish never fires on empty string).
- **Canonical fix locus:** The shared EditableCard compressed-body clamp + makeCompressedSummary — route bespoke card chrome through it and use `|| ''` over `?? ''`.
- **Blast radius:** Bibliography, citations, examples, reports, omni borrowed-body kinds — all COSMETIC/LOW.
- **Members:** REP-F5-04 [LOW], BIB-F1-03 [COSMETIC], CI-F1-01 [COSMETIC], EX-F1-01 [COSMETIC], EX-F1-02 [COSMETIC], OMNI-F1-03 [COSMETIC], REP-F1-01 [COSMETIC]

## C25. Header / strip count derived from a subset (or raw array length) of the rendered list
**5 bugs · max LOW · 4 LOW · 1 COSMETIC**

- **Unifying root cause:** A panel header count is computed from one sub-list (anchored only) while the panel renders the union (anchored + orphan/pending-AI), or reports raw card-array length — the badge disagrees with what's visible.
- **Canonical fix locus:** The card panel header count prop (FootnotePanel.tsx:132 etc.) — count the union actually rendered; the raw-length cases (CI-C1-01) are reclassified COSMETIC / by-design.
- **Blast radius:** Footnotes + citations + bibliography count badges.
- **Members:** BIB-A1-01 [LOW], FN-C1-01 [LOW], FN-F1-03 [LOW], FN-F2-02 [LOW], CI-C1-01 [COSMETIC]

## C26. Word-boundary \b regex assuming word-char-bounded tokens
**4 bugs · max LOW · 3 LOW · 1 COSMETIC**

- **Unifying root cause:** A whole-word matcher prepends/appends \b without an adjacency guard, so citekeys/queries containing non-word chars (`:`, `-`) mis-match or fail to rewrite; snippet renderers clamp context but not the matched span.
- **Canonical fix locus:** The shared cite-rewrite + search whole-word regex builder — use an explicit boundary class, not bare \b.
- **Blast radius:** Bib citekey rewrite + Search whole-word + any \b-wrapping matcher; all LOW/COSMETIC.
- **Members:** BIB-F7-04 [LOW], SR-F1-03 [LOW], SR-F1-04 [LOW], SR-F1-05 [COSMETIC]

## C27. Focus-mode boundary index math mixing snapshot edges; null card-float fallbacks
**2 bugs · max LOW · 2 LOW**

- **Unifying root cause:** A boundary op rounds one edge through sectionRange and passes the other as a raw index (off-by-one at the seam), and derived card-float bodies return null for an orphan they can't represent.
- **Canonical fix locus:** src/hooks/useFocusMode.ts nudgeBoundary (round both edges) + the card-float null-return sites.
- **Blast radius:** Outline focus-mode boundary; example/footnote/citation card floats.
- **Members:** EX-A1-02 [LOW], OUT-F3-01 [LOW]

## C28. Outside-click / mousedown menu race (trigger excluded from the close-ref)
**1 bugs · max LOW · 1 LOW**

- **Unifying root cause:** A menu's outside-click ref excludes its own toggling trigger and the close fires on mousedown while the toggle fires on click, so clicking the trigger to close immediately reopens (or vice-versa).
- **Canonical fix locus:** The shared menu outside-click hook — include the trigger in the ref or unify on one event.
- **Blast radius:** Bibliography menu; any panel whose menu trigger lives outside the close-ref.
- **Members:** BIB-C1-01 [LOW]
