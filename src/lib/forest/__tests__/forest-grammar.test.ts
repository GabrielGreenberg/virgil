/**
 * Task 384 — the forest SUBSET grammar: what it accepts, and (the half with
 * teeth) that every refusal fires for the RIGHT reason.
 *
 * A refusal that fires for the wrong reason is a wrong message, and a wrong
 * message is worse than a bare one — it sends the user to change a byte that
 * was never the problem. So there is a leg PER unsupported construct class, and
 * each asserts the `kind` AND that the offending token is echoed back, rather
 * than merely asserting `ok === false` (which every one of them would satisfy
 * even if the parser refused for a completely different reason, or refused
 * everything).
 *
 * The accepted legs carry the same obligation in the other direction: each
 * names the shape it is defending, and the whole subset is swept so a future
 * whitelist growth cannot quietly narrow what already worked.
 */
import { describe, it, expect } from "vitest";
import {
  parseForestSource,
  describeForestRefusal,
  MAX_FOREST_DEPTH,
  MAX_FOREST_NODES,
  type ForestRefusalKind,
  type ForestRenderNode,
} from "@/lib/forest/grammar";

function env(body: string): string {
  return `\\begin{forest}\n${body}\n\\end{forest}`;
}

function accept(body: string): ForestRenderNode {
  const parse = parseForestSource(env(body));
  if (!parse.ok) {
    throw new Error(
      `expected the subset to ACCEPT ${JSON.stringify(body)}, refused: ${parse.refusal.message}`,
    );
  }
  return parse.tree;
}

function refusal(body: string) {
  const parse = parseForestSource(env(body));
  if (parse.ok) {
    throw new Error(`expected the subset to REFUSE ${JSON.stringify(body)}, it rendered`);
  }
  return parse.refusal;
}

/** The tree as bracket notation — comparing SHAPE rather than object graphs. */
function bracket(node: ForestRenderNode): string {
  const inner = node.children.map(bracket).join(" ");
  const roof = node.roofed ? "^" : "";
  return inner ? `[${node.labelText}${roof} ${inner}]` : `[${node.labelText}${roof}]`;
}

describe("the accepted subset", () => {
  it("reads the standard syntax tree", () => {
    const tree = accept("[S [NP [Det [the]] [N [dog]]] [VP [V [barks]]]]");
    expect(bracket(tree)).toBe("[S [NP [Det [the]] [N [dog]]] [VP [V [barks]]]]");
  });

  it("reads a tree written across lines, collapsing layout whitespace", () => {
    const tree = accept("[S\n  [NP]\n  [VP]\n]");
    expect(bracket(tree)).toBe("[S [NP] [VP]]");
  });

  it("reads a whole-env one-liner", () => {
    const parse = parseForestSource("\\begin{forest}[S [NP] [VP] ]\\end{forest}");
    expect(parse.ok).toBe(true);
  });

  it("carries inline math as a MATH segment, not as text", () => {
    const tree = accept("[$\\alpha$ [x]]");
    expect(tree.label).toEqual([{ kind: "math", value: "\\alpha" }]);
    expect(tree.labelText).toBe("$\\alpha$");
  });

  it("mixes text and math in one label", () => {
    const tree = accept("[DP$_i$ [t]]");
    expect(tree.label).toEqual([
      { kind: "text", value: "DP" },
      { kind: "math", value: "_i" },
    ]);
  });

  it("strips ONE level of a `{…}` group and keeps its commas as ink", () => {
    const tree = accept("[{NP, plural} [x]]");
    expect(tree.labelText).toBe("NP, plural");
    expect(tree.children).toHaveLength(1);
  });

  it("gives a braced group the SAME scanner — math inside it is still math", () => {
    const tree = accept("[{$\\alpha$, $\\beta$}]");
    expect(tree.label.filter((s) => s.kind === "math")).toHaveLength(2);
  });

  it("reads the char escapes as their literal characters", () => {
    expect(accept("[100\\% \\& more]").labelText).toBe("100% & more");
  });

  it("treats a line comment as inert wherever it starts", () => {
    const tree = accept("[S\n% a draft alternative\n  [NP]\n]");
    expect(bracket(tree)).toBe("[S [NP]]");
  });

  it("reads TeX's OWN comment rule — a MID-LINE `%` is not ink", () => {
    // The narrow line-leading rule would have rendered a node labelled
    // "S %draft", which forest labels "S". Silently-wrong pictures are the one
    // outcome this grammar exists to prevent, so this is a defect leg, not a
    // convenience.
    expect(accept("[S %draft\n  [NP]\n]").labelText).toBe("S");
    // …and an ESCAPED percent is still ink.
    expect(accept("[50\\% of cases]").labelText).toBe("50% of cases");
  });

  it("a comment that eats a delimiter refuses, exactly as forest would", () => {
    expect(refusal("[S % [NP] ]").kind).toBe("unbalanced");
  });

  it("accepts an empty label", () => {
    expect(accept("[ [a] [b] ]").labelText).toBe("");
  });
});

