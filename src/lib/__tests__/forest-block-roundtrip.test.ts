/**
 * Task 383 — `forestBlock`: a `\begin{forest}…\end{forest}` environment claimed
 * WHOLE, and the byte identity that claim rests on.
 *
 * The node's authoritative attr is `source`: the entire environment exactly as
 * read. So the contract is not "the renderer is faithful" — there is no
 * structured tree at the document layer to be faithful to — it is that the
 * bytes come back. Every leg therefore runs the REAL
 * `parseLatex` → `assignUuids` → `serializeBodyOnly` loop over TWO cycles:
 * cycle 1 is where a loss lands, cycle 2 is where an oscillation shows.
 *
 * The controls are the two shapes this node must never regress BELOW: the
 * generic unmodeled-env carrier it replaces (`align`), and an UNTERMINATED
 * `\begin{forest}`, which stays on that carrier by the task-356 fail-closed
 * rule.
 *
 * One leg is a DEFECT leg for a bug this node's own emission surfaced in a
 * shipped node one attr over — `texBlock` lost an interior 3+ newline run on
 * the first save, because `collapseBlankRuns`' recognizer only knows
 * `\begin{env}` shapes and a texBlock body sits between `%!vtex:` sentinels.
 * Both are fixed by the same declared-carry sentinel (`carriedSource`), which
 * is why they are pinned together.
 */
import { describe, it, expect } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import {
  serializeBodyOnly,
  assignUuids,
  extractSidecarData,
} from "@/lib/latex-serializer";
import type { JSONContent } from "@tiptap/core";

function cycle(body: string): { body: string; doc: JSONContent } {
  const doc = parseLatex(`\\begin{document}\n\n${body}\n\n\\end{document}\n`);
  assignUuids(doc);
  return { body: serializeBodyOnly(doc), doc };
}

function cycles(body: string, n: number): { body: string; doc: JSONContent }[] {
  const out: { body: string; doc: JSONContent }[] = [];
  let cur = body;
  for (let i = 0; i < n; i++) {
    const r = cycle(cur);
    out.push(r);
    cur = r.body;
  }
  return out;
}

function findByType(node: JSONContent, type: string): JSONContent | null {
  if (node.type === type) return node;
  for (const child of node.content ?? []) {
    const hit = findByType(child, type);
    if (hit) return hit;
  }
  return null;
}

/** Drop the trailing `%!v:xxxx` anchors the FIRST save mints, so a fixture can
 *  be compared against the bytes the user actually wrote. The anchor itself is
 *  asserted separately (and by attr, never by grep). */
function withoutAnchors(tex: string): string {
  return tex.replace(/ %!v:[0-9a-f]{4}/g, "");
}

function anchors(tex: string): string[] {
  return [...tex.matchAll(/%!v:([0-9a-f]{4})/g)].map((m) => m[1]);
}

const SIMPLE = "\\begin{forest}\n[S\n  [NP]\n  [VP]\n]\n\\end{forest}";

/** Every spelling the dispatcher can meet, with a body that is not trivially
 *  self-healing. Each must survive as its own bytes, in its own node. */
const SHAPES: { name: string; body: string }[] = [
  { name: "simple tree", body: SIMPLE },
  {
    name: "opener + tree on ONE line",
    body: "\\begin{forest}[S [NP] [VP] ]\\end{forest}",
  },
  {
    name: "MULTI-LINE opener (the arg-shape the carried-block recognizer cannot see)",
    body: "\\begin{forest}[Root\n  [Child]\n  [Other]\n]\n\\end{forest}",
  },
  {
    // CONTROL for the leg below: this opener IS followed by a newline, so
    // `CARRIED_BLOCK_RE` recognizes the block and the run survives even without
    // the declared carry. Kept so the pair localizes which half is doing the
    // work.
    name: "3+ blank run inside a newline-opener body",
    body: "\\begin{forest}\n[S\n\n\n  [NP]\n]\n\\end{forest}",
  },
  {
    // THE defect leg for the declared carry. A multi-line opener defeats the
    // recognizer twice over — its argument matcher requires the bracket to
    // close on the opener's own line, and its tail requires a newline before
    // `\end{…}` — so pre-383 the `\n{3,}` collapse ran straight over these
    // bytes and the user lost a blank line on the FIRST save, idempotently.
    name: "3+ blank run inside a MULTI-LINE opener",
    body: "\\begin{forest}[Root\n  [Child]\n\n\n  [Other]\n]\\end{forest}",
  },
  {
    name: "deeply nested brackets",
    body: "\\begin{forest}\n[S [NP [D [the]] [N [dog]]] [VP [V [ran]]]]\n\\end{forest}",
  },
  {
    name: "$math$ in labels",
    body: "\\begin{forest}\n[$\\alpha$ [$\\beta_1$] [$\\gamma^2$]]\n\\end{forest}",
  },
  {
    name: "straight quotes and double hyphens in a label (never typographied)",
    body: '\\begin{forest}\n[S [NP, name={the "big" one--here}]]\n\\end{forest}',
  },
  {
    name: "for-tree options on the opener",
    body: "\\begin{forest}\nfor tree={s sep=2mm}\n[S [NP] [VP]]\n\\end{forest}",
  },
];

