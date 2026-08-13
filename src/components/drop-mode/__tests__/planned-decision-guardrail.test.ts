// @vitest-environment jsdom
/**
 * Task 321 — **a drop spec's DECISION is derived from its PLAN, never restated
 * beside it.**
 *
 * The defect: every refusal a drop spec owns lived only in `applyDrop`, as a
 * bare `return` — the registry adapter's task-065 `no-op`, a wrapper that
 * cannot hold the node, the container fit's `reject`, a rehydrate that threw, a
 * `ctx` sub-bag that isn't wired in this doc. `classifyDrop` knew none of it, so
 * for a gesture the spec would refuse the user saw a valid green landing bar,
 * released, and the controller ran `finishApply` — which set `applied = true`
 * because nothing THREW, and fired `postDrop: "close"`. The popped-out float
 * vanished and the document was unchanged, with no toast, no cursor change,
 * nothing. It read as "it worked and then disappeared."
 *
 * Nothing could catch it: the spec was registered, the hit-test was honest about
 * the geometry, the commit ran, the document stayed valid, and two suites
 * actively PINNED the wrong half — `sub-item-drop-resolution.test.ts` asserted
 * `{kind:"apply"}` for a placement whose apply dispatched nothing, in the same
 * `it()` block, three lines apart. A test of either door alone structurally
 * cannot see this: each was correct about its own half of a question only one of
 * them could answer.
 *
 * Four legs, in the order they'd catch a regression:
 *
 *  1. **CENSUS (source)** — a `fitNodesAtInsert(` call is the concrete carrier
 *     of a refusal `classifyDrop` cannot predict, so every file under
 *     `src/components/drop-mode/` that makes one must build its spec through
 *     `plannedDropSpec`. A new spec that adds a fit and hand-writes two doors
 *     fails here.
 *  2. **CENSUS (runtime)** — every spec a drag can dispatch either exposes
 *     `planDrop` or sits on `PERMITTED_HAND_WRITTEN_DECISIONS` with a stated
 *     reason its two doors cannot disagree. Asked of the LIVE SPEC OBJECTS, for
 *     the reasons `placement-reachability.test.ts` gives: 13 of the ~17 specs are
 *     authored outside this directory, and the method-shorthand spelling defeats
 *     a grep.
 *  3. **FACTORY** — the derivation itself: null ⇒ `no-op` and no commit;
 *     non-null ⇒ `apply` and exactly one commit; and `applyDrop` RE-PLANS rather
 *     than reusing the plan `classifyDrop` built.
 *  4. **BEHAVIOUR** — the real specs against a container that genuinely refuses:
 *     `classifyDrop` reports `no-op` and `applyDrop` dispatches nothing, with a
 *     control case at a gap that accepts, so the legs can't pass vacuously.
 *
 * **Two limits, stated rather than implied** — a guard that overstates its reach
 * is the failure mode this file is about. (a) Leg 1 asks its question per FILE,
 * so a module that imports the factory for one spec and hand-writes a second one
 * carrying the fit still reads clean; the per-SITE version of that question is
 * `container-fit-guardrail`'s, and leg 2 catches the case that matters (a spec
 * reachable from the registry). (b) Leg 1 walks `src/components/drop-mode/` only,
 * so a fit inside a `src/panels/<Panel>/drop-spec.ts` is invisible to it — leg 2
 * is the coverage there, since every card kind's spec is censused off
 * `CARD_REGISTRY` whatever file it was authored in.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { commentsStripped } from "@/lib/__tests__/_source-scan";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";

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

import { hasDerivedDecision, plannedDropSpec } from "../planned-spec";
import { fitNodesAtInsert } from "../specs/drop-context";
import { MODULE_DROP_SPECS } from "../registry";
// Leg 4 drives these three directly (leg 2 reaches every spec through the
// registry surface above).
import { textObjectDropSpec } from "../specs/textobject";
import { textRangeMoveDropSpec } from "../specs/text-range-move";
import { stackPullDropSpec } from "../specs/stack-pull";
import { blockMoveSpec } from "../util/block-move";
import type {
  DropCtx,
  DropPlan,
  DropSpec,
  Placement,
  StackPullApi,
} from "../types";
import { CARD_REGISTRY } from "@/cards/card-registry";
import type { CardKind } from "@/cards/types";
import { STACK_PULL_PREFIX, STACK_STORAGE_KEY } from "@/lib/stack/types";
import type { StackItem, StackPayload } from "@/lib/stack/types";
// Side-effect: fold every card kind's DropSpec onto CARD_REGISTRY[kind].dropSpec.
import "@/cards/drop-specs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DROP_MODE = path.resolve(HERE, "..");

// ── Leg 1 — the source census ───────────────────────────────────────────────

/**
 * A file may appear here only if it calls the container fit and genuinely
 * cannot fork its decision. **Empty, and a hit is CONVERT-it, not list-it**: a
 * fit that can `reject` inside a hand-written `applyDrop` IS the task-321 shape.
 */
