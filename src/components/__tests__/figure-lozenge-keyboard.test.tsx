// @vitest-environment jsdom
/**
 * TASK 536 — the figure lozenge's four affordances are keyboard-operable.
 *
 * Pre-536 all four were `<span onClick>`s: the `#` toggle and the `×` delete
 * wore `role="button"` (the `#` with `aria-pressed`) and neither was focusable
 * or key-bound; the label text and `Label +` were bare spans. A keyboard user
 * could number, rename or delete a figure from every surface EXCEPT the
 * figure's own chrome — and `#` / `Label +` have no other home at all.
 *
 * The fix is that each is a REAL `<button type="button">`, and that shapes
 * what this suite can honestly assert. jsdom implements NO activation
 * behaviour for native buttons — a dispatched `keydown Enter` never
 * synthesises a click there, in any browser-faithful sense — so a leg that
 * "presses Enter" on a native button and expects the click's effect would be
 * testing a shim of the platform, not the platform. What IS observable, and
 * what fails on the pre-536 spans, is the CONTRACT the browser activates
 * against: the element is a `<button>` of `type="button"`, it is a tab stop
 * in DOM order, it is not disabled, it carries the app's focus indicator, and
 * activating it produces the click's effect on the DOCUMENT. The platform
 * then owes Enter and Space, and every browser delivers them — which is the
 * whole reason for a native button over a `tabIndex`ed span with a hand-
 * rolled key handler. (The one keystroke fact this environment CAN see — that
 * a key pressed on a strip button never reaches ProseMirror — is pinned on
 * the vanilla heading twin in `heading-strip-keyboard.test.ts`, whose NodeView
 * mounts headlessly.)
 *
 * The lozenge is driven with a REAL editor holding a real `figureBlock` (the
 * `label-rename-refs` recipe), so a click's effect is read off the document.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

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

import { Editor, type Content } from "@tiptap/core";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { findNodeByUuid } from "@/lib/tiptap/structural-edit";
import FigureAnnotation from "@/components/FigureAnnotation";

afterEach(cleanup);

const FIG = "uuid-fig";

function content(label: string | null): Content {
  return {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { uuid: "p-1" }, content: [{ type: "text", text: "Before." }] },
      {
        type: "figureBlock",
        attrs: { uuid: FIG, label, numbered: true, sources: [{ path: "a.png", options: "" }] },
        content: [{ type: "figureCaption", content: [{ type: "text", text: "A caption" }] }],
      },
      { type: "paragraph", attrs: { uuid: "p-2" }, content: [{ type: "text", text: "After." }] },
    ],
  };
}

function mount(label: string | null = "fig:a") {
  const ctx: EditorExtensionsCtx = {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({ element: el, editable: true, extensions: buildEditorExtensions(ctx), content: content(label) });
  return { editor, cleanup: () => { editor.destroy(); el.remove(); } };
}

const figureOf = (editor: Editor) => findNodeByUuid(editor, FIG);

interface LozengeOpts {
  label?: string;
  canNumber?: boolean;
  readOnly?: boolean;
  onConfirmDelete?: (() => Promise<boolean>) | null;
  /** A stand-in for `FigureFullView`'s `handleBodyClick` — the REACT click
   *  handler on the figure body the lozenge sits inside. It must be a React
   *  handler: the lozenge stops REACT propagation, which a native listener on
   *  a parent DOM node runs ahead of. */
  onBodyClick?: () => void;
}

function renderLozenge(editor: Editor, opts: LozengeOpts = {}) {
  const { label = "fig:a", canNumber = true, readOnly = false, onConfirmDelete = null, onBodyClick } = opts;
  const getFigurePos = () => figureOf(editor)?.pos ?? null;
  const utils = render(
    <div onClick={onBodyClick}>
      <FigureAnnotation
        editor={readOnly ? undefined : editor}
        label={label}
        numbered
        canNumber={canNumber}
        getFigurePos={readOnly ? undefined : getFigurePos}
        onConfirmRename={null}
        onConfirmDelete={onConfirmDelete}
        readOnly={readOnly}
      />
    </div>,
  );
  const root = utils.container.querySelector<HTMLElement>(".figure-annotation")!;
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);
  return {
    ...utils,
    root,
    toggle: q<HTMLElement>(".figure-annotation-numbered-toggle")!,
    labelText: q<HTMLElement>(".figure-label-text"),
    labelAdd: q<HTMLElement>(".figure-label-add"),
    del: q<HTMLElement>(".figure-annotation-delete"),
    input: () => q<HTMLInputElement>("input.figure-label-input"),
  };
}

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

/** The platform contract a native button activates against. */
function expectOperableButton(el: HTMLElement | null, what: string) {
  expect(el, `${what} is rendered`).not.toBeNull();
  const b = el as HTMLButtonElement;
  expect(b.tagName, `${what} is a real <button>`).toBe("BUTTON");
  expect(b.type, `${what} is type="button" (never a submit)`).toBe("button");
  expect(b.disabled, `${what} is enabled`).toBe(false);
  expect(b.tabIndex, `${what} is a tab stop`).toBe(0);
  expect(b.hasAttribute("role"), `${what} spells no hand-rolled role`).toBe(false);
  expect(b.classList.contains("focus-ring"), `${what} carries the focus indicator`).toBe(true);
  // Focusable in fact, not just in attribute: jsdom honours focusability.
  b.focus();
  expect(document.activeElement, `${what} takes focus`).toBe(b);
}

