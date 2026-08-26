// @vitest-environment jsdom
/**
 * Task 480 — **the SELF-DROP rule and the ORIGIN DEAD ZONE.**
 *
 * Gabriel's seed symptom, reproduced live against `main` by audit 457:
 * *"grabbing and then dropping in the same place — because you decided you
 * didn't want to — should not change anything."* Grab a bullet item's handle,
 * wiggle, release at the grab point, and the item was EXTRACTED out of its own
 * list into a brand-new one with a freshly minted uuid.
 *
 * Two independent rules, because the gesture has two independent ways of going
 * nowhere, and neither can reach the other's case:
 *
 *  - the MODEL rule ({@link isSelfGapInsert}) — the landing is the source's own
 *    gap line, one or more ancestor tokens out. Its cells live in
 *    `list-drop-matrix.test.ts` (the source's-own-row sweep, which that suite
 *    could not represent before); its arithmetic lives here.
 *  - the GESTURE rule ({@link withinOriginDeadZone}) — the pointer never left
 *    the grab point. It reaches the reported headline (a MIDDLE item, whose
 *    ancestor boundary has real content between it and the source, so no model
 *    rule may refuse it), and it is applied to the AFFORDANCE in the ONE
 *    content-drag terminal, so hover ≡ commit still holds.
 *
 * The leg with teeth is the CENSUS at the bottom: the predicate was never the
 * part that could misbehave — a call site that never asks it is, and a
 * controller that threads `null` where the session's range belongs type-checks
 * perfectly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/** Every hit-test the controller runs. A fixed placement, so the only thing a
 *  leg can be measuring is whether the pass ran and published. */
const hitTestCalls: Array<{ x: number; y: number }> = [];
vi.mock("../hit-test", () => ({
  hitTest: (x: number, y: number) => {
    hitTestCalls.push({ x, y });
    return {
      kind: "between-blocks",
      editor: {} as unknown,
      insertPos: 7,
      rect: null,
    };
  },
  isUnmintedParagraphId: () => false,
  mintPlacementUuid: (_e: unknown, id: string) => id,
}));

vi.mock("@/components/editor-layout/layout-scroll", () => ({
  findEditorScrollFor: () => null,
  alignEntryToYIfNeeded: () => false,
  scrollEntryIntoViewIfNeeded: () => false,
  scrollHeadingToActiveLine: () => {},
  findRowScroll: () => null,
}));

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getSchema } from "@tiptap/core";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  beginDropSession,
  cancelDropSession,
  getDropSession,
  setDropCtx,
} from "../controller";
import {
  ORIGIN_DEAD_ZONE_PX,
  isSelfDrop,
  isSelfGapInsert,
  withinOriginDeadZone,
} from "../self-drop";
import { buildFloatKey } from "@/floats/float-key";
import type { DropCtx } from "../types";

// ─────────────────────────────────────────────────────────────────────
// The model rule, over the REAL schema
// ─────────────────────────────────────────────────────────────────────

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
const schema: Schema = getSchema(buildEditorExtensions(mainCtx()));

const para = (t: string, uuid: string) =>
  schema.nodes.paragraph.create({ uuid }, t ? schema.text(t) : undefined);
const item = (t: string, uuid: string, extra: PMNode[] = []) =>
  schema.nodes.listItem.create({ uuid }, [para(t, `${uuid}-p`), ...extra]);
const bullets = (uuid: string, items: PMNode[]) =>
  schema.nodes.bulletList.create({ uuid }, items);

//   pA
//   ul1
//     li1  "one"
//     li2  "two"  + ul2 [ li2a "alpha", li2b "beta" ]
//     li3  "three"
//   pB
const doc: PMNode = schema.nodes.doc.create(null, [
  para("a", "pA"),
  bullets("ul1", [
    item("one", "li1"),
    item("two", "li2", [
      bullets("ul2", [item("alpha", "li2a"), item("beta", "li2b")]),
    ]),
    item("three", "li3"),
  ]),
  para("b", "pB"),
]);

function rangeOf(uuid: string): { from: number; to: number } {
  let out: { from: number; to: number } | null = null;
  doc.descendants((n, pos) => {
    if (out) return false;
    if (n.attrs?.uuid === uuid) {
      out = { from: pos, to: pos + n.nodeSize };
      return false;
    }
    return true;
  });
  if (!out) throw new Error(`no node ${uuid}`);
  return out;
}

