# Action-menu anchor bugs — diagnosis (BUG1 + BUG2)

<!-- synthesis lead memo; verified against HEAD 932251c (v0.1.57). Read-only audit. -->

Status: **root causes verified end-to-end against current code.** Both bugs were
traced by six subsystem maps, the two chains were independently adjudicated by
three lenses each (code-correctness / test-evidence / alternative-cause), and I
re-read every load-bearing `file:line` in the corrected chains below. The
corrections from the verdicts are folded in (chiefly: the BUG1 user-visible hue
is the **green note accent / amber base**, not literal yellow; the literal-yellow
flavor needs a co-located highlight card or a `data-tint-color` mark, and the
"two recovery mechanisms race" framing is more precisely **"a present-skip
idempotency precondition was silently invalidated when the parser began
re-stamping marks"**).

---

## 1. Executive summary — the single deepest unifying culprit, as a bug class

Both bugs are two faces of **one architectural gap: a linkedAnchor's KIND and its
ANCHOR TARGET are never authoritatively owned in one place — they are re-derived,
late and lossily, from incompatible side channels, and no single policy decides
*what a card action anchors to* (range vs caret vs heading) or *what kind that
anchor is* across the create path and the reload path.**

Stated as a class:

> **An annotation anchor (the `linkedAnchor` mark) is identified solely by its
> `anchorId`. Its KIND is load-bearing app state but is (a) not serialized to
> `.tex`, (b) re-derived on reload from *which sidecar array the card lives in*,
> and (c) overwritten at parse time by a hardcoded default. Symmetrically, the
> create path has no unified "resolve anchor target" policy: the lightning menu
> flattens every collapsed-caret anchor into a `{kind:"paragraph"}` ref, so the
> dispatcher's per-kind range resolution silently fails for every non-paragraph
> anchorable block.**

- **BUG1** is the *persistence/reload* half of the class: kind identity is lost on
  the `.tex` round-trip and the corrective sidecar re-stamp is suppressed, so a
  revision anchor reloads painted as a note (and, in the racy/overlap case,
  detaches into an orphan tint with no card).
- **BUG2** is the *create-time* half of the class: there is no caret/heading
  anchoring policy on the live dispatch path, so a collapsed-caret card action on
  a heading mislabels the heading uuid as `paragraph` and silently no-ops.

They are not two unrelated bugs; they are the same missing abstraction —
**"authoritative, self-describing anchor identity + one resolve-anchor-target
policy"** — seen at the two ends of an anchor's lifecycle (create and reload).

---

## 2. BUG1 — verified causal chain (corrected per verdicts)

**Repro.** Select body text → lightning/selection action menu → "Suggest revision"
(`suggest-edit`, the revision-comment action). Reload. The selected span no longer
reads as a purple revision; it reads as a note/highlight marking. WORSE variant:
sometimes a tinted span persists with no backing card, unselectable/undeletable.

Creation is **correct**; the corruption is entirely on the reload path.

1. **Create is right.** Selection `suggest-edit` →
   `createAnchor(ed,"revision")` → `createLinkedAnchor` stamps the mark
   `{anchorId:X, kind:"revision", linkCard:"", tintColor:null}`
   (`src/components/editor-layout/card-actions/drag-handle-actions.ts:376-389`;
   `src/links/links.ts:837-867`). Then `createRevisionComment` →
   `useRevisions.addComment` writes a `kind:"comment"` card to `revisions.json`
   (`src/hooks/useRevisions.ts:164-192`). Then
   `updateLinkedAnchorCard(ed, X, "revision-comment", card.id)` re-stamps the live
   mark `linkCard="revision-comment:<id>"` (`src/links/links.ts:921-958`). In
   session the span paints purple. **No misroute into notes/highlights, no
   `tintColor` on a revision.** (Verdicts ruled out creation-time misroute.)

2. **The card's only anchor link is a poisoned single `linkedRange`.**
   `addComment` runs `addTextObjectLink` (Mode-A paragraph) then
   `setTextAnchorLink`, which **drops every textObject link and folds the
   paragraph uuid into ONE `linkedRange` link's `textObjectIds`**
   (`src/links/links.ts:1509-1523`). Because its only link is `linkedRange`,
   `hasSeparateModeALink` is false → the card **is** included in RC-B reapply
   (`src/links/_shared/reapply-mode-b-anchors.ts:73-83`).

3. **Serializer drops kind/linkCard/tintColor.** `serializeInlineSequence` emits
   only `\vlid{X}` … `\vlidend{X}` around the run; `serializeMarks` has **no
   `linkedAnchor` case** (`src/lib/latex-serializer.ts:655-689`, esp. 664/676).
   On disk the mark is reduced to its anchorId.

4. **Parser RESURRECTS every `\vlid` range as a HARDCODED `kind:"note"` mark.**
   `applyLinkedAnchorBoundaries` stamps `{anchorId: topId, kind:"note", linkId:
   topId}` for every pair (`src/lib/latex-parser.ts:858-860`), run during parse
   (`:697`). The schema default reinforces this (`kind` default `"note"`,
   `linkCard` default `""` — `src/lib/tiptap/linked-anchor.ts:39,42`). The
   revision span is now a **note-kind** mark carrying the original anchorId.

5. **RC-B builds the CORRECT corrective record, but `applyLinkedAnchors` SKIPS it
   (present-set collision on anchorId).** `buildModeBReapplyRecords` emits
   `{anchorId:X, kind:"revision", text}` for the comments array
   (`src/links/_shared/reapply-mode-b-anchors.ts:124-130`). But
   `applyLinkedAnchors` collects a present-set of in-doc anchorIds and
   `if (present.has(rec.anchorId)) continue;`
   (`src/components/Editor.tsx:1519-1534`, esp. 1532). The parser already inserted
   X (as note), so the record is dropped — `reanchorByText`, the only writer that
   would re-stamp `kind:"revision"`, never runs. RC-B runs **before** the per-panel
   reconciles (`src/components/EditorPane.tsx:1351-1364`), against the
   already-parsed doc, so the ordering holds.

   *Corrected framing (alternative-cause lens):* this is not a designed race. The
   present-skip was a **valid idempotency guard when added** (reload then produced
   no marks); the parser's `kind:"note"` re-stamp landed later and silently broke
   its precondition. `reapply-mode-b-anchors.ts:3-4` even still documents the now-
   **false** invariant "the .tex parse drops every in-doc linkedAnchor mark."

6. **RC-A resolver is kind-blind and never re-stamps the doc mark.**
   `buildResolveIndex.anchorIdToParagraph` maps the note mark by anchorId with no
   kind check (`src/links/resolve-card-anchor.ts:116-135`); rung 2 returns
   `source:"mark"` purely on anchorId presence (`:222-237`);
   `reconcileCardToResolved` no-ops on `source:"mark"` and only ever rewrites the
   sidecar `card.links` — never the doc mark's kind (`:360-369`). Nothing
   downstream corrects `kind:"note"`.

7. **Render paints the note token.** With `linkCard=""` and `kind:"note"`,
   `linkedAnchorRenderAttrs` derives the token from the legacy kind via
   `dataLinkCardTokenForLegacyMarkKind("note")` → `"note"` → `data-link-card="note:"`
   (`src/lib/tiptap/linked-anchor-attrs.ts:61-69`;
   `src/cards/legacy-token-crosswalk.ts`). **Corrected hue:** `note:` paints the
   GREEN note accent `#15803d` (`src/app/globals.css:2640`), **gated** by
   `[data-show-hl-note="true"]` (`:2703-2711`). An *unrecognised/empty* kind would
   instead fall to the amber base `#fbbf24` (`:2631`). Literal ungated yellow is
   only `.linked-anchor[data-tint-color]` (`:2673`, `!important`), which a pure
   revision can never reach (serializer drops tintColor; parser sets none;
   `reanchorByText` sets none). So the reported "yellow note-highlight" is most
   likely the user's loose naming of the green note accent (or the amber base, or
   a genuinely co-located highlight card) — **the KIND-corruption mechanism is
   confirmed; the exact hue is the one open item, pinnable only by a live FSA
   reload.**

