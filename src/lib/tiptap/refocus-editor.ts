import type { Editor } from "@tiptap/react";

/**
 * # A REFOCUS is a focus, not a navigation
 *
 * TipTap's `focus()` command does two things, and only one of them is in its
 * name. Besides taking DOM focus it schedules — inside a `requestAnimationFrame`
 * — an `editor.commands.scrollIntoView()`, because its `scrollIntoView` option
 * defaults to `true`. That deferred scroll targets whatever the SELECTION is by
 * the time the frame runs.
 *
 * For a caret commit that is exactly right: the user typed or clicked at the
 * caret, the edit happened at the caret, and scrolling the caret into view is
 * scrolling the edit into view. Every `chain().focus().toggleBold()` /
 * `.insertContent(…)` / `.setTextSelection(edit)…` site in the app is that
 * shape, and they are deliberately left alone.
 *
 * A CHROME commit is not that shape. The heading label strip, a NodeView's
 * input, a float-side control — each edits **at a node** resolved by uuid or
 * position, while the caret sits wherever the user last left it, often pages
 * away. There the default `focus()` is a navigation nobody asked for: it drags
 * the document to a stale caret the moment the label is committed (task 486,
 * Gabriel: *"after you add a label to a section, the scroll jumps"*).
 *
 * So the two intents get two spellings, and this is the one for "give the
 * editor its focus back and leave the document where it is":
 *
 * ```ts
 * refocusEditor(nodeEditor);   // focus, no scroll
 * ```
 *
 * This is the standalone twin of the chain-prelude form that
 * [insert-inline-atom.ts](insert-inline-atom.ts) already roots for inline-atom
 * creation (`chain().focus(null, { scrollIntoView: false })`) — the same rule,
 * arriving at a commit that has no chain to hang it on.
 *
 * ## What this is NOT
 *
 * It is not a way to suppress a scroll the user WANTS. A commit that should
 * take the reader somewhere performs that scroll EXPLICITLY — and, per the
 * reposition policy (task 328), through `mayReposition` / the necessity-gated
 * doors in `layout-scroll.ts` rather than as a side effect of focusing. The
 * Reader's Outline jump is the shape: `refocusEditor` + `setTextSelection` +
 * its own `scrollIntoView`, so there is exactly ONE scroll instead of an
 * implicit one racing the intended one.
 *
 * Note also that `editor.view.focus()` (raw ProseMirror) never scrolls — it
 * focuses with `preventScroll` — so the drop-mode / NodeView sites that already
 * spell `view.focus()` are correct as they stand and need no door.
 *
 * CI: [refocus-scroll-census.test.ts](__tests__/refocus-scroll-census.test.ts).
 */
export function refocusEditor(editor: Editor | null | undefined): void {
  // `position: null` = keep the current selection; `scrollIntoView: false`
  // suppresses the deferred frame that would otherwise chase it.
  editor?.commands.focus(null, { scrollIntoView: false });
}
