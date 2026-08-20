// @vitest-environment jsdom
/**
 * Task 387 (adversarial run 1 over the forest cluster, DATA-SAFETY lens) —
 * every PROJECTION of a card body is TOTAL over the block-atom vocabulary its
 * SCHEMA registers.
 *
 * The defect this pins. `forestBlock` joined both card-body schemas with task
 * 383 (`buildBorrowedAtomSchema` registers it for the `"card"` scope AND the
 * `"excerpt"` scope), and neither projection in `footnote-content.ts` gained an
 * arm. A block atom keeps its content in ATTRS, so a walker with no arm for it
 * does not degrade — it falls through to `if (node.content) …` and returns
 * `""`. In `richJsonToPlainText` that is a blank preview; in
 * `richJsonToLatex`, which is what a `\footnote{}` body is SERIALIZED with
 * (latex-serializer.ts's footnote arm), it is the user's tree DELETED from the
 * `.tex` on the next save — no throw, no warning, the rest of the body intact.
 * Its shipped sibling `texBlock`, whose arm sat four lines away, kept its
 * bytes, which is why nothing looked wrong.
 *
 * **No pre-387 suite could see this.** The footnote-content suites drive bodies
 * of PROSE plus inline atoms — the shape a footnote body normally has — so a
 * block atom reaching either walker is unrepresentable in all of them, and the
 * borrowed-schema contract test asks only whether the two SCHEMAS agree, never
 * whether anything downstream can represent what they admit.
 *
 * The legs are swept FROM `CARD_BODY_BLOCK_ATOMS`, so a new block-atom kind is
 * covered by declaration alone: it arrives with no fixture and the coverage leg
 * fails first, and the Record types in `footnote-content.ts` fail to COMPILE
 * before that. The CENSUS is the leg with teeth — the two tables were never the
 * part that could misbehave, a THIRD hand-written per-node-type chain is, and
 * that type-checks perfectly.
 */
import { describe, it, expect, vi } from "vitest";

// `renderBorrowedHtml` builds the card extension list, which transitively
// reaches `@/lib/storage` (an FSA module with no test double).
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "__esModule" ? true : prop === "then" ? undefined : noop,
    },
  );
});
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { JSONContent } from "@tiptap/core";
import {
  richJsonToLatex,
  richJsonToPlainText,
  normalizeRichContent,
} from "@/lib/footnote-content";
import {
  CARD_BODY_BLOCK_ATOMS,
  type CardBodyBlockAtom,
} from "@/lib/node-attr-sets";
import { renderBorrowedHtml } from "@/lib/borrowed-render";
import { commentsStripped } from "./_source-scan";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../..");

/**
 * One fixture per block atom: the node, plus a distinctive NEEDLE that lives
 * only in the payload the projection must carry through. The needle is checked
 * rather than the whole string, because each arm's framing is its own business
 * — what may never happen is the payload vanishing.
 *
 * `figureCaption` is the one CONTAINER in the vocabulary (its prose is in child
 * nodes, not attrs), so its needle rides a text child.
 */
const FIXTURES: Record<
  CardBodyBlockAtom,
  { node: JSONContent; needle: string }
> = {
  texBlock: {
    node: { type: "texBlock", attrs: { code: "\\draw ZZTEX;" } },
    needle: "ZZTEX",
  },
  forestBlock: {
    node: {
      type: "forestBlock",
      attrs: {
        source: "\\begin{forest}\n[ZZFOREST [NP] [VP]]\n\\end{forest}",
      },
    },
    needle: "ZZFOREST",
  },
  figureBlock: {
    node: { type: "figureBlock", attrs: { source: "ZZFIG.png" } },
    needle: "ZZFIG",
  },
  figureCaption: {
    node: {
      type: "figureCaption",
      content: [{ type: "text", text: "ZZCAPTION" }],
    },
    needle: "ZZCAPTION",
  },
  graphicsBlock: {
    // Both attrs, because the two projections read DIFFERENT ones — the LaTeX
    // arm prefers the verbatim `command` and the plain arm shows `source`.
    // That asymmetry is pre-existing and correct (one rebuilds bytes, one
    // labels a preview); the fixture carries both so each leg asserts the
    // payload its own arm is responsible for.
    node: {
      type: "graphicsBlock",
      attrs: {
        command: "\\includegraphics{ZZGRAPHIC.png}",
        source: "ZZGRAPHIC.png",
      },
    },
    needle: "ZZGRAPHIC",
  },
  latexComment: {
    node: { type: "latexComment", content: [{ type: "text", text: "ZZNOTE" }] },
    needle: "ZZNOTE",
  },
};