8. **Orphan-no-card (WORSE) variant.** If a `\vlid` round-trips with no live
   backing card (a delete path that omitted `editor`+`anchorId` —
   `src/cards/delete-margin-item.ts:118-121` strips the mark only when both are
   passed — or a lost/raced sidecar write, or the production-FSA snapshot-drop
   race per memory `anchor_persistence_dev_masks_fsa`), the parser stamps
   `kind:"note"`; the orphan reaper keys on anchorId only and is
   `setTimeout(0)`-gated (`src/links/_shared/useLinkedAnchorReconciler.ts:75-90`),
   so a save inside that window re-persists the stale `\vlid`; and the revision
   orphan listener ignores `kind:"note"` (it gates on
   revision/comment/revision-suggestion — `src/hooks/useRevisions.ts:538-543`), so
   the stale `textRange` is never cleared either. A coloured span persists that the
   panels cannot reach. **This variant is real but conditional** (timing/FSA-race
   gated), per all three verdicts.

**Deepest culprit (BUG1):** `anchorId` is treated as the sole identity of a
linkedAnchor; `kind` is load-bearing but is neither serialized nor reconciled
against the sidecar, and the parser's default kind permanently wins whenever the
same anchorId survives the round-trip. `note` is merely the default that happens
to be correct — **revision / cutter / todo / report / highlight all degrade
identically.**

