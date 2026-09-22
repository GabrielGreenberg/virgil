<!-- last-verified: aea05929 2026-09-20 -->
<!-- derives-from: AGENTS.md#laws -->

# Capture/schema symmetry — never delete what you cannot restore

> **A destructive action must never delete content its capture destination cannot represent.** A card body that holds a verbatim slice of the document declares `bodySchema: "excerpt"` in `CARD_REGISTRY` and mounts the FULL main-document vocabulary; anything that deletes-and-captures validates the capture against that schema (`canMountInCardBody`) **before** dispatching the delete, and aborts + notifies if it doesn't fit.

This is the "archiving a section destroyed it" class (task 308). It is silent in *both* directions, which is why it needs a law rather than care: the capture is faithful (nothing looks wrong at write time), and **TipTap does not throw on a schema mismatch** — `createNodeFromContent` swallows the `RangeError` and returns an **empty document** (`enableContentCheck` is off), so the card renders blank with only a `console.warn`. Net effect: gone from the doc, blank in the card, and the first keystroke in that blank body persists the empty doc back over the capture. An unknown **mark** and an unknown node type at **any depth** all blank the whole document identically.

Two scopes, one SSOT in [src/lib/tiptap/borrowed-schema.ts](../../../src/lib/tiptap/borrowed-schema.ts):

- **`"card"`** (`CARD_STARTER_KIT_CONFIG`) — authored card prose. No heading / blockquote / codeBlock / horizontalRule; the footnote/note rationale, still correct.
- **`"excerpt"`** (`EXCERPT_STARTER_KIT_CONFIG` + `buildExcerptOnlySchema`) — a document slice. Full StarterKit block vocabulary + the expex family + `titleField`/`maketitleMarker` + the `highlight`/`textColor` marks + the nested `footnote` marker. Today's only member is `archive`.

`EditableCard` resolves the scope **once** from the kind (`bodySchemaForCardKind`) and threads the same value to both body surfaces — `RichTextField` (expanded) and `BorrowedMainText` (compressed) — so a card's two views can never mount different schemas. That asymmetry was itself a live bug: `BorrowedMainText` registered `footnote` and `RichTextField` did not, so an archived paragraph carrying a `\footnote` rendered fine collapsed and blanked on expand.

CI: [src/lib/\_\_tests\_\_/…/excerpt-schema.test.ts](../../../src/lib/tiptap/__tests__/excerpt-schema.test.ts) pins the **reverse** contract — every node **and** mark type the MAIN editor registers must be mountable in the excerpt schema. The pre-existing `borrowed-schema.test.ts` invariant runs one-directionally (borrowed ⊆ main) and therefore structurally *cannot* catch a main-only type reaching a card; this is the direction that does. A new main-editor node kind fails CI until the excerpt surface admits it — or until you confirm the guard refuses it, which turns a would-be data loss into a refusal. `archive-section-capture.test.tsx` pins the dispatcher end: the section is captured whole, and a capture that can't mount leaves the document **completely untouched**.

### The payload half: a guard judges the payload the write will STORE

Same law, and the case where the invariant was right, the schema was right, the
normalizer was right, and the guard was asking about a document that never
reaches disk (task 393). The 308 check validates the capture against the
destination's real schema — the one check that cannot drift from what the body
will do — and it was handed the RAW slice, while the write path stores the
NORMALIZED one. `normalizeRichContent` strips `DOC_ONLY_MARKS` (`linkedAnchor`,
the doc-level anchor mark), and the excerpt schema deliberately does not register
that mark **for exactly that reason** — the excerpt-schema contract test names it
as the one sanctioned omission, `STRIPPED_BY_NORMALIZER`.

So the two tables disagreed by construction. Any passage carrying a Mode-B
`\vlid{…}` span — i.e. worked-over prose, which is the prose a user most wants
to archive, since anchors accumulate there — was refused with "the Archive panel
can't hold part of it, so nothing was removed": **a false refusal, protecting
against a loss that cannot happen, and blocking the action entirely.** Nothing
threw; the guard was doing its job perfectly on a payload nobody stores.

> **A destructive capture derives its payload ONCE, through one door, and the
> object it VALIDATED is the object it STORES.** Normalize first, validate that,
> hand it back — so the guard and the write cannot again disagree about what is
> being judged. And when the check does fire, the refusal NAMES the construct it
> could not hold.

[src/lib/tiptap/card-body-capture.ts](../../../src/lib/tiptap/card-body-capture.ts) is the
door (`prepareCardBodyCapture`, slice-or-JSON → the normalizer's own strip →
`canMountInCardBody` → `{ ok, content }`). Five rules it earned:

- **The door owns the whole derivation, including the slice walk.**
  `sliceToDocJson` moved off the dispatcher into it, so "capture → storable
  payload" is one function rather than a sequence a call site assembles. That is
  the property, not the tidiness: a caller that can reach the pieces re-derives
  the payload and spells none of the census's needles (the task-273 rule, one
  medium over).
- **`canMountInCardBody` stays the SCHEMA question and remains the only probe.**
  The door calls it; it was never wrong. What was wrong was a capture site asking
  it. Its docstring now says so, and the census draws the line.
- **A refusal names the construct, DERIVED rather than parsed.**
  `unsupportedConstructs(schema, json)` ([schema-mount.ts](../../../src/lib/tiptap/schema-mount.ts))
  walks the model and reports the node/mark names the destination schema has not
  got — the schema's own vocabulary, never ProseMirror's message FORMAT, which is
  a dependency's implementation detail. Run only on the failure path: the
  mechanism decides, the probe explains (`checkKeptEverything`'s own rule).
- **The naming FAILS OPEN to the raw reason.** `nodeFromJSON` also throws on a
  malformed model whose every type name is known (a text node with no `text`, a
  non-array `content`), so an empty construct list is not evidence that nothing
  was wrong — the phrase degrades to ProseMirror's message rather than claiming
  completeness.
- **The anchored card's own lifecycle is unchanged, and that is pinned as a
  DECISION.** Archiving text carrying another card's Mode-B anchor puts that card
  on the normal orphan path — asserted as an EQUALITY against a plain Delete over
  the same range, so neither action can drift alone.

CI: [card-body-capture.test.ts](../../../src/lib/tiptap/__tests__/card-body-capture.test.ts)
(the door contract + the census) and
[archive-anchored-capture.test.tsx](../../../src/components/editor-layout/card-actions/__tests__/archive-anchored-capture.test.tsx)
(Gabriel's passage end to end through the REAL hook and the REAL extension
stack). **No pre-393 suite could see this**: every archive fixture in the repo is
UNANCHORED, so the raw and the normalized payload are the same object and the
divergence is unrepresentable in all of them. The leg with teeth is the CENSUS —
the door was never the part that could misbehave, a capture site that validates
one payload and stores another is, and that type-checks perfectly: no production
file may CALL `canMountInCardBody` outside the door (allowlist EMPTY, a hit is
MIGRATE-it), the door must spell `normalizeRichContent`, and every capture site
— DISCOVERED from the tree, so the next one inherits the rule — must enter the
door. Measured by neutering each half in turn: the pre-393 raw validation takes
4 legs, the naming half 1, a re-added direct probe call 1, and a capture site
leaving the door 1.

**Owed, not claimed:** the preview eyeball. This class is FSA-masked for the
real-paper flow (anchor behaviour reproduces under prod File System Access), so
the durable proof here is the unit contract; Gabriel's exact passage is the
fixture.

**The census's population is discovered by the QUESTION, not by who mints (task
565).** 393's needle was `createArchiveSnippet(` — who MINTS a snippet — and
`EditorHandle.archiveSelection` minted nothing: it returned raw slice JSON for a
caller to mint (inline children at doc level, the shape `slice-capture.ts` says
throws the moment the body mounts), normalized nothing, asked no schema, deleted
FIRST and re-homed no anchor — a dead capture outside the door with zero
callers, invisible to the mint needle, and exactly what the next agent asked to
"archive the selection" would reach for off the handle. DELETED, with
`restoreExcerptAtCaret`'s equally dead legacy-string arm (`useArchive`'s
migrator normalizes every snippet at load, so no string ever reached it — and
the arm handed a string to `insertContentAt`, which parses it as HTML; the door
is typed `JSONContent` end to end now, and the migrator is the ONE place a
string becomes content). The census asks the question a capture site answers —
cut a range OUT (`doc.slice(` + a delete verb) and KEEP a JSON copy (`.toJSON(`),
in one declaration — over `src/components/**` + `src/lib/**`, resolved through
`enclosingDeclaration`, hoisted into `_source-scan.ts` from the refocus census
so a FIFTH private region resolver was not minted. A MOVE cuts and re-inserts, a
CONVERSION cuts and rebuilds, a COPY keeps and deletes nothing — none spells all
three, so the allowlist is EMPTY by construction; measured on the pre-565 tree
the needle names exactly the retired handle, and a synthetic canary in its shape
(with a mover, a copier, a converter and a doored capture as controls) keeps the
leg from going vacuous on a tree whose population is empty.

### The displacement half: a capture SETS TEXT ASIDE, so the margin context it displaces RE-HOMES

Same door, the cards the capture did not capture (task 491) — and the case where
the pre-existing behaviour was a DECIDED contract, pinned as an equality, and
overruled by the user it was decided for.

Gabriel, from a real paper: *"when you archive a passage that has an archive
card, you loose the original archive card. they should just stack up on the
preceeding paragraph."* Task 393 had pinned the opposite explicitly — archiving
text that carries another card's anchor puts that card on the normal ORPHAN
path, **asserted as an EQUALITY with a plain Delete over the same range**. Post
task 410 the orphan is not literally lost (it reaches the gutter's
"N unanchored" bin), but it leaves the margin, which is what the user
experiences as loss.

> **A DELETE removes the context, so a card that pointed at it has nowhere to
> be. An ARCHIVE sets the text ASIDE — the passage still exists, one panel over
> — so the margin context has somewhere to be: the surviving neighbour, which is
> exactly where the fresh snippet lands. One neighbour, resolved ONCE per
> gesture, read by BOTH halves — that is what "stack up" means.**

[resolveDisplacedAnchorTarget](../../../src/text-objects/anchor-resolution.ts) resolves
the neighbour; [retargetDisplacedAnchors](../../../src/cards/retarget-anchors.ts) moves
the anchors. Seven rules they earned:

