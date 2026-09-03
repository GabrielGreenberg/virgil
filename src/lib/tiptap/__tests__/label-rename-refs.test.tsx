// @vitest-environment jsdom
/**
 * TASK 534 — renaming a `\label` carries its `\ref`s, through ONE door, from
 * every surface that renames one.
 *
 * The defect in one line: rename a figure's (or a heading's) label and every
 * `\ref` to it is left pointing at a key nothing declares — `??` in the PDF,
 * no prompt, no warning. The rewrite EXISTED, twice (the figure lozenge and
 * the heading NodeView each carried a private copy of "collect the refs → ask
 * → rewrite in the same transaction"), and both copies read their confirm
 * off a `<VirgilEditor>` prop (`onConfirmLabelRename`) that `EditorPane` had
 * never passed, so `updateRefs` was `false` on every production path. The
 * Outline's label editor — the third producer — carried no rewrite at all.
 *
 * Every leg here drives a REAL editor built from the REAL
 * `buildEditorExtensions("main")` stack (so `labelRef` atoms, the heading
 * NodeView and the figure node are the shipped ones) and asserts the thing the
 * user loses: the `labelRef` nodes' `label` attr AFTER the rename. The
 * accepting CONTROL for each red leg is the same gesture with the confirm
 * answering `true`, which is what the audit measured to prove the mechanism
 * was intact and only the producer was missing.
 *
 * Why no pre-534 suite could see this: `refocus-no-scroll` drives the heading
 * NodeView's label input and asserts the HEADING's attr; `structural-edit`
 * drives the Outline commit one layer below the door; and NOTHING in the repo
 * rendered `FigureAnnotation` at all. A `labelRef` naming the renamed key is
 * unrepresentable in every one of them.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { renderHook } from "@testing-library/react";

// The extension barrel pulls @/lib/storage transitively and vitest cannot
// resolve its backend require — the storage-mock gotcha.
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
import type { MutableRefObject, RefObject } from "react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  renameLabelWithRefs,
  collectLabelRefPositions,
  labelRenameConfirmCopy,
  type LabelRenameConfirm,
} from "@/lib/tiptap/label-rename";
import { findNodeByUuid } from "@/lib/tiptap/structural-edit";
import { isLabelTaken } from "@/lib/labels";
import { Node as PMNode } from "@tiptap/pm/model";
import FigureAnnotation from "@/components/FigureAnnotation";
import { useEditorOps } from "@/components/editor-layout/card-actions/editor-ops";
import type { EditorHandle } from "@/components/Editor";

afterEach(cleanup);

const H1 = "uuid-h1"; // label sec:old, two refs
const H2 = "uuid-h2"; // label sec:two — the conflict target
const FIG = "uuid-fig"; // label fig:a, one ref
const H_NONE = "uuid-h3"; // no label
const EX = "uuid-ex"; // exampleBlock, label ex:one, one ref
const EXI = "uuid-exi"; // exampleItem, label ex:one-a, one ref

function content(): Content {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1, uuid: H1, label: "sec:old" },
        content: [{ type: "text", text: "Introduction" }],
      },
      {
        type: "paragraph",
        attrs: { uuid: "p-1" },
        content: [
          { type: "text", text: "See section " },
          { type: "labelRef", attrs: { label: "sec:old", displayText: "1", refCommand: "ref" } },
          { type: "text", text: " and figure " },
          { type: "labelRef", attrs: { label: "fig:a", displayText: "1", refCommand: "ref" } },
          { type: "text", text: "." },
        ],
      },
      {
        type: "heading",
        attrs: { level: 1, uuid: H2, label: "sec:two" },
        content: [{ type: "text", text: "Second" }],
      },
      {
        type: "paragraph",
        attrs: { uuid: "p-2" },
        content: [
          { type: "text", text: "Again " },
          { type: "labelRef", attrs: { label: "sec:old", displayText: "1", refCommand: "ref" } },
          { type: "text", text: "." },
        ],
      },
      {
        type: "figureBlock",
        attrs: { uuid: FIG, label: "fig:a", numbered: true },
        content: [
          { type: "figureCaption", content: [{ type: "text", text: "A figure" }] },
        ],
      },
      {
        type: "heading",
        attrs: { level: 1, uuid: H_NONE },
        content: [{ type: "text", text: "Unlabelled" }],
      },
      // Task 553: an example and one of its items, each labelled and each
      // referenced once — the two declaring kinds 534 never drove.
      {
        type: "exampleBlock",
        attrs: { uuid: EX, kind: "multi", label: "ex:one" },
        content: [
          {
            type: "exampleItemList",
            content: [
              {
                type: "exampleItem",
                attrs: { uuid: EXI, label: "ex:one-a" },
                content: [{ type: "paragraph", content: [{ type: "text", text: "gloss" }] }],
              },
            ],
          },
        ],
      },
      {
        type: "paragraph",
        attrs: { uuid: "p-3" },
        content: [
          { type: "text", text: "Compare " },
          { type: "labelRef", attrs: { label: "ex:one", displayText: "1", refCommand: "ref" } },
          { type: "text", text: " and " },
          { type: "labelRef", attrs: { label: "ex:one-a", displayText: "1a", refCommand: "ref" } },
          { type: "text", text: "." },
        ],
      },
    ],
  };
}

/** The pre-553 ref set for a document nothing has renamed. */
const BASE_REFS = ["sec:old", "fig:a", "sec:old", "ex:one", "ex:one-a"];