---

## 3. BUG2 — verified causal chain (corrected per verdicts)

**Repro.** Collapsed cursor on a section title (heading) → lightning menu →
"Comment"/"Suggest revision" → nothing happens. Selecting the heading text first
makes it work.

1. **Menu opens in cursor mode with the HEADING's uuid as `paragraphUuid`.** A
   heading is anchorable (`isAnchorableNode` is true for any uuid-bearing node —
   `src/lib/marginalia.ts:48-50`); `resolveAnchorableNode`/`ensureAnchorUuid`
   return the heading's own uuid (the paragraph-defer skip at
   `src/lib/anchor-uuid.ts:47-49` is gated on `type.name==="paragraph"`, so it
   never applies to a heading; uuid returned at `:76`).
   `SelectionActionsMenu` computes `mode = sel.empty ? "cursor" : "selection"` and
   passes `menuTarget.uuid` as `paragraphUuid`
   (`src/components/SelectionActionsMenu.tsx:326-333, 349-355, 399`).

2. **`runAction` (cursor) hardcodes the dispatch ref `kind:"paragraph"`.**
   `mode==="cursor" ? {kind:"paragraph" as const, id: paragraphUuid} : {…selection}`
   (`src/components/ActionsMenuPanel.tsx:206-214`, esp. **207-208**). The SAME
   component builds the **correct** `{kind:"cursor", pos, paragraphId}` ref for the
   grey-out applicability probe at `:398-400` — **the dispatch path diverged from
   the probe path.**

3. **Dispatch routes it as an annotation action.** `actionClass("suggest-edit")` =
   `"annotation"` (`suggest-edit` ∉ `LIFECYCLE_ACTIONS={duplicate,archive,delete}`
   — `src/components/editor-layout/card-actions/drag-handle-actions.ts:961-968`);
   `resolveRefRange(ed, ref, "annotation")` is called at `:192`.

4. **`resolveRefRange` returns null.** `ref.kind==="selection"` short-circuit is
   skipped (`:988`); `isTextObjectKind("paragraph")` is **true**
   (`src/text-objects/types.ts:49`) so there is **no** early null at `:996`
   (a verdict correction to the chain's "skips the heading branch" wording — the
   exit point is the generic walk, not an early bail); paragraph meta is
   `isRange:false`, so the `isRange` branch (`:999`) and the heading branch
   (`:1011`, gated on `ref.kind==="heading"`) are skipped; the generic descendants
   walk (`:1024-1028`) requires `node.type.name==="paragraph"` **AND**
   `uuid===headingUuid` — no paragraph carries a heading uuid → result stays null
   (`:1048`).

5. **Annotation action bails SILENTLY.** On `!resolved`, only `LIFECYCLE_ACTIONS`
   call `notifyStaleRef`; `suggest-edit` returns with no feedback
   (`drag-handle-actions.ts:193-204`). The `suggest-edit` create body
   (`:376-389`) is downstream of the bail and never runs. "Nothing happens."

6. **The button was clickable** because the grey-out probe used the correct
   `{kind:"cursor"}` ref and `suggest-edit` is selection-mode `"optional"`
   (`src/lib/actions/action-registry.ts:2506`; `selectionModeDisables` returns
   false for non-`"required"` — `:866-869`). A live-but-dead button: enabled by
   the cursor-ref probe, no-op'd by the paragraph-ref dispatch.

