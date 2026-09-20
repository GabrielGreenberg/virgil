<!-- last-verified: aea05929 2026-09-20 -->
<!-- derives-from: AGENTS.md#laws -->

# Refocus is not navigation

> **`focus()` is two commands wearing one name.** Besides taking DOM focus,
> TipTap's `focus()` schedules — inside a `requestAnimationFrame` — an
> `editor.commands.scrollIntoView()`, because its `scrollIntoView` option
> defaults to `true`. That deferred scroll targets whatever the SELECTION is by
> the time the frame runs. So a commit that edits **at a node** and leaves the
> caret alone does not "return focus": it NAVIGATES, to a stale caret. The door
> for "give the editor its focus back and leave the document where it is" is
> [`refocusEditor(editor)`](../../../src/lib/tiptap/refocus-editor.ts).

This is the "adding a label to a section makes the scroll jump" class (task 486,
Gabriel's own report), and it is the reposition-policy doctrine (task 328 — *a
reposition is sanctioned only when the thing the user needs is not already where
they need it*) read on the DOCUMENT axis and on the EDIT path. 328 swept the
gesture-driven jumps (card clicks, marker clicks); the edit-commit refocus was
never swept, and the heading-label strip has carried the defect for as long as it
has existed: `tr.setNodeMarkup` at a uuid-resolved heading, `view.dispatch`, then
a bare `nodeEditor.commands.focus()` whose frame dragged the paper to wherever the
user's caret happened to be.

Six rules it earned:

- **The discriminator is TIMING, not the call.** `delayedFocus` runs in a frame,
  so `chain().focus().setTextSelection(edit)…` scrolls to the EDIT — the chain has
  already moved the selection by then — and so does the lightning grid's
  `chain().focus().run()` prelude in front of a caret insert. Most `focus()` sites
  in the app are that shape and are deliberately left alone. **What breaks is a
  BARE refocus after an at-a-node write**, where nothing moves the selection and
  the frame finds the caret exactly where it was.
- **`editor.view.focus()` never scrolls** — prosemirror-view focuses with
  `preventScroll` — which is why the drop-mode / NodeView sites that already spell
  it are correct as they stand and need no door. The population is TipTap's
  command form only.
- **A site that DOES want the reader moved says so explicitly, once.** The
  Reader's Outline jump was the shape worth fixing beside the reported one: it
  spelled a bare `focus()`, a `setTextSelection`, and then its own
  `dom.scrollIntoView({ behavior: "smooth" })` — so the implicit frame raced the
  smooth scroll and cancelled it with an instant jump to the same place. It lands
  the reader nowhere WRONG; it simply performs two scrolls where one was intended.
  One explicit scroll, and (per 328) through `mayReposition` / the necessity-gated
  doors in `layout-scroll.ts` where a necessity question applies.
- **The chain form already had a door and this is its standalone twin.**
  [insert-inline-atom.ts](../../../src/lib/tiptap/insert-inline-atom.ts) rooted
  `chain().focus(null, { scrollIntoView: false })` for inline-atom creation (the
  "the new footnote lands just out of view at the top" bug). Two spellings of one
  rule is one too many, so the option literal now has exactly TWO spellers — the
  chain door and the standalone door — and everything else adopts one of them.
  `Editor.tsx`'s hand-spelled copy was retired onto the door in the same pass.
- **The census's at-a-node needles are the WRITE/RESOLVE family
  (`setNodeMarkup` / `insertContentAt` / `nodeDOM` / `domAtPos`), NOT the
  read-only walks** — and that narrowing was measured, not assumed. Including
  `.descendants(` / `doc.forEach(` flags two genuine caret commits
  (`Editor.tsx`'s `archiveSelection`, `smart-insert.ts`'s prelude) whose
  declarations happen to walk the doc for an unrelated reason, and buying those
  off with exemptions would put two standing licences where the allowlist is
  supposed to be EMPTY.
- **Explicit `tr.scrollIntoView()` after a caret insert is a different mechanism
  and is out of scope.** The ~15 sites that spell it (`expex.ts`, the action
  registry, `smart-insert.ts`) move the caret onto their insert first, so they are
  scrolling the edit into view deliberately. This section governs the IMPLICIT
  scroll `focus()` schedules.

CI: [refocus-no-scroll.test.ts](../../../src/lib/tiptap/__tests__/refocus-no-scroll.test.ts)
drives the REAL heading NodeView — click the label chip, type, press Enter — with
the caret parked in a distant paragraph, and counts transactions carrying
ProseMirror's own `scrolledIntoView` flag. That flag IS the scroll request
(`Transaction#scrollIntoView()` sets it, `EditorView#updateState` acts on it), so
counting flagged transactions is counting scroll requests rather than a proxy for
them — which matters, because jsdom has no layout and `scrollTop` there is
synthetic. The CANARY leg fires a bare `focus()` through the identical harness and
requires the probe to see one, so a green defect leg can never mean "the probe is
blind"; a zero-rect `Range.getClientRects` shim keeps PM's scroll math from
THROWING in jsdom, which would abort the dispatch before the probe could read it.
**No pre-486 suite could see any of this**: `render-annot-bail.test.ts` drives the
same NodeView and asserts the ANNOTATION DOM, `structural-edit.test.ts` drives the
label WRITE one layer below the NodeView where the refocus does not exist, and
neither parks a caret anywhere or observes a transaction flag.

The leg with teeth is the CENSUS
([refocus-scroll-census.test.ts](../../../src/lib/tiptap/__tests__/refocus-scroll-census.test.ts))
— the door was never the part that could misbehave, a chrome commit that never
asks it is, and that type-checks perfectly. Population DISCOVERED across both
silos; region = the enclosing DECLARATION, brace-balanced with a hop out of
control statements (the stated limit `container-fit-guardrail` also carries: a
node resolve in one branch speaks for a focus in a sibling branch). Allowlist
EMPTY. Measured by neutering each half in turn: the pre-486 bare refocus takes 5
legs (3 behavioural + 2 census), reverting the Reader's Outline jump 2 census
legs, and re-spelling `Editor.tsx`'s copy by hand 2. The two control legs — a
same-label re-entry, and "focus STILL returns to the editor" — pass either way and
say so at the site.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live editor gesture,
no disk), so the check is cheap and real — click into a paragraph mid-document,
scroll somewhere else, add a label to a heading from its strip, and watch the
scroll hold still.
