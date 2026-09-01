// @vitest-environment jsdom
//
// Task 524 — the atom-grab AFFORDANCE and the atom-grab GESTURE read ONE
// predicate.
//
// `globals.css` gave all four inline atoms `cursor: grab` / `:active
// grabbing` unconditionally, while `InlineAtomGrab` gates its gesture on
// `view.editable && (editableRef ? editableRef.current : true)`. Both halves
// were correct about their own question, which is exactly why no behavioural
// test of either could see the disagreement — and in every read-only surface
// the pointer said "grab", the press said "grabbing", and nothing happened.
// The sharpest instance is a live cowork-pen hold (task 489), where the topbar
// is at that moment displaying a badge whose whole job is to say the document
// is read-only.
//
// The fix stamps `data-atoms-graspable` from `atomsAreGraspable` — the very
// expression the mousedown handler gates on — and scopes the CSS to it. So the
// legs here are of three kinds:
//
//   1. the ATTRIBUTE tracks the predicate on every surface shape;
//   2. the AGREEMENT — the mousedown is taken exactly when the attribute says
//      "true" (which is the whole contract, and is unrepresentable in any test
//      that drives one half);
//   3. a CSS + source CENSUS — the predicate was never the part that could
//      misbehave, a rule that re-derives the scope from `contenteditable` (or a
//      writer that re-spells the attribute) is, and neither is visible to any
//      render assertion: jsdom resolves no cascade, so a
//      `getComputedStyle(...).cursor` leg would be vacuous.
//
// The extension barrel transitively imports `@/lib/storage`; stub it wholesale
// as the sibling suites do (we never call a storage fn).
import { describe, it, expect, vi, afterEach } from "vitest";

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

import fs from "node:fs";
import path from "node:path";
import { Editor } from "@tiptap/core";
import type { RefObject } from "react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { ATOM_REGISTRY } from "@/lib/tiptap/atom-registry";
import {
  ATOMS_GRASPABLE_ATTR,
  atomsAreGraspable,
  stampAtomsGraspable,
} from "@/lib/tiptap/inline-atom-grab";
import { parseLatex } from "@/lib/latex-parser";
import {
  commentsStripped,
  cssCommentsStripped,
  REPO_ROOT,
  trackedFiles,
} from "@/lib/__tests__/_source-scan";

const ROOT = REPO_ROOT;
const GLOBALS_CSS = path.join(ROOT, "src/app/globals.css");

// ── harness ──────────────────────────────────────────────────────────────────

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function ctx(editableRef: RefObject<boolean> | null): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: editableRef ?? undefined,
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  } as unknown as EditorExtensionsCtx;
}

const BODY = "Some prose \\cite{smith2020} and a \\footnote{note} here.\n";

/** The REAL stack over the REAL parse, with the two knobs the two surface
 *  shapes actually differ on: MAIN carries an `editableRef` and pins
 *  `view.editable` true; a float / card body carries none and gates on
 *  `view.editable` alone. */
function mount(opts: {
  editableRef?: RefObject<boolean> | null;
  viewEditable?: boolean;
}): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editableRef = opts.editableRef ?? null;
  editor = new Editor({
    element,
    extensions: buildEditorExtensions(ctx(editableRef)),
    content: parseLatex(
      `\\documentclass{article}\n\\begin{document}\n${BODY}\\end{document}\n`,
    ) as never,
    editable: opts.viewEditable ?? true,
  });
  return editor;
}

function graspableAttr(ed: Editor): string | null {
  return ed.view.dom.getAttribute(ATOMS_GRASPABLE_ATTR);
}

/** A no-op transaction — the cheapest way to make PM run the plugin view's
 *  `update()`, which is how every PM-observable surface re-stamps. */
function tick(ed: Editor): void {
  ed.view.dispatch(ed.state.tr.setMeta("atom-grab-affordance-test", true));
}

/** Drive the REAL `handleDOMEvents.mousedown` at an atom and report whether the
 *  gesture TOOK the press. The handler answers `true` + `preventDefault()` only
 *  when it has armed a grab, so this is the gesture's own verdict rather than a
 *  proxy for it. */
function pressIsTaken(ed: Editor, domType: string): boolean {
  const atomEl = ed.view.dom.querySelector<HTMLElement>(
    `[data-type="${domType}"]`,
  );
  expect(atomEl, `fixture has no [data-type="${domType}"] atom`).toBeTruthy();
  // Reach THIS plugin's own handler rather than `someProp`, which answers
  // with the FIRST plugin declaring `handleDOMEvents` (several do, and none of
  // the others owns mousedown).
  const plugin = ed.state.plugins.find((pl) =>
    String((pl as unknown as { key?: string }).key ?? "").startsWith(
      "inlineAtomGrab",
    ),
  );
  expect(plugin, "InlineAtomGrab is not mounted on this surface").toBeTruthy();
  const handlers = plugin!.props.handleDOMEvents as unknown as
    | Record<string, (view: unknown, event: MouseEvent) => boolean>
    | undefined;
  expect(handlers?.mousedown, "InlineAtomGrab did not install mousedown").toBeTruthy();
  const event = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
    clientX: 10,
    clientY: 10,
  });
  Object.defineProperty(event, "target", { value: atomEl });
  const taken = handlers!.mousedown(ed.view, event) === true;
  if (taken) {
    // Release the gesture the press just armed, so it cannot leak into the
    // next leg through the module-level `pending`.
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }
  return taken;
}

