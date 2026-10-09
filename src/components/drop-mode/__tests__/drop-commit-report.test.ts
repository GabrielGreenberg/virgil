// @vitest-environment jsdom
/**
 * **Task 1024 — a drop's commit REPORTS whether it landed, and a refusal at the
 * commit is treated as the no-op it is.**
 *
 * `DropPlan.commit` returned `void`, and `finishApply` read "applied" as
 * "`applyDrop` did not throw". Task 648 made a commit-time refusal real: the
 * commit seam re-asks the pen and the host's editability for every surface at
 * dispatch, and measures that the dispatch LANDED. A source that turned
 * read-only mid-drag passed the hover (which asks the target alone), was
 * refused at the commit — and `postDrop: "close"` dismissed the float over a
 * document that never changed. On the sidecar side, stack-pull's bib carry ran
 * BEFORE its bare dispatch, so a vetoed pull still wrote `references.bib`.
 *
 * Three legs:
 *  1. the controller gates the anchor flush AND `postDrop: "close"` on the
 *     spec's report, not on the absence of a throw;
 *  2. a vetoed / read-only stack pull reports `false` and never runs the bib
 *     carry (commit-seam obligation 2: sidecar only after a landed dispatch);
 *  3. CENSUS — no drop-mode file dispatches outside the commit seam, so every
 *     planned spec's answer is a measured one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

// ── Controller harness: a fixed placement and ONE recording spec ────────────
let mockPlacement: Placement | null = null;
vi.mock("../hit-test", () => ({
  hitTest: () => mockPlacement,
  isUnmintedParagraphId: (id: string) => id.startsWith("unminted@"),
  mintPlacementUuid: (_editor: unknown, id: string) => id,
}));

let landed = true;
const applyCalls: string[] = [];
const fakeSpec = {
  allowedPlacements: ["paragraph-side"],
  targetScope: "main-only",
  postDrop: "close",
  classifyDrop: () => ({ kind: "apply" }),
  applyDrop: () => {
    applyCalls.push("apply");
    return landed;
  },
} as unknown as DropSpec;
vi.mock("../registry", () => ({
  lookupSpec: () => fakeSpec,
  MODULE_DROP_SPECS: [],
}));

const { readStackItemMock } = vi.hoisted(() => ({
  readStackItemMock: vi.fn(),
}));
vi.mock("@/hooks/useStack", () => ({ readStackItem: readStackItemMock }));

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import {
  beginDropSession,
  cancelDropSession,
  commitDropSession,
  setDropCtx,
} from "../controller";
import { stackPullDropSpec } from "../specs/stack-pull";
import type { DropCtx, DropSpec, Placement, StackPullApi } from "../types";
import type { StackItem } from "@/lib/stack/types";
import type { BibEntry } from "@/lib/types";
import { codeOnly, walkFiles } from "@/lib/__tests__/_source-scan";

const fakeEditor = { state: {}, view: { dispatch() {} } } as unknown as Editor;

// ── 1. The controller acts on the REPORT ────────────────────────────────────

describe("finishApply — a refused commit is not an applied one", () => {
  const CARD_KEY = "float:card:note:n1";

  function setup() {
    const closePopout = vi.fn<(key: string) => void>();
    const requestAnchorFlush = vi.fn<(pid: string) => void>();
    setDropCtx({
      mainEditor: null,
      closePopout,
      requestAnchorFlush,
      confirm: async () => true,
    } as unknown as DropCtx);
    return { closePopout, requestAnchorFlush };
  }

  async function dragAndRelease() {
    mockPlacement = {
      kind: "paragraph-side",
      editor: fakeEditor,
      paragraphId: "P1",
      side: "left",
      rect: { x: 0, y: 0, width: 1, height: 1 },
    } as unknown as Placement;
    expect(
      beginDropSession({
        cardKey: CARD_KEY,
        origin: { x: 10, y: 10 },
        externalCommit: true,
      }),
    ).toBe(true);
    window.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 20, clientY: 20, buttons: 1 }),
    );
    await new Promise((r) => setTimeout(r, 30));
    await commitDropSession();
  }

  beforeEach(() => {
    applyCalls.length = 0;
    mockPlacement = null;
  });
  afterEach(() => {
    cancelDropSession();
    setDropCtx(null);
  });

  it("applyDrop → false: the float is NOT closed and no anchor flush is requested", async () => {
    landed = false;
    const { closePopout, requestAnchorFlush } = setup();
    await dragAndRelease();
    expect(applyCalls).toEqual(["apply"]); // the commit ran…
    expect(closePopout).not.toHaveBeenCalled(); // …and was refused, so the float stays
    expect(requestAnchorFlush).not.toHaveBeenCalled();
  });

  it("control: applyDrop → true closes the float and flushes the anchor once", async () => {
    landed = true;
    const { closePopout, requestAnchorFlush } = setup();
    await dragAndRelease();
    expect(closePopout).toHaveBeenCalledTimes(1);
    expect(closePopout).toHaveBeenCalledWith(CARD_KEY);
    expect(requestAnchorFlush).toHaveBeenCalledTimes(1);
    expect(requestAnchorFlush).toHaveBeenCalledWith("P1");
  });
});

// ── 2. Stack pull: the bib carry follows a LANDED dispatch ──────────────────

const SCHEMA = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0] },
    text: { group: "inline" },
  },
});

function mockEditor(opts: { editable?: boolean; veto?: boolean } = {}) {
  let state = EditorState.create({
    schema: SCHEMA,
    doc: SCHEMA.node("doc", null, [SCHEMA.node("paragraph", null, [SCHEMA.text("Main.")])]),
  });
  const dispatched: Transaction[] = [];
  const editor = {
    schema: SCHEMA,
    get state() {
      return state;
    },
    view: {
      editable: opts.editable ?? true,
      get state() {
        return state;
      },
      dispatch: (tr: Transaction) => {
        dispatched.push(tr);
        if (opts.veto && tr.docChanged) return;
        state = state.apply(tr);
      },
      focus: () => {},
    },
  } as unknown as Editor;
  return { editor, dispatched, getDoc: (): PMNode => state.doc };
}

const ENTRY: BibEntry = {
  uid: "uid-smith",
  key: "smith2020",
  type: "article",
  fields: { title: "On Annotation" },
  raw: "@article{smith2020}",
};

function pull(editor: Editor) {
  const upserts: BibEntry[] = [];
  const stack = {
    upsertBibEntry: (e: BibEntry) => upserts.push(e),
    getAnnotation: () => "",
    setAnnotation: vi.fn(),
  } as unknown as StackPullApi;
  const item: StackItem = {
    id: "item-1",
    capturedAt: "2026-10-09T00:00:00.000Z",
    source: { docId: "docA" },
    payload: {
      kind: "paragraph",
      node: { type: "paragraph", content: [{ type: "text", text: "Pulled." }] },
    },
    bib: { entries: [ENTRY], annotations: {} },
  } as unknown as StackItem;
  readStackItemMock.mockReturnValue(item);
  const placement = {
    kind: "between-blocks",
    editor,
    insertPos: editor.state.doc.content.size,
    rect: { x: 0, y: 0, width: 0, height: 0 },
  } as unknown as Placement;
  const ctx = { mainEditor: editor, stack } as unknown as DropCtx;
  const decision = stackPullDropSpec.classifyDrop(placement, "stack-pull:item-1", ctx);
  const result = stackPullDropSpec.applyDrop(placement, "stack-pull:item-1", ctx);
  return { decision, result, upserts };
}

describe("stack pull — no `.bib` write for a pull that did not land", () => {
  it("a VETOED dispatch reports false and the bib carry never runs", () => {
    const m = mockEditor({ veto: true });
    const { decision, result, upserts } = pull(m.editor);
    expect(decision).toEqual({ kind: "apply" }); // the plan resolved…
    expect(m.dispatched).toHaveLength(1); // …the dispatch was attempted…
    expect(result).toBe(false); // …it did not land, and says so
    expect(upserts).toEqual([]);
    expect(m.getDoc().childCount).toBe(1);
  });

  it("a READ-ONLY surface is not even dispatched to", () => {
    const m = mockEditor({ editable: false });
    const { result, upserts } = pull(m.editor);
    expect(result).toBe(false);
    expect(m.dispatched).toHaveLength(0);
    expect(upserts).toEqual([]);
  });

  it("control: a landed pull inserts, reports true, THEN carries the bib", () => {
    const m = mockEditor();
    const { result, upserts } = pull(m.editor);
    expect(result).toBe(true);
    expect(m.getDoc().childCount).toBe(2);
    expect(upserts.map((e) => e.key)).toEqual(["smith2020"]);
  });
});

// ── 3. CENSUS — every drop dispatch is a measured one ───────────────────────

const DROP_MODE_DIR = join(process.cwd(), "src/components/drop-mode");

/** Comments stripped (`codeOnly`), so the census reads CODE — the seam's own
 *  jsdoc names the shape it forbids. */
