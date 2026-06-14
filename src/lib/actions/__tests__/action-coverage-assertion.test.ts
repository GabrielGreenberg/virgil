// @vitest-environment jsdom
//
// CHIP 2 — the card-action registry rows + the armed coverage assertion.
//
// Mirrors `src/panels/__tests__/lifecycle-coverage-assertion.test.ts`: it arms
// the dev-only `assertActionCoverage` so `npx vitest run` fails if the 11 CARD
// rows ever drift from the contract this chip established — while ALSO proving
// the delegation seam and the applicability/scope logic that the live menus
// will read off in CHIP 3.
//
// WHAT IS PROVEN
//   1. the 11 card rows exist, keyed === id, category "card",
//      surfaces {grab, lightning}, with the right single-letter hint, matching
//      `CARD_ACTION_PRESENTATION` (the registry's OWN SSOT — CHIP 3 inverted
//      the dependency so the registry owns the presentation and the live menus
//      render off it; the former `MENU_ENTRIES` array is gone);
//   2. `run(ctx)` with a SPY dispatch forwards exactly `(id, ref)` — the whole
//      point of CHIP 2 (delegate, don't re-implement → zero behavior change);
//   3. `applies()` greys the right actions per representative kinds
//      (footnote/citation/suggest-edit disabled on a non-prose block like
//      displayMath/codeBlock; citation/delete disabled on titleField; highlight
//      disabled in cursor / no-range mode);
//   4. `resolveScope` returns the heading LINE for an annotation action and the
//      whole SECTION for a lifecycle action on the same heading;
//   5. `assertActionCoverage()` is GREEN for the card milestone.
//
// The extension barrel (pulled for the REAL schema in the resolveScope test)
// transitively imports `@/lib/storage`; stub it — same pattern as
// linked-range-writeback.test.ts.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { getSchema, type JSONContent } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  VIRGIL_ACTION_REGISTRY,
  assertActionCoverage,
  formatActionRows,
  type ActionContext,
  type ActionId,
  type ActionRef,
  type ActionSpec,
} from "@/lib/actions/action-registry";
import {
  CARD_ACTION_PRESENTATION,
  CARD_ACTION_ORDER,
} from "@/lib/actions/action-icons";
import type { DragHandleAction } from "@/components/DragHandleMenu";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const CARD_IDS = [
  "highlight", "note", "footnote", "citation", "todo", "suggest-edit",
  "cutter", "report", "duplicate", "archive", "delete",
] as const;

// CHIP 5a — the 4 heading rows, in level order (the order the registry appends
// them after the card slice).
const HEADING_IDS = [
  "heading-chapter", "heading-section", "heading-subsection",
  "heading-subsubsection",
] as const;

// CHIP 5b — `tex`; CHIP 5c — `example`; CHIP 6a — the 4 block-ATOM rows
// (`inline-math` / `display-math` / `figure` / `graphics`). All non-heading
// block rows, appended after the heading slice in registration order. tex/example
// own the slash surface; the 4 block-atom rows are LIGHTNING-ONLY (grid cells).
const BLOCK_IDS = [
  "tex",
  "example",
  "inline-math",
  "display-math",
  "figure",
  "graphics",
] as const;

// CHIP 6b — the 8 FORMAT rows (mark/list/quote toggles + text-color), appended
// after the block-atom slice in grid render order. All LIGHTNING-ONLY,
// `category: "format"`, `backbone: "tiptap-chain"`. This completes the grid fold.
const FORMAT_IDS = [
  "bold",
  "italic",
  "strike",
  "code",
  "bullet-list",
  "ordered-list",
  "blockquote",
  "text-color",
] as const;

const mainCtx = (): EditorExtensionsCtx => ({
  surface: "main",
  editable: true,
  cardContext: true,
  callbacks: {},
  docIdRef: null,
  host: { getMainEditor: () => null },
});

const schema = getSchema(buildEditorExtensions(mainCtx()));