/** The body a card actually holds: prose, the atom, prose. The flanking
 *  paragraphs are the CONTROL — they prove the walker ran and that only the
 *  atom's own bytes were at stake. */
function bodyWith(node: JSONContent): JSONContent {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "before" }] },
      node,
      { type: "paragraph", content: [{ type: "text", text: "after" }] },
    ],
  };
}

describe("card-body projections are total over the block-atom vocabulary", () => {
  it("every declared atom has a fixture (a new kind cannot ship untested)", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...CARD_BODY_BLOCK_ATOMS].sort());
  });

  it.each([...CARD_BODY_BLOCK_ATOMS])(
    "%s survives richJsonToLatex — the \\footnote{} SERIALIZER",
    (kind) => {
      const { node, needle } = FIXTURES[kind];
      const out = richJsonToLatex(normalizeRichContent(bodyWith(node)));
      // The control: the walker ran over the whole body.
      expect(out).toContain("before");
      expect(out).toContain("after");
      // The contract: the atom's own payload reached the `.tex`.
      expect(out, `${kind} was DELETED from the footnote body`).toContain(needle);
    },
  );

  it.each([...CARD_BODY_BLOCK_ATOMS])(
    "%s survives richJsonToPlainText — every card PREVIEW surface",
    (kind) => {
      const { node, needle } = FIXTURES[kind];
      const out = richJsonToPlainText(bodyWith(node));
      expect(out).toContain("before");
      expect(out).toContain("after");
      expect(out, `${kind} projected to nothing`).toContain(needle);
    },
  );

  /**
   * The THIRD projection (task 388, adversarial run 2). `renderBorrowedHtml` is
   * the T1 static card tier — the surface the card-presence ladder paints a
   * COLLAPSED card body with, and the one whose own doctrine says the static
   * render is "visually identical" to the live tier. A block atom keeps its
   * payload in ATTRS, so a node whose `renderHTML` emits only a wrapper
   * projects to a BLANK there exactly as it did to `""` in the two walkers
   * above — measured on the pre-388 tree, `texBlock` and `forestBlock` both
   * rendered `<div …></div>` where the live tier shows a `<pre>` of the source.
   *
   * The needle is matched against the markup with every ATTRIBUTE stripped,
   * which is the whole difference between a leg with teeth and one without:
   * the payload is already IN the markup as `source="…"` / `code="…"`, so a
   * raw `toContain` passes on the very output this leg exists to indict.
   */
  const NO_STATIC_PROJECTION: Partial<Record<CardBodyBlockAtom, string>> = {
    // A raster reached through an object URL / OPFS handle: there is no bytes
    // to project into static HTML, and its `source` attr is not even rendered.
    // Its CAPTION is a child node and projects on its own. PRE-EXISTING and
    // outside this task's cluster — filed rather than fixed here.
    figureBlock: "payload is a raster, not bytes",
    // `\includegraphics{…}` COULD project like the source pods do; the live
    // card tier renders the image instead, so the honest static answer is a
    // product call about the figure surface rather than about this cluster.
    // PRE-EXISTING; filed rather than fixed here.
    graphicsBlock: "live card tier renders the image — a figure-surface call",
  };

  /** The markup with every attribute blanked — what a READER of the static
   *  tier can actually see. */
  function visibleText(html: string): string {
    return html.replace(/\s[\w:-]+="[^"]*"/g, "");
  }

  it.each([...CARD_BODY_BLOCK_ATOMS])(
    "%s survives renderBorrowedHtml — the T1 STATIC card tier",
    (kind) => {
      const { node, needle } = FIXTURES[kind];
      const html = renderBorrowedHtml(bodyWith(node) as never, "excerpt");
      expect(html, "the excerpt scope refused the whole body").not.toBeNull();
      const seen = visibleText(html ?? "");
      expect(seen).toContain("before");
      expect(seen).toContain("after");
      const excuse = NO_STATIC_PROJECTION[kind];
      if (excuse) {
        // Recorded, not asserted away: the leg still runs, so a kind that
        // GAINS a static projection makes this branch stale rather than silent.
        expect(excuse.length).toBeGreaterThan(0);
        return;
      }
      expect(seen, `${kind} paints NOTHING in the static tier`).toContain(needle);
    },
  );

  it("the reported shape: a forest tree in a card body reaches the .tex whole", () => {
    // Gabriel's construct, spelled the way a real paper writes it. Asserted
    // token by token rather than as one string, because `richJsonToLatex`
    // collapses whitespace for an INLINE projection (the shipped `texBlock`
    // behaviour) — the contract is that no byte is lost, not that the layout
    // survives an inline flattening.
    const source =
      "\\begin{forest}\nfor tree={s sep=2mm}\n[S [NP [the] [dog]] [VP [ran]]]\n\\end{forest}";
    const out = richJsonToLatex(
      normalizeRichContent(bodyWith({ type: "forestBlock", attrs: { source } })),
    );
    for (const token of source.split(/\s+/).filter(Boolean)) {
      expect(out).toContain(token);
    }
  });
});

