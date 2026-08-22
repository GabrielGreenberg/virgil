/**
 * Task 405 — the `%!v:` anchor of a node whose body is a user-editable ATTR.
 *
 * Task 348's position law says the anchor is APPENDED to the end of a
 * construct's serialized body and DETACHED from the same place, so the two
 * ends cannot disagree. For every emitter that BUILDS its body they are the
 * same place by construction. Two nodes carry a body the emitter does NOT own
 * — `forestBlock.source` and `graphicsBlock.command` — and there one press of
 * a key past the closer makes the end of the ATTR a different place from the
 * end of the CONSTRUCT. Task 387 closed the whitespace half with a trailing
 * trim; this closes the tail.
 *
 * **Why no pre-405 suite could see this.** Every `source` fixture in
 * `forest-block-roundtrip.test.ts` comes from a parse, which slices to the
 * closer, so a trailing byte is unrepresentable in all of them; 387's own
 * suite drove only WHITESPACE tails and recorded the rest as a residual, with
 * a leg that pinned it ("…is already LOUD, so it is left alone"). And the loss
 * is silent past the save: the write gate's multiset word measure does not
 * move, and the 384 badge is loud BEFORE the save and gone AFTER it — the
 * transition being exactly the save that moves the identity.
 *
 * Every leg drives the REAL save pipeline over TWO cycles and asserts the
 * parsed node's `uuid` ATTR, never a `%!v:` grep of the emitted bytes: a dead
 * marker stranded inside a comment still matches the grep, so a byte-grep leg
 * reads the identity as preserved while a fresh uuid has been minted beside
 * it. (That exact trap sank the first draft of task 387's own M4 leg.)
 * `parTitle` and `collapsed` are asserted SEPARATELY from the uuid — they ride
 * the sidecar, `latexComment` is in `UUID_BEARING_NODE_TYPES` but in neither
 * read set, and they can regress independently.
 */
import { describe, it, expect } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import {
  assignUuids,
  extractSidecarData,
  serializeBodyOnly,
} from "@/lib/latex-serializer";
import { anchorCarriedBody } from "@/lib/uuid";
import { carriedEnvEnd } from "@/lib/latex-lexer";
import { parseForestSource } from "@/lib/forest/grammar";
import {
  extractGraphicsAttrs,
  graphicsCommandEnd,
} from "@/lib/figures/parse-attrs";
import type { JSONContent } from "@tiptap/core";
import type { VirgilSidecar } from "@/lib/types";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { commentsStripped } from "./_source-scan";

const TREE = "\\begin{forest}\n[S [NP] [VP]]\n\\end{forest}";
const TREE_B = "\\begin{forest}\n[Z [Adv] [AP]]\n\\end{forest}";
const GRAPHIC = "\\includegraphics[width=0.5\\textwidth]{fig.png}";

function find(node: JSONContent, type: string): JSONContent | null {
  if (node.type === type) return node;
  for (const child of node.content ?? []) {
    const hit = find(child, type);
    if (hit) return hit;
  }
  return null;
}

function open(body: string, sidecar?: VirgilSidecar): JSONContent {
  const doc = parseLatex(
    `\\begin{document}\n\n${body}\n\n\\end{document}\n`,
    sidecar,
  );
  assignUuids(doc);
  return doc;
}

/** ONE save+reload cycle carrying the sidecar, which is what `parTitle` and
 *  `collapsed` actually ride — nothing serializes them into the `.tex`. */
function cycle(doc: JSONContent): { tex: string; doc: JSONContent } {
  const sidecar = extractSidecarData(doc);
  const tex = serializeBodyOnly(doc);
  return { tex, doc: open(tex, sidecar) };
}

/** The gesture, for either carrier: open the pod, type past the closer. */
function podEdit(
  body: string,
  nodeType: string,
  attr: string,
  edited: string,
): { uuid: string; doc: JSONContent } {
  const doc = open(body);
  const node = find(doc, nodeType)!;
  const uuid = node.attrs?.uuid as string;
  expect(uuid, `${nodeType} had no uuid to lose`).toBeTruthy();
  node.attrs = {
    ...node.attrs,
    parTitle: "Fig. 3 tree",
    collapsed: true,
    [attr]: edited,
  };
  return { uuid, doc };
}

