// @vitest-environment jsdom
/**
 * TASK 393 — the card-body capture DOOR, and the census that keeps it the door.
 *
 * The door was never the part that could misbehave. A CAPTURE SITE that asks
 * the schema about one payload and stores another is — and that call site type
 * checks perfectly, which is exactly what shipped: `canMountInCardBody(rawSlice)`
 * beside `createArchiveSnippet(rawSlice)` with the write's own normalizer
 * silently changing the payload in between.
 *
 * So: the contract legs pin what `prepareCardBodyCapture` guarantees, and the
 * CENSUS pins that nothing in production re-derives it.
 */
import { describe, it, expect, vi } from "vitest";

// `borrowed-schema` composes the real extension barrel, which reaches
// `@/lib/storage` — whose backend `require` cannot resolve under vitest. The
// schema builders themselves touch none of it.
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);
import fs from "node:fs";
import path from "node:path";
import type { JSONContent } from "@tiptap/react";
import {
  prepareCardBodyCapture,
  describeCardBodyRefusal,
  type CardBodyCapture,
} from "@/lib/tiptap/card-body-capture";
import {
  canMountInCardBody,
  cardBodySchemaFor,
} from "@/lib/tiptap/borrowed-schema";
import { unsupportedConstructs } from "@/lib/tiptap/schema-mount";
import { normalizeRichContent } from "@/lib/footnote-content";
import {
  codeOnly,
  codeOnlyLines,
  enclosingDeclaration,
  trackedFiles,
  REPO_ROOT,
} from "@/lib/__tests__/_source-scan";
import { getSchema } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { invalidContentNodes } from "@/lib/tiptap/schema-mount";

const REPO = path.resolve(__dirname, "../../../..");
const SILOS = ["src", "library"];

function refusalOf(c: CardBodyCapture): Extract<CardBodyCapture, { ok: false }> {
  if (c.ok) throw new Error("expected a refusal");
  return c;
}

const ANCHORED_DOC: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Anchored prose.",
          marks: [
            {
              type: "linkedAnchor",
              attrs: { anchorId: "b50e", kind: "note", linkId: "b50e", linkCard: "note:n1" },
            },
          ],
        },
      ],
    },
  ],
};