7. **Proof the heading branch would have worked.** If `ref.kind` were `"heading"`,
   `resolveRefRange` would call `collectAnnotationRange` →
   `getHeadingLineRangeByUuid` (`src/text-objects/text-object-registry.ts:400-404`;
   `src/lib/section-range.ts:68-85`) returning the non-empty heading-LINE range
   `{pos+1, pos+nodeSize-1}`; `wantRangeAnchor` stays false for a non-selection
   ref, so it lands as a **Mode-A** revision comment. **Selection-on-heading works**
   because the selection ref short-circuits at `:988-993` and never resolves by
   uuid.

8. **Paragraph-cursor works** (proves heading-specificity): a `{kind:"paragraph",
   id:<realParaUuid>}` ref matches a paragraph node at `:1024` → content range →
   Mode-A comment. Confirmed by the existing test
   `drag-handle-dispatch-nits.test.tsx:260-274` (cursor-only `{kind:"paragraph",
   id:"para-A"}` succeeds).

**Deepest culprit (BUG2):** there is no unified "what does an annotation anchor to
when there is no live range" policy across block kinds and surfaces. Two divergent
ref vocabularies coexist — the registry/applicability layer has a first-class
`{kind:"cursor"}` ref (`ActionRef`), while the live dispatch vocabulary
`DragHandleRef = TextObjectRef | SelectionRef`
(`drag-handle-actions.ts:73`) has **no cursor kind**. `ActionsMenuPanel` bridges
the gap by **flattening every cursor anchor into a fake `{kind:"paragraph"}` ref**,
which only matches a real paragraph, and the dispatcher's **silent annotation
bail** hides every other-kind failure.

*Verdict correction to the tracer's wording:* `cardResolveScope` does NOT walk a
bare `{kind:"cursor"}` ref up to the heading line — for a cursor ref it returns a
**zero-width** `{pos,pos}` (`action-registry.ts:961-963`); only the dedicated
`{kind:"heading"}` branch (`:994-1001`) resolves the line. So a fix that merely
routes cursor refs through `cardResolveScope` is **insufficient** unless
`runAction` also derives the real node kind. This matters for the fix design in §5.

---

## 4. Unifying analysis — one deep culprit, two ends of the lifecycle

The user's hypothesis space is correct, and the answer is **one deep culprit, not
two.** Both bugs live at the seam between (a) *how an action decides what to anchor
to* (range vs collapsed-caret vs heading) and (b) *how that anchor's kind/identity
survives the `.tex` strip + sidecar-driven reload*. Those two seams are the same
missing abstraction viewed at opposite ends of an anchor's life:

- **The anchor's KIND/IDENTITY is never authoritative.** It is set live, dropped on
  serialize (`latex-serializer.ts:664`), re-minted as a hardcoded default on parse
  (`latex-parser.ts:859`), and then *re-derived from card-array membership* by
  RC-B (`reapply-mode-b-anchors.ts:124-130`). Three independent producers of the
  same fact, none authoritative, reconciled only by an anchorId-keyed present-skip
  that can pick the wrong one (`Editor.tsx:1532`). That is BUG1.

- **The anchor's TARGET is never resolved by one policy.** "What range does this
  card action bind to given a selection / a caret / a heading?" is answered three
  different ways: the registry's declarative `cardResolveScope`, the live
  dispatcher's `resolveRefRange`, and `ActionsMenuPanel`'s cursor-mode flattening —
  and they disagree precisely on the caret/heading case. That is BUG2.

The connective tissue is that **kind and target are both treated as derivable
side-effects of position + array membership, rather than as authoritative
properties of the anchor itself.** Fix that one idea — *an anchor self-describes
its kind and is created through one target-resolution policy* — and both bugs, plus
the whole `relatedPhenomena` set below, fall out together. So: **ONE deep culprit.**
(BUG2's create-time and BUG1's reload-time fixes touch different files, but they
are two implementations of the same principle, and the orphan-tint class sits at
the intersection of both.)

---

## 5. Proposed deep architectural fix (not surgical patches)

Three coordinated changes, each implementing one face of "authoritative,
self-describing anchor identity + one resolve-target policy." Together they capture
the full phenomenon range, not just the two reported symptoms.

### (i) Make anchor KIND/IDENTITY authoritative and self-describing — reload never re-derives it from array membership