describe("a pod edit past the closer cannot move the block's identity", () => {
  it.each([
    ["a trailing % note", `${TREE}\n% note to self`],
    ["a % note on the closer's own line", `${TREE} % note to self`],
    ["a SECOND pasted environment", `${TREE}\n\n${TREE_B}`],
    ["a second environment with no blank line", `${TREE}\n${TREE_B}`],
    ["a note AND a second environment", `${TREE}\n% note\n\n${TREE_B}`],
  ])("%s leaves the uuid, the parTitle and the collapse ON the tree", (
    _name,
    edited,
  ) => {
    const { uuid, doc } = podEdit(TREE, "forestBlock", "source", edited);

    const c1 = cycle(doc);
    const tree = c1.doc.content?.[0];
    expect(tree?.type, "the tree stopped being the first block").toBe(
      "forestBlock",
    );
    expect(tree?.attrs?.uuid, "the tree's uuid was re-minted").toBe(uuid);
    expect(tree?.attrs?.parTitle, "the pod's title followed the anchor").toBe(
      "Fig. 3 tree",
    );
    expect(tree?.attrs?.collapsed, "the collapse followed the anchor").toBe(
      true,
    );
    // Read from the other side: nothing ELSE in the document answers to it.
    const claimants = (c1.doc.content ?? []).filter(
      (n) => n.attrs?.uuid === uuid,
    );
    expect(claimants.map((n) => n.type)).toEqual(["forestBlock"]);
    // The tree the anchor names is the tree the user had, not the pasted one.
    expect(tree?.attrs?.source).toBe(TREE);

    // Cycle 2 — the identity does not migrate LATE either. The `.tex` is not
    // byte-identical yet and should not be: the displaced bytes came back as a
    // block of their own with no uuid, so `assignUuids` mints one for them on
    // this open. That is the ordinary path for any newly-arrived block, and it
    // is exactly the settle the pre-405 emitter never reached — there the
    // TREE was the block being re-minted, every cycle, forever.
    const c2 = cycle(c1.doc);
    expect(c2.doc.content?.[0]?.attrs?.uuid).toBe(uuid);
    expect(c2.doc.content?.[0]?.attrs?.parTitle).toBe("Fig. 3 tree");
    expect(c2.doc.content?.[0]?.attrs?.collapsed).toBe(true);
    expect(c2.doc.content?.[0]?.attrs?.source).toBe(TREE);

    // Cycle 3 is the FIXED POINT: with every block now carrying an id, nothing
    // moves again.
    const c3 = cycle(c2.doc);
    expect(c3.tex).toBe(c2.tex);
    expect(c3.doc.content?.[0]?.attrs?.uuid).toBe(uuid);
    expect(c3.doc.content?.[0]?.attrs?.parTitle).toBe("Fig. 3 tree");
    expect(c3.doc.content?.[0]?.attrs?.collapsed).toBe(true);
  });

  it("the displaced bytes round-trip as THEMSELVES, one block over", () => {
    // What the pod does with them, stated: it loses them, and they come back as
    // what they are. The restructuring is pre-405 behaviour; what changed is
    // who keeps the identity.
    const { uuid, doc } = podEdit(TREE, "forestBlock", "source", `${TREE}\n% note`);
    const back = cycle(doc).doc;
    expect(back.content?.[1]?.attrs?.uuid, "the comment took the tree's id").not.toBe(
      uuid,
    );
    expect(back.content?.map((n) => n.type)).toEqual([
      "forestBlock",
      "latexComment",
    ]);
    // It gets an identity of its OWN on this open (`assignUuids` mints for any
    // uuid-less block) — what it must never get is the TREE's.
    expect(back.content?.[1]?.attrs?.uuid).not.toBe(
      back.content?.[0]?.attrs?.uuid,
    );
    expect(serializeBodyOnly(back)).toContain("% note");
  });

  it("a SECOND tree becomes a second forestBlock, with its own fresh identity", () => {
    const { uuid, doc } = podEdit(
      TREE,
      "forestBlock",
      "source",
      `${TREE}\n\n${TREE_B}`,
    );
    const back = cycle(doc).doc;
    expect(back.content?.map((n) => n.type)).toEqual([
      "forestBlock",
      "forestBlock",
    ]);
    expect(back.content?.[1]?.attrs?.source).toBe(TREE_B);
    expect(back.content?.[1]?.attrs?.uuid).not.toBe(uuid);
  });

  it("CONTROL — a well-formed single-environment pod is byte-identical", () => {
    const doc = open(TREE);
    const uuid = find(doc, "forestBlock")!.attrs?.uuid as string;
    expect(serializeBodyOnly(doc).trim()).toBe(`${TREE} %!v:${uuid}`);
  });

  it.each([
    ["leading whitespace", `\n  ${TREE}`],
    ["trailing whitespace (task 387)", `${TREE}\n\n`],
  ])(
    "CONTROL — %s is not a tail: the anchor stays reachable",
    (_name, edited) => {
      const { uuid, doc } = podEdit(TREE, "forestBlock", "source", edited);
      const back = cycle(doc).doc;
      expect(back.content?.map((n) => n.type)).toEqual(["forestBlock"]);
      expect(back.content?.[0]?.attrs?.uuid).toBe(uuid);
      expect(back.content?.[0]?.attrs?.parTitle).toBe("Fig. 3 tree");
    },
  );

  it("an UNTERMINATED environment omits the anchor rather than handing it over", () => {
    // The dispatcher fails closed on a missing `\end{forest}` (task 356) and
    // carries the bytes as prose, so the node is not coming back as itself
    // whatever we do. Appending would only decide WHO steals the identity;
    // omitting loses it loudly, which is a fact the user can see.
    const { uuid, doc } = podEdit(
      TREE,
      "forestBlock",
      "source",
      "\\begin{forest}\n[S [NP]",
    );
    const tex = cycle(doc).tex;
    expect(tex).not.toContain(`%!v:${uuid}`);
  });
});