/** Build an ActionContext whose `view.state` wraps a real EditorState over
 *  `docJson`. Only the doc-reading paths (`resolveScope`) touch the state;
 *  `applies` / `run` read `ctx.ref` + `ctx.dispatch` only, so an empty doc is
 *  fine for those. */
function ctxFor(
  ref: ActionRef,
  docJson: JSONContent,
  dispatch?: ActionContext["dispatch"],
): ActionContext {
  const doc = PMNode.fromJSON(schema, docJson);
  const state = EditorState.create({ schema, doc });
  // The card rows read only `ctx.ref`, `ctx.view.state`, `ctx.dispatch`. Stub
  // the rest of the (large) Editor/EditorView surface — never dereferenced.
  const view = { state } as unknown as ActionContext["view"];
  const editor = { state, view } as unknown as ActionContext["editor"];
  return { editor, view, ref, surface: "grab", dispatch };
}

const emptyDoc: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", attrs: { uuid: "p0" }, content: [] }],
};

function row(id: ActionId): ActionSpec {
  const r = VIRGIL_ACTION_REGISTRY[id];
  if (!r) throw new Error(`no row for ${id}`);
  return r;
}

// ---------------------------------------------------------------------------
// (1) rows exist + correct presentation/surfaces
// ---------------------------------------------------------------------------

describe("card-action rows", () => {
  it("registers exactly the 11 card ids, keyed === id, category 'card'", () => {
    for (const id of CARD_IDS) {
      const r = VIRGIL_ACTION_REGISTRY[id];
      expect(r, `row for "${id}"`).toBeTruthy();
      expect(r!.id).toBe(id);
      expect(r!.category).toBe("card");
    }
    // The registry now holds the 11 cards (CHIP 2-4) PLUS the 4 heading rows
    // (CHIP 5a) PLUS the `tex` (CHIP 5b) + `example` (CHIP 5c) + the 4 block-atom
    // rows (CHIP 6a) PLUS the 8 format rows (CHIP 6b — completes the grid fold).
    // No OTHER rows yet (title fields + `\ref` migrate in later chips).
    expect(Object.keys(VIRGIL_ACTION_REGISTRY).sort()).toEqual(
      [...CARD_IDS, ...HEADING_IDS, ...BLOCK_IDS, ...FORMAT_IDS].sort(),
    );
  });

  it("each card row sets surfaces {grab, lightning}; only citation + footnote add slash/typed (CHIP 4a-ii / 4b)", () => {
    // The two cards whose run() handles the PM-land surfaces (slash + typed):
    // citation (CHIP 4a-ii, slashName "cite") and footnote (CHIP 4b, slashName
    // "footnote"). Each must claim those surfaces + carry the join keys.
    const PM_SLASH_NAME: Record<string, string> = {
      citation: "cite",
      footnote: "footnote",
    };
    for (const id of CARD_IDS) {
      const r = row(id);
      expect(r.surfaces.grab, `${id}.grab`).toBe(true);
      expect(r.surfaces.lightning, `${id}.lightning`).toBe(true);
      if (id === "citation" || id === "footnote") {
        expect(r.surfaces.slash, `${id}.slash`).toBe(true);
        expect(r.surfaces.typed, `${id}.typed`).toBe(true);
        expect(r.slashName, `${id}.slashName`).toBe(PM_SLASH_NAME[id]);
        expect(r.inputRulePattern, `${id}.inputRulePattern`).toBeInstanceOf(RegExp);
      } else {
        expect(r.surfaces.slash, `${id}.slash`).toBeFalsy();
        expect(r.surfaces.typed, `${id}.typed`).toBeFalsy();
      }
    }
  });

  it("label + letter match CARD_ACTION_PRESENTATION (the registry's own SSOT)", () => {
    for (const id of CARD_ACTION_ORDER) {
      const r = row(id);
      const p = CARD_ACTION_PRESENTATION[id];
      expect(r.label).toBe(p.label);
      expect(r.letter).toBe(p.letter);
      expect(r.separator).toBe(p.separator);
      expect(r.destructive).toBe(p.destructive);
    }
  });

  it("the registry rows enumerate cards (menu order), then the 4 headings (level order), then the block slice, then the 8 format rows", () => {
    expect(Object.keys(VIRGIL_ACTION_REGISTRY)).toEqual([
      ...CARD_ACTION_ORDER,
      ...HEADING_IDS,
      ...BLOCK_IDS,
      ...FORMAT_IDS,
    ]);
  });
});