**Principle:** the `\vlid` marker (or its reload reconcile) must carry enough to
restore the true kind/linkCard, and the parser must not paint a default that can
win over the sidecar.

Pick ONE of these (in order of preference), each of which closes BUG1 at the class
level:

- **(a) Encode kind in the marker.** Extend the `.tex` marker to
  `\vlid{X}{<kind>}` (or `\vlid{X}` + a sibling `\vlidkind`) so the parser restores
  the real kind instead of hardcoding `"note"`. Touches
  `serializeInlineSequence` (`src/lib/latex-serializer.ts:655-689`),
  `parseInlineContent` + `applyLinkedAnchorBoundaries`
  (`src/lib/latex-parser.ts:362-389, 821-873` — drop the hardcoded `kind:"note"` at
  `:859`), and `ensureVirgilCommands` (`src/lib/latex-serializer.ts:85-86`) so the
  extra arg is a real-LaTeX no-op. Most robust; survives even a missing sidecar.

- **(b) Make the reload reconcile authoritative over the parser default.** Stop
  treating the parser stamp as ground truth: in `applyLinkedAnchors`, instead of
  **skipping** when `present.has(anchorId)`, **reconcile** — if the present mark's
  kind/linkCard disagrees with the record's, re-stamp it.
  (`src/components/Editor.tsx:1519-1534`.) Requires threading `linkCard`/`cardId`
  and `tintColor` into the record + into `reanchorByText`
  (`src/links/links.ts:964-1017`) so the re-stamp is faithful (today it passes no
  cardId and no tintColor). Also add a `tintColor` field to `ModeBReapplyRecord`
  (`src/links/_shared/reapply-mode-b-anchors.ts:51-55`).

- **(c) Let RC-B own all Mode-B re-stamping** by having the parser NOT stamp
  linkedAnchor marks at all (emit the boundary sentinels but defer the mark to the
  reconcile). Cleanest conceptually, but the highest-blast-radius change; gate it
  behind a flag.

**In all variants:** also make the RC-A resolver and the orphan listeners
**kind-aware** so a removed mark routes to the owning panel regardless of the
parser default — `buildResolveIndex`/`resolveCardAnchor`
(`src/links/resolve-card-anchor.ts:116-135, 222-237`),
`useLinkedAnchorReconciler` (`src/links/_shared/useLinkedAnchorReconciler.ts:75-90`),
the `virgil-anchor-orphaned` dispatch carrying the *card's* kind not the *mark's*
default (`src/lib/tiptap/linked-anchor.ts`), and `useRevisions`'s kind-gated
listener (`src/hooks/useRevisions.ts:538-543`).

### (ii) One resolve-anchor-target policy: selection / collapsed-caret / heading handled uniformly

**Principle:** a single function answers "given a ref, what range/target does a
card action bind to," with a **Mode-A fallback when there is no live range**, and
both the applicability probe and the live dispatch call it.

- Extend the dispatch vocabulary `DragHandleRef` with a first-class **`CursorRef`**
  (`{kind:"cursor", pos, paragraphId}`) so the dispatcher no longer needs the
  paragraph flattening (`src/components/editor-layout/card-actions/drag-handle-actions.ts:73`).
- In `ActionsMenuPanel.runAction`, **stop hardcoding `kind:"paragraph"`** — either
  emit the `CursorRef` directly, or derive the real node kind at `sel.head` via
  `resolveAnchorableNode` and emit `{kind:<realKind>, id}` (heading →
  `{kind:"heading"}`) (`src/components/ActionsMenuPanel.tsx:206-214`). Note: per the
  §3 correction, a bare cursor ref is **not** enough on its own — the resolver must
  map a cursor-on-heading to the heading line, so either the `CursorRef` carries the
  node kind or `resolveRefRange` resolves the cursor's enclosing anchorable node.
- Teach `resolveRefRange` to resolve a `CursorRef`: find the enclosing anchorable
  node at `pos`, and route headings to `getHeadingLineRangeByUuid` (annotation) /
  `getSectionRangeByUuid` (lifecycle), paragraphs/lists/etc. to their content range
  — i.e. converge it with the registry's `cardResolveScope`
  (`drag-handle-actions.ts:983-1049`; `src/lib/actions/action-registry.ts:961-1001`;
  `src/lib/section-range.ts`). Ideally make `cardResolveScope` the single SSOT both
  the probe and the dispatcher call, removing the "declarative-only" divergence its
  own JSDoc admits (`action-registry.ts:949-951`).
