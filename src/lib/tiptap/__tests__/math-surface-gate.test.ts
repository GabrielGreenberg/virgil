// @vitest-environment jsdom
//
// Locks the L3h.1 gate: the math click→edit bridge (`virgil-math-click` →
// MathPopover → handleMathSave) edits the MAIN editor by absolute `pos`, so the
// NodeView click must fire from the MAIN surface ONLY. A float's `getPos()`
// indexes the float doc, not the page, so firing from a float mis-targets MAIN
// (the data-corruption path). This holds for editable AND read-only floats.
//
// Faithful end-to-end exercise of the whole gate path: the `surface` option's
// `addOptions` default → `.configure({surface})` → `this.options.surface`
// threaded into `mathNodeView` → the click gate. Mounts a real editor with one
// math node under jsdom (the same mount path `editor-extensions.test.ts`
// relies on) and dispatches a click on the rendered NodeView.
//
// Import-light: `@/lib/tiptap/math` pulls only @tiptap, katex, and uuid-attr
// (no `@/lib/storage` chain — that comes from buildEditorExtensions' figure /
// graphics / tex-block React NodeViews), so no storage mock is needed here.
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { InlineMath, DisplayMath } from "@/lib/tiptap/math";

type Kind = "inline" | "display";

function contentFor(kind: Kind) {
  // Empty latex takes mathNodeView's placeholder branch (no katex call), so the
  // gate is exercised without depending on katex's jsdom behavior. The click
  // listener attaches regardless of latex content.
  return kind === "inline"
    ? {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "inlineMath", attrs: { latex: "" } }] },
        ],
      }
    : { type: "doc", content: [{ type: "displayMath", attrs: { latex: "" } }] };
}

// Mount a real editor with one math node configured for `surface`, click the
// rendered NodeView, and return how many `virgil-math-click` events fired
// (+ the last detail). `configure: false` mounts the bare extension to prove
// the addOptions default ("main").
function mountAndClick(
  kind: Kind,
  surface: "main" | "float",
  opts: { editable?: boolean; configure?: boolean } = {},
): { fired: number; detail: { kind?: string; pos?: unknown; latex?: unknown } | null } {
  const editable = opts.editable ?? true;
  const configure = opts.configure ?? true;
  const base = kind === "inline" ? InlineMath : DisplayMath;
  const mathNode = configure ? base.configure({ surface }) : base;

  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable,
    extensions: [StarterKit, mathNode],
    content: contentFor(kind),
  });

  let fired = 0;
  let detail: { kind?: string; pos?: unknown; latex?: unknown } | null = null;
  const onClick = (e: Event) => {
    fired++;
    detail = (e as CustomEvent).detail;
  };
  window.addEventListener("virgil-math-click", onClick);
  try {
    const sel = kind === "inline" ? ".inline-math" : ".display-math";
    const el = editor.view.dom.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`math NodeView (${sel}) did not mount`);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  } finally {
    window.removeEventListener("virgil-math-click", onClick);
    editor.destroy();
    element.remove();
  }
  return { fired, detail };
}

// Mount a real editor with one math node configured for `surface`, drop a
// NodeSelection on the math node, and report whether the rendered NodeView
// carries the `.selected` chrome class. Exercises the same end-to-end path as
// mountAndClick (addOptions default → `.configure({surface})` →
// `this.options.surface` → `mathNodeView`), but for the selectNode() gate.
function mountAndSelect(
  kind: Kind,
  surface: "main" | "float",
  opts: { configure?: boolean } = {},
): boolean {
  const configure = opts.configure ?? true;
  const base = kind === "inline" ? InlineMath : DisplayMath;
  const mathNode = configure ? base.configure({ surface }) : base;

  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: [StarterKit, mathNode],
    content: contentFor(kind),
  });
  try {
    const typeName = kind === "inline" ? "inlineMath" : "displayMath";
    let pos: number | null = null;
    editor.state.doc.descendants((node, p) => {
      if (pos == null && node.type.name === typeName) pos = p;
      return pos == null;
    });
    if (pos == null) throw new Error(`${typeName} node not found`);
    editor.commands.setNodeSelection(pos);
    const sel = kind === "inline" ? ".inline-math" : ".display-math";
    const el = editor.view.dom.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`math NodeView (${sel}) did not mount`);
    return el.classList.contains("selected");
  } finally {
    editor.destroy();
    element.remove();
  }
}

describe("atom selection chrome gated on the MAIN surface (R2)", () => {
  it("MAIN-surface math paints `.selected` on a resting NodeSelection", () => {
    expect(mountAndSelect("inline", "main")).toBe(true);
    expect(mountAndSelect("display", "main")).toBe(true);
  });

  it("FLOAT-surface math suppresses `.selected` (the R2 gate)", () => {
    // A float is a single-node surface, so ProseMirror rests a NodeSelection on
    // the lone atom at mount — the chrome must not paint there.
    expect(mountAndSelect("inline", "float")).toBe(false);
    expect(mountAndSelect("display", "float")).toBe(false);
  });

  it("defaults to the MAIN chrome when unconfigured (safe addOptions default)", () => {
    expect(mountAndSelect("inline", "main", { configure: false })).toBe(true);
    expect(mountAndSelect("display", "main", { configure: false })).toBe(true);
  });
});

describe("math click→edit bridge gated on the MAIN surface (L3h.1)", () => {
  it("inline math on the MAIN surface fires virgil-math-click at a numeric pos", () => {
    const { fired, detail } = mountAndClick("inline", "main");
    expect(fired).toBe(1);
    expect(detail?.kind).toBe("inline");
    expect(typeof detail?.pos).toBe("number");
  });

  it("display math on the MAIN surface fires virgil-math-click", () => {
    const { fired, detail } = mountAndClick("display", "main");
    expect(fired).toBe(1);
    expect(detail?.kind).toBe("display");
  });

  it("inline math on a FLOAT surface is inert (editable-float class — the L3h.1 fix)", () => {
    expect(mountAndClick("inline", "float").fired).toBe(0);
  });

  it("display math on a FLOAT surface is inert (read-only lift + editable-float alike)", () => {
    expect(mountAndClick("display", "float").fired).toBe(0);
  });

  it("a read-only MAIN editor stays inert (L3h's editor.isEditable gate preserved)", () => {
    expect(mountAndClick("inline", "main", { editable: false }).fired).toBe(0);
    expect(mountAndClick("display", "main", { editable: false }).fired).toBe(0);
  });

  it("defaults to the MAIN surface when unconfigured (safe addOptions default)", () => {
    expect(mountAndClick("inline", "main", { configure: false }).fired).toBe(1);
    expect(mountAndClick("display", "main", { configure: false }).fired).toBe(1);
  });
});