describe("DEFECT: the four affordances are keyboard-operable controls", () => {
  it("M1 — `#` is an operable toggle button, and activating it flips the figure's number", () => {
    const { editor, cleanup: c } = mount();
    try {
      const { toggle } = renderLozenge(editor);
      expectOperableButton(toggle, "the # toggle");
      expect(toggle.getAttribute("aria-pressed")).toBe("true");
      // The NAME is stable across the toggle; the tooltip is what flips.
      expect(toggle.getAttribute("aria-label")).toBe("Figure number");
      expect(toggle.getAttribute("data-hint")).toBe("Hide figure number");
      toggle.click();
      expect(figureOf(editor)?.node.attrs.numbered).toBe(false);
    } finally { c(); }
  });

  it("M2 — `×` is an operable button, and activating it asks the confirm and deletes the figure", async () => {
    const { editor, cleanup: c } = mount();
    try {
      const confirm = vi.fn(async () => true);
      const { del } = renderLozenge(editor, { onConfirmDelete: confirm });
      expectOperableButton(del, "the × delete");
      expect(del!.getAttribute("aria-label")).toBe("Delete figure");
      await act(async () => { del!.click(); await settle(); });
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(figureOf(editor)).toBeNull();
    } finally { c(); }
  });

  it("M2 (control) — a declined confirm leaves the figure in place", async () => {
    const { editor, cleanup: c } = mount();
    try {
      const { del } = renderLozenge(editor, { onConfirmDelete: async () => false });
      await act(async () => { del!.click(); await settle(); });
      expect(figureOf(editor)).not.toBeNull();
    } finally { c(); }
  });

  it("M3 — the label text is an operable button, and activating it opens the rename input", () => {
    const { editor, cleanup: c } = mount();
    try {
      const loz = renderLozenge(editor);
      expectOperableButton(loz.labelText, "the label text");
      expect(loz.labelText!.textContent).toBe("fig:a");
      fireEvent.click(loz.labelText!);
      const input = loz.input();
      expect(input).not.toBeNull();
      expect(input!.value).toBe("fig:a");
    } finally { c(); }
  });

  it("M4 — `Label +` is an operable button, and activating it opens an empty label input", () => {
    const { editor, cleanup: c } = mount(null);
    try {
      const loz = renderLozenge(editor, { label: "" });
      expect(loz.labelText).toBeNull();
      expectOperableButton(loz.labelAdd, "Label +");
      fireEvent.click(loz.labelAdd!);
      const input = loz.input();
      expect(input).not.toBeNull();
      expect(input!.value).toBe("");
    } finally { c(); }
  });

  it("the tab sequence follows DOM order: # → label → ×", () => {
    const { editor, cleanup: c } = mount();
    try {
      const { root } = renderLozenge(editor);
      const stops = [...root.querySelectorAll<HTMLElement>("button")].filter((b) => b.tabIndex >= 0);
      expect(stops.map((b) => b.className.split(" ")[0])).toEqual([
        "figure-annotation-numbered-toggle",
        "figure-label-text",
        "figure-annotation-delete",
      ]);
    } finally { c(); }
  });

  it("a press on any of them never reaches the enclosing figure body (the source popover stays shut)", () => {
    const { editor, cleanup: c } = mount();
    try {
      const bodyClick = vi.fn();
      const { toggle, labelText, del } = renderLozenge(editor, { onBodyClick: bodyClick });
      toggle.click();
      labelText!.click();
      del!.click();
      expect(bodyClick).not.toHaveBeenCalled();
    } finally { c(); }
  });
});

describe("the two states that must NOT be operable", () => {
  it("`!canNumber` — the # is disabled, announces so, takes no focus, and flips nothing", () => {
    const { editor, cleanup: c } = mount();
    try {
      const { toggle } = renderLozenge(editor, { canNumber: false });
      const b = toggle as HTMLButtonElement;
      expect(b.tagName).toBe("BUTTON");
      expect(b.disabled).toBe(true);
      expect(b.getAttribute("aria-disabled")).toBe("true");
      expect(b.hasAttribute("aria-pressed")).toBe(false);
      expect(b.classList.contains("is-unavailable")).toBe(true);
      expect(b.getAttribute("data-hint")).toMatch(/No caption/);
      // A control that announces itself disabled must not be a tab stop.
      b.focus();
      expect(document.activeElement).not.toBe(b);
      b.click();
      expect(figureOf(editor)?.node.attrs.numbered).toBe(true);
    } finally { c(); }
  });

  it("`readOnly` — the static chip renders no button, no role, and no delete (Issue-10)", () => {
    const { editor, cleanup: c } = mount();
    try {
      const { root, toggle, labelText, labelAdd, del } = renderLozenge(editor, { readOnly: true });
      expect(root.querySelectorAll("button").length).toBe(0);
      expect(root.querySelectorAll("[role]").length).toBe(0);
      expect(toggle.tagName).toBe("SPAN");
      expect(toggle.hasAttribute("aria-pressed")).toBe(false);
      expect(labelText?.tagName).toBe("SPAN");
      expect(labelAdd).toBeNull();
      expect(del).toBeNull();
    } finally { c(); }
  });
});