describe("forestBlock — the environment is claimed WHOLE and comes back byte-identical", () => {
  it.each(SHAPES)("$name", ({ body }) => {
    const [c1, c2] = cycles(body, 2);
    // The user's bytes, exactly — and a FIXED POINT from cycle 1 (the anchors
    // the first save mints are the only thing that may differ from the input).
    expect(withoutAnchors(c1.body).trim()).toBe(body);
    expect(c2.body).toBe(c1.body);

    // It is a NODE, not a carrier paragraph — a byte assertion alone cannot
    // tell "claimed" from "carried", and every one of these bytes survived the
    // carrier too. That is the whole point of the stage.
    const node = findByType(c1.doc, "forestBlock");
    expect(node, "no forestBlock node — the env fell to the carrier").not.toBeNull();
    expect(node!.attrs?.source).toBe(body);

    // Identity is STABLE across cycles (the task-342 defect class): assert the
    // ATTR, never the presence of a `%!v:` line, per task 347's M4 lesson — a
    // dead marker stranded in the bytes matches a naive grep just as well.
    const first = findByType(c1.doc, "forestBlock")!.attrs?.uuid as string;
    const second = findByType(c2.doc, "forestBlock")!.attrs?.uuid as string;
    expect(first).toBeTruthy();
    expect(second).toBe(first);

    // No phantom blank block, and exactly one anchor.
    expect(c2.doc.content?.length).toBe(c1.doc.content?.length);
    expect(anchors(c2.body)).toEqual([first]);
  });

  it("CONTROL — an unmodeled env still rides the generic carrier", () => {
    const body = "\\begin{align}\nx &= 1\n\\end{align}";
    const [c1, c2] = cycles(body, 2);
    expect(withoutAnchors(c1.body).trim()).toBe(body);
    expect(c2.body).toBe(c1.body);
    expect(findByType(c1.doc, "forestBlock")).toBeNull();
  });

  it("a body whose brackets do not balance still ends at its OWN close", () => {
    // The leading `[` of a forest body is the TREE, not an option, so the
    // dispatcher must not spend its bracket scanner on it: on this shape the
    // scanner would run past `\end{forest}` looking for a `]` and the
    // terminator search would then start beyond the real close — folding the
    // two trees (and the prose between them) into one. Damage from malformed
    // input stays local.
    const bad = "\\begin{forest}[S\n\\end{forest}";
    const body = `${bad}\n\nBetween the trees.\n\n${SIMPLE}`;
    const [c1, c2] = cycles(body, 2);
    expect(c1.body).toContain("Between the trees.");
    expect(withoutAnchors(c1.body).trim()).toBe(body);
    expect(c2.body).toBe(c1.body);
    const kinds = c1.doc.content?.map((n) => n.type);
    expect(kinds).toEqual(["forestBlock", "paragraph", "forestBlock"]);
  });

  it("CONTROL — an UNTERMINATED opener stays on the carrier (task 356 fail-closed)", () => {
    const body = "\\begin{forest}\n[S [NP]]\n\nSome prose that must survive.";
    const [c1, c2] = cycles(body, 2);
    // Nothing is claimed, and — the half that matters — the tail is not
    // swallowed into an environment body.
    expect(findByType(c1.doc, "forestBlock")).toBeNull();
    expect(c1.body).toContain("Some prose that must survive.");
    expect(c2.body).toBe(c1.body);
  });

  it("surrounding prose is untouched, and the tree keeps its place", () => {
    const body = `Before the tree.\n\n${SIMPLE}\n\nAfter the tree.`;
    const [c1, c2] = cycles(body, 2);
    expect(withoutAnchors(c1.body).trim()).toBe(body);
    expect(c2.body).toBe(c1.body);
    expect(c1.doc.content?.map((n) => n.type)).toEqual([
      "paragraph",
      "forestBlock",
      "paragraph",
    ]);
  });
});

