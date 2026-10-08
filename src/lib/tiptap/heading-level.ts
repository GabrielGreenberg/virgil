/**
 * heading-level — the ONE rule for "make this block a level-N heading."
 *
 * THE CLASS (task 658): **two spellings of one operation, and only one of them
 * was ever told what a heading carries.**
 *
 * A heading in the main schema carries five attrs beyond its level
 * ({@link MAIN_STARTERKIT_NODE_ATTRS}.heading): `label` (its `\label{…}`),
 * `uuid` (its IDENTITY — what every card, marginalia marker and sidecar entry
 * is keyed on), `numbered` (its `*`), `sectionNumber`, and `shortTitle` (the
 * `\section[short]{…}` running head, task 376). Three of the five are text the
 * user typed into their `.tex`; the fourth is the anchor their cards hang from.
 *
 * `setBlockType(from, to, heading, { level, numbered: true })` — a LITERAL attr
 * object — is "rebuild this node from scratch": ProseMirror computes the new
 * node's attrs from that object alone, so every key it does not name falls back
 * to its default. That is the right verb for a genuine CONVERSION (a paragraph
 * becoming a heading has no heading attrs to keep) and the wrong verb whenever
 * the node already exists and the user is changing ONE of its properties.
 * Demoting an existing `\section*{Foo}\label{sec:foo}` from the BlockType
 * dropdown therefore dropped the label (dangling `\ref`s), dropped the short
 * title, forced `numbered: true` (renumbering every following section) and
 * re-minted the uuid (orphaning its cards) — silently, in the user's only copy.
 *
 * The chip's own type menu ({@link applyLevelChange} in `editor-extensions.ts`)
 * had the correct answer all along: spread the node's attrs and override the
 * level. This module is that answer, stated ONCE, so the three surfaces that
 * change a heading's level cannot drift again:
 *
 *   1. the heading-annotation chip's type menu  → {@link headingAttrsForLevel}
 *   2. the BlockType dropdown levels 1–4 + the slash `\chapter` / `\section` /
 *      `\subsection` / `\subsubsection` commands (both route through the
 *      registry's one `headingRun`) → {@link setHeadingLevelInRange}
 *   3. the BlockType dropdown's out-of-scope levels 0 / 5 / 6, which skip the
 *      registry → {@link setHeadingLevelInRange}
 *
 * **And the inverse, "make this heading a paragraph," is stated here too**
 * (task 1003) — {@link setParagraphInRange}, the one door behind both demote
 * surfaces:
 *
 *   4. the BlockType dropdown's "Body text" row (over the whole selection)
 *   5. the heading chip's type menu "No heading" (over its one heading)
 *
 * They had drifted the way the forward verb once had: "Body text" was gated on
 * TipTap's `isActive("heading")`, which for a range is true only when headings
 * cover ALL of it — so a selection from mid-heading into the paragraph below
 * did nothing, while "Section" on the same selection converted both blocks
 * (task 641 widened the forward verb to the range). The user could make a
 * range into headings but could not make it back.
 *
 * **Preserve by CONSTRUCTION, not by remembering the list.** The rule spreads
 * `node.attrs` rather than naming the keys, so the next attr added to
 * `MAIN_STARTERKIT_NODE_ATTRS.heading` is carried without an edit here — which
 * is the part that matters, because `sectionNumber` and `shortTitle` were both
 * added AFTER `headingRun` was written and that is exactly how the list drifted.
 *
 * Identity comes along for free: the uuid is simply one of the spread attrs, so
 * the new node answers to the old id and `block-uuid-backfill` sees a uuid whose
 * owner left the doc in the same batch (`removedUuids`) — a move, not a
 * duplicate — and keeps it. It does NOT rely on the backfill's re-parent
 * transfer, which refuses a same-type write by design
 * (`if (oldParent.node.type === newParent.node.type) return null;` — a same-type
 * in-place write is "the caller's own statement about that node").
 */
import type { Attrs, Node as PMNode, NodeType } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

/**
 * The attrs a textblock must carry after "make this a level-`level` heading".
 *
 * Already a heading → the user is changing ONE property of a node that exists:
 * keep everything else, verbatim, by spreading rather than by enumerating.
 * Any other textblock → a genuine conversion, with no heading attrs to keep:
 * the shipped defaults (`numbered: true`, the rest at their schema defaults).
 */
export function headingAttrsForLevel(
  node: PMNode,
  headingType: NodeType,
  level: number,
): Attrs {
  if (node.type === headingType) return { ...node.attrs, level };
  return { level, numbered: true };
}

/**
 * Set every convertible textblock in `[from, to]` to a heading of `level`,
 * preserving the attrs of those that are ALREADY headings.
 *
 * Mutates and returns `tr` (the `Transform` convention `setBlockType` itself
 * follows), so a caller can keep chaining. The per-node decision rides
 * `setBlockType`'s attrs-FUNCTION form, which ProseMirror calls once per
 * candidate node — so a mixed range (a paragraph and a heading selected
 * together) gets the right answer for each, which no single literal could give.
 *
 * Callers own their own container gate (`blockRangeHostsBlockInsert`); this is
 * the attr rule and the range walk, nothing else.
 */
export function setHeadingLevelInRange(
  tr: Transaction,
  from: number,
  to: number,
  headingType: NodeType,
  level: number,
): Transaction {
  return tr.setBlockType(from, to, headingType, (node) =>
    headingAttrsForLevel(node, headingType, level),
  );
}

/**
 * The attrs a heading carries INTO the paragraph it is demoted to: every attr
 * the two node types BOTH declare (today: `uuid`, its identity), by
 * intersection rather than by name — the forward rule's "spread, don't
 * enumerate", applied across a type change. Heading-only attrs (`label`,
 * `numbered`, …) have nowhere to go; paragraph-only ones (`parTitle`) take
 * their defaults.
 */
export function paragraphAttrsFromHeading(
  node: PMNode,
  paragraphType: NodeType,
): Attrs {
  const declared = paragraphType.spec.attrs ?? {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(declared)) {
    if (key in node.attrs) out[key] = node.attrs[key];
  }
  return out;
}

/**
 * Demote every HEADING in `[from, to]` to a paragraph, leaving every other
 * node untouched — the inverse of {@link setHeadingLevelInRange}.
 *
 * Converting only headings is the whole point: a plain `setBlockType(from, to,
 * paragraph)` (TipTap's `setParagraph()`) would also retype every OTHER
 * textblock in the range — a code block, a comment line — which is the
 * container class tasks 147/149 closed. Because only headings are touched, a
 * range holding none is a natural no-op and no container gate is needed.
 *
 * Identity is carried by construction ({@link paragraphAttrsFromHeading}), not
 * left to `block-uuid-backfill`'s re-parent transfer. Mutates and returns `tr`.
 */
export function setParagraphInRange(
  tr: Transaction,
  from: number,
  to: number,
  paragraphType: NodeType,
): Transaction {
  const headings: number[] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === "heading") headings.push(pos);
    return !node.isTextblock;
  });
  for (const pos of headings) {
    const at = tr.mapping.map(pos);
    tr.setBlockType(at, at + 1, paragraphType, (node) =>
      paragraphAttrsFromHeading(node, paragraphType),
    );
  }
  return tr;
}