const PERMITTED_UNPLANNED_FITS: Record<string, string> = {};

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "__fixtures__") continue;
      out.push(...walkSource(full));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Both needles run against COMMENTS-STRIPPED source, through the shared
 * one-pass scanner (`_source-scan.ts`). This is the fourth census in the repo to
 * need that, and the first three each re-derived it wrong — a prose header that
 * merely NAMES `plannedDropSpec` ("unlike `plannedDropSpec`, this spec resolves
 * at commit…") would otherwise vouch for a file that hand-writes both doors
 * around a fit. String literals are kept: neither needle can hide in one, and
 * blanking them is how task 205's leg became unfalsifiable.
 */
function code(rel: string): string {
  return commentsStripped(readFileSync(path.join(DROP_MODE, rel), "utf8"));
}

/** Files that CALL `fitNodesAtInsert` (the declaration itself doesn't count). */
export function filesCallingContainerFit(root = DROP_MODE): string[] {
  const hits: string[] = [];
  for (const full of walkSource(root)) {
    const rel = path.relative(root, full).split(path.sep).join("/");
    const src = commentsStripped(readFileSync(full, "utf8"));
    const calls = src
      .split("\n")
      .some(
        (l) =>
          /\bfitNodesAtInsert\s*\(/.test(l) &&
          !/function\s+fitNodesAtInsert/.test(l),
      );
    if (calls) hits.push(rel);
  }
  return hits.sort();
}

/** A CALL, not a mention — `plannedDropSpec(` in real code. */
function referencesPlannedFactory(rel: string): boolean {
  return /\bplannedDropSpec\s*\(/.test(code(rel));
}

describe("census — a spec that can refuse states ONE resolution", () => {
  it("the census can see something (it isn't blind)", () => {
    const files = filesCallingContainerFit();
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(files).toContain("specs/textobject.ts");
    expect(files).toContain("util/block-move.ts");
    // The fit's own DECLARATION is not a call site.
    expect(files).not.toContain("specs/drop-context.ts");
  });

  it("CANARY — the factory needle can answer NO", () => {
    // A leg that only ever reports `true` would pass this census forever. Two
    // real files answer either way: `drop-context.ts` never calls the factory,
    // `specs/textobject.ts` does.
    expect(referencesPlannedFactory("specs/drop-context.ts")).toBe(false);
    expect(referencesPlannedFactory("specs/textobject.ts")).toBe(true);
    // …and a mention in PROSE does not vouch for a file (the shape that made
    // three earlier censuses in this repo unsound).
    expect(
      /\bplannedDropSpec\s*\(/.test(
        commentsStripped("// unlike plannedDropSpec(opts), this one is bespoke\nconst x = 1;"),
      ),
    ).toBe(false);
  });

  it("every drop-mode file that calls fitNodesAtInsert builds through plannedDropSpec", () => {
    // If this fails: your `applyDrop` can refuse (the fit returns `reject`) in a
    // way `classifyDrop` cannot see, so the controller will report the drop as
    // applied — closing the popped-out float over an untouched document. State
    // ONE `planDrop` that resolves the refusal and pass it to `plannedDropSpec`
    // (planned-spec.ts); both doors are derived from it.
    const unplanned = filesCallingContainerFit().filter(
      (rel) => !referencesPlannedFactory(rel) && !(rel in PERMITTED_UNPLANNED_FITS),
    );
    expect(unplanned).toEqual([]);
  });

  it("every allowlist entry still names a file that still calls the fit", () => {
    for (const rel of Object.keys(PERMITTED_UNPLANNED_FITS)) {
      expect(filesCallingContainerFit()).toContain(rel);
    }
  });
});

// ── Leg 2 — the runtime census ──────────────────────────────────────────────

/**
 * Specs whose two doors are written by hand. An entry is a claim that they
 * CANNOT disagree — every refusal in `applyDrop` has a one-for-one twin in
 * `classifyDrop`, asked of the same values.
 */
const PERMITTED_HAND_WRITTEN_DECISIONS: Record<string, string> = {
  // `inlineAtomMoveSpec` — symmetric by construction: one shared `resolve`
  // closure for the move branch, and the create branch's decline is decided by
  // the same pure `buildCreateNode` probe on both sides.
  "CARD_REGISTRY.footnote": "inlineAtomMoveSpec — shared resolve + create probe",
  "CARD_REGISTRY.citation": "inlineAtomMoveSpec — shared resolve + create probe",
  "atom-grab": "inlineAtomMoveSpec — shared resolve + create probe",
  // `textObjectSideReanchorSpec` — every `applyDrop` guard (kind, `!api`,
  // `!id || !exists`) has a one-for-one twin in `classifyDrop`, read off the
  // same `getApi(ctx)`. It is also the repo's only `confirm` producer, so no
  // path exists where the user agrees and nothing happens.
  "CARD_REGISTRY.note": "textObjectSideReanchorSpec — mirrored guards",
  "CARD_REGISTRY.highlight": "textObjectSideReanchorSpec — mirrored guards",
  "CARD_REGISTRY.todo": "textObjectSideReanchorSpec — mirrored guards",
  "CARD_REGISTRY.archive": "textObjectSideReanchorSpec — mirrored guards",
  "CARD_REGISTRY.report": "textObjectSideReanchorSpec — mirrored guards",
  "CARD_REGISTRY.report-request": "textObjectSideReanchorSpec — mirrored guards",
  "CARD_REGISTRY.revision-comment": "textObjectSideReanchorSpec — mirrored guards",
  "CARD_REGISTRY.revision-suggestion":
    "textObjectSideReanchorSpec — mirrored guards",
  "CARD_REGISTRY.cutter-comment": "textObjectSideReanchorSpec — mirrored guards",
  "CARD_REGISTRY.cutter-suggestion": "textObjectSideReanchorSpec — mirrored guards",
};

/** Every spec a drag session can dispatch — `registry.ts`'s whole surface. The
 *  module half is read from `MODULE_DROP_SPECS` (which derives its transient
 *  entries from the dispatch table itself), so a fifth transient spec joins this
 *  census and `placement-reachability`'s without anyone extending a list. */
function allSpecs(): Array<{ name: string; spec: DropSpec }> {
  const out: Array<{ name: string; spec: DropSpec }> = [];
  for (const k of Object.keys(CARD_REGISTRY) as CardKind[]) {
    const spec = CARD_REGISTRY[k].dropSpec;
    if (spec) out.push({ name: `CARD_REGISTRY.${k}`, spec });
  }
  out.push(...MODULE_DROP_SPECS);
  return out;
}

describe("census — every dispatchable spec derives its decision or justifies not", () => {
  const specs = allSpecs();

  it("censuses a non-trivial set of specs", () => {
    expect(specs.length).toBeGreaterThanOrEqual(8);
    expect(specs.map((s) => s.name)).toContain("textObjectDropSpec");
  });

  it("each spec exposes planDrop, or is allowlisted with a reason", () => {
    const unaccounted = specs
      .filter((s) => !hasDerivedDecision(s.spec))
      .map((s) => s.name)
      .filter((name) => !(name in PERMITTED_HAND_WRITTEN_DECISIONS))
      .sort();
    expect(unaccounted).toEqual([]);
  });

  it("the four move/pull specs are PLANNED (not merely allowlisted)", () => {
    // The specs whose refusals produced the bug. Pinned by name so a future
    // "simplification" back to two hand-written doors can't quietly land by
    // adding an allowlist entry.
    for (const name of [
      "textObjectDropSpec",
      "textRangeMoveDropSpec",
      "stack-pull",
      "CARD_REGISTRY.example",
    ]) {
      const spec = specs.find((s) => s.name === name);
      expect({ name, derived: !!spec && hasDerivedDecision(spec.spec) }).toEqual({
        name,
        derived: true,
      });
      expect(name in PERMITTED_HAND_WRITTEN_DECISIONS).toBe(false);
    }
  });

  it("the allowlist can only shrink — every entry names a censused spec", () => {
    const names = new Set(specs.map((s) => s.name));
    for (const name of Object.keys(PERMITTED_HAND_WRITTEN_DECISIONS)) {
      expect({ name, censused: names.has(name) }).toEqual({
        name,
        censused: true,
      });
    }
  });
});

// ── Leg 3 — the derivation itself ───────────────────────────────────────────

const nowhere = { kind: "between-blocks", editor: null, insertPos: 0, rect: { x: 0, y: 0, width: 0, height: 0 } } as unknown as Placement;
const emptyCtx = {} as unknown as DropCtx;

describe("plannedDropSpec — the decision IS the plan", () => {
  it("a refused plan classifies as no-op and commits nothing", () => {
    // ONE spec, toggled — so "no commits" is a property of the refusal and not
    // of a planner that had no commit to give.
    let refuse = true;
    const commits: string[] = [];
    const spec = plannedDropSpec({
      allowedPlacements: ["between-blocks"],
      targetScope: "any-editor",
      postDrop: "close",
      planDrop: () => (refuse ? null : { commit: () => commits.push("ran") }),
    });

    expect(spec.classifyDrop(nowhere, "k", emptyCtx)).toEqual({ kind: "no-op" });
    spec.applyDrop(nowhere, "k", emptyCtx);
    expect(commits).toEqual([]);

    refuse = false;
    expect(spec.classifyDrop(nowhere, "k", emptyCtx)).toEqual({ kind: "apply" });
    spec.applyDrop(nowhere, "k", emptyCtx);
    expect(commits).toEqual(["ran"]);
  });

  it("a resolved plan classifies as apply and commits exactly once", () => {
    let commits = 0;
    const plan: DropPlan = { commit: () => void commits++ };
    const spec = plannedDropSpec({
      allowedPlacements: ["between-blocks"],
      targetScope: "any-editor",
      postDrop: "close",
      planDrop: () => plan,
    });
    expect(spec.classifyDrop(nowhere, "k", emptyCtx)).toEqual({ kind: "apply" });
    expect(commits).toBe(0); // classifying must not commit
    spec.applyDrop(nowhere, "k", emptyCtx);
    expect(commits).toBe(1);
  });

  it("applyDrop RE-PLANS — it never commits the plan classifyDrop built", () => {
    // The two doors are separated by an `await` on the confirm path, so a
    // transaction built at classify time could be dispatched against a document
    // that has moved on. The plan is cheap (once per gesture, never per hover
    // frame), so the safe order is the free one.
    const committed: number[] = [];
    let generation = 0;
    const spec = plannedDropSpec({
      allowedPlacements: ["between-blocks"],
      targetScope: "any-editor",
      postDrop: "close",
      planDrop: () => {
        const mine = ++generation;
        return { commit: () => committed.push(mine) };
      },
    });
    spec.classifyDrop(nowhere, "k", emptyCtx); // generation 1, discarded
    spec.applyDrop(nowhere, "k", emptyCtx); // generation 2, the one that runs
    expect(committed).toEqual([2]);
  });

  it("a planner that THROWS is a refusal, on BOTH doors", () => {
    // The containment leg. `planDrop` runs from `classifyDrop` too, and that
    // door's caller (`commitDropSession`) has no `try` — and is `async`, so an
    // escaped throw becomes a rejected promise at `void commitDropSession()`
    // and at LiftHost's two `await`s, leaving the session, its window
    // listeners, the body attr and the lift overlay alive after mouseup.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const spec = plannedDropSpec({
      allowedPlacements: ["between-blocks"],
      targetScope: "any-editor",
      postDrop: "close",
      planDrop: () => {
        throw new Error("planner exploded");
      },
    });
    expect(spec.classifyDrop(nowhere, "k", emptyCtx)).toEqual({ kind: "no-op" });
    expect(() => spec.applyDrop(nowhere, "k", emptyCtx)).not.toThrow();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("BRANDED — a spec that overrides a derived door is not a planned spec", () => {
    // Publishing `planDrop` alone is not enough: `{ ...plannedDropSpec(opts),
    // applyDrop(…) { /* hand-written */ } }` carries the field while running two
    // independent doors again — the original shape, with CI green. Leg 2 asks
    // `hasDerivedDecision`, which compares both door identities.
    const planned = plannedDropSpec({
      allowedPlacements: ["between-blocks"],
      targetScope: "any-editor",
      postDrop: "close",
      planDrop: () => null,
    });
    expect(hasDerivedDecision(planned)).toBe(true);

    const forked: DropSpec = { ...planned, applyDrop: () => {} };
    expect(typeof forked.planDrop).toBe("function"); // still published…
    expect(hasDerivedDecision(forked)).toBe(false); // …but no longer derived.
  });

  it("the planner is published on the built spec (leg 2 reads it)", () => {
    const spec = plannedDropSpec({
      allowedPlacements: ["between-blocks"],
      targetScope: "any-editor",
      postDrop: "close",
      planDrop: () => null,
    });
    expect(typeof spec.planDrop).toBe("function");
    expect(spec.postDrop).toBe("close");
    expect(spec.targetScope).toBe("any-editor");
  });
});

// ── Leg 4 — the real specs against a container that refuses ─────────────────

/**
 * A schema whose `strictList` can hold NOTHING but `strictItem`s, and whose
 * names are deliberately absent from both `TEXT_OBJECT_REGISTRY` and the
 * container fit's wrap vocabulary — so a paragraph released in a `strictList`
 * gap is refused at every rung of the ladder: the parent rejects it bare, no
 * wrapper in the vocabulary exists here, and the trial insert TEARS the list
 * (the fitter can only place the paragraph by closing the container).
 */
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { uuid: { default: null } },
      toDOM: () => ["p", 0],
    },
    strictList: {
      group: "block",
      content: "strictItem+",
      attrs: { uuid: { default: null } },
      toDOM: () => ["ul", 0],
    },
    strictItem: {
      content: "paragraph",
      attrs: { uuid: { default: null } },
      toDOM: () => ["li", 0],
    },
    text: { group: "inline" },
  },
  marks: {
    linkedAnchor: {
      attrs: { anchorId: {}, kind: { default: null } },
      toDOM: () => ["span", 0],
    },
  },
});