describe("roof", () => {
  it("collapses a roofed subtree into ONE base box holding its leaf text", () => {
    const tree = accept("[NP,roof [Det [the]] [N [dog]]]");
    expect(bracket(tree)).toBe("[NP [the dog^]]");
  });

  it("roofs a LEAF over its own label — the `[{the dog},roof]` idiom", () => {
    const tree = accept("[NP [{the dog},roof]]");
    expect(bracket(tree)).toBe("[NP [the dog^]]");
  });

  it("keeps a roofed base's MATH segments — the base is prose, not a string", () => {
    const tree = accept("[NP,roof [$\\alpha$] [b]]");
    const base = tree.children[0];
    expect(base.roofed).toBe(true);
    expect(base.label.some((s) => s.kind === "math")).toBe(true);
  });
});

describe("refusals — each names its own construct", () => {
  const CASES: {
    name: string;
    body: string;
    kind: ForestRefusalKind;
    token: string;
    /** Whether the SENTENCE echoes the token. False where the token is a bare
     *  delimiter and echoing it would be noise — the sentence still names the
     *  construct ("a second tree after the first"), which is the contract. */
    messageNames?: boolean;
  }[] = [
    {
      name: "a global preamble before the tree",
      body: "for tree={s sep=2cm}\n[S [NP]]",
      kind: "preamble",
      token: "for tree",
    },
    {
      name: "a `\\forestset` preamble",
      body: "\\forestset{default preamble={for tree={}}}\n[S]",
      kind: "preamble",
      token: "\\forestset",
    },
    {
      name: "an embedded `\\node`",
      body: "\\node {x};\n[S]",
      kind: "preamble",
      token: "\\node",
    },
    {
      name: "a non-whitelisted node option",
      body: "[S,l sep=2cm [NP]]",
      kind: "option",
      token: "l sep=2cm",
    },
    {
      name: "an edge spec option",
      body: "[S [NP, edge=dashed]]",
      kind: "option",
      token: "edge=dashed",
    },
    {
      name: "a LaTeX command in a label",
      body: "[\\textsc{np} [x]]",
      kind: "command",
      token: "\\textsc",
    },
    {
      name: "embedded TikZ in a label",
      body: "[S [\\draw (0,0) -- (1,1);]]",
      kind: "command",
      token: "\\draw",
    },
    {
      name: "unterminated inline math",
      body: "[$\\alpha [x]]",
      kind: "unterminated-math",
      token: "$",
    },
    {
      name: "a second root tree",
      body: "[S [NP]]\n[S [VP]]",
      kind: "multiple-roots",
      token: "[",
      messageNames: false,
    },
    {
      name: "content after the tree",
      body: "[S [NP]]\n\\draw (0,0);",
      kind: "trailing",
      token: "\\draw (0,0);",
    },
    {
      name: "an unbalanced bracket",
      body: "[S [NP]",
      kind: "unbalanced",
      token: "[",
    },
    {
      name: "text after a child node",
      body: "[S [NP] and more]",
      kind: "text-after-child",
      token: "and more",
    },
    {
      name: "a roof inside a roof",
      body: "[S,roof [NP,roof [x]]]",
      kind: "nested-roof",
      token: "roof",
    },
    {
      name: "an empty environment",
      body: "",
      kind: "empty",
      token: "",
    },
  ];

  for (const c of CASES) {
    it(`refuses ${c.name} and names it`, () => {
      const r = refusal(c.body);
      expect(r.kind).toBe(c.kind);
      if (c.token) expect(r.token).toContain(c.token);
      // The badge sentence is composed from the SAME pair, so the two can't
      // drift — and it must actually SAY something about this construct.
      expect(r.message).toBe(describeForestRefusal(c.kind, r.token));
      if (c.token && c.messageNames !== false) expect(r.message).toContain(c.token);
    });
  }

  it("refuses bytes that are not a forest environment at all", () => {
    const parse = parseForestSource("[S [NP]]");
    expect(parse.ok).toBe(false);
    if (!parse.ok) expect(parse.refusal.kind).toBe("delimiters");
  });

  it("points at the offending byte, not at the start of the source", () => {
    const source = env("[S\n  [NP, l sep=2cm]\n]");
    const parse = parseForestSource(source);
    expect(parse.ok).toBe(false);
    if (parse.ok) return;
    expect(source.slice(parse.refusal.offset)).toMatch(/^l sep=2cm/);
    // Line 3: `\begin{forest}` (1), `[S` (2), `  [NP, …` (3).
    expect(parse.refusal.line).toBe(3);
  });

  it("every refusal kind has a sentence of its own", () => {
    const kinds: ForestRefusalKind[] = [
      "delimiters",
      "empty",
      "preamble",
      "option",
      "command",
      "unterminated-math",
      "unbalanced",
      "multiple-roots",
      "trailing",
      "text-after-child",
      "too-deep",
      "too-large",
      "nested-roof",
    ];
    const messages = kinds.map((k) => describeForestRefusal(k, "TOKEN"));
    expect(new Set(messages).size).toBe(kinds.length);
    for (const m of messages) expect(m).not.toMatch(/^unsupported syntax$/);
  });
});

