// @vitest-environment jsdom
/**
 * Task 1026 — a SAME-EDITOR move paints no bar in a foreign editor.
 *
 * `blockMoveSpec` (the Example card's `exampleDropSpec`) and `textObjectDropSpec`
 * resolve their source inside `placement.editor` — the TARGET document — so
 * they can only ever commit where the payload already lives. Both declared
 * `targetScope: "any-editor"`, and the hit-test filtered only `main-only`: so
 * hovering a note card's body or a sibling pane painted a bar, and release
 * found no source there (a silent no-op). They now declare `"source-editor"`,
 * and the hit-test refuses every editor but the session source range's.
 *
 * Legs: over the FOREIGN editor → no placement (fails if hit-test.ts's
 * `source-editor` rung is deleted, or a spec is flipped back to any-editor);
 * over the SOURCE editor → a placement (positive control, so the null leg is
 * not vacuous); and a census over every spec declaration in src/, below.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Schema } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { hitTest } from "../hit-test";
import { registerDropTarget } from "../target-registry";
import { TEXT_ONLY_PAYLOAD } from "../inline-host";
import { resolveSessionBlockPayload } from "../block-payload";
import { resolveSessionSourceRange } from "../self-drop";
import { blockMoveSpec } from "../util/block-move";
import { textObjectDropSpec } from "../specs/textobject";
import { exampleDropSpec } from "@/panels/Examples/drop-spec";
import { textObjectPopoutKey } from "@/text-objects/text-object-registry";
import type { DropCtx, DropSpec } from "../types";
import { walkFiles } from "@/lib/__tests__/_source-scan";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { uuid: { default: null } },
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
  },
});

const SRC = "src-para";
const docOf = (prefix: string) =>
  schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create({ uuid: SRC }, schema.text("source")),
    schema.nodes.paragraph.create({ uuid: `${prefix}-a` }, schema.text("alpha")),
    schema.nodes.paragraph.create({ uuid: `${prefix}-b` }, schema.text("beta")),
  ]);

// The hovered block (the third paragraph) occupies y 100–120; IN_GAP_Y sits
// just below it, in the hairline gap a between-blocks bar lives in.
const BLOCK_TOP = 100;
const BLOCK_BOTTOM = 120;
const IN_GAP_Y = 124;
const CURSOR_X = 150;

const rect = (): DOMRect => {
  const box = {
    top: BLOCK_TOP,
    bottom: BLOCK_BOTTOM,
    left: 64,
    right: 364,
    width: 300,
    height: BLOCK_BOTTOM - BLOCK_TOP,
    x: 64,
    y: BLOCK_TOP,
  };
  return { ...box, toJSON: () => box } as DOMRect;
};

/** A mock editor wired for the full hit-test path. The FOREIGN editor carries
 *  an identical copy of the source block, so the only thing that can refuse it
 *  is the editor-identity rung under test. */
function mountEditor(prefix: string): { editor: Editor; dom: HTMLElement } {
  let state = EditorState.create({ schema, doc: docOf(prefix) });
  const dom = document.createElement("div");
  dom.className = "ProseMirror";
  const blockEl = document.createElement("p");
  blockEl.getBoundingClientRect = rect;
  dom.appendChild(blockEl);
  document.body.appendChild(dom);
  // Inside the last paragraph's text.
  const lastPos = state.doc.content.size - 3;
  const view = {
    dom,
    get state() {
      return state;
    },
    editable: true,
    posAtCoords: () => ({ pos: lastPos, inside: 0 }),
    coordsAtPos: () => ({ left: 120, top: BLOCK_TOP, bottom: BLOCK_BOTTOM, right: 121 }),
    nodeDOM: () => blockEl,
    dispatch: (tr: Transaction) => {
      state = state.apply(tr);
    },
    focus: () => {},
  };
  const editor = {
    isEditable: true,
    get state() {
      return state;
    },
    view,
  } as unknown as Editor;
  registerDropTarget(editor);
  return { editor, dom };
}