const t = (text: string, marks?: import("@tiptap/pm/model").Mark[]) =>
  schema.text(text, marks);
const anchorMark = (id: string) =>
  schema.marks.linkedAnchor.create({ anchorId: id, kind: "transient" });
const para = (uuid: string | null, ...inline: PMNode[]) =>
  schema.nodes.paragraph.create({ uuid }, inline);
const sItem = (text: string) =>
  schema.nodes.strictItem.create(null, para(null, t(text)));
const strictList = (...items: PMNode[]) =>
  schema.nodes.strictList.create({ uuid: "SL" }, items);

function mockEditor(d: PMNode) {
  const dispatched: Transaction[] = [];
  const state = EditorState.create({ schema, doc: d });
  const editor = {
    state,
    schema,
    view: { dispatch: (tr: Transaction) => dispatched.push(tr), focus: () => {} },
  } as unknown as Editor;
  return { editor, dispatched, ctx: { mainEditor: editor } as unknown as DropCtx };
}

const rect = { x: 0, y: 0, width: 0, height: 0 };
const gap = (editor: Editor, insertPos: number): Placement => ({
  kind: "between-blocks",
  editor,
  insertPos,
  rect,
});

/** doc( p#src "move me", strictList( item, item ), p "tail" ) */
function refusingDoc(sourceInline: PMNode[]) {
  return schema.nodes.doc.create(null, [
    para("SRC", ...sourceInline),
    strictList(sItem("one"), sItem("two")),
    para("TAIL", t("tail")),
  ]);
}

