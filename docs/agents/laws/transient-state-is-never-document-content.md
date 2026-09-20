<!-- last-verified: aea05929 2026-09-20 -->
<!-- derives-from: AGENTS.md#laws -->

# Transient state is never document content

> **A view-only signal painted over the document — a search hit, a diagnostics error range, a hovered card's anchor, a quoted revision — is a ProseMirror DECORATION replaced by a meta-only transaction. Never a mark, never a node attribute the document carries.**

This is the "clicking a search result ate my redo stack" class (task 120). Marks look like the obvious carrier and are wrong in four ways at once, none of which points back at the call site:

- **History.** A mark-add is a history entry, so painting a band clears the redo branch — undone edits become unrecoverable. And the *clear* is a recorded doc-changing transaction too, so the first Cmd+Z after the band goes away UNDOES the clear and **resurrects** it, with the producing panel already closed and nothing left to clear it again.
- **Dirty/autosave.** A mark tx is `docChanged`, so it arms the `useDocument` autosaver: a mere hover writes an unedited document to disk and exercises the disk-ledger / DiskWatcher machinery for a no-op.
- **Scope.** A mark can't be scoped to "the transient one" — clearing means selecting the WHOLE doc and unsetting *every* highlight, so a real authored highlight is collateral. It also forces the SELECTION onto the range to apply at all, which is where the grey inactive-selection ghost (and its restore-the-caret workaround) came from.
- **Capture.** A mark is content, so a card that captures a document slice captures the band with it.

The carrier is [src/lib/tiptap/transient-highlight.ts](../../../src/lib/tiptap/transient-highlight.ts) (`setTransientHighlights(view, targets)` / `clearTransientHighlights(view)`): idempotent, send the COMPLETE desired set per frame, `[]` clears, and the clear-when-already-empty bails without dispatching. Its node/atom-attribute sibling is `AnchorHighlightDecorator` ([anchor-highlight-deco.ts](../../../src/lib/tiptap/anchor-highlight-deco.ts)) — same meta-only shape, different geometry (`Decoration.node` for whole blocks and inline atoms; `Decoration.inline` here, because a partial-block text band has no node to hang on). Both are keystroke-sane by construction: rebuild only on their own meta, `DecorationSet.map(tr.mapping, tr.doc)` otherwise.

CI: [src/lib/\_\_tests\_\_/transient-highlight-guardrail.test.ts](../../../src/lib/__tests__/transient-highlight-guardrail.test.ts) greps `src/` AND `library/` for `.setHighlight(`/`.unsetHighlight(`/`.toggleHighlight(` and asserts the flagged set is EMPTY (`PERMITTED_HIGHLIGHT_MARK_WRITERS`; the library twin likewise). The `highlight` mark stays registered in the schema so a genuinely *authored*, persisted highlighter can still be built — that would be a legitimate allowlist entry with its justification. The behavioral contract (no history entry, no `docChanged`, no `onUpdate`, band survives an edit by mapping, dies with its text) is pinned in [src/lib/tiptap/\_\_tests\_\_/transient-highlight.test.ts](../../../src/lib/tiptap/__tests__/transient-highlight.test.ts) against the real main extension stack.

## The channel half (task 667)

The wash Virgil paints over the anchored region of an OPEN AI request arrived as a real
`pending-ai-request` `linkedAnchor` MARK, stamped by a doc-walking reconcile through
`reanchorByText`. It is a view-only signal derived entirely from card state, so it is the case this
law names — and its module argued for the mark anyway, on a "persistence" its own reload path never
used (the serializer strips the rich attrs; every mark was re-derived from the `aiRequest === true`
records on load, which is the whole lifecycle a decoration wants).

The four costs above all landed, plus two this signal added:

- **Caret hijack.** `reanchorByText` stamps via `.setTextSelection(range).setMark(…)
  .setTextSelection(from)`. Merely *toggling a card's request flag* therefore yanked the caret to
  the start of the anchored paragraph, wherever the user was typing. (The law's "Scope" bullet
  names the forced selection; this is what it costs when the producer is a background reconcile
  rather than a click.)
- **`\vlid` residue in the user's `.tex`.** Every `linkedAnchor` round-trips its anchorId as a bare
  marker, so a flag the document does not own wrote itself into the user's only copy. The pre-667
  suite *pinned that residue as expected behaviour*; it now asserts its absence.

And two more that are the real tell, because they are not costs to the signal but **damage to the
modules that own the real carrier**:

- A Mode-B request card got **no wash at all** — excluded because a second `linkedAnchor` would
  clobber the card's own. A carrier constraint wearing a feature's clothes.
- The orphan reaper had to **exempt the `pending-ai-*` family by name**: a mark with no card
  text-anchor is an orphan by every honest test that sweep applies, so a pseudo-kind became a
  special case in the general anchor lifecycle.

> **A view-signal that reaches for a document carrier is usually telling you no VIEW carrier would
> take it.** Before writing the mark, ask what the decoration channel refused — here the answer was
> "a second producer", not "this geometry".

`TransientHighlightDecorator`'s single shared set was the refusal: the payload is the COMPLETE
desired list, so the search band's clear-on-close would erase the wash and vice versa. The fix is
therefore not a third bespoke plugin but **channels** — `setTransientHighlights(view, targets,
channel)`, one PLUGIN INSTANCE per channel (`search`, `ai-request`), each with its own key and its
own `DecorationSet`. A dispatch replaces only its own channel, costs only its own bands, and cannot
see another's. A `TransientHighlightTarget` may now also declare `inclusive: true` — for a band that
denotes a live REGION ("this card's anchored paragraph") rather than a fixed range, so text typed
into it belongs to it. That is the one edge behaviour a mark carrier got for free, and the only
thing that had to be ported.

The producer is [src/links/\_shared/request-wash.ts](../../../src/links/_shared/request-wash.ts)
(`paintRequestWash` / `requestWashTargets` / `requestWashKey`), read by ONE `EditorPane` effect off
the derived Mode-B card bag. Cost went DOWN: two full doc walks per reconcile became N anchor
resolutions (N = open requests) and one meta-only transaction, fired only when the desired set
changes.

CI: the contracts are pinned in
[src/links/\_shared/\_\_tests\_\_/request-wash.test.ts](../../../src/links/_shared/__tests__/request-wash.test.ts)
— no doc change and no caret move on toggle, a byte-identical `.tex`, a Mode-B card washed with its
own anchor intact, and the band surviving an orphan sweep with an EMPTY alive-set (there is nothing
left to exempt).