// ---------------------------------------------------------------------------
// (2) run(ctx) forwards (id, ref) to the spy dispatch — byte-identical delegation
// ---------------------------------------------------------------------------

describe("card-action run() delegates to ctx.dispatch", () => {
  it("forwards exactly (id, ref) for every card id", () => {
    for (const id of CARD_IDS) {
      const spy = vi.fn();
      const ref: ActionRef = { kind: "paragraph", id: "p0" };
      const ctx = ctxFor(ref, emptyDoc, spy);
      row(id).run(ctx);
      expect(spy, `${id} dispatch`).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(id, ref);
    }
  });

  it("forwards a SelectionRef unchanged", () => {
    const spy = vi.fn();
    const ref: ActionRef = { kind: "selection", from: 1, to: 5, paragraphId: "p0" };
    row("note").run(ctxFor(ref, emptyDoc, spy));
    expect(spy).toHaveBeenCalledWith("note", ref);
  });

  it("a grab/lightning-only card never forwards a CursorRef to the dispatcher", () => {
    // `note` (no slash/typed surface) follows the generic `cardRun`, which is a
    // no-op for a CursorRef — only `DragHandleRef`-shaped refs forward. (The two
    // PM-surface cards — citation/footnote — DO have a cursor path, but it
    // routes to `cardCreation`, never `ctx.dispatch`; proven in their
    // cross-surface tests.)
    const spy = vi.fn();
    const ref: ActionRef = { kind: "cursor", pos: 1, paragraphId: "p0" };
    row("note").run(ctxFor(ref, emptyDoc, spy));
    expect(spy).not.toHaveBeenCalled();
  });

  it("is a no-op (no throw) when ctx.dispatch is absent", () => {
    const ref: ActionRef = { kind: "paragraph", id: "p0" };
    expect(() => row("delete").run(ctxFor(ref, emptyDoc))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// (3) applies() greys the right actions per representative kind
// ---------------------------------------------------------------------------

describe("card-action applies() mirrors the per-kind grey-out", () => {
  const at = (ref: ActionRef, id: DragHandleAction) =>
    row(id).applies(ctxFor(ref, emptyDoc));

  it("non-prose block (displayMath) disables footnote/citation/suggest-edit, keeps note/todo/highlight", () => {
    const ref: ActionRef = { kind: "displayMath", id: "m0" };
    expect(at(ref, "footnote")).toBe("disabled");
    expect(at(ref, "citation")).toBe("disabled");
    expect(at(ref, "suggest-edit")).toBe("disabled");
    expect(at(ref, "note")).toBe("ok");
    expect(at(ref, "todo")).toBe("ok");
    expect(at(ref, "highlight")).toBe("ok"); // a TextObjectRef has a range
    expect(at(ref, "delete")).toBe("ok");
  });

  it("non-prose block (codeBlock) likewise disables footnote", () => {
    const ref: ActionRef = { kind: "codeBlock", id: "c0" };
    expect(at(ref, "footnote")).toBe("disabled");
    expect(at(ref, "citation")).toBe("disabled");
    expect(at(ref, "note")).toBe("ok");
  });

  it("titleField disables citation + the destructive lifecycle cells, keeps footnote/note", () => {
    const ref: ActionRef = { kind: "titleField", id: "t0" };
    expect(at(ref, "citation")).toBe("disabled");
    expect(at(ref, "duplicate")).toBe("disabled");
    expect(at(ref, "archive")).toBe("disabled");
    expect(at(ref, "delete")).toBe("disabled");
    expect(at(ref, "footnote")).toBe("ok");
    expect(at(ref, "note")).toBe("ok");
    expect(at(ref, "highlight")).toBe("ok");
  });

  it("linkedRange disables duplicate (id-uniqueness), keeps everything else", () => {
    const ref: ActionRef = { kind: "linkedRange", id: "lr0" };
    expect(at(ref, "duplicate")).toBe("disabled");
    expect(at(ref, "note")).toBe("ok");
    expect(at(ref, "delete")).toBe("ok");
  });

  it("highlight is disabled in cursor / no-range mode but ok on a non-empty selection", () => {
    const cursor: ActionRef = { kind: "cursor", pos: 1, paragraphId: "p0" };
    expect(row("highlight").applies(ctxFor(cursor, emptyDoc))).toBe("disabled");

    const empty: ActionRef = { kind: "selection", from: 3, to: 3, paragraphId: "p0" };
    expect(row("highlight").applies(ctxFor(empty, emptyDoc))).toBe("disabled");

    const live: ActionRef = { kind: "selection", from: 1, to: 5, paragraphId: "p0" };
    expect(row("highlight").applies(ctxFor(live, emptyDoc))).toBe("ok");
  });

  it("a prose paragraph enables the full vocabulary", () => {
    const ref: ActionRef = { kind: "paragraph", id: "p0" };
    for (const id of CARD_IDS) {
      // highlight on a block ref resolves to a range, so it's ok too.
      expect(at(ref, id), `${id} on paragraph`).toBe("ok");
    }
  });
});

// ---------------------------------------------------------------------------
// (4) resolveScope — heading line (annotation) vs section (lifecycle)
// ---------------------------------------------------------------------------

describe("card-action resolveScope on a heading", () => {
  // Section: an h2 ("Intro") followed by a body paragraph, then an h2 that
  // closes the section. getSectionRangeByUuid spans heading→next-equal-heading.
  const headingDoc: JSONContent = {
    type: "doc",
    content: [
      { type: "heading", attrs: { uuid: "h1", level: 2 }, content: [{ type: "text", text: "Intro" }] },
      { type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "Body sentence." }] },
      { type: "heading", attrs: { uuid: "h2", level: 2 }, content: [{ type: "text", text: "Next" }] },
    ],
  };
  const headingRef: ActionRef = { kind: "heading", id: "h1" };

  it("annotation action (note) → the heading LINE only", () => {
    const line = row("note").resolveScope!(ctxFor(headingRef, headingDoc));
    // The heading "Intro" occupies positions [1, 6] (pos 0 opens the heading,
    // content range is pos+1 .. pos+nodeSize-1). The body paragraph is NOT
    // included.
    expect(line.from).toBe(1);
    expect(line.to).toBe(6); // 1 + "Intro".length(5)
  });

  it("lifecycle action (delete) → the whole SECTION (heading + body, up to the next h2)", () => {
    const section = row("delete").resolveScope!(ctxFor(headingRef, headingDoc));
    // Starts at the section heading (pos 0); ends where the next equal-level
    // heading begins (after the body paragraph), strictly past the line range.
    expect(section.from).toBe(0);
    expect(section.to).toBeGreaterThan(7); // past "Intro" — includes the body
    // The line range is a strict subset of the section range.
    const line = row("note").resolveScope!(ctxFor(headingRef, headingDoc));
    expect(section.from).toBeLessThanOrEqual(line.from);
    expect(section.to).toBeGreaterThan(line.to);
  });

  it("annotation vs lifecycle yield DIFFERENT ranges on the same heading", () => {
    const line = row("highlight").resolveScope!(ctxFor(headingRef, headingDoc));
    const section = row("archive").resolveScope!(ctxFor(headingRef, headingDoc));
    expect(section).not.toEqual(line);
  });

  it("a paragraph ref yields its content range either way (annotation == lifecycle)", () => {
    const pRef: ActionRef = { kind: "paragraph", id: "p1" };
    const ann = row("note").resolveScope!(ctxFor(pRef, headingDoc));
    const life = row("delete").resolveScope!(ctxFor(pRef, headingDoc));
    expect(ann).toEqual(life);
  });
});

// ---------------------------------------------------------------------------
// (4b) CHIP 5b — the `tex` block row's shape (category block; slash + lightning;
//      slashName "tex"; NO grab/typed surface).
// ---------------------------------------------------------------------------

describe("tex block row (CHIP 5b)", () => {
  it("is category 'block' on slash + lightning, slashName 'tex', no grab/typed", () => {
    const r = row("tex");
    expect(r.id).toBe("tex");
    expect(r.category).toBe("block");
    expect(r.surfaces.slash).toBe(true);
    expect(r.surfaces.lightning).toBe(true);
    expect(r.surfaces.grab).toBeFalsy();
    expect(r.surfaces.typed).toBeFalsy();
    expect(r.slashName).toBe("tex");
  });
});

// ---------------------------------------------------------------------------
// (4c) CHIP 5c — the `example` block row's shape (category block; slash +
//      lightning; slashName "ex"; NO grab/typed surface).
// ---------------------------------------------------------------------------

describe("example block row (CHIP 5c)", () => {
  it("is category 'block' on slash + lightning, slashName 'ex', no grab/typed", () => {
    const r = row("example");
    expect(r.id).toBe("example");
    expect(r.category).toBe("block");
    expect(r.surfaces.slash).toBe(true);
    expect(r.surfaces.lightning).toBe(true);
    expect(r.surfaces.grab).toBeFalsy();
    expect(r.surfaces.typed).toBeFalsy();
    expect(r.slashName).toBe("ex");
  });
});

// ---------------------------------------------------------------------------
// (4d) CHIP 6b — the 8 FORMAT rows' shape: category 'format', backbone
//      'tiptap-chain' (the DECLARED record that they are backbone-less), and
//      LIGHTNING-ONLY (no grab/slash/typed/keyboard).
// ---------------------------------------------------------------------------

describe("format rows (CHIP 6b — completes the grid fold)", () => {
  it("each format row is category 'format', backbone 'tiptap-chain', lightning-only", () => {
    for (const id of FORMAT_IDS) {
      const r = row(id);
      expect(r.id).toBe(id);
      expect(r.category).toBe("format");
      expect(r.backbone).toBe("tiptap-chain");
      expect(r.surfaces.lightning).toBe(true);
      expect(r.surfaces.grab).toBeFalsy();
      expect(r.surfaces.slash).toBeFalsy();
      expect(r.surfaces.typed).toBeFalsy();
      expect(r.surfaces.keyboard).toBeFalsy();
      // No slash command name / input-rule pattern on a format row.
      expect(r.slashName).toBeUndefined();
      expect(r.inputRulePattern).toBeUndefined();
    }
  });

  it("applies() is 'ok' everywhere (the grid never greys a format cell)", () => {
    const cursor: ActionRef = { kind: "cursor", pos: 1, paragraphId: "p0" };
    const live: ActionRef = { kind: "selection", from: 1, to: 5, paragraphId: "p0" };
    for (const id of FORMAT_IDS) {
      expect(row(id).applies(ctxFor(cursor, emptyDoc))).toBe("ok");
      expect(row(id).applies(ctxFor(live, emptyDoc))).toBe("ok");
    }
  });

  it("formatActionRows() returns the 8 rows in grid render order", () => {
    expect(formatActionRows().map((r) => r.id)).toEqual([...FORMAT_IDS]);
  });
});

// ---------------------------------------------------------------------------
// (5) the coverage assertion is GREEN at the card + heading + tex + example +
//     block-atom + format milestone (the whole grid fold)
// ---------------------------------------------------------------------------

describe("assertActionCoverage (card + heading + block + format milestone)", () => {
  it("reports NO problems for the populated slice", () => {
    expect(assertActionCoverage()).toEqual([]);
  });
});
