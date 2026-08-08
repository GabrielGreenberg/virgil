// Container-fit guardrail (task 257) — the CI half of "a between-blocks insert
// asks the container what it can hold", in the same shape as the
// keystroke-sanctity, scroll-reposition, pane-drag, editor-observer,
// cross-window-storage, transient-highlight and applied-splice guards:
//
//   SOURCE-GREP ALLOWLIST — walk `src/components/drop-mode/` and flag every file
//   that inserts a NODE into a transaction (`tr.insert(` / `<x>Tr.insert(` /
//   `state.tr.insert(`). Every flagged file must also call `fitNodesAtInsert(`,
//   or sit on `PERMITTED_UNFITTED_INSERTS` with a justification.
//
// WHY this needs a guard rather than care. The bug it pins was invisible at all
// four call sites, because each one looked complete on its own terms:
//
//   • `text-range-move.ts` fit the drop context — for LISTS, via a hardcoded
//     `parentKind === "bulletList" || "orderedList"` literal. Correct, tested,
//     and silent about expex: a text selection released in an example's item gap
//     spliced a bare `paragraph` into `exampleItemList` (content `exampleItem+`),
//     and ProseMirror's fitter resolved the invalidity by SPLITTING the example
//     in two — both halves keeping the SAME uuid — with the moved text stranded
//     at top level between them.
//   • `textobject.ts` fit the drop context — via the registry adapters, which
//     know expex and the sub-object containers and nothing about lists. Same
//     tear, mirrored: a paragraph released in a list-item gap split the list.
//   • `util/block-move.ts` and `stack-pull.ts` asked nothing at all.
//
// Nothing threw. `tr.insert` at an invalid position doesn't fail — the fitter
// "succeeds" by reshaping the document around the payload, so the corruption
// surfaces later as a duplicated example/list with a duplicated uuid. A test of
// the fit function alone would not have caught any of this: the fit was never
// the part that misbehaved — the part that misbehaved was a call site that
// never asked. That is what this guard watches.
//
// Adding an entry to the allowlist is a claim that the insert CANNOT tear a
// container. Inline-atom placement qualifies (it inserts an inline node at an
// inline-cursor position inside a textblock — a different question entirely).
// A new BLOCK insert never does: route it through `fitNodesAtInsert`.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DROP_MODE = path.resolve(HERE, ".."); // src/components/drop-mode/

// ── The permitted unfitted-insert allowlist ─────────────────────────────────
// Each entry needs a one-line reason the insert cannot tear a container.
const PERMITTED_UNFITTED_INSERTS: Record<string, string> = {
  "util/inline-atom-move.ts":
    "INLINE atoms (footnote / citation / ref / inline math) placed at an " +
    "inline-cursor position inside a textblock — not a block-in-container " +
    "insert, so there is no wrap-or-refuse decision to make and no container " +
    "the fitter could split to accommodate them.",
};

/** A transaction node insert — the operation whose fit must be decided. */
export function detectNodeInsert(source: string): boolean {
  return /\b(?:tr|[A-Za-z]+Tr|state\.tr)\.insert\(/.test(source);
}

/** Does the file route that insert through the container-fit SSOT? */
export function usesContainerFit(source: string): boolean {
  return /\bfitNodesAtInsert\(/.test(source);
}

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "__tests__" || entry === "__fixtures__") continue;
      out.push(...walkSource(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function unfittedInserters(): string[] {
  return walkSource(DROP_MODE)
    .filter((f) => {
      const src = readFileSync(f, "utf8");
      return detectNodeInsert(src) && !usesContainerFit(src);
    })
    .map((f) => path.relative(DROP_MODE, f).split(path.sep).join("/"))
    .sort();
}

describe("container-fit guardrail — every block insert asks the container", () => {
  it("no drop-mode file inserts a node without routing through fitNodesAtInsert", () => {
    // If this fails: your insert can land at a position whose parent rejects the
    // node, and ProseMirror will make room by splitting the enclosing container
    // — tearing one node into two that both keep its uuid. Call
    // `fitNodesAtInsert(editor, insertPos, nodes)` (specs/drop-context.ts) and
    // dispatch NOTHING on a `reject`; a between-blocks move deletes its source
    // in the same transaction, so an unrepresentable insert is content loss.
    expect(unfittedInserters()).toEqual(
      Object.keys(PERMITTED_UNFITTED_INSERTS).sort(),
    );
  });

  it("every allowlist entry names a file that still exists and still inserts", () => {
    for (const rel of Object.keys(PERMITTED_UNFITTED_INSERTS)) {
      const full = path.join(DROP_MODE, rel);
      expect(() => statSync(full)).not.toThrow();
      expect(detectNodeInsert(readFileSync(full, "utf8"))).toBe(true);
    }
  });

  it("would flag the exact shapes that were fixed (regression fixtures)", () => {
    // The pre-257 range move: a list-only literal, then a bare insert.
    const oldRangeMove = `
      const parentKind = classifyParentAt(targetEditor, insertPos);
      if (parentKind === "bulletList" || parentKind === "orderedList") {
        const listItem = schema.nodes.listItem;
        if (listItem) nodes = nodes.map((n) => listItem.create(null, [n]));
      }
      for (const n of nodes) { tr.insert(cursor, n); cursor += n.nodeSize; }
    `;
    expect(detectNodeInsert(oldRangeMove)).toBe(true);
    expect(usesContainerFit(oldRangeMove)).toBe(false);

    // The pre-257 block-move factory: no context question at all.
    const oldBlockMove = `const insertTr = targetEditor.state.tr.insert(insertPos, node);`;
    expect(detectNodeInsert(oldBlockMove)).toBe(true);
    expect(usesContainerFit(oldBlockMove)).toBe(false);

    // …and the fitted form does not trip it.
    const fitted = `
      const fit = fitNodesAtInsert(targetEditor, insertPos, blocks);
      if (fit.kind === "reject") return;
      for (const n of fit.nodes) { tr.insert(cursor, n); cursor += n.nodeSize; }
    `;
    expect(detectNodeInsert(fitted)).toBe(true);
    expect(usesContainerFit(fitted)).toBe(true);
  });
});