const paragraphMove = blockMoveSpec({ nodeName: "paragraph" });
const BLOCK_KEY = `float:card:example:${SRC}`;
const TO_KEY = textObjectPopoutKey({ kind: "paragraph", id: SRC });

describe("task 1026 — same-editor move specs refuse foreign editors on hover", () => {
  let main: { editor: Editor; dom: HTMLElement };
  let foreign: { editor: Editor; dom: HTMLElement };
  let ctx: DropCtx;

  beforeEach(() => {
    document.body.innerHTML = "";
    main = mountEditor("main");
    foreign = mountEditor("card");
    ctx = { mainEditor: main.editor } as unknown as DropCtx;
  });

  const hoverOver = (
    target: { dom: HTMLElement },
    spec: DropSpec,
    key: string,
  ) => {
    document.elementsFromPoint = () => [target.dom];
    return hitTest(
      CURSOR_X,
      IN_GAP_Y,
      spec,
      spec.allowedPlacements,
      key,
      main.editor,
      TEXT_ONLY_PAYLOAD,
      resolveSessionBlockPayload(spec, key, ctx),
      resolveSessionSourceRange(spec, key, ctx),
    );
  };

  for (const [name, spec, key] of [
    ["blockMoveSpec (exampleDropSpec's factory)", paragraphMove, BLOCK_KEY],
    ["textObjectDropSpec", textObjectDropSpec, TO_KEY],
  ] as const) {
    it(`${name}: a placement over the SOURCE editor (positive control)`, () => {
      expect(resolveSessionSourceRange(spec, key, ctx)?.editor).toBe(main.editor);
      expect(hoverOver(main, spec, key)).not.toBeNull();
    });

    it(`${name}: NO placement over a foreign editor`, () => {
      expect(hoverOver(foreign, spec, key)).toBeNull();
    });
  }

  it("a source-editor spec with no resolvable source offers nothing anywhere", () => {
    const key = "float:card:example:missing";
    expect(resolveSessionSourceRange(paragraphMove, key, ctx)).toBeNull();
    expect(hoverOver(main, paragraphMove, key)).toBeNull();
  });

  it("both same-editor specs declare source-editor", () => {
    expect(exampleDropSpec.targetScope).toBe("source-editor");
    expect(textObjectDropSpec.targetScope).toBe("source-editor");
  });
});

// ── CENSUS ──────────────────────────────────────────────────────────────────
// `"any-editor"` is reserved for GENUINELY cross-editor moves — specs whose
// source is resolved independently of the target editor. A new spec that
// declares it must be added here with that reason, or declare `source-editor`
// (if its planDrop locates the source in `placement.editor`).
const ANY_EDITOR_ALLOWED: Record<string, string> = {
  "components/drop-mode/specs/text-range-move.ts":
    "source resolved from the session's own selection editor (cross-editor move)",
  "components/drop-mode/util/inline-atom-move.ts":
    "inline atoms land in any editor; the source is located by identity",
};

function walk(root: string): string[] {
  return walkFiles(root, { skipDirs: ["__tests__"] }).filter((f) =>
    /\.tsx?$/.test(f),
  );
}

describe("task 1026 — targetScope census", () => {
  it('only the allowlisted cross-editor specs declare targetScope "any-editor"', () => {
    const root = join(__dirname, "..", "..", "..");
    const declared = walk(root)
      .filter((f) => /^\s*targetScope:\s*"any-editor"/m.test(readFileSync(f, "utf8")))
      .map((f) => relative(root, f));
    expect(declared.sort()).toEqual(Object.keys(ANY_EDITOR_ALLOWED).sort());
  });

  it("every file declaring a source-editor spec states sourceRangeFor (else it is refused everywhere)", () => {
    const root = join(__dirname, "..", "..", "..");
    const files = walk(root).filter((f) =>
      /^\s*targetScope:\s*"source-editor"/m.test(readFileSync(f, "utf8")),
    );
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) {
      expect(readFileSync(f, "utf8"), relative(root, f)).toMatch(/sourceRangeFor:/);
    }
  });
});
