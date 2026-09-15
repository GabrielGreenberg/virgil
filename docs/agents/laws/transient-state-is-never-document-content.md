<!-- last-verified: 3a8f4892 2026-09-15 -->
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
