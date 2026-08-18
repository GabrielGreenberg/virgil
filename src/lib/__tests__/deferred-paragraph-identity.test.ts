// Task 346 — "an inner paragraph defers its identity to its container" was ONE
// rule with TWO member lists, and each side's doc comment asserted the other
// implemented it.
//
// `DEFERRING_PARENTS` (declared in `anchor-uuid.ts`) listed five containers and
// promised their inner-paragraph uuids are "stripped at serialization". The
// `.tex` layer cannot import that module, so `latex-serializer.ts` re-typed the
// rule as a `CONTAINER_TYPES` literal — in `assignUuids`, in `needsUuidWork`
// and in `recoverOrphanedUuids` — and none of the three ever gained
// `exampleItem`/`exampleBlock`.
//
// The bytes were always stable, so no round-trip suite could see it. What broke
// was IDENTITY, and it is visible only across CYCLES:
//
//   prose / itemize / quote   gate [true,false,false]   no churn
//   \ex  / \pex               gate [true,true,true ]    inner paragraph
//                                                        re-minted EVERY parse
//
// Hence the shape here: every leg runs the REAL parse → assignUuids →
// serialize loop three times and compares uuids BY STRUCTURAL PATH, because a
// churning uuid is not a byte difference and a single cycle cannot show one.
// The modelled containers run through the identical harness as passing
// CONTROLS, so no leg can pass by having broken identity everywhere.
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import {
  serializeToLatex,
  assignUuids,
  needsUuidWork,
} from "@/lib/latex-serializer";
import { DEFERRING_PARENTS, deferringParent } from "@/lib/node-attr-sets";

const doc = (body: string) =>
  `\\documentclass{article}\n\\usepackage{expex}\n\n\\begin{document}\n\n${body}\n\n\\end{document}\n`;

/** uuid by STRUCTURAL PATH — a churn shows as one path changing value. */
function uuidsByPath(node: JSONContent): Record<string, string> {
  const out: Record<string, string> = {};
  const seen = new Map<string, number>();
  function walk(n: JSONContent, path: string) {
    const base = `${path}>${n.type}`;
    const n2 = (seen.get(base) ?? 0) + 1;
    seen.set(base, n2);
    const key = n2 === 1 ? base : `${base}#${n2}`;
    if (n.attrs?.uuid) out[key] = n.attrs.uuid as string;
    n.content?.forEach((c) => walk(c, base));
  }
  walk(node, "doc");
  return out;
}

/** Every `paragraph` whose IMMEDIATE parent defers, by path. */
function deferredParagraphPaths(node: JSONContent): string[] {
  const out: string[] = [];
  function walk(n: JSONContent, path: string, parentType: string | null) {
    const p = `${path}>${n.type}`;
    if (n.type === "paragraph" && deferringParent(parentType)) out.push(p);
    n.content?.forEach((c) => walk(c, p, n.type ?? null));
  }
  walk(node, "doc", null);
  return out;
}

interface Run {
  gate: boolean[];
  churn: string[];
  deferredWithUuid: string[];
}

function threeCycles(tex: string): Run {
  const gate: boolean[] = [];
  const snaps: Record<string, string>[] = [];
  const deferredWithUuid: string[] = [];
  let src = tex;
  for (let i = 0; i < 3; i++) {
    const parsed = parseLatex(src);
    gate.push(needsUuidWork(parsed));
    assignUuids(parsed);
    snaps.push(uuidsByPath(parsed));
    // After assignUuids, no deferred paragraph may hold a uuid — that IS the
    // invariant `anchor-uuid.ts` documents.
    const byPath = uuidsByPath(parsed);
    for (const p of deferredParagraphPaths(parsed)) {
      if (byPath[p]) deferredWithUuid.push(`cycle${i}:${p}`);
    }
    src = serializeToLatex(parsed, extractPreambleAndPostamble(src) ?? undefined);
  }
  const keys = new Set(snaps.flatMap((s) => Object.keys(s)));
  const churn = [...keys].filter((k) => new Set(snaps.map((s) => s[k])).size > 1);
  return { gate, churn, deferredWithUuid };
}

/**
 * One fixture per DEFERRING_PARENTS member that can actually hold a paragraph,
 * plus the modelled controls. `codeBlock`'s content is text rather than
 * paragraphs, so it has no fixture and the coverage leg below says so — an
 * exemption stated rather than a member quietly missing.
 */