describe("forestBlock — where it may be claimed", () => {
  it("inside a blockquote (schema `block+`) — claimed", () => {
    const body = `\\begin{quote}\n${SIMPLE}\n\\end{quote}`;
    const [c1] = cycles(body, 2);
    const node = findByType(c1.doc, "forestBlock");
    expect(node).not.toBeNull();
    expect(node!.attrs?.source).toBe(SIMPLE);
  });

  it("inside a list item — claimed, and the item keeps a leading paragraph", () => {
    const body = `\\begin{itemize}\n  \\item Text.\n${SIMPLE}\n\\end{itemize}`;
    const [c1] = cycles(body, 2);
    const item = findByType(c1.doc, "listItem")!;
    expect(item.content?.[0]?.type).toBe("paragraph");
    const node = findByType(item, "forestBlock");
    expect(node).not.toBeNull();
    expect(node!.attrs?.source).toBe(SIMPLE);
  });

  it("inside an expex example body — NOT claimed, CARRIED (the schema has no slot)", () => {
    const body = `\\ex\nA tree follows.\n\n${SIMPLE}\n\\xe`;
    const [c1, c2] = cycles(body, 2);
    // `parseExampleBodyAsBlocks` filters against EXAMPLE_BODY_ACCEPTS, so a
    // forestBlock there falls to that function's byte-literal carrier — never
    // a node TipTap would silently drop (task 308).
    expect(findByType(c1.doc, "forestBlock")).toBeNull();
    expect(c1.body).toContain("\\begin{forest}");
    expect(c1.body).toContain("\\end{forest}");
    // And it is a fixed point rather than an oscillation.
    expect(c2.body).toBe(c1.body);
  });
});

describe("forestBlock — the sidecar attrs ride the shared source pod", () => {
  it("parTitle and collapsed survive a save → reload", () => {
    const doc = parseLatex(
      `\\begin{document}\n\n${SIMPLE}\n\n\\end{document}\n`,
    );
    assignUuids(doc);
    const node = findByType(doc, "forestBlock")!;
    node.attrs = { ...node.attrs, parTitle: "My tree", collapsed: true };
    const tex = serializeBodyOnly(doc);
    const sidecar = extractSidecarData(doc);
    const back = findByType(
      parseLatex(`\\begin{document}\n\n${tex}\n\n\\end{document}\n`, sidecar),
      "forestBlock",
    )!;
    expect(back.attrs?.parTitle).toBe("My tree");
    expect(back.attrs?.collapsed).toBe(true);
    // The title is a SIDECAR fact — it must never reach the `.tex`.
    expect(tex).not.toContain("My tree");
  });
});

describe("declared carried source — the emit-site half of never-tidy-carried-bytes", () => {
  // The DEFECT leg for the shipped sibling: `collapseBlankRuns`' recognizer
  // sees `\begin{env}…\end{env}` shapes only, so a texBlock body — which sits
  // between `%!vtex:` sentinels — lost one of its blank lines on the FIRST
  // save, silently and idempotently, in the node whose whole contract is
  // passthrough. Same fix as forestBlock's multi-line opener above.
  it("a texBlock body keeps a 3+ newline run", () => {
    const code = "\\draw a;\n\n\n\\draw b;";
    const doc: JSONContent = {
      type: "doc",
      content: [{ type: "texBlock", attrs: { code } }],
    };
    assignUuids(doc);
    const tex = serializeBodyOnly(doc);
    const back = findByType(
      parseLatex(`\\begin{document}\n\n${tex}\n\n\\end{document}\n`),
      "texBlock",
    )!;
    expect(back.attrs?.code).toBe(code);
  });

  it("no sentinel ever reaches the serialized output", () => {
    const body = `${SIMPLE}\n\n%!vtex:begin aaaa\n\\draw a;\n\n\n\\draw b;\n%!vtex:end aaaa`;
    const [c1, c2] = cycles(body, 2);
    for (const out of [c1.body, c2.body]) {
      expect(out).not.toContain("\u0000");
      expect(out).not.toContain("vcarry");
    }
  });
});