- **The scope is drawn at the ANCHOR MODE, and the 393 equality survives on the
  half it was actually about.** Every **Mode-A paragraph-anchored** card
  re-homes, because its anchor is a paragraph IDENTITY the neighbour can carry.
  A **Mode-B (`linkedAnchor`)** anchor names the TEXT RANGE, and the range is
  precisely what left — so those keep the pre-491 path
  (`cleanupLinksInRange` → the kind's `lifecycle.delete`), which the archive and
  delete branches SHARE, so widening here would silently change what Delete
  does. Task 393's leg is renegotiated in place, scoped to Mode-B with the reason
  at the site, and the Mode-A asymmetry is pinned beside it.
- **A Mode-A anchor lives on the CARD, so the sweep asks the COLLECTION.**
  Nothing in the removed slice marks it, so it cannot be found by walking the doc
  the way `cleanupLinksInRange` finds atoms and marks. The question has to be
  asked from the other side — *which cards name a uuid this capture is about to
  remove?* — which is why `MarginItemHandlers` now carries its kind's whole
  collection alongside the by-id lookup the delete path uses. ONE bundle, both
  directions, built by the one builder every consumer already shares, so a new
  margin-bearing kind inherits the obligation as a COMPILE ERROR rather than by
  someone remembering.
- **The neighbour is resolved ONCE and read by both halves.** Two resolutions
  would put the snippet and the cards it displaced on two paragraphs, which is
  precisely NOT stacking — and the census asks for exactly one
  `resolveDisplacedAnchorTarget` call per capture site for that reason.
- **The resolver is the honest form of what B2 always MEANT.** The snippet's own
  anchor used `findPreviousAnchorableBlock` gated on `ref.kind !== "selection"`
  — an approximation of *"is the whole anchoring entity being deleted?"*, which
  its own comment states and which is FALSE for a `linkedRange` ref, whose host
  paragraph survives. The resolver asks the real question: rung 1 keeps a
  partially-captured HOST block (a sub-range capture leaves its own paragraph
  standing, and that is where the context belongs), rung 2 is the nearest
  surviving block ABOVE, rung 3 falls FORWARD.
- **Rung 3 is not symmetry for its own sake.** A capture that starts at the
  document's FIRST block has nothing above it, so rung 2 answers `null` — and
  pre-491 that meant the fresh snippet anchored to `""` (born unanchored) and
  every displaced card orphaned. Falling forward keeps the class whole.
- **Rung 1 is asked only where `from` sits INSIDE a textblock.** At a block
  boundary the enclosing node is the doc, or a list wrapper the user never
  pointed at, and answering with it would put the displaced cards somewhere the
  snippet is not — the stacking failure wearing a fix's clothes.
- **The sweep runs BEFORE the delete is dispatched.** Not for position reasons
  (these are sidecar writes) but because the deferred
  `virgil-textobject-orphaned` sweep fires off that transaction and strips any
  link still naming a vanished uuid. Retarget first and the sweep finds nothing
  to strip, by construction rather than by racing it. It also sits INSIDE the
  never-destroy guard's success branch, so a REFUSED capture moves no anchor for
  a passage still in the document.
- **A multi-anchor card moves only the CONSUMED pids**, and gains the neighbour
  only if it is not already anchored there — repeated adjacent archives converge
  on one survivor, and a second identical link would paint a duplicate marker.

CI: [archive-retarget-displaced-anchors.test.tsx](../../../src/components/editor-layout/card-actions/__tests__/archive-retarget-displaced-anchors.test.tsx)
drives the REAL `useDragHandleActions` hook over the REAL main-editor extension
stack and the REAL `links.ts` mutators. **No pre-491 suite could see any of
this**: every archive fixture in the repo either has no other card in the
captured range at all, or (task 393's) carries a Mode-B mark whose fate is
decided by `cleanupLinksInRange` rather than by any anchor question — a Mode-A
card anchored INSIDE the captured range is unrepresentable in all of them. The
leg with teeth is the CENSUS, and it rides the DISCOVERED capture-site
population `card-body-capture.test.ts` already builds: every site that mints an
archive snippet must resolve the neighbour exactly once and retarget through the
door, and nothing outside `retarget-anchors.ts` may re-derive the sweep.
Allowlist EMPTY. Measured by neutering the retarget call: 6 behavioural legs
fail, and the delete-still-orphans leg passes either way — which is the point.

**Owed, not claimed:** a real-FSA eyeball. Archive anchors are the FSA-masked
class, so the durable proof here is the unit contract — archive two adjacent
passages that each carry a card, and both markers stack on the surviving
neighbour.

**Residual, stated.** `cleanupLinksInRange` still DELETES a footnote / citation
card whose atom sits inside the captured range, and a Mode-B card whose mark
does, exactly as it did before. That is shared with Delete and is a product
question (should an archive carry its footnotes into the clip?) rather than an
anchor one, so it is recorded here rather than changed under a fix about
paragraph anchors.

### The rebuild half: a per-kind capability is DERIVED, never hand-enumerated

Same law, other direction (task 233). Re-anchoring an **unanchored** card rebuilds its inline atom from scratch, so everything the atom can't regenerate must be read back from the card — and the read has to be a *derived obligation*, not a field someone remembers to add. `footnoteDropSpec.createAtom` built its atom with a hard-coded EMPTY body because the `DropCtx` sub-bag its citation twin got (`commandFor`) was never mirrored for footnotes. Re-placing an archived footnote therefore planted an empty atom, and since `getFootnotes()` re-derives BOTH the panel and the serialized `\footnote{}` from that node, the user's text was destroyed in the document. Nothing failed: the spec was registered, the dispatch worked, the node was well-formed. **A "registered and reachable" spec proves nothing about whether it can reach what it needs.**

So the accessor set is derived from the kind union, not enumerated per kind: [src/components/drop-mode/atom-card-apis.ts](../../../src/components/drop-mode/atom-card-apis.ts) (`buildInlineAtomCardApis`) is a `Record` over `InlineAtomCardKind` (= the keys of `InlineAtomCardAttrs` in [drop-mode/types.ts](../../../src/components/drop-mode/types.ts)), so a kind declared and left unwired is a **compile error**; `DropModeProvider` takes ONE `atomCards` prop instead of one field × four enumerations. The guard that catches the *original* shape is the implication `createsAtom ⇒ requiresCardApi` — both set by the factory from its own options and asserted off `CARD_REGISTRY` in [atom-card-api-coverage.test.ts](../../../src/components/drop-mode/__tests__/atom-card-api-coverage.test.ts). Keying it on the declaration alone would prove nothing: the pre-233 spec *rebuilt an atom and declared nothing*. (Scope: this covers kind coverage; each kind's attr list is still hand-written — see the note on `InlineAtomCardAttrs`.)

Two more rules the same task earned. **A rebuild that can't read what it needs REFUSES** — the footnote branch declines when no accessor is wired rather than falling back to the empty create shape, because that fallback *is* the bug (empty `\footnote{}` into the `.tex`, with the real body still sitting unread in the sidecar). And **reconcile only where the derivation can corroborate it**: `onAnchored` (which clears the card's `unanchored`/`archived` intent) fires only for a drop into the MAIN editor, since the panels resolve "anchored?" against the main doc alone — clearing it for an atom inside a card body would hide the card from *both* lists. The panel-side derivation obeys the `resolveAnchorState` law directly (`selectAtomlessFootnoteRefs`): **a live marker wins over declared intent.**

### The lifecycle half: a record that manages document state SETTLES it before it ends

Same law, third carrier (task 238). A `status:"applied"` revision/cutter suggestion carries an `appliedChange` descriptor that binds a **live range in the user's `.tex`** — the light-blue `pending-ai-change` mark. Morphing that card to a comment, or deleting it, ends the record. Before this, both did so silently: the morph declared `drops: []` (so no confirm fired at all), and the converter rebuilt a comment with no `status`/`appliedChange`. The range survived its manager — `isAppliedPending` ([pending-change-collect.ts](../../../src/links/pending-change-collect.ts)) requires `kind==="suggestion" && status==="applied" && appliedChange`, so Keep/Revert could no longer resolve it, and on reload `reapply-pending-marks` skipped the record and the orphan reaper stripped the mark. Net: unreviewed AI text left in the document, unrevertable, never warned.

The three carriers this class has now shown, all closed at the ONE chokepoint (`runCardLifecycleEvent`, [run-event.ts](../../../src/cards/lifecycle/run-event.ts)): the record **envelope** (`archived`, task 072), a **text field** the target shape can't hold (`explanation`, task 199), and a **live document splice** (238). The first two are card data; the third is the user's prose, which is why it earns an obligation rather than a `drops` entry — **declaring `appliedChange` in `morph.drops` would surface a confirm and still leave the range unresolved.** So SETTLE is a distinct step: resolve the splice (keep = finalize, revert = byte-restore) *before* the mutate, cancel abandons the whole event, and a host that **cannot** settle (no editor) **refuses** rather than proceeding — the same decline-don't-fall-back rule the inline-atom rebuild follows.

Two structural rules it earned. **Membership is derived**: the kinds that own a splice are keyed on the existing `PendingChangeFamily` union ([applied-splice.ts](../../../src/cards/lifecycle/applied-splice.ts)), so a third family member left unwired is a compile error. And the obligation is **kind-agnostic and passed to every door**, so there is no per-kind decision to forget — the delete leg carries it exactly as the morph leg does, because a delete ends the record just as surely. CI: [applied-splice-wiring-guardrail.test.ts](../../../src/cards/__tests__/applied-splice-wiring-guardrail.test.ts) greps every `runCardLifecycleEvent(` / `makeUnbridgingDelete(` call site and fails any that omits `appliedSplice` — the guard that catches the *original* shape, which a test of the executor alone structurally cannot, since the executor was never the part that misbehaved.

#### An obligation owns its MODE, not just its firing

Same executor, one axis in (task 313). The UNBRIDGE obligation — discharge the card's linked `ai-requests.json` row — had been *whether*-pinned since task 198 (`assertMorphCoverage`'s `drops` biconditional) and never *how*-pinned, so the mode was picked per EditorPane call site and forked in silence: delete and archive passed `"terminate"`, and the morph callback passed **nothing**, inheriting `bridgeCardAiRequestFlag`'s `"toggle"` default. The two modes differ on exactly the state that matters — `"toggle"` matches through `isRequestOpen`, which reports an **answered-L3** row (`in-progress` + a non-empty `resultId`, what an L3 *propose* responder leaves behind) as CLOSED. So the drop matched nothing, wrote nothing, threw nothing, and the row survived on a routing-less kind with no next toggle to clear it. Every test was green, because the executor was never the part that misbehaved.

So `unbridgeModeFor(event.type)` ([run-event.ts](../../../src/cards/lifecycle/run-event.ts)) answers it once, from the event, with an **exhaustive switch over the union** (a third `LifecycleEvent` type is a compile error until someone states its terminality); every door forwards, none decides — including `makeUnbridgingFootnoteDelete`, which deliberately skips the executor for its *signal* obligations and asks this SSOT anyway. Two rules fall out. **A defaulted argument is a decision nobody made**: `bridgeCardAiRequestFlag`'s `mode` is now **required**, because the two clients want opposite fail-safes (a checkbox must PRESERVE an answered row; a departing card must CLOSE it), so there is no safe guess to default to. And a **terminal transition is defined by the card leaving its aiRequest identity**, not by the card leaving — a flag-dropping morph qualifies exactly as a delete does. CI: [unbridge-mode-wiring-guardrail.test.ts](../../../src/cards/__tests__/unbridge-mode-wiring-guardrail.test.ts) reads source per call site and fails a `bridgeCardAiRequestFlag(` that states no mode, a hard-coded mode outside `PERMITTED_LITERAL_MODES` (a literal means *this site decided* — right only where the site IS the intent), or any mode literal inside `src/cards/lifecycle/`. Types can say "you must pass something"; only the grep can say "you must not have chosen it."

### The move half: an insert asks the CONTAINER what it can hold

Same law, fourth carrier (task 257). A between-blocks drop deletes its source in the same transaction it inserts, so **"where does this block fit here?" is a content-safety question, not a cosmetic one** — and it must be answered in ONE place, from the schema, for every insert site.

`tr.insert` at a position whose parent rejects the node does not fail. ProseMirror's fitter makes room, and it has two very different ways of doing so: it **pads** (adding whatever the content expression requires, payload landing inside the same container — benign, and shipped behavior relies on it), or it **splits** the container to close it off — tearing one node into two that **both keep the original uuid**, with the payload stranded at top level between the halves. Only the second is corruption, and it was reachable from two directions at once, each call site looking complete on its own terms:

- `text-range-move.ts` fit the context with a **list-only literal** (`classifyParentAt === bulletList|orderedList` → wrap in a `listItem`) and knew nothing of expex → a text selection released in an example's item gap split the **example**;
- `textobject.ts` fit the context through the **registry adapters**, which know expex and the sub-object containers and nothing of lists → a paragraph released in a list-item gap split the **list**;
- `util/block-move.ts` and `stack-pull.ts` asked **nothing at all** — including stack-pull's text-SLICE door, which spliced block content with `tr.replace` and split the `exampleItemList` so the example grew a second item list.

The SSOT is [`fitNodeInContainer`](../../../src/text-objects/drop-adapters.ts) (pure, schema-level) behind [`fitNodesAtInsert`](../../../src/components/drop-mode/specs/drop-context.ts) (editor-level), a four-rung ladder: **direct** where the immediate parent accepts the bare node → **wrap** where a wrapper in `buildWrap`'s vocabulary is both valid at that index *and* able to hold the node → **direct** where a probe shows the fitter only pads → **reject**. Four rules it earned:

- **The wrap capability is DERIVED from the construction.** `tryBuildWrap` attempts the real `buildWrap` (now `createChecked` at every level) and reads null as "can't hold it" — so the `exampleBlock` wrapper, whose true shape interposes an `exampleItemList`, is answered correctly without a second, driftable description of that shape.
- **Ask the fitter, don't predict it.** The pad-vs-tear distinction is settled empirically (`bareInsertTearsContainer`): build the real trial transaction, then check that the payload LANDED (`doc.eq` plus a size floor — `tr.docChanged` counts steps, not change) and that each ANCESTOR type's count moved by exactly what the payload's own subtree contributes. Crediting the payload's root type alone refused a nested list, whose `listItem` children are ancestor-typed too. A throw counts as a tear. At a top-level gap there is no ancestor to tear and the payload-landed test is the whole guard.
- **A payload arrives in the target's vocabulary or not at all.** Cross-editor drops carry nodes built from the SOURCE schema, and every rung compares NodeTypes by identity — so `fitNodesAtInsert` re-hydrates a foreign node through the target schema first, and refuses when the target genuinely cannot represent it (a card body has no `heading`). Same law as the capture side, at the other end.
- **The adapter proposes; the container disposes.** `textobject.ts` still runs the registry adapter (that is where a KIND's preference lives — ordered-vs-bullet, compatible-parent), then passes its answer through the fit, which is the authority on what this container can actually hold. Where the adapter is already right the fit reports `direct` and nothing changes.

Rejection is **atomic over the payload** (one unfittable node refuses the whole drop — a partial landing is content loss) and returns **before** the transaction is built, so the source is never deleted. Because rule 3 sanctions a padded insert, every multi-node loop advances its cursor by the transaction's **actual** size delta, not by `n.nodeSize`.

CI: [container-fit-guardrail.test.ts](../../../src/components/drop-mode/__tests__/container-fit-guardrail.test.ts) flags every SPLICE SITE in `src/components/drop-mode/` — the whole `insert`/`replace`/`replaceWith`/`replaceRangeWith`/`replaceSelectionWith`/`step`/`insertContentAt` family, any receiver — and fails any whose **enclosing declaration** neither calls `fitNodesAtInsert` nor carries an in-place `container-fit-exempt: <why>` marker (files carrying markers are allowlisted in `PERMITTED_UNFITTED_INSERTS`; today: inline-atom placement at a caret, the two inline-cursor slice moves, and the probe's own trial transaction). Both halves of that shape were learned the hard way: the guard's first version matched only `.insert(` and asked its question per FILE, and the two holes conspired — the stack-pull slice door was invisible to the regex *and* would have been exempted by a fit elsewhere in the same file, so CI was green while that door still tore examples. This is the guard that catches the ORIGINAL shape — a test of the fit function alone structurally cannot, since the fit was never the part that misbehaved; the part that misbehaved was a call site that never asked.

#### The inline half: the INLINE sibling of the container question, and its five silent skippers

Same law, the INLINE axis (task 396) — and the case where the SSOT existed, was
correct, was documented with the exact corruption it prevents, and was consulted
by ONE caller for five weeks while five others landed the atom straight past it.

Task 150 built `posHostsInlineAtom` for one question: *can this position host an
INLINE atom?* The MARKLESS verbatim blocks (`codeBlock`, `latexComment`) declare
`content: "text*"` — literal text, no inline nodes — so ProseMirror's fitter
cannot place the atom there. Measured against the real stack, what it does is
worse than the docstring's "splits the block": it **TRUNCATES the block at the
insert offset and EJECTS its tail text into a fresh top-level paragraph beside
the atom.** In a `latexComment` that means a line the user had commented OUT
becomes live printed prose. Nothing throws, the doc is schema-valid, the save
writes it straight through — and `insertLanded` (the 332 net) reads `+3` growth
against a floor of 1, so it false-passes.

> **The inline sibling of "an insert asks the CONTAINER what it can hold":
> `posHostsInlineAtom` is the SSOT, and EVERY site that splices an inline atom
> asks it — through the ONE door `insertInlineAtom`, or by spelling it directly.**
> It is a DIFFERENT predicate from the block gate and must stay one: a
> `titleField` (`content: "inline*"`) legitimately hosts inline math, so reusing
> `posHostsBlockInsert` would grey the title too.

Six rules it earned:

- **A comment describing a retired premise is how the next reader concludes the
  invariant is held.** Task 147 gated the BLOCK-atom cells and recorded, as a
  deliberate exclusion, that "`inline-math` and `ref` insert INLINE atoms (no
  split, valid inside a title/code block)". Task 150 falsified the code-block
  half **one day later** and fixed only the surface it was reported on
  (`math.ts`). That comment then outlived its own premise for five weeks, and
  three later surfaces inherited it unexamined — the grid cell, the `\ref`
  popover commit, and the shared door. The title half was true, which is exactly
  what made the sentence survive review.
- **Gate the DOOR, not just the affordance.** Greying the two cells closes two
  clicks and leaves the deferred create-popover commit open — `handleInsertRef` /
  `commitCitationCreate` land at a position captured at TRIGGER time, which no
  `applies()` can see. `insertInlineAtom` is the deepest point and the only one
  that covers it, plus every future inline atom.
- **…and the affordance half had no CONSUMER until the CELLS were wired.** The
  adversarial pass on this fix found it: the lightning grid greys through a
  hand-computed `blockAtomsDisabled` (ONE probe of the `example` row) and the two
  inline cells carried `disabled={!canEdit}` only, so a correct `applies()` on the
  rows greyed nothing on screen. Each cell asks its OWN row now — deliberately not
  a second shared probe, since the two rows pass different schema node names. *A
  facet nothing reads is this file's own recurring finding, arriving one level up
  from the one the task set out to fix.*
- **The gate is SCOPED to the corrupting case, and the scope is the precision.**
  The tear is a property of a TEXTBLOCK that admits text and not inline nodes. At
  a NON-textblock position (a top-level gap beside a block atom, a GapCursor, a
  `posAtCoords` between blocks) there is nothing to tear — measured,
  `tr.insert(gapPos, citation)` yields a fresh paragraph holding the atom and
  destroys nothing. The first cut refused there too, on an argument about
  `insertContent` REPLACING a `NodeSelection`, which is a different API and a
  different (RANGE) hazard: it would have turned a bib-entry drop beside a figure,
  and a footnote at a gap cursor, into silent no-ops. *A refusal needs the same
  evidence a fix does.*
- **A gate placed after the MINT trades the corruption for a ghost card.** Both
  native drops call a callback that PERSISTS a citation card before the splice, so
  the gate has to run first — otherwise a refused drop leaves an anchored card
  with no atom, which is this defect one layer down. Ordering is invisible to a
  region grep, so it has its own leg.
- **The gate asks about the position the insert will ACTUALLY use.** TipTap's
  `setTextSelection` clamps into `[TextSelection.atStart, TextSelection.atEnd]` —
  the TEXT range — never `doc.content.size`, which resolves to the doc itself. So
  an out-of-range `at` is judged where it LANDS (the first/last textblock) rather
  than at the doc node the scope above waves through. Mirror the clamp; do not
  re-derive a different one.
- **THE REPORT IS THE PERMISSION.** A refusal returns `{ refused: true }` with
  the document untouched, and the callers that mint an entity AFTER the insert
  read it — otherwise a citation/footnote CARD is registered with no atom in the
  document, which is this defect one layer down.
- **The SCHEMA half sits BESIDE the POLICY half, never instead of it.** The typed
  input rules were already refused by `blockKindAllowsAction` (a curated
  per-kind set) and the two answers coincide for the verbatim blocks only by
  construction — `MARKLESS_BLOCK_ACTIONS` happens to subtract
  `INLINE_INSERT_ACTIONS`. They are different questions (*may a footnote be
  created here?* / *can this textblock hold an inline node at all?*), so both are
  asked; the schema half costs nothing today and is what survives an edit to the
  curated set or a new markless kind.
- **A narrow type-only twin does not stay exported.** `blockTypeHostsInlineAtom`
  cannot clamp a stale caret and every real consumer holds a position, so it was
  a dead export (a sibling call is not a consumer) AND an invitation to ask the
  smaller question. Private now; `posHostsInlineAtom` is the one door.

**Three of the fix's own first-cut errors are recorded above rather than quietly
corrected, because each is a rule:** an affordance with no consumer, a refusal
without evidence, and a gate behind a mint. All three were found by the
adversarial pass, none by any leg — which is why each now has one.

**The census found two live sites the report did not name**, both the same shape
one layer out: the native HTML5 `MIME_CITATION` drops in `Editor.tsx` and
`RichTextField.tsx` land at a bare `posAtCoords` with no schema question at all —
so dragging a bib entry onto a `%` comment corrupted it, in the main document and
in a card body (where `latexComment` is registered in EVERY scope and `codeBlock`
rides `EXCERPT_STARTER_KIT_CONFIG`). The dead `MIME_FOOTNOTE` drop beside them is
gated too, as a latent-trap closure.

CI: [inline-atom-container-gate.test.tsx](../../../src/lib/actions/__tests__/inline-atom-container-gate.test.tsx)
drives the REAL stack over the affordance, the run, the door and the REAL `\ref`
popover commit, asserting the serialized `.tex` as well as the node shape — the
`% todo` → live-line promotion is only visible in the bytes. The leg with teeth
is [inline-atom-container-census.test.ts](../../../src/lib/tiptap/__tests__/inline-atom-container-census.test.ts):
the SSOT was never the part that could misbehave, a call site that never asks it
is, and that type-checks perfectly. Membership is DISCOVERED in two precise
halves rather than one loose window — a line that RESOLVES an inline-atom
NodeType off a schema inside a declaration that also splices (half A, which
accepts ONLY the inline gate), and every splice inside a module that DECLARES an
atom (half B, where `math.ts`'s `displayMath` branch legitimately answers with
the BLOCK gate). Allowlist EMPTY. Measured on the pre-396 tree it names all eight
ungated sites, and six of its nine legs fail. The task-147 suite's inline-row
expectation is RENEGOTIATED in place with the reason at the site: it pinned this
defect as intended behaviour.

**The residual this filed is CLOSED by task 414** — the drop-mode / slice family,
which landed atoms at `makeInlineCursorPlacement` positions asking no schema
question at all. See "The drop half" immediately below.

**A second residual, also filed — CLOSED by task 428**, see "The range half"
below: the gate was a SINGLE-POSITION question where the block twin
(`blockRangeAllowsAction`, task 148) requires EVERY reachable textblock.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (pure schema +
serializer), so the check is cheap and real: select a word inside a `% comment`
line, open the bolt, and see `$x$` and `Cross-ref` greyed.

##### The range half: a gate over a SELECTION asks about every textblock the selection reaches

Same predicate, the other axis (task 428) — 396's own recorded second residual.
An inline atom inserted over a non-empty selection REPLACES `[from, to]`
(`insertContent`, `replaceSelectionWith`), and every gate read `selection.from`
alone. Measured on the pre-428 tree: select from mid-paragraph INTO a
`codeBlock`, click the lightning `$x$` cell — the affordance reads the
paragraph and says "ok", `mathRun`'s data-loss guard passes (non-empty text),
the door judges `from`, and the replace destroys the code block's text and
merges the two blocks into one paragraph. The block twin had asked the range
since task 148, and recorded why.

> **`inlineRangeAllowsAtom(doc, from, to, atomType)` is the RANGE form of the
> inline-atom SSOT and `posHostsInlineAtom` is its caret form (`from === to`).
> Both families read ONE walk — `inlineInsertTargetTypes`, factored out of
> `blockRangeAllowsAction` — so the policy gate and the schema gate cannot
> disagree about what "the textblocks this range reaches" means. Fails CLOSED:
> every reachable textblock must admit the atom.**

Three rules it earned:

- **Which form a site owes is decided by what its SPLICE consumes.** A splice
  that replaces the live selection (`insertContent` with no `at`,
  `replaceSelectionWith`, `mathRun`'s wrap) owes the range; a splice that names
  its position (an explicit `at`, which `setTextSelection` first COLLAPSES to,
  a `posAtCoords` drop, an input rule whose match lies inside one textblock)
  owes the caret form, stated at each site.
- **The one permissive answer survives the widening.** A range reaching NO
  textblock (a gap beside a block atom, a GapCursor) is a place PM wraps rather
  than tears, and stays allowed — which keeps the caret form byte-identical to
  its pre-428 self. A `NodeSelection` over a block atom is that shape and
  remains the out-of-scope RANGE hazard `posHostsInlineAtom`'s header names;
  `mathRun`'s data-loss guard is what protects it today.
- **The census asks the SHAPE of the splice.** `inline-atom-container-census`
  gains a fourth question with an EMPTY allowlist: a censused site whose splice
  is `replaceSelectionWith` / `insertContent` must spell the range form or
  enter the door, and the door itself must read `selection.to`.

CI: the range legs in
[inline-atom-container-gate.test.tsx](../../../src/lib/actions/__tests__/inline-atom-container-gate.test.tsx)
drive the REAL stack over a prose→`codeBlock` selection through the affordance,
the run and the door, with the wholly-in-prose, title→prose and caret controls.
Measured by neutering the range primitive back to `from`: 4 legs fail, plus the
census leg when the slash `\footnote` is reverted to the caret form.

**Owed, not claimed:** the preview eyeball — drag-select from a paragraph into
a code block, open the bolt: `$x$` and Cross-ref greyed. Not FSA-masked.

##### The drop half: the AFFORDANCE is where a per-payload container question is asked

Same law, the DRAG carrier (task 414) — and the case where the SSOT was the one
door 396 had just wired everywhere, and the seven sites that skipped it skipped
it from a layer no door gate can reach.

A drop-mode gesture resolves its landing at ONE chokepoint,
`makeInlineCursorPlacement` ([hit-test.ts](../../../src/components/drop-mode/hit-test.ts)),
which returned the raw `posAtCoords` position. `codeBlock` and `latexComment`
both declare a `uuid` attr, so `resolveAnchorableBlock` resolves them, `inText`
is true over their text, and a caret painted inside them like anywhere else.
Measured against the real stack, dropping a citation into `% todo| fix later`:

```
latexComment("% todo") + paragraph[citation, " fix later"]
.tex:  % % todo %!v:m1
       \vcid{x}\cite{a} fix later
```

**A line the user had commented OUT becomes live printed prose** — task 347's
promotion class, arriving through a drag. Nothing throws, the doc is
schema-valid, the save writes it through.

Seven sites: the CREATE branch (`insertNewAtom`, a footnote/citation card
dragged out of its panel), the CREATE-BY-COPY (`stack-pull`'s inline-cursor
`tr.replace`), and five MOVEs — `moveInlineAtomWithin` (all four atom kinds via
the in-text grab), the cross-editor atom insert, and `text-range-move`'s two
slice splices.

> **A container question with a PER-PAYLOAD answer is asked at the ONE hit-test
> chokepoint, so the hover and the commit answer from the same table — and the
> payload is resolved ONCE per session, never per pointermove.** `DropSpec`
> declares `inlinePayloadFor` (the twin of `placementsFor`, resolved on the same
> `beginDropSession` edge); [inline-host.ts](../../../src/components/drop-mode/inline-host.ts)
> folds it over `posHostsInlineAtom`; every splice re-asks against the node or
> slice it actually holds.

Six rules it earned:

- **A gate at each splice alone would have been the FALSE-AFFORDANCE class.**
  The indicator would keep lighting a caret the release then silently refuses —
  in the one subsystem whose own guardrails (`placement-reachability`,
  `planned-decision-guardrail`) exist to outlaw exactly that. So the fix is an
  affordance change, and it is user-visible: no caret paints inside a verbatim
  block **for a payload that block cannot hold**. Plain text still gets one —
  `text*` hosts text, and refusing there would be the false refusal task 396's
  own first cut shipped, which is what the two CONTROL legs pin.
- **A net whose measure is a growth FLOOR cannot see a corruption that GROWS the
  document.** `insertLanded` (task 332) is the cross-editor move's net, and the
  ejected tail INFLATES the growth — measured `+3` against a floor of 1 — so it
  FALSE-PASSED and the unconditional source delete fired, taking a footnote's
  `content` body, which lives nowhere else. The honest test is the container
  question, asked BEFORE the delete; the gate therefore sits above `insertLanded`
  rather than beside it.
- **The BLOCK reading is a DIFFERENT question from the inline one, and reusing
  the atom predicate for it would refuse a working drop.** An open
  multi-paragraph slice at a caret legitimately SPLITS ordinary prose (measured),
  and `posHostsInlineAtom` answers false for a `paragraph` type — so a naive
  one-rule gate kills the commonest slice move there is. What such a payload may
  not do is enter a textblock that hosts *nothing but text*, where the fitter
  truncates and ejects exactly as it does for an atom (measured:
  `codeBlock("hello|world")` → `codeBlock("helloAAA")` + `paragraph("BBB
  world")`). So the block reading asks the WEAKER question, answered by asking
  the schema for a witness rather than by reading a content expression as the
  STRING `"text*"`.
- **The payload is NAMES, not `NodeType`s.** A payload may be resolved from a
  source editor, from persisted JSON, or from a spec's static configuration,
  while the question is asked against the TARGET's schema — and two schemas built
  from one extension list hold DISTINCT `NodeType` objects (the identity fact
  behind task 328). A name is the one currency both ends share, and a name this
  build cannot resolve is SKIPPED: that is the vocabulary question, which
  `schema-adopt.ts` already owns, and answering it here would be a second table
  for one question.
- **Marks are deliberately NOT asked.** Measured, PM drops the disallowed marks
  and the block is intact, so there is no corruption to refuse — and inventing
  one would be the false refusal task 396's own first cut shipped. Stated at the
  door rather than left to be rediscovered.
- **THREE markers on one splice line is not redundancy.** `container-fit-exempt:`
  says no container is entered, `schema-adopt-exempt:` says the payload speaks
  this vocabulary, and `inline-host-exempt:` says this site is not where a
  refusal belongs. Each answers a question the other two are not entitled to
  answer — task 204's rule, and the reason the second question had to exist at
  all.

CI: [inline-cursor-container-gate.test.tsx](../../../src/components/drop-mode/__tests__/inline-cursor-container-gate.test.tsx)
drives the REAL hit-test and the REAL specs over a fixture holding a
`titleField`, prose, a `codeBlock` and a `latexComment` carrying a real commented
line — asserting the serialized `.tex`, because the promotion is only visible in
the bytes. The leg with teeth is the CENSUS, in two halves: the SOURCE half is
`container-fit-guardrail`'s THIRD question (every splice excused from the FIT
must ask the inline question in its enclosing declaration; the four exemptions
are per LINE and each is a dispatch helper, a shared door or a never-dispatched
probe), and the LIVE-OBJECT half is in `placement-reachability` (every spec that
can offer an inline caret declares `inlinePayloadFor`, asked of the objects for
the two reasons that file already gives about `placementsFor` — the ES
method-shorthand form is invisible to a grep, and most specs are authored outside
this directory). The live-object half's allowlist is EMPTY — a hit is DECLARE-it;
the source half's is the four per-LINE exemptions named above, and it may only
shrink. Its population is DERIVED from the fit MECHANISM (`fitted`), never
inherited from question 1's exemption LIST, so a splice carrying no marker and no
fit enters it too; the residual is the file's own region granularity, stated at
the leg. `inline-atom-container-census` drops its `OUT_OF_SCOPE` carve-out for
this directory and says why a green answer from THERE about it would have been a
vacuous one. Measured by neutering each half in
turn: the affordance gate takes 3 legs, the three atom-move commit gates 4, the
stack-pull commit gate 3, the text-range commit gate 2, the block reading 1 (the
atom predicate) and 3 more (the weak proxy — `titleField` / `figureCaption` /
`glossCell`), a spec that drops its declaration 1, a per-MOVE payload resolution
1, and a dropped `inline-host-exempt:` marker 2.

**Residuals, stated.** A caret in a top-level `heading` still passes the block arm
(the `doc` hosts a paragraph beside it), so an open slice dropped mid-heading
splits it and its tail becomes body prose — a real split rather than a loss, and
the same answer the `paragraph` control gets, but it is a type CHANGE and wants
its own decision rather than being folded in here. The gate is also a
SINGLE-POSITION question, inheriting task 396's own second residual: a payload
whose splice spans blocks is judged at its insert position alone. And `text-range-move`'s same-editor branch asks at the
PRE-delete position while inserting at the MAPPED one. That is the honest place
to ask — it is what lets the refusal return before anything is dispatched — and
it is not free of assumption: a text-bounded delete that spans a block boundary
JOINS the blocks, and the survivor takes the LEADING block's type, so a range
running out of a `heading` could leave the mapped position in a different node
type than the one the gate was asked about. Stated rather than closed.

**Owed, not claimed:** the preview eyeball, and it is REQUIRED here rather than
nice to have, because the fix changes what the indicator PAINTS: drag a footnote
card over a `%` comment line and confirm no caret appears. NOT FSA-masked (pure
schema + serializer), so the check is cheap and real.

#### The row half: a surface answers PER ROW, and a WRAPPER is a container question too

Same family, and the case where the container SSOTs were right, the registry was
right, and the SURFACE asked one row for six types (task 397). The two halves
above give the block and inline atoms a per-NodeType FACTORY each —
`blockInsertApplies` says so in its own docstring — and the lightning grid then
computed ONE `blockAtomsDisabled` from the `example` row and rendered it on six
cells, and ONE `wrappersDisabled` from the `bullet-list` row on three. The GRAB
menu had it right from the start (`row.applies(ctx) === "disabled"`, one call per
row), so the precedent was already in the tree.

Three members, one disease, all measured against the real stack:

- **A shared probe is an assertion that the SCHEMA answers identically for every
  type in the group**, and inside an expex example it does not.
  `exampleBlock` hosts `graphicsBlock | displayMath` and none of the other four
  — the union was widened for exactly that (Feature A2) — so **Display math**
  and **Image** greyed out although each row said `ok`, the schema hosted them,
  and the run worked. The typed `$$` rule at the same caret succeeded, so two
  surfaces routing to one node disagreed. A FALSE REFUSAL of the feature the
  widening was built to serve.
- **The wrapper gate read the block TYPE and never the CONTAINER.**
  `selectionIsListable` asks "is this block a `paragraph`/`listItem`?", which is
  a question about IDENTITY (would the wrap coerce a `titleField` into a
  paragraph?) and says nothing about where the wrapper would GO. So Blockquote
  was lit and inert inside an example, and Bullet/Numbered at a caret inside an
  example ITEM **silently destroyed the item**: `exampleItem`'s union has no
  list, so ProseMirror lifts the paragraph OUT — `\vxid{it1}` gone, fresh uuids
  minted in its place (every card / marginalia marker / sidecar entry anchored to
  it orphans), and because expex numbers items by POSITION, `(1a)` now denotes
  what was the SECOND item, so every `\ref` into that example points at
  different text. Schema-valid, `doc.check()` clean, nothing logged.
- **The five MARK cells were gated on `!canEdit` alone** and sat lit and inert in
  the two markless (`marks: ""`) verbatim blocks — the lowest-severity member and
  the same disease.

> **A surface renders one verdict per ROW, from that row's own `applies()`; a
> row's gate is schema-precise in the row's OWN type; and the wrapper question is
> the THIRD member of the container family — `posHostsBlockInsert` (a block lands
> BESIDE the caret's textblock), `posHostsInlineAtom` (an inline atom lands
> INSIDE it), `selectionHostsWrapper` (a wrapper goes AROUND the blocks the
> selection spans).**

Seven rules it earned:

- **Ask ProseMirror's own predicate, not a restatement of it.**
  `selectionHostsWrapper` calls `findWrapping` — the question `wrapIn` /
  `wrapInList` themselves ask — so the affordance and the commit cannot come to
  disagree about what "wrappable" means. A `container.canReplaceWith(type)` gate
  was the obvious move and is strictly weaker: it asks whether the container
  accepts the WRAPPER and never whether the wrapper accepts the CONTENT, so it
  waves through a `codeBlock` that no `listItem` can hold.
- **…and a toggle is not always a wrap.** A wrapper toggle is SUBTRACTIVE — a
  lift out, or a convert in place — exactly when the caret already sits inside a
  container of the wrapper's own family, and there `findWrapping` answers null
  for a gesture that is not merely legal but ordinary: `listItem`'s content pins
  a leading `(paragraph | graphicsBlock)`, so at index 0 NOTHING can be wrapped,
  while bullet→off and bullet→numbered are the two commonest list gestures there
  are. A `findWrapping`-only gate greys both (measured: 3 legs).
- **The family is DERIVED, never a list of node names.** An ancestor is family to
  the wrapper iff BOTH content models accept the affected block range's own
  parent type. `bulletList` and `orderedList` are family because both host a
  `listItem`; a nested `blockquote` is family to the blockquote row; an
  `exampleItemList` — which hosts only `exampleItem`, a child no wrapper accepts
  — is family to none, which is precisely why a list toggle inside a bullet list
  must stay enabled while the same toggle inside an expex ITEM must grey. The doc
  node is excluded from the walk: the document is not a container anything can be
  lifted out of, and `block+` would make it family to everything.
- **The failure direction is stated and deliberate.** The family test is only
  consulted after `findWrapping` has already said NO, so a wrongly-EXEMPT case
  leaves the pre-397 behaviour (the cell stays enabled) while a wrongly-NON-exempt
  case greys a toggle ProseMirror itself reports it cannot perform.
- **A mark row asks about its OWN mark, over the RANGE, with "any" not "all".**
  `formatApplies` is a per-mark factory reading `allowsMarkType` off the live
  schema — not a list of block names, so a future verbatim kind is covered by
  shipping. A selection running from prose INTO a `codeBlock` still bolds the
  prose half, so the cell greys only when the toggle is inert everywhere it could
  act; and the mark RUN is deliberately unguarded, because unlike the wrappers
  there is nothing to prevent and a guard would have to re-answer the
  mixed-selection question.
- **The row DECLARES what it toggles, as a discriminated union**
  (`{ wrapper: "bulletList" } | { mark: "bold" }`), so "exactly one" is a compile
  error rather than a convention — and the `run()` guard reads the SAME
  `wrapperSafeHere` predicate the affordance does. That guard is what the SLASH
  twins inherit (`\list` / `\enumerate` / `\quote` route through the bridge into
  this same `run()`, and the popup asks no container question of its own).
- **The census is the leg with teeth, and it needs to be — the rows were never
  the part that could misbehave.** Each of the six answered correctly the whole
  time; a consumer that asks one of them for all six type-checks, renders, and is
  invisible to every behavioural test of every row.

CI: [grid-row-applies.test.tsx](../../../src/lib/actions/__tests__/grid-row-applies.test.tsx)
drives the REAL stack, and — the leg the registry legs structurally cannot reach
— mounts the REAL `ActionsMenuPanel` over the REAL editor and reads each cell's
native `disabled` out of the DOM. **No existing fixture could see any of this**:
every block-atom container fixture in the repo is `titleField` / `codeBlock` /
`latexComment` / prose, where all six types AGREE — which is exactly why the
shared probe shipped and survived. The destruction is legible only in the bytes,
so its legs assert the serialized `.tex`.
[grid-cell-applicability-census.test.ts](../../../src/components/__tests__/grid-cell-applicability-census.test.ts)
is the source census: every grid cell's `disabled` must read `gridCellDisabled`
with its OWN literal id, membership DISCOVERED from the file's own JSX, the two
bespoke cells carrying a STATED answer rather than an exemption (a missing `id`
prop must never read as "excused"), allowlist EMPTY — a hit is WIRE-it. It reads
`commentsStripped` and NOT `codeOnly`, since every needle lives inside a quoted
attribute. Measured by neutering each half in turn: the shared block-atom probe
takes 2 legs, the wrapper's container half 9, the subtractive-family half 3, the
mark factory 3, and the wrapper `run()` guard 6. Two legs in
[chip8-format-marks.test.ts](../../../src/lib/actions/__tests__/chip8-format-marks.test.ts)
are RENEGOTIATED in place with the reason at the site: they pinned the defect as
the contract ("the code cell is 'ok' but the inline mark cannot land — the
oracle's stated divergence between an enabled cell and a near-zero effect", and
"wrapper cells STAY 'ok' … on a listItem", which is true of the two list rows and
false of blockquote).

**The residual this filed is CLOSED by task 427** — see "The surface half"
immediately below.

##### The surface half: the SSOT was built and ONE caller adopted it

Same predicate, the three surfaces that never entered the registry (task 427) —
397's own recorded residual. StarterKit's `Mod-Shift-8/7/b` chords, its `- ` /
`1. ` / `> ` markdown input rules and `RichTextField`'s toolbar each reach
`toggleBulletList` / `toggleOrderedList` / `toggleBlockquote` without touching
`VIRGIL_ACTION_REGISTRY`, and the wrapper gate lived INSIDE that registry — a
module the `.extend()` factories and a card-body toolbar cannot import. Measured
on the pre-427 tree through the REAL stack:

- the **chords** destroyed an expex item (`toggleList` LIFTS the paragraph out
  of `exampleItem`; `\vxid` gone, example renumbered) and mangled a heading;
- the **toolbar** coerced a card body's `codeBlock` into `bulletList > listItem >
  paragraph` — its verbatim bytes now prose;
- the **input rules** did NOT destroy anything. Upstream's `wrappingInputRule`
  asks PM's own `findWrapping` first and declines. That half of the filed
  diagnosis is REFUTED and pinned as a CONTROL; the rules are routed through the
  door anyway so every surface answers from one table.

> **The gate lives in a LEAF the lowest surface can reach** —
> [src/lib/tiptap/wrapper-gate.ts](../../../src/lib/tiptap/wrapper-gate.ts)
> (`wrapperSafeInState` = identity half `selectionIsListable` + container half
> `selectionHostsWrapper`, moved out of the two editor-coupled modules that held
> them; `text-object-registry` re-exports the container half). The `.extend()`
> owns the binding and the binding asks the predicate: `guardWrapperShortcuts` /
> `guardWrapperInputRules` wrap the PARENT binding, restating nothing about what
> triggers a wrap. A refused chord is CONSUMED (a disabled control does nothing);
> a refused input-rule match answers `null` (the typed characters stay text).

Three rules it earned:

- **The registry RECORDS the surfaces it does not own.** `assertActionCoverage`
  used to FAIL a format row claiming `typed`/`keyboard` ("its keybindings are
  owned by StarterKit") — true of the marks, false of the wrappers, and a guard
  that says a surface does not exist while it destroys examples is the
  "overstates its reach" class. The partition is renegotiated in place: WRAPPERS
  must claim both and carry `keybinding` + `inputRulePattern` (the latter
  imported from the extension that owns it, never re-spelled); MARKS claim
  neither. The record cannot drift from the binding because the suite presses
  the DECLARED keybinding through the real stack.
- **The card-body toolbar is the grid's twin**, so its buttons take `disabled`
  from the same door AND guard the click, via `useEditorState` with a packed
  primitive selector (O(depth) per transaction, React bails on an unchanged
  verdict).
- **The census discovers by SHAPE.** Every production `toggle*(` call must sit
  in a declaration that spells the door or be a `formatToggleRow` argument
  (whose builder is censused separately); every `.extend()` of the three nodes
  must spell both guard helpers; `findWrapping` may be spelled in ONE file; the
  gate imports nothing from `@/`. Allowlists EMPTY.

CI: [wrapper-surfaces-guard.test.ts](../../../src/lib/tiptap/__tests__/wrapper-surfaces-guard.test.ts)
(real `buildEditorExtensions("main")`, typed one character at a time and keyed
through `handleKeyDown`) and
[rich-text-field-wrapper-guard.test.tsx](../../../src/components/__tests__/rich-text-field-wrapper-guard.test.tsx)
(the REAL `RichTextField`, not the mock every panel suite installs). Measured by
neutering each half in turn: the chords take 6 legs, the toolbar 2, the input
rules the census alone (stated — that half was never destructive).

**Owed, not claimed:** the preview eyeball — caret in an `\ex` item, press
`Mod-Shift-8`, open the code view: `\vxid` still there. Not FSA-masked.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (schema + serializer,
no disk), so the check is cheap and real: put the caret in an `\ex` item, open
the bolt — Bullet/Numbered/Blockquote greyed, Display math and Image lit — then
check the code view.

#### The offer half: a surface that can REFUSE asks before it OFFERS

Same law, the fourth surface (task 398) — and the case where three of the four
action surfaces asked and the fourth committed the user's keystrokes first.

Grab asks per row (`DragHandleMenu`), lightning asks per row (task 397), typed
asks at its input rule (`math.ts`). The slash popup asked **nothing**:
`filterByPrefix` filtered `VIRGIL_COMMAND_NAMES` by typed prefix and rendered
the result, and `executeSelection` dispatched `tr.delete(slashPos, cursor)` as
its OWN transaction and called `cmd.action` afterwards. The action's `applies()`
bail — `runViewOnlyAction` for the pure-PM rows, the bridge's `runAction` for
the rest — then refused, *after* the characters were gone. Caret in a
`latexComment` / `codeBlock` / `titleField`, type `\forest`, press Enter: **seven
characters vanish, nothing is inserted, nothing is said.** The lightning grid's
forest cell is correctly greyed at the same caret, so two surfaces routing to
ONE `run()` disagreed about ONE gate — with the extra cost that this refusal was
**lossy** rather than merely silent.

> **A surface that can refuse ASKS BEFORE IT OFFERS, and asks the SAME question
> it will ask at the commit — so a refusal costs the user NOTHING.** The verdict
> is the registry row's own `applies()`, resolved through
> `SLASH_NAME_TO_ACTION_ID` and published by ONE door
> ([slash-applicability.ts](../../../src/lib/tiptap/slash-applicability.ts)); the COMMIT
> is one door too (`commitSlashCommand`, beside the vocabulary both executors
> read), and it asks before it deletes.

Seven rules it earned:

- **There was a FIFTH surface, and finding it is what made the fix a fix.**
  `latex-command.ts`'s `virgilCommands` plugin is a second Enter-time executor:
  it matches a trailing `\name` and fires when the popup was never opened
  (dismissed with Escape, or suppressed by `isFreshPosition`). It carried its own
  copy of the same three steps and its own copy of the same DEFECT, so a fix to
  the popup alone would have closed the reported case and left this door eating
  characters in the very same containers with every behavioural test of the popup
  green. The door lives beside the vocabulary, not in either caller, for exactly
  that reason.
- **One CONTEXT constructor, or "the same question" is a hope.**
  `buildSlashActionContext` is what `runViewOnlyAction` builds its ctx with too;
  it was inline there, which is precisely why the popup had no way to ask the same
  question without re-deriving it.
- **One POSITION, and the two cannot disagree.** The offer is asked at the caret
  with the typed `\name` still present, the commit after the delete at `slashPos`
  — both inside the SAME textblock, because deleting text never changes a block's
  type or its container. Stated at the door rather than assumed.
- **The verdict is re-derived on every transaction while the popup is open**,
  including on the `tail === value.query` short-circuit: the caret can move and the
  block can change TYPE without one character of the query changing, and a stale
  verdict is the two-tables defect wearing the fix's clothes. It is derived from
  the transaction's NEW state (inside `apply` the view still holds the OLD one),
  with `view.editable` — a view PROP, not state — read off a per-editor captured
  view so CHIP 7b's collab gate reaches the OFFER and not only the run.
- **Greying beats hiding**, the choice both menus already made: a command that
  VANISHES reads as "Virgil doesn't have `\section`". Navigation skips greyed rows
  (initial selection and arrows), so the roving selection can only sit on a
  command Enter can run, and the arrows are inert rather than looping when every
  row is greyed.
- **The two doors END the gesture differently, deliberately.** The popup CONSUMES
  the key on a refusal — activating a disabled control does nothing, and the popup
  closes so the user's next Enter is an ordinary one — where the popup-less door
  returns `false` and lets an ordinary Enter through, because there is no offered
  row there to report a refusal on. Consuming is also what keeps a refusal from
  trading the eaten `\name` for a surprise paragraph split.
- **Keystroke sanctity is unchanged**: the plugin's `apply` returns O(1) while the
  popup is CLOSED, so no verdict work touches ordinary typing; the ~18 verdicts
  are O(depth) each and run only while the popup is open.

CI: [slash-popup-applicability.test.ts](../../../src/lib/tiptap/__tests__/slash-popup-applicability.test.ts)
drives the REAL `SlashPopupExtension` inside the REAL `buildEditorExtensions("main")`
stack — the shipped `handleTextInput` / `handleKeyDown` props, typed one character
at a time, because a single `insertContent` never opens the popup at all. **No
pre-398 suite could see any of this**: every cross-surface suite calls
`COMMAND_MAP.get(name)!.action(view, …)` DIRECTLY, which is the destination the
popup reaches *after* its delete — so the delete, and therefore the whole defect,
is unrepresentable in all of them. The per-container expectation is DERIVED from
`VIRGIL_ACTION_REGISTRY` rather than hand-listed, so a future gate change moves
both sides. The leg with teeth is the CENSUS
([slash-commit-door-census.test.ts](../../../src/lib/tiptap/__tests__/slash-commit-door-census.test.ts)):
the door was never the part that could misbehave, a private executor is, and
membership is DISCOVERED (the production files that IMPORT a runnable
`VirgilCommand`) with every allowlist EMPTY. It reads TWO views of each file —
strings KEPT for the needles that are quoted text, strings BLANKED for the symbol
needles, because `action-registry.ts` names `VIRGIL_COMMANDS` inside error-message
templates and would otherwise be indicted for prose.

Measured by neutering each half in turn: the pre-398 "never asks" surface takes 18
legs, the second door's private executor 2 behavioural + 1 census, the pre-398
navigation 2, the inline slash ctx 1 census, a door that deletes before it asks 1
census (plus every byte-identity leg), and a popup that ignores the verdict 1
census.

**Residual, stated rather than implied.** The delete and the action are still TWO
transactions, so a SUCCESSFUL command is two undo steps (Cmd+Z removes the
inserted block and leaves a document the `\name` has already left). Folding them
into one means threading a pre-built `tr` through every `cmd.action` — including
the bridge-routed rows, whose transaction is built later in React-land — which is
wider than this pass; the LOSSY half is what mattered. And the two bespoke
pre-gates in `commands.ts` (`\cite` / `\footnote`'s `blockKindAllowsAction` +
`posHostsInlineAtom`) stay as defence-in-depth: they cannot diverge from
`applies()` for the containers in play today, and if that coincidence ever breaks
the schema half must move INTO the row's `applies()` where task 396 put its
siblings, not be re-forked at the offer.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live editor gesture,
no disk), so the check is cheap and real: caret in a `% comment` line, type
`\forest` — the row is greyed — press Enter, and the seven characters are still
there.

#### The proxy half: an adapter asks the SCHEMA before it asks the classifier

Same gesture, one rung earlier (task 234). The fit above is the authority on what a container can hold, but it only ever sees what the registry ADAPTER proposed — and the adapter can refuse the drop outright (`no-op`) before the fit is consulted. So the adapter's own wrap-vs-direct decision has to rest on the same truth the fit does.

It didn't. `blockIntoExpexDropAdapter` asked the schema at the true immediate parent (`canDropDirect`); the two sub-item adapters asked `classifyParentAt`'s `isCompatibleParent` verdict, which is a **lossy proxy** — it reports the nearest *registered* `TextObjectKind`, so an unregistered structural container between the insert point and that ancestor is skipped and two structurally different positions collapse onto one answer.

> **A wrap-vs-direct decision is a schema question. The FIRST thing every adapter asks is whether the TRUE immediate insert parent accepts a bare node of its kind; the classifier's verdict is a fallback for the positions the schema signal cannot settle, never the opening move.**

`exampleItemList` is unregistered, and `exampleItem`'s content ends in `exampleItemList?` — so an expex example NESTS, and Tab/`sinkListItem` makes that tier reachable. At a nested item gap the walk-up lands on the enclosing `exampleItem` instead of the `exampleBlock`, `isCompatibleParent("exampleItem","exampleItem")` is false, and `exampleItemDropAdapter` fell to its wrap branch — where task 065's gate *correctly* refuses a fresh `exampleBlock` inside an `exampleItemList`. Net: the hit-test painted a drop indicator at the nested boundary and the release did **nothing**, silently, while the schema at the true parent (`exampleItem+`) accepted the bare item all along. Lists never hit it because their intermediary (`bulletList`) is itself registered AND compatible — the defect needs an unregistered container in the middle, which is exactly what a proxy cannot see.

The ladder is now ONE function, [`resolveWrapOrDirect`](../../../src/text-objects/drop-adapters.ts), shared by all three: **schema accepts the bare node → direct**; **schema refuses it but the fabricated wrapper is valid here → wrap** (the 065 gate); **the proxy says the enclosing registered container welcomes this kind → direct**, handing the exact shape to the container fit, which can still wrap, pad or refuse; **no evidence → the adapter's own default** — a sub-item wraps (and no-ops if its gate refuses that wrap), a BLOCK drops direct, which is why `blockIntoExpexDropAdapter` never returns `no-op`. Rungs 2–4 are each adapter's pre-234 behaviour case for case; rung 1 is the whole of the fix.

Three things worth knowing. The proxy rung is kept deliberately, not left over: an `exampleItem` released in a SINGLE example's widened body is refused bare (rung 1 no) and cannot be wrapped in an `exampleBlock` there (rung 2 no), yet the fit lands it inside the block — deleting rung 3 would turn that shipped drop into a dead one.

The **residual, scoped honestly**: for the SAME-KIND peer resolver (`resolveSubItemPeerBlock`) the indicator can now only under-surface, never over-promise — it reports a hit only where an ancestor's type equals the dragged kind, so its `insertPos` sits in a container that demonstrably already holds that type, and rung 1 fires by construction. That guarantee does **not** extend to the generic fallback: a popped-out `listItem` over a nested `exampleItem` gap takes neither the peer resolver (wrong kind) nor `resolveBlockIntoExpex` (a `listItem` is not an `EXPEX_INNER_KIND`), so `resolveAnchorableBlock` paints an ordinary between-blocks bar there — and the release is correctly refused (rung 4), silently. Bar painted, nothing happens, no message: that is the section's own symptom class, surviving for cross-kind sub-items in a foreign container's item gap. It is a *refusal* rather than a corruption, and closing it is an affordance question (suppress the bar, or say why) rather than an adapter one — recorded here as a known residual, not fixed in this pass. Task 321 (the feedback half below) took the second half of its cost: the refusal now reaches the DECISION, so the session cancels and the popped-out float survives instead of being dismissed over an untouched document. The bar and the silence remain.

And the position half, which the adversarial review of this fix surfaced: the same-editor commit **maps** the insert position through the delete (`tr.mapping.map`) instead of predicting it as `insertPos − (to − from)`. That arithmetic assumes `tr.delete` removes the source's declared node size, and it does not when the source is the SOLE child of a container whose content forbids emptiness (`exampleItemList` is `exampleItem+`, and expex's Tab keymap makes one-item lists routine): ProseMirror keeps a minimal valid residue, so the insert landed four positions early — inside the preceding peer, which the fitter closed to fit it, tearing that item in two with a duplicate uuid on a document that still `check()`s clean. Pre-existing (it misplaced top-tier drops too), but rung 1 is what first routes a drop *into* it at the nested tier, where the old answer was an untouched document. **Ask the transaction where a position went; never predict it** — the same rule the fit follows about the fitter and the identity net about multi-step transactions.

##### …and the position half was fixed in ONE spec and left stale in its three twins (task 331)

The rule above was written down twice and implemented once. `specs/textobject.ts` mapped; `util/block-move.ts` (the example card's own drop), `specs/text-range-move.ts`'s inline-cursor branch and `util/inline-atom-move.ts` each kept a private copy of `insertPos − (to − from)`, and the "advance the multi-node cursor by what ACTUALLY landed" half was re-derived at five sites. **A rule that holds at three call sites out of four is how this class keeps recurring**, so both halves now live in [src/components/drop-mode/util/mapped-insert.ts](../../../src/components/drop-mode/util/mapped-insert.ts) (`resolveInsertPos` / `insertNodesAdvancing` / `selectInsertedSpan`) and every splice reads them there.

Three rules it earned:

- **The ORIGIN is a required, named union, because the two answers are different claims about the same integer.** `{ mapThrough }` means "a pre-delete coordinate — ask the mapping"; `{ liveAt }` means "already in this transaction's coordinates". A defaulted "map if a delete happened" would be a decision nobody made *and* silently wrong for the between-blocks range move, whose `dropEmptiedSourceBlock` maps the position itself and RE-maps it when it sheds the residue — so what it holds at insert time is already live, and mapping again would double-count the cut.
- **Convert the sites where no drift is measurable too, and say which is which.** Measured against the real schema: drift **2** for an `exampleBlock` alone in a `blockquote`, drift **4** for the sole `exampleItem` (the case above). The inline-cursor range move's cut is text-bounded and no shape was found where its prediction and the mapping disagree — that conversion is a HARDENING, and the comment at the site says so rather than claiming a bug it can't demonstrate.
- **Lifting a splice into a shared door nearly DRAINED the census that governs it.** `container-fit-guardrail`'s `SPLICE_CALL` needs a `.method(` receiver, so a bare `insertNodesAdvancing(…)` call matches nothing: left alone, every converted site would have stopped being a splice site and both the fit and the adoption questions would have gone unasked for it — the exact drift those legs exist to catch, arriving as a tidy-up. So the door is itself in the splice family, and the primitive's two allowlist entries are honest *only* because of that: **a wrapper relocates an obligation to its callers; it never absorbs one.**

The same task deleted the two **unreachable cross-editor branches** in `textobject.ts` and `block-move.ts`. Both specs resolve their source inside `placement.editor` — the TARGET doc — so `targetEditor === src.editor` was true by construction and the insert-then-delete branch behind it could never run: code reasoning about a dispatch ordering that cannot occur, which the dead-SSOT rule outlaws. Deleted rather than wired live, deliberately: making a cross-editor block move real would newly enable main→card-body block CAPTURE, a product decision the capture/schema-symmetry law governs. `textobject.ts`'s `LocatedSource` no longer carries an `editor` field at all — **unrepresentable beats deleted**, since a value that can only equal `placement.editor` is an invitation to re-add the fork. The one genuinely cross-editor spec remains `text-range-move.ts`, which resolves its source from the `DropCtx`.

CI: [mapped-insert-position.test.ts](../../../src/components/drop-mode/__tests__/mapped-insert-position.test.ts) drives the REAL `blockMoveSpec` against the REAL schema over a source whose delete leaves a residue, and its defect leg fails on the pre-fix arithmetic with the diagnostic the class deserves — `duplicate uuid in ["tail","ex1","ex1-i","ex1-p","tail"]`, the passed-over paragraph torn in two with its text severed across the halves. Beside it: a byte-identical non-regression pin for an ordinary top-level move (where the mapping and the prediction agree), the primitive's own contract, and a pin that `selectInsertedSpan` cannot throw — `block-move` was the one of the three selection sites with no try/catch, and since task 321 these transactions are built inside `planDrop`, which `classifyDrop` calls bare inside an `async commitDropSession` whose callers `void` it.

CI: the rung-1 law is asserted over **every distinct `dropAdapter` on `TEXT_OBJECT_REGISTRY`** ([drop-adapters.test.ts](../../../src/text-objects/__tests__/drop-adapters.test.ts)) rather than over the two adapters that were fixed — a future adapter, or a future kind pointed at an existing one, inherits it without anyone extending a list — against a target that is adversarial in both directions (the proxy verdict that tempted the wrap AND a `canPlaceHere` that would sanction one). End-to-end, [nested-tier-sub-item-drop.test.ts](../../../src/components/drop-mode/__tests__/nested-tier-sub-item-drop.test.ts) runs the REAL editor schema, because the pre-existing sub-item harness hand-rolls `exampleItem` as `paragraph+` and therefore **cannot even build** the shape that breaks — the reason this sat live and untested.

#### The affordance half: what the hover OFFERS is what the commit ACCEPTS

Same gesture, one step earlier still (task 258). The two halves above govern where a payload may *land*; this one governs what the drag may *promise*. The hit-test walks the SESSION's placement list in priority order — before this task always the spec's `allowedPlacements` — and returns the first geometry match. But `inGap`/`inText` are an **exact partition** of every cursor position, and `paragraph-side` matches EITHER. So a `paragraph-side` listed after both partition members can never be returned, and `stackPullDropSpec` declared exactly that shape from the day the Stack landed (`c4f95034`, 2026-05-14): pulling a note/todo/archive/revision/cutter CARD onto a paragraph painted an **inline caret**, mouseup asked the spec's own per-payload validity check, which refuses `inline-cursor` for a card, and the drop silently did nothing. The `paragraph-side` arm of that check and the whole `paragraphId` anchoring branch behind it were dead code — the paragraph-anchored pull the spec advertised did not exist.

> **A spec-wide static priority order cannot answer a PER-PAYLOAD question, and the hover and the commit must answer it from the SAME table.** Where one key prefix covers several payload shapes, the spec narrows its list per payload (`DropSpec.placementsFor`), resolved ONCE per session; the geometry rule that consumes it lives in one function both the loop and its guard read.

[src/components/drop-mode/placement-policy.ts](../../../src/components/drop-mode/placement-policy.ts) is that rule: `winningPlacementKind(placements, "gap" | "text")` **is** the hit-test's switch, `unreachablePlacements` is derived from it over both geometries, and `resolveSessionPlacements` is called once in `beginDropSession` (never per pointermove — the resolution reads persisted state; stack-pull parses its whole localStorage envelope, and the payload behind a cardKey cannot change mid-gesture). Four rules it earned:

- **One table, two readers.** `stack-pull.ts`'s per-payload table (`placementsForPayload` over the four named lists + `CARD_PLACEMENTS`) backs `placementsFor` (the affordance) *and* `isPlacementValidFor` (the commit). The defect was never one of them being wrong — it was the same question answered twice from different tables, which is invisible until the two disagree at one geometry.
- **Order matters only against `paragraph-side`.** `between-blocks` and `inline-cursor` are mutually exclusive, so their relative order never bites; the card list is `["between-blocks", "paragraph-side"]` so a gap still means "unanchored" and the text world falls to the side placement. This is also why the surgical fix (reorder the union) was wrong rather than merely shallow: `paragraph-side` first would have stolen the text-slice pull's caret.
- **An empty list is an ANSWER, and the resolution fails CLOSED.** A payload with no implementation (`example`: its `applyCardDrop` branch is a documented v1 no-op), an unresolvable key (the item evicted mid-drag), and a payload SHAPE this build doesn't know (`readEnvelope` validates the envelope and then casts, so a blob from another build arrives typed as something it is not) all resolve to `[]` — no bar paints anywhere, instead of an inviting bar over a commit that will refuse. Nothing coalesces a missing answer back to `allowedPlacements`: for the one spec that has a per-payload policy, that union is precisely where `paragraph-side` is unreachable, so a fallback would reinstate the defect for exactly the payload nobody understood — and the same `undefined` would throw on `.includes` inside `classifyDrop`, which the controller does not catch, wedging the session. `allowedPlacements` remains the declared ENVELOPE for such a spec, derived from the table, and is explicitly **not** a priority order — read as one it is still unreachable-complete, because it is a union.
- **Per-kind capability is DERIVED from what the branch does.** `CARD_PLACEMENTS` grants `paragraph-side` iff that kind's `applyCardDrop` branch passes `paragraphId` to its `ctx.stack` factory (a footnote/citation/bib pull has no paragraph anchor to take), keyed on `StackCardKind` so a new stackable kind is a compile error until someone states where its pull may land.

CI: [placement-reachability.test.ts](../../../src/components/drop-mode/__tests__/placement-reachability.test.ts) censuses **every spec a drag can dispatch** (`CARD_REGISTRY[k].dropSpec` + the four module specs) and fails any that declares a placement the switch can never return — reading the rule from `winningPlacementKind` rather than restating it, with the pre-fix array pinned as a canary. A spec answering per payload is censused through its published per-payload lists, not its envelope, and the leg that keeps that from being an escape hatch asks the LIVE SPEC OBJECTS which of them declare `placementsFor` and requires each to publish. (A source grep was the obvious move and would have been wrong twice: it misses the ES method-shorthand `placementsFor(key) {…}` — already the local idiom for `classifyDrop`/`applyDrop` — and 13 of the ~17 censused specs are authored under `src/panels/<Panel>/drop-spec.ts`, outside any drop-mode-directory scan.) [stack-pull-placement-policy.test.ts](../../../src/components/drop-mode/__tests__/stack-pull-placement-policy.test.ts) drives the REAL hit-test end to end (four defect legs plus the non-regression pins a naive reorder would break), re-derives `CARD_PLACEMENTS` by running the REAL `applyDrop` against a recording `StackPullApi` over the table's OWN keys, and — the leg that catches the original shape, since every other one calls `hitTest` directly with a hand-resolved list — drives the real controller through `beginDropSession` + a synthetic mousemove, so reverting `handleMove` to pass `spec.allowedPlacements` (which typechecks) fails CI, along with a read-count leg pinning the once-per-gesture resolution.

**Scope, honestly — three residuals.** (1) This closes the PLACEMENT-KIND axis only: a placement whose *kind* the spec accepts can still be refused downstream by the container fit or a registry adapter — the residual recorded in the proxy half above. Since task 321 (the feedback half below) that refusal at least reaches the DECISION, so the session cancels with the float intact instead of reporting a drop that never happened; the bar still paints and the release still says nothing, which is the affordance question left open. (2) `winningPlacementKind` models the priority SWITCH, which is step 6; two resolvers run before it (`resolveSubItemPeerBlock`, `resolveBlockIntoExpex`), each gated only on `placements.includes("between-blocks")` and each able to return a `between-blocks` placement for an IN-TEXT cursor. Every spec that reaches them declares `between-blocks` first, so the census is exact today — but a future `["paragraph-side", "between-blocks"]` spec would need that path folded into `unreachablePlacements`, not the assertion relaxed. (3) Of the eight card kinds this makes paragraph-anchorable, only `todo` and `archive` capture a `paragraphSnapshot` at creation (`EditorPane`'s `dropStackApi`); note / the two revision kinds / the two cutter kinds create a snapshot-less Mode-A link, so they lean entirely on `finishApply`'s `requestAnchorFlush` for durability rather than on the reload reconciler's find-by-text fallback that `textObjectSideReanchorSpec` gives every other paragraph-side drop.

#### The feedback half: the DECISION is derived from the EXECUTION

Same gesture, last step (task 321) — and the half where every guard above was already correct and the user still saw the drop fail silently.

`DropSpec` asks the same question at two moments: `classifyDrop` decides (once, at mouseup, inside `commitDropSession`) and `applyDrop` executes. They were independent functions, and **every refusal the sections above installed lived only in the second**, as a bare `return` — the 065 adapter `no-op`, a wrapper that cannot hold the node, the container fit's `reject`, a rehydrate that threw, a `ctx` sub-bag unwired in this doc. So for a gesture the spec would refuse: the hit-test painted a valid landing bar; release ran `classifyDrop`, which said `apply`; `finishApply` set `applied = true` **because nothing THREW**; `postDrop: "close"` dismissed the popped-out float; and the document was unchanged with no toast, no cursor change, nothing. It read as "it worked and then vanished." Worse on the throw path, where the close ran unconditionally: the card disappeared on the one path where something had actually gone wrong.

> **A spec that can refuse states ONE resolution — `planDrop` — and both doors are DERIVED from it.** The plan reads live state and returns either a `DropPlan` whose `commit()` merely dispatches, or `null`. `null` reaches the controller as `no-op`, which cancels the session with the float intact. And **the close is gated on the same report the anchor flush is**: `postDrop: "close"` fires only when `applyDrop` completed without throwing — the predicate this section indicts three sentences earlier, which is honest here because it is the only report `applyDrop` can make, and is enough for the two paths that exist (a refusal never reaches it, and a throw no longer takes the float with it). The `planned-spec.ts` header states what it would take to make that report a real one, and who owes it.

[src/components/drop-mode/planned-spec.ts](../../../src/components/drop-mode/planned-spec.ts) is the factory; `DropPlan`/`DropPlanner` live on the type leaf beside the `DropSpec.planDrop` field they populate. Four rules it earned:

- **The plan is PURE and the commit is the only side effect.** It runs TWICE per gesture — once per door, and never per hover frame — so a `ctx.stack` factory call or a sidecar write in the plan would fire on the classify pass too. The rule is also written forward: no planned spec can answer `confirm` today, but the moment one can, the plan runs once before the user has agreed to anything. Transactions are BUILT in the plan (so a splice that throws is a refusal rather than a half-applied gesture, and the container fit stays in the same declaration as the splices it governs — which is exactly what `container-fit-guardrail` checks) and DISPATCHED in the commit.
- **`applyDrop` re-plans; it never commits the plan `classifyDrop` built.** For a planned spec today the two calls are back-to-back in one tick, so this buys nothing yet — it is the rule that keeps the `await` on the confirm path from becoming a live hazard the moment a planned spec can reach it, since a transaction built at classify time would then be dispatched against a document that has moved on. Planning runs twice per gesture and never per hover frame — the per-frame path is the hit-test — so the safe order is also the cheap one.
- **A non-null plan is a PROMISE that `commit()` changes something.** A commit that can still silently do nothing reproduces the drift one level in. This is why stack-pull's card branch resolves *which factory would run* (and refuses on an unknown kind or an unwired `ctx.stack`) rather than switching inside the commit.
- **No `decide` hook.** A refinement from a resolved plan to `{kind:"confirm"}` would be an option nothing reads — the dead-field class (task 227). Add it with its first real caller, and with the two obligations the header names: a real applied-report for `applyDrop`, and the re-plan rule above becoming load-bearing rather than precautionary.
- **A planner that THROWS is a refusal.** The construction this moved into `planDrop` used to live only in `applyDrop`, inside `finishApply`'s `try`; `classifyDrop`'s caller has no catch and is `async`, so an escaped throw would become a rejected promise that never reaches `endDropSession()` — leaking the window listeners, the `data-drop-mode-active` body attr and the lift overlay past mouseup. The factory restores that boundary on the door that lacks one. No such throw is reachable today, which is exactly what would make it a latent trap.

Converted: `textobject.ts`, `text-range-move.ts`, `util/block-move.ts`, `stack-pull.ts`. The two factories whose doors were already symmetric by construction stay hand-written and are allowlisted with that reason — `inlineAtomMoveSpec` (one shared `resolve` closure, and the create branch decided by the same pure `buildCreateNode` probe on both sides — the model this fix generalizes) and `textObjectSideReanchorSpec` (guard-for-guard twins off the same `getApi(ctx)`; also the repo's only `confirm` producer).

Three adjacent silent-failure doors closed with it, each the same shape one field over: stack-pull's text branch had **no empty-slice guard** where both its `text-range-move` siblings do, and failed in the WRONG direction at each geometry (in a gap `rangeSliceToBlocks` falls back to a fresh paragraph, so it landed a BLANK block and reported success; at a caret it dispatched an effect-less transaction); its heading branch **swallowed a per-node rehydrate failure** and landed a partial section, the one non-atomic door in a file whose every other refusal is all-or-nothing (a pull is a copy, so refusing costs nothing — the item stays on the Stack); and `finishApply` closed the float without reading `applied`.

CI: [planned-decision-guardrail.test.ts](../../../src/components/drop-mode/__tests__/planned-decision-guardrail.test.ts) — a SOURCE census (every drop-mode file that calls `fitNodesAtInsert` must build through `plannedDropSpec`; allowlist empty, a hit is CONVERT-it) plus a RUNTIME census over every spec a drag can dispatch (expose `planDrop`, or sit on `PERMITTED_HAND_WRITTEN_DECISIONS` with a stated reason the two doors cannot disagree — asked of the live objects, for the same reasons `placement-reachability` gives), the derivation's own contract, and the real specs against a container that genuinely refuses, with an accepting control so no leg can pass vacuously. [refused-drop-keeps-float.test.ts](../../../src/components/drop-mode/__tests__/refused-drop-keeps-float.test.ts) drives the REAL controller through all three endings — lands / refuses / throws — because the close is the controller's branch, not the spec's. Both suites' defect legs fail on the pre-fix derivation. Renegotiated on the way: two `sub-item-drop-resolution` legs asserted `{kind:"apply"}` three lines above asserting nothing was dispatched, which **is** this defect, pinned as intended behaviour.

Known residual, unchanged by this and stated in the affordance half above: a refused position still paints an inviting bar and says nothing on release. Making refused positions unhoverable needs a predicate cheap enough for the per-frame hit-test (the plan is not — it builds transactions), so it is a product decision, not a follow-on. **CLOSED by task 416** — the predicate exists and is rungs 1+2 of the fit, which are pure schema arithmetic; see "The candidate half" immediately below.

#### The candidate half: a ROW is several positions, so resolve a SET

Same gesture, one question earlier (task 416) — and the case where three
special-cased resolvers each answered a slice of ONE question, and the residual
above turned out to be closable by asking that question properly rather than by
a product decision.

Gabriel, from a real paper: *"drag and drop within bullet pointed lists is an
absolute mess. do a full audit of moving things, in, out, over lists. practice
sequences of moves, etc."* Task 351 closed the PERFORMANCE half of the same
gesture; this is where things LAND and what the drag PROMISES.

Hovering the second item of a nested bullet list, every one of these is a legal
place for a dragged block: before/after the inner item, before/after the inner
LIST, before/after the outer item, before/after the outer list. The hit-test
answered "which SINGLE position is nearest?" with a fixed rule — the innermost
anchorable container (`resolveAnchorableBlock` honours `DEFERRING_PARENTS`), a Y
threshold at that block's TOP edge, and X read for nothing — then painted a bar
for whatever it collapsed to, whether or not the commit would accept it.

**And the headline defect was the one the report could not name, because it is
an ABSENCE.** `between-blocks` matches the GAP only (`placement-policy.ts`), and
a list has **no top-level gaps between its items**. The only thing that made a
list draggable at all was the R3 `resolveSubItemPeerBlock` pre-switch resolver,
which fires exclusively when the payload is ITSELF a `listItem`. Measured over
540 cells sampled inside a block's row — where the cursor is for essentially the
whole of a drag — the pre-416 rule offered **a bar in NONE of them**. Dragging a
bullet felt Notion-ish; dragging a paragraph, a heading, a figure or a `texBlock`
over the same rows produced nothing, anywhere.

> **A row is not ONE insert position; it is several. So the hit-test RESOLVES a
> candidate set, FILTERS it for legality against the payload, and CHOOSES from
> it with BOTH axes — Y the boundary at each level's own MIDPOINT, X the LEVEL.
> With the set filtered, a level the commit would refuse is never offered, so
> the false affordance dies by CONSTRUCTION rather than by a warning.**

[src/components/drop-mode/insert-candidates.ts](../../../src/components/drop-mode/insert-candidates.ts)
is the ladder; [block-payload.ts](../../../src/components/drop-mode/block-payload.ts) is
its input. Seven rules it earned:

- **The FILTER is rungs 1 and 2 of the SSOT the COMMIT already reads**
  (`fitNodeInContainer` — the parent accepts the bare node, or a wrapper in
  `buildWrap`'s vocabulary is both valid there and able to hold it). That is
  pure schema arithmetic and O(depth); it is **not** `planDrop`, which builds
  transactions and is exactly why task 321 called this a product decision.
  Reusing the ladder rather than re-deriving it is the whole point: the hover
  answers from the same table the release does, which is the law 258/321/332
  already state.
- **The payload is DECLARED, not inferred** — `DropSpec.blockPayloadFor`, the
  exact twin of task 414's `inlinePayloadFor`, resolved ONCE at
  `beginDropSession`. EMPTY is a legitimate ANSWER and three specs give it with
  a stated reason: a text SLICE merges into the prose (its inline reading is the
  caret, and a block bar over text would steal it), and a CARD anchors to a
  paragraph side. Which is precisely why it has to be declared rather than
  guessed — the reach over TEXT is a per-payload fact, and inferring it would
  have broken the two payloads whose whole design is the caret.
- **The FLOOR of the ladder is `resolveAnchorableBlock`'s answer**, deliberately
  — so "into this item as content" is not a candidate and the default (cursor
  deep in the text ⇒ deepest level) is byte-identical to the level the pre-416
  rule chose. The new reach is everything to the LEFT of that.
- **`snapToMidpoint` was a flag with ONE `true` call site**, which is what made
  a list read as a stack of after-targets for every other payload. It is deleted
  rather than defaulted: the midpoint is now the rule at every level, and on the
  gap-only path it survives — where the cursor is by construction OUTSIDE the
  block's box, the midpoint and the pre-416 top edge give the same answer.
- **X is monotone by construction and its right-hand limit is the old answer.**
  Deeper levels sit further right (a list indents its items by one marker band),
  so the rule is "the deepest candidate whose box the cursor has reached, else
  the shallowest". The bar's WIDTH already encoded the scope the hit-test chose
  (task 007) — so the user was SHOWN the level and could not CHOOSE it; the same
  encoding is now a live affordance.
- **One resolver where three sat.** The ladder SUBSUMES `resolveSubItemPeerBlock`
  (a peer-item boundary is simply the candidate whose container is the list, now
  reached for every payload rather than only a same-kind sub-item drag — which
  is what F4, its `node.type.name === sourceKind` gate, was). `resolveBlockIntoExpex`
  stays AHEAD of it deliberately: a vertical into-item bar with its own geometry
  is a genuinely different affordance, not another rung of the same one.
- **RESIDUAL, stated:** the filter runs rungs 1+2 and NOT rung 3 (the empirical
  `bareInsertIsSafe` probe, which builds a trial transaction and is O(doc) — it
  cannot run per frame). A candidate ONLY rung 3 would accept is therefore not
  offered: the conservative direction (a missing affordance, never a false one),
  and the one shipped rung-3 case is reached here by the WRAP rung instead.

CI: [list-drop-matrix.test.ts](../../../src/components/drop-mode/__tests__/list-drop-matrix.test.ts)
is the audit, committed as an artifact rather than run as a session — **every
other suite in that directory drives ONE cell**, which is exactly how four
independent defects accumulated with all of them green. It drives the REAL
`hitTest` over a synthetic LAYOUT (jsdom answers an all-zero rect for
everything, so a layout model is the only way to ask a geometry question at all)
and then the REAL `planDrop`, over 540 cells = 4 sources × 9 target rows × 5 Y
fractions × 3 cursor X positions, plus four SEQUENCES whose `.tex` must be a
fixed point. Post-fix: **513 correct, 0 mis-landed, 0 corrupting**, and the 27
refusals are all the SELF-DROP (releasing a block back onto its own position,
which every spec declares a no-op and which has its own leg saying so). The
defect leg re-runs the identical sweep with `NO_BLOCK_PAYLOAD`, which IS the
pre-416 rule, and measures 540/540 no-target. The census in
[placement-reachability.test.ts](../../../src/components/drop-mode/__tests__/placement-reachability.test.ts)
is the leg with teeth — the ladder was never the part that could misbehave, a
spec that offers a between-blocks bar and declares no payload is, and it would
type-check perfectly while silently keeping the pre-416 rule. Allowlist EMPTY.

**Found in passing, filed — and then REFUTED (task 426).** The filing reported
that a `bulletList`'s own `%!v:` anchor is emitted after `\end{itemize}` and
never harvested, so a whole-LIST uuid would not survive a save/reload. Measured
against the REAL `parseLatex` / `serializeBodyOnly` pair: **false.** The
`\begin{env}` dispatcher harvests the post-closer anchor unconditionally (task
342) and the list arm applies it. The filing's fixture spelled its ids `%!v:ul1`
/ `%!v:a` / `%!v:b`, which are **not anchors** — the grammar is exactly four hex
characters on BOTH readers — so they were never harvested on either side. No
read-side fix landed; what did is the durable half: a sweep per uuid-bearing
CONTAINER kind, DERIVED from `UUID_BEARING_NODE_TYPES` ∩ the real schema's
container types, two full cycles each, asserting every container-level uuid ATTR
by structural path plus a byte fixed point, with the filing's own fixture pinned
as a CONTROL so it is not re-filed. *A premise is checked before it is fixed.*

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live editor
gesture, no disk), so the check is cheap and real — drag a paragraph into the
middle of a bullet list, drag a bullet out to top level and back, and drag a
bullet over a nested list at three cursor X positions.

##### The identity half: a landing that RENDERS IDENTICALLY is not a landing

Same ladder, the cell it could not represent (task 480) — and the case where
three specs carried the same guard, all three tested the same too-narrow thing,
and the suite's own classifier mirrored the narrow version, so the defect was
unrepresentable twice over.

Gabriel's seed symptom, reproduced live: *"grabbing and then dropping in the
same place — because you decided you didn't want to — should not change
anything."* Grab a bullet item's handle, wiggle ≤10 px, release at the grab
point, and the item was **EXTRACTED** out of its own list into a brand-new
single-item list with a freshly minted uuid. For a `bulletList` the corruption
is pixel-invisible; for an `orderedList` the numbering visibly restarts
(`c.` → `a.`).

Two mechanisms, and neither can reach the other's case:

- **the LEVEL band.** The grab handle sits in the MARGIN, LEFT of every
  candidate box, so `chooseInsertCandidate`'s fall-through hands the drag the
  SHALLOWEST level from the moment it starts — i.e. the band every gesture
  BEGINS in means "extract me to top level". (Pre-416 that same release hit the
  retired `resolveSubItemPeerBlock`, whose peer boundary WAS the item's own, so
  this is a 416 regression for the one X band no gesture can avoid.)
- **the GUARD.** `planDrop`'s self-drop test was `insertPos` inside the
  payload's own `[from, to]` — ONE level of a gap that exists at several. A
  `listItem`'s own visual gap line is also its LIST's boundary, and that list's
  item's, all the way out; every one of those is separated from the item's own
  boundary by nothing but ancestor tokens, so the guard missed, the adapter
  answered `wrap`, and `buildWrap` minted the list.

> **A landing is a NO-OP when it leaves the payload where the reader already
> sees it — which is two separate claims, because a gesture has two separate
> ways of going nowhere.** The MODEL rule: the insert position is the source's
> own GAP LINE (nothing but ancestor open/close tokens between it and the
> source's boundary) **and** the fit says `wrap`. The GESTURE rule: the pointer
> never left the point it was GRABBED at. Both are applied to the AFFORDANCE, so
> the bar is never painted at a landing the release refuses (tasks 258/321/332).

`src/components/drop-mode/self-drop.ts` is the SSOT for both. Seven rules they
earned:

- **The gap-line test is ARITHMETIC, and the arithmetic is exact rather than a
  heuristic.** Every unit step changes `$pos.depth` by at most ±1, so a span of
  N positions whose depth RISES by exactly N can only be N open tokens, and one
  whose depth FALLS by exactly N can only be N close tokens. Nothing else fits —
  and if every step is an open token, the nodes opened are BY CONSTRUCTION the
  ancestor chain containing the source, so there is no separate "are these MY
  ancestors?" question to get wrong.
- **The gap line ALONE is too strong, and the shipped `exampleItem` outdent is
  the proof.** Dragging the last item of a nested example list onto its parent
  item's boundary is the same gap line and is a real, tested, useful move. What
  separates it from the corruption is what the landing has to BUILD: where the
  container accepts the node DIRECTLY the item joins a different, existing
  container and visibly dedents; where nothing accepts it bare, the wrap rung
  FABRICATES the source's own parent KIND at the source's own indent, so the
  page renders identically while the list identity changes and the numbering
  restarts. **Same gap line AND `wrap`** — measured, the gap line alone fails
  that control. (The fit's verdict KIND is independent of the wrap vocabulary's
  ORDER, so this asks the same question `planDrop`'s own fit will, with no
  `prefer` to keep in step.)
- **WHOLE NODES only, and the scoping is load-bearing.** The rule presupposes
  the payload IS the node whose boundary the gap is. A text SLICE is not:
  moving the first three words of a paragraph into the gap immediately above it
  MATERIALIZES a new paragraph, which is a real change even though that gap is
  one open token from the range's `from`. So `text-range-move` declares no
  `sourceRangeFor`, keeps the narrow inside-the-range test, and says why at its
  own site — a false refusal of the commonest outdent-a-fragment gesture would
  be worse than the bug.
- **The MODEL rule cannot reach the reported headline, and no model rule
  could.** A MIDDLE item's list boundary has a real sibling between it and the
  source, so it is a genuine outdent. What is wrong there is the GESTURE, not
  the landing — which is why the dead zone is not a UX nicety bolted on but the
  second half of the law, owned ONCE by the content-drag terminal (the shape
  task 470 chose for the DIVIDER family) rather than restated per spec.
- **The dead zone is measured from the PRESS point, so it is plumbed.** A
  threshold-crossing producer only learns it has a drag at the first sample past
  the threshold, and with a fast pointer that sample can be far from the press —
  so `LiftOptions.grabOrigin` carries the mousedown and `beginDropSession`'s
  `origin` becomes it. Radius 10 px, sized from the producers' own thresholds
  (5 px grab handle, 8 px inline-atom grab): a gesture back inside the radius
  that STARTED it is, by its own producer's definition, no longer a drag.
- **…and it finally gives `DropSession.origin` a READER.** The field was written
  by every producer, documented as "used by ESC / leave logic", and read by
  NOTHING since the controller shipped — the dead-facet shape ("The field half"),
  WIRE-it-or-DELETE-it.
- **The source range is resolved ONCE per session** (`spec.sourceRangeFor`, the
  twin of `blockPayloadFor`), because it walks the document and nothing edits the
  document under a hold gesture. It carries its EDITOR, so a position in another
  document says nothing about this one.

CI: [self-drop-origin.test.ts](../../../src/components/drop-mode/__tests__/self-drop-origin.test.ts)
(the arithmetic over the REAL schema, the wrap conjunction with its DIRECT
control, the dead zone through the REAL controller, and the census) plus a new
source's-own-row sweep in
[list-drop-matrix.test.ts](../../../src/components/drop-mode/__tests__/list-drop-matrix.test.ts).
**That suite could not represent this**: its `TARGET_ROWS` never included the
source's own row, and its `selfDrop` classifier mirrored the same one-level test
`planDrop` carried — so "release at the grab point" was unrepresentable and a
near-self ancestor-boundary landing scored `correct`. Its leg *"the SELF-DROP is
the one no-op that still paints — and it is honest"*, which argued that closing
this "would need the hit-test to know the source's RANGE", is RENEGOTIATED in
place with the reason at the site: the hit-test knows it now. The leg with teeth
is the CENSUS — the predicate was never the part that could misbehave, a
controller that threads `null` where the session's range belongs is, and that
type-checks perfectly. Measured by neutering each half in turn: the pre-480
own-range rule takes 4 legs, the dead zone 3, the wrap conjunction 2 (one of them
the shipped nested-tier outdent control), a `null` threaded from the controller 1,
and a spec that drops its declaration 1.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live editor
gesture, no disk), so the check is cheap and real — the dev doc's "List Torture"
section: grab `Beta` and `Nested numbered C`, wiggle, release at the grab point,
and nothing may change; then drag each deliberately to another gap and confirm
it still moves.

**Residual, stated.** The LEVEL band itself is untouched: the grab handle for a
level-N item still sits at an X the candidate ladder reads as level N−1 (or, for
a top-level list, left of every box and so "shallowest"), because the handle band
lies OUTSIDE the editor column that the ladder's thresholds are the left edges
of. Calibrating the X axis to the handle band is the deeper fix for *which level
the grab point means* and needs live geometry to size; the dead zone is what
makes the un-calibrated band harmless at the one X where it always bit.


##### The band half: the CONTAINER owns the gap's pixels, and the gap is not its boundary

Same ladder, the pixels BETWEEN the rows (task 481) — and the case where 416's
own harness could not represent the geometry, so a fifth defect sat inside the
fix for the other four with 540 cells green.

Audit 457, Gabriel's seed symptom 2: *"weird gaps behind elements that don't
correctly map the mouse position."* Reproduced live against a 3-level ordered
list at a fixed X inside the content, every band mis-mapped:

| what the cursor is in | what was offered |
|---|---|
| the band between an item's HEAD LINE and its nested list | a full row UP — "above the parent item" |
| the LOWER half of that same head row | still "above the parent item" |
| the band below a nested list, before the next item | past the next item's whole row |
| the band below the last item | the WHOLE-LIST bottom at top level |
| inside an ordinary single-row item | CORRECT — the controls pass |

One mechanism, and both halves of it are in the ladder's opening move.
`resolveAnchorableBlock` is a CONTAINMENT walk, so a boundary between two
`listItem`s is contained by no item and resolves to the LIST, and a boundary
between an item's head paragraph and its nested list resolves to the ITEM. The
ladder then walks OUTWARD only. So at exactly the "put it between these two
things" pixels there was ONE candidate — the container's own boundary — placed
by that container's SUBTREE-inclusive midpoint, which for an item carrying a
130px nested list is nowhere near the gap the cursor is in. No X could rescue
the level, which is why the audit's first reading ("paragraphs can never enter
lists") looked true and was not: the wrap vocabulary accepts
paragraph→`listItem` and `list-drop-matrix`'s own INV5 pins in-list paragraph
landings. The live symptom was entirely this.

> **A gap band's candidates come from the rows FLANKING the gap, not from the
> container that owns the pixels.** The ladder gains a rung BELOW the floor —
> the boundary between the floor's own block children — and it has two readings
> of one question: in a GAP, `posAtCoords` already answered and its index IS the
> boundary; IN TEXT, the boundary is decided by the cursor's own child's
> midpoint, the head ROW's band rather than the container's subtree box.

Six rules it earned:

- **The GAP reading costs no DOM read at all**, and that is what makes the
  offered boundary coincide with the visual gap line *by construction*: it takes
  the position the browser's own hit-test reported rather than re-deriving one
  from a midpoint that might disagree with it.
- **An IN-TEXT cursor is offered INTERIOR boundaries only, and that is task
  416's own decision preserved rather than an exemption.** The floor's leading
  and trailing boundaries ARE the floor's own edges — same gap line, and for the
  commonest shape by far (a `listItem` whose only child is its paragraph, a
  one-paragraph `blockquote`, an `exampleItem`) the same BAR, since
  `resolveContentEdges` descends a container to exactly that first child. They
  are already offered one rung out, where 416 put them. Offering them here would
  win the `rect.left` tie in `chooseInsertCandidate` (which resolves to the
  deeper level) and silently change the default landing of every list and quote
  drag to "inside the item" — from a bar the user cannot tell apart from the one
  they were already being shown. Measured: dropping the restraint fails 6 legs,
  two of them 416's own.
- **A cursor in a genuine GAP has no such twin, so its edge boundaries stay.**
  The outward rung there paints the container's own edge with the container's
  own span — a visibly different bar at a different indent ("a new item at the
  end of this list" versus "a new block after the list"), and X chooses between
  them exactly as it does at every other level. That asymmetry is why the
  tempting single structural rule ("interior only, always") is wrong: it closes
  the reported head-row case and re-loses the trailing band.
- **The interior-only rule is asked BEFORE the rect read**, from the child
  COUNT: a container with one child has no interior boundary whichever side the
  midpoint lands on. The rung therefore costs the commonest floor there is
  nothing — no forced layout per move for an answer already known.
- **The TRAILING boundary's reference row is the child BEFORE the gap.** A
  container's last boundary has no child AT its index, and the ladder's loop
  used to `break` there — so without that case the whole ladder returned nothing
  at the one band the audit's fourth row is about. Only the sub-floor rung can
  start there; an outward step always resolves to a position before an existing
  node.
- **The floor must actually CONTAIN the cursor.** `resolveAnchorableBlock`'s
  top-level-gap fallback picks the nearest block by Y-DISTANCE, which can be a
  block the cursor is nowhere inside; there is no child boundary to speak of
  there, and the doc-level boundary the ladder already starts from is the answer.

CI: [list-drop-matrix.test.ts](../../../src/components/drop-mode/__tests__/list-drop-matrix.test.ts).
**No pre-481 cell could see any of this**, and the reason is the harness rather
than the cells: its synthetic layout stacked children GAPLESS (`BLOCK_GAP`
existed only between top-level blocks) and every cell sampled Y at a fraction of
a text ROW's own height, so a child-boundary probe was unrepresentable — 540
cells green over the whole class. The layout now carries the one band a list
really has (`.tiptap li > ul/ol { margin: 0.3em 0 }`; `li` itself is
`margin: 0 !important`, so plain rows stack gaplessly and there is no band
between them), laid out on BOTH sides of a nested list — which is what puts the
two sides in DIFFERENT containers, since the bottom margin collapses through the
item's zero bottom edge into the LIST's box. A premise leg checks that geometry
exists before any leg asserts a mapping over it. Measured by neutering each half
in turn: the pre-481 ladder start takes 5 legs (each naming the container it
wrongly offered — `bulletList` for the two head-row bands, `doc` for the two
below-nested ones), the interior-only restraint 6, and the pre-read fast path 1.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live editor
gesture, no disk), so the check is cheap and real — hover-drag an item through
all four transition gaps of the dev doc's 3-level list and watch the bar track
the gap under the cursor.

**Residual, stated.** The rung descends ONE level, from the floor into its own
children, and stops. A gap line that several containers' boundaries coincide at
(the end of a nested list is also the end of its item, and of that item's list,
and so on inward) offers the floor's reading and the outward chain, not the
deeper ones — the conservative direction this file's own fit residual already
takes, a missing affordance rather than a false one. And the geometric twin the
interior-only rule is a structural proxy for is stated rather than computed: two
candidates whose bars are pixel-identical are one offer, and the proxy is exact
for every shape in the schema today.

#### The other gesture: the Stack capture never asked the facet built to answer it

Same law, outside drop-mode entirely (task 332) — and the case where the SSOT existed, was
correct, was pinned three ways, and the gesture that most needed it simply never called it.

Releasing a popped-out float over the StackIcon is a drag with no `DropSpec` in it: the shell
(`FloatingPanel`) lights the icon's capture ring while dragging and dispatches a
`virgil-stack-drop` window event on release; `EditorPane`'s handler resolves the `Floatable`
and asks it to serialize. The hover gated on `if (cardKey)` and pure geometry. Only the
handler read `CARD_REGISTRY[kind].stackable` — by which point the gesture had already
promised. So a **Report / Report Request / Example** float lit the ring exactly as a note
does, the release was accepted, `snapshotForStack` answered null, and the float was closed
anyway under the comment *"Close the source float regardless of snapshot success — the user's
intent is clear."* Right about the intent (capture) and wrong about the outcome: the card
vanished from the screen with nothing on the Stack, no strip opening, and no message.
Task 259 built `stackable` precisely so this question would have ONE answer; this gesture
never asked it.

Three pieces, mirroring the drop-mode halves above:

- **The declaration.** [`canCaptureToStack(floatKey)`](../../../src/floats/stack-capture.ts) — parse the
  key, read the registry. `FloatingPanel` resolves it **ONCE at mousedown** onto the move
  gesture's own state (never per mousemove: a registry read cannot change mid-gesture, the
  rule `resolveSessionPlacements` follows), and BOTH the ring and the release read that one
  value. A float whose kind cannot be captured lights no ring and falls through to the normal
  drop/redock handling. The module is deliberately LIGHT — the card spine's runtime leaf and
  the key grammar, nothing else — because the drag shell is imported by half the app; the
  execution half may be heavy and lives elsewhere.
- **The door.** [`captureFloatToStack`](../../../src/floats/resolve-floatable.ts), built on the same
  `resolveFloatable` `FloatHost` renders from. The host had carried its own copy of that
  dispatch, announced in its comment as *"Mirror `FloatHost.resolveFloatable`"* — a stated fork,
  which is the shape "A registry earns its name by being read" outlaws. Moving the
  `@/cards/floats` registration import with it is what makes the capture path declare its own
  obligation instead of inheriting it from whoever imported the renderer.
- **The report is the permission.** The float closes only on a snapshot that actually landed.
  The declaration cannot answer everything the execution can — a text-object float outlives the
  block it was lifted from, so a deleted source resolves to null at capture time — and *that*
  is exactly what the report is for. Which also earned the fix's one non-obvious line: the
  stack-drop branch returns before the shared position commit, harmless only while a capture
  always closed the float, so it now commits the dragged rect itself or a refused capture
  strands the float over the icon at a position nothing stored.

**A text-object float is capture-capable as a FAMILY, and that is derived rather than waved
through**: `snapshotTextObject` is total over `TextObjectKind`, so there is no kind-shaped
refusal to declare — only per-moment resolution failures, which the report owns. It is
deliberately NOT keyed on `TEXT_OBJECT_REGISTRY[kind].floatBodyComponent`, which is mutable
state written by a side-effect registration module: an affordance must not depend on import
order.

CI: [stack-capture-affordance.test.tsx](../../../src/components/__tests__/stack-capture-affordance.test.tsx)
drives the REAL gesture (mousedown → mousemove onto the icon's published rect → mouseup) for one
stackable kind and the three non-stackable ones — **every other guard in this cluster is blind
to the drag by construction**, which is how the gesture shipped for a year never asking the
facet. Its close-gate leg reads `EditorPane` SOURCE, because that handler lives in a component
no unit test mounts and the part that could misbehave was never the door. `stack-coverage`
gains the affordance ⇔ declaration sweep per kind (keying the guard on the declaration alone
would prove nothing — it has to ask the predicate the gesture reads), and `float-snapshot` the
door's refusals plus a census that `snapshotForStack` has exactly ONE production caller: a
second capture site would ask no capability at all, and the ring would be honest while the
commit was not. The refusal legs assert the record is never even RESOLVED (the kind's
`toFloatable` must go uncalled), since the null alone passes with the capability check deleted —
the two-tables shape restored with CI green.

##### The third producer: a terminal is owed to the GESTURE, not to the producer that first needed it

Same icon, the producer 332 did not reach (task 456) — and the case where the
Stack had three capture producers in design and two in code, with the missing
one wearing an accidental affordance that made it read as supported.

Gabriel: *"Dropping items on the stack is still not working. It darkens on
mouse over, but when you let go, the text dragged just pops out (as if you were
dragging to anywhere else outside the page)."* Grab a paragraph / heading /
list item / selection with the in-document grab handle, drag it onto the icon,
release: the text becomes a popped-out float sitting over the icon and nothing
lands on the Stack. `LiftHost.onUp` had exactly TWO terminals — ghost mode →
`commitDropSession()` (a doc move), popout mode → `popOutAtRect(…)` — and never
asked `isOverStackIcon`; `onMove` never called `setStackDropTarget`. A comment
in `StackIcon.tsx` recorded it as a deferred phase (*"Phase E and beyond may
emit MIME_TEXTOBJECT from TextObjectGrabHandle … we'll wire the consumer here
then"*), which is how the gap outlived the two tasks that drained its siblings.

**It darkened anyway, and that is the finding rather than a detail.** The lift
overlay is `pointer-events: none` (the content-drag click-through law), so the
button underneath kept receiving `mouseenter` and painted its ordinary hover
background. The hover OFFERED and the commit REFUSED — the false-affordance
class 258/321/332 each closed — surviving here because the offer was an
**accident of plain hover styling** rather than a deliberate ring. No census
could see it: every guard in this cluster asks about a ring, a capability or a
door, and none asks what a button's REST chrome says while something is being
dragged over it.

> **A capture TERMINAL belongs to the gesture family, not to the producer that
> first needed one: every producer enters ONE terminal, and the terminal
> REPORTS.** And an icon that is a drop target owes the same two-sidedness its
> ring does — during a content drag its ordinary hover chrome says nothing, so
> the only signal it gives is the true one.

Six rules it earned:

- **The terminal moved OUT of the window listener** into
  `EditorPane.captureKeyToStack` — the capability+resolve+serialize door
  (`captureFloatToStack`, 332), the bib-carrying add door (`addStackItem`,
  235), open the strip — and BOTH producers enter it. What each producer does
  NOT share is how it retires its own source surface: the float closes its
  popout, a lift tears down its overlay. That line is why the close stayed at
  the call site.
- **The lift gets a PROP where the float gets a window event, and the
  difference is the REPORT.** `FloatingPanel` is a low-level shell mounted far
  from `EditorPane` with no context path, so its capture has to travel as a
  global `virgil-stack-drop` event and cannot be told whether it landed.
  `LiftHost` is mounted BY `EditorPane`, so `onCaptureToStack` hands the report
  back — which is exactly what lets a REFUSED capture (a source deleted
  mid-gesture) fall through to the popout terminal instead of eating the
  gesture. Fire-and-forget would have forced the pre-332 shape back.
- **ONE capability, ONE geometry predicate, read by both halves.**
  `canCaptureToStack(cardKey)` is resolved ONCE at gesture start (a registry
  read whose answer cannot change mid-gesture — the rule `stack-capture.ts`'s
  own header states, and `resolveSessionPlacements`' reason); the ring in
  `onMove` and the branch in `onUp` then differ only by which event's
  coordinate they pass to `isOverStackIcon`.
- **The stack branch is read FIRST, ahead of both existing terminals, and the
  ORDERING is the hover≡commit guarantee.** Wherever the ring was lit, releasing
  captures — including the narrow-window geometry where the icon overlaps the
  content zone and a content-first read would instead commit a doc move the
  user was never offered.
- **The ring clears in `cleanup()` — the ONE end path every ending funnels
  through** (capture, popout, move-commit, doc-leave, Escape, and the
  missed-release bail, which returns without ever reaching `onUp`). Cleared per
  terminal instead, a swallowed mouseup leaves the ring lit with no gesture left
  to accept it.
- **Scoped to the `"grab"` policy, stated rather than assumed.** A `"float"`
  lift is driven from a float that is ALREADY open, and that surface has its own
  Stack terminal — dragging its HEADER onto the icon, which CONSUMES the float.
  Giving its drop-button ghost a second terminal with COPY semantics would put
  two answers to "what does releasing this float on the Stack do?" in front of
  the user; that is a product question, not a wiring gap.
- **Capture is a COPY**, matching float capture (a captured text-object float
  leaves the doc text in place) and stack-pull's paste-as-new. Cut-to-stack is
  one call at the site if Gabriel wants it.

CI: [lift-stack-capture.test.tsx](../../../src/text-objects/__tests__/lift-stack-capture.test.tsx)
drives the REAL `beginLift` gesture (threshold → move over the icon's published
rect → mouseup) for a paragraph lift and a `linkedRange` selection lift, with
the two CONTROLS that keep it honest — a release away from the icon still pops
out, a release over content still commits the move. **No pre-456 suite could see
any of this**: `stack-capture-affordance` drives the REAL `FloatingPanel`
gesture and is blind to the lift by construction, and every lift suite in the
repo drives a gesture with **no icon rect published at all**, where
`isOverStackIcon` is false everywhere and the terminal is unrepresentable. The
leg with teeth is the CENSUS in `stack-capture-affordance` — the terminal was
never the part that could misbehave, a second private capture site inside
`LiftHost` is, and it would type-check, ask no capability, carry no bib and
report to nobody: `LiftHost` may spell none of `captureFloatToStack` /
`snapshotForStack` / `snapshotTextObject` / `addStackItem`, and the prop must be
handed the shared terminal. Its two pre-456 legs are RENEGOTIATED in place with
the reason at the site (they pinned the handler ITSELF as the one capture site,
true only while the float drag was the only producer with a terminal). Measured
by neutering each half in turn: the `onUp` terminal takes 3 legs, the ring 2,
the `cleanup()` clear 2, the hover suppression 1, and dropping the prop 1.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live pointer
gesture, a localStorage stack), so the check is cheap and real — lift a
paragraph onto the icon, watch the ring light, release, and see the strip open
with the item; release elsewhere and the popout is unchanged.

#### The cursor half: an affordance painted in CSS is a promise the GESTURE keeps

Same law, the CHEAPEST medium (task 524) — and the case where each half was
correct about its own question, which is exactly why no behavioural test of
either could see the disagreement.

`globals.css` gave all four inline atoms `cursor: grab` (and `:active
grabbing`) unconditionally; `InlineAtomGrab` gates its gesture on
`view.editable && (editableRef ? editableRef.current : true)`, and its own
comment gives the reason — *"gating the gesture means no dead affordance."*
The CSS comment beside the rule recorded the other half out loud (*"the grab
gesture itself is read-only-gated in the plugin; this is just the
affordance"*), so the fork was written down twice and reconciled nowhere. In
every read-only surface the pointer said grab, the press said grabbing, and
nothing happened: a collab non-pen-holder, every non-active keep-alive pane,
the Library Reader, and — sharpest — a live **cowork-pen** hold (task 489),
where the topbar is at that moment displaying an amber breathing badge whose
entire job is to say the document is read-only.

> **A CSS affordance is scoped to a fact the GESTURE publishes, never to a
> proxy for it.** `data-atoms-graspable`
> ([inline-atom-grab.ts](../../../src/lib/tiptap/inline-atom-grab.ts)) is stamped from
> `atomsAreGraspable` — the very expression the mousedown handler gates on —
> and the rules read `.ProseMirror[data-atoms-graspable="true"]`.

Six rules it earned:

- **`contenteditable` is the tempting scope and it exempts the reported
  surface.** MAIN pins `view.editable = true` *whatever* the user-facing state
  (`Editor.tsx` — PM's own `contenteditable="false"` broke how some browsers
  route selection to PM in the Reader) and gates through `editableRef`
  instead; a float / card body has no ref and gates on `view.editable` alone.
  So the DOM carries the answer under two different names, and the one-line
  fix keyed on `contenteditable` would have left the cowork-pen case lying.
  One stamped attribute hides that fork from every reader.
- **The fall-back was already there.** Each atom's base `cursor: pointer` is
  the honest read-only answer — a click still opens the atom's Card — so this
  is "stop upgrading", not "remove the cursor".
- **The affordance follows the PLUGIN, which retires a second member for
  free.** A surface that does not mount `InlineAtomGrab` never carries the
  attribute, so its atoms keep `pointer`: `RichTextField` card bodies render
  citations and footnote markers and have no grab gesture at all, and were
  advertising one.
- **Two TRIGGERS, one WRITER, one PREDICATE.** The plugin's `view()` re-stamps
  on every transaction, which covers every surface whose flip PM can see (a
  float's `setEditable` → `updateState`, or a re-created editor). MAIN's answer
  lives in a React ref PM never observes — TipTap's `useEditor` deliberately
  re-applies its options with `editable: editor.isEditable`, so a prop flip
  reaches no transaction — so `Editor.tsx` re-stamps from its own `editable`
  effect, through the same exported writer. A cowork-pen hold is exactly a
  moment when nobody is typing.
- **[cost: O(1)/tx]** — two boolean reads, one `getAttribute` compare, and an
  early return on an unchanged answer, because `setAttribute` invalidates style
  even when the value is unchanged (task 430). A plugin `view()` is not an
  `editor.on(…)` subscriber, so it is prose-listed beside
  `sectionFoldingPlugin`'s refresher rather than in the keystroke-subscriber
  allowlist, whose census greps that call form.
- **It cannot feed back into the editor**: PM ignores attribute mutations whose
  target is its own `view.dom` (`DOMObserver.registerMutation` returns null for
  `desc == view.docView`), which is the same reason the long-standing
  `data-editable` stamp beside it is safe.

CI: [atom-grab-affordance.test.ts](../../../src/lib/tiptap/__tests__/atom-grab-affordance.test.ts)
drives the REAL `buildEditorExtensions("main")` stack over the REAL parse and
asserts the AGREEMENT — the attribute says grab exactly when
`handleDOMEvents.mousedown` takes the press — which is unrepresentable in any
test that drives one half. **No pre-524 suite could see this**: the CSS rule
and the plugin gate are each self-consistent, and jsdom resolves no cascade, so
a `getComputedStyle(...).cursor` leg would be vacuous either way. The legs with
teeth are the two CENSUSES: the CSS one requires every atom `cursor: grab` rule
to carry the attribute scope AND to name no `contenteditable` (so the shallow
answer fails rather than passing), and the source one pins ONE speller of the
attribute, ONE re-derivation of the gate, and `Editor.tsx` entering the shared
writer. Measured by neutering each half in turn: the pre-524 unconditional rule
takes 1 leg, the plugin-view stamp 8, the React nudge 1, a re-forked gate 1,
and the `contenteditable` scoping 2.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a CSS rule plus a
DOM attribute, no disk), so the check is cheap and real — open the dev doc,
force read-only, and hover a citation.


#### The vocabulary half: an exemption is scoped to the shape it justifies

Same gesture, and the case where the law was already written, already enforced, and enforced in a place two call sites had a written licence to skip (task 328). Rule 4 of the move half above — *a payload arrives in the target's vocabulary or not at all* — lived **inside** `fitNodesAtInsert`, as a private helper reachable only by going **through** the container fit. Two splices are deliberately exempt from that fit, each carrying a `container-fit-exempt:` marker whose stated reason is *"an open slice merging with the text around a caret… no container is being entered"* — a true statement about **containers** and a false one about **vocabularies**. Because the adoption sat in the same function, the exemption silently bought an exemption from it too.

The cost is the worst outcome this whole section legislates against, and it is silent at every layer. A lifted selection — or a footnote/citation card's marker — released at an inline caret **inside a card body** was spliced with nodes built from the SOURCE schema. Two `Schema` objects built from the same extension list hold **distinct `NodeType`s**, and ProseMirror's `Fitter` compares them by identity: it `dropNode()`s the payload, `replaceStep` returns null, and `Transform.replace` appends **no step at all** — `steps: 0`, `docChanged: false`, no throw. The move's *second* transaction, the unconditional source delete, then ran. Prose gone from the document, nothing in the card, `selectInserted` highlighting a run of the card's own pre-existing text so the drop looked successful. For the atom it also destroys the footnote's **body**, which is the atom's `content` attr and lives nowhere else. This is task 321's "it worked and then vanished" one level deeper: there the document was merely untouched; here it is damaged.

> **Adoption is an obligation SEPARATE from fitting, and so is the report.** Every splice that can receive a payload from another editor re-hydrates it through the TARGET's schema and REFUSES when that schema cannot represent it; and a relocation dispatches its source delete only on **evidence the insert landed**, never on the absence of a throw.

[src/components/drop-mode/schema-adopt.ts](../../../src/components/drop-mode/schema-adopt.ts) is the SSOT — `adoptNodeIntoSchema` / `adoptSliceIntoSchema` (same schema ⇒ the same object by identity, zero cost; foreign ⇒ re-parse or `null`) and `insertLanded`. `fitNodesAtInsert` calls the first, so nothing on the fitting path changed; the exempted splices call it directly. Five rules it earned:

- **An exemption is scoped to the shape it justifies** — task 204's rule, arriving here from the other direction. There the finding was a census exempting a whole category on ergonomic grounds; here it is a marker whose author was right about the question they were answering and silent about the one they weren't. The generalizable half: **when an exemption's reason names a specific mechanism ("no container is entered"), check what ELSE that mechanism happens to gate.** The two questions now carry distinct markers (`container-fit-exempt:` / `schema-adopt-exempt:`, joined in task 414 by `inline-host-exempt:`) precisely so none can answer for another.
- **The two nets are independent, and the second is not a corollary.** `Slice.fromJSON` / `Node.fromJSON` validate the **vocabulary** — an unknown node type or mark throws — and say nothing about the **content expression**, so a payload the target can NAME but cannot HOLD still reaches the fitter and is still swallowed. `insertLanded` (steps > 0 **and** growth ≥ the payload) is the same rule `restoreExcerptAtCaret` earned in "The return half", for the same reason: `replace` / `insert` / `insertContent` all swallow a mismatch, so `void` looks identical for "landed" and "destroyed". It is deliberately redundant — it catches the next swallowed splice even if someone adds one without adopting. Its stated limit: it reads a NET growth, so it is meaningful only for an insert-ONLY transaction, which is exactly the cross-editor shape.
- **Adopt ABOVE the same/cross fork, not inside it.** `text-range-move` resolves the payload once before it asks which editor it is talking to — the same-editor answer is the identical slice by identity — so the obligation is unconditional rather than a branch someone has to remember, and the census's declaration-level region honestly vouches for both splices instead of one branch vouching for its sibling.
- **A refusal only `applyDrop` can see is the task-321 defect.** `inlineAtomMoveSpec` is one of the two specs allowlisted out of the `plannedDropSpec` derivation on the ground that its doors are "symmetric by construction"; adding a refusal to one of them would have retired that ground. Both doors now derive from ONE pure `resolveDrop` (`create` | `move-within` | `move-across`), which is what makes the allowlist entry true rather than merely traditional. The cross-editor insert transaction is BUILT there, where the answer can still be `null`; `commit` only dispatches it and then deletes the source.
- **Moving a transaction onto the CLASSIFY door moves a THROW there with it** — the trap `planned-spec.ts` had described as unreachable, made reachable by this very fix and caught by the adversarial pass on it. `Transform.replace` resolves both positions (`RangeError` on a stale `placement.pos`) and `Transform.step` throws `TransformError` on a step that fails to apply; a hit-test position recorded on the last throttled mousemove can be stale by mouseup if the target card body shrank under it. `applyDrop` is caught by `finishApply`; `classifyDrop` is called BARE inside the controller's `async commitDropSession`, whose callers `void` it with no `.catch` — so an escaped throw becomes a rejected promise that never reaches `endDropSession()`, leaking the window listeners, the `data-drop-mode-active` body attr and the lift overlay past mouseup. So the containment is EXPORTED (`refuseOnThrow`) rather than re-derived, the hand-written spec wraps its RESOLUTION (not each door, so a third door cannot forget), and `planned-spec.ts`'s "no such throw is reachable today" sentence was retired rather than left standing. **An entry on `PERMITTED_HAND_WRITTEN_DECISIONS` is a claim about AGREEMENT between the doors, never about safety** — its allowlist reason now says so, because this fix is what proved the two are different claims.
- **The census is the leg with teeth, and it needs TWO editors to have any.** The primitive was never the part that could misbehave — a call site that doesn't ask it is. So [container-fit-guardrail.test.ts](../../../src/components/drop-mode/__tests__/container-fit-guardrail.test.ts) asks two questions over the same splice-site family (*did you fit?* AND *did you adopt?* — a THIRD, *did you ask the INLINE container?*, joined them in task 414), with the adoption exemptions allowlisted **per LINE** — a file-scoped list would excuse the next splice added beside them, and two of the three entries live in the very file whose cross-editor splice was the defect. Measured on the pre-fix tree, it names all three defect sites. The behavioural half ([cross-editor-adoption.test.ts](../../../src/components/drop-mode/__tests__/cross-editor-adoption.test.ts)) builds **two genuinely distinct `Schema` objects**, which is the reason no existing suite could see any of this: every one of them builds ONE schema and hands the same object to both editors, where the splice is native by construction and the defect is unrepresentable.

**Reachability, stated honestly rather than implied.** Narrow today, and a reason to price it below "urgent" rather than to leave it: the target must be a REGISTERED drop-target editor other than the main one (only `RichTextField` card bodies register — `BorrowedMainText` does not), expanded and editable; it must be hit-testable during a drop session, and `globals.css` makes every `[data-floating-panel="true"]` subtree `pointer-events: none` while one is active, so the reachable surface is the omni column; and the body must contain a node DECLARING a `uuid` attr, since `hitTest` bails when `resolveAnchorableBlock` returns null and card-body `paragraph`/`heading` carry none. A note with display math, or an archived excerpt holding a figure, is enough. The same two lines are also a **latent trap** — anything that registers a second drop-target editor, or gives card bodies uuid'd paragraphs, widens this to every card body at once.

#### The sequence half: a gesture's EXIT STATE is the next gesture's INPUT

Same gesture, the second time you perform it (task 482) — and the case where
every piece behaved as designed and the *composition* of two of them was
nobody's job.

A between-blocks block move ended with `selectInsertedSpan`, "so the user sees
where the payload landed": a non-empty TextSelection over the moved block's own
content. The grab-handle resolver gives a live non-empty TextSelection ABSOLUTE
priority over the hovered block, so the one handle at that row became a
SelectionRef — the block's own handle GONE, replaced within ~6px of where it
was. A SelectionRef lift hydrates a transient `linkedRange`, which
`lookupSpec` routes to `textRangeMoveDropSpec`, whose placements include
`inline-cursor`. So over text the inline caret wins, and that branch splices the
run MID-WORD into the target and deliberately sheds no shell.

Measured live on a flat 4-item bullet list, deterministic: drag Beta below
Delta (a clean reorder, uuid conserved), then grab "Beta" again at the same
visual spot and release it 6px into Gamma's first text line — the natural "put
it back on that row" aim. Beta's TEXT lands inside Gamma's word
(`Gamm⟨Beta flat bullet two.⟩a flat bullet three…`) and Beta's `listItem`
survives as an EMPTY husk still carrying its uuid: an invisible blank bullet
that every anchored card and marker now points at, two undo steps to recover.
**From the baseline state the identical gesture at the identical pixel is a
clean no-op.**

> **A gesture's exit state is read by the NEXT gesture as user intent, so it is
> stated in the vocabulary of what MOVED — and "here is what landed" is a VIEW
> signal, not document state the next gesture should consume** (the transient-
> state law, task 120, arriving in the selection instead of in a mark).
> Beside it, the RESOLVER's own rule: **a text lift is a PARTIAL range.** A
> selection covering exactly one textblock's whole content is a statement about
> that BLOCK, whoever made it.

Two halves, and each closes the reported repro on its own — deliberately, since
the commit is only ONE producer of a whole-block selection:

- **The exit state.** `selectInsertedSpan` → [`placeCaretAtLanding`](../../../src/components/drop-mode/util/mapped-insert.ts):
  a collapsed caret at the start of what landed. Every caller of
  `insertNodesAdvancing` splices whole NODES, so a selection over its span was a
  statement about blocks made in the vocabulary of text. The resolver's rule 1
  requires `from !== to`, so it cannot fire at all.
- **The resolver.** [`resolveSelectionGrab`](../../../src/text-objects/selection-payload.ts)
  — `wholeBlockSelection` first, `SelectionRef` only for a genuinely partial or
  multi-block range. It covers the other producers: a triple-click, a `Cmd+A`
  inside one block, a text-range move that landed as exactly one new block.

Six rules they earned:

- **A `NodeSelection` on the landed node was the obvious "what moved" answer and
  is WRONG here, for a reason worth writing down**: prosemirror-view's base
  stylesheet is not loaded in this app, so `.ProseMirror-selectednode` is
  unstyled for every kind but `latex-comment`/`expex-block` — a node selection
  would be visually INVISIBLE *and* would add `ProseMirror-hideselection`, i.e.
  strictly worse feedback than a blinking caret. `texBlock`/`forestBlock` also
  declare `selectable: false`, so it could not have been uniform anyway. If the
  "here is what landed" flash is wanted back it belongs in a DECORATION with its
  own clear, never in the selection.
- **The contrast is the rule, not an exception.** `text-range-move`'s
  inline-cursor branch keeps its own `selectInserted` text selection: what
  landed there IS text inside an existing block, so a text selection states it
  truthfully — and the next drag at that pixel is then a text drag, which is
  what moved.
- **The owner is the uuid-bearing ancestor, never the textblock itself.** A
  `listItem`'s inner paragraph carries no uuid (`DEFERRING_PARENTS`), so the
  walk that both ladders already ran is what answers — `selectionOwner`, written
  twice before this and read from one place now.
- **The two ladders stay DIFFERENT, and that is stated at both sites.** The grab
  handle resolves a DRAG PAYLOAD; `active-text-object-context`'s
  `resolveFromSelection` resolves an ANCHOR TARGET for the menus. Whether a
  triple-click over a whole paragraph should mint a Mode-B `linkedRange` or a
  Mode-A paragraph anchor is a product question with no reported symptom, so
  only their shared ancestor walk was unified.
- **`from === to`, not `sel.empty`.** Identical on a real `Selection` (`empty` is
  a getter over exactly that comparison) and the spelling both ladders already
  used — which is what a hand-built fixture can satisfy. Measured: switching to
  `sel.empty` crashed three suites whose stub selections are plain objects.
- **The predicate is offset-EXACT at both ends**, so a one-character-short
  selection is still a text lift. A "close enough" rule would silently convert
  deliberate near-whole-block text drags into block moves.

CI: [drag-sequence-payload.test.tsx](../../../src/components/drop-mode/__tests__/drag-sequence-payload.test.tsx)
drives TWO REAL commits back to back through the REAL spec against a REAL
schema, with an editor stub whose `dispatch` APPLIES — **no pre-482 suite drove
two gestures in a row**, because every drop-mode fixture builds one pristine
state, plans one drop and reads the transaction it *would* have dispatched, so
the sequence class is unrepresentable in all of them. Its defect leg
reimplements the RETIRED exit rule locally rather than re-parameterising the
live one, and the component legs read `data-grab-owner-kind` off the REAL
handle. Measured by neutering each half in turn: the retired exit rule takes 4
legs, the whole-block rule 3, and the six control legs (a partial selection, a
two-block selection, a caret, a node selection, both offset ends) pass either
way and say so.

**Residual, stated rather than implied.** Pulling an item to top level MINTS a
`bulletList` around it (content `listItem+`); moving it back cuts that list's
sole child, so ProseMirror keeps an empty `listItem` residue — a visible empty
bullet in a container nothing else occupies. It is NOT the reported class (the
residue carries no uuid, so nothing points at it) and closing it is task 320's
SHED question one level up, where `AGENTS.md` is already explicit that "the
schema permits it" is not "it was residue" — a container-level shed has to
answer for `alignedGlossRow`, `heading` and `titleField` first. Pinned as its
own stated leg rather than left to be rediscovered.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live editor
gesture, no disk), so the check is cheap and real — the dev doc's list torture
fixture, the exact two-move repro.

### The identity half: a move conserves identity, a split mints it

Same gesture, one axis in (task 320). A between-blocks / inline-cursor **text-range** move builds its payload from `doc.slice(from, to)`, so every block child arrives carrying the SOURCE block's `uuid` — and the cut is TEXT-bounded (`findLinkedAnchorRange` returns text positions), so `tr.delete(from, to)` can never *remove* its first block: it opens it and joins what follows into it. Net, before this: **two live blocks answering to one uuid** (the moved copy and the residue), plus a blank paragraph sitting where the text used to be. A uuid is the anchor identity every card/sidecar resolves against (`resolveTextRangeByAnchorId`, the marginalia/panel derivations, `assignUuids` on save), so a card anchored to the source could resolve to the MOVED text and the next save's dedup had to pick a winner.

> **After a relocation, exactly one live presence may answer to a given `uuid` (or inline-atom id) — and the identity belongs to the TEXT.** A block the cut consumed ENTIRELY hands its id to the moved copy; a block the cut only PARTIALLY consumed keeps it at the source, and the moved fragment is a new presence that mints fresh.

The SSOT is [src/lib/tiptap/node-identity.ts](../../../src/lib/tiptap/node-identity.ts) (`collectBlockUuids` / `collectAtomIds` / `remintCollidingIdentity` / `inheritBlockUuid`), and five rules it earned — the last three of them from an adversarial pass on the *fix*, each a way the cure reproduced the disease:

- **Ask "did the source survive?", not "which end was partial?"** The two cases differ only in whether the source presence outlives the cut, which is exactly what a COLLISION test answers — so the mover stages the deletion, reads the ids still live at the destination, and re-mints only what would clash. No reasoning about open depths or join semantics, and a clean move returns the payload array unchanged. This is the **dual** of `stack-pull.ts`'s unconditional `withFreshUuid`/`withFreshAtomIds`: a pull is paste-as-new (the source always survives → every id fresh), a move is relocation (it usually doesn't → ids travel). Same axis, read two ways, which is why both share the collectors.
- **A NET is not a MECHANISM.** [`BlockUuidBackfill`](../../../src/lib/tiptap/block-uuid-backfill.ts) already guaranteed unique block uuids for every insertion — and could not have fixed this, because it sees only *that* two blocks collide, never which one the user meant. Its tie-break is document order, which for a range move is the empty residue: it keeps the identity and re-mints the moved text, silently detaching every anchor from its own words. So a relocating gesture states identity before dispatch and the net catches what no mechanism declared — the same division of labour as the container fit above.
- **"The schema permits it" is not "it was residue."** `dropEmptiedSourceBlock` sheds the block the cut emptied, and the first version gated that on `isTextblock` + `Node.canReplace` — which answers *is the parent still valid without this child?* For a whole family of textblocks the answer is yes while their EXISTENCE still carries meaning their text does not: `alignedGlossRow` is `glossCell*`, so dropping an emptied gloss cell shifts every column to its right against the other tiers and silently destroys the interlinear alignment (a `\gla` measured at 2 cells against a 3-cell `\glb`); a `proseGlossRow` is the whole `\glft` line; a `heading` is the section, its outline entry and its fold; a `titleField` is `\title{}`. No schema-derived predicate separates those from prose — a `glossCell` is even its parent's default type — so the rule asks the narrow question it can answer honestly: **is the shell the plain `paragraph`, with every attribute but `uuid` at its default?** A wrongly-kept empty paragraph is visible and one keystroke to fix; a wrongly-removed gloss cell is silent corruption. `canReplace` and a `protect` veto (the drop's own insert point) remain as the second and third guards.
- **Shedding a shell TRANSFERS its identity; it must never destroy it.** `rangeSliceToBlocks` handles a range inside ONE textblock — the commonest form of the gesture — by building a brand-new `paragraph.create(null, …)`, so the source uuid is not on the payload at all. That was harmless only while the emptied block survived to hold it; the moment the residue is shed the identity is carried by nothing and leaves the document, orphaning every card anchored to it. Which is *the same anchor detachment this law exists to prevent*, arriving from the opposite side. So `inheritBlockUuid` stamps the freed id on the payload's first null-uuid node (outermost first, since the container fit may have wrapped it), and the collision pass then sees a free id and keeps it. Cross-editor drops deliberately do NOT transfer: uniqueness is a per-document invariant and a main-doc id means nothing in a card body.
- **A branch with nothing to inherit does not shed.** The inline-cursor move dissolves its run INTO an existing block, so no payload block exists to receive a freed identity — shedding the shell there would delete the uuid outright. It is left exactly as L3f-2 shipped it, which is the law applied, not an exemption from it. (And its no-re-mint is *not* because "the open slice's boundary blocks never materialize" — with a range whose ends share a container they do. What keeps it collision-free is that a text-bounded `tr.delete` joins BACKWARDS, so the id that survives at the source belongs to the block that merges away here. That is a property of the delete, not of this code, so the guarantee rests on the net — which is what a net is for. Stating the true reason matters more than stating a tidy one.)

And the reason the net was silent rather than merely wrong: **its coordinates were per-transaction where they had to be per-step.** It read every step's positions against `trk.before` and mapped them through the FULL `trk.mapping`, re-applying earlier steps' maps to positions that already reflected them. For the delete-then-insert shape *every* relocation uses, that collapses the inserted range to nothing when the insert lands BELOW the cut — zero candidates, no backfill, a duplicate in the document, CI green. (An insert ABOVE the cut mapped correctly and did fire, which is why the defect looked direction-dependent — and why that direction shipped the *other* failure, the moved text re-minted and the shell keeping the id.) It now reads `trk.docs[si]` and `trk.mapping.slice(si)`. This is the same law the `DocStructureObserver` learned about multi-step transactions; a third copy of it should fold onto one primitive rather than re-derive.

**The range stays the step's own SPAN, never the ranges its `StepMap` reports** — a tempting simplification that would have retired the `instanceof ReplaceStep | ReplaceAroundStep` filter, and a live regression. A `ReplaceAroundStep`'s map covers only its two side ranges and deliberately omits the GAP: the preserved content that changes *parent*. Anchorability in the backfill is a function of the parent (`isDeferredInnerParagraph`), so a paragraph LIFTED out of a `listItem`/`blockquote` becomes a first-class text object entirely inside that gap — and read from the map alone, every toggle-list-off, toggle-blockquote-off and Backspace-at-list-start left the lifted block with a null uuid, hence no `data-uuid`, hence no grab handle and no anchorable target. Verbatim the bug the plugin exists to fix, on a plugin mounted on every surface.

Contracts: [range-move-identity.test.ts](../../../src/components/drop-mode/__tests__/range-move-identity.test.ts) runs the spec against the real schema with **no plugins mounted** — deliberately, since a spec that needed the net to be correct would be letting the net's document-order tie-break decide the semantics — and covers the whole-block move, the partial-cut re-mint, the single-block identity transfer, and the two shells that must survive (a `heading` at default attrs, a `glossCell` whose row is `glossCell*`). [block-uuid-backfill.test.ts](../../../src/lib/tiptap/__tests__/block-uuid-backfill.test.ts) pins both directions of the per-step fix (a duplicate inserted below the cut is re-minted; a whole-block move below the cut still keeps its id) plus the lifted-block gap case. Every one of them fails on the implementation it was written against.

### The return half: what an excerpt card holds must be able to come back

Same law read backwards (task 106). `bodySchema: "excerpt"` says a card body holds a verbatim slice of the document — which means it holds the ONLY copy of prose the capture deleted. The capture direction has been guarded since 308; the return direction had **no user-reachable path at all**: `ArchivePanelProps` declared `onInsert`/`onRestore`, `EditorPane` built handlers, `ArchiveHost` passed them, and `ArchivePanel`'s parameter list never destructured them. Archived text could be edited, jumped-to and deleted, never put back.

> **A capability declared on a card body is an obligation on both directions. Un-archiving is a MOVE: the content lands in the document FIRST, and the card that held it retires only on the strength of a report that it landed.**

Four rules, mirroring the capture side's:

- **The affordance is DERIVED from the same facet as the guard.** `isExcerptCardKind` ([predicates.ts](../../../src/cards/predicates.ts)) gates the restore control, so the declaration that makes the capture legal is the declaration that makes the return reachable — a future excerpt kind inherits both. `EditorPane`'s handler map is pinned to `excerptCardKinds()` by a boot assertion (a compile error where membership is a type union, as with `atomCards`; `bodySchema` is a runtime facet, so it is asserted instead).
- **A card action is a CONTEXT, not a prop.** [card-restore-actions.tsx](../../../src/panels/_shared/card-restore-actions.tsx) mirrors `card-archive-actions.tsx`: `EditableCard` consumes it directly, so the wiring cannot dead-end in a component that forgot to read it. Types prove a prop was *passed*; nothing proves it was *used*, and the panel that drops it type-checks exactly like the panel that renders it. CI: [dead-panel-prop-guardrail.test.ts](../../../src/panels/__tests__/dead-panel-prop-guardrail.test.ts) flags any `*Props` member with no second occurrence in its own file — `src/panels/**` is drained to EMPTY; the pre-existing host-layer census is pinned so it can only shrink. A hit is WIRE-it or DELETE-it, never an allowlist entry. Its ROOTS are `src/panels` + `src/components` — widened by task 441 to the editor-layout silo and by task 479 to the panel CHROME the whole silo mounts (`panel-primitives.tsx`, `EditorPane.tsx`), which was in neither root although task 182's entire finding was dead props inside it. The walk skips a TYPE-ONLY module (types out, no value export) rather than just a `.d.ts`: a `.ts` type SSOT declares a shape for consumption elsewhere, so the member rule — *does this occur a SECOND time in its own file?* — is not a question it can answer, and allowlisting its members one by one is what this guard's own header calls the wrong answer.
- **The report is the permission.** [`restoreExcerptAtCaret`](../../../src/lib/tiptap/restore-excerpt.ts) validates against the **live** editor schema (the dual of `canMountInCardBody`) and then checks the document actually changed — because `insertContent` swallows a mismatch exactly as `createNodeFromContent` does, so `void` looks identical for "restored" and "destroyed". `useArchive.restoreSnippet(id, land)` **takes** the landing function rather than returning the snippet, so there is no ordering for a caller to get wrong; the two old handlers dropped the entry either side of a call that could silently no-op.
- **AT the caret, never OVER a selection — and only where a split is ordinary.** `insertContent` replaces a non-empty selection, so restoring with prose selected would delete that prose (the same destruction, aimed at a different victim); anchoring at `selection.to` keeps the selection out of the insert (it is NOT purely additive — see the empty-paragraph note below). And a caret insert *splits the block it sits in*, which is ordinary editing in a top-level `paragraph` and silent corruption everywhere else — inside an `exampleItem` it splits the example in two, inside a `glossCell` it destroys the interlinear alignment, inside a `heading` it mints a phantom section — all of which still change the document, so the landed-test reports SUCCESS and the caller retires the only copy. This door is invisible to `container-fit-guardrail` (which censuses `src/components/drop-mode/`), so it carries its own check: refuse unless the caret is in a plain top-level paragraph. Conservative by choice — a rule verifiable by construction over a probe that must be trusted; the general form is `bareInsertTearsContainer` parameterised by the depth that may split, worth folding onto one primitive at the second caret-shaped splice.
- **An EMPTY paragraph is not split by the insert — it is REPLACED, and a replaced paragraph takes its identity with it (task 564).** TipTap's `insertContentAt` widens a collapsed caret in an empty textblock by one position each side and swaps the node for a block payload. For a blank line nobody refers to that is the nicer result. For a blank line a card is ANCHORED to it is a third silent shape the landed-test cannot see: the uuid leaves the document, the anchor guard stands down by task 367's rule (the removed node IS the remedy), every card anchored there goes to the unanchored bin, and the door reported success — while that uuid is DURABLE (an empty uuid-bearing paragraph serializes as its own `%!v:<uuid>` line and parses straight back). So the door resolves a LANDING, not a yes/no (`resolveRestoreLanding`): an anchored empty paragraph is left standing and the excerpt lands just AFTER it; an unanchored one keeps the replace, byte-identical to before. "Anchored" is read off the guard's own set through [`anchoredUuidsOf`](../../../src/lib/tiptap/linked-anchor.ts) — the ONE table `MarginaliaAnchorGuard` preserves against — never re-derived from the sidecars, so a door asking BEFORE a block vanishes and the guard asking AFTER cannot disagree about which blank line matters; a surface with no guard mounted answers with the empty set. The task's proposed `parTitle` rung was CHECKED and declined: `EmptyParagraphTitleCleaner` holds "no empty titled paragraph survives an edit" and clears the title and the uuid on any touched block or its siblings, so an excerpt landing beside one retires the title in the same dispatch and a title rung would buy a stray untitled blank line. CI: the landing-half describe in [restore-excerpt.test.ts](../../../src/lib/tiptap/__tests__/restore-excerpt.test.ts) drives the REAL main stack with the paragraph in the guard's set — measured, the two anchored legs fail on the pre-564 door and the four controls (unanchored replace, non-empty split, titled, no-guard surface) pass either way. *Found, not fixed:* the cleaner nulls the uuid of an ANCHORED titled empty paragraph too, so typing beside one orphans its card — the cleaner's own pre-existing rule, recorded for the catcher.
- **Retiring is SET-ASIDE, not delete.** The document insert is an undoable history entry; the sidecar write is not. Delete the entry and the user's next Cmd+Z — the natural key when an excerpt lands somewhere unintended — pulls the prose back out of the document with nothing left in the Archive: gone from both, no undo remaining. So the card flips `archived` (the reversible per-card axis every kind already has). The same choice drains the durability race, since the sidecar's 300 ms write no longer outruns the document's 1500 ms autosave into a window where a crash loses both halves.

**Two doors, one queue** — the persistence half, and the reason the bug had a second life. `usePersistentState` exposes `update()` (coalesced through a 300 ms debounce) and `persist()` (write now), and only the first owned the queue: an immediate write could be OUTLIVED by an older scheduled payload, which flushed afterwards and **resurrected on disk** what had just been removed, with in-memory state and the sidecar permanently disagreeing until the next edit. That is a PRIMITIVE hazard rather than one caller's slip — it is inherent to two write doors where one owns the queue — so `persist()` now cancels the pending timer and drops the stale payload, once, for every caller, and stamps the loader-stomp flag *after* the two guards that can make the write not happen (stamping it for a suppressed or dropped write would hide the sidecar for the whole session). Scope, stated honestly: the sidecar hooks with their own bespoke `persist` (`useFootnotes`, `useExamples`, `useAiRequests`, `useBibReview`, `useStack`, `useEditorUIState`) do **not** go through this door; among this hook's consumers only `useSuggestions.clearSuggestions` still calls it directly. Prefer `update()` regardless; `persist()` is for a read-then-write that needs the computed value back synchronously, and it cancels rather than merges, so its payload must already reflect any `update()` issued before it. Contracts: [archive-restore-contract.test.tsx](../../../src/hooks/__tests__/archive-restore-contract.test.tsx), [restore-excerpt.test.ts](../../../src/lib/tiptap/__tests__/restore-excerpt.test.ts), [card-restore-affordance.test.tsx](../../../src/components/__tests__/card-restore-affordance.test.tsx).

#### The re-parenting half: the NET may state what the STEP already said

Same law, the gesture that produces it most (task 499) — and the case where the
law was written down, was correct, and had ONE consumer.

`node-identity.ts` says *a move conserves identity, a split mints it*, and its
only production reader is the drop-mode text-range move. **No keyboard or menu
structural gesture declared anything.** Shift-Tab is upstream TipTap's
`liftListItem`, reaching the editor unmediated (`tab-indent.ts` deliberately
leaves Shift-Tab alone; task 427's wrapper gate covers only the parents'
`Mod-Shift` chords), so on a lift the `listItem`'s uuid — the text object every
card / todo / report / marginalia marker / sidecar entry was keyed on — simply
LEFT the document. Measured through the real stack, on the shape Gabriel
reported twice:

```
bulletList#L1 > (i1 "A") (i2 "B")     ← the list, minus its last item
paragraph#i3("")                       ← the resurrection guard's EMPTY husk
paragraph#70f2("C")                    ← the user's text, a stranger
```

Three mechanisms compounding, none of which throws: the ITEM's identity leaves,
`BlockUuidBackfill` — which could only MINT — gives the lifted paragraph a fresh
id, `TextObjectOrphanGuard` fires and the hooks permanently strip `links[]`, and
for a margin-anchored item `MarginaliaAnchorGuard` puts the old uuid back on an
empty paragraph above the text (task 367's `resurrectionWouldBeANoOp` stand-down
does not apply — what vanished was content-bearing). Verbatim the report: *"that
text is not properly placed as a text-object."*

> **A NET may state an identity where the STEP already said it.** The blindness
> `node-identity.ts` names — *a net can only tell that two blocks collide, not
> which one the user meant to keep* — is about a delete-HERE / insert-THERE pair
> in two SEPARATE steps, where nothing links them. A `ReplaceAroundStep` links
> them BY CONSTRUCTION: its GAP is content preserved and merely re-PARENTED, and
> its prefix `[from, gapFrom)` is the container tokens stripped off the front of
> it. So the net asks ONE question — **what happened to the gap content's
> PARENT?** — and answers it without guessing.

Two directions, each read where it is visible
([block-uuid-backfill.ts](../../../src/lib/tiptap/block-uuid-backfill.ts)):

- **A container that DISSOLVED hands its identity to its successor** — step-shaped
  (`planReparentTransfer`). *stripped + a FRESH parent inserted* ⇒ **RETYPE**
  (bullet ⇄ numbered: the same list, differently rendered); *stripped + no new
  parent* ⇒ **UNWRAP** (Shift-Tab, the Backspace lift branch, toggle-list-off,
  blockquote-off): the promoted content's FIRST block inherits; *neither* ⇒
  nothing (a mid-container split-lift — the container survives as the head half).
- **A block that STOPPED BEING A TEXT OBJECT hands its identity up** —
  result-shaped, so it needs no step at all: a `paragraph` that is now a DEFERRED
  inner paragraph still carrying a uuid has an identity nothing can reach
  (`anchorableUuidAt` skips it, `assignUuids` strips it on the next save), so if
  its container is BARE the container takes the id and the block is cleared.

Seven rules they earned:

- **Read the STRUCTURE, not the gesture, and one rule covers every surface** —
  the Shift-Tab keymap, the Backspace lift branch, the lightning grid, the slash
  command, the `Mod-Shift` chords, a card-body toolbar and anything added later
  — because the net sees the TRANSACTION. That is also why direction 2 is
  result-shaped rather than step-shaped: `wrapInList` over two paragraphs wraps
  the first in its `ReplaceAroundStep` and mints the SECOND item with a plain
  `tr.split`, which carries no gap to read. A step-shaped wrap rule conserves one
  of the two; the result-shaped one conserves both, with the same line.
- **The retype arm requires a TYPE CHANGE, and that gate is load-bearing.**
  `tr.setNodeMarkup` is itself a `ReplaceAroundStep` of exactly the retype shape
  (`gapFrom = from + 1`, `insert = 1`), so without it every in-place attribute
  write reads as a re-parenting — and a deliberate write of `uuid: null` is
  silently undone by handing the old id straight back. A same-type in-place write
  is the caller's own statement about that node.
- **A PRESERVATION GUARD MAY NOT RESURRECT A CONTAINER THAT DISSOLVED**, and
  that is the half the fix does not work without. `MarginaliaAnchorGuard` gains
  EXCEPTION 3 (`dissolvedByReparent`), the sibling of task 367's EXCEPTION 2:
  there the resurrection reproduced the removal (a silent veto of the gesture),
  here it contradicts it — and *wins*, because the net then sees the id live and
  mints the stranger beside the husk. Both halves are needed: measured, the
  transfer alone fixes only the un-anchored case, which is the case the reported
  one is not.
- **The guard's question is deliberately WEAKER than the transfer's, and that is
  what makes the two consistent BY CONSTRUCTION rather than by agreement.** The
  first cut keyed the stand-down on a planned TRANSFER and was wrong twice, both
  measured (review-caught): a last-item lift dissolves the `listItem` **and** the
  `bulletList`, and one node holds one id — so the list still husked, right above
  the user's lifted text, which is the reported symptom surviving the fix; and a
  transfer whose receiver turns out to be a deferred inner paragraph is PLANNED
  and then dropped at the landing site, so the guard stood down for a transfer
  that never landed. Asking only *did this identity's container dissolve?*
  removes both, because it needs no agreement with the net at all. What a
  declined resurrection costs is stated at the door: the card moves to the gutter's
  "N unanchored" bin (task 544; the pod-header chip of task 410 is its
  fallback) — the designed home for an anchor-less card, and strictly better
  than an empty line wearing its identity.
- **…and the predicate is computed from the transactions' OWN steps**, never from
  either plugin's output. That is what makes it independent of where each sits in
  ProseMirror's `appendTransaction` chain.
- **Every verification of the MINT half FAILS OPEN** — a receiver that is not a
  bare anchorable node, a donor that no longer holds the id, a freed uuid
  something else in the batch re-created, a mapped position that drifted: each
  falls back to the fresh mint that shipped before. A missed transfer is the
  status quo; a wrong one is a duplicate. Scoped to the mint half deliberately,
  because the GUARD half is not a fallback to pre-499 behaviour and saying so
  would overstate it: a dissolved container is not resurrected at all, and its
  card orphans to the chip.
- **UNDO takes the structure back and not the transfer, so the invariant needs
  one more line — found by driving undo, not by inspection.** The net's own
  writes are `addToHistory: false`, so the inverted lift step re-wraps a
  paragraph that by then carries the item's id inside a restored item that
  carries it too — and a deferred inner paragraph is never a candidate, so the
  duplicate rule cannot see it. *A container and its OWN deferred body paragraph
  can never both answer to one id*, and the container is the text object, so the
  paragraph is cleared. A container holding a DIFFERENT id keeps it and the
  paragraph keeps its unreachable one: nothing bare is there to hand it to, the
  serializer will strip it anyway, and clearing would destroy it a save early.
- **Keystroke sanctity is untouched**: the direction-1 pass sits BEHIND the
  `candidates.length === 0` fast path and bails per step on `instanceof
  ReplaceAroundStep`, which plain typing never produces; direction 2 is a
  two-condition test inside a walk the plugin already does, with its O(depth)
  `resolve` reached only by a paragraph that is deferred AND uuid-bearing — a
  shape that exists only just after something wrapped it.
- **Two bonus members came out of the same rule**, neither reported. `toggleList`
  bullet ⇄ numbered re-types the container in place, and pre-499 the new
  `orderedList` got a stranger's id while every card anchored to the list
  orphaned. And `setBlockType` — the Heading action and the heading-strip demote
  chip — mints a BARE node of a different type around the same content, which is
  the retype shape exactly, so paragraph ⇄ heading now keeps the block's id.
  That second one is *declared* rather than left to be rediscovered: the
  enumerated gestures above are all lists and quotes, and TipTap's own
  `toggleHeading` / `toggleCodeBlock` PRESERVE attrs, so nothing in the list
  vocabulary pointed at that path (review-caught).

CI: [reparent-identity-conservation.test.ts](../../../src/lib/tiptap/__tests__/reparent-identity-conservation.test.ts)
drives the REAL `buildEditorExtensions("main")` stack through `handleKeyDown`
and the shipped command chain — a direct `tr` dispatch cannot see which command
a keymap chooses (task 418's lesson) — over Shift-Tab × {only, first, middle,
last, multi-block item, multi-item selection} plus every other surface, keying
identity by STRUCTURAL PATH (task 348: a steal reads as two changed paths, a
re-mint as one) and asserting the husk and the orphan EVENT as well as the id.
**No pre-499 suite could see any of this**: `block-uuid-backfill.test.ts` covers
the lift through a synthetic two-node blockquote schema and *asserted a fresh id
as the contract* (renegotiated in place there, with the reason at the site);
`listItem` appears in it once, in a comment; and nothing anywhere drove a real
Shift-Tab. The controls are half the contract — `sinkListItem` (Tab) takes
nothing because its gap's first block is a `listItem` and never deferred, a
blockquote around a HEADING leaves the heading anchorable in its own right, a
mid-container split-lift leaves the head half holding the id, and an Enter split
still mints. The leg with teeth is the CENSUS: the population of re-parenting
commands is DISCOVERED from production source as an EXACT SET against what this
suite drives (a member nobody drives is a step shape nobody checked the net
against; a member no file calls any more makes the first leg pass for the wrong
reason), and no file outside the rule may spell the bypass meta, re-derive the
rule, or read a step gap itself. Measured by neutering each half in turn: the
pre-499 mint-only net takes **12** legs, direction 2 **3**, the guard's
EXCEPTION 3 **9**, the retype type-change gate **1**, the liveness gate **1**,
the container-owns-it clear **9** (1 named leg + the uniqueness sweep), keying
the guard on the planned TRANSFER instead of on DISSOLUTION **3**, moving the
pass in front of the keystroke fast path **1**, and a second file spelling the
bypass meta **2**. The sweep is the leg that speaks for the shapes no named
case looks at: 7 document shapes × 6 gestures × {gesture, undo, redo}, asserting
only the invariant the plugin has always owed — no two live nodes answering to
one uuid. One of this
suite's own first-draft legs was VACUOUS and is recorded rather than quietly
fixed: it counted TipTap's `transaction` event as a per-keystroke cost signal,
and that event fires once per DISPATCH, not once per APPENDED transaction —
measured, it passed with a backfill forced on every keystroke. The count lives
where `state.applyTransaction` returns it; what this suite pins is the pass's
PLACEMENT behind the fast path.

**Residuals, stated rather than implied.** A MULTI-item lift merges the items
into one before lifting (`liftOutOfList`'s own `tr.delete(pos-1, pos+1)`
preamble), so only the FIRST item's identity is still available when the lift
runs: the first lifted block conserves and the rest mint — the honest
composition of a join (N text objects became one) and a split (one became N),
pinned as its own leg. Those joined-away items also HUSKED if they were
margin-anchored — the guard's general JOIN behaviour rather than anything this
task introduced, measured on a plain two-paragraph Backspace-join with no list,
lift or transfer involved at all, and pinned here as a stated boundary.
**CLOSED by task 514** — see "The absorption half" immediately below; that
boundary leg is renegotiated in place. A block dropped INTO a
container that ALREADY has an identity is absorbed by it, because nothing bare
is there to hand the id to. And the outer container of a whole-list lift
(`bulletList` around a sole `listItem`) hands its id to nobody — the innermost
container is the one whose content became the paragraph — so its card orphans
to the unanchored bin rather than husking.

**Owed, not claimed:** a real-FSA eyeball. The orphan/husk half is the
FSA-masked class (real anchor death reproduces under prod File System Access),
so the durable proof here is the unit contract — anchor a note to a list item,
Shift-Tab it out, and confirm the marker follows the text with no empty line and
nothing in the unanchored bin.

#### The absorption half: a JOIN is the THIRD way a block leaves

Same guard, the departure 499 recorded and could not see (task 514) — and the
case where the fix's own predicate, `dissolvedByReparent`, is STRUCTURALLY blind
to it: a join produces no `ReplaceAroundStep` and no gap, so there is nothing for
that reading to look at.

Measured through the real stack with both paragraphs margin-anchored:

```
BEFORE   paragraph#P1("A")   paragraph#P2("B")     ← caret at the start of "B"
AFTER    paragraph#P1("A")   paragraph#P2("")   paragraph#099b("B")
```

The user pressed Backspace to merge two paragraphs and got a blank line holding
one of their identities, with their own text re-minted beside it. The join
produced `<p P1>AB</p>`; `MarginaliaAnchorGuard` then inserted an empty
`paragraph({uuid:"P2"})` at the mapped deletion site — which is INSIDE the merged
textblock — so ProseMirror's fitter split it and `BlockUuidBackfill` minted a
stranger for the half that got split off. Same on a list-item join, and it is
what made a MULTI-item Shift-Tab lift husk once per joined-away item, because
`liftOutOfList`'s own `tr.delete(pos - 1, pos + 1)` preamble IS a join.

> **A block leaves the document in three structurally different ways, and telling
> them apart is the whole of what the two guards need: it was REMOVED (its
> content went with it), its container DISSOLVED (its content was re-parented,
> task 499), or it was ABSORBED (its content MERGED into a surviving sibling).**
> The three are ONE question — *what happened to this block's content?* — so they
> are answered by ONE door, `classifyBlockDepartures`
> ([block-uuid-backfill.ts](../../../src/lib/tiptap/block-uuid-backfill.ts)), read by both
> guards. Two doors is how the resurrection guard and the orphan sweep come to
> disagree about a departure.

**Gabriel's ruling (2026-08-31): the absorbed card FOLLOWS the survivor.** The
join is a merge, not a delete — the words the card is about are still on screen,
inside the survivor — and the archive-displacement precedent (task 491, "the
margin context RE-HOMES onto the surviving neighbour") already chose that answer
for the sibling gesture. So the re-home runs through the SAME 491 door.

Eight rules it earned:

- **Absorption cannot be an identity TRANSFER, which is why the two mechanisms
  differ.** 499's dissolved reading hands a container's id to its SUCCESSOR where
  one exists; a join has none — the survivor already HAS an identity, and one
  node holds one id. So the absorbed identity really does leave the document, and
  the only place the card can follow it is the SIDECAR. That is why this reading
  publishes the SURVIVOR rather than a receiver position, and why the re-homing
  lands in React-land rather than in the net.
- **ONE uuid, ONE verdict.** `TextObjectOrphanGuard` publishes the ABSORBED
  signal INSTEAD of `virgil-textobject-orphaned`, never both — so the sweep that
  STRIPS a link naming a vanished uuid cannot race the re-home. 491 had to order
  those two by hand ("retarget BEFORE the delete"); here they are mutually
  exclusive by construction.
- **The signal is a REF, not a window event.** N `EditorPane`s are mounted at
  once under multi-doc keep-alive, so a window listener registered per pane is
  answered by every pane (the task-329 class). A ref threaded through the
  extension ctx is per-EDITOR by construction — there is no visibility question
  to get wrong. The sibling `virgil-textobject-orphaned` keeps its window channel
  because its consumers (`useArchive` / `useTodos`) are per-doc hooks with no
  editor in hand; a re-home needs the survivor's live paragraph text, so it has
  to be asked of the editor that performed the join.
- **TWO things fail OPEN back to the orphan event**, because a needless orphan is
  the pre-514 behaviour while a re-home onto a dead paragraph is a fresh defect:
  a survivor that did not itself survive the batch (checked against the SETTLED
  doc the sweep already walks), and a surface with no handler wired — only the
  main `EditorPane` mount supplies one.
- **The step reading is `ReplaceStep` ONLY, and that is the true scope rather
  than a shortcut.** A plain join, a Delete at a block end, a range selection
  dragged across a boundary and `liftOutOfList`'s merge preamble are all
  `ReplaceStep`s. The one `ReplaceAroundStep` join `deleteBarrier` uses (pulling
  a paragraph into the last item of a preceding list) RE-PARENTS, so
  `dissolvedByReparent` already answers it and husks nothing; re-classifying it
  as absorption would renegotiate 499's decided orphan outcome for the whole lift
  family inside a task whose ruling is about the JOIN. Stated as a residual.
- **The ancestor walk climbs to the uuid-BEARING node, not merely the anchorable
  one.** A `listItem`'s body paragraph carries no uuid (it defers to the item —
  `DEFERRING_PARENTS`), so stopping at the first anchorable ancestor would answer
  with a node that has no identity to lose. Climbing to the id is also what makes
  two paragraphs joined INSIDE one list item answer with the SAME node, which is
  correct: nothing departed.
- **"They merged" is CHECKED, never inferred from the step's shape.**
  `step.to` lands exactly `slice.size` past `step.from` after the step, so asking
  where those two positions sit in the POST doc asks whether the boundary
  survived — four `resolve`s, no walk — and the surviving node's uuid must be the
  survivor's. Everything unreadable fails CLOSED to today's behaviour.
- **Chains resolve to their END.** A batch that joins three blocks in two steps
  re-homes every absorbed card onto the ONE block that survived it, never onto an
  intermediate that is itself gone. Cycle-guarded; a degenerate self-target is
  dropped rather than published.

CI: [join-absorbed-anchor.test.ts](../../../src/lib/tiptap/__tests__/join-absorbed-anchor.test.ts)
drives the REAL `buildEditorExtensions("main")` stack through `handleKeyDown` and
the shipped command chain — a direct `tr` dispatch cannot see which command a
keymap chooses (task 418's lesson) — over the reported paragraph join, a
list-item join, a range delete across a boundary, the multi-item lift, undo, and
a two-cycle `.tex` fixed point. **No pre-514 suite could see any of this**:
`anchored-block-delete-reinsert.test.ts` characterises this guard thoroughly by
dispatching `tr.delete` DIRECTLY, where a join is unrepresentable, and 499's own
suite PINNED the husk as the contract (renegotiated in place there, with the
reason at the site). Its CONTROLS are half the leg count: a whole-block delete
still resurrects, two paragraphs joined inside ONE list item announce nothing
(one identity, nothing departed), and an intra-block delete announces nothing.
[rehome-absorbed-anchor.test.ts](../../../src/cards/__tests__/rehome-absorbed-anchor.test.ts)
drives the re-home door against a recording `AnchorRetargetApi` — the two things
that can go wrong there (a survivor whose type is not a text-object kind, since
the guard is registry-free by design; a degenerate self-target) are invisible to
any test of `retargetDisplacedAnchors` itself. Measured by neutering each half in
turn: EXCEPTION 4 takes 7 legs, the absorbed notification 3, and a dropped
`onBlockAbsorbedRef` prop 1 (the census).

**Owed, not claimed:** a real-FSA eyeball. Anchor death is the FSA-masked class,
so the durable proof here is the unit contract — anchor notes to two adjacent
paragraphs, Backspace-join them, and confirm no blank line and both markers on
the survivor.

### The schema half: a TYPE contract is blind to the ATTRS the type carries

Same law, the SCHEMA the excerpt body mounts (task 402, DATA LOSS) — and the
case where the reverse-direction guard was complete over the axis it asks about,
silent on the axis that loses, and had written its own blindness into a fixture
comment as a verified fact.

Task 308 gave the excerpt surface the full block VOCABULARY and pinned it with
the direction that has teeth: every node and mark type the main editor can
produce must be mountable in a card body. `EXCERPT_STARTER_KIT_CONFIG` is the
empty override, so an excerpt body mounted StarterKit's PLAIN `heading` /
`paragraph` / `bulletList` / `orderedList` / `listItem` / `blockquote` /
`codeBlock` — while the MAIN editor turns those same StarterKit nodes OFF and
registers its own carrying nine more names across **nineteen node x attr
pairs**: `uuid`, `parTitle`, `label`, `numbered`, `sectionNumber`, `shortTitle`,
`listPreamble`, `listOptions`, `itemLabel`. Type membership was complete and the
two schemas still disagreed about every one of them.

**ProseMirror drops an undeclared attr in SILENCE.** `computeAttrs` iterates the
TYPE's attrs; `Node.fromJSON` does call `checkAttrs`, but on the
already-computed result, which by construction holds no undeclared key. And
TipTap only runs `node.check()` under `enableContentCheck`, which is off. No
throw, no warning, no console line.

**The stripper is the card-body EDIT, not the restore**, which is the whole of
the repro and the reason no leg can be written without typing.
`restoreExcerptAtCaret` strips nothing; `RichTextField`'s `onUpdate` (250 ms
debounce) and its `onBlur` flush both call `onChange(editor.getJSON())` on the
attr-poor mounted schema, and `ArchiveCard`'s `handleEditContent` writes that
straight over `snippet.content`. So: **archive (attrs intact) -> the user edits
ONE character in the card -> `archive.json` holds an attr-less heading ->
restore faithfully hands back the lamed version.** An UNEDITED excerpt restored
whole, which is exactly why it read as flaky.

Measured on the restored `.tex`: `label` / `numbered` / `shortTitle` are the
heading's `\label{}`, its `*` and its `[short]`; `listOptions` / `listPreamble`
are `\begin{itemize}[…]` and its tuning lines; `itemLabel` is `\item[…]`.
`parTitle` has no `.tex` carrier at all — it lives in the sidecar and was simply
gone. And `uuid` is IDENTITY rather than bytes: `BlockUuidBackfill` mints a
FRESH one on restore, so every card, marginalia marker and sidecar entry
anchored to the archived block ORPHANS — from the only surviving copy of prose
already cut from the document.

> **A contract over node TYPES is not a contract over the schema. Where two
> surfaces must agree about a node, the attrs it declares are DECLARED ONCE and
> both surfaces read that declaration — and the reverse-direction guard asks
> about the ATTRS as well as the types.**

[`MAIN_STARTERKIT_NODE_ATTRS`](../../../src/lib/node-attr-sets.ts) is the declaration:
the seven rows, full specs, in the import-free leaf that already holds
`UUID_BEARING_NODE_TYPES` / `TITLED_NODE_TYPES` / `CARD_BODY_BLOCK_ATOMS` — the
placement rule `latex-markers.ts` earned. Six rules it earned:

- **The MAIN editor reads it too, or the table is a second copy of the schema
  rather than its source.** Each builder in `editor-extensions.ts` spreads its
  row; byte-identical to what shipped, and it is what makes the reverse contract
  meaningful rather than tautological — the excerpt gets exactly what the table
  holds, so an attr added INLINE to a main node fails the guard (measured).
- **`UUID_ATTR_SPEC` / `makeUuidAttr` MOVED into the leaf**, with
  `tiptap/uuid-attr.ts` re-exporting them so every importer is unchanged. They
  are two of the nineteen pairs, and the leaf cannot import a module that
  reaches `EditorView`. A spec spelled twice is a spec that can drift.
- **The registration route was tried first and DECLINED, for a stated reason.**
  Re-registering the main builders would drag their machinery — the `+T` title
  strip, the fold chevron, the label handler, and for `heading` a host main
  editor to proxy structural writes to, none of which a card body has — and it
  would pull `editor-extensions.ts` into a module every card surface imports.
  `addGlobalAttributes` adds attributes to a registered node without
  re-registering it, and TipTap ignores a global attribute naming a type the
  schema has not got, so it is inert at the `"card"` scope by construction.
  Mirror the schema, not the machinery.
- **The excerpt takes the attrs DATA-only** (`dataOnlyAttrs`: same `default` and
  `keepOnSplit`, `rendered: false`, no parse/render). `rendered` is a DOM fact —
  `toJSON`/`fromJSON` carry the attr regardless, which is why every already
  non-rendered member round-trips today — and `data-uuid` is a RESOLUTION KEY:
  `resolveDomForUuid`, the grab-handle hover scan and the marginalia registry
  all query it. A card body has none of that chrome, so a second copy of the
  document's identity attributes would have no reader and every opportunity to
  become one. `keepOnSplit` is CARRIED rather than defaulted away: an item split
  in a card body must no more inherit its neighbour's `\item[(b)]` than one in
  the document.
- **`sectionNumber` is in the table although it is not a loss.** The serializer
  never reads it and main's numberer recomputes it, so it is self-healing — but
  excluding it would buy an exemption list on a guard whose whole value is
  being an exact equality. Zero cost, one fewer thing to be wrong about.
- **The fixture comment that waved this through is RENEGOTIATED in place, with
  the reason at the site.** It read: *"main-editor blocks carry their `uuid` /
  `parTitle` / `label` attrs, which the card schemas' plain StarterKit nodes do
  not declare. (Verified tolerated — ProseMirror ignores undeclared attrs on a
  known type; only an unknown TYPE or MARK blanks the doc.)* Both sentences are
  true and the conclusion drawn from them was the defect, asserted as the
  contract — the shape this file's own rule about guards pinning the wrong thing
  is written against.

CI: [excerpt-attr-preservation.test.ts](../../../src/lib/tiptap/__tests__/excerpt-attr-preservation.test.ts)
drives the REAL story per row of the table — `parseLatex` -> the REAL capture
door (`prepareCardBodyCapture` over a real `doc.slice`) -> the REAL card body
composed extension for extension as `RichTextField` composes it -> ONE typed
character -> `normalizeRichContent(getJSON())`, which IS what the archive host
persists -> `restoreExcerptAtCaret` -> the `.tex` bytes AND the node attrs, over
TWO cycles. Every fixture carries an explicit `%!v:` anchor, which is
load-bearing rather than tidy: `assignUuids` mints RANDOM ids, so a fixture
without one makes an identity assertion unfalsifiable in both directions. The
widened reverse contract lives in
[excerpt-schema.test.ts](../../../src/lib/tiptap/__tests__/excerpt-schema.test.ts) (per
node type AND per mark type), the table's own premise — no stale row — in
[node-attr-sets.test.ts](../../../src/lib/__tests__/node-attr-sets.test.ts), and the
census (no attr spec re-declared outside the SSOT; both card surfaces resolve
their StarterKit config and body schema BY SCOPE) beside the round trip.
Measured by neutering each half in turn: the pre-402 excerpt schema takes 10
behavioural legs plus the widened guard, `dataOnlyAttrs` 1, an inline attr on a
main node 1, and a re-declared spec 1 (the census). The two non-regression pins
— an UNEDITED excerpt restores whole, and the narrow `"card"` scope mints no doc
attrs — pass either way, and say so at the site.

**Owed, not claimed:** a real-FSA eyeball. The archive sidecar round trip is
FSA-masked, so the durable proof here is the unit contract — archive a
`\section*[Short]{X}` carrying a `\label`, edit the card, restore, read the
`.tex`.

**Known related gap, stated rather than fixed:** `listItem`'s CONTENT expression
also forks — `"paragraph block*"` (StarterKit) vs `"(paragraph | graphicsBlock)
block*"` (main). `canMountInSchema` is `schema.nodeFromJSON`, which routes to
`NodeType.create` and does NO content-expression check, so a `graphicsBlock`
inside a `listItem` is mountable in the excerpt body by a route the guard does
not model. Real, adjacent, and its own task.

### The attrs half: a gate written in NODE TYPES and TEXT cannot see ATTRS

Same law, the PREDICATE that decides whether a destruction needs a confirm at
all (task 401) — and the case where the guard was correct about the vocabulary
it could see and blind to the one Virgil's payload actually lives in.

`hasJsonContent` recursed looking for `text` nodes and had no `attrs` arm, so
`cardHasContent(kind, rec)` answered **false** for a body that is entirely one
atom: `$\lambda$`, a `citation`, a `\ref`, a nested footnote marker, a
`displayMath`, a `texBlock`, a `forestBlock`, a `graphicsBlock`, a caption-less
`figureBlock`. That is not an exotic body — it is the ordinary shape of a
footnote holding one formula.

**The headline cost was DESTRUCTION, not a missing dialog.** `EditorPane`'s
`handleEditFootnote` marks a new footnote DIRTY only when the predicate says the
body has content, so an atom-only footnote stayed **pristine**; the
document-level capture-phase `pointerdown` watcher in `usePristineCardManager`
then fired the discard, and the discard handler re-asked the SAME blind
predicate before deleting. **Create a footnote, type `$\lambda$`, click anywhere
else: it is gone.** No confirm, no orphan card, no undo affordance — and a
footnote body is by construction the only copy. Four more doors share the
predicate, which is what made the one-function fix total: `EditableCard.tryDelete`
(the trash click AND the task-386 key door), `usePanelCardTryDelete`,
`deleteMarginItem`, and the footnote ORPHAN gate. The ARCHIVE case is the worst
blast radius — the capture dispatches `tr.delete` FIRST, an archive card is born
`title: ""` with no auto-title rescue, so the gate has nothing else to see.

> **A gate written in the vocabulary of NODE TYPES and TEXT cannot see content
> that lives in ATTRS.** So it is inverted: everything carries content EXCEPT
> the empty structural wrappers a blank document is made of
> ([`EMPTY_WRAPPER_NODE_TYPES` / `jsonCarriesContent`](../../../src/lib/node-attr-sets.ts)).
> An allowlist of "nodes that carry nothing by themselves" is CLOSED and small;
> a denylist of atoms can only ever be missing the tenth.

Six rules it earned:

- **The correct-shaped twin already existed two files over, and taking it was
  the fix.** `jsonCarriesContent` (`schema-mount.ts`'s mount-preservation door)
  asked exactly this question and got it right, with a private
  `EMPTY_WRAPPERS = new Set(["doc","paragraph"])`. Two walkers for one question
  is the fork; the set moved to the import-free leaf (the placement rule
  `latex-markers.ts` earned) and both doors read the ONE operation, so the mount
  door and the delete confirms can no longer answer differently about one body.
  `hasJsonContent` is DELETED rather than aliased — it had no caller outside its
  own file, and a second name for one question is a name the next author reaches
  for.
- **A WRAPPER carrying a payload attr is not empty**, which is the same disease
  one level in and would have survived the fix. `parTitle` is the one such attr,
  and the check is DERIVED from `TITLED_NODE_TYPES` rather than re-listed —
  `uuid` is identity (a blank paragraph has one and carries nothing) and
  `collapsed` is view state.
- **A TEXT node's content IS its `text` field**, so it is answered there and
  never falls through to the type rule — otherwise `{type:"text",text:""}`
  reports content because `"text"` is not a wrapper NAME. Unreachable from a
  live ProseMirror doc (PM forbids empty text nodes) and entirely reachable from
  hand-built JSON: an `/editor/*` skill's sidecar write, a legacy blob, a
  fixture. Found by a real-editor fixture, not by inspection.
- **The CONTROLS are half the contract.** A genuinely empty body must still
  answer false, or the fix becomes "confirm on everything" — every blank card
  nagging on delete and no pristine card ever reaped, which is a worse product
  than the bug.
- **The premise is CHECKED against the live schema**, the instrument task 148
  earned: every member is a node type the schema declares, the set IS the node
  types `emptyRichContent()` is made of, every member is a CONTAINER (never an
  atom or a leaf — the category error that would reopen the class), and — the
  direction with the consequences — **every NON-member of the live vocabulary is
  reported as content**, swept over the whole schema so a new node kind is
  covered by shipping rather than by a fixture. Note `doc` is `block+`: "can be
  empty" is NOT the property and asserting it fails, which is why the leg asks
  about containment instead.
- **The flag-ON orphan writer was a second table, closed as a FORK rather than
  as a bug.** `inline-atom-lifecycle-policy` hand-wrote "plainText or title"
  where its flag-OFF twin has asked `cardHasContent` since FN-A1-02. Measured,
  the two AGREE on every shipped body — `richJsonToPlainText` hands each
  attr-carrying block atom a non-empty placeholder (`[figure]`, `[graphic]`,
  `%`) — so this is a hardening and the census is the only leg that can see it.
  Stated that way rather than dressed as a live defect: a display projection is
  the wrong authority for a destruction gate whether or not it currently
  differs, and an arm added later returning `""` would drop a recoverable
  footnote on a flag flip nobody would connect to the loss.

CI: [atom-only-body-content.test.tsx](../../../src/cards/__tests__/atom-only-body-content.test.tsx)
sweeps the blind set per member — DISCOVERED from `ATOM_REGISTRY`'s `nodeName`
column ∪ `CARD_BODY_BLOCK_ATOMS`, so a new atom kind is covered by declaring
itself — and drives a leg per DOOR, because they share the predicate and a leg
per door is what proves the sharing. The pristine reap runs the REAL
`usePristineCardManager` `pointerdown` path with the REAL predicate composed as
EditorPane composes it; the two EditableCard doors drive the REAL component. The
leg with teeth is the CENSUS (EditorPane's two gates and both orphan writers
must spell the shared predicate; no production file may re-declare a wrapper
set, allowlist EMPTY, with a SYNTHETIC canary rather than one standing on the
drained line). The schema premise lives in
[node-attr-sets.test.ts](../../../src/lib/__tests__/node-attr-sets.test.ts). Measured by
neutering each half in turn: the pre-401 text-only walker takes 25 legs, a
has-content that re-forks its own walker 24, the text-node rule 3, the
parTitle-on-wrapper rule 1, and the orphan-writer unification 1 (the census).

**Owed, not claimed:** the preview eyeball. NOT FSA-masked for the headline (it
is a live editor gesture, no disk involved), so the check is cheap and real —
make a footnote, type `$\lambda$`, click away, and it must still be there. The
ARCHIVE half touches sidecars and is partially FSA-masked; the unit contract is
the durable proof there.

### The parent half: a capture cuts WITH the ancestors that give its bytes their meaning

Same door, the shape none of its four suites could represent (task 563) — and
the case where the vocabulary check passed a model the destination could NAME
and not HOLD, on the everyday gesture of drag-selecting across two bullets.

`doc.slice(from, to)` cuts at the SHARED-DEPTH node, so a selection from the
middle of one `listItem` to the middle of the next arrives as two items open at
both ends with no list around them. `captureSliceContent` knew two shapes —
wrap inline children in a paragraph, pass blocks through — and a `listItem` is
`isBlock`, so it went to DOC level: `{doc: [listItem, listItem]}`.
`canMountInSchema` asked `schema.nodeFromJSON`, which builds through
`NodeType.create` and checks the VOCABULARY only; the door said `ok`, the
delete ran, and the archive card mounted a content-invalid model (TipTap runs
`check()` only under `enableContentCheck`, which Virgil leaves off). It
RENDERED, and the first keystroke — or a select-all — threw `contentMatchAt on
a node with invalid content`: a dead card holding the only copy. Restore
reported SUCCESS, because the fitter WRAPS orphans in whatever holds them: two
items became a fresh list, two `exampleItem`s a fresh numbered example
(renumbering every example after it), two `glossCell`s a uuid-less
`\begingl … \endgl` at top level, which is invalid expex. Same root, second
symptom: a partial selection inside a `codeBlock` or `latexComment` yielded
inline TEXT, which the paragraph wrap turned into PROSE — `% parked old prose`
typeset on restore, `raw {bytes}` came back `\{bytes\}` (the 347/349
promotion class, through a door that promises a verbatim slice). Every archive
fixture in the repo selects INSIDE one paragraph or WHOLE blocks, where the
shared depth is the document and those two shapes are the only two that exist.

> **A capture cuts WITH its parents, and the leaf OWNS the cut.**
> [`captureRangeContent(doc, from, to)`](../../../src/lib/tiptap/slice-capture.ts)
> slices `includeParents` (the primitive task 122 recorded as load-bearing for
> the selection counter), so its top-level children are always real document
> blocks, cut: a sub-paragraph range is `paragraph(text)`, two items are
> `bulletList(listItem, listItem)`, a range inside a comment is
> `latexComment(text)`. A caller hands it a RANGE, never a slice it built
> itself — which slice is taken was the whole of the defect. **And the mount
> check asks CONTENT as well as vocabulary:** `canMountInSchema` runs
> `node.check()` after `nodeFromJSON`, so a model the schema names and cannot
> hold is REFUSED with the document untouched.

Six rules it earned:

- **An OPEN ancestor is a fragment of a node that SURVIVES, so it is captured
  FRESH.** Task 320's law ("a move conserves identity, a split mints it") read
  on a copy: along each open chain the attrs `cutFreshAttrs`
  ([node-attr-sets.ts](../../../src/lib/node-attr-sets.ts)) names are cleared — the
  identity trio (`uuid` / `parTitle` / `label`, each stripped where the schema
  pins the type declares it) plus every `keepOnSplit: false` attr of the
  StarterKit table (`itemLabel`, `listOptions`, `shortTitle`): a cut IS a
  split, so archiving the second half of `\item[(b)] beta` mints no second
  `(b)`. A block the range covers WHOLE keeps its identity — it is leaving the
  document and a restore re-establishes it, exactly as before. This is also
  what keeps today's single-paragraph bytes (a fresh, attr-less paragraph) and
  what stops a partial-paragraph capture carrying its source's `\label` into a
  restore.
- **An open node is CLOSED the way ProseMirror closes one.** A cut can leave an
  open node content-invalid on its own (an item whose range starts inside a
  NESTED list begins with a `bulletList`), and the fitter would close exactly
  that on restore by `ContentMatch.fillBefore` — so the leaf does the same, on
  the same schema fact, which is what lets the CARD hold the model. The fill is
  DERIVED (an empty paragraph, never a guess); a shape it cannot close is left
  for the door to refuse.
- **The content rung was MEASURED before it widened**, because two other
  callers share the primitive (the code-pane bridge, `checkKeptEverything`'s
  failure path): every `.tex` under the primary's `samples/`, `virgil-data/`,
  `library-data/papers/` and `public/examples/` plus both sides of every
  preservation-corpus case — 50 sources — passes `check()` against the main
  schema, so the code pane inherits the rung at no cost and refuses a lossy
  parse one gate earlier (task 357's posture). Stated limit: that is a corpus
  measurement, not a proof about the parser; a shape it cannot close is now a
  refusal where it was a silent mount.
- **A refusal NAMES the node whose CONTENT failed.** `invalidContentNodes` is
  the content twin of `unsupportedConstructs`, derived from
  `NodeType.validContent` rather than parsed out of PM's message, and at the
  ROOT it names the first child the destination cannot PLACE (the orphan item)
  rather than "doc", which the user cannot re-select. It EXPLAINS only; the
  primitive DECIDES.
- **Content-expression parity, spelled once.** Task 402 mirrored TYPES and
  ATTRS and recorded `listItem`'s content as its known gap. With the door now
  asking the EXCERPT schema about content, that gap would REFUSE an
  `\includegraphics`-headed item the document holds perfectly well — so
  `MAIN_STARTERKIT_NODE_CONTENT` is the ONE declaration, read by
  `createListItemWithUuid` and registered by the excerpt's `ExcerptListItem`,
  and `excerpt-schema.test.ts` pins `spec.content` equal for every shared node
  type (mirror the schema, not the machinery).
- **The three halves are LAYERED, and that is measured rather than tidy.** With
  the content rung in place, the pre-563 two-shape walk no longer mounts a dead
  card — the door REFUSES it (6 dispatcher legs fail as refusals, not as
  throws). The cut-with-parents is what turns that refusal back into the
  archive the user asked for.

CI: [archive-cross-sibling-capture.test.tsx](../../../src/components/editor-layout/card-actions/__tests__/archive-cross-sibling-capture.test.tsx)
drives the REAL `useDragHandleActions` over the REAL main stack, MOUNTS the
capture in the REAL editable excerpt surface and TYPES in it, then RESTORES
into a fresh document and reads the `.tex` — lists, expex items, gloss cells,
a comment, a code block, and the whole-block CONTROL (byte-identical to the
pre-563 capture, identity kept). The door legs live in
[card-body-capture.test.ts](../../../src/lib/tiptap/__tests__/card-body-capture.test.ts)
(the cut, the freshening, the nested-list close, the refusal that names the
node, `invalidContentNodes`' root rule); the parity legs in
[excerpt-schema.test.ts](../../../src/lib/tiptap/__tests__/excerpt-schema.test.ts).
`captured-passage.test.tsx`'s census is RENEGOTIATED in place (the needle was
the retired slice-taking leaf; the minter must enter the range-taking one).
Measured by neutering each half in turn: the two-shape walk takes **10** legs
(6 dispatcher + 4 door), the content rung **4**, the `listItem` parity **2**.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live editor
gesture plus a JSON round trip, no disk), so the check is cheap and real:
drag-select across two bullets in the dev doc, Archive, type in the card,
restore.

### The keyboard half: a destructive key asks ONE door, and a danger confirm cues its SAFEST button

Same law, the KEYBOARD carrier (task 386). Gabriel's repro: archive some text,
click `+T` on the resulting card, type a title, press `Backspace` mid-word — the
whole card is gone. Three defects compound, and any one of them alone would have
prevented the loss:

- **The guard hole.** `EditableCard` kept its own shell-level Delete/Backspace
  handler instead of the shared `useCardDeleteKey` door, and its only field guard
  was `isFocused` — which tracks the BODY rich-text editor and never the title
  `<input>`. So a `Backspace` in the title ran `preventDefault()` (eating the
  character edit) and deleted the card. The shared guard built for exactly this,
  `keyEventFromInteractiveControl`, was not consulted — and its own docstring
  asserted that EditableCard "already encodes this via its `isFocused`
  focus-tracking", true of the body and FALSE of the title. **The
  stated-invariant-with-no-consumer shape, in a docstring that granted the
  exemption.**
- **The keyboard trap.** The confirm a content-bearing card raises mounted with
  its DANGER button `autoFocus`ed, under a user mid-typing. From the keyboard's
  point of view "Backspace, keep typing" WAS "delete the card".
- **The invisible in-flight title.** `CardBodyTitle` is UNCONTROLLED and commits
  on BLUR, so `cardHasContent` read the value from before the user started. A
  card whose only content is the title being typed read as EMPTY and deleted
  instantly, with no dialog at all.

> **Every card-level Delete/Backspace enters `useCardDeleteKey`, so both guards
> (selection + interactive-control bail) hold by construction; a `tone="danger"`
> confirm cues its SAFEST button; and a content gate reads what is ON SCREEN.**

Five rules it earned:

- **The interactive-control match is scoped to a STRICT DESCENDANT of the card
  shell.** A card root is often itself `draggable="true"` (cross-editor anchor
  drags — `CitationCard` ships it, `EditableCard` has the wiring), and
  `[draggable='true']` is in `INTERACTIVE_CONTROL_SELECTOR` — so an unscoped
  `closest()` walks past every nested target and matches the ROOT, and the delete
  key would be dead app-wide with nothing to show for it. `PanelCard`'s own lift
  blocklist scopes the identical query for the identical reason; this was latent
  rather than live, and would have gone live the moment EditableCard gained a drag.
  **It was already LIVE one surface over (task 423):** the omni pin-on-touch blocker
  was written as a "mirror" of the lift blocker and dropped the scoping, so a press
  anywhere on a `CitationCard` (whose ROOT is draggable) matched the root and
  `holdOmniCard` never ran — the card and its whole deck jumped on every
  collapse/expand. The scoping rule now has ONE home,
  [`pressFromInteractiveControl`](../../../src/lib/drag-blocklist.ts) (strict descendant of
  the gesture's own container), read by the lift, the pin, the delete-key guard and
  the float window-drag; and the half the task's own first cut got wrong is stated
  there too — a surface that wraps a card from OUTSIDE cannot scope to itself,
  because the draggable shell is a strict descendant of it, so it resolves the
  `[data-card]` shell first (`cardShellWithin`) and asks against that. CI:
  [interactive-control-scope-census.test.ts](../../../src/lib/__tests__/interactive-control-scope-census.test.ts)
  (no production site spells `closest(<shared selector>)`, allowlist EMPTY) and
  [pin-on-touch-draggable-card.test.tsx](../../../src/panels/Omni/__tests__/pin-on-touch-draggable-card.test.tsx)
  (the REAL omni wrapper around a draggable `[data-card]` root). Measured by
  neutering: 5 legs.
- **The in-flight title is read LIVE, not committed per keystroke.** A title input
  REGISTERS ITS ELEMENT with the enclosing card
  ([panel-primitives.tsx](../../../src/components/panel-primitives.tsx) `CardTitleRegistry`)
  and the gate reads `el.value` when it asks. Committing on change would turn each
  character into a sidecar write (the task-363 cadence doctrine) and retire the
  input's own Escape-reverts affordance; reading the live ELEMENT can never go
  stale, where a mirrored draft is only as fresh as the events someone remembered
  to mirror. A Set, not a slot: a card may render more than one title surface.
- **`autoFocus` marks the CUED DEFAULT, and it must never be destructive.**
  `confirmDialogCuedDefault()` derives it for every caller — Cancel where there is
  one, else the secondary answer, else NOTHING (a single-button danger notice cues
  no button and `SystemDialog` focuses its FRAME, so Escape and Tab still start
  inside the dialog). The danger action stays keyboard-reachable by Tab+Enter,
  which is the right cost for a deliberate destructive choice. Recorded in
  `STYLE_GUIDE.md` beside the "RED means destructive without a net" note.
- **A destructive BARE-KEY shortcut bails on an editable target.** The sweep found
  the same missing guard one layer up and worse: `useMenuKeyboard`'s window-CAPTURE
  handler consumed bare keys with no `e.target` check, and `DragHandleMenu` aliases
  `Backspace`/`Delete` onto its DELETE row — so with a menu open and the caret in
  a field, one Backspace deleted the block before the field ever saw the key.
  `isEditableEventTarget` moved to the import-free `drag-blocklist` leaf (the
  placement rule `latex-markers.ts` earned) so a lean hook can reach it; the
  COMBOBOX source deliberately does not bail, because its handler is wired by the
  caller onto the menu's OWN input — the same `target === currentTarget` line
  `keyEventFromInteractiveControl` draws.
- **Every other title surface was swept and is safe BY CONSTRUCTION**, recorded
  rather than assumed: the document par-title inputs are appended to
  `document.body` (outside the PM DOM) or covered by NodeView `stopEvent`; the
  Outline's rename input has no row-level delete key to reach; `ExampleCard`
  attaches no `onKeyDown` at all; `FloatingPanel` / `FloatHost` / `LiftHost`
  register no keydown listener, so a popped-out card repro'd purely through
  EditableCard; and the margin marker's handler sits on a leaf `<button>` that can
  contain no field.

CI: [card-title-delete-guard.test.tsx](../../../src/components/__tests__/card-title-delete-guard.test.tsx)
drives the REAL components (EditableCard → PanelCard → CardBodyTitle →
ConfirmDialog) per titled kind, because the parts that misbehaved were a call site
that never asked a shared guard and a focus decision made in JSX — neither visible
to any test of the guard or the dialog alone. The leg with teeth is the CENSUS
([card-delete-key-door.test.ts](../../../src/components/__tests__/card-delete-key-door.test.ts)):
no card surface may spell its own Delete/Backspace card-delete handler, with ONE
exemption scoped to the shape that justifies it (the margin marker's leaf
`<button>`) and its own PROOF leg — the handler must still sit on a `<button>`,
and the exemption must still be excusing something. Measured by neutering each
half in turn: the bespoke handler takes 10 legs, the danger cue 2, the live-title
read 2, the strict-descendant scoping 2, and the menu guard 2 (one census, one
behavioural, in the REAL `DragHandleMenu`).

**Owed, not claimed:** the preview eyeball. This class is NOT FSA-masked, so the
check is cheap and real — archive text, `+T`, type, Backspace repeatedly (the
title edits, the card stays), then trash-click the same card and see the confirm
open with Cancel focused.

#### The cue half: a VISIBLE default is a promise the key must keep

Same dialog, one key over (task 389) — and the case where the affordance was
correct, the chrome painted it, and the KEY that presses it was gated on an
implementation accident. Gabriel: in the "Re-anchor this snippet?" dialog,
`Return` does nothing. `Escape` felt fine, which is the whole tell — Escape
closed unconditionally, while Enter ran only while
`document.activeElement === theCuedButton`, and the cue was claimed by a
deferred one-shot `requestAnimationFrame` at open. The button renders as the
accented default whether or not that frame landed, so the VISUAL promise and
the KEYBOARD behaviour diverged with nothing on screen to say so.

> **The cue is what the chrome OFFERS, so it is what the key must ACCEPT.**
> `Enter` in a dialog activates a BUTTON — the focused in-frame button if there
> is one, otherwise the REGISTERED cued default — never gated on where DOM focus
> happens to sit. The exceptions are asked of the TARGET, not of focus.

Six rules it earned:

- **There was no THIEF, which is why the fix could not be "re-assert focus".**
  The filed diagnosis blamed the drag-end teardown for stealing focus, and a
  read-only sweep of every `.focus()` site reachable from the drop-mode commit
  found ZERO: the card producers `preventDefault()` their own mousedown
  specifically to suppress native focus, so focus never left `.ProseMirror` in
  the first place, and the dialog's only claim on it was that one frame. **The
  claim MISSED; nothing took it.** Verify a phenomenon before generalizing its
  cause — the surgical fix aimed at the wrong mechanism entirely.
- **…and the claim missed because it was scheduled from a commit that renders
  NOTHING.** `mounted` starts false (SSR cannot touch `document.body`), so a
  dialog's first commit returns `null` — no portal, no button, every ref null —
  and the focus effect's deps omitted `mounted`, so that was the only commit it
  ever ran in. React schedules the `setMounted(true)` re-render as a Scheduler
  task while the rAF is tied to the FRAME, so on a busy main thread — the end of
  a drag: gesture-end edge, mint transaction, RO settle — the frame arrives first
  and the callback focuses nothing at all. A click-opened dialog wins the same
  race on a quiet thread, which is exactly why this read as "only the drag one is
  broken".
- **The exceptions are a question about the TARGET.** Inside the frame a control
  that owns `Enter` keeps it (textarea, contenteditable, `select`, link,
  `<summary>`, a self-activating input) and so does anything that consumed the
  key by calling `preventDefault()` — the platform's own way of saying "mine",
  and an in-dialog control that consumes Enter must say so (one site,
  `ManageStylesModal`'s rename field, did not, and would have closed the whole
  modal on a rename). A plain single-line `<input>` SUBMITS to the cued default.
  Outside the frame, a MODAL owns the keyboard and answers at window CAPTURE, so
  ProseMirror's own `Enter` — a new paragraph in the user's document, behind an
  open modal — never sees it; a SCRIMLESS window (Preferences, the bug reporter)
  is deliberately not modal and answers nothing from outside itself.
- **Activating a focused in-frame BUTTON ourselves is what makes it ONE rule.**
  `preventDefault()` suppresses the native synthesized click, so the activation
  is exactly-once in every environment, and the pre-389 special case ("the cued
  button is focused, so preventDefault + click") folds INTO the general statement
  instead of sitting beside it.
- **Unconditional Enter needed a STACK, and the stack retired a live Escape bug
  with it.** Dialogs genuinely stack — `ManageStylesModal` stays mounted under
  `StyleEditorModal` / `StyleApplyDialog` / `DocTypeChangeDialog` — and each open
  dialog installs its own window listener, so pre-389 a single `Escape` closed
  BOTH. Making Enter unconditional without an owner would have added the worse
  twin: two cued defaults firing from one press.
  [dialog-stack.ts](../../../src/components/dialog-stack.ts) is a LIFO in mount order and
  only the TOP entry answers a key — the same shape `useMenuKeyboard`'s `isTop`
  already had one subsystem over.
- **`autoFocus` is the CUE first and the initial-focus target second.** The shell
  stands DOWN when the dialog's own body has already claimed focus, so a dialog
  can finally name its Enter default without stealing the caret from its own
  field — which is what let `NewDocumentModal` cue "Create" at all.
- **…and the body's claim is the SHELL's job, because a caller structurally
  cannot make it.** The adversarial pass on this fix found the stand-down branch
  DEAD in all three dialogs it was written for. The shell renders `null` until
  `mounted`, so a caller's `useEffect(…, [])` fires in the commit where the body
  is not in the DOM: React flushes a commit's whole passive-effect list — the
  child's `setMounted(true)` included — before processing the re-render that
  update schedules, so the ref is `null` and the effect (deps `[]`) never runs
  again. `TexFilePickerModal`, `NewDocumentModal` and `StyleEditorModal` all had
  it; measured, focus fell through to the FRAME in every one. Worst of them was
  the picker: no focused row AND (deliberately) no cued default, i.e. **a Return
  that did nothing** — this task's own symptom, which the first cut then PINNED
  as intended by declaring `noCuedDefault` on the strength of a claim about
  focus that was false. `initialFocus` is the door: the shell calls it once the
  portal exists, and falls through to the cue if the claim leaves focus outside
  the frame. *A stand-down rule is worth nothing if nothing can stand up.*

Three more the same adversarial pass earned, each a live regression in the first
cut. The owner is **not** simply the top of the stack: mount order is the right
rule for modals, and `PreferencesModal` and `BugReportWindow` are both
`variant="draggable"`, both rendered side by side, and both openable at once — so
between non-modals the owner is the window CONTAINING focus, with the topmost
MODAL outranking everything (modality IS the claim) and mount order the last
resort. Otherwise Escape closed the window the user was not typing in. **Shift+Enter
and a held (`repeat`) Enter** are not the cue's key — a cue promises what a plain
Return does, and a held Return must not repeat-fire a confirm. And the capture
listener moved from `window` to `document`: it still beats every in-document
keymap, and it no longer silences two window-capture listeners that must not be
silenced — the open-menu controller, and `input-modality`, whose own contract says
a key trap must not be able to hide that the user is typing.

The **radio/checkbox** exclusion was reversed for the same reason: it was written
so a dialog checkbox would answer Return, and measurement showed it bought nothing
(`PrintDialog`'s "checkboxes" are `<button>`s, already covered) while costing a
real one — the single genuine `<input type="radio">` in a dialog is
`ManageStylesModal`'s default-style picker, whose cue is "Done", so Enter on it
would have closed the entire modal from a key that previously did nothing.

Escape is deliberately left UNCONDITIONAL within the owning dialog rather than
gated on `defaultPrevented` like Enter: CodeMirror binds `Escape`
(`simplifySelection`) and `StyleEditorModal` hosts one, so a "the target consumed
it" rule would make Escape stop closing that dialog whenever its preamble editor
has focus. A modal always has a way out.

CI: [dialog-enter-contract.test.tsx](../../../src/components/__tests__/dialog-enter-contract.test.tsx)
drives the REAL components and dispatches a REAL keydown at a REAL target;
[reanchor-confirm-enter.test.tsx](../../../src/components/drop-mode/__tests__/reanchor-confirm-enter.test.tsx)
drives Gabriel's own gesture end to end through the REAL controller, the REAL
`confirm` door and the REAL dialog, and presses exactly one key. The leg with
teeth is the CENSUS
([dialog-cued-default-census.test.ts](../../../src/components/__tests__/dialog-cued-default-census.test.ts))
— the shell was never the part that could misbehave, a dialog that ships a footer
and cues nothing is, and that type-checks perfectly; membership is DISCOVERED
from the tree, and the two deliberate no-cue shapes carry a `noCuedDefault`
DECLARATION so "no cue" can never be read as "someone forgot one". The focus half
is pinned STRUCTURALLY (the frame is scheduled from a commit where the dialog
EXISTS), because the failure it closes is a real-browser timing race a hand-pumped
jsdom rAF queue cannot reproduce — a leg that flushed frames after React settled
passed under its own neuter. Measured by neutering each half in turn: the pre-389
focus-gated Enter takes 10 legs plus the drop-mode leg, the stack 2, the
`mounted` gate 1, the body-claimed-focus stand-down 2, and the two census
declarations 2; of the follow-up, the `initialFocus` door takes 3, the
focus-aware owner 1, the Shift/repeat filter 1, and the radio/checkbox reversal 1.
The census is per ELEMENT rather than per FILE — `ManageStylesModal` renders one
dialog and hosts three, so a file-scoped question lets a sibling's declaration
excuse a drifting dialog — and it reads `commentsStripped`, NOT `codeOnly`,
because its variant needle must match inside a quoted attribute and `codeOnly`
blanks string literals: the exact trap `_source-scan`'s own header documents,
which the first cut walked straight into.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked — drag an archive card
onto a different paragraph's side, and press only Return.

##### The second-door half: a census that asks DECLARED cannot see UNSAFE

Same cue, the OTHER confirm door (task 528) — and the case where the SSOT was
alive, correct, read, and read by ONE of the two implementations that needed it,
while the census that walks the offender's own file passed it every night.

Virgil has TWO imperative confirms. `useConfirmDialog()` derives its cue through
`confirmDialogCuedDefault()`; `useSystemDialog()`
([system-dialog-host.tsx](../../../src/components/system-dialog-host.tsx)) is a separate
implementation and hardcoded `autoFocus` on the confirm button whatever the
tone. So everywhere else in Virgil a red dialog answers `Enter` with **Cancel**,
and here it answered with the destruction — the key the user has been TRAINED is
safe being the one that destroys. Live in one gesture: Tab-strip **+** →
*Reset example document* → a `tone: "danger"` confirm reading *"This discards
your edits and AI annotations…"* with **Reset** already focused, one `Enter`
from a drain + `removeOpfsDocDir` + re-seed with no undo and no
`virgil/.history/` slot — task 386's "armed under an already-moving hand" in its
purest form, since a menu row is what the user has just pressed.

> **`tone` describes the MESSAGE; a button's paint describes what pressing it
> DOES; and WHICH button is cued is a data-safety question.** All three answers
> come from one import-free leaf
> ([confirm-cue-policy.ts](../../../src/components/confirm-cue-policy.ts)) that BOTH
> doors read — the placement rule `latex-markers.ts` earned, arriving in the
> component tree: *a facet the layer that needs it cannot import will be
> re-copied.*

Five rules it earned:

- **The fork was TWO attributes wide, not one.** Both doors also hand-spelled
  `variant={tone === "danger" ? "danger" : "primary"}`, four lines from the cue
  they hand-spelled. Unifying only the cue would have left the same disease live
  one prop over, so `confirmActionVariant(tone)` ships beside
  `confirmDialogCuedDefault` and the census forbids the ternary outright.
- **A button that COMMITS NOTHING is never painted destructive** — the second
  member, and the one the tone→variant map gets wrong on its own. A `danger`
  ALERT's sole button dismisses; painting it red says *pressing this destroys
  content without a net*, which is untrue (STYLE_GUIDE, "the destructive / alarm
  family": the rule is a claim about the AFFORDANCE rather than about severity).
  Live at every compile-failure notice. The tone goes to the MESSAGE ink, which
  is what it describes.
- **…and that button's variant is a LITERAL, not a call.** `confirmActionVariant`
  takes no `commits` parameter: the question is not *should this red button be
  red*, it is *is this the committing button at all*, and a parameter would let a
  caller ask the destructive question about a button with no destructive answer.
  The literal is also what keeps its (safe, correct) bare `autoFocus` out of the
  census's scope — see the fail-closed rule below.
- **The census's danger predicate fails CLOSED.** Post-fix no tag spells
  `"danger"` inside a derived variant, so "can this render destructive?" cannot
  be a `danger` grep: a literal `variant="danger"` counts, and **any EXPRESSION
  counts**, because a source census cannot evaluate `confirmActionVariant(tone)`.
  Only a non-danger LITERAL (or no variant at all) proves a button safe. A new
  derived variant is therefore in scope by existing.
- **A guard that says what it CANNOT see is not thereby excused from it.**
  `dialog-cued-default-census` walks this file, passes it, and its own header
  said out loud that it asks whether a cue is DECLARED and never whether the
  declared cue is SAFE. That sentence was accurate and the conclusion drawn from
  it was that the gap could stand. It is renegotiated in place with the reason at
  the site, and the two questions now ship together — a cue that is declared and
  destructive is worse than none.

CI: the host-door legs in
[dialog-enter-contract.test.tsx](../../../src/components/__tests__/dialog-enter-contract.test.tsx)
drive the REAL `SystemDialogProvider` end to end (the imperative API, the queue,
the rendered frame, one real `keydown`) and assert the **promise** resolves
`false`, because what the user gets is a promise. **No pre-528 leg could see
this**: the 386 leg five hundred lines above drives `<ConfirmDialog>`, so the law
was pinned for the door that derives it and unpinned for the door that did not.
Its three CONTROLS are half the contract — a default-tone confirm still cues its
action (without which the danger leg passes on a door that cues NOTHING and
breaks every ordinary confirm), the destructive answer is still Tab-reachable,
and the danger confirm still PAINTS its committing button red. The leg with
teeth is the CENSUS, over a SECOND shared population
(`dialogButtonElements()` — a second walk rather than a filter over the dialog
subtrees, because nesting would double-count `ManageStylesModal`'s four frames
and a subtree scan would miss a danger button composed outside any frame).
Allowlists EMPTY: there is no true statement of the form "this button destroys
and must nonetheless be cued unconditionally". Measured by neutering each half in
turn: the pre-528 host confirm takes 4 legs (2 behavioural + 2 census) and the
alert's destructive paint 4 (1 behavioural + 3 census, one of them a source
assertion over the alert branch).

**Two premises the filing got wrong, corrected here rather than left standing.**
The danger-capable population is SIX buttons, not three: the filing counted the
two derived sites and missed the three LITERAL `variant="danger"` buttons
(`StyleApplyDialog`, `DocTypeChangeDialog`, `ManageStylesModal`), which are the
census's strongest members and all pass today. And the live loss really is
confined to the example/sandbox document — what earns the severity is that this
is an app-wide door on which the next `tone: "danger"` confirm anybody writes,
against any paper, inherits the armed default.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live dialog, no
disk), so the check is cheap and real — open the example document, Tab **+** →
*Reset example document*, and confirm the focused button is **Cancel** and that
`Enter` cancels. Do not press Reset.


#### The field half: an edit session ends exactly ONCE

Same cluster, the INPUT rather than the dialog (task 529) — and the case where
the mechanism was so ordinary that four fields wrote it, the two correct sites
sat beside them, and every one of the four still looked right on screen.

`element.blur()` dispatches `focusout` SYNCHRONOUSLY, and React delegates
`onBlur` off `focusout`. So a `.blur()` inside a keydown handler runs that
field's own commit **nested inside the still-executing keydown**, from the
render closure it was created in. Measured through a real React root, the
cancel branch logs exactly:

```
["esc:begin", "commit:80", "esc:end"]        final rendered value: "40"
```

The commit fires between the two halves of the cancel and reads the TYPED `80`,
because `setDraft("40")` is queued for the next render and cannot touch the
binding the handlers captured; the revert then lands and wins the RENDER. **So
the box shows the value you cancelled TO while the commit has already fired
with the value you cancelled FROM** — which is why this survived for as long as
the fields have existed, and why the task's Done-when insists on asserting the
transaction COUNT: a rendered-value assertion passes on the broken code.

The same synchronous blur breaks the OTHER ending, and that half is easy to
miss because its value is right: `commitDraft(); el.blur();` runs the commit,
then the blur runs it AGAIN from the identical stale closure — where the guards
that would have caught a no-op (`clamped !== currentPercent`, `pgDraft ===
row.postnote`) still hold their PRE-commit values and so do not bail.

> **An edit session has two endings — COMMIT and CANCEL — and exactly one of
> them happens. Whichever ends first wins; the other is skipped. The record of
> "this session has ended" lives where the commit READS it and is read
> SYNCHRONOUSLY.** React state is not such a place.
> [`useFieldEditSession`](../../../src/lib/field-edit-session.ts) is that record.

Four members, and the cluster was wider than reported — the two most expensive
are the ones that write:

- **`FigureBlockNodeView`** (the width box): Escape resized the figure to the
  typed value and dispatched a real `setNodeMarkup`; Enter dispatched it TWICE
  (two undo steps and two autosave arms for one resize).
- **`CitationCard`**'s `+range` postnote — **not named in the report**: Escape
  wrote the cancelled range into the `\cite` command AND the citations sidecar,
  and Enter wrote it twice. Two durable stores, so the most expensive of the
  four.
- **`PagePicker`** (the reader's page box): Escape scrolled to the page it
  promised to abandon, losing the reader's position — the cancel affordance did
  not exist.
- **`SourcePodNodeView`**'s `+T` title — the LIVENESS half, below.

Seven rules it earned:

- **Exactly two things can hold the record, and only one holds BOTH endings.**
  The **value source itself**, when synchronously writable — an UNCONTROLLED
  input whose commit reads `el.value`, which is what `panel-primitives`'
  `CardBodyTitle` has always done and is why it was already correct. It cannot
  express the *Enter* half, though: there is no value to restore that makes a
  duplicate commit safe. A **ref** answers both with one flag, so that is the
  door, and `CardBodyTitle` takes it too — two spellings of one rule is one too
  many (the rule task 486 earned for the refocus door). It still restores its
  DOM value; what the door adds is that the commit is skipped BY CONSTRUCTION
  rather than by the restored value happening to equal the stored one.
- **The window is bounded by the blur, not by hope.** The flag is cleared in a
  `finally` around the blur, so it is live for exactly the synchronous
  `focusout` dispatch — precisely where the duplicate can fire — and no longer.
  An ending whose blur never lands (a null element, an unfocused one) therefore
  cannot swallow some LATER, unrelated commit, and the field is immediately
  editable again. A flag cleared by the duplicate would depend on the duplicate
  running, which is the one thing an ending cannot assume.
- **`commitAndBlur` still commits EXPLICITLY.** Letting the blur do it (which is
  what the two correct sites do) is tempting and wrong in one case: `blur()` is
  a no-op on an element that never had focus, and a field whose Enter silently
  committed nothing there would be a worse bug than the duplicate.
- **The liveness half: a commit that cannot read a live value REFUSES.**
  `SourcePodNodeView` deferred its title commit 100 ms and then read
  `inputRef.current?.value ?? ""` after the input had unmounted, writing that
  empty string — which for a title means DELETING one the user never touched.
  `commitLiveValue` is the rule (no element, no commit) and it REPORTS, so a
  caller can tell a refusal from a landed write. Its companion: the value is
  read while ALIVE — a deferral may carry a value already read, it may not go
  back for one. `BibEntryCard` already had this shape.
- **That 100 ms guard was the author's own attempt at THIS law.** `if
  (editingTitle) commitTitle()` meant "Escape ended the edit, so don't commit" —
  written against a value a batched `setState` can never change under it, so it
  was permanently `true` and dead, in the timeout AND inside `commitTitle`. The
  fix is not a new idea; it is the intended guard, given a mechanism that works.
- **A preservation guard's own path must not be the discard.** The pod's fold
  chevron `preventDefault`s its mousedown — correctly, to hold the ProseMirror
  selection still — which also means a focused title input never blurs, so
  clicking it unmounted the input and DISCARDED everything typed. It commits at
  mousedown now, while the input is still mounted: clicking away from a field
  commits it everywhere else in this pod, and the chevron was not an exception,
  it was just unreachable.
- **A collapsed pod leaves edit mode by CONSTRUCTION.** `editingTitle` was
  never cleared, so re-expanding dropped straight back into edit mode on a pod
  nobody asked to edit. An effect keyed on `collapsed` answers it whichever
  path did the collapsing — the chevron, an undo, a re-parse.

**Not everything that blurs is a member, and the discriminator is the
interesting part.** A field with no cancel branch (`PreferenceTree.ColorPref` —
Enter blurs, and that is the whole keymap) and a field that commits on every
keystroke (`SizeStepper`, `PanelTextSizeRow`) have no second ending to
suppress. The last two DO name `Escape` and DO blur, so a naive census indicts
them; what separates them is that their Escape shares a statement with Enter
(`if (e.key === "Enter" || e.key === "Escape")`). **A branch that treats the two
keys identically is not promising a revert** — Escape needs a door only where it
means something DIFFERENT from Enter. The census is scoped to that, so all three
stay out of the population by construction and the allowlist is EMPTY.

CI: [field-edit-session.test.tsx](../../../src/lib/__tests__/field-edit-session.test.tsx)
drives the mechanism through a real React root and carries TWO canaries — the
un-doored cancel logging `["esc:begin","commit:80","esc:end"]` at a rendered
value of `40`, and the un-doored Enter logging the commit twice — so if either
ever stops holding, every defect leg in this task becomes unfalsifiable rather
than silently passing. The behavioural legs drive the REAL components and count
WRITES, never rendered values
([figure-scale-escape](../../../src/components/__tests__/figure-scale-escape.test.tsx),
[source-pod-title-edit](../../../src/components/__tests__/source-pod-title-edit.test.tsx),
[citation-range-inline](../../../src/panels/Citations/__tests__/citation-range-inline.test.tsx),
[PagePicker.escape](../../../library/components/__tests__/PagePicker.escape.test.tsx));
no suite anywhere exercised `FigureChrome` or `PagePicker` before this one, and
the pod's deferred-commit leg uses FAKE TIMERS deliberately, because a leg that
never advances the clock gives the pre-529 implementation no chance to do its
damage and passes on it vacuously. The leg with teeth is the CENSUS — the door
was never the part that could misbehave, a field that never asks it is, and such
a field type-checks, renders, and looks correct on screen. Measured by neutering
each site in turn: the figure box takes **4** legs, the pod **6**, the citation
row **3**, and the page box **3**; every remaining leg is an accepting control
and says so.

**The census's own population is keyed on the QUESTION, not the MECHANISM**
(task 404's rule), and getting that wrong was caught by the census itself: keyed
on `.blur()`, every site DROPS OUT of the population the moment it is fixed, so
the guard would go green by emptying itself. It asks instead whether a branch
ENDS the session — a bare blur *or* the door — which keeps all five members
visible and pins that every one of them is doored.

**The same law is already spelled by hand in a medium the hook cannot reach.**
Six vanilla-DOM editors — the par-title and heading-label inputs in
`editor-extensions.ts`, three in `expex.ts` — are CORRECT via a local
`let committed = false` set synchronously in the Escape branch and checked in
the blur listener. They are deliberately NOT converted: they are not React
components, so they cannot call a hook, and giving the factory a non-React twin
to serve them would touch two of the most delicately-tested files in the repo
for no behaviour change. Recorded so the next reader knows the latch is this
rule and not a stray idiom.

**A SHARED SCANNER blindness was the by-catch, and it is fixed at the SSOT.**
`_source-scan.ts`'s `tagAround` walked back to the NEAREST `<` and gave up if it
was not a tag — so `if (n <= MAX)` inside a sibling handler put a `<` between the
real tag and the needle and the whole site was silently DROPPED from the
population rather than examined. That is how `PanelTextSizeRow` stayed invisible
to this census while its identical twin `SizeStepper` was caught: one of them
happens to have a comparison in its `onChange`. It walks over every candidate
now, still requiring the resolved tag to CONTAIN the needle — which is what
preserved the anchoring guarantee its docblock rests on. Measured: the three
other censuses that read it (`status-dot-ssot`, `card-delete-key-door`,
`pane-drag-guardrail`) stay green, so this is a pure strengthening.

**Residual, stated.** A ~10-site family sits one step away: fields whose Escape
UNMOUNTS the input instead of blurring (the Outline's heading rename and
`\label` key, `TabStrip`'s document rename, `LibrariesNavigator`,
`ManageStylesModal`, `FigureAnnotation` — whose `commit` carries this same dead
captured guard without the `?? ""` write). Removing a focused element does not
dispatch `focusout` in current browsers, so none of them is live today; each
becomes a member the day someone adds a `.blur()`. They are NOT converted here:
they are correct, and converting ten correct sites on a premise about browser
behaviour this task did not measure is exactly the "broadest blast radius"
error the central principle's own refinement warns against.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (live editor
gestures, no disk), so the durable proof is the unit contract and the check is
cheap: type into a figure's width box and press Escape.

##### The alias half: a field whose Escape MEANS Enter drops out of the census that would judge it

Same door, the half 529 wrote its own escape hatch for (task 555). That census
asks whether a CANCELLING field takes the door, and `hasDistinctCancel` puts a
handler spelling `e.key === "Enter" || e.key === "Escape"` OUT of the
population — correctly, with the reason stated: for a field whose `onChange`
already committed every keystroke (`SizeStepper`, `PanelTextSizeRow`) the two
keys really do mean the same thing and there is nothing to revert to. The
justification named two members BY HAND, and the third aliasing field was
`CitationCard`'s **Code** box — the raw-LaTeX editor — whose Escape ran
`commitCodeDraft`. It holds a DRAFT and debounces a write behind it, so the
alias was a lie in both directions at once: the key the user presses to abandon
an edit SAVED it, and no leg anywhere could see that, **because aliasing is
exactly what removes a field from the population**.

> **A field may alias Escape to Enter only where nothing can be cancelled, and
> that population is DISCOVERED and pinned as an EXACT SET with each member's
> reason — never a hand list inside the guard that outlaws hand lists.**

Six rules it earned:

- **Cancelling a DEBOUNCED draft is two things, not one**: drop the pending
  write, and — because an earlier one may already have LANDED — put the
  session's opening command BACK. That restore is a real write (the `\cite`
  command and the citations sidecar both hold it), so it stamps
  `lastWrittenRef` and resyncs the local rows exactly as the commit path does;
  without that the body state keeps the cancelled parse and the next control's
  `persist()` re-serializes the abandoned edit.
- **The session's opening command is captured at OPEN, not read at cancel.**
  `cit.command` at cancel time may already be a keystroke the user is
  cancelling, which is precisely the shape a 250 ms debounce produces.
- **The reported population was FIVE sites and the real one is ONE.**
  `TodoRow` (×2) and `BibEntryCard` (×2) have no `Escape` handler at all and
  never did — verified against the memo-era commit, not merely against HEAD.
  The citations were wrong when written and the task inherited them, so the fix
  is sized to a census rather than to the list: *verify a phenomenon is general
  before generalizing the fix.*
- **A guard that is always TRUE is a lie in the source, and this one was
  covering a LIVE defect.** `FigureAnnotation`'s `commit` opened with
  `if (!editing) return;` — the same permanently-true captured read 529 retired
  from `SourcePodNodeView`, since the input renders only while `editing`. Its
  commit is ASYNC (it awaits the host's rename confirm) and a dialog FOCUSES its
  cued default (task 389), so that focus steal blurs a still-mounted input,
  React delegates `onBlur` off the synchronous `focusout`, and the blur's own
  commit runs from the stale closure. **Measured through the real stack: one
  Enter on a rename with `\ref`s to carry produced TWO confirm dialogs and two
  `renameLabelWithRefs` calls.**
- **The conflict REFUSAL is asked before the door, not inside it.**
  `commitAndBlur` always blurs, which would undo the refocus the Enter branch
  exists to perform — so ONE `candidateConflicts()` predicate is hoisted and
  read by the keydown (which keeps the session OPEN so the user can fix it) and
  by the blur (which abandons the draft). Two endings, opposite answers, one
  question; a second copy is how they come to disagree.
- **`FigureAnnotation` joined the door's population through its COMMIT, not its
  cancel.** Its Escape already ran a distinct `cancel()` — which UNMOUNTS the
  input rather than blurring, so it matched neither half of `ENDS_SESSION` and
  was invisible to 529 by construction. The ~8-site unmount family's posture is
  unchanged and now PINNED as its own exact set against the same discovery, so
  a member that grows a `.blur()` leaves one census and joins the other and both
  legs fail — turning a silent hazard into a decision.

CI: [citation-code-escape-cancel.test.tsx](../../../src/panels/Citations/__tests__/citation-code-escape-cancel.test.tsx)
drives the REAL card inside a CONTROLLED parent (the real data flow, and the
only way the restore arm is representable at all — with a frozen prop the
card's `cit.command` never moves, so "an earlier debounced write already
landed" cannot happen), counting WRITES rather than the rendered box.
[figure-label-commit-once.test.tsx](../../../src/components/__tests__/figure-label-commit-once.test.tsx)
drives the REAL lozenge over a REAL editor whose `\ref` names the label — the
ref is what makes the door ASK, and therefore what makes a second attempt
observable — with a confirm that BLURS the input before resolving, which is what
the production dialog does. **No pre-555 suite could see either**: every
figure fixture in the repo renames a label no `\ref` points at, so the confirm
never fires; and `citation-range-inline`'s 529 legs drive the `+range` postnote,
a different field on the same card. Measured by neutering each half in turn: the
pre-555 aliased keydown takes 4 legs (the two Enter/blur legs pass either way —
that field never double-committed, since its Enter did not blur), the true
pre-555 `FigureAnnotation` 1 (its three other legs are non-regression pins and
say so), and the ALIAS census names `CitationCard.tsx` as an undeclared alias.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (live editor
gestures, no disk), so the durable proof is the unit contract and the check is
cheap: open a citation card's Code field, type, press Escape — the old command
is back — then rename a figure's label that something `\ref`s and confirm ONE
dialog.

#### The dismissal half: the shell owns every dismiss TRIGGER, and nobody owned what a dismissal COSTS

Same cluster, one question earlier (task 530) — and the case where the shared
shell was complete about the mechanism it owns and silent about the only thing
that makes a dismissal dangerous.

`SystemDialog` has owned every dismiss TRIGGER since it shipped: Escape (through
the task-389 stack), the modal backdrop click, the scrimless outside-mousedown.
Nothing owned what a dismissal COSTS, so each dialog answered privately, and the
one holding real typed work answered wrongly. `StyleEditorModal` had **no dirty
check anywhere in the file**: one stray click on the backdrop, or one Escape —
which the shell deliberately does not let CodeMirror swallow, and whose comment
names this very editor — discarded a hand-authored LaTeX preamble with no
warning and no way back. It is the one dialog in the app whose draft is the only
copy of real typed work, and `ManageStylesModal` mounts it CONDITIONALLY, so
every close path unmounts it and destroys that draft.

**And the same silence had a second shape one door over, where the dismissal was
not the user's at all.** `NewDocumentModal` hands `onCreate` to
`EditorLayout`, whose handler runs the production FSA folder picker; a user who
cancels that picker reaches `createFileInPendingFolder` → `null`, and the
handler then called `setNewDocModal(null)` unconditionally. So **cancelling an
inner step closed the outer dialog and threw away the typed name and the chosen
doc type**, for an act that created nothing. The caller decides that, and the
shell can never see it.

> **A dialog that can hold a DRAFT declares what a dismissal costs — a
> `dismissGuard` the shell ASKS before it closes, or `dismissIsFree` — and the
> two halves are two different owners.** The shell owns every trigger it already
> owned, so ONE door (`requestDismiss`) sits in front of all three and a guard
> cannot be wired to Escape and forgotten on the backdrop. What the shell cannot
> see is an inner step aborting, so that half is a REPORT the caller returns and
> the dialog reads — never a close the caller performs.

Seven rules it earned:

- **A CALLER-ONLY gate for M2 would have WEDGED the dialog permanently**, which
  is why the fix is a report rather than a `if (!meta) return;` in
  `EditorLayout`. `submit` sets `busy` before awaiting, and `busy` disables
  Create, Cancel, the name field and every doc-type button AND kills the
  dismissal outright (`onClose={busy ? undefined : onCancel}` — no Escape, no
  scrim). A caller that simply declined to close leaves a modal reading
  "Creating…" with no control that answers and no way out but a reload. The
  dialog has to LEARN that nothing was created, so `NewDocumentOutcome`
  (`"created" | "cancelled"`) crosses the boundary and `submit` clears `busy` on
  the cancelled arm. **A successful create deliberately leaves `busy` SET** — the
  caller unmounts us, and clearing it would re-enable Create for the frame before
  that lands.
- **`dismissIsFree` is a DECLARATION, not a default**, and the census reads it as
  one: `dismissIsFree={false}` is the default spelled out and does NOT satisfy
  the rule, exactly as `noCuedDefault` is read one census over. There are three
  legitimate free shapes and each states which it is at the site: a draft that
  OUTLIVES the close (`BugReportWindow`, `AIWindow` — always-mounted with an
  `open` prop, so a dismissal hides rather than destroys), a dismissal that IS
  the abandonment (`system-dialog-host`'s `prompt` arm, where closing answers
  `null` and every caller reads that as cancelled), and fields that commit
  UPSTREAM (`PreferencesModal`, `ManageStylesModal`'s rename, which commits on
  Enter/blur).
- **A guard may ASK, so it returns a promise — and the shell owns no confirm
  renderer.** `DismissGuard` is `() => boolean | Promise<boolean>`; `true`
  closes, `false` declines SILENTLY (the footer button still exists, so a refusal
  is never a wedge), and the promise arm is what lets `StyleEditorModal` raise a
  real `useSystemDialog().confirm` without the shell importing the host. A guard
  that THROWS declines and logs in dev — the same fail-closed direction every
  destructive door in this file takes.
- **The FOOTER Cancel asks too, and that is the half a shell-only fix misses.** A
  footer button calls its own handler and never enters the shell's door, so
  without it the ONE dismissal the user performs DELIBERATELY would be the one
  that discards silently — which inverts the whole point.
- **The prompt is `tone: "danger"`, which decides the KEYBOARD as well as the
  paint.** `confirm-cue-policy` cues CANCEL for a danger confirm (tasks 386/528),
  so the Enter of someone who is already typing keeps their preamble rather than
  throwing it away.
- **DIRTY is measured against what the editor OPENED with**, so re-opening a
  style and closing it untouched still costs nothing. A prompt on a pristine
  close becomes furniture, and people click through furniture.
- **The wording stays LOCAL, deliberately.** A shared `discardDraftConfirm`
  policy leaf would have exactly one caller — every other draft-holding dialog in
  the census is legitimately `dismissIsFree` — and an SSOT ahead of its first
  caller is the dead-SSOT shape task 515 retired. The census is what makes a
  second one impossible to ship silently, and the second one is when to lift it.
- **…and `StyleEditorModal` is deliberately NOT made always-mounted** the way its
  two `dismissIsFree` cousins are, recorded at the site so it is not re-proposed:
  those hold ONE draft, this is keyed per style and mounted three ways, so an
  always-mounted instance needs a reset rule and gains a stale-preamble bug in
  its place.

**The population is DISCOVERED, and by the QUESTION rather than by a mechanism**
(task 404's rule). A subtree-only needle is blind to `PreferencesModal`, whose
every field is composed by `PresetBar` / `PreferenceTree` / `SmartPreferences` —
so `draftHoldingDialogs()` resolves ONE level down, skipping any file that
DECLARES a needle primitive (or every consumer of `<Select>` resolves through
`field-primitives.tsx` and the needle answers "yes" for the whole app). It
over-collects a component that merely lives beside a field, and that direction is
the safe one: an extra member costs one `dismissIsFree` line, a missed one costs
a silent draft loss. It shares the ONE `<SystemDialog>` element walk
([_dialog-sites.ts](../../../src/components/__tests__/_dialog-sites.ts)) the cued-default
(389) and variant (515) censuses already read — two enumerations of "who the
dialog sites are" is how one guard comes to be scanning a set the other no longer
is.

CI: [dialog-dismiss-guard.test.tsx](../../../src/components/__tests__/dialog-dismiss-guard.test.tsx)
drives the REAL `StyleEditorModal` inside a REAL `SystemDialogProvider` — with
only the CodeMirror COMPONENT stubbed to a live `<textarea>`, so `EditorView` /
`EditorState` stay real for the module-scope theme — and makes the preamble dirty
through the component's own `onChange`. **No pre-530 suite could see either
half**: `StyleEditorModal` is rendered by nothing anywhere in the repo, and
`NewDocumentModal`'s two appearances drive its Enter key with an `onCreate` that
resolves `void`, so "the caller closed me for an act that created nothing" is
unrepresentable in both of them. The leg with teeth is the CENSUS
([dialog-dismiss-census.test.ts](../../../src/components/__tests__/dialog-dismiss-census.test.ts)):
the door was never the part that could misbehave, a dialog that hosts a field and
declares nothing is, and it type-checks and renders perfectly. Both allowlists
EMPTY — a hit is DECLARE-it, and there is no third answer a dialog holding a text
field is entitled to give. Measured by neutering each half in turn: the pre-530
`StyleEditorModal` takes **7 behavioural legs plus 2 census legs**, and the
pre-530 `submit` takes **2** — with both M2 controls (a successful create leaves
`busy` set; a thrown failure renders inline with the name intact) passing either
way, which is the point.

**Residual, stated.** `askingRef` in the shell — the latch that stops a second
trigger stacking a second question — is UNREACHABLE from a modal today: while the
confirm is open it owns the top of the dialog stack, and its own scrim covers
every dismiss trigger of the dialog underneath. Its leg says so rather than
pretending to be a defect leg, and what that leg does pin is the honest
behaviour: the second Escape is answered BY the question (one question, never a
queue), the draft survives, and the next Escape asks again.

**Owed, not claimed:** the preview eyeball for M1, which is cheap and real (NOT
FSA-masked — a live dialog, no disk): edit a style's preamble, click the
backdrop, and confirm the prompt appears with **Keep editing** focused. M2's
real repro needs the production FSA folder picker, so the durable proof there is
the unit contract.

#### The role half: a control that ANNOUNCES itself operable is a `<button>`

Same cluster, the AFFORDANCE rather than the dialog (task 536) — and the case
where a `role` attribute made a promise the element could not keep, in two
media at once.

`FigureAnnotation` rendered four affordances as `<span onClick>`s. Two wore
`role="button"` — the `#` numbered toggle with an `aria-pressed` state, the
`×` delete — and neither was focusable or key-bound; the label text and
`Label +` were bare spans. So a screen reader announced "button, pressed" for
a control that refused every key, and a keyboard user could number, rename or
delete a figure from every surface EXCEPT the figure's own chrome (`#` and
`Label +` have no other home at all). The heading strip — the lozenge's own
stated twin — carried the identical shape through
`setAttribute("role", "button")`, which no JSX grep can see; that is how the
audit's "5 sites tree-wide" under-counted by three.

> **A control is a `<button type="button">`.** The role's three-part promise
> (announced operable ⇒ focusable ⇒ activates on Enter AND Space) is the
> platform's to keep, not a hand-rolled key handler's. `role="button"` is
> spelled ONCE — [`activatableProps`](../../../src/lib/activatable-props.ts) — and only
> on a CONTAINER that must hold other interactive content, which HTML forbids
> inside a `<button>`.

Six rules it earned:

- **Inside a NodeView the native button is SAFER than the surgical fix, not
  merely tidier.** TipTap's default `stopEvent` answers true for a `BUTTON`
  target, so ProseMirror's `eventBelongsToView` declines the keydown and the
  browser's activation is the only thing that runs. A `tabIndex`ed span with
  an `onKeyDown` — the task's own surgical contrast — would have handed Enter
  to PM's keymap as well: a paragraph split at the caret, from a press on the
  chrome. Pinned on the heading twin, whose vanilla NodeView mounts headlessly,
  with a CANARY that dispatches the same key at the heading's TEXT and
  requires PM to split it.
- **The target guard is the fourth part, and every hand-rolled copy lacked
  it.** The three containers that genuinely cannot be buttons (a tab holding
  its close button, a library row holding its actions, a title strip holding
  its `×`) each re-derived role + tabIndex + Enter/Space by hand, and each let a
  key on the NESTED control bubble to the container's handler — so Enter on a
  tab's close button both closed the tab (native) and activated it (bubbled).
  `activatableProps` answers only for `e.target === e.currentTarget`.
- **`disabled` is the native truth for "nothing to toggle"** — a `#` on a
  caption-less figure announces itself disabled and takes NO focus (a control
  that says it is disabled must not be a tab stop). `readOnly` renders no
  button at all: the float's chip stays static markup (Issue-10).
- **The NAME is stable across a toggle; `aria-pressed` is the state channel and
  the tooltip is what flips** — the `OmniBlankToggle` contract, taken by both
  `#`s (`iconHint({ label: "Figure number", hint })`), so the two channels
  cannot double-announce.
- **Hover-revealed chrome is `:focus-within`-revealed too, or it is not a tab
  stop.** `display: none` removes an element from the sequence, so the `×` on
  both strips and the heading's `Label +` were unreachable by Tab however
  focusable they became. Stated limit at the rule: Shift-Tab INTO a strip
  lands on its last VISIBLE member first.
- **A rebuild that destroys the focused control hands focus to its successor.**
  The heading strip re-renders on a toggle (`annot.innerHTML = ""`), which
  dropped a keyboard user to `<body>` on every press; `renderAnnot` records
  the focused `data-action` and re-focuses it after the rebuild.

CI: [role-button-census.test.ts](../../../src/components/__tests__/role-button-census.test.ts)
reads BOTH media (`role="button"` / `role={…"button"…}` in JSX, `setAttribute`
/ `.role =` in DOM code) over both silos, allowlist EMPTY, with a synthetic
canary per needle; its consumer legs pin that the helper has real callers,
that none sits on a `<button>`, and that none carries a second `onKeyDown`.
The icon-button census's header — which said a `role="button"` div "is not
censused" — now points here: a control is a real button (and lands THERE) or
a container spelling the one helper (and lands HERE), which is what closes
the class. Behavioural:
[figure-lozenge-keyboard.test.tsx](../../../src/components/__tests__/figure-lozenge-keyboard.test.tsx)
drives the REAL lozenge against a REAL editor per affordance and per state,
[heading-strip-keyboard.test.ts](../../../src/lib/__tests__/heading-strip-keyboard.test.ts)
the REAL NodeView (routing canary, focus restore),
[activatable-props.test.tsx](../../../src/lib/__tests__/activatable-props.test.tsx) the
helper and the tab's nested-close leg. **Stated honestly:** jsdom implements
no activation behaviour for native buttons, so no leg here "presses Enter" on
one and reads the click's effect — that would test a shim of the platform.
The figure legs assert the CONTRACT the browser activates against (a
`<button type="button">`, a tab stop, enabled, ringed, click reaches the
document) and the heading legs pin the one keystroke fact this environment can
see. Measured by neutering each half in turn: restoring the pre-536 figure
spans fails 7 lozenge legs plus the role census; restoring the pre-536 heading
spans 4 strip legs plus the census; dropping the target guard 2; dropping the
focus restore 1; dropping the vanilla `aria-label`s 1. (The icon-button census
is NOT among them, and that is the point of the pairing: a span is invisible
to a census over `<button>`, which is exactly why this one had to exist.)

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live editor
gesture, no disk), so the check is cheap and real: Tab into a figure's
lozenge and operate all four, then a heading's strip.

**Residual, stated.** The par-title strips (`+T`, the title text) on
paragraphs and lists are click-only spans with NO role — keyboard-dead but
making no false promise, and so outside this census's question. Same family,
its own pass.

### The transport half: content that references PER-DOC state carries it, whatever payload it rides

Same law across DOCUMENTS (task 235). The Stack is deliberately cross-document scope, so a pull into a different doc is a first-class flow — and a `\cite{smith2020}` means nothing there on its own: `references.bib` is per-doc and bib-review annotations live in a per-doc `annotations.json` sidecar, so no global resolver rescues an unknown citekey. Whatever a payload references has to travel with it.

The CARD family did (task 069): `snapshotCard`'s citation/bibliography arms resolved bib sidecars through a `CardSnapshotCtx`, and `applyCardDrop`'s citation branch upserted them. The three CONTENT families — a text slice, a paragraph, a heading section — did not, although the remint code's own comment (task 138) names them as *the headline case for atoms riding a slice*. Same gesture, same atoms, one family bib-complete and three silently not: the pulled `\cite` landed with no entry in doc B's `.bib` (a LaTeX undefined reference) and the source's note gone. Nothing failed; every id was correctly reminted on the way.

> **A payload that can carry a reference carries what the reference needs — resolved ONCE at the single ADD door and discharged ONCE at the single PULL door, both blind to which payload family they are looking at.**

[src/lib/stack/bib-carry.ts](../../../src/lib/stack/bib-carry.ts) is that seam (`collectCiteKeys` → `buildBibCarry`/`withBibCarry` → `applyBibCarry`), and `StackItem.bib` is the ONE carrier — the per-card `bibEntries`/`bibAnnotations`/`annotation` fields are DELETED from `StackCardSnapshot`, not left beside it, because a field the type still has is a field a future writer can populate, re-forking the carrier (the "delete the stored copy" rule, one medium over). `normalizeStackItemBib` lifts them off a persisted blob at `readEnvelope` — the ONE read door the hook, its cross-window re-read and `readStackItem` all share — so no consumer downstream ever sees the old shape and the pull side needs no legacy branch. Four rules it earned:

- **The keys are DERIVED from the content, not enumerated per payload kind.** The collector walks the payload as plain JSON and reads every `citation` node's `command` at any depth in any field — so a cite inside a footnote body (`attrs.content`, the one place a schema walk would not enter), inside an example, or inside a note card's body is reached by the same pass, with nothing to add when a new payload shape ships. The per-kind switch that remains covers only what a card *declares* rather than *contains* (a `CitationRef`'s `keys`, a `BibEntry`'s own `key`) and is exhaustive, so a new stackable kind must state its answer. And the key is read off the atom's `command` — the same derivation the DESTINATION uses (`useCitations.syncFromEditor` rebuilds every `CitationRef` with `parseCiteCommand`), rather than through the source's citations sidecar, which could carry a set the destination never asks about.
- **The obligation sits on the DOOR, not in the helpers.** `addStackItem(item, bib)`'s second argument is REQUIRED, and the hook's unused `add` was deleted rather than given the same signature — a second add door is a door someone reaches for without the obligation. This is the half a per-helper `CardSnapshotCtx` structurally misses: `StackIcon`'s HTML5 `MIME_TEXT_INSERT` drop hand-builds its payload and never touches `lib/stack/snapshot.ts` at all. **The original defect was not a wrong snapshot helper; it was a producer that never asked.** A doc with no bibliography answers with resolvers that resolve nothing — an answer; there is no default to omit, because "this doc has no bib" and "someone forgot to wire it" must not look the same.
- **Discharge by WRAPPING the resolved plan, so no branch can be forgotten** — `withBibUpsert` wraps whatever `planDrop` resolved, inside `commit` (a plan is pure and runs twice per gesture, so an upsert in the plan would fire on the classify pass too) and BEFORE the payload lands, so a pulled cite is never momentarily dangling. **A carry that cannot be discharged REFUSES**: with no `ctx.stack` the pull is a `no-op` decision rather than a landing that reinstates the dangling `\cite` — decline-don't-fall-back, and a pull is a copy, so refusing costs nothing.
- **ONE conflict rule for both halves: what the destination already has, it KEEPS** — and the adversarial pass on this fix is what earned it, because the first cut had the two halves resolving a conflict in opposite directions. `upsertBibEntry` is insert-if-absent by its own contract, so on a known citekey the destination keeps its own `BibEntry`; an annotation written over the destination's would then describe *the entry that was discarded* — on a work that may merely share the key, since author-year citekeys collide across papers routinely — replacing authored prose in a sidecar write with no undo and no warning. So `applyBibCarry` reads before it writes (`BibCarrySink.getAnnotation`, a REQUIRED `StackPullApi` member): a carry exists to make a pulled `\cite` **resolvable**, to fill an empty slot, never to restate doc A's bibliography over doc B's. That also makes a same-doc pull write nothing at all — `usePersistentState.update` bails only on referential equality, so re-writing a byte-identical note would still schedule a persist.
- **A key the SOURCE could not resolve is not invented.** The source was already dangling there; the annotation still travels, because it is the one artifact the destination could still use.

CI: [bib-carry.test.ts](../../../src/lib/stack/__tests__/bib-carry.test.ts) (the seam, including the two task-069 contracts re-expressed at the add door — it replaces `snapshot-bib-annotation.test.ts`, since the helper is a pure serializer again), [stack-content-bib-carry.test.ts](../../../src/components/drop-mode/__tests__/stack-content-bib-carry.test.ts) (**the defect leg**: REAL snapshot → REAL add door → REAL `applyDrop` into a SEPARATE destination editor, for text/paragraph/heading and the nested-footnote-body case, each asserting the cite actually landed so no leg passes on a refusal), [stack-pull-bib-annotation.test.ts](../../../src/components/drop-mode/__tests__/stack-pull-bib-annotation.test.ts) (069's restore half + a pre-235 persisted blob + the destination's own note surviving), and [stack-add-door.test.ts](../../../src/hooks/__tests__/stack-add-door.test.ts), whose **census** is the leg with teeth — the door was never the part that could misbehave, a second write door that bypasses it is, and that is exactly what a required argument cannot see (nothing but `useStack.ts` may write the envelope; `addStackItem`'s signature is pinned by SOURCE as well as arity, since `bib?:` erases at emit and reports the same `Function.length`). One leg's shape is load-bearing and its first draft was wrong: the refusal `withBibUpsert` owns must be pinned against a **content** payload, because for a CARD payload `planCardDrop`'s own pre-321 `if (!stack) return null` refuses first — a card-shaped leg asserts the right verdict for the wrong reason and would stay green with the new refusal deleted, so it carries an accepting control beside it.

**Scope, honestly.** This carries the BIBLIOGRAPHY, which is the reference a `\cite` needs. A pulled footnote/citation ATOM still lands as an atom whose panel-side record the destination re-derives, and other per-doc state a payload might reference (a `\ref` label's target, a figure's raster) is untouched — those are different questions, not a fourth divergence of this one, and each would enter through the same collect→carry→discharge seam rather than beside it.

#### The fidelity half: rebuild FROM the record and SUBTRACT, never copy INTO an empty one

Same gesture, and the case where the payload was complete at every link of the chain and lossy at the last inch (task 330). The transport half above asks whether a pull carries what its content REFERENCES; this one asks whether it carries the content itself. It did not: **every stackable kind lost at least one field the user had typed.** A note's `title` — and, because `useNotes.addNote` hard-sets `titleAuto: true`, the new record also claimed the title had never existed, so "never titled" and "title lost" became the same card. A todo's `notes`, which the seed TYPE (`{ text?: string }`) could not even express, so no host could have delivered it however carefully written. A revision/cutter suggestion's `user_text` (the human's OWN rewrite, and the field the apply path prefers — `replacement = user_text or suggested_text`) plus its `instructions`, with `author` hard-coded `"human"` on a record the AI may have written. Nothing warned, and the Stack thumbnail previewed the very `user_text` the pull then discarded.

`snapshotCard` deep-clones the whole record and `planCardDrop` passed most of it whole, so the loss was not in the capture or the transport. It was in the **direction of the materialization**: the ONE host implementation (`EditorPane`'s `dropStackApi`) started each card from an EMPTY record and hand-copied a few names into it.

> **A per-kind materialization never hand-picks fields out of a full-record snapshot. It rebuilds FROM the snapshot and SUBTRACTS — so a field arrives unless someone stated a reason it must not.**

The direction is the whole fix, and the reason is about what each shape can be REVIEWED for. A copy list omits *silently*: an omitted field looks exactly like a field the record does not have, which is why four separate omissions sat unnoticed from the Stack's landing commit (`c4f95034`) and why the one arm that carried a title (archive's) still got it wrong — it routed through `updateSnippetTitle`, which stamps `titleAuto: false`, so the title arrived claiming a human had typed a machine default. A subtraction list is a finite set of decisions, each written down and readable back.

[src/lib/stack/pull-seed.ts](../../../src/lib/stack/pull-seed.ts) is that list — `NON_TRAVELLING_FIELDS` + `pullSeed(kind, data)`. Five rules it earned:

- **The table is checked against the record TYPE, so its two rot modes are compile errors.** It is `{ [K in StackCardKind]: readonly (keyof SnapshotData<K>)[] }`: a name that is not a field of that kind's record fails to compile, and a new stackable kind with no entry fails too. That closes the dead-facet hazard (202/227) by construction rather than by a census — worth contrasting with `CARD_REGISTRY.footnote.content.textFields = ["title"]`, which names a field `FootnoteRef` does not have and is *honest anyway* (the content model is fed a composed `{ content, title }` built from the atom's node attrs). `CardMeta.content`'s doc claimed that existence was "pinned by `assertContentCoverage`"; it is not and cannot be, and that sentence was retired rather than left standing.
- **Three reasons a field stays behind, and nothing else counts as one:** identity (`id`/`createdAt`/the `kind` discriminant), per-doc bindings (`links`, `selectedText`, `unanchored`), doc-bound lifecycle (`archived`, `aiRequest`, `status`, `appliedChange`, `originalAnchor`). Dropping `status`/`appliedChange` is load-bearing rather than tidy — an applied suggestion's `appliedChange` binds a LIVE range in the *source* paper's `.tex`, so a copy claiming `applied` would offer Keep/Revert over a splice this document has never had ("The lifecycle half"). The one EMPTY entry is `bibliography`, and it is a decision rather than an omission: a bib entry travels whole through `upsertBibEntry`, the same insert-if-absent sink `applyBibCarry` already feeds with source-doc entries, so stripping its `uid` on the card path while the carry path keeps it would be a fork wearing a fix's clothes.
- **Provenance travels WITH the content it describes.** `titleAuto` and `author` are facts about the words that arrive, so a pull that delivered the words and dropped the flags would deliver a record that lies about itself. This is also why the fix is a spread and not a per-field setter: `updateNoteTitle`/`updateSnippetTitle` *re-decide* provenance they have no business re-deciding.
- **A narrowed seed type is a field nobody can deliver.** Every `StackPullApi` factory now takes the whole `PullSeed<K>`, and each hook grows one `…FromSeed` door that spreads it over a fresh record. The doors ask the registry's own content model for their pristine gate (`cardHasContent`) rather than "is the body empty?", because a pulled note whose only content is its TITLE — or a todo whose only content is its `notes` — was real user writing that the body-only gate discarded on the next click-away, losing it a second time one layer down.
- **The strip is a DENYLIST, stated as such.** An unknown key from a blob written by another build spreads through onto the new record. That is deliberate: an allowlist is the per-field hand-enumeration this deletes, and an unknown key is inert where a dropped known one is lost writing.

CI: [pull-seed.test.ts](../../../src/lib/stack/__tests__/pull-seed.test.ts) pins the FLOOR (every field `CARD_REGISTRY[k].content` declares survives the strip — derived, so a new content field is covered by declaration alone) and the CEILING (no identity, binding or lifecycle survives), over fully-populated per-kind fixtures whose completeness is itself asserted, since a fixture that stopped populating `notes` would make the floor pass vacuously. [stack-pull-seed-doors.test.tsx](../../../src/hooks/__tests__/stack-pull-seed-doors.test.tsx) drives the REAL hooks, because three of the four losses were caused by hook behaviour no host could see from outside. And [stack-pull-content-fidelity.test.ts](../../../src/cards/__tests__/stack-pull-content-fidelity.test.ts) is the leg with teeth, aimed at the HOST — the factories were never the part that could misbehave, a call site that picks fields out of the seed instead of forwarding it is, and no type can see that (`notesHook.addNote(paragraphId, seed.content)` type-checks perfectly and IS the defect). Its census allows exactly two exempt lines, marked per LINE with their reason — footnote and citation, whose entire travelling set is one field the hook re-derives the rest from. Measured on the pre-fix shapes, the spec leg and the census each fail.

**Stated limits.** A footnote's `title` cannot be pulled at all: it lives on the atom's node attrs and never reaches `FootnoteRef`, so the loss is at the CAPTURE, one layer before any of this — recorded as the fidelity suites' single `UNCARRIABLE_CONTENT_FIELDS` entry rather than relaxed inside an assertion, and closing it means teaching `snapshotCard` to take the atom's title, at which point the suites demand it back. And the revisions/cutter seed doors are twins, which is the pre-existing fork filed as task 201 — not something to unify inside this one.

#### The ordering half: ask BEFORE the point of no return, not after it

Same law, one clause further back (task 636). Everything above is about what a
destructive action may DESTROY. This is about WHEN it is allowed to ask.

Archive already had the answer written down, two cases up in its own dispatcher:
`prepareCardBodyCapture` runs *before* `cleanupAndComputeDeleteRange` precisely
so "an abort leaves the document and every sidecar completely untouched". What
nobody noticed is that the same gesture asked a SECOND declinable question, and
asked it on the far side of the mutation.

Deleting or archiving a block through the drag handle runs a cleanup walk that
deletes every card anchored inside the range, then deletes the text on the very
next statement. The card delete is **asynchronous and declinable** — every panel
hook's delete is a `makeUnbridgingDelete`, which routes through
`runCardLifecycleEvent`, whose SETTLE obligation raises a three-way
keep / revert / cancel prompt whenever the card owns a live in-document splice
(a `status:"applied"` suggestion's blue `pending-ai-change` range). The text
delete was **synchronous and unconditional**. Nothing awaited in between, so the
two raced, and the document lost the text while the user was still being asked
what to do about it:

| Answer | What the user got |
|---|---|
| **Cancel** | The card survives over a paragraph that has already vanished — and on the archive leg the passage is also already captured into an archive card. |
| **Revert** | `revertPendingChange` cannot resolve the anchor (its range is gone), so the **pre-suggestion original is never restored** — and the delete reports success, so the card goes too. Silent, unrecoverable loss of the user's own writing. |
| **Keep** | The one consistent branch, by accident. |

The type system could not see it and said so out loud: `CardLifecycle.delete` was
declared `void`, `makeUnbridgingDelete` returns `Promise<boolean>`, and a
`Promise<boolean>` is assignable wherever a `void` was — so the registry went on
promising a delete that always happens while wiring five kinds whose delete can
refuse. Its own header carried the warning as prose ("a caller that tears down
something the card owns must await this"), which is exactly the kind of guard
this law exists to replace with a shape.

> **A destructive range gesture asks every declinable question over the passage
> BEFORE it mutates anything, and computes the range it deletes only from what
> those answers left behind.**

[src/text-objects/delete-range.ts](../../../src/text-objects/delete-range.ts) is
now two explicit phases, and the order is the whole content of the fix:

- **ASK** — `settleRangeCardObligations`. Async, declinable, and the ONLY phase
  that can refuse. It settles every applied splice inside the range through
  `settleAppliedSpliceForCard`, the same door the single-card executor knocks on
  — extracted rather than re-spelled, because a second settle implementation is a
  second prompt to drift. A decline returns `null` and the whole gesture aborts
  with the document untouched.
- **DO** — `cleanupAndComputeDeleteRange` → `cleanupLinksInRange` → the caller's
  `tr.delete`. Synchronous and unconditional. Nothing in it can refuse, *because*
  phase one already asked; a delete that refuses anyway is a contract breach and
  says so loudly in dev rather than mutilating a card the user chose to keep.

Four rules it earned:

- **ONE enumeration, two phases.** `collectRangeCardTargets` is the read-only
  half of the walk, and both phases read it. A gesture that asked about one set
  of cards and destroyed another would be the same bug wearing a fix's clothes.
- **ONE correction, both directions.** The F2 range correction ("cleanup shrank
  the block, so `to` is stale") only ever SUBTRACTED, because the only inner
  mutation it knew about was an atom being stripped. A settle's `revert` splices
  the pre-suggestion original back over the applied text and the original may be
  LONGER, so `correctRangeForInnerDelta` is now the shared arithmetic for every
  mutation the gesture performs strictly inside its own range — both signs, both
  callers. The F2 scenario is byte-identical through it.
- **The read-only question goes first, so a refusal still costs nothing.**
  Archive's schema probe is pure, so it runs against the PRE-settle doc for its
  verdict; the payload is re-derived after the settle only when a settlement
  actually moved the document, so the archived copy is the text the user settled
  on rather than the text they reverted. Two reads beat one mutation-then-refuse.
- **The bag is REQUIRED on the dispatcher, like `anchorRetarget`.** A host with
  no pending-change wiring supplies one whose `get` answers null — an ANSWER, not
  an omission. `CardLifecycle.delete` is now `void | Promise<boolean>`, which is
  merely the truth; the actual guarantee is structural, in the phase order.

CI: [range-delete-settle-first.test.tsx](../../../src/components/editor-layout/card-actions/__tests__/range-delete-settle-first.test.tsx)
is the leg with teeth — it drives the REAL dispatcher over the REAL extension
stack with a lifecycle whose delete is FAITHFUL to production (it routes through
`settleAppliedSpliceForCard` and can refuse), which is exactly what no existing
suite had: `applied-splice-wiring-guardrail` greps that call sites *pass* the
ops bag and never asserts a consumer honours the boolean it gets back, and every
archive/delete fixture in the repo stubbed the walker's delete as a synchronous
`push`. Five of its six legs fail with the ask phase neutered.
[range-settlement.test.ts](../../../src/text-objects/__tests__/range-settlement.test.ts)
pins the two pieces that make the ordering safe rather than merely earlier — the
single enumeration and the both-directions correction.

**Stated scope.** The only declining path today is `settleAppliedSplice`, gated
on `ownsAppliedSplice` = `{revision-suggestion, cutter-suggestion}`;
`makeUnbridgingDelete` passes `hasContent:false` and an always-true confirm, so
`note` / `highlight` / the comment kinds are structurally undeclinable, and
`footnote` / `citation` route through doors that skip the executor. That is the
population the ask phase discharges — and because it asks the executor's own
door about every card in the range, a kind that later joins the pending-change
family is covered by declaration alone.

### The range half: the gate must cover everything the mutation TOUCHES

> **A gate that answers about ONE position while its action mutates a RANGE has
> not been asked about the content it destroys.** Both halves of this law — "may
> this act here?" and "can the destination hold what I am about to delete?" —
> are questions about `[from, to]`, and a predicate that reads `from` alone
> answers neither for the part of the range it never reached.

Task 641. Every block-level action in `ACTION_REGISTRY` mutates a range:
`deleteSelection()` then `replaceSelectionWith(...)` on the insert paths,
`setBlockType(from, to, …)` on the heading-CONVERT path. Each decided the
mutation was safe by resolving `state.selection.from` and asking
`posHostsBlockInsert` about that single position — and, on the wrap paths, by
looking only at the TEXT the harvest returned.

Task 428 had already fixed the range half for the INLINE sibling, and its own
header records the hazard verbatim: *select from mid-paragraph INTO a
`codeBlock` … the gate read the paragraph and said "ok", and the replace then
destroyed the code block's text and merged the blocks.* The block twin twenty
lines above was left as a single-position question, with no stated reason
anywhere in the tree. The remedy is the twin: `blockRangeHostsBlockInsert`, with
`posHostsBlockInsert` reduced to its caret form (`from === to`) exactly as
`posHostsInlineAtom` is of `inlineRangeAllowsAtom` and `posBlockAllowsAction` of
`blockRangeAllowsAction`, and all three reading ONE walk
(`rangeTextblockTypes`) so they cannot come to disagree about what "the
textblocks this range reaches" means.

Three things this half turns on, each of which looked like a backstop and is
not:

- **ProseMirror does not refuse the join.** `deleteSelection` →
  `replaceTwoWay`'s `checkJoin` PASSES across a prose→verbatim boundary, because
  `paragraph`'s `inline*` and `codeBlock`/`latexComment`'s `text*` share `text`,
  so `compatibleContent` is true. The verbatim block is merged away and its
  commented-out source is PROMOTED into the typeset document — the corruption
  tasks 146/150/396 exist to prevent, reached through the range instead of the
  caret.
- **Nor on the CONVERT path.** `setBlockType` converts every textblock in the
  range whose parent can host the target. `latexComment` is `content: "text*"`,
  a textblock whose parent is `doc`, and `doc` hosts a heading anywhere — so PM
  greenlights it and Virgil's own predicate is the only protection there is.
- **An EXISTENCE quantifier cannot express a universal one.** `applies()`'s
  walker breaks on the first applicable block and skips a protected one with
  `return undefined`, so `[paragraph … latexComment]` reported applicable. "Some
  block here is convertible" and "nothing here is protected" are different
  sentences; the walker could only ever say the first. The universal half is now
  asked FIRST, by the same range predicate the INSERT gate uses, so the two
  surfaces of one question cannot diverge — and the caret case is the degenerate
  range.

**The representability half in the same sentence.** The three WRAP paths
(`texRun`, `mathRun`, `exampleRun`) harvest the selection into a payload their
new node can hold — plain TEXT for the first two, INLINE leaves for the third —
and then delete the whole range. That is this law's own shape, and the rule was
written TWICE and forgotten ONCE: `texRun` and `mathRun` each carried a
hand-rolled bail, `exampleRun` none, so `\ex` over a selected `displayMath` /
`figureBlock` / `graphicsBlock` replaced it with an empty template and the block
was simply gone. `sliceIsFullyCapturedBy`
([src/lib/tiptap/capture-symmetry.ts](../../../src/lib/tiptap/capture-symmetry.ts))
is the one predicate all three now ask. One predicate is not tidiness: it is
what stops the FOURTH wrap path forgetting it again.

**Ask about the slice, never about the harvest.** Both hand-rolled bails asked
*"did the harvest come back empty?"* — a PROXY that is true only when the
selection holds nothing BUT unrepresentable content. Every MIXED selection
(`foo \cite{bar}`, prose plus a figure) passed it, and the delete destroyed the
atom anyway. The literal question is whether the capture's vocabulary represents
everything the slice HOLDS.

**Read the loss set from the registry, not from the schema `group`.** What a
flattening capture destroys is the set the repo already calls *non-trivial to
lose*: `MEANINGFUL_BLOCK_ATOM_NODE_NAMES`, derived from
`TEXT_OBJECT_REGISTRY.isMeaningfulBlockAtom` plus `figureBlock`. It was
module-private to `drag-handle-actions.ts`; 641 HOISTED it into the registry it
derives from rather than copy it, so the destructive-confirm probe and the wrap
predicate read one list at two severities of the same judgement (confirm vs.
refuse). The near-miss worth recording: `group: "block textObject"` reads like
the distinguisher and is not — `paragraph` carries it too, and a predicate built
on it refuses every ordinary multi-paragraph wrap.

**The vacuity this uncovered.** `block-atom-cells.test.ts`'s atom-only fixture
handed DOC POSITIONS to a helper that takes IN-PARAGRAPH OFFSETS, so it selected
the zero-width tail AFTER the atom. All three legs were green because nothing
was selected — not because the atom was protected — and the old guard's
`slice.content.size > 0` is satisfied by an open slice's own paragraph tokens,
which is what kept the accident invisible. A leg asserting a destructive action
DID NOT HAPPEN must pin that its input is the shape it names; this one now
asserts the selected slice's first child is the atom before running anything.

CI: `block-insert-container-gate.test.ts` (the range + representability legs),
`heading-convert-container-gate.test.ts` (the convert range),
`block-atom-cells.test.ts`. Every leg asserts the DOCUMENT IS UNCHANGED, not
that a command returned false; each half was verified load-bearing by neutering
it and watching them fail.

---

## The commit-seam half (task 648) — measure the EFFECT, not the intent

> **A gesture that dispatches and then performs a SECOND effect on the strength
> of the first has an unchecked two-phase commit, and the second phase can land
> on a first phase that never happened.**

`view.dispatch(tr)` is a REQUEST. Every plugin's `filterTransaction` runs first,
and a veto — `readOnlyEnforcer` is one — drops the transaction with no throw, no
step, and the state object unchanged. `readOnlyEnforcer` is mounted on the
`isMain` arm only, so the veto is **asymmetric across a cross-editor move**:
main as TARGET ⇒ the insert dies and the source delete still lands, taking a
footnote's BODY with it (the body IS the atom's `content` attr); main as SOURCE
⇒ the insert lands and the delete dies ⇒ a duplicate atom. And the create-drop's
`onAnchored(id)` is a SIDECAR write that never passes through ProseMirror at
all, so nothing could filter it: a vetoed insert left the card in NEITHER panel
list (no marker for the anchored one, no flags for the atomless one).

`src/components/drop-mode/commit-seam.ts` is the one door, and it states three
obligations in order:

1. **Ask editability at the COMMIT**, through `collabReadOnly` — for EVERY
   surface the compound will mutate, and for both ends BEFORE either is touched
   (a move whose source cannot be emptied must not deposit a copy). Task 638 put
   this gate at the deepest point a deferred commit passes through; a drop's
   deepest point is here, not at the mousedown that armed the ghost.
2. **Dispatch, then measure the EFFECT.** `insertLanded` (`schema-adopt.ts`) is
   the PRE-dispatch net — it asks what the built `Transform` kept, which is a
   different question from what ProseMirror ACCEPTED, and it cannot see a veto
   because the veto happens strictly later. `dispatchLanded` is its post-dispatch
   twin: `editor.state.doc !== before`, reference identity, no doc walk.
3. **Refuse as a UNIT** — either refusal leaves BOTH documents byte-untouched,
   which is this law's direction (never delete what you cannot restore).

Three cross-editor commit sites route through `commitCrossEditorMove`: the
inline-atom move (`util/inline-atom-move.ts`) and BOTH branches of
`specs/text-range-move.ts` — the second of which the census found rather than
the audit. The census is what keeps it at three: no cross-editor site may
dispatch its own `sourceEditor.view.dispatch(`.

**The failure modes are two, not one.** A READ-ONLY surface is caught before
anything is dispatched; a VETOED dispatch on a surface whose `view.editable`
says nothing is wrong is caught only by measuring the effect. A fix for one is
not a fix for the other, and the suite keeps them as separate legs.

**The sibling gap it closed:** `RichTextField`'s card-body citation drop stated
no editability gate at all while every sibling drop handler did — and card
bodies mount no `readOnlyEnforcer` arm to catch it either. The gate is asked
BEFORE `onCitationCreated`, which is the only order that helps: that mint
persists a card through a sidecar write no filter can reach.

CI: `drop-commit-seam.test.ts`.

### The dialect half: ONE capture, THREE derived forms, and each door consumes its own

Same law read at the *other* end (tasks 488 → 694 → 696). A capture is not one
string; it is one CUT, read in as many dialects as there are doors, and a door
handed the wrong dialect fails silently in whatever way that dialect is lossy.

A Mode-B capture (`createLinkedAnchor`, [src/links/links.ts](../../../src/links/links.ts))
now takes its range ONCE and derives three forms from it, all in the same leaf
([src/lib/tiptap/slice-capture.ts](../../../src/lib/tiptap/slice-capture.ts)):

| form | field | door | why it cannot be one of the others |
| --- | --- | --- | --- |
| **plain** (`doc.textBetween`) | `selectedText` | RELOCATION — the `textSnapshot` a Mode-B anchor is re-found by on reload | must stay plain doc text; that is what `reanchorByText` searches |
| **rich** (`captureRangeContent`) | `selectedContent` | DISPLAY — what the "Original" surfaces mount | the plain string "drops marks and drops every inline ATOM outright, so no render-time parse can recover them" ([captured-passage.tsx](../../../src/panels/_shared/captured-passage.tsx)) |
| **LaTeX** (`captureRangeLatex`) | `selectedLatex` | APPLY — what `locateSpan` byte-matches against the anchored paragraph's `serializeParagraphInline` | a flattened line is not a substring of a LaTeX serialization of the same span unless the span carried no markup at all |

**The defect this closes (696).** `original_text` is documented at its own site
as "the currency the apply path splices", and both add doors seeded it from
`anchorText` — the RELOCATION form. So every human-made suggestion over an
emphasis, a citation, a footnote or `$x$` missed the verbatim guard, answered
`{ ok:false, reason:"stale" }`, and told the user the paragraph had changed when
nothing had — marked "never retry", dead on first press. It was invisible
because the AI path does not have it (a skill-authored `original_text` is real
`.tex` read out of the paper) and because test fixtures use plain sentences. The
dominant path was the MORPH seam: the quick gestures mint a COMMENT, and
`cutterCommentToSuggestion` seeded `original_text` from `selectedText`.

**The rules.**

1. **Derive at the capture, never at the consumer.** Three capture sites that
   can disagree about what the user selected is the shape being replaced; one
   cut with three derivations cannot disagree.
2. **Absent is an answer; a lossy substitute is not.** A span with no single
   inline form (not one paragraph, or a node the serializer refuses) carries NO
   `latex`, and the suggestion's `original_text` stays EMPTY — which
   `suggestionApplicability` reads as `no-capture` and the card SAYS (task 695),
   rather than offering an Apply that cannot succeed.
3. **The forms travel as a unit.** `carryCapturedPassage` in
   [src/cards/envelope.ts](../../../src/cards/envelope.ts) loops `CAPTURE_HALVES`
   rather than naming fields, so a fourth form joins by being added to that list
   — not by being remembered at every clone and morph literal, which is exactly
   how `selectedContent` was lost for four months (694).
4. **A stored capture is never silently rewritten.** Cards already on disk hold
   the flattened line. `locateSpan` grows a second RUNG for them: find the
   flattened needle in the paragraph's PLAIN projection, map the hit back to a
   document range, **re-cut that range through the same capture leaf**, and
   require THAT to be verbatim. The re-cut is what keeps the negative case
   negative — the rung cannot widen what is spliceable, because its own result
   still has to pass the verbatim test, so a marker-straddling needle and a
   paragraph that genuinely changed both stay `stale`.
5. **Report what was CUT, not what was ASKED for.** `ApplyResult` carries the
   bytes the splice actually matched, and `appliedChange.originalText` records
   that — because that field is Revert's source, and on the repair rung the two
   differ.

**Known residual (filed, not fixed here).** Delete-mode apply stamps its blue
preview mark via `reanchorByText`, which searches the paragraph's TEXT — so it
is handed the APPLY form where it wants the PLAIN one. That mismatch predates
696 (AI-authored cards have always passed LaTeX there) and is the same law one
door over; the Keep/Revert splices themselves go back through `locateSpan` and
are unaffected.

CI: `capture-dialect.test.ts` (capture + repair rung, one leg per markup kind,
each asserting its own precondition that the verbatim rung cannot see the
needle), `suggestion-capture-dialect.test.ts` (both panels' seeding),
`morph-capture-dialect.test.ts` (the comment→suggestion seam, both directions),
`capture-pair-census.test.ts` (the forms derived from `types.ts` and
cross-checked against `CAPTURE_HALVES`).

### The re-anchor half: a MOVE releases the old anchor, and does not re-capture (task 698)

Dragging a card onto another paragraph MOVES it. The drop spec
(`drop-mode/util/text-object-side-reanchor.ts`) therefore RELEASES the card's
old Mode-B anchor — converts the `linkedRange` link to Mode-A and strips its
`linkedAnchor` mark — before the fresh paragraph link lands. Pre-698 that was an
optional `clearModeB?` supplied by notes alone; cutter, revisions, todos,
archive and reports silently lacked it, so the old passage kept the tint and
`getAnchorSummary` kept quoting the selection the card had been dragged away
from. `ParagraphAnchorApi.modeB` is now REQUIRED — `releaseModeB(…)` or
`{ policy: "intrinsic", why }` (highlights, the one declared exemption) — and
`drop-api-mode-b-census.test.ts` pins every `drop*Api` in `EditorPane` against
the provider's slots.

What the release does NOT touch: the captured passage (`selectedText` /
`selectedContent` / `original_text`). A re-anchor is not a re-capture — the
capture records what the user cut, which is the card's content, not a function
of where it hangs (the morph path's rule). A suggestion whose `original_text`
is absent from its new paragraph is the apply path's staleness verdict to give
(the dialect half above), not something to rewrite on a guess.

## The mirror half (task 703)

An atom-bearing card's archive splices its atom out and relies on the SIDECAR
ref to keep the body. That reliance is a capture, and it must be checked like
one: `spliceAndArchiveAtom` calls `footnotesHook.ensureRef(id)` — the
`footnotes.json` mirror's ONE upsert door, seeded from the live atom via the
owner-supplied `resolveFootnoteBody` — BEFORE it arms the orphan suppression
and deletes, and refuses + notifies when the capture fails (no atom, or the
sidecar has not loaded yet; the door never mints over the pre-load EMPTY).
Every footnote setter that writes INTO a ref (`setArchived`,
`setFootnoteAiRequest`, `updateFootnoteContent`) routes through the same door,
so a toolbar/slash/parsed footnote with no ref is never a silent no-op.
CI: `useFootnotes-upsert-door.test.tsx` (hook legs + an ordering census on
`spliceAndArchiveAtom`).