describe("the SECOND ${bytes}${anchor} emitter takes the same door", () => {
  it("CONTROL — an ordinary \\includegraphics is byte-identical", () => {
    const doc = open(GRAPHIC);
    const uuid = find(doc, "graphicsBlock")!.attrs?.uuid as string;
    expect(uuid).toBeTruthy();
    expect(serializeBodyOnly(doc).trim()).toBe(`${GRAPHIC} %!v:${uuid}`);
  });

  it("a tail on the command is displaced, not left to steal the anchor", () => {
    // `applyGraphicsCommandEdit` normally routes through `extractGraphicsAttrs`
    // and never stores a tail (pinned below) — this is the door's own guarantee,
    // independent of that edit path staying the way it is.
    const { uuid, doc } = podEdit(
      GRAPHIC,
      "graphicsBlock",
      "command",
      `${GRAPHIC} % which crop?`,
    );
    const back = cycle(doc).doc;
    expect(back.content?.[0]?.type).toBe("graphicsBlock");
    expect(back.content?.[0]?.attrs?.uuid).toBe(uuid);
    // No `parTitle`/`collapsed` leg here: `graphicsBlock` is in neither
    // `TITLED_NODE_TYPES` nor `COLLAPSIBLE_NODE_TYPES`, so the uuid is the
    // whole of what it has to lose.
    expect(back.content?.[1]?.type).toBe("latexComment");
  });

  it("`extractGraphicsAttrs` normalization: the edit door cannot store a tail", () => {
    // The reason `graphicsBlock` was immune before 405, pinned so a change to
    // that door cannot silently reopen the class at the second emitter.
    const attrs = extractGraphicsAttrs(`${GRAPHIC} % which crop?`);
    expect(attrs).not.toBeNull();
    expect(attrs!.command).toBe(GRAPHIC);
  });

  it("the `attrs === null` fallback stores raw bytes — and the anchor is OMITTED", () => {
    // `applyGraphicsCommandEdit` stores unparseable text verbatim ("the
    // `command` attr IS the source of truth here"). Those bytes open no
    // `\includegraphics`, so no `graphicsBlock` is coming back from them.
    expect(extractGraphicsAttrs("\\includegraphics{unclosed")).toBeNull();
    const { uuid, doc } = podEdit(
      GRAPHIC,
      "graphicsBlock",
      "command",
      "\\includegraphics{unclosed",
    );
    const tex = cycle(doc).tex;
    expect(tex).not.toContain(`%!v:${uuid}`);
  });
});