function codeOf(rel: string): string {
  return codeOnly(readFileSync(join(DROP_MODE_DIR, rel), "utf8"));
}

function sourceFiles(): string[] {
  return walkFiles(DROP_MODE_DIR, { skipDirs: ["__tests__"] })
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => relative(DROP_MODE_DIR, f));
}

describe("CENSUS — no drop-mode commit dispatches outside the commit seam", () => {
  /** The ONLY files that may call `view.dispatch` themselves, each with why its
   *  dispatch is not a drop's commit (and so owes no report). */
  const ALLOWED: Record<string, string> = {
    "commit-seam.ts": "the door itself — dispatchLanded / commitCrossEditorMove",
    "hit-test.ts":
      "resolveAnchorableBlock's mint branch ({ mint: true } callers), not a drop commit",
    "util/inline-atom-move.ts":
      "parkCaretBeforeChange — a selection-only, addToHistory:false caret park",
  };

  it("every `view.dispatch(` in drop-mode is in an allowlisted file", () => {
    const files = sourceFiles();
    expect(files).toContain("specs/stack-pull.ts"); // the walk saw the tree
    const offenders = files
      .filter((rel) => !(rel in ALLOWED))
      .filter((rel) => /\.view\.dispatch\(/.test(codeOf(rel)));
    expect(offenders).toEqual([]);
  });

  it("every allowlisted file still dispatches (a stale row is deleted, not kept)", () => {
    for (const rel of Object.keys(ALLOWED)) {
      expect(codeOf(rel)).toMatch(/\.view\.dispatch\(/);
    }
  });
});