type ConfirmRef = MutableRefObject<LabelRenameConfirm | undefined>;

function mount(confirmRef?: ConfirmRef) {
  const ctx: EditorExtensionsCtx = {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: confirmRef ? { onConfirmLabelRename: confirmRef } : {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    editable: true,
    extensions: buildEditorExtensions(ctx),
    content: content(),
  });
  return { editor, el, cleanup: () => { editor.destroy(); el.remove(); } };
}

/** Every labelRef's label, in document order — the assertion surface. */
function refLabels(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.descendants((nd) => {
    if (nd.type.name === "labelRef") out.push(nd.attrs.label as string);
  });
  return out;
}
const labelOf = (editor: Editor, uuid: string) =>
  findNodeByUuid(editor, uuid)?.node.attrs.label as string | null | undefined;

const locateByUuid = (editor: Editor, uuid: string) => () =>
  findNodeByUuid(editor, uuid);

/** Let a `commit`'s awaited confirm + dispatch settle. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

// ─────────────────────────────────────────────────────────────────────────────
describe("the door — renameLabelWithRefs", () => {
  it("carries every ref naming the old key in the SAME transaction when the confirm says yes", async () => {
    const { editor, cleanup: c } = mount();
    try {
      const confirm = vi.fn(async () => true);
      const spy = vi.spyOn(editor.view, "dispatch");
      const outcome = await renameLabelWithRefs(editor, {
        locate: locateByUuid(editor, H1),
        newLabel: "sec:new",
        confirm,
      });
      expect(outcome).toBe("renamed");
      expect(confirm).toHaveBeenCalledWith("sec:old", "sec:new", 2);
      expect(labelOf(editor, H1)).toBe("sec:new");
      // Both refs followed; the figure's ref is untouched.
      expect(refLabels(editor)).toEqual(["sec:new", "fig:a", "sec:new", "ex:one", "ex:one-a"]);
      // ONE transaction: one undo step, one autosave arm.
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    } finally { c(); }
  });

  it("leaves the refs on the old key when the confirm says no — the user's deliberate choice", async () => {
    const { editor, cleanup: c } = mount();
    try {
      const outcome = await renameLabelWithRefs(editor, {
        locate: locateByUuid(editor, H1),
        newLabel: "sec:new",
        confirm: async () => false,
      });
      expect(outcome).toBe("renamed");
      expect(labelOf(editor, H1)).toBe("sec:new");
      expect(refLabels(editor)).toEqual(BASE_REFS);
    } finally { c(); }
  });

  it("with NO confirm in hand, carries the refs — fail toward not orphaning", async () => {
    // The producer census keeps production from reaching this default; what
    // it pins is what a MISSING wire costs — never a silently orphaned paper.
    const { editor, cleanup: c } = mount();
    try {
      await renameLabelWithRefs(editor, {
        locate: locateByUuid(editor, H1),
        newLabel: "sec:new",
        confirm: null,
      });
      expect(refLabels(editor)).toEqual(["sec:new", "fig:a", "sec:new", "ex:one", "ex:one-a"]);
    } finally { c(); }
  });

  it("asks NOTHING and carries nothing on an ADD (no refs yet) or a CLEAR (nowhere to point)", async () => {
    const { editor, cleanup: c } = mount();
    try {
      const confirm = vi.fn(async () => true);
      expect(await renameLabelWithRefs(editor, {
        locate: locateByUuid(editor, H_NONE), newLabel: "sec:fresh", confirm,
      })).toBe("renamed");
      expect(labelOf(editor, H_NONE)).toBe("sec:fresh");
      // A clear takes the attr's SCHEMA default — `null` on a heading …
      expect(await renameLabelWithRefs(editor, {
        locate: locateByUuid(editor, H1), newLabel: "   ", confirm,
      })).toBe("renamed");
      expect(labelOf(editor, H1)).toBeNull();
      // … and `""` on a figure — read off `type.spec`, never a per-kind list.
      expect(await renameLabelWithRefs(editor, {
        locate: locateByUuid(editor, FIG), newLabel: null, confirm,
      })).toBe("renamed");
      expect(labelOf(editor, FIG)).toBe("");
      expect(confirm).not.toHaveBeenCalled();
      // The cleared keys' refs are exactly where they were.
      expect(refLabels(editor)).toEqual(BASE_REFS);
    } finally { c(); }
  });

  it("REFUSES a key another declaration already claims — nothing written, nothing asked", async () => {
    const { editor, cleanup: c } = mount();
    try {
      const confirm = vi.fn(async () => true);
      const spy = vi.spyOn(editor.view, "dispatch");
      const outcome = await renameLabelWithRefs(editor, {
        locate: locateByUuid(editor, H1), newLabel: "sec:two", confirm,
      });
      expect(outcome).toBe("conflict");
      expect(spy).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
      expect(labelOf(editor, H1)).toBe("sec:old");
      // A figure's key is a declaration too — the registry is one namespace.
      expect(await renameLabelWithRefs(editor, {
        locate: locateByUuid(editor, H1), newLabel: "fig:a", confirm,
      })).toBe("conflict");
      // …and so are an EXAMPLE's and an ITEM's (task 553): pre-553 the
      // registry walked `heading` and `figureBlock` only, so both of these
      // were "free" and the heading strip wrote them beside their owners.
      expect(await renameLabelWithRefs(editor, {
        locate: locateByUuid(editor, H1), newLabel: "ex:one", confirm,
      })).toBe("conflict");
      expect(await renameLabelWithRefs(editor, {
        locate: locateByUuid(editor, H1), newLabel: "ex:one-a", confirm,
      })).toBe("conflict");
      spy.mockRestore();
    } finally { c(); }
  });

  it("an unchanged key is a no-op; an unresolvable node writes nothing", async () => {
    const { editor, cleanup: c } = mount();
    try {
      const spy = vi.spyOn(editor.view, "dispatch");
      expect(await renameLabelWithRefs(editor, {
        locate: locateByUuid(editor, H1), newLabel: " sec:old ", confirm: null,
      })).toBe("unchanged");
      expect(await renameLabelWithRefs(editor, {
        locate: () => null, newLabel: "sec:new", confirm: null,
      })).toBe("unresolved");
      // A node that vanished UNDER the confirm is refused too.
      let gone = false;
      expect(await renameLabelWithRefs(editor, {
        locate: () => (gone ? null : findNodeByUuid(editor, H1)),
        newLabel: "sec:new",
        confirm: async () => { gone = true; return true; },
      })).toBe("unresolved");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    } finally { c(); }
  });

  it("renames a FIGURE label and carries its ref", async () => {
    const { editor, cleanup: c } = mount();
    try {
      const outcome = await renameLabelWithRefs(editor, {
        locate: locateByUuid(editor, FIG), newLabel: "fig:b", confirm: async () => true,
      });
      expect(outcome).toBe("renamed");
      expect(labelOf(editor, FIG)).toBe("fig:b");
      expect(refLabels(editor)).toEqual(["sec:old", "fig:b", "sec:old", "ex:one", "ex:one-a"]);
      expect(collectLabelRefPositions(editor.state.doc, "fig:a")).toEqual([]);
    } finally { c(); }
  });

  it("the confirm's copy names the count and both keys", () => {
    const one = labelRenameConfirmCopy("fig:old", "fig:new", 1);
    expect(one.message).toContain("1 reference");
    expect(one.message).toContain('"fig:old"');
    expect(one.message).toContain('"fig:new"');
    const many = labelRenameConfirmCopy("a", "b", 3);
    expect(many.message).toContain("3 references");
    expect(many.confirmLabel).toBe("Update references");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The HEADING strip — the vanilla-DOM NodeView, driven through its own input.
const annotOf = (el: HTMLElement, uuid: string) =>
  el.querySelector<HTMLElement>(`[data-uuid="${uuid}"] .heading-annotation`)!;

function openLabelInput(el: HTMLElement, uuid: string): HTMLInputElement {
  const annot = annotOf(el, uuid);
  const opener =
    annot.querySelector<HTMLElement>(".heading-label-text") ??
    annot.querySelector<HTMLElement>(".heading-label-add")!;
  opener.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const input = annot.querySelector<HTMLInputElement>("input.heading-label-input")!;
  expect(input).not.toBeNull();
  return input;
}
const pressEnter = (input: HTMLInputElement) =>
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

describe("the HEADING strip's label input enters the door", () => {
  it("DEFECT: renaming a labelled heading carries its refs when the host's confirm says yes", async () => {
    const confirm = vi.fn(async () => true);
    const { editor, el, cleanup: c } = mount({ current: confirm });
    try {
      const input = openLabelInput(el, H1);
      input.value = "sec:new";
      pressEnter(input);
      await settle();
      expect(confirm).toHaveBeenCalledWith("sec:old", "sec:new", 2);
      expect(labelOf(editor, H1)).toBe("sec:new");
      expect(refLabels(editor)).toEqual(["sec:new", "fig:a", "sec:new", "ex:one", "ex:one-a"]);
    } finally { c(); }
  });

  it("…and leaves them when the confirm says no", async () => {
    const { editor, el, cleanup: c } = mount({ current: async () => false });
    try {
      const input = openLabelInput(el, H1);
      input.value = "sec:new";
      pressEnter(input);
      await settle();
      expect(labelOf(editor, H1)).toBe("sec:new");
      expect(refLabels(editor)).toEqual(BASE_REFS);
    } finally { c(); }
  });

  it("a key another heading claims is REFUSED on Enter — the input stays open with its warning, nothing is written", async () => {
    const confirm = vi.fn(async () => true);
    const { editor, el, cleanup: c } = mount({ current: confirm });
    try {
      const spy = vi.spyOn(editor.view, "dispatch");
      const input = openLabelInput(el, H1);
      input.value = "sec:two";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      pressEnter(input);
      await settle();
      // Still editing: the input is in the DOM, flagged, and the doc untouched.
      const annot = annotOf(el, H1);
      expect(annot.querySelector("input.heading-label-input")).toBe(input);
      expect(input.classList.contains("has-conflict")).toBe(true);
      expect(spy).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
      expect(labelOf(editor, H1)).toBe("sec:old");
      spy.mockRestore();
    } finally { c(); }
  });

  it("…and leaving the field with a conflicting draft ABANDONS it rather than trapping focus", async () => {
    const { editor, el, cleanup: c } = mount({ current: async () => true });
    try {
      vi.useFakeTimers();
      const input = openLabelInput(el, H1);
      vi.advanceTimersByTime(300); // the blur guard arms after 200 ms
      vi.useRealTimers();
      input.value = "sec:two";
      input.dispatchEvent(new Event("blur"));
      await settle();
      expect(annotOf(el, H1).querySelector("input.heading-label-input")).toBeNull();
      expect(labelOf(editor, H1)).toBe("sec:old");
      expect(labelOf(editor, H2)).toBe("sec:two");
    } finally { c(); }
  });

  it("the live warning reads the SSOT predicate — it fires with no prop threaded at all", () => {
    const { el, cleanup: c } = mount(); // callbacks: {} — nothing supplied
    try {
      const input = openLabelInput(el, H1);
      input.value = "sec:two";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const warning = annotOf(el, H1).querySelector<HTMLElement>(".heading-label-warning")!;
      expect(warning.style.display).toBe("");
      expect(input.classList.contains("has-conflict")).toBe(true);
      input.value = "sec:fresh";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      expect(warning.style.display).toBe("none");
    } finally { c(); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The FIGURE lozenge — the React NodeView's chrome, rendered over the real doc.
function renderLozenge(editor: Editor, confirm: LabelRenameConfirm | null) {
  const getFigurePos = () => findNodeByUuid(editor, FIG)?.pos ?? null;
  const utils = render(
    <FigureAnnotation
      editor={editor}
      label="fig:a"
      numbered
      getFigurePos={getFigurePos}
      onConfirmRename={confirm}
      onConfirmDelete={null}
    />,
  );
  const opener = utils.container.querySelector<HTMLElement>(".figure-label-text")!;
  fireEvent.click(opener);
  const input = utils.container.querySelector<HTMLInputElement>("input.figure-label-input")!;
  expect(input).toBeTruthy();
  return { input, ...utils };
}

describe("the FIGURE lozenge's label input enters the door", () => {
  it("DEFECT: renaming a figure label carries its ref when the host's confirm says yes", async () => {
    const { editor, cleanup: c } = mount();
    try {
      const confirm = vi.fn(async () => true);
      const { input } = renderLozenge(editor, confirm);
      fireEvent.change(input, { target: { value: "fig:b" } });
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
        await settle();
      });
      expect(confirm).toHaveBeenCalledWith("fig:a", "fig:b", 1);
      expect(labelOf(editor, FIG)).toBe("fig:b");
      expect(refLabels(editor)).toEqual(["sec:old", "fig:b", "sec:old", "ex:one", "ex:one-a"]);
    } finally { c(); }
  });

  it("CONTROL (the pre-534 production shape): with `onConfirmRename={null}` the ref still follows — a missing wire must not orphan", async () => {
    const { editor, cleanup: c } = mount();
    try {
      const { input } = renderLozenge(editor, null);
      fireEvent.change(input, { target: { value: "fig:b" } });
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
        await settle();
      });
      expect(refLabels(editor)).toEqual(["sec:old", "fig:b", "sec:old", "ex:one", "ex:one-a"]);
    } finally { c(); }
  });

  it("a key another declaration claims is REFUSED on Enter — input open, warning shown, nothing written", async () => {
    const { editor, cleanup: c } = mount();
    try {
      const spy = vi.spyOn(editor.view, "dispatch");
      const { input, container } = renderLozenge(editor, async () => true);
      fireEvent.change(input, { target: { value: "sec:two" } });
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
        await settle();
      });
      expect(container.querySelector("input.figure-label-input")).toBe(input);
      expect(container.querySelector(".figure-label-warning")).not.toBeNull();
      expect(spy).not.toHaveBeenCalled();
      expect(labelOf(editor, FIG)).toBe("fig:a");
      spy.mockRestore();
    } finally { c(); }
  });

  it("…and leaving the field with a conflicting draft abandons it", async () => {
    const { editor, cleanup: c } = mount();
    try {
      const { input, container } = renderLozenge(editor, async () => true);
      fireEvent.change(input, { target: { value: "sec:two" } });
      await act(async () => {
        fireEvent.blur(input);
        await settle();
      });
      expect(container.querySelector("input.figure-label-input")).toBeNull();
      expect(labelOf(editor, FIG)).toBe("fig:a");
    } finally { c(); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The OUTLINE's label editor — `useEditorOps.handleUpdateLabel`, the third
// producer, which pre-534 wrote the heading attr alone and asked nothing.
function opsOver(editor: Editor, confirm: LabelRenameConfirm) {
  const handle = {
    getEditor: () => editor,
    onConfirmLabelRename: confirm,
  } as unknown as EditorHandle;
  const { result } = renderHook(() =>
    useEditorOps({
      editorRef: { current: handle } as RefObject<EditorHandle | null>,
      setLatestDoc: () => {},
    }),
  );
  return result.current;
}

describe("the OUTLINE's label commit enters the door", () => {
  it("DEFECT: renaming from the Outline asks MAIN's own confirm and carries the refs", async () => {
    const { editor, cleanup: c } = mount();
    try {
      const confirm = vi.fn(async () => true);
      const ops = opsOver(editor, confirm);
      ops.handleUpdateLabel(H1, "sec:new");
      await settle();
      expect(confirm).toHaveBeenCalledWith("sec:old", "sec:new", 2);
      expect(labelOf(editor, H1)).toBe("sec:new");
      expect(refLabels(editor)).toEqual(["sec:new", "fig:a", "sec:new", "ex:one", "ex:one-a"]);
    } finally { c(); }
  });

  it("still refuses a duplicate key (OUT-F8-03) and still clears a label", async () => {
    const { editor, cleanup: c } = mount();
    try {
      const ops = opsOver(editor, async () => true);
      ops.handleUpdateLabel(H1, "sec:two");
      await settle();
      expect(labelOf(editor, H1)).toBe("sec:old");
      ops.handleUpdateLabel(H2, null);
      await settle();
      expect(labelOf(editor, H2)).toBeNull();
    } finally { c(); }
  });

  it("refuses to write a NON-heading node under a heading's uuid", async () => {
    const { editor, cleanup: c } = mount();
    try {
      const ops = opsOver(editor, async () => true);
      ops.handleUpdateLabel(FIG, "fig:z");
      await settle();
      expect(labelOf(editor, FIG)).toBe("fig:a");
    } finally { c(); }
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// The EXPEX pods (task 553) — the two vanilla-DOM label editors 534 never
// drove. Each is driven through its REAL pod: click the label text (or
// "Label +"), type, press Enter / leave — the `nodeview-timer-lifetime` recipe.
type ExampleKind = "exampleBlock" | "exampleItem";
const POD_CLASS: Record<ExampleKind, string> = {
  exampleBlock: ".expex-label-annotation",
  exampleItem: ".expex-item-label-annotation",
};
const podOf = (el: HTMLElement, uuid: string, kind: ExampleKind) =>
  el.querySelector<HTMLElement>(`[data-uuid="${uuid}"] ${POD_CLASS[kind]}`)!;

function openPodInput(el: HTMLElement, uuid: string, kind: ExampleKind): HTMLInputElement {
  const pod = podOf(el, uuid, kind);
  const opener =
    pod.querySelector<HTMLElement>(".heading-label-text") ??
    pod.querySelector<HTMLElement>(".heading-label-add")!;
  opener.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const input = pod.querySelector<HTMLInputElement>("input.expex-label-input")!;
  expect(input).not.toBeNull();
  return input;
}

/** Every labelRef's displayText, in document order. */
function refDisplays(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.descendants((nd) => {
    if (nd.type.name === "labelRef") out.push(nd.attrs.displayText as string);
  });
  return out;
}