// ── 1. the attribute tracks the predicate ────────────────────────────────────

describe("data-atoms-graspable mirrors the gesture's own gate", () => {
  it("MAIN, editable: the editor root advertises the grab", () => {
    const ref: RefObject<boolean> = { current: true };
    const ed = mount({ editableRef: ref });
    expect(graspableAttr(ed)).toBe("true");
  });

  it("MAIN, read-only: `view.editable` is pinned TRUE and the attribute is still false", () => {
    const ref: RefObject<boolean> = { current: false };
    const ed = mount({ editableRef: ref });
    // The shape that makes `contenteditable` the WRONG signal: MAIN never
    // turns PM's own editability off (Editor.tsx keeps selection routing
    // working in the Reader), so only the ref knows.
    expect(ed.view.editable).toBe(true);
    expect(ed.view.dom.getAttribute("contenteditable")).toBe("true");
    expect(graspableAttr(ed)).toBe("false");
  });

  it("MAIN: a ref flip is picked up by the next transaction", () => {
    const ref: RefObject<boolean> = { current: true };
    const ed = mount({ editableRef: ref });
    expect(graspableAttr(ed)).toBe("true");
    ref.current = false;
    tick(ed);
    expect(graspableAttr(ed)).toBe("false");
    // …and back, so the leg cannot pass on an implementation that only ever
    // writes "false".
    ref.current = true;
    tick(ed);
    expect(graspableAttr(ed)).toBe("true");
  });

  it("MAIN: a ref flip with NO transaction behind it is stale until the writer is called", () => {
    // This is why `Editor.tsx` re-stamps from its own `editable` effect. PM
    // never observes the ref (TipTap's `useEditor` re-applies its options with
    // `editable: editor.isEditable`, so a prop flip reaches no transaction),
    // and a cowork-pen hold or a collab hand-over is exactly a moment when
    // nobody is typing. The exported writer is the whole of that seam.
    const ref: RefObject<boolean> = { current: true };
    const ed = mount({ editableRef: ref });
    expect(graspableAttr(ed)).toBe("true");
    ref.current = false;
    expect(graspableAttr(ed)).toBe("true"); // stale — no trigger has fired
    stampAtomsGraspable(ed.view, ref);
    expect(graspableAttr(ed)).toBe("false");
  });

  it("FLOAT / card body (no editableRef): the attribute follows `view.editable`", () => {
    const ed = mount({ editableRef: null, viewEditable: false });
    expect(graspableAttr(ed)).toBe("false");
    ed.setEditable(true);
    expect(graspableAttr(ed)).toBe("true");
    ed.setEditable(false);
    expect(graspableAttr(ed)).toBe("false");
  });

  it("the writer is idempotence-gated — an unchanged answer touches no attribute", () => {
    const ref: RefObject<boolean> = { current: true };
    const ed = mount({ editableRef: ref });
    const dom = ed.view.dom;
    const spy = vi.spyOn(dom, "setAttribute");
    for (let i = 0; i < 5; i++) tick(ed);
    const writes = spy.mock.calls.filter(
      ([name]) => name === ATOMS_GRASPABLE_ATTR,
    );
    expect(writes).toHaveLength(0);
    spy.mockRestore();
  });
});

// ── 2. the agreement — offer ⇔ acceptance ────────────────────────────────────

describe("what the hover OFFERS is what the press ACCEPTS", () => {
  it("MAIN, editable: the attribute says grab and the press is taken", () => {
    const ref: RefObject<boolean> = { current: true };
    const ed = mount({ editableRef: ref });
    expect(graspableAttr(ed)).toBe("true");
    expect(pressIsTaken(ed, ATOM_REGISTRY.citation.domType)).toBe(true);
  });

  it("MAIN, read-only: the attribute says no and the press falls through", () => {
    const ref: RefObject<boolean> = { current: false };
    const ed = mount({ editableRef: ref });
    expect(graspableAttr(ed)).toBe("false");
    expect(pressIsTaken(ed, ATOM_REGISTRY.citation.domType)).toBe(false);
  });

  it("the two halves agree across a live flip, for every atom kind in the fixture", () => {
    const ref: RefObject<boolean> = { current: true };
    const ed = mount({ editableRef: ref });
    for (const kind of ["citation", "footnote"] as const) {
      const domType = ATOM_REGISTRY[kind].domType;
      for (const editable of [true, false, true]) {
        ref.current = editable;
        tick(ed);
        const offered = graspableAttr(ed) === "true";
        expect(offered, `${kind}: attribute disagrees with the ref`).toBe(editable);
        expect(
          pressIsTaken(ed, domType),
          `${kind}: the press and the affordance disagree`,
        ).toBe(offered);
      }
    }
  });

  it("`atomsAreGraspable` IS the predicate — both surface shapes, read directly", () => {
    const ref: RefObject<boolean> = { current: false };
    const ed = mount({ editableRef: ref });
    expect(atomsAreGraspable(ed.view, ref)).toBe(false);
    ref.current = true;
    expect(atomsAreGraspable(ed.view, ref)).toBe(true);
    // No ref (float / card body) → `view.editable` alone.
    expect(atomsAreGraspable(ed.view, null)).toBe(ed.view.editable);
  });
});