/** The gap between the two strict items — a position no payload here can fill. */
function refusedPos(d: PMNode): number {
  const listStart = d.firstChild!.nodeSize;
  return listStart + 1 + d.child(1).firstChild!.nodeSize;
}

/** A top-level gap that accepts anything — the control. */
function acceptedPos(d: PMNode): number {
  return d.firstChild!.nodeSize + d.child(1).nodeSize;
}

describe("the refusing fixture refuses for the RIGHT reason", () => {
  it("the container fit rejects at the strict-item gap and accepts at the top-level one", () => {
    // Without this the legs below could pass for a reason that has nothing to
    // do with the fit — an unresolvable key, an out-of-range position — and a
    // `no-op` assertion would be satisfied by a broken fixture.
    const d = refusingDoc([t("move me")]);
    const { editor } = mockEditor(d);
    const payload = [para(null, t("payload"))];
    expect(fitNodesAtInsert(editor, refusedPos(d), payload).kind).toBe("reject");
    expect(fitNodesAtInsert(editor, acceptedPos(d), payload).kind).toBe("ok");
  });
});

describe("a refused drop is a no-op DECISION, not a silent apply", () => {
  it("textObjectDropSpec — refuses, and still accepts at a gap that fits", () => {
    const d = refusingDoc([t("move me")]);
    const { editor, dispatched, ctx } = mockEditor(d);
    const KEY = "textobject:paragraph:SRC";

    expect(
      textObjectDropSpec.classifyDrop(gap(editor, refusedPos(d)), KEY, ctx),
    ).toEqual({ kind: "no-op" });
    textObjectDropSpec.applyDrop(gap(editor, refusedPos(d)), KEY, ctx);
    expect(dispatched).toHaveLength(0);

    // Control — the same payload at a top-level gap still applies and dispatches,
    // so the leg above is a refusal and not a broken spec.
    expect(
      textObjectDropSpec.classifyDrop(gap(editor, acceptedPos(d)), KEY, ctx),
    ).toEqual({ kind: "apply" });
    textObjectDropSpec.applyDrop(gap(editor, acceptedPos(d)), KEY, ctx);
    expect(dispatched).toHaveLength(1);
  });

  it("blockMoveSpec — refuses, and still accepts at a gap that fits", () => {
    const d = refusingDoc([t("move me")]);
    const { editor, dispatched, ctx } = mockEditor(d);
    const spec = blockMoveSpec({ nodeName: "paragraph" });
    const KEY = "paragraph:SRC";

    expect(spec.classifyDrop(gap(editor, refusedPos(d)), KEY, ctx)).toEqual({
      kind: "no-op",
    });
    spec.applyDrop(gap(editor, refusedPos(d)), KEY, ctx);
    expect(dispatched).toHaveLength(0);

    expect(spec.classifyDrop(gap(editor, acceptedPos(d)), KEY, ctx)).toEqual({
      kind: "apply",
    });
    spec.applyDrop(gap(editor, acceptedPos(d)), KEY, ctx);
    expect(dispatched).toHaveLength(1);
  });

  it("textRangeMoveDropSpec — refuses, and still accepts at a gap that fits", () => {
    const d = refusingDoc([t("keep "), t("MOVE", [anchorMark("a1")])]);
    const { editor, dispatched, ctx } = mockEditor(d);
    const KEY = "textobject:linkedRange:a1";

    expect(
      textRangeMoveDropSpec.classifyDrop(gap(editor, refusedPos(d)), KEY, ctx),
    ).toEqual({ kind: "no-op" });
    textRangeMoveDropSpec.applyDrop(gap(editor, refusedPos(d)), KEY, ctx);
    expect(dispatched).toHaveLength(0);

    expect(
      textRangeMoveDropSpec.classifyDrop(gap(editor, acceptedPos(d)), KEY, ctx),
    ).toEqual({ kind: "apply" });
    textRangeMoveDropSpec.applyDrop(gap(editor, acceptedPos(d)), KEY, ctx);
    expect(dispatched).toHaveLength(1);
  });
});