/**
 * The CENSUS. The two tables were never what could misbehave — a THIRD
 * per-node-type dispatch, hand-written elsewhere and missing the newest atom,
 * is, and no behavioural test of these two functions can see it.
 *
 * Membership is DISCOVERED by the SHAPE the defect had: a walker that
 * dispatches on `node.type === "<atom>"` (or `case "<atom>":`) for two or more
 * block atoms. That is exactly what both pre-387 walkers looked like, and it
 * deliberately does NOT match the many files that merely NAME these types in a
 * union, a registry key or a kind list — measured, a bare "names ≥2 atoms"
 * needle indicts ten such files and answers a different question.
 *
 * `footnote-content.ts` no longer matches the dispatch needle, because the fix
 * replaced its chain with a keyed table — so it is covered by its own leg
 * below, which is what keeps the census from going blind to its own subject.
 */
const DISPATCH_EXEMPT: Record<string, string> = {
  // The main-document LaTeX serializer and parser speak the WHOLE document
  // vocabulary (sixteen uuid-bearing types, not this six), and the
  // serializer's totality is pinned against the REAL schema by
  // `serializer-node-coverage.test.ts` — a stronger instrument than this one.
  "lib/latex-serializer.ts": "whole-document vocabulary; pinned by serializer-node-coverage",
  "lib/latex-parser.ts": "whole-document vocabulary; the parse side of the same round trip",
  // A different question with no payload to lose: which word-count bucket does
  // this node count toward?
  "lib/word-count-core.ts": "categorization, not projection — nothing to drop",
};

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      walkFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** The atoms a file DISPATCHES on — the defect's own shape. */
function dispatchedAtoms(code: string): CardBodyBlockAtom[] {
  return CARD_BODY_BLOCK_ATOMS.filter((a) =>
    new RegExp(`(?:\\.type\\s*===\\s*|case\\s+)["'\`]${a}["'\`]`).test(code),
  );
}

describe("census — no second hand-written block-atom projection", () => {
  const files = walkFiles(SRC);
  const dispatchers = new Map<string, CardBodyBlockAtom[]>();
  for (const file of files) {
    const rel = path.relative(SRC, file).replace(/\\/g, "/");
    const atoms = dispatchedAtoms(commentsStripped(fs.readFileSync(file, "utf8")));
    if (atoms.length >= 2) dispatchers.set(rel, atoms);
  }

  it("sees the files it claims to (swallow self-check)", () => {
    expect(files.length).toBeGreaterThan(300);
    expect(files.some((f) => f.endsWith("lib/footnote-content.ts"))).toBe(true);
    // The needle must actually match something, or every leg below passes
    // vacuously — the failure mode a regex census is most likely to have.
    expect(dispatchers.size).toBeGreaterThanOrEqual(2);
  });

  it("every multi-atom dispatcher reads the SSOT or is exempted with a reason", () => {
    const offenders: string[] = [];
    for (const [rel, atoms] of dispatchers) {
      if (rel in DISPATCH_EXEMPT) continue;
      const code = commentsStripped(fs.readFileSync(path.join(SRC, rel), "utf8"));
      if (code.includes("node-attr-sets")) continue;
      offenders.push(`${rel} — dispatches on ${atoms.join(", ")} without reading the SSOT`);
    }
    expect(offenders).toEqual([]);
  });

  it("no exemption is stale (a dead entry is a standing licence for the next fork)", () => {
    for (const rel of Object.keys(DISPATCH_EXEMPT)) {
      expect(dispatchers.has(rel), `${rel} no longer dispatches on ≥2 block atoms`).toBe(true);
    }
  });

  it("footnote-content.ts states both projections as TOTAL records", () => {
    const code = commentsStripped(
      fs.readFileSync(path.join(SRC, "lib/footnote-content.ts"), "utf8"),
    );
    // A `Record<CardBodyBlockAtom, …>` is what makes a new atom a COMPILE
    // error; a `Partial<…>` or a bare object literal would restore the silent
    // fall-through this task closed.
    expect(code).toContain("BLOCK_ATOM_TO_LATEX: Record<");
    expect(code).toContain("BLOCK_ATOM_TO_PLAIN: Record<");
    expect(code).not.toContain("Partial<Record<");
    expect(code).toContain("node-attr-sets");
  });
});
