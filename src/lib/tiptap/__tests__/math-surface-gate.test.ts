// @vitest-environment jsdom
//
// EX-F4-02 — math interactivity inside embedded editor surfaces.
//
// The math click→edit bridge (`virgil-math-click` → MathPopover →
// handleMathSave) used to gate on `surface === "main"` because the save always
// targeted the MAIN editor by absolute `pos`; a float's `getPos()` indexes the
// float doc, so firing from a float would have mis-targeted MAIN (corruption).
// The gate's side-effect was the bug: clicking math inside an example-card body
// (an embedded `surface: "float"` editor) did nothing.
//
// The DEEP fix routes by the editor instance that OWNS the clicked node: the
// NodeView carries its `editor` in the event detail, and the save dispatches
// into THAT editor. So the click now fires on ANY editable surface — main OR an
// embedded card/float — and the event carries the owning editor; only the
// `editor.isEditable` check still suppresses it (read-only main + the read-only
// displayMath lift). These tests lock that behaviour.
//
// Faithful end-to-end exercise of the whole path: the `surface` option's
// `addOptions` default → `.configure({surface})` → `this.options.surface`
// threaded into `mathNodeView` → the click handler. Mounts a real editor with
// one math node under jsdom (the same mount path `editor-extensions.test.ts`
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
// (+ the last detail, + whether the detail's `editor` is the SAME instance we
// mounted — the routing invariant). `configure: false` mounts the bare
// extension to prove the addOptions default ("main").
function mountAndClick(
  kind: Kind,
  surface: "main" | "float",
  opts: { editable?: boolean; configure?: boolean } = {},
): {
  fired: number;
  detail: { kind?: string; pos?: unknown; latex?: unknown; editor?: unknown } | null;
  ownerMatches: boolean;
} {
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
  let detail: { kind?: string; pos?: unknown; latex?: unknown; editor?: unknown } | null = null;
  let ownerMatches = false;
  const onClick = (e: Event) => {
    fired++;
    detail = (e as CustomEvent).detail;
    // The event must carry the editor instance that owns the clicked node, so
    // the save can target it (not blindly MAIN). Compare against the editor we
    // just mounted — same instance ⇒ correct routing.
    ownerMatches = detail?.editor === editor;
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
  return { fired, detail, ownerMatches };
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

describe("math click→edit bridge routes by the owning editor (EX-F4-02)", () => {
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

  it("the event carries the owning editor instance on the MAIN surface", () => {
    expect(mountAndClick("inline", "main").ownerMatches).toBe(true);
    expect(mountAndClick("display", "main").ownerMatches).toBe(true);
  });

  it("inline math on an editable FLOAT surface NOW fires (the EX-F4-02 fix)", () => {
    // This is the bug: an example-card body / paragraph float is a
    // `surface: "float"` editor. The click used to be inert here; now it fires
    // and carries the float's own editor so the save round-trips to that embed.
    const { fired, detail, ownerMatches } = mountAndClick("inline", "float");
    expect(fired).toBe(1);
    expect(detail?.kind).toBe("inline");
    expect(typeof detail?.pos).toBe("number");
    expect(ownerMatches).toBe(true);
  });

  it("display math on an editable FLOAT surface NOW fires, carrying its editor", () => {
    const { fired, detail, ownerMatches } = mountAndClick("display", "float");
    expect(fired).toBe(1);
    expect(detail?.kind).toBe("display");
    expect(ownerMatches).toBe(true);
  });

  it("a read-only MAIN editor stays inert (editor.isEditable gate preserved)", () => {
    expect(mountAndClick("inline", "main", { editable: false }).fired).toBe(0);
    expect(mountAndClick("display", "main", { editable: false }).fired).toBe(0);
  });

  it("a read-only FLOAT editor stays inert (the displayMath 'view & move only' lift, decision D)", () => {
    // The displayMath SingleBlockBody float mounts `editable:false`; the math
    // is edited on the page, never in the read-only float. `isEditable` keeps it
    // inert even though the click no longer gates on `surface`.
    expect(mountAndClick("inline", "float", { editable: false }).fired).toBe(0);
    expect(mountAndClick("display", "float", { editable: false }).fired).toBe(0);
  });

  it("defaults to the MAIN surface when unconfigured (safe addOptions default)", () => {
    expect(mountAndClick("inline", "main", { configure: false }).fired).toBe(1);
    expect(mountAndClick("display", "main", { configure: false }).fired).toBe(1);
  });
});
