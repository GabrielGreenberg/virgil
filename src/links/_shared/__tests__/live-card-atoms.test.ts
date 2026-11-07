/**
 * Task 1508 — the `src/links` liveness walkers read a Card-bearing atom's id
 * through the atom registry's ONE door (`cardAtomIdOf`), so they and
 * DocStructure cannot give two answers to "what is this atom's id", and a
 * third Card-bearing atom is covered with no edit under `src/links`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import {
  CARD_ATOM_ID_ATTRS,
  CARD_ATOM_MIRROR_ID_ATTR,
  CARD_ATOMS,
} from "@/lib/tiptap/atom-registry";
import { cardAtomIdOf } from "@/lib/tiptap/doc-structure/entity-extractor";
import { commentsStripped, trackedFiles } from "@/lib/__tests__/_source-scan";
import { forEachCardAtom, liveCardAtomIds } from "../live-card-atoms";

const atomNodes = Object.fromEntries(
  CARD_ATOMS.map((m) => [
    m.nodeName,
    {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { [m.idAttr]: { default: "" }, [CARD_ATOM_MIRROR_ID_ATTR]: { default: "" } },
      toDOM: () => ["span", 0] as const,
    },
  ]),
);

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0] },
    text: { group: "inline" },
    ...atomNodes,
  },
});

function docOf(...atoms: PMNode[]): PMNode {
  return schema.nodes.doc.create({}, schema.nodes.paragraph.create({}, [schema.text("x"), ...atoms]));
}

describe("live card atoms read the registry's id door (task 1508)", () => {
  it("every registered Card-bearing atom is live by its per-kind id attr", () => {
    const d = docOf(
      ...CARD_ATOMS.map((m) => schema.nodes[m.nodeName].create({ [m.idAttr]: `id-${m.kind}` })),
    );
    expect([...liveCardAtomIds(d)].sort()).toEqual(CARD_ATOMS.map((m) => `id-${m.kind}`).sort());
  });

  it("an atom carrying only the unified mirror answers the same id from both doors", () => {
    for (const m of CARD_ATOMS) {
      const node = schema.nodes[m.nodeName].create({ [CARD_ATOM_MIRROR_ID_ATTR]: `mirror-${m.kind}` });
      expect(cardAtomIdOf(node)?.id, m.kind).toBe(`mirror-${m.kind}`);
      expect(liveCardAtomIds(docOf(node)).has(`mirror-${m.kind}`), m.kind).toBe(true);
    }
  });

  it("the per-kind attr wins over the mirror; an id-less atom is not live", () => {
    const m = CARD_ATOMS[0];
    const both = schema.nodes[m.nodeName].create({
      [m.idAttr]: "own",
      [CARD_ATOM_MIRROR_ID_ATTR]: "mirror",
    });
    const none = schema.nodes[m.nodeName].create({});
    const seen: string[] = [];
    forEachCardAtom(docOf(both, none), ({ id }) => seen.push(id));
    expect(seen).toEqual(["own"]);
  });
});

// CENSUS — no shipped file under src/links spells a Card-bearing atom's node
// name or reads its id attr off a node by hand. (A `linkedAnchor` MARK's own
// `linkId` — `m.attrs.linkId` — is a different attr on a different thing.)
describe("CENSUS: src/links reads no Card-bearing atom id by hand", () => {
  const files = trackedFiles("src/links", /\.tsx?$/).filter(
    (f) => !f.split(/[\\/]/).includes("__tests__"),
  );

  it("walks a real population", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("no type-name comparison to a card atom, no hand id-attr read", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = commentsStripped(readFileSync(f, "utf8"));
      for (const { nodeName } of CARD_ATOMS) {
        if (new RegExp(`(?:\\btypeName|\\.type\\.name)\\s*[!=]==\\s*"${nodeName}"`).test(src)) {
          offenders.push(`${f}: compares a type name to "${nodeName}"`);
        }
      }
      for (const attr of [...CARD_ATOM_ID_ATTRS, CARD_ATOM_MIRROR_ID_ATTR]) {
        if (new RegExp(`(?<!\\bm\\.)\\battrs\\??\\.${attr}\\b|attrs\\[\\s*"${attr}"`).test(src)) {
          offenders.push(`${f}: reads attrs.${attr} by hand`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