describe("the door and its two scanners", () => {
  it("a construct filling the whole body is a plain append", () => {
    const r = anchorCarriedBody(TREE, "ab12", carriedEnvEnd);
    expect(r.head).toBe(TREE);
    expect(r.anchor).toBe(" %!v:ab12");
    expect(r.tail).toBe("");
  });

  it("a tail is displaced past the anchor, byte-for-byte", () => {
    const r = anchorCarriedBody(`${TREE}\n% note`, "ab12", carriedEnvEnd);
    expect(r.head).toBe(TREE);
    expect(r.anchor).toBe(" %!v:ab12");
    expect(r.tail).toBe("\n% note");
    expect(r.head + r.tail).toBe(`${TREE}\n% note`);
  });

  it("an unrecognized body OMITS the anchor", () => {
    const r = anchorCarriedBody("not an environment", "ab12", carriedEnvEnd);
    expect(r.anchor).toBe("");
    expect(r.head).toBe("not an environment");
  });

  it("a uuid-less node appends nothing either way", () => {
    expect(anchorCarriedBody(TREE, null, carriedEnvEnd).anchor).toBe("");
    expect(
      anchorCarriedBody(`${TREE}\n% n`, undefined, carriedEnvEnd).anchor,
    ).toBe("");
  });

  it("`carriedEnvEnd` stops at the FIRST matched closer, not the last", () => {
    // The whole disagreement in one assertion: `END_RE` (`\\end{forest}\s*$`)
    // resolves to the LAST closer in the string. The reader stops at the first.
    const two = `${TREE}\n\n${TREE_B}`;
    expect(carriedEnvEnd(two)).toBe(TREE.length);
    expect(two.slice(0, carriedEnvEnd(two)!)).toBe(TREE);
  });

  it("`carriedEnvEnd` is comment- and nesting-aware, through the lexer SSOT", () => {
    const commented = "\\begin{forest}\n% \\end{forest}\n[S]\n\\end{forest}";
    expect(commented.slice(0, carriedEnvEnd(commented)!)).toBe(commented);
    expect(carriedEnvEnd("\\begin{forest}\n[S]")).toBeNull();
    expect(carriedEnvEnd("   ")).toBeNull();
    expect(carriedEnvEnd("plain prose")).toBeNull();
  });

  it("`graphicsCommandEnd` stops at the command's own closing brace", () => {
    expect(graphicsCommandEnd(`${GRAPHIC} % note`)).toBe(GRAPHIC.length);
    expect(graphicsCommandEnd(GRAPHIC)).toBe(GRAPHIC.length);
    expect(graphicsCommandEnd("\\includegraphics{unclosed")).toBeNull();
    expect(graphicsCommandEnd("prose")).toBeNull();
  });
});