// ── 3. the census ────────────────────────────────────────────────────────────

describe("CSS census — the affordance is scoped to the attribute", () => {
  const css = fs.readFileSync(GLOBALS_CSS, "utf8");
  const code = cssCommentsStripped(css);
  const atomSelectors = Object.values(ATOM_REGISTRY).map((m) => `.${m.domClass}`);

  /** Every rule whose declaration block sets `cursor: grab|grabbing`. */
  function grabRules(): string[] {
    const out: string[] = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      if (/cursor:\s*grab(bing)?\s*;/.test(m[2])) out.push(m[1].trim());
    }
    return out;
  }

  it("every `cursor: grab` rule that names an atom is scoped by the attribute", () => {
    const rules = grabRules().filter((sel) =>
      atomSelectors.some((s) => sel.includes(s)),
    );
    expect(rules.length, "no atom grab rule found — the census is blind").toBeGreaterThan(0);
    for (const sel of rules) {
      expect(
        sel.includes(`[${ATOMS_GRASPABLE_ATTR}="true"]`),
        `unscoped atom grab affordance: ${sel}`,
      ).toBe(true);
    }
  });

  it("the scope is NOT re-derived from `contenteditable`", () => {
    // MAIN pins `contenteditable="true"` whatever the user-facing state, so a
    // rule keyed on it would exempt exactly the surface this fix is about.
    for (const sel of grabRules()) {
      expect(sel).not.toContain("contenteditable");
    }
  });

  it("each atom keeps a base `cursor: pointer` — the honest read-only answer", () => {
    for (const meta of Object.values(ATOM_REGISTRY)) {
      const re = new RegExp(
        `\\.${meta.domClass}[^{}]*\\{[^{}]*cursor:\\s*pointer`,
        "s",
      );
      expect(re.test(code), `${meta.domClass} has no base cursor: pointer`).toBe(true);
    }
  });
});

describe("source census — one writer, one predicate", () => {
  // Population DISCOVERED from what the repo ships, both silos, tests out. The
  // predicate was never the part that could misbehave; a second writer of the
  // attribute is — and it would type-check, render, and drift silently.
  const files = [
    ...trackedFiles("src", /\.tsx?$/),
    ...trackedFiles("library", /\.tsx?$/),
  ].filter((f) => !/(^|\/)__tests__(\/|$)/.test(f) && !/\.test\.tsx?$/.test(f));

  it("the census can see the tree it is about to clear", () => {
    expect(files.length).toBeGreaterThan(300);
    expect(files.map((f) => path.relative(ROOT, f))).toContain(
      "src/lib/tiptap/inline-atom-grab.ts",
    );
  });

  it("nothing outside the SSOT spells the attribute", () => {
    // Strings are KEPT — the attribute IS a quoted literal, so `codeOnly`
    // would blank the very needle (the trap `_source-scan`'s header records).
    const spellers = files.filter((f) =>
      commentsStripped(fs.readFileSync(f, "utf8")).includes(ATOMS_GRASPABLE_ATTR),
    );
    expect(spellers.map((f) => path.relative(ROOT, f)).sort()).toEqual([
      "src/lib/tiptap/inline-atom-grab.ts",
    ]);
  });

  it("Editor.tsx re-stamps through the shared writer, not a hand-rolled setAttribute", () => {
    const code = commentsStripped(
      fs.readFileSync(path.join(ROOT, "src/components/Editor.tsx"), "utf8"),
    );
    expect(code).toContain("stampAtomsGraspable(");
    expect(code).toContain('from "@/lib/tiptap/inline-atom-grab"');
  });

  it("the plugin does not re-derive the gate beside the predicate", () => {
    const code = commentsStripped(
      fs.readFileSync(path.join(ROOT, "src/lib/tiptap/inline-atom-grab.ts"), "utf8"),
    );
    // `view.editable &&` may appear exactly once: inside `atomsAreGraspable`.
    const occurrences = code.split(/view\.editable\s*&&/).length - 1;
    expect(occurrences).toBe(1);
  });
});