// ── Leg 4b — stack-pull's own refusals ──────────────────────────────────────

const STACK_KEY = `${STACK_PULL_PREFIX}:item-1`;

function seedStack(payload: StackPayload) {
  const item: StackItem = {
    id: "item-1",
    capturedAt: "2026-08-11T00:00:00.000Z",
    source: { docId: null },
    payload,
  };
  localStorage.setItem(
    STACK_STORAGE_KEY,
    JSON.stringify({ version: 1, items: [item] }),
  );
}

function stackCtx(editor: Editor, withApi: boolean): {
  ctx: DropCtx;
  calls: string[];
} {
  const calls: string[] = [];
  const rec =
    (m: string) =>
    (...args: unknown[]) => {
      void args;
      calls.push(m);
      return { id: "new" } as never;
    };
  const stack: StackPullApi = {
    addNote: rec("addNote"),
    addHighlight: rec("addHighlight"),
    addTodo: rec("addTodo"),
    addArchive: rec("addArchive"),
    addRevisionComment: rec("addRevisionComment"),
    addRevisionSuggestion: rec("addRevisionSuggestion"),
    addCutterComment: rec("addCutterComment"),
    addCutterSuggestion: rec("addCutterSuggestion"),
    addFootnote: rec("addFootnote"),
    addCitation: rec("addCitation"),
    upsertBibEntry: rec("upsertBibEntry"),
    // A READ, not a factory: deliberately unrecorded, so the per-kind
    // derivations below stay a census of what a branch CREATES (task 235).
    getAnnotation: () => "",
    setAnnotation: rec("setAnnotation"),
  };
  return {
    ctx: {
      mainEditor: editor,
      ...(withApi ? { stack } : {}),
    } as unknown as DropCtx,
    calls,
  };
}