describe("the badge NAMES the tail, and names it correctly", () => {
  it.each([
    ["a trailing note", `${TREE}\n% note`, "after-environment"],
    ["a second environment", `${TREE}\n\n${TREE_B}`, "second-environment"],
  ])("%s", (_name, source, kind) => {
    const r = parseForestSource(source);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.kind).toBe(kind);
  });

  it("CONTROL — trailing whitespace is not a tail and still renders", () => {
    expect(parseForestSource(`${TREE}\n\n`).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The leg with teeth.
// ---------------------------------------------------------------------------

/**
 * The door was never the part that could misbehave — an emit arm that appends
 * onto a carried attr without asking it is, and that type-checks perfectly and
 * is invisible to every behavioural test of the two nodes that exist today.
 *
 * Membership is DISCOVERED from the serializer's own arms rather than listed
 * here: a `case` that spells `carriedSource(` or `anchorCarriedBody(` is a node
 * whose model IS its bytes, and every such arm must either enter the door or
 * carry an in-place `carried-anchor-exempt:` marker saying why it cannot be
 * displaced. The allowlist is EMPTY: a hit is ROUTE-it or STATE-it.
 */
describe("census — no arm appends onto a carried body without the door", () => {
  const RAW = readFileSync(
    join(process.cwd(), "src/lib/latex-serializer.ts"),
    "utf8",
  );
  // Two views, deliberately. The needle for "calls the door" must not be
  // satisfied by a comment DESCRIBING the door — both live arms discuss it at
  // length — so that half reads comments-stripped. The exempt MARKER is itself
  // a comment, so that half reads raw.
  const CODE = commentsStripped(RAW);

  /** `serializeNode`'s switch, arm by arm. The LAST arm is bounded at
   *  `default:` — without that it swallows the rest of the file, which would
   *  quietly enroll `carriedSource`'s own definition as a "carrier arm". */
  function arms(src: string): { name: string; body: string }[] {
    return src
      .split(/\n    case "/)
      .slice(1)
      .map((chunk) => {
        const cut = chunk.indexOf("\n    default:");
        return {
          name: chunk.slice(0, chunk.indexOf('"')),
          body: cut === -1 ? chunk : chunk.slice(0, cut),
        };
      });
  }

  it("every carried-body arm routes through `anchorCarriedBody` or states why not", () => {
    const code = arms(CODE);
    const raw = arms(RAW);
    expect(code.map((a) => a.name)).toEqual(raw.map((a) => a.name));

    const carriers = code
      .map((a, i) => ({ ...a, rawBody: raw[i].body }))
      .filter(
        (a) =>
          a.body.includes("carriedSource(") ||
          a.body.includes("anchorCarriedBody("),
      );
    // The census can only speak for arms it FOUND — a split that stopped
    // matching would exempt the whole file in silence.
    expect(carriers.map((a) => a.name).sort()).toEqual([
      "forestBlock",
      "graphicsBlock",
      "texBlock",
    ]);

    const offenders = carriers.filter(
      (a) =>
        !a.body.includes("anchorCarriedBody(") &&
        !a.rawBody.includes("carried-anchor-exempt:"),
    );
    expect(offenders.map((a) => a.name)).toEqual([]);
  });

  it("the retired raw shape is pinned to its ONE non-member", () => {
    // `${source}${anchor}` / `${command}${anchor}`, byte for byte — the two
    // lines this task replaced. The needle is the SHAPE (a bare identifier
    // interpolation immediately followed by the anchor) rather than those two
    // names, so a third emitter cannot escape it by picking a new variable.
    //
    // Its two legitimate hits are REPORTED rather than excluded by name, so a
    // third one has to be looked at. Neither is a carried body: `latexComment`
    // builds from the node's own CHILD CONTENT (`content: text*`), and the
    // heading's `labelStr` is a `\\label{…}` the EMITTER wraps, so in both the
    // last byte before the anchor is one this file wrote — there is no tail a
    // pod could type past.
    const RETIRED = /\$\{[A-Za-z_$][\w$]*\}\$\{anchor\}/g;
    expect(CODE.match(RETIRED) ?? []).toEqual([
      "${labelStr}${anchor}",
      "${text}${anchor}",
    ]);
    // A SYNTHETIC canary, never one of the drained lines: a canary standing on
    // the defect evaporates the moment the defect is fixed.
    expect(/\$\{[A-Za-z_$][\w$]*\}\$\{anchor\}/.test(
      "return `${source}${anchor}\\n\\n`;",
    )).toBe(true);
  });

  it("each scanner is read by the layer that must agree with it", () => {
    // `carriedEnvEnd` is the shared answer three layers now read — the parser
    // dispatcher owns the pair it is built from, the serializer places the
    // anchor by it, and the renderer names its tail by it. A copy of the
    // question in any of them is how the three came to hold three views of one
    // boundary in the first place.
    expect(CODE).toContain("carriedEnvEnd");
    expect(commentsStripped(
      readFileSync(join(process.cwd(), "src/lib/forest/grammar.ts"), "utf8"),
    )).toContain("carriedEnvEnd(");
  });
});
