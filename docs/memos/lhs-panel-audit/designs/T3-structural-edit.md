# T3 — Structural-edit atom integrity

> Theme owner design. **DESIGN ONLY** — no source was edited producing this doc.
> Inputs: `CLASSES.md` (C2, C10), `BUGLIST.md`, `findings-index.json`, and the cited
> source loci read read-only.

---

## 1. Scope

This theme owns two defect classes that share one mechanical family — **inline atoms
(`\cite` / `\ref`/`labelRef` / inline+display math / nested footnotes) that live somewhere
ProseMirror's `doc.descendants()` and a hand-rolled text walk don't naturally reach, so a
structural *edit* destroys them and a structural *traversal* misses them.**

- **C2 — Edit a structured node via flattened plain-text input, committed with `delete+insertText`.**
  The outline rename pod (heading + parTitle) seeds its `<input>` from a *flattened* text
  projection (`extractText`, which drops every non-`text` node) and commits by deleting the
  heading's inner range and re-inserting **plain text** — annihilating any inline mark, math,
  `\cite`, or `\ref` that was in the heading. The same `editor-ops.ts` mutators address blocks
  by a stale integer `blockIndex` against the *live* doc with no node-type assert.
- **C10 — Descendants-only traversal blind spot for nested inline atoms.**
  `findInlineAtomPos` / `resolveLink` / `collectAnchorEls` / `OutlinePanel.extractText` walk only
  what `doc.descendants()` (or a `node.content`-only recursion) yields. A `\cite` or math atom
  nested inside a **footnote's `attrs.content`** (a JSONContent *literal*, not PM child nodes —
  the footnote is `inline:true, atom:true`) is invisible: mis-anchored, dropped from the outline
  flatten, or handed a dead jump arrow.

### Full bug list resolved (15)

**C2 (6):**
- `OUT-F5-01` **[DATA-LOSS]** — heading rename flattens body to plaintext, destroys inline math / `\cite` / formatting.
- `OUT-F5-04` [MEDIUM] — Reader (read-only) shows Edit/Focus/`+` because affordances gate on callback-truthiness, not an explicit editable flag. *(see §6 — partial; shared with T-read-only concern)*
- `OUT-F8-03` [MEDIUM] — heading-label commit accepts a duplicate `\label{}` despite the live warning.
- `OUT-F5-02` [LOW] — parTitle rename can stamp `parTitle` onto a non-paragraph node when `blockIndex` drifted (no type guard).
- `OUT-F5-03` [LOW] — label editor commits the duplicate label on Enter/blur (advisory flag ignored).
- `OUT-F8-04` [LOW] — parTitle rename throws / mis-writes when `blockIndex` resolves to a heading.

**C10 (5):**
- `BIB-F3-01` **[HIGH]** — jump-to-citation no-ops for a bib entry cited only inside a footnote.
- `CI-F3-01` **[HIGH]** — jump (and select-highlight) no-ops for a citation that lives inside a footnote.
- `OUT-F1-01` [LOW] — outline heading rows drop nested atom text (`Step 3: $n+1$` → `Step 3: `), `Untitled` fallback fires.
- `OUT-F4-01` [LOW] — heading + doc-title outline render and the drag-ghost label silently omit inline math / `\cite` / `\ref`.
- `SR-F4-01` [LOW] — searching Footnotes/Notes for a citekey embedded in a footnote body fails (body flattened to display-only text). *(see §6 — covered by the same atom-text registry; final wiring overlaps T-search.)*

The two **[COSMETIC]** outline siblings that share the no-counter-bump tail of C2 — `OUT-F7-01`
(outline keeps showing the OLD title after rename) — are resolved *for free* by this theme because
the deep fix re-routes the rename through a real structural transaction (see §3 / §7).

---

## 2. Root diagnosis — the single underlying architectural deficiency

> **The codebase has no single, atom-aware notion of "the inline content of a structured node."
> Each consumer re-derives it ad hoc, and every ad-hoc derivation silently agrees on the same
> blind spot: it treats an inline atom as either (a) empty text or (b) an opaque leaf, and it
> never descends into the one place an atom's payload actually lives — the JSONContent literal
> stashed in an atom node's `attrs.content`.**