- **Stop the silent annotation bail from hiding ref-resolution regressions:** when
  an annotation resolve returns null, emit a dev-assert/notify (not a user error for
  the legitimate stale case, but visibility) so the next mislabel can't fail
  invisibly (`drag-handle-actions.ts:193-204`).

### (iii) Eliminate the orphan-tint-without-card class

**Principle:** a painted span must always be reachable from a card, or be reaped
deterministically — never depend on a `setTimeout(0)` race or on the delete path
remembering to pass the editor handle.

- Make card deletion **always** strip the in-doc mark: remove the
  `anchorId && editor` precondition by guaranteeing the editor handle is threaded to
  every delete call site, or strip on the next reconcile pass keyed off the sidecar
  delete (`src/cards/delete-margin-item.ts:118-121`).
- Make the orphan reaper **synchronous with reconcile** (run it as part of the RC
  pass rather than a detached macrotask) and **kind-aware**, so a resurrected mark
  with no alive card is reaped in the same frame it's detected, before any autosave
  can re-persist the stale `\vlid`
  (`src/links/_shared/useLinkedAnchorReconciler.ts:75-90`).
- Once (i) makes the round-trip faithful and (ii) stops minting overlapping
  second anchors on already-annotated text, the indexOf-first-match displacement in
  `reanchorByText` (`src/links/links.ts:971-993`) should additionally be anchored by
  the card's stored paragraph uuid (not a doc-wide first occurrence) and made
  multi-text-node aware (today `to` is dropped when the snapshot crosses an inline
  atom, `:985-993`), removing the "highlight lands on the wrong span" orphan route.

---

## 6. Related phenomena this fix would also resolve

From the tracers' `relatedPhenomena` + the maps' `suspectedDefects`:

- **Cutter, todo, and report range anchors all reload as note-highlights** by the
  exact same `\vlid` round-trip + present-skip mechanism (parser default `note`
  wins). The red cutter accent (`globals.css:2642-2644`) and stone todo accent
  (`:2649`) are lost identically. (i) fixes all of them.
- **Highlight cards lose their persistent yellow tint on reload** — `tintColor` is
  dropped by the serializer and never restored by `reanchorByText` or the parser;
  the only ungated yellow (`data-tint-color`, `globals.css:2673`) can't be
  reconstructed from the sidecar. This is the deferred "highlight-tint suppression"
  item (memory `card_archive_status`). (i)(b) restores it via the record+writer
  `tintColor` thread.
- **Cross-reload orphan-event mis-routing for every non-note kind** — a
  revision/cutter/todo mark removed after reload fires `virgil-anchor-orphaned`
  with the parser's default `note`, so the owning panel's kind-gated listener never
  clears the dead `textRange`; stale sidecar anchors accumulate across reloads.
  The kind-aware orphan routing in (i) fixes this.
- **Every collapsed-caret annotation card action through the lightning menu on a
  HEADING silently no-ops** — not just `suggest-edit`: note, footnote, citation,
  todo, cutter, report all build the same `{kind:"paragraph", id:headingUuid}` ref.
  (ii) fixes the whole row.
- **The same flattening produces a silent no-op on ANY non-paragraph anchorable
  block at a caret** — list/listItem/blockquote/codeBlock and atom blocks
  (displayMath/latexComment). `DEFERRING_PARENTS` (`anchor-uuid.ts:23-28, 47-49`)
  means a caret inside a `listItem`/`blockquote`/`codeBlock`/`exampleItem` skips the
  inner paragraph and `resolveAnchorableNode` returns the **container's**
  non-paragraph uuid; `ActionsMenuPanel` flattens it to `{kind:"paragraph", id:<containerUuid>}`,
  which `resolveRefRange` can never match → null → silent bail. (ii)'s real-kind
  resolution fixes the class. **CONFIRMED EMPIRICALLY (user, 2026-06-19):**
  `listItem + caret + Note → no card` reproduces this exactly, the second data
  point after `heading + caret + Comment`. So BUG2 is now confirmed across **two
  block kinds × two actions** (heading×comment, listItem×note) — it is the general
  *collapsed-caret-has-no-Mode-A-fallback* class, not a heading quirk.
