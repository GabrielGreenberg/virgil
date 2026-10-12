/**
 * The ONE door for the attrs of an `exampleBlock` that Virgil MINTS or
 * RESHAPES (task 1076).
 *
 * Two of an example's attrs are not free choices, and every path that made one
 * by hand got one of them wrong:
 *
 *  - `dialect` is a fact about the PAPER (expex vs linguex). A mint that names
 *    no dialect silently takes the schema default (expex), so the keymaps'
 *    Enter-escape and Shift-Tab promote wrote `\ex … \xe` into linguex papers.
 *    `freshExampleBlockAttrs` makes it a REQUIRED argument — the caller says
 *    where it came from (the block being escaped/promoted from, or
 *    `dominantExampleDialect` for a free-standing insert).
 *  - `kind` is a fact about the CONTENT: an `exampleItemList` child ⇒ `multi`
 *    (`\pex`), none ⇒ `single` (`\ex`). It is DERIVED (`exampleKindOf`), never
 *    passed as an independent argument, and a reshape that adds or removes an
 *    item list re-derives it in place (`reconcileExampleKind`) — the
 *    Enter-escape that deleted the last list but left `kind: "multi"` (a
 *    `\pex` with no parts) is the defect this retires.
 */
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { ExampleDialect } from "./example-dialect";

export type ExampleKind = "single" | "multi";

/** `kind` derived from an example block's child type names. */
export function exampleKindOf(childTypeNames: readonly string[]): ExampleKind {
  return childTypeNames.includes("exampleItemList") ? "multi" : "single";
}

/** `kind` derived from an example block's (or would-be block's) PM children. */
export function exampleKindOfContent(children: readonly PMNode[]): ExampleKind {
  return exampleKindOf(children.map((c) => c.type.name));
}

/** The full attr set of a freshly minted example block. Every field a mint
 *  must state is an argument; the rest are the blank defaults. */
export function freshExampleBlockAttrs(opts: {
  uuid: string;
  dialect: ExampleDialect;
  kind: ExampleKind;
}): Record<string, unknown> {
  return {
    uuid: opts.uuid,
    kind: opts.kind,
    tag: "",
    label: "",
    exnoOverride: null,
    suppressSpace: false,
    dialect: opts.dialect,
    number: 0,
  };
}

/** After a reshape, make the example block at `pos` (in `tr.doc`) carry the
 *  `kind` its content implies. No-op when `pos` is not an example block or the
 *  kind already agrees. */
export function reconcileExampleKind(tr: Transaction, pos: number): void {
  const node = tr.doc.nodeAt(pos);
  if (!node || node.type.name !== "exampleBlock") return;
  const children: PMNode[] = [];
  node.forEach((c) => children.push(c));
  const kind = exampleKindOfContent(children);
  if (node.attrs.kind === kind) return;
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, kind });
}