describe("the model rule — an insertPos is self iff only ancestor tokens lie between", () => {
  it("INSIDE the range is self (the pre-480 test, subsumed byte-for-byte)", () => {
    const r = rangeOf("li1");
    expect(isSelfGapInsert(doc, r, r.from)).toBe(true);
    expect(isSelfGapInsert(doc, r, r.to)).toBe(true);
    expect(isSelfGapInsert(doc, r, r.from + 1)).toBe(true);
  });

  it("a FIRST item's LIST boundary is the same gap line (the defect)", () => {
    // `li1` opens `ul1`, so "before ul1" is one open token from `li1.from`.
    // Pre-480 this was a landing, `listItemDropAdapter` answered `wrap`, and
    // `buildWrap` MINTED a fresh single-item list around the item — extracting
    // it from the list it was already in.
    const li1 = rangeOf("li1");
    const ul1 = rangeOf("ul1");
    expect(ul1.from).toBeLessThan(li1.from);
    expect(isSelfGapInsert(doc, li1, ul1.from)).toBe(true);
  });

  it("a LAST item's LIST boundary is too, on the far side", () => {
    const li3 = rangeOf("li3");
    const ul1 = rangeOf("ul1");
    expect(isSelfGapInsert(doc, li3, ul1.to)).toBe(true);
  });

  it("…and it reaches through SEVERAL ancestor levels at once", () => {
    // `li2b` is last of `ul2`, and `ul2` is the last child of `li2`. So
    // "after li2" is TWO close tokens from `li2b.to` — the same visual gap
    // line, two levels out, which is precisely what a one-level test misses.
    const li2b = rangeOf("li2b");
    const ul2 = rangeOf("ul2");
    const li2 = rangeOf("li2");
    expect(isSelfGapInsert(doc, li2b, ul2.to)).toBe(true);
    expect(isSelfGapInsert(doc, li2b, li2.to)).toBe(true);
  });

  it("CONTROL — a boundary with real content between it and the source is NOT self", () => {
    // The whole reason the model rule cannot reach the reported headline: a
    // MIDDLE item's list boundary is a genuine outdent.
    const li2 = rangeOf("li2");
    const ul1 = rangeOf("ul1");
    expect(isSelfGapInsert(doc, li2, ul1.from)).toBe(false);
    expect(isSelfGapInsert(doc, li2, ul1.to)).toBe(false);
    // …and a first item's own list boundary is self while the OTHER end is not.
    const li1 = rangeOf("li1");
    expect(isSelfGapInsert(doc, li1, ul1.to)).toBe(false);
  });

  it("CONTROL — a NESTED first item's outer boundaries stay real landings", () => {
    // `li2a` opens `ul2`, but `ul2` is not `li2`'s only child (`li2` opens with
    // its own paragraph), so `li2`'s boundaries have content in between.
    const li2a = rangeOf("li2a");
    const ul2 = rangeOf("ul2");
    const li2 = rangeOf("li2");
    expect(isSelfGapInsert(doc, li2a, ul2.from)).toBe(true);
    expect(isSelfGapInsert(doc, li2a, li2.from)).toBe(false);
  });

  it("CONTROL — an unrelated block's boundary is never self", () => {
    const li1 = rangeOf("li1");
    const pA = rangeOf("pA");
    const pB = rangeOf("pB");
    expect(isSelfGapInsert(doc, li1, pA.from)).toBe(false);
    expect(isSelfGapInsert(doc, li1, pB.to)).toBe(false);
  });

  it("an out-of-range position answers NOT self rather than throwing", () => {
    const li1 = rangeOf("li1");
    expect(isSelfGapInsert(doc, li1, -1)).toBe(false);
    expect(isSelfGapInsert(doc, li1, doc.content.size + 5)).toBe(false);
  });

  it("a source in ANOTHER editor is never self here", () => {
    const li1 = rangeOf("li1");
    const editorA = { state: { doc } } as unknown as Editor;
    const editorB = { state: { doc } } as unknown as Editor;
    const range = { editor: editorB, ...li1 };
    expect(isSelfDrop(editorA, range, li1.from, null)).toBe(false);
    expect(isSelfDrop(editorB, range, li1.from, null)).toBe(true);
    expect(isSelfDrop(editorA, null, li1.from, null)).toBe(false);
  });

  it("the GAP LINE is a no-op only where the landing FABRICATES a wrapper", () => {
    // The conjunction, and the reason the gap line alone is too strong.
    const editor = { state: { doc, schema } } as unknown as Editor;
    const nodeOf = (uuid: string): PMNode => {
      let out: PMNode | null = null;
      doc.descendants((n) => {
        if (out) return false;
        if (n.attrs?.uuid === uuid) {
          out = n;
          return false;
        }
        return true;
      });
      if (!out) throw new Error(uuid);
      return out;
    };
    const li1 = rangeOf("li1");
    const ul1 = rangeOf("ul1");
    // FABRICATES: `doc` cannot hold a bare `listItem`, so the wrap rung mints a
    // `bulletList` — the source's own parent kind, at the source's own indent,
    // so the page renders identically and only the list identity changes.
    expect(isSelfDrop(editor, { editor, ...li1 }, ul1.from, nodeOf("li1"))).toBe(
      true,
    );
    // DIRECT: `li2b` outdenting from the nested list into `ul1` lands on the
    // same gap line and is a REAL move — `bulletList` accepts a `listItem`
    // directly, so the item visibly dedents into a container that already
    // exists. Refusing this would break the shipped outdent.
    const li2b = rangeOf("li2b");
    const li2 = rangeOf("li2");
    expect(isSelfGapInsert(doc, li2b, li2.to)).toBe(true);
    expect(
      isSelfDrop(editor, { editor, ...li2b }, li2.to, nodeOf("li2b")),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// The gesture rule, driven through the REAL controller
// ─────────────────────────────────────────────────────────────────────

const CARD_KEY = buildFloatKey({ domain: "card", kind: "note", id: "n1" });
const ORIGIN = { x: 300, y: 400 };

const fakeEditor = {
  state: {},
  view: { dispatch() {}, dom: document.createElement("div") },
} as unknown as Editor;

const move = (x: number, y: number) =>
  window.dispatchEvent(
    new MouseEvent("mousemove", { clientX: x, clientY: y, buttons: 1 }),
  );

/** Let a scheduled frame (rAF, or the setTimeout net behind it) run. */
const frame = () => new Promise((r) => setTimeout(r, 40));

beforeEach(() => {
  hitTestCalls.length = 0;
  setDropCtx({
    mainEditor: fakeEditor,
    closePopout: () => {},
    confirm: async () => true,
  } as unknown as DropCtx);
});

afterEach(() => {
  cancelDropSession();
  setDropCtx(null);
});

describe("the origin dead zone — a release at the grab point is a CANCEL", () => {
  it("the radius is at least the largest producer's own drag threshold", () => {
    // Sized from the producers, so the dead zone is never smaller than the
    // movement that turned the press into a drag: 5 px for the grab-handle
    // lift, 8 px for the in-text inline-atom grab.
    expect(ORIGIN_DEAD_ZONE_PX).toBeGreaterThanOrEqual(8);
    expect(withinOriginDeadZone(ORIGIN, ORIGIN.x, ORIGIN.y)).toBe(true);
    expect(withinOriginDeadZone(ORIGIN, ORIGIN.x + 3, ORIGIN.y - 4)).toBe(true);
    expect(withinOriginDeadZone(ORIGIN, ORIGIN.x + 40, ORIGIN.y)).toBe(false);
  });

  it("a pointer still at the grab point offers NO placement, and no hit-test runs", async () => {
    expect(
      beginDropSession({
        cardKey: CARD_KEY,
        origin: ORIGIN,
        externalCommit: true,
      }),
    ).toBe(true);
    move(ORIGIN.x + 2, ORIGIN.y + 2);
    await frame();
    expect(getDropSession()?.placement).toBeNull();
    expect(hitTestCalls).toHaveLength(0);
  });

  it("CONTROL — a pointer that has LEFT the grab point is offered one", async () => {
    beginDropSession({
      cardKey: CARD_KEY,
      origin: ORIGIN,
      externalCommit: true,
    });
    move(ORIGIN.x + 200, ORIGIN.y + 200);
    await frame();
    expect(hitTestCalls).toHaveLength(1);
    expect(getDropSession()?.placement).not.toBeNull();
  });

  it("travel away and come back — the offer is WITHDRAWN as the pointer comes home", async () => {
    // The case the model rule cannot reach and the one Gabriel names: the user
    // decided against the move. The indicator must go, so the release cancels
    // instead of committing the landing the bar was still promising.
    beginDropSession({
      cardKey: CARD_KEY,
      origin: ORIGIN,
      externalCommit: true,
    });
    move(ORIGIN.x + 200, ORIGIN.y + 200);
    await frame();
    expect(getDropSession()?.placement).not.toBeNull();

    move(ORIGIN.x + 1, ORIGIN.y - 1);
    await frame();
    expect(getDropSession()?.placement).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// The census — the leg with teeth
// ─────────────────────────────────────────────────────────────────────

const SRC = join(process.cwd(), "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/**
 * The population is DISCOVERED, never listed — every production module in the
 * drop-mode tree. A hand list inside the guard that polices hand-derived rules
 * is the same defect one level up: it can only be missing the file that drifted.
 */
function dropModeFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(join(SRC, rel), { withFileTypes: true })) {
      if (e.name === "__tests__") continue;
      const next = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(next);
      else if (/\.tsx?$/.test(e.name)) out.push(next);
    }
  };
  walk("components/drop-mode");
  return out;
}

/** Source with comments blanked — the drift lives in code, and this file's own
 *  prose names every needle it greps for. */
function codeOf(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/** Does this module DECLARE a source range (not merely mention one)? */
const declaresSourceRange = (rel: string) =>
  /(^|\s)sourceRangeFor\s*:/m.test(codeOf(rel));

describe("census — every door asks the SSOT, and nothing re-derives it", () => {
  it("the controller resolves the source range once and threads it to the hit-test", () => {
    // `hitTest`'s parameter is REQUIRED, so dropping it is a type error — but
    // passing `null` where the session's range belongs compiles perfectly and
    // silently restores the pre-480 affordance. Only a source read can see it.
    const s = read("components/drop-mode/controller.ts");
    expect(s).toContain("resolveSessionSourceRange(spec, opts.cardKey, ctx)");
    expect(s).toContain("session.sourceRange");
    expect(s).toContain("withinOriginDeadZone(session.origin");
  });

  it("the hit-test threads it into the candidate FILTER", () => {
    const s = read("components/drop-mode/hit-test.ts");
    const call = s.slice(
      s.indexOf("filterInsertCandidates("),
      s.indexOf("filterInsertCandidates(") + 220,
    );
    expect(call).toContain("blockPayload");
    expect(call).toContain("sourceRange");
  });

  it("every spec that declares a source range reads the SHARED self-drop door", () => {
    // Membership is DISCOVERED: a spec that declares `sourceRangeFor` has an
    // in-document source, so its `planDrop` owes the same rule the hover reads.
    const declaring = dropModeFiles().filter(declaresSourceRange);
    expect(declaring.sort()).toEqual([
      "components/drop-mode/specs/textobject.ts",
      "components/drop-mode/util/block-move.ts",
    ]);
    for (const f of declaring) {
      expect(codeOf(f), f).toContain("isSelfDrop(");
    }
  });

  it("nothing outside the SSOT re-derives the own-range test", () => {
    // The pre-480 shape, in all three of the places it lived:
    //   `placement.insertPos >= src.from && placement.insertPos <= src.to`
    // A re-fork type-checks, runs, and answers the narrower question.
    const offenders = dropModeFiles()
      // The SSOT itself IS the rule, and its first rung is exactly this shape.
      .filter((f) => f !== "components/drop-mode/self-drop.ts")
      .filter((f) => /insertPos\s*>=\s*[\w.]+\.from/.test(codeOf(f)));
    expect(offenders).toEqual([]);
    // …and the canary: the needle DOES match the retired shape.
    expect(
      /insertPos\s*>=\s*[\w.]+\.from/.test(
        "if (placement.insertPos >= src.from && placement.insertPos <= src.to) {",
      ),
    ).toBe(true);
  });

  it("the TEXT-SLICE spec deliberately keeps the narrow test, and says why", () => {
    // Scoping, not an omission: the self-GAP rule presupposes the payload IS
    // the node whose boundary the gap is, and a slice is not — moving the first
    // words of a paragraph into the gap above it materializes a new one.
    const rel = "components/drop-mode/specs/text-range-move.ts";
    expect(declaresSourceRange(rel)).toBe(false);
    // …and the reason is stated where the narrow test lives, not inferred from
    // its absence.
    expect(read(rel)).toContain("task 480");
  });
});