- **"Live-but-dead buttons" across the lightning surface** — the probe (cursor ref)
  enables while the dispatch (paragraph ref) no-ops. (ii) converging probe and
  dispatch on one policy removes the whole enabled-but-inert class.
- **Highlight-overlaps-revision repaint + textRange strip** (a contributing BUG1
  path): `reanchorByText` doc-wide first-match + highlights-last setMark can
  overwrite a co-located revision's mark, firing `virgil-anchor-orphaned{revision}`
  → `useRevisions.clearCardAnchor` demotes the card to a bare paragraph anchor
  (`reapply-mode-b-anchors.ts:139-140`; `links.ts:971-993`; `useRevisions.ts:534-544`).
  (iii)'s uuid-anchored reanchor removes the false overlap.

---

## 7. Risks, open questions, and what a live repro/test should confirm

**Open questions (need a live FSA reload on the dev doc — the preview masks these
per memory `anchor_persistence_dev_masks_fsa`):**

1. **Exact BUG1 hue.** The common-case chain produces `data-link-card="note:"` →
   GREEN note accent, gated by the default-ON show-note toggle — NOT literal
   yellow. The user reported "yellow." Confirm whether the user sees (a) the green
   note accent, (b) the amber base `#fbbf24` (if the kind token resolved empty), or
   (c) a genuine co-located highlight card's `data-tint-color`. This determines
   whether (i) alone suffices or whether the overlap path (iii) is also user-facing.
2. **Show-note-highlight toggle default in the user's prefs.** If OFF, the reloaded
   note accent is *invisible* and the user would instead notice the LOST purple
   revision tint — a different report than "turned yellow."
3. **Frequency of the true-orphan (undeletable) variant** — depends on which
   delete/clear paths omit `editor`+`anchorId` (`delete-margin-item.ts:118`) and on
   the production-FSA snapshot-drop race. Needs a grep of every `handlers.delete`
   call site to confirm the editor handle is always threaded, plus a live FSA repro.
4. **BUG2 blast radius** — the static trace predicts note/footnote/citation/todo/
   cutter/report and list/blockquote/codeBlock carets all no-op identically.
   **Now partially confirmed:** `heading×comment` AND `listItem×note` both reported
   by the user (2026-06-19), matching the flattening mechanism exactly. The
   remaining cells (footnote/citation/todo/cutter/report × blockquote/codeBlock/
   exampleItem/atom-blocks at a caret) are still static-only — a live dev-doc walk
   would close the matrix, but the shared root cause makes them near-certain.

**Risks of the fix:**

- (i)(a) changing the `.tex` marker shape is a **format migration** — old `\vlid{X}`
  must keep parsing (back-compat branch in the parser), and the round-trip test
  (`src/lib/__tests__/linked-anchor-roundtrip.test.ts`) currently asserts only
  `{anchorId,text}` and must be extended to assert kind survives.
- (i)(c) (parser stops stamping marks) has the widest blast radius and risks a
  flash of unpainted anchors before RC-B runs; gate behind a flag.
- (ii) introducing `CursorRef` touches the dispatch ref type and every consumer;
  the keystroke-sanctity contract is not implicated (this is gesture-time, not
  per-keystroke), but the registry `cardResolveScope`/dispatch convergence must keep
  the declarative applicability behavior intact.
- (iii) making the reaper synchronous must NOT violate keystroke sanctity — it must
  run on the reconcile pass / structural-diff, not on every transaction.

**Tests to add before implementing (the current blind spot):**

- A round-trip test that serializes a **revision** (and cutter/todo/report)
  anchor → parses → runs RC-B reapply → asserts the live mark's kind is restored
  (today no test combines `parseLatex` + `applyLinkedAnchors` + the present-skip;
  the existing RC-B tests mount a mark-FREE doc, so the collision is never
  exercised — `reapply-mode-b-anchors.test.ts`).
- A dispatch test: `{kind:"paragraph", id:<headingUuid>}` (and a `CursorRef` on a
  heading) → assert the comment lands on the heading line (mirrors the existing
  paragraph-cursor success test `drag-handle-dispatch-nits.test.tsx:260-274`).
- A negative test locking in: cursor-on-heading annotation actions must NOT silently
  produce nothing (assert a card is created post-fix).
