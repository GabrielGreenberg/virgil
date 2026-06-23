# LHS Panel Audit — BUGLIST

Fix-oriented bug list from the 8-subject × 13-cluster LHS-panel QA audit. **152 real bugs** (CONFIRMED or RECLASSIFIED, after applying `adjudications.json` overrides to the 9 SPLIT items) across **28 defect classes**; 14 findings refuted / by-design (bottom section).

Severity: **DATA-LOSS 6 · HIGH 13 · MEDIUM 56 · LOW 67 · COSMETIC 10**. Evidence file:line lives in `raw/*.json`; per-class fix loci in `CLASSES.md`.

---

## Severity index — DATA-LOSS then HIGH (scan first)

### DATA-LOSS (6)

- **BIB-A2-01** · bibliography A2 — Renaming a bibliography entry's citekey silently strands its annotation
- **BIB-F7-01** · bibliography F7 — Exporting cited.bib silently omits any cited entry that was added during
- **BIB-F8-01** · bibliography F8 — Typing a bibliography annotation and then collapsing/closing the card (or switching
- **FN-A2-01** · footnotes A2 — An orphaned footnote (marker deleted in-text, content recoverable in the panel)
- **OUT-F5-01** · outline F5 — Renaming a heading from the outline edit-mode pod replaces the entire
- **REP-F7-01** · reports F7 — Deleting a Report that has a title but an empty body

### HIGH (13)

- **BIB-A2-03** · bibliography A2 — Renaming the citekey of the currently-selected entry loses selection
- **BIB-A2-04** · bibliography A2 — A popped-out bib float silently goes blank (or vanishes) when its
- **BIB-F3-01** · bibliography F3 — Clicking the jump-to-citation target on a bibliography entry that is cited
- **BIB-F5-01** · bibliography F5 — A bibliography annotation containing HTML (e.g. <img src=x onerror=...>, <svg onload=...>
- **BIB-F8-02** · bibliography F8 — When the same bib entry is open both docked and as
- **CI-A2-01** · citations A2 — Dragging an unanchored citation card into the editor does nothing
- **CI-F3-01** · citations F3 — Clicking jump (or the card body) on a citation that lives
- **REP-A2-02** · reports A2 — A user who titles a report exactly 'Report 8' (or 'Report
- **REP-F3-01** · reports F3 — For a report anchored to two or more paragraphs, the Omni
- **REP-F5-01** · reports F5 — Morphing a Report Request that has its 'AI request' flag on
- **SR-F1-01** · search F1 — After running a search and then editing the document (typing/deleting in
- **SR-F3-01** · search F3 — Clicking a search result never scrolls or highlights the matched text
- **SR-F8-01** · search F8 — Clicking a search result does not highlight the matched text in

---

## Bugs by defect class

_Classes ordered by (max severity, then member count). Entry = Symptom · Root cause (deepest mechanism, file:line) · Repro · Status · Confidence. Severity is final (post-adjudication)._

## C1. Mutable / natural-key identity used as a join, selection, or float key
*15 bugs · max severity DATA-LOSS.* An entity is keyed by a value the user can change (bib citekey) or that the editor regenerates on re-parse (citation/atom id). Renames don't cascade to sidecars keyed on the old value; selection/float/occurrence state strands on the stale key.
**Fix locus:** src/hooks/useCitations.ts:281-315 updateBibKeyAndType (single rename chokepoint — extend to migrate every per-citekey sidecar) + a stable surrogate id on CitationRef/atoms so selection/float keys survive re-parse.

### [DATA-LOSS] BIB-A2-01 — bibliography·A2
- **Symptom:** Renaming a bibliography entry's citekey silently strands its annotation — the renamed entry shows a blank Annotations pod and the user's annotation prose dis...
- **Root cause:** updateBibKeyAndType (src/hooks/useCitations.ts:281-315) is the single rename chokepoint and migrates exactly two stores (bibEntries fields/raw + citationsHook citation refs).
- **Repro:** Open a bib entry, expand Annotations, type and save an annotation → Expand BibTeX Fields → Edit entry, change the key, Save
- **Status:** CONFIRMED · conf high

### [HIGH] BIB-A2-03 — bibliography·A2
- **Symptom:** Renaming the citekey of the currently-selected entry loses selection — the just-edited card collapses out from under the user instead of staying open and sel...
- **Root cause:** Selection is keyed off a mutable citekey (selectedBibKey === e.key, BibliographyPanel.tsx:294-297) and commitEditBib has no post-rename onSelect(newKey) call (BibEntryCard.tsx:185-192)
- **Repro:** Select a bib entry (it expands) → Edit its citekey and Save
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [HIGH] BIB-A2-04 — bibliography·A2
- **Symptom:** A popped-out bib float silently goes blank (or vanishes) when its citekey is renamed, and the dead float key persists in localStorage with no UI to dismiss it.
- **Root cause:** Float keys embed the registry id (float:card:bib:<citekey>) and the only key-remap hook (remapCardPopKey, EditorLayout.tsx:879-884) is wired solely to convertCardWithRemap's morph paths; updateBibKeyAndType (useCitations.ts:281-315)…
- **Repro:** Pop a bib card out into a float (lift the header) → In the docked card (or any surface) rename that entry's citekey and Save
- **Status:** CONFIRMED · **RECLASSIFIED** · conf medium

### [MEDIUM] BIB-A2-02 — bibliography·A2
- **Symptom:** A pending AI bib-review request orphans when the user renames the entry's citekey mid-flight — the responder keys off the old citekey and the renamed card sh...
- **Root cause:** Same chokepoint gap as BIB-A2-01: updateBibKeyAndType (src/hooks/useCitations.ts:299-312) only iterates prev.citations, never the bib-review request log keyed by bibKey (src/hooks/useBibReview.ts:70-77).
- **Repro:** Click 'Request review' on an entry's BibTeX Fields (status → pending, pulsing) → Edit the entry and rename its citekey, Save
- **Status:** CONFIRMED · conf high

### [MEDIUM] BIB-A3-01 — bibliography·A3
- **Symptom:** When a .bib file contains two distinct entries that share a citekey, only the first is shown and editable; the second is invisible in the panel and is silent...
- **Root cause:** Citekey-as-unique-identity assumption pervades the bib subsystem: panel seen-set dedup (BibliographyPanel.tsx:219-235,350-355), parse-time raw collision (bib-parser.ts:874, last-write-wins on a citekey-keyed object), and bibEntryMap = new…
- **Repro:** Create a references.bib with two different @article entries that share a citekey (e.g. from two sources) → Open the Bibliography panel: only the first appears
- **Status:** CONFIRMED · conf high

### [MEDIUM] OMNI-F3-02 — omni-left·F3
- **Symptom:** After a full document re-parse from a .tex that lacks the \vcid/\vfid stable-id markers (legacy file, external edit, or a code-view round-trip on a markerles...
- **Root cause:** The concrete trigger the finder only hypothesized: code-pane-bridge.ts:202 editor.commands.setContent(parseLatex(text)) re-parses into the existing editor WITHOUT remounting, so the mount-gated syncFromEditor (EditorPane.tsx:1177-1182)…
- **Repro:** Open a legacy .tex with \cite{}/\footnote{} but no \vcid/\vfid markers (or simulate a markerless external edit) → Confirm parseInlineContent assigns generateShortId() ids (latex-parser.ts:481/509)
- **Status:** CONFIRMED · **RECLASSIFIED** · conf medium

### [MEDIUM] OUT-A2-01 — outline·A2
- **Symptom:** Collapse/fold state in the outline jumps to the wrong sections after a block is inserted or removed above a collapsed heading (same session, on the next stru...
- **Root cause:** Confirmed as finder stated
- **Repro:** Open a doc with sections A, B, C. Collapse section B in the outline → Place the cursor above B and insert a new top-level paragraph (or heading), shifting B's block index by 1
- **Status:** CONFIRMED · conf high

### [LOW] BIB-F2-01 — bibliography·F2
- **Symptom:** Editing a bib entry's citekey in the BibTeX-fields editor and saving drops the entry's selection halo (the card you just edited is no longer highlighted/expa...
- **Root cause:** Selection keyed by a mutable natural key (citekey) rather than a stable id: commitEditBib mutates the key without re-pointing selectedBibKey (BibEntryCard.tsx:185-192)
- **Repro:** Select a bib entry (card expands, halo on) → Expand BibTeX Fields → Edit entry → change the key field → Save
- **Status:** CONFIRMED · conf high

### [LOW] BIB-F3-02 — bibliography·F3
- **Symptom:** The occurrence counter on a multiply-cited bib entry can read past its total (e.g. shows '3/2'), and the prev/next occurrence arrows + jump target lag a stal...
- **Root cause:** Per-citekey index stored in component state (keyOccurrenceIdx) is never reconciled against the live citation-id list when allEditorCitations changes — there is no clamp at read time (BibliographyPanel.tsx:910) nor a reconcile effect.
- **Repro:** Cite the same key 3 times; select its bib card; cycle the occurrence counter to 3/3 → Delete one of those \cite occurrences in the editor so the key now has 2 occurrences
- **Status:** CONFIRMED · **RECLASSIFIED** (MEDIUM→LOW) · conf medium

### [LOW] BIB-F7-02 — bibliography·F7
- **Symptom:** When a .bib file contains two genuinely distinct entries that happen to share a citekey, exporting cited.bib silently writes only the first and drops the sec...
- **Root cause:** Citekey collisions are resolved by last-wins overwrite at the parser (extractRawEntries, bib-parser.ts:874) — both parsed entries share the last block's raw — so the data is already mangled upstream of the export/display dedup.
- **Repro:** Hand-edit (or import) a references.bib with two different @article blocks that share a citekey → Cite that key; both are 'cited'
- **Status:** CONFIRMED · **RECLASSIFIED** (MEDIUM→LOW) · conf medium

### [LOW] CI-A3-01 — citations·A3
- **Symptom:** A citation cloned via cloneCitation without a corresponding new \cite atom is silently discarded on the next reload.
- **Root cause:** cloneCitation does not mark the clone unanchored:true, relying on its caller to also create the in-doc atom — a fragile contract
- **Repro:** Call cloneCitation(sourceId) without inserting a corresponding \cite atom (not reachable via current UI; reachable if a standalone duplicate-card action is added) → Reload the doc
- **Status:** CONFIRMED · conf high

### [LOW] OMNI-A1-01 — omni-left·A1
- **Symptom:** An orphaned footnote card selected/hovered in one surface does not show its selection/hover halo in another surface (e.g. a popped-out float of the same orph...
- **Root cause:** Same omission (orphan render path drops data-card-key, FootnoteCard.tsx:237), but the popout half of the repro is structurally impossible because the same missing cardKey disables the lift gesture (panel-primitives.tsx:1775) — so impact is…
- **Repro:** Create an orphaned footnote (a \footnote{} whose callout was deleted) so it appears in the omni unanchored bin → Pop the orphan out to a float (or open a second Footnotes surface)
- **Status:** CONFIRMED · conf high

### [LOW] OMNI-F8-02 — omni-left·F8
- **Symptom:** Clicking the in-text gutter marker of a Report anchored to MULTIPLE paragraphs selects/opens the card but never pin-aligns it to the click — the card jumps t...
- **Root cause:** Wrapper id (suffixed @i, OmniViewPanel.tsx:553 from Reports/omni.tsx:87) diverges from the canonical cardPopKey the marker/jump path reconstructs (marker-clicks.ts:130; EditorLayout.tsx:1127,1162); the marker event also carries no anchor…
- **Repro:** Create a Report linked to two paragraphs (two paragraph anchors → omni rows ...@0 and ...@1) → Click the report's gutter marker on either anchored paragraph
- **Status:** CONFIRMED · **RECLASSIFIED** (MEDIUM→LOW) · conf high

### [LOW] OMNI-F8-03 — omni-left·F8
- **Symptom:** After morphing a popped/pinned Report to a Report-Request (or back), a stale omni pin can linger keyed to the old kind until a different card is clicked.
- **Root cause:** Same as finder: omniPinStore keys by the kind-baked float key but is omitted from the morph remap set (EditorPane.tsx:915 remaps only the viewPrefs float key)
- **Repro:** Click a Report omni card so it pins (pin keyed float:card:report:<id>) → Morph it to a Report-Request via the kind chevron
- **Status:** CONFIRMED · **RECLASSIFIED** · conf medium

### [LOW] SR-F3-04 — search·F3
- **Symptom:** After running a search, typing inside a paragraph that precedes a match shifts the real text but the search result keeps its old PM positions, so the (would-...
- **Root cause:** Position cache frozen in a useMemo keyed on stable `editor` identity + structural counters (SearchPanel.tsx:305/363-380) rather than resolved at measure time from a per-transaction-mapped snapshot; plain keystrokes don't bump the gating…
- **Repro:** Search for a word that appears in paragraph 3 → Without changing the query, click into paragraph 1 and type a sentence (plain keystrokes, no structural change)
- **Status:** CONFIRMED · **RECLASSIFIED** (MEDIUM→LOW) · conf high

## C2. Edit a structured node via flattened plain-text input, committed with delete+insertText
*6 bugs · max severity DATA-LOSS.* Inline editing of a heading/title seeds a plain-text input from a flattened projection (dropping \citet, math, bold) and commits with delete+insertText instead of an attr-preserving setNodeMarkup — atoms in the heading are destroyed; index-based block addressing omits node-type asserts.
**Fix locus:** src/components/editor-layout/card-actions/editor-ops.ts handleRenameHeading/handleRenameParTitle:130-171 — edit attrs in place, never reflatten. OUT-F5-01 is DATA-LOSS.

### [DATA-LOSS] OUT-F5-01 — outline·F5
- **Symptom:** Renaming a heading from the outline edit-mode pod replaces the entire heading body with plain text, silently destroying any inline formatting, inline math, c...
- **Root cause:** Truest root cause: handleRenameHeading (src/components/editor-layout/card-actions/editor-ops.ts:132) models the heading as a plain-text container and uses delete-inner + insertText, discarding the existing inline node/mark structure rather…
- **Repro:** Open a paper with a heading like \section{The $G$-action on \citet{foo}} (or a heading with bold/italic) → Open the Outline panel, click Edit to enter edit mode
- **Status:** CONFIRMED · conf high

### [MEDIUM] OUT-F5-04 — outline·F5
- **Symptom:** In the read-only Reader, the Outline panel still shows the Edit button, the Focus button, and the inline label '+'; using them appears to work (input opens,...
- **Root cause:** Affordance visibility gated on callback-presence (truthiness) rather than an explicit editable/read-only flag (OutlinePanel.tsx:676, :1661, :1676, :1755), combined with the Reader shim supplying truthy no-op callbacks to satisfy the…
- **Repro:** Open a paper in Reader (read-only) mode → Open the Outline panel — note the Edit and Focus buttons and, on hover, the label '+'
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [MEDIUM] OUT-F8-03 — outline·F8
- **Symptom:** A user can commit a heading label that duplicates an existing \label{} key in the document — the live 'label already in use' warning shows but does not preve...
- **Root cause:** Confirmed as finder stated
- **Repro:** Have two headings, one already labelled `sec:intro` → Click '+' on the second heading's label row, type `sec:intro` — the live '⚠ label already in use' warning appears
- **Status:** CONFIRMED · conf high

### [LOW] OUT-F5-02 — outline·F5
- **Symptom:** Renaming a paragraph title (parTitle) from the outline can stamp a parTitle attr onto a non-paragraph node if the block index drifted, and unlike heading ren...
- **Root cause:** Same as finder: missing node.type.name guard at editor-ops.ts:165-167 plus integer-blockIndex addressing of a snapshot while mutating the live doc
- **Repro:** Have a doc with paragraph titles in the outline → Trigger a structural edit elsewhere (e.g. delete a block in the split pane) so the live doc shifts but the outline's snapshot lags
- **Status:** CONFIRMED · conf medium

### [LOW] OUT-F5-03 — outline·F5
- **Symptom:** The outline label editor shows a live '⚠ label already in use' warning but still commits the duplicate label when the user presses Enter or blurs, producing...
- **Root cause:** Same as finder: commit() ignores the advisory conflict flag (OutlinePanel.tsx:179) and the downstream handler writes unconditionally (editor-ops.ts:148).
- **Repro:** Have two headings; one already labelled 'sec:intro' → On the other heading click '+' to add a label and type 'sec:intro'
- **Status:** CONFIRMED · conf high

### [LOW] OUT-F8-04 — outline·F8
- **Symptom:** Renaming a paragraph title (parTitle) via the outline can throw / mis-write if the block index it targets has diverged to a heading (e.g. after a concurrent...
- **Root cause:** Real cause: handleRenameParTitle (editor-ops.ts:166-167) omits the `node.type.name === 'heading'`-style guard its sibling mutators carry.
- **Repro:** Trigger an index divergence (concurrent structural edit / undo) so a parTitle pod's blockIndex now resolves to a heading in the live doc → Rename that parTitle pod in outline edit mode
- **Status:** CONFIRMED · **RECLASSIFIED** · conf low

## C3. Shell-level / volatile-only React state with no sidecar (loss on reload, no docId reset)
*5 bugs · max severity DATA-LOSS.* Recovery/transient collections (orphanedFootnotes) and editable card bodies live in EditorLayout/component state above the DocPipeline key boundary with no sidecar and no docId-reset effect, so they vanish on reload and can bleed across documents.
**Fix locus:** Persist to a per-doc sidecar (or lower the state under the DocPipeline key with a docId-reset effect) — orphanedFootnotes is the DATA-LOSS instance.

### [DATA-LOSS] FN-A2-01 — footnotes·A2
- **Symptom:** An orphaned footnote (marker deleted in-text, content recoverable in the panel) vanishes permanently on document reload or doc switch — the recovery affordan...
- **Root cause:** No persistence path for the orphan recovery store at all: orphanedFootnotes lives at the EditorLayout shell (EditorLayout.tsx:1106, outside the `<DocPipeline key={currentDocId}>` per-doc boundary at EditorLayout.tsx:4370) and is never…
- **Repro:** Open a paper with a footnote that has prose content → Delete the footnote's superscript marker in the main text (backspace over it)
- **Status:** CONFIRMED · **RECLASSIFIED** (HIGH→DATA-LOSS) · conf high

### [MEDIUM] EX-F5-01 — examples·F5
- **Symptom:** An example card's title can never be edited or displayed, and the examples.json sidecar (title + createdAt persistence) is never written or read — the entire...
- **Root cause:** Hook-without-a-consumer: the examples sidecar metadata layer (useExamples) was never wired into either render surface; ExampleInfo (Editor.tsx:193-221) carries no title field, and ExampleCard.tsx:387-616 renders no title affordance.
- **Repro:** Open a paper with an \ex/\pex example → Open the Examples panel (or omni) — the example card shows the expex body but no title affordance (no +T, no editable title input)
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [MEDIUM] FN-A2-03 — footnotes·A2
- **Symptom:** Orphaned footnotes from one document persist into a different document's Footnotes panel after switching docs — orphans with footnoteIds that belong to the p...
- **Root cause:** Per-doc state hoisted above the per-doc remount boundary with no docId-keyed reset effect: orphanedFootnotes sits at EditorLayout.tsx:1106 (above `<DocPipeline key={currentDocId}>` at :4370) and no effect clears it on currentDocId change.
- **Repro:** In doc A, orphan a footnote (delete its marker) so an orphan card appears → Switch to doc B (different paper) without reloading
- **Status:** CONFIRMED · conf high

### [LOW] EX-F7-01 — examples·F7
- **Symptom:** The Examples sidecar/lifecycle hook (useExamples) is entirely dead code — example titles, deletes, and auto-title stripping it implements never run, while a...
- **Root cause:** Retained-for-parity persisted-sidecar hook (useExamples.ts) with zero call sites, kept alive by a static source-text guard test (auto-title.test.ts:192-202 readFileSync(...).toContain('isAutoTitle')) rather than any runtime exercise.
- **Repro:** Grep the codebase for `useExamples(` — only the definition matches; no component/host calls it → Inspect ExampleCard — no delete button, no title input, no onDelete prop
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [LOW] FN-F5-02 — footnotes·F5
- **Symptom:** Edits to an orphaned footnote's body or title are kept only in volatile React state and are lost on reload; the orphan card itself also vanishes on reload (o...
- **Root cause:** Editable surface (OrphanedFootnoteCard's RichTextField + CardBodyTitle, FootnoteCard.tsx:220-243) mounted on an item whose only backing store is volatile event-sourced state (orphans.ts:26/35 setOrphanedFootnotes-only; no…
- **Repro:** In a paper, delete a footnote's in-text marker (leaving non-empty body) so it appears as an orphan card in the Footnotes panel → Expand the orphan and edit its body and/or add a title
- **Status:** CONFIRMED · **RECLASSIFIED** (MEDIUM→LOW) · conf high

## C4. Uncontrolled contentEditable: unsanitized HTML, mirrored-surface seed, null-coerce write-back
*5 bugs · max severity DATA-LOSS.* Rich-text/annotation editors load persisted or AI-authored HTML without DOMPurify, seed-once from props while two instances (docked + float) drift, and a debounced writer reads a possibly-null ref coercing null→empty content.
**Fix locus:** The shared annotation/contentEditable field component (BibEntryCard annotations + ExampleCard editor) — sanitize on load, drive from a single controlled source, null-guard the debounced commit.

### [DATA-LOSS] BIB-F8-01 — bibliography·F8
- **Symptom:** Typing a bibliography annotation and then collapsing/closing the card (or switching docs) within ~400ms silently wipes the annotation to empty.
- **Root cause:** No unmount-flush/clear for the debounce timer in AnnotationEditor (src/components/BibEntryCard.tsx:117-123) combined with the null-ref-reads-as-empty pattern at line 120 (editorRef.current?.innerHTML || '') and setAnnotation's…
- **Repro:** Select a bib entry, expand Annotations, type some text → Within ~400ms click another card (deselects → this card collapses, unmounting the editor)
- **Status:** CONFIRMED · conf high

### [HIGH] BIB-F5-01 — bibliography·F5
- **Symptom:** A bibliography annotation containing HTML (e.g. <img src=x onerror=...>, <svg onload=...>, <iframe>) injects live, event-firing DOM into the panel when the c...
- **Root cause:** Unsanitized imperative innerHTML write at src/components/BibEntryCard.tsx:113; the #28 field-row hardening was applied to the JSX field row but not to the sibling contentEditable annotation editor that loads the same class of untrusted…
- **Repro:** Put `<img src=x onerror="window.__pwned=1">` into a bib entry's Annotations field (or have answer-bib-review/a shared annotations.json supply it) → Open the Bibliography card and expand the Annotations pod
- **Status:** CONFIRMED · conf high

### [HIGH] BIB-F8-02 — bibliography·F8
- **Symptom:** When the same bib entry is open both docked and as a float, editing the annotation in one surface does not update the other, and a subsequent edit in the sta...
- **Root cause:** Uncontrolled contentEditable: the innerHTML seed effect deps exclude `content` (src/components/BibEntryCard.tsx:111-115), so two live instances of the same key cannot converge.
- **Repro:** Pop a bib card out to a float; its docked card stays visible → Type an annotation in the float; wait for save
- **Status:** CONFIRMED · conf high

### [LOW] EX-F5-03 — examples·F5
- **Symptom:** An example-body edit that produces schema-invalid expex JSON is silently dropped from the main doc — the card shows the new content but the document never re...
- **Root cause:** Bare catch on the nodeFromJSON/dispatch write-back (ExampleCard.tsx:200), copied for float parity.
- **Repro:** Edit an example body in the card in a way that yields invalid expex node JSON (e.g. an edit the float schema can't reconstruct) → The card displays the edit but writeBackToMain's nodeFromJSON throws and is swallowed — the doc is untouched
- **Status:** CONFIRMED · **RECLASSIFIED** (MEDIUM→LOW) · conf medium

### [LOW] EX-F8-02 — examples·F8
- **Symptom:** When an example is edited from one surface (e.g. the main editor or a second open card) while the user's caret sits mid-text in another open example card, th...
- **Root cause:** Raw-offset caret restore across a setContent re-seed (no ProseMirror position mapping) at ExampleCard.tsx:288-295 and float-sync.tsx:221-227
- **Repro:** Open example A's card expanded (editable) and place the caret mid-text (e.g. after the 3rd char) → In the main editor (or a second open surface for A), insert text at the START of example A's body
- **Status:** CONFIRMED · conf high

## C5. User content living outside the body JSON dropped on delete / re-anchor
*4 bugs · max severity DATA-LOSS.* An EditableCard carries user content outside its body JSON (report.title plus its plain-text mirror), which the delete/has-content/re-anchor paths don't account for — a titled-but-empty-body report deletes with no confirm and loses the title; Mode-B re-anchor adapters omit preserveModeBAnchor.
**Fix locus:** src/cards/has-content.ts cardHasContent (count title) + the EditableCard delete path + the Mode-B drop adapters. REP-F7-01 is DATA-LOSS.

### [DATA-LOSS] REP-F7-01 — reports·F7
- **Symptom:** Deleting a Report that has a title but an empty body — via the in-card trash button or by pressing Delete/Backspace on the selected card — does NOT show the...
- **Root cause:** Two divergent delete-confirm predicates: tryDelete inspects only the body JSON (panel-primitives.tsx:891) while the marker path uses the kind-aware cardHasContent (delete-margin-item.ts:108).
- **Repro:** Add a Report, give it a title via the +T affordance, leave the body empty → Click the in-card trash button (or select the card and press Delete)
- **Status:** CONFIRMED · **RECLASSIFIED** (MEDIUM→DATA-LOSS) · conf high

### [MEDIUM] REP-A1-01 — reports·A1
- **Symptom:** After deliberately deleting or archiving a paragraph a report is Mode-A anchored to, the report keeps a dead anchor: its panel jump button stays enabled but...
- **Root cause:** The deeper cause is a broken contract, not just a missing listener: linked-anchor.ts:148 enumerates `useTodos / useReports / useExamples / useArchive` as the four Mode-A orphan consumers, but only useTodos and useArchive ever registered…
- **Repro:** Create a Report and anchor it to a paragraph (Mode A) → Use the paragraph's drag-handle Archive or Delete action (sets LIFECYCLE_DELETE_META) to remove that paragraph
- **Status:** CONFIRMED · conf high

### [MEDIUM] REP-A2-01 — reports·A2
- **Symptom:** A report-request anchored to a text RANGE (Mode B, via the drag-handle 'report' gesture) loses its in-text tinted highlight after a reload; if no paragraph i...
- **Root cause:** Same root cause as the finder (reports omitted from EditorLayout.tsx:3265-3306 applyLinkedAnchors restore loop + the :3312 dep array), but the impact ceiling is paragraph-level degradation + lost tint, NOT total resolution loss, because…
- **Repro:** Select a phrase in a paragraph and use the drag-handle/selection 'report' action with a range anchor to file a Report Request (Mode B) → Confirm the phrase is tinted in-text and the card highlights it on hover
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [LOW] REP-F7-03 — reports·F7
- **Symptom:** Dragging a Report (or Report Request) that is anchored to a text RANGE (Mode-B) to re-anchor it onto a different paragraph leaves the original text still tin...
- **Root cause:** Adapter omits preserveModeBAnchor for a Mode-B-capable kind: dropReportsApi (EditorPane.tsx:1351-1362) lacks the method, so the gated mark-strip in text-object-side-reanchor.ts:68 no-ops.
- **Repro:** Select a span of text and use the drag-handle 'report' quick action to file a Report Request anchored to that range (tint appears over the span) → Drag the report's grab handle and drop it onto a different paragraph (confirm the re-anchor)
- **Status:** CONFIRMED · conf medium

## C6. Export-via-raw vs persist-via-serializer drop (empty-raw / filter(Boolean) silent loss)
*3 bugs · max severity DATA-LOSS.* Consumers read entry.raw and skip the fields fallback, or run a seen-set/.filter(Boolean) that silently drops entries with raw==''; a library entry saved under a new citekey ships an empty BibTeX block on export.
**Fix locus:** src/hooks/useCitations.ts / the bib serializer — make every raw consumer fall back to serialize(fields) and drop the filter(Boolean) skips.

### [DATA-LOSS] BIB-F7-01 — bibliography·F7
- **Symptom:** Exporting cited.bib silently omits any cited entry that was added during the current session (e.g. via 'Save under new citekey' or 'Add from library') — the...
- **Root cause:** Export path reads entry.raw directly (BibliographyPanel.tsx:363) instead of routing through serializeBibFile, which reconstructs from fields when raw is empty (bib-parser.ts:128-139).
- **Repro:** Connect a library; in the bib panel add a library entry whose citekey clashes locally and choose 'Save under new citekey' (entry stored with raw:'') → Cite that new key once in the editor so it's 'cited'
- **Status:** CONFIRMED · conf high

### [MEDIUM] BIB-F8-04 — bibliography·F8
- **Symptom:** Adding a library entry via the conflict strip's 'Save under new citekey' creates an in-memory entry that is silently omitted from a 'Export cited.bib' perfor...
- **Root cause:** Export reads e.raw directly (BibliographyPanel.tsx:363) while persistence reads through serializeBibFile (which reconstructs from fields).
- **Repro:** Search library, Add an entry that conflicts → 'Save under new citekey' (raw becomes '') → Cite the new key in the editor so it counts as cited
- **Status:** CONFIRMED · conf medium

### [LOW] BIB-F1-04 — bibliography·F1
- **Symptom:** If two .bib entries share a citekey, only the first is ever displayed; the second is silently dropped from both the list and the cited.bib export.
- **Root cause:** Two stacked silent drops: (1) parser-level Record-keyed collapse by lowercased citekey (src/lib/bib-parser.ts:874) and (2) panel-level `seen.has(e.key)` filter (src/panels/Bibliography/BibliographyPanel.tsx:224).
- **Repro:** Hand-edit references.bib to contain two @article entries with the same citekey but different fields → Open the Bibliography panel — only one entry shows, no warning
- **Status:** CONFIRMED · conf medium

## C7. Missing or unwired UI surface / callback / data prop
*17 bugs · max severity HIGH.* A producing surface advertises an action whose host callback was never wired (drop callbacks, onCitationCreated, onEditorFocus), a spec'd preview is never built, or a host mount passes no data for a supported slice — the affordance is inert or absent.
**Fix locus:** The panel host mounts (EditorPane / *PanelHost) — thread the missing callback/data prop; build the missing surface. CI-A2-01 (host-unwired drop) is the HIGH instance.

### [HIGH] CI-A2-01 — citations·A2
- **Symptom:** Dragging an unanchored citation card into the editor does nothing — it never anchors, despite the card's own tooltip instructing the user to do exactly that.
- **Root cause:** Optional callback onCitationDrop left unwired at every host while Editor.tsx:562 hard-gates the drop on it, AND the panel's default '+ Add citation' mode is 'unanchored' (citations-host.tsx:97) so the broken gesture is on the primary path,…
- **Repro:** Create an unanchored citation via the panel '+ Add citation' flow (it renders dashed with the 'drag into the editor to anchor it' tooltip) → Drag the card and drop it onto a position in the editor body
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [MEDIUM] BIB-F1-01 — bibliography·F1
- **Symptom:** When the displayed bibliography list is empty (e.g. 'Cited entries only' before any citation exists, or a search with no matches), the user's pending 'Reques...
- **Root cause:** The `showEmpty` gate at src/panels/_shared/CardListPanel.tsx:112 omits `listTrailing` from its emptiness calculation; the structural fix is to render `listTrailing` outside the showEmpty branch (or fold its presence into `showEmpty`).
- **Repro:** Open a paper with no citations yet (or set filter to 'Cited entries only') → Open the Add menu → 'Request entry', submit a description
- **Status:** CONFIRMED · conf high

### [MEDIUM] FN-F5-01 — footnotes·F5
- **Symptom:** The footnote card's title (+T) affordance lets the user type a title, but the title is silently discarded — it is never stored on the footnote, never persist...
- **Root cause:** Triple-broken path, deepest layer is serialization: even a fully-wired handler+imperative-setter would lose the title because latex-serializer.ts:393 has no title emission and latex-parser.ts:404 reconstructs the node with the default…
- **Repro:** Open a paper with a footnote; show the Footnotes panel; expand the footnote card → Click the +T affordance and type a title (e.g. 'Methodology note'); press Enter or click away
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [MEDIUM] OMNI-F4-01 — omni-left·F4
- **Symptom:** A citation dropped into a report/report-request body in the omni shows its raw '\cite{key}' command instead of the formatted name, and clicking it selects no...
- **Root cause:** Two adjacent panels (Reports/omni.tsx and ReportsPanel.tsx) construct ReportCard/ReportRequestCard without wiring the citation lookup+creation props that the component already declares (ReportCard.tsx:38-39).
- **Repro:** Open the Reports omni on the left and expand a Report (or Report Request) → Drag a citation from the Bibliography panel into the report body
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [MEDIUM] REP-C1-01 — reports·C1
- **Symptom:** Pending Report AI requests (kind:'report') never appear in the docked Reports panel — there is no 'Pending AI requests' section — so a user filing a report r...
- **Root cause:** Two-seam omission (host forgot useAiRequestsContext + panel has no aiRequests prop / no r.kind filter), same as the finder.
- **Repro:** File a Report Request from the editor (drag-handle 'report' action / can-I-request) so a kind:'report' entry lands in ai-requests.json, OR toggle a report-request card's AI flag on → Open the docked Reports panel
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [MEDIUM] REP-F4-01 — reports·F4
- **Symptom:** A citation placed inside a Report (or Report Request) body shows the raw LaTeX command \cite{smith2020} instead of the formatted name (e.g. 'Smith 2020'), an...
- **Root cause:** reports-host.tsx is the single host that never threads the CitationDisplayProvider values; RichTextField.tsx:206 (display refresh no-ops) and :283-284 (drop falls back to raw command, skips registration) are the downstream failure sites.
- **Repro:** Open a paper with a bibliography in the dev doc → Add a Report card; drop or type a \cite{...} into its body (expanded)
- **Status:** CONFIRMED · conf high

### [MEDIUM] REP-F5-02 — reports·F5
- **Symptom:** The docked Reports panel never shows a 'Pending AI Requests' section, unlike Footnotes/Notes/Todos — a standalone or orphaned report AI-request (e.g. one who...
- **Root cause:** reports-host.tsx lacks the useAiRequestsContext wiring AND ReportsPanel.tsx has no aiRequests prop/filter; the visibility gap is real only for inbox entries with no live report-request card to render their checkbox.
- **Repro:** File a kind:'report' AI request (tick AI-request on a report-request, or have a skill create a virtual reports request) → Delete or morph away the originating report-request card
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [MEDIUM] SR-A1-01 — search·A1
- **Symptom:** Searching the Footnotes scope never finds text in orphaned (detached) footnotes — content the user most needs to recover via search is invisible to it.
- **Root cause:** Hardcoded-empty collection literal at the SearchHost mount (EditorPane.tsx:5572) silently drops an available, populated data source — a migration leftover from the Reader-only origin of EditorPane where orphans were genuinely empty.
- **Repro:** Create a footnote with distinctive body text, then delete its in-text marker so the footnote becomes orphaned (orphan card appears in the Footnotes panel) → Open Search, enable the Footnotes scope, type a distinctive word from the orphaned footnote's body
- **Status:** CONFIRMED · conf high

### [MEDIUM] SR-F3-02 — search·F3
- **Symptom:** Enabling the 'Reports' scope chip yields zero results no matter what the document contains.
- **Root cause:** Registry-vs-dispatch drift: 'reports' is enumerated in the order/label/color maps (driving chip render) but absent from both the results-memo dispatch switch (SearchPanel.tsx:312-355) and the SearchHost data props (search-host.tsx:22-37),…
- **Repro:** Open Search, open the 'More' dropdown → Enable 'Reports'
- **Status:** CONFIRMED · conf high

### [MEDIUM] SR-F7-01 — search·F7
- **Symptom:** Orphaned footnotes (callout deleted, body preserved) are never found by search even with the Footnotes scope on.
- **Root cause:** Wired-but-starved input: SearchHost (and FootnotesHost) receive an empty-literal orphan list (EditorPane.tsx:5572 / :5405) under a stale 'Reader has no orphans' rationale, even though EditorPane mounts editable (EditorLayout.tsx:4385) and…
- **Repro:** Create a footnote, then delete its in-text marker so the body is orphaned (orphaned-footnote card appears in Footnotes panel) → Open Search with the Footnotes scope enabled
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [LOW] BIB-F1-02 — bibliography·F1
- **Symptom:** The CSL-formatted bibliography preview that the panel's `getFormattedBib` prop implies (the brief lists it as a bibliography function) is never shown anywher...
- **Root cause:** Not a dead prop
- **Repro:** Open a Bibliography card and expand it → Observe BibTeX Fields + Annotations pods but no CSL-formatted reference string anywhere
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [LOW] BIB-F7-03 — bibliography·F7
- **Symptom:** Dragging a bib entry into the editor always inserts a plain \cite{key} regardless of the document's bib package, even though the card was wired to choose a p...
- **Root cause:** Dead prop / stale doc-comment: bibPackage threaded + in deps but never consumed (BibEntryCard.tsx:203-219); the comment at :28 documents behavior that was never implemented.
- **Repro:** Set the citation package to natbib in the Citations panel menu → Drag a bib entry from the Bibliography panel into the editor body
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [LOW] EX-F3-03 — examples·F3
- **Symptom:** Jumping to an example from the unified Omni column scrolls the block into view but does not align it to the clicked card's vertical position (unlike jumping...
- **Root cause:** The example omni builder's onJump type/wiring (Examples/omni.tsx:12,36) drops the sourceEl that ExampleCard supplies (ExampleCard.tsx:412), forcing scrollToExample down its no-source fallback branch (Editor.tsx:1295) instead of…
- **Repro:** Open the Omni (unified) left column and the docked Examples panel → Click an example card in each and watch where the block lands
- **Status:** CONFIRMED · conf high

### [LOW] EX-F4-02 — examples·F4
- **Symptom:** Clicking inline or display math inside an example card body does nothing — no math editor/popover opens, so math nested in an example can't be edited from th...
- **Root cause:** Surface-gated atom interactivity (math.ts:73) vs
- **Repro:** Open an example containing inline math (\ex with $...$) in the Examples panel; expand the card → Click the rendered math inside the card body
- **Status:** CONFIRMED · conf high

### [LOW] FN-F7-01 — footnotes·F7
- **Symptom:** The footnote panel-card drag affordance (startFootnoteDrag / MIME_FOOTNOTE, with an 80-char-truncated ghost) is exported and the editor has a matching MIME_F...
- **Root cause:** Both sub-claims confirmed at the cited lines (FootnoteCard.tsx:25; Editor.tsx:712-785; panel-primitives.tsx:933 not 502 as cited — the draggable gate lives at the cardDraggable computation, line 933, not the static drag-chrome…
- **Repro:** grep the source: startFootnoteDrag is referenced only by its definition and the panel barrel re-export (no call site) → In the running app, attempt to drag a footnote card from the Footnotes panel into the document body
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [LOW] OMNI-F2-01 — omni-left·F2
- **Symptom:** No user-visible misbehavior; the omni-host carries dead single-selection-enforcement code that looks load-bearing but is a no-op, inviting a future maintaine...
- **Root cause:** Confirmed by reading selections.tsx end-to-end
- **Repro:** Read selections.tsx: confirm per-kind slots are derived, not independent useState → Trace setFootnoteInOmni → setSelectedFootnoteId(id) (store=footnote) → setSelectedCitationId(null) (s.kind!=='citation' → no-op)
- **Status:** CONFIRMED · conf high

### [LOW] OMNI-F5-01 — omni-left·F5
- **Symptom:** Focusing a report/report-request body in the omni does not route formatting controls to the main toolbar (the per-card B/I/U toolbar is suppressed and there...
- **Root cause:** panel-primitives.tsx:914-926 gates the main-bar editor promotion entirely on the optional onEditorFocus prop; report builders omit it (Reports/omni.tsx, ReportsPanel.tsx) where footnote/note/archive builders thread setOverrideEditor.
- **Repro:** Open the Reports omni and expand a Report → Click into the report body to focus the editor
- **Status:** CONFIRMED · conf medium

## C8. Lossy kind-change morph drops the aiRequest flag without unbridging the inbox
*8 bugs · max severity HIGH.* A kind-changing morph (report-request→report, note↔highlight, revision/cutter comment→suggestion) drops the source kind's aiRequest flag but never clears the matching pending entry in ai-requests.json, so a phantom open request lingers; deletes have the symmetric leak.
**Fix locus:** The morph dispatcher (src/cards/morphs/index) + the panel delete hooks — bridge-clear the inbox entry in the morph/delete path, not on a toggle.

### [HIGH] REP-F5-01 — reports·F5
- **Symptom:** Morphing a Report Request that has its 'AI request' flag on into a Report silently drops the flag AND leaves a stale pending entry in ai-requests.json that c...
- **Root cause:** Two distinct defects bundled: (1) convertCard (useReports.ts:267) performs no aiRequest bridge cleanup on the lossy report-request→report flip → orphaned ai-requests.json entry; (2) the morph confirm copy (EditorPane.tsx:875) is…
- **Repro:** Add a Report Request, type a body, tick its 'AI request' checkbox (this writes a pending entry to ai-requests.json) → Use the kind chevron to morph it to a Report; confirm the (incomplete) dialog
- **Status:** CONFIRMED · **RECLASSIFIED** (DATA-LOSS→HIGH) · conf high

### [MEDIUM] OMNI-F6-01 — omni-left·F6
- **Symptom:** Morphing a Report-Request that has its AI-request flag ON into a Report (via the kind chevron, available in the omni) silently leaves a dangling 'pending' en...
- **Root cause:** Single chokepoint gap: convertCardWithRemap (EditorPane.tsx:863-918) remaps the float key but never reconciles the ai-requests.json bridge when FROM-kind declares aiRequest routing (card-registry.tsx:498) and TO-kind does not…
- **Repro:** Create a Report-Request card and toggle its AI-request flag ON (writes a pending entry to ai-requests.json with linkedTo.cardId=X) → In the omni column, use the kind chevron to morph it Report-Request → Report and confirm the lossy dialog
- **Status:** CONFIRMED · conf high

### [MEDIUM] REP-F6-01 — reports·F6
- **Symptom:** Morphing a Report Request that has its AI-request checkbox ON into a Report leaves a dangling, never-completing entry in the paper's AI-request inbox (ai-req...
- **Root cause:** Lifecycle-incomplete inbox bridging: bridgeCardAiRequestFlag is bound only to the explicit flag setter (useReports.ts:247), not to the morph/delete lifecycle.
- **Repro:** Create a Report Request anchored to a paragraph → Tick its 'AI request' checkbox ON (bridge writes a pending entry to ai-requests.json with linkedTo.cardId = this card)
- **Status:** CONFIRMED · conf high

### [MEDIUM] REP-F6-02 — reports·F6
- **Symptom:** After morphing the currently-selected/expanded report card, its in-text + gutter-marker halo disappears and the card collapses to its summary, while the pane...
- **Root cause:** Incomplete kind-remap on morph: cross-surface interaction state (cardStore.selected/expandedSet, keyed {kind,id}) is not remapped when the morph flips the record kind; only the float-key is (EditorPane.tsx:915).
- **Repro:** Click a report card to select+expand it (halo paints in panel + over its anchored text + gutter marker) → Use the kind chevron to morph it to the other kind; confirm
- **Status:** CONFIRMED · conf high

### [MEDIUM] REP-F7-02 — reports·F7
- **Symptom:** Deleting a Report Request that has its AI-request checkbox ON leaves a dangling pending entry in ai-requests.json that points at a now-deleted card.
- **Root cause:** Same lifecycle-incomplete bridging as REP-F6-01: inbox cleanup is bound to the flag setter, not to the delete lifecycle (useReports.ts:305-311 omits the bridge-off call)
- **Repro:** Create a Report Request, tick its AI-request box ON (writes a pending inbox entry) → Delete the Report Request card
- **Status:** CONFIRMED · conf high

### [MEDIUM] REP-F8-01 — reports·F8
- **Symptom:** Toggling a Report Request's AI flag on, then morphing it to a Report (kind chevron), leaves a pending 'report' request stranded in ai-requests.json that the...
- **Root cause:** The morph chokepoint (EditorPane.tsx:863-918) never reconciles the AI-request inbox: it remaps the float key (:915) but does not bridge a dropped aiRequest flag.
- **Repro:** Create a Report Request and check its 'Ask Claude' AI-request box (files a kind:'report' entry in ai-requests.json with linkedTo.cardId) → Use the kind chevron to morph the Report Request into a Report; accept the lossy confirm
- **Status:** CONFIRMED · conf high

### [LOW] OMNI-F6-02 — omni-left·F6
- **Symptom:** Morphing the currently-SELECTED report card (report⇄report-request) in the omni silently drops its selection halo — the user morphs the card they just clicke...
- **Root cause:** Selection identity is baked with the mutable card KIND; convertCardWithRemap (EditorPane.tsx:915) remaps the float key but not the cardStore selection ref, so the kind-discriminated findEntity (entity-hover.ts:70-74) prunes it after the…
- **Repro:** Click a Report card in the omni to select it (cardStore.selected={kind:'report',id:X}, halo visible) → Use the kind chevron to morph Report → Report-Request and confirm
- **Status:** CONFIRMED · conf high

### [LOW] REP-F6-03 — reports·F6
- **Symptom:** The lossy-morph confirm dialog shown when converting a Report Request -> Report says 'This drops the title and byline (a Report can't hold them)', which is b...
- **Root cause:** Direction-blind confirm copy: the lossy branch keys the message only on whether the body survives (preservesBody), not on the morph direction, and hard-codes 'title and byline' which is correct only for report->request…
- **Repro:** Create a Report Request, optionally tick its AI-request box → Morph it to a Report via the kind chevron
- **Status:** CONFIRMED · conf high

## C9. PM positions frozen in a debounced/getJSON snapshot consumed by a counter-gated render
*5 bugs · max severity HIGH.* A panel caches absolute ProseMirror offsets (or reads the 1.5s-debounced latestDoc) into a memo gated on editor identity + a structural counter, so positions go stale/empty on edits that don't bump the counter (typing earlier in the doc shifts later offsets).
**Fix locus:** Resolve live positions at measure time via getBus(editor).structure / useInTextPositions instead of replaying stored from/to; source structure from the live editor not latestDoc.

### [HIGH] SR-F1-01 — search·F1
- **Symptom:** After running a search and then editing the document (typing/deleting in a plain paragraph) without changing the query, clicking a Main-text result highlight...
- **Root cause:** Deeper than the finder framed it: the architectural mismatch is that searchMainText snapshots ABSOLUTE PM positions into the memo's value, but the memo is gated on CONTENT-change counters (per keystroke-sanctity,…
- **Repro:** Open a doc; open Search; query a word that appears late in the body; navigate to a Main-text result so it highlights → Without changing the query, delete or insert a paragraph EARLIER in the doc (one with no footnote/citation), shifting later PM positions
- **Status:** CONFIRMED · conf high

### [MEDIUM] OUT-F2-01 — outline·F2
- **Symptom:** On a freshly-opened document that has not been edited yet, clicking the outline 'Focus' button focuses the ENTIRE document instead of the first section, and...
- **Root cause:** The focus engine is fed structure derived from the 300ms-debounced `latestDoc` snapshot (EditorLayout.tsx:2360-2362 via useFocusActions/focus.ts:21-38) while every render-time consumer reads the live editor.getJSON(); `latestDoc` is never…
- **Repro:** Open a document containing several headings and do NOT type anything → Click the outline panel's 'Focus' button
- **Status:** CONFIRMED · conf high

### [MEDIUM] OUT-F8-02 — outline·F8
- **Symptom:** Clicking an outline row to move/expand the focus band (or dragging a band handle) within ~300ms of a structural edit sets the band to the wrong block range —...
- **Root cause:** Confirmed as finder stated
- **Repro:** Activate Focus mode (or just be in the panel) on a multi-section doc → Make a structural edit that changes heading positions — e.g. delete a heading, or have an AI agent insert a block above the current section
- **Status:** CONFIRMED · **RECLASSIFIED** · conf medium

### [LOW] OMNI-F1-02 — omni-left·F1
- **Symptom:** After plain typing that shifts content across a collapsed-section or focus-band boundary, an omni card can be wrongly dropped by the fold filter or wrongly s...
- **Root cause:** omni-host.tsx:609-643 — the fold/focus classification was never migrated to the resolvePos live-snapshot mechanism that the cascade adopted (OmniViewPanel.tsx:471-488) to defeat keystroke pos-drift; it still trusts OmniItem.pos baked at…
- **Repro:** Collapse a section so getHiddenTopLevelIndices is non-empty → Position a footnote/citation near the top-level boundary between the collapsed section and the next visible one
- **Status:** CONFIRMED · **RECLASSIFIED** · conf medium

### [COSMETIC] OUT-F7-01 — outline·F7
- **Symptom:** After renaming a heading or a paragraph-title from the outline's edit-mode pod, the outline keeps displaying the OLD title; the rename did land in the docume...
- **Root cause:** The no-counter-bump mechanism is real: handleRenameHeading is an in-place delete+insertText inside the heading node (src/components/editor-layout/card-actions/editor-ops.ts:130-136) — text-only, so headingStructurallyChanged (compares…
- **Repro:** Open the outline panel and click 'Edit' to enter edit mode → Click a heading pod's text, change the title (e.g. 'Intro' → 'Introduction'), press Enter
- **Status:** RECLASSIFIED · **RECLASSIFIED** (MEDIUM→COSMETIC) · conf medium

## C10. Descendants-only traversal blind spot for nested inline atoms
*5 bugs · max severity HIGH.* resolveLink / findInlineAtomPos / collectAnchorEls / extractText walk only direct descendants, so an atom (\cite, \ref, math) nested inside a footnote or heading is missed — mis-anchored, dropped from a flatten, or given a dead jump arrow.
**Fix locus:** The shared atom-position resolver (src/links/links.ts findInlineAtomPos + OutlinePanel.extractText) — make traversal fully recursive / descendInto footnote+heading subtrees.

### [HIGH] BIB-F3-01 — bibliography·F3
- **Symptom:** Clicking the jump-to-citation target on a bibliography entry that is cited only inside a footnote does nothing — the editor never scrolls — even though the e...
- **Root cause:** Shared resolver blind spot: findInlineAtomPos (links.ts:645-662) and resolveLink (links.ts:429-431) only traverse editor.state.doc.descendants, which by ProseMirror design does not descend into atomic-node attrs holding a JSONContent…
- **Repro:** Open a paper where some citekey is cited ONLY inside a \footnote{...\cite{key}...} and nowhere in the main flow → Open the Bibliography panel (Cited entries only); the entry for that key appears with a live jump (target) arrow
- **Status:** CONFIRMED · conf high

### [HIGH] CI-F3-01 — citations·F3
- **Symptom:** Clicking jump (or the card body) on a citation that lives inside a footnote does nothing — the editor never scrolls to the marker — even though the citation...
- **Root cause:** Descendants-only traversal in findInlineAtomPos (links.ts:652) cannot reach atoms living inside a footnote's attrs.content JSONContent literal; the panel-side enumerators (getCitations/getCitationIds/getCitationOrder,…
- **Repro:** Open a paper with a \footnote{...\cite{key}...} (a citation inside a footnote) → Observe the citation appears in the Citations panel rendered as anchored (solid border, jump arrow live)
- **Status:** CONFIRMED · conf high

### [LOW] OUT-F1-01 — outline·F1
- **Symptom:** Outline rows for headings that contain inline atoms render with the atom text missing (e.g. a heading 'Step 3: $n+1$' shows as 'Step 3: '), and a heading who...
- **Root cause:** Same root as OUT-F4-01 (extractText drops attrs-only inlineMath/citation/labelRef); the `|| 'Untitled'` fallback at OutlinePanel.tsx:324 amplifies a fully-stripped heading into an outright wrong label.
- **Repro:** Add a heading whose text is mostly or entirely inline math, e.g. \section{$\Sigma$} → Open the Outline panel; the row shows 'Untitled' (or a partial string with the math omitted)
- **Status:** CONFIRMED · conf high

### [LOW] OUT-F4-01 — outline·F4
- **Symptom:** Headings (and the document title) that contain inline math, citations, or \ref render in the outline with those atoms silently omitted, e.g. \section{The $G$...
- **Root cause:** Same as finder (extractText drops attrs-only atoms)
- **Repro:** Add a heading containing inline math or a citation, e.g. \subsection{Bounds on $n$ from \citet{smith}} → Open the Outline panel (view mode)
- **Status:** CONFIRMED · conf high

### [LOW] SR-F4-01 — search·F4
- **Symptom:** Searching the Footnotes/Notes scopes for a citekey or LaTeX cite command that is embedded inside a footnote/note body fails to find it when the embedded cita...
- **Root cause:** The flattening helper is lossy-by-design for atoms (footnote-content.ts:602-628 says it's for ghosts/tooltips/previews), and search reuses it as if it were a search index.
- **Repro:** Insert a footnote whose body contains a citation node with a non-empty displayText (e.g. a \citep that resolved to 'Smith 2020') → Open Search, enable the Footnotes scope, and query the citekey (e.g. 'smith2020')
- **Status:** CONFIRMED · conf medium

## C11. Migration-orphan: producer relocated to EditorPane, consumer still reads dead EditorLayout state
*5 bugs · max severity HIGH.* During the EditorLayout→EditorPane split a feature's producer moved but its consumer kept reading a now-never-updated EditorLayout state (or a teardown effect stranded on the old owner), so the feature is silently inert.
**Fix locus:** src/components/EditorLayout.tsx / EditorPane.tsx — delete the dead duplicate copy and point the consumer at the live state. SR-F8-01 / SR-F3-01 (search jump dead) are HIGH.

### [HIGH] SR-F3-01 — search·F3
- **Symptom:** Clicking a search result never scrolls or highlights the matched text in the main editor; for a Main-text result the click does nothing visible at all.
- **Root cause:** Incomplete 'post-7.8' migration: the search highlight state was lifted into EditorPane but its only live consumer reads the same-named sibling state in EditorLayout, which is hard-wired to null.
- **Repro:** Open a paper; open the Search panel (left) → Type a query that matches Main text (default scopes include mainText)
- **Status:** CONFIRMED · conf high

### [HIGH] SR-F8-01 — search·F8
- **Symptom:** Clicking a search result does not highlight the matched text in the editor; for a Main-text result it has no editor effect at all (no highlight, no scroll).
- **Root cause:** Severed EditorLayout<->EditorPane wiring during the (incomplete) 7.8 migration: the highlight PRODUCER moved into EditorPane (searchHighlightRange state, EditorPane.tsx:2663) and was voided, while the CONSUMER (the editor's highlightRange…
- **Repro:** Open the Search panel; type a word that appears in the main body text → Click a Main-text result (or press Enter / ArrowDown)
- **Status:** CONFIRMED · conf high

### [MEDIUM] SR-C1-02 — search·C1
- **Symptom:** Opening a search result whose target panel sits on the same side as Search closes the Search panel (and its result list) instead of splitting the side to sho...
- **Root cause:** Incomplete 7.8 migration: the cross-panel-jump's split logic was left stranded in the unmounted EditorLayout.openItemInPanel while the live EditorPane copy is an explicit placeholder that whole-side-switches.
- **Repro:** Place Search and (say) Footnotes on the same sidebar side → Open Search, enable Footnotes scope, search a term, click a footnote result
- **Status:** CONFIRMED · conf high

### [LOW] SR-F3-03 — search·F3
- **Symptom:** Jumping from a search result to a target panel that sits on the SAME side as Search closes the Search panel, losing the visible query/results.
- **Root cause:** Migration reduction: the parent shell's auto-split (setActiveHalf top/bottom) was not ported into EditorPane's single-active-per-side openItemInPanel (EditorPane.tsx:2889); the richer EditorLayout version (:1275-1298) was left dead.
- **Repro:** Place Search and Citations both on the LEFT side → Search for a citation, get a Citations-scope result
- **Status:** CONFIRMED · **RECLASSIFIED** (MEDIUM→LOW) · conf high

### [LOW] SR-F8-02 — search·F8
- **Symptom:** Clear-search-highlight-on-panel-close operates on the dead state, so even the cleanup is a no-op.
- **Root cause:** Cleanup effect left attached to the old owner (EditorLayout) after the state's producer migrated to EditorPane — the inverse of SR-F8-01's severed wiring.
- **Repro:** (Latent — only observable once SR-F8-01 is fixed.) After fixing the highlight path to read EditorPane's state, close the Search panel and confirm the in-editor highlight is removed; today's clear effect targets the wrong state
- **Status:** CONFIRMED · conf high

## C12. Auto-title shape-detection false positive (strips a real user title on load)
*4 bugs · max severity HIGH.* isAutoTitle matches the '<Label> N' shape and strips it on load, so a user who legitimately types 'Report 8' / 'Note 3' loses their title after reload — five load-strip sites share the identical false positive.
**Fix locus:** src/cards/.../isAutoTitle (and the 5 callers: useReports.ts:57, useArchive.ts:28, useTodos, useNotes, useExamples) — distinguish a generated title (track a wasAutoGenerated flag) from a shape-matching user title.

### [HIGH] REP-A2-02 — reports·A2
- **Symptom:** A user who titles a report exactly 'Report 8' (or 'Report 2', etc. — a natural name for a numbered report series) silently loses that title on the next reloa...
- **Root cause:** isAutoTitle is purely shape-based (panel-registry.ts:258 regex) and cannot distinguish a stale generated title from a deliberate user title of the same shape.
- **Repro:** Create a Report and set its title (bodyTitle) to 'Report 8' → Wait for the sidecar to persist, then reload the paper
- **Status:** CONFIRMED · **RECLASSIFIED** (MEDIUM→HIGH) · conf high

### [MEDIUM] OMNI-F1-01 — omni-left·F1
- **Symptom:** A report the user deliberately titled 'Report 3' (or an example titled 'Example 3') loads with a blank title in the omni cascade — the user's title silently...
- **Root cause:** Design flaw, not a code-vs-test divergence: isAutoTitle (panel-registry.ts:254-258) uses ONLY the title's textual shape `^<Label> <digits>$` as the strip predicate, with no provenance/origin bit recorded at create time to distinguish a…
- **Repro:** Create a Report and name it 'Report 3' (a title a user might plausibly choose) → Reload the document so useReports re-migrates from the sidecar
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [MEDIUM] REP-F5-03 — reports·F5
- **Symptom:** A user who titles a report exactly like the legacy auto-pattern — e.g. 'Report 2', 'Report 14' — loses that title silently on the next document load; it reve...
- **Root cause:** isAutoTitle (panel-registry.ts:254-258) is an ambiguous heuristic — a generated-title pattern is indistinguishable from a legitimate user title of the same shape; the migrator (useReports.ts:57) applies it destructively on every load with…
- **Repro:** Add a Report and set its title to 'Report 2' (e.g. a paper whose section 2 you are reporting on) → Reload the document (close/reopen the paper folder)
- **Status:** CONFIRMED · conf high

### [LOW] EX-A2-01 — examples·A2
- **Symptom:** The Examples sidecar hook (custom title persistence, delete, editor reconciliation) is wired into nothing; an example's custom title and createdAt are never...
- **Root cause:** useExamples.ts is orphaned code; the live derivation deliberately bypasses the sidecar (EditorPane.tsx:5645 comment confirms 'no sidecar storage')
- **Repro:** Inspect the running Examples panel/card: there is no title input and no createdAt persistence → Confirm examples.json is never written (no live caller of writeSidecar('examples.json', ...))
- **Status:** CONFIRMED · conf high

## C13. Multi-anchor @N omni grammar honored in the prefix matcher but broken at the jump
*2 bugs · max severity HIGH.* An omni builder emits per-anchor @N rows but the @N grammar is honored only in open-for-card.ts's prefix matcher and broken in the exact-match pin/align sites, and the per-anchor row jumps via card-level jumpToCard (wrong anchor / wrong row).
**Fix locus:** open-for-card.ts exact-match sites + the omni jump handler — carry the anchor index through to the jump.

### [HIGH] REP-F3-01 — reports·F3
- **Symptom:** For a report anchored to two or more paragraphs, the Omni column shows one row per anchor (labelled @0, @1, …) but clicking any of them jumps the editor to t...
- **Root cause:** jumpToCard has no target-anchor parameter (links.ts:579-620) and the omni fan-out passes the whole card instead of the row's pid (omni.tsx:53-54,68-69)
- **Repro:** Create a report and anchor it to two different paragraphs (e.g. drag-reanchor adds a second link, or a multi-paragraph anchor) → Open the left Omni column; observe two rows for the report (@0 and @1)
- **Status:** CONFIRMED · **RECLASSIFIED** (MEDIUM→HIGH) · conf high

### [MEDIUM] OMNI-F3-01 — omni-left·F3
- **Symptom:** Clicking the in-text gutter marker (or anchor) of a report that is anchored to MULTIPLE paragraphs opens the report card in the omni column but fails to alig...
- **Root cause:** Deepest cause: the @N omni-wrapper grammar (Reports/omni.tsx:86) is a per-paragraph fan-out that the pin/align consumers treat as an exact card key.
- **Repro:** Create a Report card and anchor it to two paragraphs (so buildReportsOmniItems emits @0 and @1 wrappers) → Open the omni column on the reports' home side
- **Status:** CONFIRMED · conf high

## C14. Inline-atom prune-exemption leaves a dangling cardStore / float ref after delete
*10 bugs · max severity MEDIUM.* isInlineAtomCardKind exempts footnote+citation from the dangling-ref pruner (so a transient parse-gap won't drop a valid selection), but a genuine hard-delete then leaves a dangling cardStore selection / poppedOutCards float keyed to a dead id, with id-reuse mis-pointing risk.
**Fix locus:** src/cards/predicates.ts isInlineAtomCardKind exemption + the poppedOutCards pruner — distinguish transient parse-gap from a real delete (re-resolve once on the next structural tx).

### [MEDIUM] CI-F8-01 — citations·F8
- **Symptom:** A popped-out (floating) unanchored citation card cannot be dropped into the editor to anchor it — the drop is a silent no-op.
- **Root cause:** Inline-atom MOVE spec (inlineAtomMoveSpec) is the only float-drop path for citations; it presumes a pre-existing atom (locateAtom) and has no 'create-and-anchor' branch for an unanchored card.
- **Repro:** Create an unanchored citation and pop it out into a floating card → Drag the float-header onto an inline cursor position in the editor
- **Status:** CONFIRMED · conf high

### [MEDIUM] FN-F8-01 — footnotes·F8
- **Symptom:** If a footnote is popped out into a floating window and then orphaned (its marker deleted in text), the float window silently disappears and its key is leaked...
- **Root cause:** Float keys are not invalidated when the underlying entity transitions to an unresolvable state: FloatHost renders null for an unresolvable key but never reaps it from poppedOutCards (FloatHost.tsx:43-46), and the orphaning bridge…
- **Repro:** Pop out a footnote card into a floating window → Delete the footnote's marker in the main text (orphaning it)
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [MEDIUM] OMNI-F8-01 — omni-left·F8
- **Symptom:** Two omni cards can show a selection halo at once — e.g. select a footnote (marker or omni card), then click a Report omni card; the footnote stays haloed alo...
- **Root cause:** Dual selection sources are OR'd at the card (`ac.selected || isSelected`) but the single-slot cardStore (the only true mutual-exclusion chokepoint) is shadowed by a bag of per-side selected*Id values whose setters cross-clear…
- **Repro:** Click a footnote in-text marker (or its omni card) → footnote omni card haloed; selectedFootnoteId set → Click a Report omni card in the same left column
- **Status:** CONFIRMED · conf high

### [LOW] CI-F2-02 — citations·F2
- **Symptom:** A deleted citation (or one whose id changed across a raw .tex round-trip) can leave a stale halo/expanded-body ghost painted on a now-unrelated or absent car...
- **Root cause:** Inline-atom cards have no liveness signal feeding the pruner (entityExists hard-codes true, useAnchorHighlightReconciler.ts:88), so cardStore refs to a deleted/renamed citation/footnote never self-clear.
- **Repro:** Select a citation (halo on, ref in cardStore.selected) → Delete that citation's \cite atom directly via the raw Code field / code pane (not the panel trash), OR edit the .tex so the \vcid marker is lost and the doc re-parses
- **Status:** CONFIRMED · **RECLASSIFIED** (MEDIUM→LOW) · conf high

### [LOW] CI-F7-03 — citations·F7
- **Symptom:** Removing the last/only key from a citation card empties the command (\cite{}) but leaves the in-text \cite atom and the citation card in place as a dangling...
- **Root cause:** No transition from 'cleared all keys' to deleting the citation; the empty-command state is the same pristine-draft sentinel addCitation produces (useCitations.ts), just reached by subtraction with no cleanup affordance.
- **Repro:** Open a single-key citation card → Remove the only key (X on the row)
- **Status:** CONFIRMED · conf high

### [LOW] CI-F8-02 — citations·F8
- **Symptom:** After a citation is deleted, cardStore.selected can keep pointing at the deleted citation's id; in the rare event a new citation is later assigned that same...
- **Root cause:** Pruner exempts the very kinds (inline atoms) whose existence it cannot verify (useAnchorHighlightReconciler.ts:88), so it can never clear their dangling interaction state; combined with no historical-id avoidance in generateShortId…
- **Repro:** Select a citation card (cardStore.selected = {citation, X}) → Delete that citation (atom + sidecar)
- **Status:** CONFIRMED · conf medium

### [LOW] EX-F8-01 — examples·F8
- **Symptom:** Deleting an example's block while its panel-card float is open leaves a stale popped-out key in saved view prefs; on a later doc load (or undo) the dead key...
- **Root cause:** Same null-return-no-missing-state root as EX-A1-02 (cards/floats/index.tsx:628) plus the absence of any poppedOutCards reconciler.
- **Repro:** Pop out an example from the Examples panel card → Delete the \ex block in the main text
- **Status:** CONFIRMED · **RECLASSIFIED** (MEDIUM→LOW) · conf high

### [LOW] FN-A1-01 — footnotes·A1
- **Symptom:** A deleted footnote can leave a stale selection/expansion/hover reference in the global cardStore that is never pruned, so the selection slot keeps pointing a...
- **Root cause:** The pruner cannot classify inline-atom existence because those kinds aren't in any EntityCollectionSlots collection, so entityExists short-circuits to true (useAnchorHighlightReconciler.ts:88); the deliberate-delete path…
- **Repro:** Select a footnote card (halo on) → Delete it via the card's trash button
- **Status:** CONFIRMED · **RECLASSIFIED** (MEDIUM→LOW) · conf high

### [LOW] FN-F3-01 — footnotes·F3
- **Symptom:** After deleting a footnote whose card was the selected one, the global selection ('selectedFootnoteId') keeps pointing at the now-deleted footnote id until th...
- **Root cause:** Finder's root cause is correct (the blanket inline-atom exemption at useAnchorHighlightReconciler.ts:88).
- **Repro:** Select a footnote card (halo on) so cardStore.selected = {footnote, id} → Delete that footnote via its trash button (confirm if it has text)
- **Status:** CONFIRMED · conf high

### [LOW] OMNI-F7-02 — omni-left·F7
- **Symptom:** After deleting a footnote or citation whose card was selected and/or expanded in the omni, the global card store retains a dead reference to it forever — inv...
- **Root cause:** Inline-atom prune exemption (useAnchorHighlightReconciler.ts:84-90) has no positive 'this atom was truly deleted' counterpart, so genuine footnote/citation deletes leak the cardStore selected (transient) and expandedSet (indefinite) refs.
- **Repro:** Select and expand a footnote/citation card in the omni (cardStore.selected + expandedSet hold its ref) → Delete that footnote/citation
- **Status:** CONFIRMED · conf medium

## C15. Select/jump composition: monotonic store-select paired with a toggling onSelect, or skip-jump
*10 bugs · max severity MEDIUM.* A card body onClick pairs a monotonic store select (ac.onActivate) with a TOGGLE-style panel-local onSelect and/or skips the jump, so the selection halo double-sources (`ac.selected || isSelected`) or a click fails to navigate; manual selectedIdx holders skip useCycle's read-clamp.
**Fix locus:** The shared card body onClick / panel select wiring (FootnotePanel select handler) + route index holders through useCycle.

### [MEDIUM] CI-F2-01 — citations·F2
- **Symptom:** After selecting a citation card then clicking its body again, the halo stays painted but keyboard arrow-cycling and the panel's selectedId-driven behaviors a...
- **Root cause:** Two selection sources of truth (cardStore.selected, monotonic; React selectedId, toggled).
- **Repro:** Click a citation card (selects: halo + selectedId set) → Click the same card's body again
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [MEDIUM] EX-F2-01 — examples·F2
- **Symptom:** After clicking one example card then pressing ArrowDown/ArrowUp to move through the list, TWO example cards can show the selection halo at once (the previous...
- **Root cause:** Two independent selection authorities for one rendered halo: the cross-surface module store (cardStore.selected) and the panel-controlled selectedId prop, OR'd at ExampleCard.tsx:371.
- **Repro:** Open a doc with ≥2 examples; open the Examples panel → Click example A's card body (selects A in both cardStore and panel selectedId)
- **Status:** CONFIRMED · conf high

### [MEDIUM] FN-F2-01 — footnotes·F2
- **Symptom:** Clicking the body of an already-selected (haloed) anchored footnote card a second time drops its halo AND fires a spurious second jump-scroll, instead of kee...
- **Root cause:** Deeper than the finder: the trigger SURFACE is narrower than 'any body click'.
- **Repro:** Open a paper with at least one anchored footnote; show the Footnotes panel → Click the body of footnote card A (not yet selected) — A gets the halo, body expands, editor scrolls to the marker
- **Status:** CONFIRMED · conf high

### [MEDIUM] SR-F1-02 — search·F1
- **Symptom:** The 'N of M' results counter can read e.g. '16 of 10', no card shows selected, and pressing Down/Enter jumps to an unrelated result rather than the next one,...
- **Root cause:** SearchPanel reimplements the prev/next cursor by hand instead of using the shared useCycle hook (panel-primitives.tsx:2606-2629) which already solves this with a read-time clamp.
- **Repro:** Search across mainText + a card scope (e.g. footnotes); navigate to a high index (e.g. result 16 of 20) → Cause the result set to shrink without changing the query — e.g. delete several footnotes so footnote hits drop and total becomes 10; the memo recomputes but selectedIdx stays 15
- **Status:** CONFIRMED · conf high

### [LOW] EX-F2-02 — examples·F2
- **Symptom:** Clicking the body of an already-selected example card leaves it visibly haloed but silently drops it as the keyboard/operand target (the halo and the keyboar...
- **Root cause:** Composition of a select-only store primitive (ac.onActivate, useAnchoredCard.ts:66) with a panel-level TOGGLING onSelect (ExamplesPanel.tsx:98-100): the two disagree on the second click of the same card.
- **Repro:** Select example A by clicking its card → Click example A's card body again
- **Status:** CONFIRMED · conf high

### [LOW] EX-F3-02 — examples·F3
- **Symptom:** A docked, expanded example card offers no way to jump to its block in the text — the user must first collapse it, then click the collapsed body.
- **Root cause:** Editable-body card with a popout-gated jump chevron: the expanded body is an embedded expex editor that must stopPropagation to absorb typing clicks (ExampleCard.tsx:467), which collides with the card-root being the sole docked jump…
- **Repro:** Expand an example card (header click toggles it open) → Click anywhere in the expanded expex body — nothing jumps (editing focus only)
- **Status:** CONFIRMED · conf high

### [LOW] OUT-F3-02 — outline·F3
- **Symptom:** In split-pane mode with the bottom pane active, clicking an outline heading (or the 'Document start' row) to navigate the bottom pane also silently moves the...
- **Root cause:** `setTextSelection` is used as the mirror-scroll mechanism (editor-ops.ts:60,72) on a shared EditorState (EditorMirror.tsx:58); a navigation-only intent therefore relocates the single shared caret
- **Repro:** Open split-pane view; click into the bottom pane to make it active → Click a heading in the outline
- **Status:** CONFIRMED · conf high

### [LOW] SR-C1-01 — search·C1
- **Symptom:** The 'i of N' results counter can show an impossible value (e.g. '8 of 3') and leave no row highlighted after the source data changes mid-search.
- **Root cause:** Hand-rolled selection index over a derived list that can shrink from an external source, with no clamp-on-read and no source-change reset — the exact thing useCycle's read-clamp (panel-primitives.tsx:2613) was built to prevent, bypassed…
- **Repro:** Search a term that yields many results; navigate to a high index (e.g. result 8 of 10) → In another panel, delete several of the matched items (footnotes/notes/etc.) so the results list shrinks below 8
- **Status:** CONFIRMED · conf high

### [LOW] SR-F2-01 — search·F2
- **Symptom:** After a search result is selected, deleting backing items elsewhere (shrinking the result list without changing the query) leaves the result counter showing...
- **Root cause:** Index-into-derived-list not clamped on list mutation: selectedIdx is reset only on query/filter setters (SearchPanel.tsx:258/268/278/298), never reconciled against results.length when the underlying data arrays shrink; PrevNextCounter…
- **Repro:** Search across multiple scopes so there are e.g. 8 results → Select result #8 (last)
- **Status:** CONFIRMED · conf high

### [LOW] SR-F5-01 — search·F5
- **Symptom:** Clicking a non-mainText result (e.g. a footnote/citation hit) whose target panel is configured to mount on the SAME rail as the Search panel replaces Search...
- **Root cause:** openItemInPanel side-activates the target panel with no check for whether the originating (Search) panel shares that side; there is no notion of 'keep the source panel docked'.
- **Repro:** Arrange Search on the same rail that footnotes/citations resolve to → Search across mainText + footnotes; click a footnote result
- **Status:** CONFIRMED · conf medium

## C16. Plural/biblatex command toggle one-way; merge-vs-replace field updater ambiguity
*8 bugs · max severity MEDIUM.* A state mutation lacks its symmetric inverse (HAS_PLURAL singular↔plural strands the plural arg on the reverse toggle), or one field-merge primitive (updateBibEntry) serves both 'edit some' and 'replace entirely' so deletions aren't honored; per-card derived display state isn't reconciled when bibPackage changes.
**Fix locus:** src/panels/Citations/CitationCard.tsx command toggle (round-trip the plural arg) + split updateBibEntry into merge vs replace.

### [MEDIUM] BIB-A3-02 — bibliography·A3
- **Symptom:** The conflict-strip 'Replace with library' button merges the library entry's fields onto the local entry rather than overwriting — local-only fields the libra...
- **Root cause:** updateBibEntry (src/hooks/useCitations.ts:260-279) is a field-merge, used by a 'replace' caller (handleConflictReplace, BibliographyPanel.tsx:498).
- **Repro:** Have a local entry with an extra field (e.g. note={...}) whose citekey also exists in the library with different/fewer fields → Search library, click Add → conflict strip → 'Replace with library'
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [MEDIUM] BIB-F5-04 — bibliography·F5
- **Symptom:** The inline BibTeX-fields editor can neither add a new field (e.g. supply a missing DOI) nor remove an existing one — clearing a field to blank leaves an empt...
- **Root cause:** Two compounding gaps: no add-field row in the edit form (src/components/BibEntryCard.tsx:362-369) AND merge-only field semantics with no deletion honored (src/hooks/useCitations.ts:265)
- **Repro:** Open an entry missing a DOI, 'Edit entry' — there is no row to add `doi` → Clear the `pages` field to empty and Save
- **Status:** CONFIRMED · conf high

### [MEDIUM] CI-F5-01 — citations·F5
- **Symptom:** After adding a second key with a distinct page range and then removing it (or making the ranges equal again), the citation stays a plural \cites command for...
- **Root cause:** Asymmetric command-shape mutation: the only writer of type that depends on row-count/postnote-distinctness is the one-way promote at CitationCard.tsx:383; neither removeRow (:392-402) nor setRowPostnote's else-branch demotes, and…
- **Repro:** biblatex package; create \cite{a} → Add a second key b and give a and b different +range postnotes → auto-promotes to \cites[..]{a}[..]{b}
- **Status:** CONFIRMED · conf high

### [MEDIUM] CI-F5-02 — citations·F5
- **Symptom:** Switching the bibliography package (biblatex→natbib) leaves existing citation cards holding biblatex-only commands (e.g. \cites, \autocite), which then seria...
- **Root cause:** No package-migration of per-card `type`: `type` is derived once from cit.command (parseCiteCommand) and the panel-wide bibPackage flip (setBibPackage) never re-derives or validates it against the new `types` list (CitationCard.tsx:675,…
- **Repro:** biblatex; create a \autocite or a 2-key \cites card → Open the panel menu and switch Package to natbib
- **Status:** CONFIRMED · **RECLASSIFIED** · conf medium

### [MEDIUM] CI-F7-01 — citations·F7
- **Symptom:** Deleting a citation from the panel (trash button) removes it immediately with no 'this has content?' confirmation, even when the card carries keys/postnotes/...
- **Root cause:** CitationCard bypasses the shared EditableCard confirm flow entirely (uses PanelCard directly); compounded by has-content.ts having no citation case so no shared predicate could classify it even if wired.
- **Repro:** Expand a citation card with one or more keys and a postnote → Click the trash icon
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [MEDIUM] CI-F7-02 — citations·F7
- **Symptom:** After biblatex auto-promotes \cite to \cites for a multi-key citation with distinct postnotes, removing keys back down to one leaves the command stuck as the...
- **Root cause:** One-directional auto-promote in setRowPostnote (CitationCard.tsx:383) with no inverse on row reduction, AND serializeCiteCommand has no plural→singular normalization for a single entry (it honors whatever `type` carries,…
- **Repro:** biblatex package; create a citation with type \cite and two keys → Give the two rows distinct postnotes → command auto-promotes to \cites{...}{...}
- **Status:** CONFIRMED · conf high

### [LOW] BIB-F5-05 — bibliography·F5
- **Symptom:** Once a bib-review is marked 'complete', the card gives no completion affordance — the request button reverts to its idle 'Request review' label, and clicking...
- **Root cause:** Tri-state status (none|pending|complete) collapsed to a binary `=== 'pending'` check at every UI branch (src/components/BibEntryCard.tsx:222,320,408), combined with requestReview's pending-only dedup (src/hooks/useBibReview.ts:66-69) and…
- **Repro:** Request a fields review on an entry; let the AI complete it (status → complete) → After the 10s poll, the button shows 'Request review' again (no 'reviewed' indication)
- **Status:** CONFIRMED · conf high

### [LOW] CI-F5-03 — citations·F5
- **Symptom:** A citation card can end up with two rows holding the same citekey, producing a duplicate-key LaTeX command and a doubled header line.
- **Root cause:** Dedup invariant enforced only on the drag-merge route (CitationCard.tsx:514), absent on the picker route (setRowKey :361-368) — the picker writes the chosen key without consulting the other rows.
- **Repro:** Open a citation card, add a second row → Use the picker to set both rows to the same citekey
- **Status:** CONFIRMED · conf high

## C17. Mount-only / counter-gated sidecar resync not driven by the structural diff
*5 bugs · max severity MEDIUM.* Id-bearing sidecars sync from the editor once at mount (or on a too-narrow event), so out-of-band sidecar writes and id-regen-under-reparse leave the card list stale until a remount.
**Fix locus:** src/components/EditorPane.tsx syncFromEditor wiring (drive resync off the DocStructureBus structural counters, not editor mount).

### [MEDIUM] BIB-F5-02 — bibliography·F5
- **Symptom:** After the AI completes a bib-review (notes or fields), the freshly-written annotation / corrected fields do not appear in the open Bibliography panel — the p...
- **Root cause:** Asymmetric refresh: the request-status sidecar polls (useBibReview 10s) but the two content sidecars it gates do not — annotations.json (usePersistentState, load-once) and references.bib (DOC_BIB_CHANGED_EVENT only, never dispatched by…
- **Repro:** Open a bib entry, click 'Request annotation' (notes) or 'Request review' (fields) and keep the card open → Run the answer-bib-review skill so it writes annotations.json / references.bib and flips the request to complete
- **Status:** CONFIRMED · conf high

### [MEDIUM] CI-A1-01 — citations·A1
- **Symptom:** Deleting a \cite marker directly in the editor (e.g. Backspace over it, or a code-view edit) leaves a dead, dashed citation card in the panel that cannot jum...
- **Root cause:** Mount-only sidecar↔editor reconciliation for an id-bearing inline-atom kind: EditorPane.tsx:1177-1182 gates syncFromEditor on [editor] (stable across in-place edits), so no structural-diff-driven resync exists.
- **Repro:** Open a doc with a \cite citation; confirm its card is solid/anchored in the Citations panel → In the editor, place the cursor after the citation atom and press Backspace to delete the inline \cite marker
- **Status:** CONFIRMED · conf high

### [MEDIUM] CI-A2-02 — citations·A2
- **Symptom:** After a code-view re-parse that regenerates a citation's id (e.g. a manually-typed \cite with no \vcid marker, or a code edit that desyncs the marker), the m...
- **Root cause:** Same mount-only-sync root as CI-A1-01 (EditorPane.tsx:1177-1182), but the id-regeneration trigger is gated by \vcid-marker survival: the serializer emits \vcid unconditionally (latex-serializer.ts:404,699), so id loss for an existing…
- **Repro:** Open the code view and type a new \cite{key} with no preceding \vcid marker, then let it flush back to TipTap → Switch to the visual editor; the new citation either has no card (CI-F8-03) or, for a re-id'd existing one, the existing card is now dashed
- **Status:** CONFIRMED · **RECLASSIFIED** · conf medium

### [MEDIUM] CI-F8-03 — citations·F8
- **Symptom:** A \cite added or typed via the code view does not appear as a card in the Citations panel until the document is reloaded.
- **Root cause:** Code-view-originated structural additions bypass the action-registry create bridge (runAction('citation')), and the only catch-all that would register them (syncFromEditor) is mount-only (EditorPane.tsx:1177-1182).
- **Repro:** Open the code view and type \cite{somekey}; let it flush to TipTap → Switch to the visual editor — the citation renders inline
- **Status:** CONFIRMED · conf medium

### [MEDIUM] SR-A2-01 — search·A2
- **Symptom:** After searching, editing the document and then navigating results jumps/highlights the wrong text (or silently no-ops) because result positions are stale.
- **Root cause:** Position cache keyed on editor-instance identity instead of a per-transaction structural snapshot, violating AGENTS.md's rule that live positions must be resolved at measure time from the observer's mapped snapshot (useInTextPositions),…
- **Repro:** Search for a word; note its result and (if SR-F8-01 were fixed) its highlight position → Type several characters into a paragraph ABOVE the match (shifting all positions after it) — do not change the query and do not add/remove footnotes/citations
- **Status:** CONFIRMED · **RECLASSIFIED** (HIGH→MEDIUM) · conf high

## C18. Destructive delete skips confirm; unguarded clipboard; layout/glyph constants
*5 bugs · max severity MEDIUM.* A doc-mutating delete skips the confirm because cardHasContent has no case for the kind, navigator.clipboard is called unguarded, and hardcoded layout offsets/badge glyphs sit between independently-sized siblings.
**Fix locus:** cardHasContent kind coverage + a clipboard guard wrapper + the omni layout constants.

### [MEDIUM] OMNI-C2-01 — omni-left·C2
- **Symptom:** After dragging a left-side panel (e.g. Reports) to the right strip, its cards keep showing in the LEFT omni column and the user has NO way to turn them off —...
- **Root cause:** Two prefs that must move in lockstep (placements vs omniCategories) are decoupled at the movePanel writeback (useViewPrefs.ts:1011); the display filter keys off omniCategories while the menu-row visibility keys off…
- **Repro:** Open the left omni column with Reports cards visible (Reports enabled in omniCategories.left) → Drag the Reports panel from the left strip to the right strip (movePanel('reports','right'))
- **Status:** CONFIRMED · conf high

### [MEDIUM] OMNI-F7-01 — omni-left·F7
- **Symptom:** Deleting a citation from its expanded card (in the omni or docked) removes the in-text \cite{} from the document immediately, with no confirmation — a one-cl...
- **Root cause:** Finder slightly mis-attributed the atom-deletion to citationsHook.deleteCitation (which is sidecar-only filter, useCitations.ts:213-222); the actual destructive doc edit is the compound wrapper handleDeleteCitation…
- **Repro:** Open a citation card in the omni and expand it (trash only shows when !compressed) → Click the trash button
- **Status:** CONFIRMED · conf high

### [LOW] OMNI-C2-02 — omni-left·C2
- **Symptom:** When focus view is active AND there are unanchored cards, expanding the 'N unanchored' bin covers the '◎ N outside focus' pill, making it unclickable and vis...
- **Root cause:** Same as finder: hardcoded 30px offset between independently-sized absolute siblings (src/panels/Omni/OmniViewPanel.tsx:544) measured against the COLLAPSED unanchored pill height only
- **Repro:** Activate focus view with at least one card anchored outside the focus band (populates the outside-focus bin) → Have at least one unanchored/orphaned card so the 'N unanchored' bin is present
- **Status:** CONFIRMED · **RECLASSIFIED** (MEDIUM→LOW) · conf high

### [LOW] OMNI-F8-04 — omni-left·F8
- **Symptom:** Clicking 'copy citekey' on a citation card (rendered in the omni column) throws / produces an unhandled promise rejection in an insecure or clipboard-unavail...
- **Root cause:** Same as finder: unguarded navigator.clipboard.writeText with no undefined-check and (in CitationCard) no .catch (CitationCard.tsx:1104)
- **Repro:** Load Virgil in a context where navigator.clipboard is unavailable (insecure origin / restricted iframe) → Open a citation card in the omni column and click the copy-citekey control
- **Status:** CONFIRMED · conf high

### [COSMETIC] FN-F1-04 — footnotes·F1
- **Symptom:** When a paper has multiple \thanks{} acknowledgements (e.g. one per author), every acknowledgement footnote card renders an identical 'A' badge and 'Acknowled...
- **Root cause:** Constant glyph for a kind that can legitimately repeat (FootnoteCard.tsx:122 / footnote.ts:266), combined with the deliberate number:0 for thanks (footnote.ts:235) leaving no per-thanks ordinal.
- **Repro:** Open a paper whose \author{} block has two or more \thanks{...} acknowledgements → Open the Footnotes panel
- **Status:** CONFIRMED · conf high

## C19. Anchor-state derived from position resolution alone, ignoring the card's intent flag
*4 bugs · max severity MEDIUM.* Builders compute `pos==null ? 'orphaned' : 'anchored'` and never read the card's own unanchored/free flag, so an intentionally-unanchored panel-created citation collapses into the orphaned/error bin alongside a true lost-marker.
**Fix locus:** src/panels/Citations/omni.tsx:49 buildCitationOmniItems (and the example builder) — `pos==null ? (cit.unanchored ? 'free' : 'orphaned') : 'anchored'`.

### [MEDIUM] EX-F3-01 — examples·F3
- **Symptom:** Selecting (or hovering) an example card highlights only the panel card — the corresponding \ex/\pex block in the main text gets no selection halo or hover ti...
- **Root cause:** An `anchored: true` registry flag (card-registry.tsx:444) with no link the reconciler can resolve: examples carry neither a Mode-A/Mode-B Link nor a synthesized inline-atom link (the way footnote/citation get one via linkForInlineAtom,…
- **Repro:** Open a doc with an example block → Click the example's card in the panel (or hover it)
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [LOW] CI-A1-02 — citations·A1
- **Symptom:** A panel-created unanchored citation (deliberately not yet in the text) is shown in the Omni unanchored bin indistinguishably from a citation whose in-text ma...
- **Root cause:** buildCitationOmniItems derives anchorState from position resolution alone — `pos == null ? 'orphaned' : 'anchored'` (src/panels/Citations/omni.tsx:49) — and never consults the citation's own `unanchored` flag (defined on CitationRef at…
- **Repro:** Use the panel '+ Add citation' flow to create an unanchored citation (pendingCreateMode='unanchored') → Separately, create an anchored citation then delete its in-text marker
- **Status:** CONFIRMED · conf high

### [LOW] EX-A1-01 — examples·A1
- **Symptom:** An example card can never appear as an orphan; deleting the \ex block in the text makes the card silently disappear with no 'source deleted' affordance.
- **Root cause:** Root cause is the derived-from-live-nodes model: examples have no persisted sidecar that outlives the block (useExamples is dead — see EX-A2-01), so there is structurally no record to surface an orphan.
- **Repro:** Open a doc with an \ex block and the Examples panel/omni populated → Delete the example block text in the main editor
- **Status:** CONFIRMED · conf high

### [LOW] OMNI-A2-01 — omni-left·A2
- **Symptom:** A citation the user deliberately created unanchored (panel-only, never placed in text) shows in the omni unanchored bin with the red 'No anchor in document'...
- **Root cause:** Same site/mechanism as CI-A1-02: buildCitationOmniItems classifies anchorState on pos alone (src/panels/Citations/omni.tsx:49) so a panel-created unanchored citation lands in the orphaned bin under BadgeOrphaned's error theme…
- **Repro:** Create a citation via the panel without placing a \cite in the document (panel-only unanchored citation) → Open the omni unanchored bin
- **Status:** RECLASSIFIED · **RECLASSIFIED** · conf high

## C20. Cross-side activation / omni per-side clear gaps; has-content non-body fields
*3 bugs · max severity MEDIUM.* A cross-panel 'open item' side-activates a target without checking the originating panel shares that side, an omni per-side setter doesn't fully cross-clear, and has-content predicates ignore non-body fields.
**Fix locus:** The omni per-side setter + the cross-panel open handler — cross-clear and check side parity.

### [MEDIUM] EX-F5-02 — examples·F5
- **Symptom:** Edits typed directly into an example card's body cannot be undone with Ctrl+Z in the main editor.
- **Root cause:** addToHistory:false copied verbatim from the example float for double-record avoidance (ExampleCard.tsx:197); the card-body editor still owns a StarterKit History so undo is available within the card — the inconsistency is only that…
- **Repro:** Open the Examples panel, expand an example card → Type text into the example body inside the card
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [LOW] EX-F4-01 — examples·F4
- **Symptom:** Clicking a \ref inside an example card body can open the ref-edit popover anchored to a DIFFERENT ref of the same label in the main text, not the one clicked.
- **Root cause:** Event carries no clicked-element identity; bridge re-resolves by a global attribute selector that returns the first match (marker-clicks.ts:333-338).
- **Repro:** Have a label that is \ref'd in main text AND inside an example whose body is shown in an example card → Click the \ref rendered inside the example card body
- **Status:** CONFIRMED · conf medium

### [LOW] FN-A1-02 — footnotes·A1
- **Symptom:** Deleting the marker of a footnote whose body is empty (e.g. a title-only footnote, or a freshly-created blank one the user titled) produces NO orphan card —...
- **Root cause:** Emptiness gate considers only body content, ignoring the title attr: footnote.ts:204 short-circuits on `richJsonToPlainText(content).trim()` without OR-ing in `oldNode.attrs.title?.trim()`.
- **Repro:** Create a footnote, give it a title but leave the body empty → Delete its marker in text
- **Status:** CONFIRMED · conf high

## C21. Recovery record reconstructed from an attr subset; sync-insert+deferred-remove without de-dup
*2 bugs · max severity MEDIUM.* A teardown→recovery record is rebuilt from only a subset of the source node's attrs (any new per-footnote attr is silently lost on recovery), and a synchronous-insert + deferred-remove seam renders an id-keyed list with no de-dup during the transient overlap.
**Fix locus:** src/lib/tiptap/footnote.ts:202 recovery snapshot — clone the full attr set; de-dup the transient list.

### [MEDIUM] FN-A2-02 — footnotes·A2
- **Symptom:** When a footnote that has a user-authored title (or is a \thanks acknowledgement) is orphaned, the title and the acknowledgement identity are silently dropped...
- **Root cause:** Two-part gap: (1) the orphan detector projects only `content` from the dying node (footnote.ts:202-209), dropping title+thanks; (2) the OrphanedFootnote type (types.ts:564-570) has a `title?` slot but NO `thanks` field, so the…
- **Repro:** Create a footnote, give it a title via the +T affordance (or make it a \thanks acknowledgement) → Delete its marker in the main text
- **Status:** CONFIRMED · conf high

### [LOW] FN-A3-01 — footnotes·A3
- **Symptom:** During an orphan re-drop, the Footnotes panel briefly renders two cards with the SAME footnoteId — the freshly re-anchored footnote and the not-yet-removed o...
- **Root cause:** Two id-keyed lists (orphanedFootnotes, footnotes) merged without de-dup while one is updated synchronously (view.dispatch → rev bump → memo) and the other via a deferred macrotask (setTimeout(0)); the merge sites (FootnotePanel.tsx:114,…
- **Repro:** Orphan a footnote (delete its marker) → Drag the orphan card back into the document text
- **Status:** CONFIRMED · conf medium

## C22. First-match read over an append-only request log without clear/dedup
*1 bugs · max severity MEDIUM.* A per-kind request reader does a first-match .find over an append-only log that's never cleared/deduped, so it reads a stale earlier record instead of the latest matching one.
**Fix locus:** src/hooks/useBibReview.ts (and any per-kind inbox reader) — read the latest, or clear/dedup on resolve.

### [MEDIUM] BIB-F8-03 — bibliography·F8
- **Symptom:** After an AI bib-review request completes, re-requesting a review of the same entry+type shows no pending state, and the card can never re-enter the visible '...
- **Root cause:** First-match lookup over an append-only request log: getRequestStatus .find returns the earliest row not the latest (src/hooks/useBibReview.ts:96-99), and requestReview's pending-only dedup (lines 66-69) lets stale completed rows accumulate…
- **Repro:** Request a fields review; let the responder mark it complete (status flips in the JSON, picked up by the 10s poll) → Click 'Request review' again on the same entry+type
- **Status:** CONFIRMED · conf high

## C23. A numbering rule implemented twice that diverges on the \thanks edge
*1 bugs · max severity MEDIUM.* Footnote numbering exists in two places — parser numberFootnotes and the canonical appendTransaction renumber — that disagree on \thanks (parser counts it, canonical sets it to 0), so a paper with a \thanks shows every real footnote off-by-one until the first structural footnote op.
**Fix locus:** src/lib/latex-parser.ts:787-799 numberFootnotes — make it skip \thanks to match src/lib/tiptap/footnote.ts:235-243.

### [MEDIUM] FN-F1-01 — footnotes·F1
- **Symptom:** On a freshly-loaded paper, every footnote card's number badge in the Footnotes panel shows '0' (and every in-text marker shows '1'), instead of the correct 1...
- **Root cause:** The finder's symptom (all panel badges '0', all in-text markers '1' on load) CANNOT occur: parseLatex runs numberFootnotes(doc) at src/lib/latex-parser.ts:709 on every load (the early `return doc` at :683 only fires for an empty body),…
- **Repro:** Open a paper that already contains 2+ footnotes (do not add/edit any yet) → Open the Footnotes panel
- **Status:** RECLASSIFIED · **RECLASSIFIED** · conf high

## C24. Compressed-summary clamp gap (unclamped header text / empty-blank / per-card editor)
*7 bugs · max severity LOW.* Card headers derive a one-line summary from arbitrary user/.bib/borrowed-body text without the shared compressed-state clamp (bespoke chrome bypasses EditableCard), or render an empty blank via `'' ?? <CardEmptyText/>` (nullish never fires on empty string).
**Fix locus:** The shared EditableCard compressed-body clamp + makeCompressedSummary — route bespoke card chrome through it and use `|| ''` over `?? ''`.

### [LOW] REP-F5-04 — reports·F5
- **Symptom:** When a report's title is changed externally (a skill writes reports.json, or the user edits the title on a different surface) while the expanded card stays m...
- **Root cause:** Uncontrolled-input pattern in CardBodyTitle (panel-primitives.tsx:552) with a sync effect gated on editing-state only (:535); no key-on-value remount and no controlled value, so external prop changes can't reach the DOM input while mounted.
- **Repro:** Open a report expanded in the docked panel → Have a skill (or another open surface) rewrite that report's title in reports.json
- **Status:** CONFIRMED · conf medium

### [COSMETIC] BIB-F1-03 — bibliography·F1
- **Symptom:** An entry with a very long title produces a tall multi-line header even in the compressed (collapsed, unselected) card state, breaking the uniform compressed-...
- **Root cause:** The compressed-card height contract (DOCKED_COMPRESSED_LINES via CardDisplayProvider) clamps only the body; the always-rendered header has no per-line clamp, so author·year·title wraps freely
- **Repro:** Add a .bib entry with a 200-char title → View it collapsed in the Bibliography panel (not selected)
- **Status:** CONFIRMED · conf high

### [COSMETIC] CI-F1-01 — citations·F1
- **Symptom:** A collapsed multi-key citation card (e.g. \cites{a,b,c,d}) renders one header line per key, growing several rows tall instead of staying compact like every o...
- **Root cause:** CitationCard never participates in the EditableCard compressed-body pipeline at all — it short-circuits with its own header at CitationCard.tsx:751-752 — so it inherits none of the compressedBodyStyle clamp (panel-primitives.tsx:150-172).
- **Repro:** Create a citation with 4+ keys (\cites{a,b,c,d}) → Collapse the card
- **Status:** CONFIRMED · conf high

### [COSMETIC] EX-F1-01 — examples·F1
- **Symptom:** The collapsed preview of a multi-part example (\pex with a body paragraph + several \a items, or a long interlinear gloss) clips to a tiny sliver — often jus...
- **Root cause:** Fixed line-count height clamp applied to non-text-flow (CSS grid) expex content (ExampleCard.tsx:337); 1-2 prose lines underserves a multi-row grid, but this is the intended compact-preview ceiling.
- **Repro:** Open a paper with a \pex example that has a top body line plus 2-3 \a sub-items (or a \begingl gloss) → View it collapsed in the docked Examples panel (1-line clamp)
- **Status:** CONFIRMED · **RECLASSIFIED** (LOW→COSMETIC) · conf medium

### [COSMETIC] EX-F1-02 — examples·F1
- **Symptom:** Every collapsed example card mounts a full (read-only) TipTap editor; a panel/omni with N collapsed example cards holds N live embedded editors.
- **Root cause:** By-design: collapsed≡expanded render parity (#43) chose a real read-only editor over a static summary, accepting N embedded editors for N collapsed cards (ExampleCard.tsx:436)
- **Repro:** Open a paper with many (e.g. 20+) examples → View the Examples panel / omni with all cards collapsed
- **Status:** CONFIRMED · **RECLASSIFIED** (LOW→COSMETIC) · conf high

### [COSMETIC] OMNI-F1-03 — omni-left·F1
- **Symptom:** A long report/citation body collapsed in the omni is hard-cut mid-word with no ellipsis; an empty footnote collapsed in the omni shows a blank line rather th...
- **Root cause:** Surviving issue: panel-primitives.tsx:1066-1075 — the useBorrowedCompressed branch has no `value-empty ? <CardEmptyText/>` guard, unlike the summary-string branch.
- **Repro:** Add a report with a >160-char body and collapse it in the omni — the summary ends abruptly with no ellipsis → Add an empty footnote (\footnote{}) and view it collapsed in the omni — the body row is blank instead of showing 'empty'
- **Status:** CONFIRMED · **RECLASSIFIED** · conf high

### [COSMETIC] REP-F1-01 — reports·F1
- **Symptom:** A collapsed Report (or Report Request) with an empty body shows a blank summary line instead of the muted italic 'empty' placeholder that other empty collaps...
- **Root cause:** Inconsistent empty-sentinel between cards: '' (falsy but not nullish) vs undefined feeding a `?? <CardEmptyText/>` fallback
- **Repro:** Add a Report Request and leave its body empty → Collapse it (or view it collapsed in the docked panel)
- **Status:** CONFIRMED · conf high

## C25. Header / strip count derived from a subset (or raw array length) of the rendered list
*5 bugs · max severity LOW.* A panel header count is computed from one sub-list (anchored only) while the panel renders the union (anchored + orphan/pending-AI), or reports raw card-array length — the badge disagrees with what's visible.
**Fix locus:** The card panel header count prop (FootnotePanel.tsx:132 etc.) — count the union actually rendered; the raw-length cases (CI-C1-01) are reclassified COSMETIC / by-design.

### [LOW] BIB-A1-01 — bibliography·A1
- **Symptom:** The cited/uncited classification that drives whether the jump icon shows and whether the 'Cited only' filter hides an entry can disagree with the entry's act...
- **Root cause:** Two sources of truth for 'is this entry cited / where does it jump': the persisted citationsHook.citations sidecar (used for citedKeys, BibliographyPanel.tsx:211) vs the live-editor allEditorCitations (used for keyToCitationIds,…
- **Repro:** Open a doc; before citations.json syncs, observe an entry that the editor cites → If the sidecar lags, the entry may be filtered out of 'Cited only' or show a jump icon whose handler finds no target
- **Status:** CONFIRMED · conf low

### [LOW] FN-C1-01 — footnotes·C1
- **Symptom:** The Footnotes panel header count badge undercounts when orphaned footnotes are present — it shows only the anchored count (and shows nothing at all when ther...
- **Root cause:** Badge count derived from a narrower list than the rendered items: FootnotePanel.tsx:132 uses footnotes.length while items at :114 prepend orphanedFootnotes — should be footnotes.length + orphanedFootnotes.length (or items.length).
- **Repro:** Have a paper with 2 anchored footnotes and 1 orphan → Observe the Footnotes panel badge reads '2' while 3 cards render
- **Status:** CONFIRMED · conf high

### [LOW] FN-F1-03 — footnotes·F1
- **Symptom:** The Footnotes panel/strip header count excludes orphaned footnotes — a panel showing only orphan cards displays no count badge at all, and a mixed panel unde...
- **Root cause:** count derived from a subset (footnotes.length, FootnotePanel.tsx:132) of the rendered union (orphans + anchored, FootnotePanel.tsx:114-121)
- **Repro:** In a paper, delete all in-text footnote markers but keep their bodies so they become orphan cards → Open the Footnotes panel
- **Status:** CONFIRMED · conf high

### [LOW] FN-F2-02 — footnotes·F2
- **Symptom:** Keyboard ArrowUp/ArrowDown navigation in the Footnotes panel skips orphaned footnotes entirely and cycles only anchored footnotes, even though orphans are re...
- **Root cause:** Finder's mechanism is correct
- **Repro:** Open a paper that has at least one orphaned footnote and several anchored footnotes (delete the in-text callout of a footnote that has body text to create an orphan) → The orphan card appears at the TOP of the Footnotes panel; click to select it
- **Status:** CONFIRMED · conf high

### [COSMETIC] CI-C1-01 — citations·C1
- **Symptom:** The Citations panel strip count badge can exceed the number of actual in-text citations because it counts orphaned and panel-only unanchored cards too.
- **Root cause:** Not a defect mechanism: count={orderedCitations.length} (src/panels/Citations/CitationsPanel.tsx:241) reports the full card-array length, including dashed/unanchored and orphaned cards
- **Repro:** Create one anchored and one unanchored citation → Note the strip badge reads 2 while the document has only 1 in-text \cite
- **Status:** RECLASSIFIED · **RECLASSIFIED** (LOW→COSMETIC) · conf medium

## C26. Word-boundary \b regex assuming word-char-bounded tokens
*4 bugs · max severity LOW.* A whole-word matcher prepends/appends \b without an adjacency guard, so citekeys/queries containing non-word chars (`:`, `-`) mis-match or fail to rewrite; snippet renderers clamp context but not the matched span.
**Fix locus:** The shared cite-rewrite + search whole-word regex builder — use an explicit boundary class, not bare \b.

### [LOW] BIB-F7-04 — bibliography·F7
- **Symptom:** Renaming a citekey to/from a key that begins or ends with a non-word character (e.g. '+foo', a key wrapped only in punctuation) updates the entry and the par...
- **Root cause:** Asymmetric update in updateBibKeyAndType: keys[] is rewritten unconditionally (useCitations.ts:303-304) but the command string only via a \b-bounded regex (useCitations.ts:305-308) that assumes citekeys are word-char-bounded — JS \b…
- **Repro:** Have a .bib entry with citekey '+foo' (or any key with a leading/trailing non-word character) cited in the doc → Edit the entry's key field to 'bar' and Save
- **Status:** CONFIRMED · conf medium

### [LOW] SR-F1-03 — search·F1
- **Symptom:** A very long query (e.g. a multi-thousand-character pasted string) renders its full matched text inside the result <mark> with no truncation, blowing out the...
- **Root cause:** Confirmed
- **Repro:** Paste a several-thousand-character string into the search box that exists somewhere in the doc → Observe the matching result card renders the entire matched run inside the amber <mark>, growing to fill/overflow the panel with no clamp/ellipsis
- **Status:** CONFIRMED · conf high

### [LOW] SR-F1-04 — search·F1
- **Symptom:** Enabling 'Whole word' (W) and searching for a token that begins/ends with punctuation (e.g. 'foo!' or '(cf.') silently returns zero results even though the l...
- **Root cause:** Naive \b-bracketing without inspecting word-char adjacency at each boundary.
- **Repro:** Type a query ending in punctuation, e.g. 'foo!' (where 'foo!' literally appears in the doc) → Toggle W (Whole word) on
- **Status:** CONFIRMED · conf high

### [COSMETIC] SR-F1-05 — search·F1
- **Symptom:** The breadcrumb shown above a Main-text result can list the wrong section ancestry when the document skips heading levels (e.g. an H1 followed directly by an...
- **Root cause:** Same class as the finder named but the precise failure is append-instead-of-replace for skipped-level siblings, not generic 'under/over-pop'.
- **Repro:** Create a doc with an H1, then jump straight to an H4 (skipping H2/H3), then put searchable text under the H4 → Search for that text; inspect the result's breadcrumb
- **Status:** CONFIRMED · **RECLASSIFIED** (LOW→COSMETIC) · conf high

## C27. Focus-mode boundary index math mixing snapshot edges; null card-float fallbacks
*2 bugs · max severity LOW.* A boundary op rounds one edge through sectionRange and passes the other as a raw index (off-by-one at the seam), and derived card-float bodies return null for an orphan they can't represent.
**Fix locus:** src/hooks/useFocusMode.ts nudgeBoundary (round both edges) + the card-float null-return sites.

### [LOW] EX-A1-02 — examples·A1
- **Symptom:** A popped-out example panel card vanishes without explanation when its block is deleted, whereas the in-editor example block float shows a 'Source example del...
- **Root cause:** Two parallel float code paths: card floats resolve from a live ctx collection and bail to null on miss (no missing-state UI), whereas text-object floats carry an explicit `missing` flag → banner.
- **Repro:** Pop out an example from the Examples panel card (float key float:card:example:<id>) → Delete the \ex block in the main editor
- **Status:** CONFIRMED · conf high

### [LOW] OUT-F3-01 — outline·F3
- **Symptom:** Dragging the focus-band BOTTOM handle and releasing it on a paragraph-title (parTitle) row extends the band to the end of that paragraph's entire enclosing s...
- **Root cause:** snapBoundary applies section-rounding to one edge (bottom via sectionRange, useFocusMode.ts:368) and raw-index to the other (top, useFocusMode.ts:365); for a non-heading (parTitle) snap target the bottom edge expands to the enclosing…
- **Repro:** Enable 'Show par. titles' and activate (unlocked) Focus mode on a section that contains several titled paragraphs → Drag the band's TOP handle down onto the row of the 2nd titled paragraph — the band start snaps to exactly that paragraph
- **Status:** CONFIRMED · conf high

## C28. Outside-click / mousedown menu race (trigger excluded from the close-ref)
*1 bugs · max severity LOW.* A menu's outside-click ref excludes its own toggling trigger and the close fires on mousedown while the toggle fires on click, so clicking the trigger to close immediately reopens (or vice-versa).
**Fix locus:** The shared menu outside-click hook — include the trigger in the ref or unify on one event.

### [LOW] BIB-C1-01 — bibliography·C1
- **Symptom:** Clicking the Bibliography panel's '+' button while its Add menu is open reopens the menu instead of closing it.
- **Root cause:** addMenuRef (BibliographyPanel.tsx:607) wraps only the dropdown content, not the '+' trigger (which PanelHeader renders, panel-primitives.tsx:2097), and the close handler fires on mousedown (BibliographyPanel.tsx:138) while the toggle fires…
- **Repro:** Click '+' to open the Add menu → Click '+' again to close it
- **Status:** CONFIRMED · conf medium

---

## Not bugs (refuted / by-design) — 14

_4 are split-refuted (adjudicated): EX-F8-03, OMNI-C2-03, OUT-F1-02, SR-F5-02._

- **BIB-F5-03** (bibliography·F5) — Refuted on its core mechanism.
- **CI-F1-02** (citations·F1) — The core premise — 'editor regenerates citation ids on every parse so the sidecar gets fresh ids while the halo holds the old id' — is FALSE for any saved Virgil doc.
- **CI-F2-03** (citations·F2) — This is by-design and acknowledged in-code, not a defect.
- **CI-F4-01** (citations·F4) — The nested-body citation id does NOT drift relative to the sidecar.
- **CI-F4-02** (citations·F4) — The resolved `sourceEl` is DEAD CODE on this path.
- **CI-F7-04** (citations·F7) — The hypothesized silent loss does NOT occur on the only reachable path.
- **EX-F4-03** (examples·F4) — The cited mechanism does not occur.
- **EX-F8-03** (examples·F8) (split→refuted) — B prevailed on substance.
- **FN-F1-02** (footnotes·F1) — REFUTED on its load-bearing persistence claim.
- **FN-F4-01** (footnotes·F4) — REFUTED.
- **OMNI-C2-03** (omni-left·C2) (split→refuted) — A prevailed.
- **OMNI-F4-02** (omni-left·F4) — The finding's claimed end-state (footnote-nested citation is orphaned → routed to the default-collapsed unanchored bin → click selects an invisible card) does NOT occur.
- **OUT-F1-02** (outline·F1) (split→refuted) — Effectively a tie on severity — both verifiers rated COSMETIC and both noted the likely-legend reading; they split only on isReal.
- **SR-F5-02** (search·F5) (split→refuted) — A prevailed.