describe("bounds — the pod parses whatever is pasted into it", () => {
  it("refuses a tree nested past the depth bound instead of overflowing the stack", () => {
    const deep = "[".repeat(MAX_FOREST_DEPTH + 5) + "x" + "]".repeat(MAX_FOREST_DEPTH + 5);
    const r = refusal(deep);
    expect(r.kind).toBe("too-deep");
    expect(r.message).toContain(String(MAX_FOREST_DEPTH));
  });

  it("accepts a tree AT the depth bound — the bound is far past a real syntax tree", () => {
    const atBound = "[".repeat(MAX_FOREST_DEPTH + 1) + "x" + "]".repeat(MAX_FOREST_DEPTH + 1);
    expect(parseForestSource(env(atBound)).ok).toBe(true);
  });

  it("refuses a tree past the node bound, counting the WHOLE tree not one branch", () => {
    const wide = `[S ${"[x]".repeat(MAX_FOREST_NODES + 2)}]`;
    expect(refusal(wide).kind).toBe("too-large");
  });

  it("a very large but bounded tree still parses in well under a frame", () => {
    const wide = `[S ${"[x]".repeat(MAX_FOREST_NODES - 2)}]`;
    const t0 = Date.now();
    expect(parseForestSource(env(wide)).ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(50);
  });
});

describe("the refusal costs nothing", () => {
  it("is a pure function of the bytes — same source, same verdict", () => {
    const source = env("[S,foo [NP]]");
    const a = parseForestSource(source);
    const b = parseForestSource(source);
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (!a.ok && !b.ok) expect(a.refusal).toEqual(b.refusal);
  });
});