There are **two physical hiding places** for an atom, and the bug family is the union of
"some code can't see / preserve atoms in place A" and "…in place B":

**Place A — atom payload in `attrs`, not in `node.textContent`.**
`citation`, `inlineMath`, `displayMath`, `labelRef`, `figureBlock`, `texBlock` carry their text in
attrs (`command`/`latex`/`src`), so `node.textContent === ""`. A flat `if (node.type==="text")
return node.text` walk (`OutlinePanel.extractText:280`) returns `""` for all of them. The codebase
*already has the cure* for this — `src/lib/atom-text.ts` `getAtomText()` — but `extractText` was
written without it and the outline never adopted it (`OUT-F1-01`, `OUT-F4-01`).

**Place B — the footnote body is a JSONContent literal in `attrs.content`, opaque to `descendants`.**
The footnote node is `inline:true, atom:true` with `content: { default: null }` *as an attribute*
(`src/lib/tiptap/footnote.ts:49-54`). ProseMirror's `doc.descendants()` (by design) does not enter an
atom's attrs. So `findInlineAtomPos` (`links.ts:652`), `resolveLink`, `collectAnchorEls`, and even the
canonical `DocStructureObserver.buildInitial` (`structure-index.ts:50`) **cannot see a citation inside
a footnote**. The team has already hit this once and patched it *locally* — `citation-doc-ops.ts`
exists solely to hand-walk `attrs.content` for the *collect* (`walkJsonContentForCitations`) and
*delete* (`stripFootnoteNestedCitation`) paths (backlog #38), with a header comment that literally
states the invariant "every place that COLLECTS a footnote-nested cite must have a matching place
that REMOVES it." **But jump / hover / highlight / search were never given the matching descent** —
hence `BIB-F3-01` / `CI-F3-01` / `SR-F4-01`. The local patch *proved the pattern but didn't
generalize it*; the resolver's blind spot is the residue.

**The C2 (edit) class is the same deficiency seen from the write side.** The rename path needs the
inline content of a heading to (1) seed an editor and (2) write it back. Lacking a shared
representation, `OutlinePanel` reaches for the flattening `extractText` to seed, and `editor-ops.ts`
reaches for `delete(from,to).insertText(plainString)` to commit. *Both halves throw the atoms away* —
the destruction is locked in at the seed, before the transaction even runs. The serializer is
**innocent**: `serializeNode`'s `heading` case round-trips atoms correctly via
`serializeInlineSequence` (`latex-serializer.ts:222-228`, with `inlineMath`/`citation` cases at
`:380`/`:402`). The loss is purely in the in-app *edit* round-trip, which never goes near the
serializer.

Layered on top is a **secondary addressing deficiency** shared by every `editor-ops.ts` mutator:
they address the target block by an integer `blockIndex` captured from a (possibly debounced /
stale) outline snapshot and applied to the *live* doc, with a node-type guard present on some
mutators (`handleRenameHeading`, `handleUpdateLabel` check `node.type.name==="heading"`) but
**absent on `handleRenameParTitle`** (`editor-ops.ts:166`) — the `OUT-F5-02`/`OUT-F8-04` drift bugs.
Focus-mode already migrated off integer indices onto UUID anchoring (`useFocusMode.ts:84-93`
`uuidOfIndex`/`blockIndexOfUuid`) to fix *exactly this* drift; the outline mutators never followed.

So the single deficiency, stated tightly: **"inline content of a structured/atomic node" is not a
first-class, atom-aware value with one reader and one in-place writer — it is re-derived,
flatten-lossily, at every call site, and addressed by a drift-prone integer index.**

---

## 3. The deep solution

Introduce **one atom-aware inline-content module** plus **one node-tree-preserving structural-edit
primitive**, and route every flatten / traverse / edit site through them. Three new abstractions,
all small, all pure-ish, all unit-testable against a real `Editor` (the `citation-doc-ops.ts`
precedent shows this is already the house style).

### 3a. `src/lib/inline-content.ts` — the atom-aware traversal (kills C10, the read side of C2)

A single module that knows the **two hiding places** and exposes them uniformly. It absorbs and
generalizes `atom-text.ts` and `citation-doc-ops.ts`'s walkers.

```ts
// Walk a PM node's inline content INCLUDING atoms' attrs.content literals.
// `descendInto` defaults to ["footnote"] — the only atom whose body holds
// further atoms today; figure/example are block-atoms handled by the doc walk.
export function* inlineAtoms(
  node: PMNode | JSONContent,
  opts?: { descendInto?: readonly string[] },
): Generator<InlineAtomHit>;       // { kind, id, command?, latex?, path }

// Flatten to display text, atom-aware (uses getAtomText for attr-borne atoms,
// recurses through descendInto). THE replacement for OutlinePanel.extractText.
export function flattenInlineText(
  node: PMNode | JSONContent,
  opts?: { descendInto?: readonly string[] },
): string;

// Resolve the PM position of an inline atom by id, descending into footnote
// bodies. Returns either a live PM pos (top-level atom) OR a "nested" locator
// { hostFootnoteId, hostPos } for an atom inside a footnote literal, so the
// jump path can scroll to the HOST marker (the nested atom has no own DOM).
export function findInlineAtomPosDeep(
  editor: Editor,
  nodeName: "footnote" | "citation",
  id: string,
): InlineAtomLocation | null;       // { pos } | { hostPos, nested: true }
```

`findInlineAtomPos` in `links.ts:645` is rewritten to delegate to `findInlineAtomPosDeep`. When the
atom is nested, `resolveLink` returns the **host footnote's** `domEl` (the visible superscript
marker) — that is the correct, only scrollable target, and it satisfies `BIB-F3-01` / `CI-F3-01`
("scroll the editor to the citation that lives inside a footnote" == "scroll to the footnote
marker"). `collectAnchorEls` inherits the fix transparently because it goes through `resolveLink`.

`OutlinePanel.extractText`, `getDocTitle`, and the drag-ghost label call `flattenInlineText`
(`OUT-F1-01`, `OUT-F4-01`). `useWordCount.collectInline` and `OutlinePanel.collectInline` (which
already half-handle `inlineMath` but treat `footnote.attrs.content` as a *string*, `OutlinePanel.tsx:475`)
are reconciled onto the same descent so footnote-nested cites/text are searchable (`SR-F4-01`).

The `DocStructureObserver.buildInitial` walk (`structure-index.ts`) gains an opt-in
`descendInto:["footnote"]` pass that records footnote-nested citations into `structure.citations`
with a `nestedInFootnoteId` field — closing the documented gap in `types.ts:114-118` and letting the
keystroke-safe structural pipeline own nested-atom liveness instead of the out-of-band
`getCitations()` re-walk. **This must stay O(edit-size)** (see §7).

### 3b. `src/lib/tiptap/structural-edit.ts` — the node-tree-preserving edit primitive (kills the write side of C2)

One primitive that replaces every `delete(from,to).insertText(...)` structural mutator:

```ts
// Re-anchor a structural edit by UUID, not integer index, and never flatten.
// `editInlineContent` receives the node's CURRENT inline content as a
// fragment and returns the new fragment — so an "edit only the leading text
// run" rename leaves nested atoms/marks untouched.
export function editStructuredNodeByUuid(editor, uuid, {
  assertType?: string,                 // node-type guard (OUT-F5-02/04)
  editInlineContent?: (frag: Fragment) => Fragment,
  setAttrs?: (attrs) => attrs,         // for parTitle / label
  guard?: () => boolean,               // OUT-F8-03/F5-03 duplicate-label gate
}): boolean;
```

- **Heading rename** becomes: replace only the **text portion** of the heading's content, splicing
  the new label string in while preserving every non-text inline node (`inlineMath`, `citation`,
  `labelRef`) and marks in their original order. The pod seed comes from `flattenInlineText` for
  *display*, but the commit diffs the typed string against the old text-run and applies a minimal
  text replacement transaction — atoms survive. (A pragmatic v1: if the typed string's
  atom-stripped form equals the old atom-stripped form, treat it as a pure-text edit and only
  replace text runs; if the user genuinely retyped over an atom's position, fall back to a guarded
  whole-content replace that still preserves any atoms the user didn't touch. Either way the default
  case — appending/fixing words around atoms — never loses them.)
- **parTitle / label** become `setAttrs` calls with a real `assertType` guard
  (`OUT-F5-02`, `OUT-F8-04`).
- **Duplicate-label** commit is gated by `guard` reading the live `structure.labels` map
  (`OUT-F8-03`, `OUT-F5-03`): the advisory warning and the commit now read the **same** source of
  truth, so the warning can no longer disagree with the commit.
- Addressing is **UUID-anchored** via the existing `findParagraphByUuid` (`links.ts:665`) /
  `blockIndexOfUuid` pattern. The outline already has each block's UUID in scope; `onRenameHeading`
  / `onRenameParTitle` change signature from `(blockIndex, text)` to `(uuid, ...)`. This is the same
  migration focus-mode already made.

### How it captures the whole range (one fix, the cluster falls out)

| Symptom | Falls out of |
| --- | --- |
| Heading rename destroys atoms (`OUT-F5-01`) | 3b preserves the inline fragment |
| Outline drops atom text (`OUT-F1-01`, `OUT-F4-01`) | 3a `flattenInlineText` |
| Jump dead for in-footnote cite (`BIB-F3-01`, `CI-F3-01`) | 3a `findInlineAtomPosDeep` → host marker |
| Search misses footnote-nested citekey (`SR-F4-01`) | 3a descent in `collectInline` |
| parTitle stamps wrong node / throws (`OUT-F5-02`, `OUT-F8-04`) | 3b `assertType` + UUID anchor |
| Duplicate label committed (`OUT-F8-03`, `OUT-F5-03`) | 3b `guard` shares `structure.labels` |
| Outline shows OLD title after rename (`OUT-F7-01`) | 3b emits a real structural tx → counter bumps |

### How it improves the app beyond the bugs

- **One invariant, mechanically enforced.** The `citation-doc-ops.ts` header comment's hand-policed
  rule ("every COLLECT needs a matching REMOVE") becomes a *typed* contract: all atom traversal goes
  through `inlineAtoms`/`findInlineAtomPosDeep`, so a future atom kind nested in a footnote is
  visible to *every* consumer the day it's added, not the day someone remembers to patch each walk.
- **Drift-proof structural edits.** Every outline mutator (`handleReorderBlocks`,
  `handleRenameHeading`, `handleUpdateLabel`, `handleRenameParTitle`, `handleScrollToHeading`) moves
  to UUID addressing — the entire `editor-ops.ts` index-drift family (the `OUT-F5-02` "addressing
  scheme is the class" note) is closed, not just the parTitle instance.
- **Closes the observer's documented nested-citation gap** (`types.ts:114`), retiring the
  out-of-band `getCitations()` re-walk hack and bringing nested atoms under the keystroke-safe
  structural bus that the whole card system already trusts.
- **`atom-text.ts` + `citation-doc-ops.ts` collapse into one module** — net code reduction; the two
  partial walkers stop drifting from each other.

### Shallow patch explicitly rejected

The per-bug patch would be: (a) in `handleRenameHeading`, special-case "if the heading contains an
atom, don't flatten"; (b) in `findInlineAtomPos`, add an `if (nodeName==="citation")` branch that
also walks footnotes; (c) in `extractText`, add `if (node.type==="inlineMath") return latex`. This
is rejected because it **re-implements the same descent three more times in three more files**,
leaving the fourth (`OutlinePanel.collectInline` already treats `footnote.attrs.content` as a string
— a *fifth* divergent walker) untouched, and it does nothing for the *next* atom kind or the *next*
flatten consumer. It also leaves the integer-index drift (`OUT-F5-02`/`F8-04`) and the
warning-vs-commit split (`OUT-F8-03`/`F5-03`) as separate one-liners. Gabriel's principle: name the
deficiency (no shared atom-aware inline-content abstraction) and fix *that*.

---

## 4. Data-model / schema / sidecar changes + migration

**No persisted schema change. No sidecar shape change. No migration required.** This theme is
entirely about *in-memory traversal and the edit transaction* — the on-disk `.tex` and all
JSON sidecars are untouched. Concretely:

- The footnote node's `attrs.content` JSONContent literal — already the storage format — is the
  thing we now traverse correctly; we do not change how it's stored or serialized.
- `\vcid{…}` / `\vfid{…}` stable-id markers on the `.tex` are unchanged; the serializer already
  emits nested cites correctly (`latex-serializer.ts:393` round-trips a footnote body via
  `richJsonToLatex`, which carries nested `\cite`). A heading rename now goes *through* a structural
  tx, so the existing serialize-on-autosave path persists the preserved atoms with **no new write
  format** — existing papers reload identically.
- **Back-compat for existing papers:** an old paper whose heading was *already* flattened by the
  buggy rename (atoms already gone) is simply a paper with no atoms in that heading — nothing to
  migrate; the fix prevents *future* loss. Papers authored before this fix open and serialize
  byte-identically.

**In-memory (non-persisted) addition:** `DocStructure.citations` entries gain an optional
`nestedInFootnoteId?: string`. This is a runtime structure rebuilt from the doc on every load
(`buildInitial`) and never serialized, so it is versionless from disk's standpoint; the
`DocStructure.version` constant (`structure-index.ts:203`) bumps `1 → 2` purely as an in-process
sanity stamp (no persisted consumer reads it).

**Signature migration (code, not data):** `onRenameHeading(blockIndex,text)` →
`onRenameHeading(uuid,text)` and the parTitle/label twins. All call sites are in-repo
(`EditorLayout.tsx:2785`, `OutlinePanel.tsx`), so this is a mechanical refactor with no external
contract.

---

## 5. Files

### Created
- `src/lib/inline-content.ts` — atom-aware traversal: `inlineAtoms`, `flattenInlineText`,
  `findInlineAtomPosDeep`. Absorbs `getAtomText` and the `walkJsonContentForCitations` /
  `removeCitationFromJsonContent` walkers.
- `src/lib/tiptap/structural-edit.ts` — `editStructuredNodeByUuid` node-tree-preserving primitive.
- `src/lib/__tests__/inline-content.test.ts`
- `src/lib/tiptap/__tests__/structural-edit.test.ts`

### Modified
- `src/components/editor-layout/card-actions/editor-ops.ts` — `handleRenameHeading`,
  `handleRenameParTitle`, `handleUpdateLabel`, (and `handleReorderBlocks` / `handleScrollToHeading`)
  re-keyed to UUID + routed through `editStructuredNodeByUuid`. **Primary C2 fix locus.**
- `src/panels/Outline/OutlinePanel.tsx` — `extractText`/`getDocTitle`/drag-ghost → `flattenInlineText`;
  `collectInline` footnote-content descent; rename pod seeds from `flattenInlineText`; `onRename*`
  callbacks carry UUID; duplicate-label commit gated.
- `src/links/links.ts` — `findInlineAtomPos` delegates to `findInlineAtomPosDeep`; `resolveLink`
  returns host-marker `domEl` for nested atoms. **Primary C10 fix locus.**
- `src/links/_shared/useAnchorHighlightReconciler.ts` — no logic change; inherits nested resolve via
  `resolveLink` (verify highlight paints the host marker).
- `src/lib/tiptap/doc-structure/structure-index.ts` — `buildInitial` opt-in `descendInto` for
  footnote-nested citations; `version 1→2`.
- `src/lib/tiptap/doc-structure/types.ts` — `CitationEntry.nestedInFootnoteId?`; update the
  `:114-118` comment.
- `src/lib/atom-text.ts` — re-export from `inline-content.ts` (or delete after callers migrate).
- `src/components/citation-doc-ops.ts` — re-implement `walkJsonContentForCitations` /
  `removeCitationFromJsonContent` on top of `inlineAtoms` (keep the named exports + their tests).
- `src/hooks/useWordCount.ts` — `collectInline` footnote-content descent (shared with `SR-F4-01`).
- `src/components/EditorLayout.tsx` — pass UUID through the `onRenameHeading`/`onRenameParTitle`
  wiring (`:2785`).

---

## 6. Bugs resolved + not-covered

**Resolved (15):** `OUT-F5-01`, `OUT-F5-04`, `OUT-F8-03`, `OUT-F5-02`, `OUT-F5-03`, `OUT-F8-04`
(C2); `BIB-F3-01`, `CI-F3-01`, `OUT-F1-01`, `OUT-F4-01`, `SR-F4-01` (C10). Plus the cosmetic tail
`OUT-F7-01` falls out (real structural tx bumps the heading counter).

**In-scope but only partially this theme's to fix:**
- `OUT-F5-04` (Reader shows Edit/Focus/`+`): the *atom-preserving* half is ours, but the
  **root** is "affordance gated on callback-truthiness vs. an explicit `editable` flag"
  (`OutlinePanel.tsx:676,1661,1676,1755`), which is a read-only-mode concern, not an atom concern.
  We will thread an explicit `editable` prop in the outline as part of the rename-signature refactor
  (cheap, same file), but **flag for the PLAN**: if a broader read-only/affordance theme exists, the
  gating predicate belongs there; this theme guarantees only that the *edit* it gates is atom-safe.
- `SR-F4-01`: the **atom-text extraction** (making a footnote-nested citekey *findable*) is ours via
  `flattenInlineText`/`collectInline`. The **search dispatch/scope wiring** that decides *which*
  scopes index footnote bodies overlaps T-search (C7/C11 search-host wiring). We provide the
  correct text; T-search owns whether the Footnotes scope is fed it. Marked as a shared seam.

**Not covered (explicitly out of this theme):**
- `CI-F4-01` / `EX-F4-01` / `CI-F4-02` (clicking an atom inside a *card-body* sub-editor selects the
  wrong instance) — that's the **global-querySelector-by-shared-key** class (carry the clicked
  element in the event), a different mechanism (multiple mounted editors), owned elsewhere.
- The id-regeneration-on-reparse family (`C1`, `C17`) that makes a *top-level* atom's id unstable —
  orthogonal to nesting; owned by T1/T2's identity model (see §8).

---

## 7. Keystroke-sanctity + test impact

**Invariants touched:**
- **`AGENTS.md` keystroke sanctity.** The risky surface is the new `descendInto:["footnote"]` pass
  in `buildInitial` (initial-population only — O(doc) **once** on load, which is allowed; `buildInitial`
  already does a full `doc.descendants`). The **per-transaction** path must NOT gain a footnote-body
  re-walk: the `step-inspector.ts` diff stays O(edit-size). Footnote-nested citation liveness is
  recomputed only when a `footnoteOrderChanged` / footnote-content event fires (the same trigger the
  current `getCitations()` re-walk uses), never on a plain keystroke. **Verify with
  `window.__virgilBusStats()`**: typing N plain chars in a paragraph leaves `emitCount` flat; typing
  inside a heading bumps the heading counter exactly as today (no regression).
- **No per-keystroke doc-walk added.** `flattenInlineText` runs only in the outline's
  already-structural-counter-gated memo and the rename seed (one-shot on Edit click). `resolveLink`'s
  deep find runs only on jump/hover/select — already event-driven, not per-keystroke.
- **`editStructuredNodeByUuid` emits a normal structural transaction** — the observer maps it like any
  other edit; no special-casing.

**New tests:**
- `inline-content.test.ts`: `flattenInlineText` preserves math/cite/ref text in a heading;
  `findInlineAtomPosDeep` locates a citation nested in a footnote and returns the host pos; round-trip
  parity with `getAtomText` for each attr-borne atom kind.
- `structural-edit.test.ts`: heading rename with a nested `\cite`/`$math$`/bold preserves every atom
  and mark (the direct `OUT-F5-01` pin); parTitle rename on a drifted index that resolves to a
  heading is a **no-op** not a mis-write (`OUT-F8-04`); duplicate-label commit is **blocked**
  (`OUT-F8-03`/`F5-03`).
- A jump test: `resolveLink` for an in-footnote citation returns the footnote marker's `domEl`
  (`BIB-F3-01`/`CI-F3-01`).
- `__virgilBusStats` regression assertion that the footnote-descent in `buildInitial` does not add a
  per-keystroke emit.

**Existing tests likely affected:**
- `footnote-nested-citation-delete.test.ts` (`citation-doc-ops`): the named exports stay, but their
  internals now delegate to `inlineAtoms` — re-run to confirm the delete-strip behavior is identical.
- `auto-title.test.ts:192-202` (the static `readFileSync(...).toContain('isAutoTitle')` guard) is
  unrelated but lives near examples; not touched.
- Any outline test asserting `onRenameHeading` is called with an integer index must update to the
  UUID signature.
- Serializer tests: unchanged (we don't touch serialization), but add one end-to-end
  "rename-then-serialize" test proving the nested atom survives to `.tex`.

---

## 8. Cross-theme dependencies & ordering

- **Shared with T1 / T2 — the card/citation identity+anchor model.** This theme assumes a citation /
  footnote atom is addressable by a **stable id** (`citationId` / `footnoteId` / unified `linkId`)
  that survives within a session. The *nesting* fix (descend into the footnote literal) is orthogonal
  to *id stability across re-parse* (the `C1`/`C17` id-regeneration family that T1/T2 own). **Stated
  assumption:** `findInlineAtomPosDeep(editor, kind, id)` is given an id that matches the live atom's
  attr — i.e. the id model T1/T2 land is the input to my resolver. **Flag for the PLAN to reconcile:**
  if T1/T2 introduce a stable *surrogate* id on `CitationRef`/atoms (per `C1`'s fix locus), my
  resolver must match on **that** surrogate, and the new `DocStructure.citations.nestedInFootnoteId`
  field should key off the same surrogate. We share the `CitationEntry` type in
  `doc-structure/types.ts` — T1/T2 and T3 both edit it; the PLAN must order these so one lands the id
  field and the other lands the nesting field on the *same* type without a merge collision.
- **Ordering — land BEFORE the search-scope wiring (T-search / C7-C11).** `SR-F4-01`'s findability
  depends on `flattenInlineText` existing first; T-search then feeds it to the Footnotes scope.
- **Ordering — independent of T1/T2 on the C2 (edit) side.** The heading-rename atom-preservation has
  no identity dependency and can land first; it's the highest-severity item (a DATA-LOSS) and the
  lowest-coupling, so it's a safe early landing.
- **No dependency the other way:** nothing in T1/T2/T-search needs this theme to land first, except
  the shared `CitationEntry` type edit (coordinate, don't serialize).

`dependsOn` (theme keys): **T1, T2** — only for the shared `CitationEntry` identity field
reconciliation; the C2 edit work has no hard predecessor.

---

## 9. Risk + rollout

**Overall risk: MEDIUM.** Touches a hot path (the shared `resolveLink` used by every jump/hover/
highlight) and a structural-edit primitive, but each piece is independently shippable and testable,
and there is no persisted-data risk (§4).

**Incremental, no feature flag needed — three independent landings:**

1. **`inline-content.ts` + read-side adoption (C10, low risk).** Add the module; rewrite
   `findInlineAtomPos`/`resolveLink` and `extractText`/`collectInline` to use it. This is *purely
   additive* to traversal — a top-level atom resolves exactly as before (the deep walk finds it at
   the same pos); the only new behavior is *finding* a previously-invisible nested atom. De-risk by
   keeping `findInlineAtomPos`'s top-level fast-path first and only descending on a miss, so the
   common case is unchanged byte-for-byte.
2. **`structural-edit.ts` + heading rename (C2 DATA-LOSS, medium risk).** The behavior change users
   see. De-risk: (a) the "pure-text edit around atoms" fast-path keeps the common rename identical;
   (b) a guarded fallback never *deletes* an atom the user didn't type over; (c) ship behind a
   thorough `structural-edit.test.ts` with the exact `OUT-F5-01` repro (`\section{The $G$-action on
   \citet{foo}}`) as a pin. Because it's the DATA-LOSS bug, prioritize but verify live in the dev
   doc (`samples/annotation-history` has headings + atoms) before merge.
3. **UUID-addressing + label gating (C2 LOW/MEDIUM, low risk).** Signature migration + the
   `assertType`/`guard` adds. Mechanical; mostly compile-time safety.

**Rollback:** any of the three reverts independently; #1 and #3 are pure refactors with no UX change.
**Live verification owed (per memory `dev_doc_loading` / `turbopack_watcher_stale`):** rename a
heading containing `$math$` + `\citet` in the dev preview, confirm the atoms survive and the outline
row shows them; click the bib/citations jump arrow on an in-footnote cite and confirm the editor
scrolls to the footnote marker.

---

## 10. Implementation checklist (ordered, individually verifiable)

1. **Create `src/lib/inline-content.ts`** with `inlineAtoms`, `flattenInlineText`,
   `findInlineAtomPosDeep`; fold in `getAtomText`'s extractor table. *Verify:* unit test each atom
   kind's text + a nested-in-footnote cite hit.
2. **Migrate `citation-doc-ops.ts`** to delegate to `inlineAtoms`; keep the named exports. *Verify:*
   `footnote-nested-citation-delete.test.ts` green unchanged.
3. **Rewrite `findInlineAtomPos`** (`links.ts:645`) to call `findInlineAtomPosDeep` (top-level
   fast-path, descend on miss); **`resolveLink`** returns the host footnote `domEl` for a nested hit.
   *Verify:* new jump test for `BIB-F3-01`/`CI-F3-01`; existing top-level jump tests unchanged.
4. **Confirm `useAnchorHighlightReconciler`** paints the host marker for a selected in-footnote
   citation (no code change expected; add an assertion). *Verify:* select-highlight test.
5. **Repoint `OutlinePanel.extractText`/`getDocTitle`/drag-ghost** at `flattenInlineText`; reconcile
   `collectInline`'s footnote-content descent. *Verify:* outline row test for `OUT-F1-01`/`OUT-F4-01`.
6. **Reconcile `useWordCount.collectInline`** onto the footnote descent (shared `SR-F4-01` text). *Verify:* word-count + a search-text extraction unit test.
7. **Create `src/lib/tiptap/structural-edit.ts`** `editStructuredNodeByUuid` with `assertType` /
   `editInlineContent` / `setAttrs` / `guard`. *Verify:* `structural-edit.test.ts` (atom-preserving
   heading rename pin = `OUT-F5-01`).
8. **Rewrite `editor-ops.ts`** `handleRenameHeading`/`handleRenameParTitle`/`handleUpdateLabel`
   (and reorder/scroll) onto UUID addressing via `editStructuredNodeByUuid`. *Verify:* `OUT-F5-02`
   no-op-on-drift, `OUT-F8-04` no-throw pins.
9. **Migrate the outline rename callbacks** (`OutlinePanel.tsx`, `EditorLayout.tsx:2785`) to UUID;
   seed the pod input from `flattenInlineText`. *Verify:* `OUT-F7-01` — outline shows the NEW title.
10. **Gate duplicate-label commit** in `editStructuredNodeByUuid.guard` reading live
    `structure.labels`. *Verify:* `OUT-F8-03`/`OUT-F5-03` blocked-commit pins.
11. **Add `descendInto` to `buildInitial`** + `CitationEntry.nestedInFootnoteId` (coordinate the type
    edit with T1/T2); bump `version 1→2`. *Verify:* `__virgilBusStats` keystroke-flat regression; a
    structure test that a footnote-nested cite appears in `structure.citations` with the host id.
12. **Thread the explicit `editable` flag** through the outline edit affordances (partial `OUT-F5-04`
    — coordinate scope with the PLAN). *Verify:* Reader-mode test shows the edit no-ops cleanly.
13. **Live smoke test** in the dev doc (§9 verification owed); refresh `doc_devtest` from
    `samples/annotation-history` first if choppy.