const EXAMPLE_CASES: { kind: ExampleKind; uuid: string; old: string; next: string; refs: string[] }[] = [
  { kind: "exampleBlock", uuid: EX, old: "ex:one", next: "ex:first",
    refs: ["sec:old", "fig:a", "sec:old", "ex:first", "ex:one-a"] },
  { kind: "exampleItem", uuid: EXI, old: "ex:one-a", next: "ex:first-a",
    refs: ["sec:old", "fig:a", "sec:old", "ex:one", "ex:first-a"] },
];

describe.each(EXAMPLE_CASES)("the $kind pod's label input enters the door (task 553)", ({ kind, uuid, old, next, refs }) => {
  it("DEFECT: renaming carries the ref when the host's confirm says yes — and the numberer keeps it resolved", async () => {
    const confirm = vi.fn(async () => true);
    const { editor, el, cleanup: c } = mount({ current: confirm });
    try {
      const spy = vi.spyOn(editor.view, "dispatch");
      const input = openPodInput(el, uuid, kind);
      input.value = next;
      pressEnter(input);
      await settle();
      expect(confirm).toHaveBeenCalledWith(old, next, 1);
      expect(labelOf(editor, uuid)).toBe(next);
      expect(refLabels(editor)).toEqual(refs);
      // ONE user-facing dispatch: declaration + ref in the same transaction
      // (the numberer's appendTransaction rides it, not a second dispatch).
      expect(spy).toHaveBeenCalledTimes(1);
      // Pre-553 the numberer DID fire on the bare write — an example label
      // change is a `LabelEntry` change — and re-resolved the stranded ref
      // to `??`, which is what the compiled PDF printed. Carried, no ref is
      // stranded, so no ref reads `??`.
      expect(refDisplays(editor)).not.toContain("??");
      // The pod re-rendered from the committed attr.
      expect(podOf(el, uuid, kind).querySelector(".heading-label-text")?.textContent).toBe(next);
      spy.mockRestore();
    } finally { c(); }
  });

  it("…and leaves the ref when the confirm says no — the numberer then reports the orphan honestly", async () => {
    const { editor, el, cleanup: c } = mount({ current: async () => false });
    try {
      const input = openPodInput(el, uuid, kind);
      input.value = next;
      pressEnter(input);
      await settle();
      expect(labelOf(editor, uuid)).toBe(next);
      expect(refLabels(editor)).toEqual(BASE_REFS);
      expect(refDisplays(editor)).toContain("??");
    } finally { c(); }
  });

  it("DEFECT: a key another declaration claims is REFUSED on Enter — input open, warning lit, nothing written", async () => {
    const confirm = vi.fn(async () => true);
    const { editor, el, cleanup: c } = mount({ current: confirm });
    try {
      const spy = vi.spyOn(editor.view, "dispatch");
      const input = openPodInput(el, uuid, kind);
      // A HEADING's key — the registry is one namespace across kinds.
      input.value = "sec:two";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      pressEnter(input);
      await settle();
      const pod = podOf(el, uuid, kind);
      expect(pod.querySelector("input.expex-label-input")).toBe(input);
      expect(input.classList.contains("has-conflict")).toBe(true);
      const warning = pod.querySelector<HTMLElement>(".heading-label-warning")!;
      expect(warning).not.toBeNull();
      expect(warning.style.display).toBe("");
      expect(spy).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
      expect(labelOf(editor, uuid)).toBe(old);
      spy.mockRestore();
    } finally { c(); }
  });

  it("…and leaving the field with a conflicting draft ABANDONS it rather than trapping focus", async () => {
    const { editor, el, cleanup: c } = mount({ current: async () => true });
    try {
      vi.useFakeTimers();
      const input = openPodInput(el, uuid, kind);
      vi.advanceTimersByTime(300); // the blur guard arms after 200 ms
      vi.useRealTimers();
      input.value = "sec:two";
      input.dispatchEvent(new Event("blur"));
      await settle();
      expect(podOf(el, uuid, kind).querySelector("input.expex-label-input")).toBeNull();
      expect(labelOf(editor, uuid)).toBe(old);
      expect(labelOf(editor, H2)).toBe("sec:two");
    } finally { c(); }
  });

  it("Escape restores the pod and writes nothing; a CLEAR still lands (the schema's empty default)", async () => {
    const { editor, el, cleanup: c } = mount({ current: async () => true });
    try {
      const spy = vi.spyOn(editor.view, "dispatch");
      const input = openPodInput(el, uuid, kind);
      input.value = "ex:draft";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(podOf(el, uuid, kind).querySelector("input")).toBeNull();
      expect(spy).not.toHaveBeenCalled();
      const again = openPodInput(el, uuid, kind);
      again.value = "";
      pressEnter(again);
      await settle();
      expect(labelOf(editor, uuid)).toBe("");
      expect(refLabels(editor)).toEqual(BASE_REFS);
      spy.mockRestore();
    } finally { c(); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The REGISTRY sees every declaring kind (task 553): the heading strip used to
// accept a key an example owned, because `collectLabelKeys` hand-listed two of
// the four kinds.
describe("the label registry covers every declaring kind (task 553)", () => {
  it("the heading strip REFUSES a key an example or an item already declares", async () => {
    const { editor, el, cleanup: c } = mount({ current: async () => true });
    try {
      const spy = vi.spyOn(editor.view, "dispatch");
      for (const taken of ["ex:one", "ex:one-a"]) {
        const input = openLabelInput(el, H1);
        input.value = taken;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        pressEnter(input);
        await settle();
        expect(input.classList.contains("has-conflict")).toBe(true);
        expect(labelOf(editor, H1)).toBe("sec:old");
        // Leave the field so the next iteration opens a fresh input.
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      }
      expect(spy).not.toHaveBeenCalled();
      expect(isLabelTaken(editor, "ex:one")).toBe(true);
      expect(isLabelTaken(editor, "ex:one-a")).toBe(true);
      expect(isLabelTaken(editor, "ex:one", "ex:one")).toBe(false); // own key excluded
      spy.mockRestore();
    } finally { c(); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The WARNING's cost (task 553 M3): the live "already in use" strip reads a
// key set snapshotted ONCE at edit start. Pre-553 the heading strip walked the
// whole document on every `input` event.
describe("the live warning snapshots the key set once (task 553)", () => {
  const countWalks = async (drive: (el: HTMLElement) => void) => {
    const { el, cleanup: c } = mount();
    try {
      const walks = vi.spyOn(PMNode.prototype, "descendants");
      drive(el);
      const n = walks.mock.calls.length;
      walks.mockRestore();
      return n;
    } finally { c(); }
  };
  const typeN = (input: HTMLInputElement, n: number) => {
    for (let i = 0; i < n; i++) {
      input.value = "sec:t" + "x".repeat(i);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  it("the HEADING strip: 12 characters cost ONE document walk, not twelve", async () => {
    const opened = await countWalks((el) => { openLabelInput(el, H1); });
    const typed = await countWalks((el) => { typeN(openLabelInput(el, H1), 12); });
    expect(opened).toBeGreaterThanOrEqual(1); // the snapshot IS a walk — the canary
    expect(typed).toBe(opened); // …and typing adds none
  });

  it.each(EXAMPLE_CASES)("the $kind pod: 12 characters cost ONE document walk", async ({ kind, uuid }) => {
    const opened = await countWalks((el) => { openPodInput(el, uuid, kind); });
    const typed = await countWalks((el) => { typeN(openPodInput(el, uuid, kind), 12); });
    expect(opened).toBeGreaterThanOrEqual(1);
    expect(typed).toBe(opened);
  });
});