const FIXTURES: Record<string, string> = {
  listItem: "\\begin{itemize}\n\\item An item body.\n\\end{itemize}",
  blockquote: "\\begin{quote}\nQuoted prose.\n\\end{quote}",
  exampleBlock: "\\ex\nSingle example body.\n\\xe",
  exampleItem: "\\pex\n\\a First sub-item.\n\\a Second sub-item.\n\\xe",
};
const NO_PARAGRAPH_CHILD = new Set(["codeBlock"]);

describe("every DEFERRING_PARENTS member is swept (no hand list in the test)", () => {
  it("every member either has a fixture or is declared paragraph-less", () => {
    const missing = [...DEFERRING_PARENTS].filter(
      (m) => !(m in FIXTURES) && !NO_PARAGRAPH_CHILD.has(m),
    );
    expect(missing, "a new deferring container shipped untested").toEqual([]);
  });

  for (const [member, body] of Object.entries(FIXTURES)) {
    it(`${member}: its inner paragraph holds NO uuid and nothing churns`, () => {
      const run = threeCycles(doc(body));
      expect(run.deferredWithUuid, "a deferred paragraph kept a uuid").toEqual([]);
      expect(run.churn, "identity is not stable across parses").toEqual([]);
    });

    it(`${member}: the save-path gate reaches a fixed point`, () => {
      // The leg with teeth. `needsUuidWork` is what both backends consult
      // before deep-copying the doc and running `assignUuids` at all, so a fix
      // that heals the mutator and leaves the gate behind is unreachable in
      // production — task 343's lesson, one function over.
      const { gate } = threeCycles(doc(body));
      expect(gate.slice(1), `${member} never settles`).toEqual([false, false]);
    });
  }
});

describe("controls · the modelled containers were always correct", () => {
  const CONTROLS: Record<string, string> = {
    prose: "Just prose here.",
    itemize: "\\begin{itemize}\n\\item One.\n\\end{itemize}",
    quote: "\\begin{quote}\nQuoted.\n\\end{quote}",
  };
  for (const [name, body] of Object.entries(CONTROLS)) {
    it(`${name} still settles with no churn`, () => {
      const run = threeCycles(doc(body));
      expect(run.churn).toEqual([]);
      expect(run.gate.slice(1)).toEqual([false, false]);
      expect(run.deferredWithUuid).toEqual([]);
    });
  }

  it("a TOP-LEVEL paragraph still gets its own uuid", () => {
    // The direction that would break if the rule were read too widely: only a
    // paragraph whose IMMEDIATE parent defers loses its identity.
    const parsed = parseLatex(doc("Top-level prose."));
    assignUuids(parsed);
    const paths = uuidsByPath(parsed);
    expect(Object.keys(paths).some((k) => k.endsWith(">paragraph"))).toBe(true);
  });

  it("an example's NON-paragraph children keep their own identity", () => {
    // `exampleBlock` defers only its direct `paragraph` children. An
    // `exampleItemList`/`exampleItem` underneath must still be anchorable, or
    // the fix would have traded one identity bug for a worse one.
    const parsed = parseLatex(doc("\\pex\n\\a One.\n\\a Two.\n\\xe"));
    assignUuids(parsed);
    const paths = uuidsByPath(parsed);
    const items = Object.keys(paths).filter((k) => k.includes(">exampleItem"));
    expect(items.length).toBeGreaterThanOrEqual(2);
  });
});

describe("the rule is asked of the IMMEDIATE parent, not an inherited flag", () => {
  it("an exampleItem's paragraph defers although exampleItemList sits above it", () => {
    // Why adding the two names to the old literal would NOT have been enough:
    // the serializer inherited an "am I inside a container" flag, and
    // `exampleItemList` — a real structural node between `exampleBlock` and its
    // `exampleItem`s — is not a container name, so the flag reset there.
    const parsed = parseLatex(doc("\\pex\n\\a One.\n\\xe"));
    assignUuids(parsed);
    const deferred = deferredParagraphPaths(parsed);
    expect(
      deferred.some((p) => p.includes("exampleItemList>exampleItem>paragraph")),
      "the nested item's paragraph was not recognised as deferred",
    ).toBe(true);
    const byPath = uuidsByPath(parsed);
    for (const p of deferred) expect(byPath[p]).toBeUndefined();
  });
});