describe("task 393 — prepareCardBodyCapture (the one door)", () => {
  it("normalizes BEFORE it validates: an anchored capture is accepted", () => {
    // The pre-393 order — validate the raw payload — refuses this, because the
    // excerpt schema deliberately has no `linkedAnchor` (the normalizer strips
    // it). The control below is what makes that a claim rather than a hope.
    expect(canMountInCardBody(ANCHORED_DOC, "excerpt").ok).toBe(false);
    const prepared = prepareCardBodyCapture(ANCHORED_DOC, "excerpt");
    expect(prepared.ok).toBe(true);
  });

  it("hands back the object it validated, and the write's normalize is a no-op on it", () => {
    const prepared = prepareCardBodyCapture(ANCHORED_DOC, "excerpt");
    if (!prepared.ok) throw new Error("expected ok");
    // What the caller stores IS what was judged — the guarantee the door exists
    // for. A second derivation from the source is what task 393 was.
    expect(canMountInCardBody(prepared.content, "excerpt").ok).toBe(true);
    expect(normalizeRichContent(prepared.content)).toEqual(prepared.content);
    expect(JSON.stringify(prepared.content)).not.toContain("linkedAnchor");
    // …and it did not mutate the source.
    expect(JSON.stringify(ANCHORED_DOC)).toContain("linkedAnchor");
  });

  it("takes a live DocRange — the capture shape — as well as JSON", () => {
    // RENEGOTIATED (task 563). This leg used to hand the door a caller-built
    // `Slice` — an inline fragment (openStart/openEnd 1) and a block fragment —
    // and pin that the inline one was WRAPPED in a paragraph. The leaf owns
    // the cut now: it takes `{ doc, from, to }` and slices WITH the range's
    // parents, so a sub-paragraph range arrives as the paragraph it came from
    // (identity-less, since that paragraph survives) and a whole-block range
    // passes the block through with its identity. A caller-built slice is the
    // shape that produced two orphan `listItem`s at doc level.
    const schema = cardBodySchemaFor("excerpt");
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create({ uuid: "p1" }, schema.text("Sliced whole.")),
    ]);
    const inside = prepareCardBodyCapture({ doc, from: 1, to: 7 }, "excerpt");
    if (!inside.ok) throw new Error("expected ok");
    expect(inside.content.type).toBe("doc");
    expect(inside.content.content?.[0]?.type).toBe("paragraph");
    expect(inside.content.content?.[0]?.attrs?.uuid ?? null).toBeNull();
    expect(JSON.stringify(inside.content)).toContain("Sliced");
    expect(JSON.stringify(inside.content)).not.toContain("whole.");

    const whole = prepareCardBodyCapture({ doc, from: 0, to: doc.content.size }, "excerpt");
    if (!whole.ok) throw new Error("expected ok");
    expect(whole.content.content?.[0]?.type).toBe("paragraph");
    expect(whole.content.content?.[0]?.attrs?.uuid).toBe("p1");
    expect(JSON.stringify(whole.content)).toContain("Sliced whole.");
  });

  it("still REFUSES a genuine vocabulary gap — the 308 invariant is untouched", () => {
    const gap: JSONContent = {
      type: "doc",
      content: [{ type: "futureBlock", content: [{ type: "text", text: "x" }] }],
    };
    const refusal = refusalOf(prepareCardBodyCapture(gap, "excerpt"));
    expect(refusal.reason).toBeTruthy();
    expect(refusal.constructs).toContain("futureBlock");
  });

  it("a refusal NAMES the construct — derived from the schema, not parsed", () => {
    const one = refusalOf(
      prepareCardBodyCapture(
        { type: "doc", content: [{ type: "futureBlock" }] },
        "excerpt",
      ),
    );
    expect(describeCardBodyRefusal(one)).toContain("futureBlock");

    const many = refusalOf(
      prepareCardBodyCapture(
        {
          type: "doc",
          content: [
            { type: "futureBlock" },
            { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "futureMark" }] }] },
          ],
        },
        "excerpt",
      ),
    );
    const phrase = describeCardBodyRefusal(many);
    expect(phrase).toContain("futureBlock");
    expect(phrase).toContain("futureMark");
    expect(phrase).toContain(" and ");
  });

  it("falls back to the probe's own reason when there is no name to give", () => {
    // A mount can fail on a MALFORMED model whose every type name is known — a
    // text node with no `text`, a non-array `content`. Naming nothing there and
    // claiming the constructs list is complete would be worse than the raw
    // message, so the phrase degrades to it.
    const malformed = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text" }] }],
    } as unknown as JSONContent;
    const refusal = refusalOf(prepareCardBodyCapture(malformed, "excerpt"));
    expect(refusal.constructs).toEqual([]);
    expect(describeCardBodyRefusal(refusal)).toContain(refusal.reason);
  });

  it("`unsupportedConstructs` names each gap ONCE, in first-seen order", () => {
    const schema = cardBodySchemaFor("excerpt");
    const doc = {
      type: "doc",
      content: [
        { type: "zzz" },
        { type: "paragraph", content: [{ type: "text", text: "a", marks: [{ type: "aaa" }] }] },
        { type: "zzz" },
      ],
    };
    expect(unsupportedConstructs(schema, doc)).toEqual(["zzz", "aaa"]);
    // Known vocabulary names nothing — so an empty list is evidence, not silence.
    expect(unsupportedConstructs(schema, normalizeRichContent(ANCHORED_DOC))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TASK 563 — the cut brings the parents along, and the check asks CONTENT
// ---------------------------------------------------------------------------

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

/** Document position `offset` characters into the text node starting with
 *  `prefix`. */
function posInText(doc: PMNode, prefix: string, offset: number): number {
  let found = -1;
  doc.descendants((n, pos) => {
    if (found === -1 && n.isText && n.text?.startsWith(prefix)) found = pos + offset;
    return found === -1;
  });
  if (found === -1) throw new Error(`no text starting with "${prefix}"`);
  return found;
}

describe("task 563 — the leaf owns the cut, WITH the range's parents", () => {
  const mainSchema = getSchema(buildEditorExtensions(mainCtx()));
  const capture = (doc: PMNode, from: number, to: number) =>
    prepareCardBodyCapture({ doc, from, to }, "excerpt");

  const listDoc = () =>
    mainSchema.nodeFromJSON({
      type: "doc",
      content: [
        {
          type: "bulletList",
          attrs: { uuid: "L1", parTitle: "My list" },
          content: [
            { type: "listItem", attrs: { uuid: "i1", itemLabel: "(a)" }, content: [{ type: "paragraph", content: [{ type: "text", text: "alpha one" }] }] },
            { type: "listItem", attrs: { uuid: "i2" }, content: [{ type: "paragraph", content: [{ type: "text", text: "beta two" }] }] },
            {
              type: "listItem",
              attrs: { uuid: "i3" },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "gamma three" }] },
                {
                  type: "bulletList",
                  attrs: { uuid: "L2" },
                  content: [
                    { type: "listItem", attrs: { uuid: "n1" }, content: [{ type: "paragraph", content: [{ type: "text", text: "nested one" }] }] },
                  ],
                },
              ],
            },
          ],
        },
        { type: "paragraph", attrs: { uuid: "p9", parTitle: "Titled", label: null }, content: [{ type: "text", text: "closing prose" }] },
      ],
    } as never);

  it("a selection across two items captures the LIST, cut — and the model passes the excerpt schema's content check", () => {
    const doc = listDoc();
    const c = capture(doc, posInText(doc, "alpha", 3), posInText(doc, "beta", 4));
    if (!c.ok) throw new Error(`refused: ${c.reason}`);
    expect(c.content.content!.map((n) => n.type)).toEqual(["bulletList"]);
    expect(c.content.content![0].content!.map((n) => n.type)).toEqual(["listItem", "listItem"]);
    expect(() => cardBodySchemaFor("excerpt").nodeFromJSON(c.content as never).check()).not.toThrow();
  });

  it("open ancestors are captured FRESH — uuid, parTitle, and what a split leaves behind — while a contained sibling keeps its identity", () => {
    const doc = listDoc();
    const c = capture(doc, posInText(doc, "alpha", 3), posInText(doc, "gamma", 3));
    if (!c.ok) throw new Error(`refused: ${c.reason}`);
    const list = c.content.content![0];
    // The list survives in the document: its copy carries neither its identity
    // nor its title.
    expect(list.attrs?.uuid ?? null).toBeNull();
    expect(list.attrs?.parTitle ?? null).toBeNull();
    const [first, middle, last] = list.content!;
    expect(first.attrs?.uuid ?? null).toBeNull();
    // `itemLabel` is `keepOnSplit: false` — a cut is a split, so the fragment
    // does not carry the `\item[(a)]` marker the surviving item keeps.
    expect(first.attrs?.itemLabel ?? null).toBeNull();
    expect(last.attrs?.uuid ?? null).toBeNull();
    expect(middle.attrs?.uuid).toBe("i2");
  });

  it("a sub-paragraph selection captures the paragraph, identity-less and title-less (today's bytes, one rule)", () => {
    const doc = listDoc();
    const c = capture(doc, posInText(doc, "closing", 2), posInText(doc, "closing", 9));
    if (!c.ok) throw new Error(`refused: ${c.reason}`);
    const para = c.content.content![0];
    expect(para.type).toBe("paragraph");
    expect(para.attrs?.uuid ?? null).toBeNull();
    expect(para.attrs?.parTitle ?? null).toBeNull();
    expect(JSON.stringify(c.content)).toContain("osing p");
  });

  it("a whole block keeps its identity and its title (the control — it is LEAVING the document)", () => {
    const doc = listDoc();
    const from = doc.content.size - doc.lastChild!.nodeSize;
    const c = capture(doc, from, doc.content.size);
    if (!c.ok) throw new Error(`refused: ${c.reason}`);
    const para = c.content.content![0];
    expect(para.attrs?.uuid).toBe("p9");
    expect(para.attrs?.parTitle).toBe("Titled");
  });

  it("a cut that opens an item INSIDE a nested list is CLOSED the way the fitter would close it", () => {
    // From inside the nested item back out to the closing paragraph: the
    // outer `listItem` arrives holding only its nested `bulletList`, which its
    // content expression (`(paragraph | graphicsBlock) block*`) cannot start
    // with. `fillBefore` supplies the empty leading paragraph — DERIVED from
    // the expression, exactly what a restore's fitter would do — so the model
    // mounts rather than refusing an ordinary selection.
    const doc = listDoc();
    const c = capture(doc, posInText(doc, "nested", 3), posInText(doc, "closing", 3));
    if (!c.ok) throw new Error(`refused: ${c.reason}`);
    const outerItem = c.content.content![0].content![0];
    expect(outerItem.type).toBe("listItem");
    expect(outerItem.content![0].type).toBe("paragraph");
    expect(outerItem.content![1].type).toBe("bulletList");
    expect(() => cardBodySchemaFor("excerpt").nodeFromJSON(c.content as never).check()).not.toThrow();
  });

  it("a partial selection inside a COMMENT is the comment node, never prose; inside a CODE BLOCK, verbatim", () => {
    const doc = mainSchema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "latexComment", attrs: { uuid: "c1" }, content: [{ type: "text", text: "parked old prose" }] },
        { type: "codeBlock", attrs: { uuid: "k1" }, content: [{ type: "text", text: "raw {bytes}" }] },
      ],
    } as never);
    const comment = capture(doc, posInText(doc, "parked", 2), posInText(doc, "parked", 8));
    if (!comment.ok) throw new Error(comment.reason);
    expect(comment.content.content!.map((n) => n.type)).toEqual(["latexComment"]);
    expect(comment.content.content![0].attrs?.uuid ?? null).toBeNull();
    const code = capture(doc, posInText(doc, "raw", 1), posInText(doc, "raw", 9));
    if (!code.ok) throw new Error(code.reason);
    expect(code.content.content!.map((n) => n.type)).toEqual(["codeBlock"]);
  });

  it("an empty or inverted range is REFUSED — a `block+` body holds nothing, and the dispatcher bails before asking", () => {
    // The leaf captures an empty document for an empty range (the display
    // capture never asks — `createLinkedAnchor` returns null first); the door
    // then refuses it, because the content check is the same one that would
    // refuse an empty archive card. The archive dispatcher's own empty-range
    // bail runs before it ever reaches here.
    const doc = listDoc();
    const at = posInText(doc, "alpha", 2);
    expect(capture(doc, at, at).ok).toBe(false);
    expect(capture(doc, at + 3, at).ok).toBe(false);
  });

  it("the door REFUSES a known vocabulary in a shape the schema cannot hold, and NAMES the node", () => {
    // The pre-563 capture shape, handed in as JSON (a hand- or agent-edited
    // sidecar can still produce it): two orphan items at doc level. Every type
    // is known, so `nodeFromJSON` builds it and a vocabulary-only probe says
    // "mountable" — which is how the archive card came to hold a dead body.
    const orphans: JSONContent = {
      type: "doc",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] },
      ],
    };
    const refusal = refusalOf(prepareCardBodyCapture(orphans, "excerpt"));
    expect(refusal.constructs).toEqual([]);
    expect(refusal.illFormed).toEqual(["listItem"]);
    expect(describeCardBodyRefusal(refusal)).toBe("“listItem” in that shape");
    expect(refusal.reason).toMatch(/Invalid content/);
  });

  it("`invalidContentNodes` names the CHILD the root cannot place and the PARENT whose content fails below it", () => {
    const schema = cardBodySchemaFor("excerpt");
    expect(invalidContentNodes(schema, { type: "doc", content: [{ type: "listItem" }] })).toEqual(["listItem"]);
    expect(
      invalidContentNodes(schema, {
        type: "doc",
        content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] }] }] }],
      }),
    ).toEqual(["listItem"]);
    // A vocabulary gap is the sibling's to name — this walk answers nothing.
    expect(invalidContentNodes(schema, { type: "doc", content: [{ type: "futureBlock" }] })).toEqual([]);
    // A valid model names nothing — an empty list is evidence, not silence.
    expect(invalidContentNodes(schema, normalizeRichContent(ANCHORED_DOC))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// THE CENSUS — the leg with teeth
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

function productionFiles(): string[] {
  const files: string[] = [];
  for (const silo of SILOS) {
    const root = path.join(REPO, silo);
    if (fs.existsSync(root)) walk(root, files);
  }
  return files.map((f) => path.relative(REPO, f)).sort();
}

/** The two modules entitled to spell the probe: the one that DEFINES it, and
 *  the one door every capture enters. Anything else is a second table. */
const PROBE_OWNERS = new Set([
  "src/lib/tiptap/borrowed-schema.ts",
  "src/lib/tiptap/card-body-capture.ts",
]);

describe("task 393 — census: one door, and nothing re-derives it", () => {
  const files = productionFiles();

  it("the census can see the tree it is scanning", () => {
    expect(files).toContain("src/lib/tiptap/card-body-capture.ts");
    expect(files).toContain("src/components/editor-layout/card-actions/drag-handle-actions.ts");
    expect(files.length).toBeGreaterThan(300);
  });

  it("no production file CALLS `canMountInCardBody` outside the door", () => {
    // The allowlist is EMPTY by construction — a hit is MIGRATE-it, never an
    // entry. `canMountInCardBody` answers the SCHEMA question ("can this scope
    // hold this model?"); a CAPTURE has to ask about the payload it will store,
    // which is what the door derives. Comments are stripped and string literals
    // kept: a doc comment naming the function is not a caller, a call is.
    const hits = files
      .filter((rel) => !PROBE_OWNERS.has(rel))
      .filter((rel) =>
        /\bcanMountInCardBody\s*\(/.test(codeOnly(fs.readFileSync(path.join(REPO, rel), "utf8"))),
      );
    expect(hits).toEqual([]);
  });

  it("…and the needle is real: the door itself is a hit under the same regex", () => {
    // A canary that does NOT stand on the drained defect — the door legitimately
    // calls the probe, so if the regex ever stops matching, this fails first.
    const src = codeOnly(
      fs.readFileSync(path.join(REPO, "src/lib/tiptap/card-body-capture.ts"), "utf8"),
    );
    expect(/\bcanMountInCardBody\s*\(/.test(src)).toBe(true);
  });

  it("the door normalizes — the one line the whole task is", () => {
    const src = codeOnly(
      fs.readFileSync(path.join(REPO, "src/lib/tiptap/card-body-capture.ts"), "utf8"),
    );
    expect(/\bnormalizeRichContent\s*\(/.test(src)).toBe(true);
  });

  it("every capture site enters the door, and stores what the door returned", () => {
    // Discovered, not hand-listed: any production file that mints an archive
    // snippet is a capture site. Today that is the drag-handle dispatcher; the
    // next one inherits the rule by being found here.
    const captureSites = files.filter((rel) =>
      /createArchiveSnippet\s*\(\s*\{/.test(codeOnly(fs.readFileSync(path.join(REPO, rel), "utf8"))),
    );
    expect(captureSites.length).toBeGreaterThan(0);
    for (const rel of captureSites) {
      const src = codeOnly(fs.readFileSync(path.join(REPO, rel), "utf8"));
      expect(src, `${rel} must derive its payload through prepareCardBodyCapture`).toMatch(
        /\bprepareCardBodyCapture\s*\(/,
      );
    }
  });

  it("…and every capture site RE-HOMES the anchors it displaces (task 491)", () => {
    // Same DISCOVERED population, one more obligation. A capture SETS TEXT
    // ASIDE, so every Mode-A paragraph anchor it consumes moves to the
    // surviving neighbour rather than orphaning — Gabriel: "they should just
    // stack up on the preceeding paragraph."
    //
    // The door was never the part that could misbehave; a capture site that
    // deletes an anchored block and never asks is, and it type-checks
    // perfectly. Allowlist EMPTY — a hit is WIRE-it.
    const captureSites = files.filter((rel) =>
      /createArchiveSnippet\s*\(\s*\{/.test(codeOnly(fs.readFileSync(path.join(REPO, rel), "utf8"))),
    );
    expect(captureSites.length).toBeGreaterThan(0);
    for (const rel of captureSites) {
      const src = codeOnly(fs.readFileSync(path.join(REPO, rel), "utf8"));
      expect(src, `${rel} must resolve the surviving neighbour`).toMatch(
        /\bresolveDisplacedAnchorTarget\s*\(/,
      );
      expect(src, `${rel} must retarget the displaced anchors`).toMatch(
        /\banchorRetarget\.retarget\s*\(/,
      );
      // ONE neighbour per gesture: the fresh snippet and the cards it displaced
      // must not be resolved twice, or they land on different paragraphs and
      // "stack up" is false.
      const resolves = src.match(/\bresolveDisplacedAnchorTarget\s*\(/g) ?? [];
      expect(resolves.length, `${rel} resolves the neighbour more than once`).toBe(1);
    }
  });

  it("nothing outside the retarget module re-derives the sweep (task 491)", () => {
    // `retargetDisplacedAnchors` is reached through the pane's stable
    // `AnchorRetargetApi`; a second caller would hold a live handler bundle and
    // decide for itself which cards move.
    const hits = files
      .filter((rel) => rel !== "src/cards/retarget-anchors.ts")
      .filter((rel) =>
        /\bretargetDisplacedAnchors\s*\(/.test(codeOnly(fs.readFileSync(path.join(REPO, rel), "utf8"))),
      );
    expect(hits).toEqual([]);
  });
});

describe("task 565 — capture sites are discovered by the QUESTION, not by who mints", () => {
  // The 393 census discovers a capture site by `createArchiveSnippet(` — who
  // MINTS a snippet. `EditorHandle.archiveSelection` minted nothing: it
  // returned raw slice JSON for a CALLER to mint (inline children at doc
  // level — the shape `slice-capture.ts` says throws the moment the body
  // mounts), normalized nothing, asked no schema, deleted FIRST and re-homed
  // no anchor. A dead capture path outside the door with zero callers, and
  // exactly what the next agent asked to "archive the selection" would reach
  // for off the handle — invisible to a mint-shaped needle, because it mints
  // nothing itself.
  //
  // The question a capture site answers is "cut a range OUT of the document
  // and KEEP a JSON copy of it": a declaration that takes `doc.slice(`,
  // spells a delete verb, and spells `.toJSON(`. A MOVE (the drop-mode
  // text-range spec, the Outline reorder) cuts and RE-INSERTS, a CONVERSION
  // (`texRun` / `exampleRun`) cuts and rebuilds, a COPY (the Stack snapshot)
  // keeps JSON and deletes nothing — none spells all three, so they fall out
  // by construction and the allowlist is EMPTY. Measured on the pre-565 tree:
  // exactly one hit, `Editor.tsx`'s `archiveSelection`. On the fixed tree the
  // population is empty, which is why the canary leg below exists.
  const CUT = /\b(?:deleteSelection|deleteRange)\s*\(|\.delete\s*\(/;
  const KEEP = /\.toJSON\s*\(/;
  const SLICE = /\bdoc\.slice\s*\(/g;
  const DOOR = /\bprepareCardBodyCapture\s*\(/;

  /** Declarations in `src` that cut a range and keep a JSON copy of it. */
  function cutAndKeepDeclarations(src: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    SLICE.lastIndex = 0;
    while ((m = SLICE.exec(src))) {
      const decl = enclosingDeclaration(src, m.index);
      if (seen.has(decl)) continue;
      seen.add(decl);
      if (CUT.test(decl) && KEEP.test(decl)) out.push(decl);
    }
    return out;
  }

  const population = () =>
    [...trackedFiles("src/components", /\.tsx?$/), ...trackedFiles("src/lib", /\.tsx?$/)]
      .filter((abs) => !/__tests__|\.test\./.test(abs))
      .map((abs) => path.relative(REPO_ROOT, abs));

  it("the population is real", () => {
    const rels = population();
    expect(rels).toContain("src/components/Editor.tsx");
    expect(rels).toContain("src/components/editor-layout/card-actions/drag-handle-actions.ts");
    expect(rels.length).toBeGreaterThan(300);
  });

  it("every cut-and-keep declaration enters the door (allowlist EMPTY — a hit is MIGRATE-it)", () => {
    const offenders: string[] = [];
    for (const rel of population()) {
      const src = codeOnlyLines(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
      for (const decl of cutAndKeepDeclarations(src)) {
        if (!DOOR.test(decl)) offenders.push(`${rel} :: ${decl.split("\n")[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the needle catches the retired handle's shape and only that shape (synthetic canaries)", () => {
    // A canary must not stand on the drained defect — the handle is gone, so
    // its shape is planted here. Beside it the three neighbours the needle
    // must NOT indict, and one doored capture it must accept.
    const handle = `
      archiveSelection(id: string) {
        const { from, to } = editor.state.selection;
        const slice = editor.state.doc.slice(from, to);
        const rich = { type: "doc", content: slice.content.toJSON() };
        editor.chain().focus().deleteSelection().run();
        return rich;
      }`;
    const caught = cutAndKeepDeclarations(handle);
    expect(caught).toHaveLength(1);
    expect(DOOR.test(caught[0])).toBe(false);

    const mover = `
      function moveRange(from: number, to: number, at: number) {
        const slice = doc.slice(from, to);
        let tr = state.tr.delete(from, to);
        tr = tr.insert(tr.mapping.map(at), slice.content);
        view.dispatch(tr);
      }`;
    expect(cutAndKeepDeclarations(mover)).toEqual([]);

    const copier = `
      function snapshot(from: number, to: number) {
        const slice = doc.slice(from, to);
        return { content: slice.toJSON() };
      }`;
    expect(cutAndKeepDeclarations(copier)).toEqual([]);

    const converter = `
      function texRun(state: EditorState) {
        if (state.doc.slice(from, to).content.size === 0) return;
        let tr = state.tr.deleteSelection();
        tr = tr.replaceSelectionWith(node);
      }`;
    expect(cutAndKeepDeclarations(converter)).toEqual([]);

    const doored = `
      function archiveRange(from: number, to: number) {
        if (doc.slice(from, to).content.size === 0) return;
        const capture = prepareCardBodyCapture({ doc, from, to }, "excerpt");
        if (!capture.ok) return;
        tr.delete(from, to);
        store(capture.content.toJSON());
      }`;
    const hits = cutAndKeepDeclarations(doored);
    expect(hits).toHaveLength(1);
    expect(DOOR.test(hits[0])).toBe(true);
  });

  it("the retired handle stays retired, in both silos", () => {
    const files = productionFiles();
    const hits = files.filter((rel) =>
      /\barchiveSelection\b/.test(codeOnly(fs.readFileSync(path.join(REPO, rel), "utf8"))),
    );
    expect(hits).toEqual([]);
  });

  it("the restore door has no string arm — the migrator is the ONE place a legacy string becomes content", () => {
    const door = codeOnly(fs.readFileSync(path.join(REPO, "src/lib/tiptap/restore-excerpt.ts"), "utf8"));
    expect(door).not.toMatch(/typeof\s+content\s*===\s*["']string["']/);
    expect(door).not.toMatch(/\blatexComment\b/);
    const hook = codeOnly(fs.readFileSync(path.join(REPO, "src/hooks/useArchive.ts"), "utf8"));
    expect(hook).toMatch(/normalizeRichContent\s*\(\s*s\.text\s*\)/);
  });
});