describe("stack-pull refusals reach the decision too", () => {
  it("a paragraph payload the container cannot hold classifies no-op", () => {
    const d = refusingDoc([t("x")]);
    const { editor, dispatched } = mockEditor(d);
    seedStack({ kind: "paragraph", node: { type: "paragraph" } } as StackPayload);
    const { ctx } = stackCtx(editor, true);

    expect(
      stackPullDropSpec.classifyDrop(gap(editor, refusedPos(d)), STACK_KEY, ctx),
    ).toEqual({ kind: "no-op" });
    stackPullDropSpec.applyDrop(gap(editor, refusedPos(d)), STACK_KEY, ctx);
    expect(dispatched).toHaveLength(0);

    // Control — the same payload at a top-level gap still lands.
    expect(
      stackPullDropSpec.classifyDrop(gap(editor, acceptedPos(d)), STACK_KEY, ctx),
    ).toEqual({ kind: "apply" });
    stackPullDropSpec.applyDrop(gap(editor, acceptedPos(d)), STACK_KEY, ctx);
    expect(dispatched).toHaveLength(1);
  });

  it("a card pull into a doc with NO ctx.stack classifies no-op (Reader mode)", () => {
    // Kind-independent and the broadest of the four: pre-fix, EVERY card kind
    // reported a successful pull in a doc that cannot host cards.
    const d = refusingDoc([t("x")]);
    const { editor } = mockEditor(d);
    seedStack({
      kind: "card",
      card: { cardKind: "note", data: {} },
    } as unknown as StackPayload);
    const { ctx, calls } = stackCtx(editor, false);

    expect(
      stackPullDropSpec.classifyDrop(gap(editor, acceptedPos(d)), STACK_KEY, ctx),
    ).toEqual({ kind: "no-op" });
    stackPullDropSpec.applyDrop(gap(editor, acceptedPos(d)), STACK_KEY, ctx);
    expect(calls).toEqual([]);

    // Control — the SAME seeded payload at the SAME position, with the sub-bag
    // wired, does create the card. Without this, a `seedStack` shape drift or a
    // renamed storage key would satisfy the leg above while proving nothing.
    const wired = stackCtx(editor, true);
    expect(
      stackPullDropSpec.classifyDrop(
        gap(editor, acceptedPos(d)),
        STACK_KEY,
        wired.ctx,
      ),
    ).toEqual({ kind: "apply" });
    stackPullDropSpec.applyDrop(gap(editor, acceptedPos(d)), STACK_KEY, wired.ctx);
    expect(wired.calls).toEqual(["addNote"]);
  });

  it("an EMPTY text slice is a refusal, not a blank paragraph", () => {
    // Pre-fix this branch had no size guard (its two siblings in
    // `text-range-move.ts` did) and failed in the WRONG direction: in a gap
    // `rangeSliceToBlocks` falls back to a fresh empty paragraph, so the pull
    // landed a blank block and reported success.
    const d = refusingDoc([t("x")]);
    const { editor, dispatched } = mockEditor(d);
    seedStack({ kind: "text", slice: { content: [] }, plain: "" } as StackPayload);
    const { ctx } = stackCtx(editor, true);

    expect(
      stackPullDropSpec.classifyDrop(gap(editor, acceptedPos(d)), STACK_KEY, ctx),
    ).toEqual({ kind: "no-op" });
    stackPullDropSpec.applyDrop(gap(editor, acceptedPos(d)), STACK_KEY, ctx);
    expect(dispatched).toHaveLength(0);

    // Control — a NON-empty slice through the same door lands, so the refusal
    // above is the size guard and not a broken lookup.
    seedStack({
      kind: "text",
      slice: { content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] },
      plain: "hi",
    } as unknown as StackPayload);
    expect(
      stackPullDropSpec.classifyDrop(gap(editor, acceptedPos(d)), STACK_KEY, ctx),
    ).toEqual({ kind: "apply" });
    stackPullDropSpec.applyDrop(gap(editor, acceptedPos(d)), STACK_KEY, ctx);
    expect(dispatched).toHaveLength(1);
  });
});
