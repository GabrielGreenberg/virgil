// @vitest-environment jsdom
//
// TASK 968 — a greyed command SAYS why.
//
// `applies()` answers a bare `"disabled"`, and every command surface painted
// only that: the grab menu, the lightning grid and the slash popup greyed rows
// with no reason, so "your co-author has the pen", "this paper is open
// read-only", "not inside a title" and "nothing is selected" all looked the
// same — and the whole-menu greys looked like a broken menu. `verdictOf` names
// the gate that refused, walking the SAME gates `applies()` routes through, and
// `refusalPhrase` is the ONE table of words.
//
// Legs:
//   (1) the phrase table — one phrase per cause, subject labels mid-sentence;
//   (2) each shared gate: a refused ctx yields its reason, a passing ctx none;
//   (3) the grab menu RENDERS it — pen / host / container reasons on the rows;
//   (4) the slash popup's reason door answers the same gate.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import type { RefObject } from "react";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { render, cleanup } from "@testing-library/react";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import {
  VIRGIL_ACTION_REGISTRY,
  cardActionRows,
  verdictOf,
  type ActionContext,
  type ActionId,
  type ActionRef,
} from "@/lib/actions/action-registry";
import { refusalPhrase } from "@/lib/actions/refusal";
import { slashCommandReason } from "@/lib/tiptap/slash-applicability";
import { DragHandleMenu } from "@/components/DragHandleMenu";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;

beforeEach(() => {
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => emptyList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => emptyList;
});

const editors: Editor[] = [];
afterEach(() => {
  cleanup();
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = "";
});

const PEN = "Your co-author has the pen";
const HOST = "This paper is open read-only";
const NEEDS_SELECTION = "Select some text first";

const text = (t: string) => ({ type: "text", text: t });
const FIXTURE: JSONContent[] = [
  { type: "titleField", attrs: { field: "title", uuid: "title-A" }, content: [text("My Paper Title")] },
  { type: "paragraph", attrs: { uuid: "para-A" }, content: [text("Ordinary prose here.")] },
  { type: "codeBlock", attrs: { uuid: "code-A" }, content: [text("x = 1")] },
  {
    type: "paragraph",
    attrs: { uuid: "para-C" },
    content: [
      text("see "),
      { type: "citation", attrs: { citationId: "cit-1", command: "\\cite{bar}", displayText: "" } },
      text(" here"),
    ],
  },
];

function mount(hostEditable = true): { editor: Editor; editableRef: RefObject<boolean> } {
  const editableRef: RefObject<boolean> = { current: hostEditable };
  const ctx: EditorExtensionsCtx = {
    surface: "main",
    editableRef,
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(ctx),
    content: { type: "doc", content: FIXTURE },
  });
  editors.push(editor);
  return { editor, editableRef };
}

/** A selection over the inner text of the first block named `nodeName`. */
function inside(editor: Editor, nodeName: string): { from: number; to: number } {
  let hit: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (hit || node.type.name !== nodeName) return !hit;
    hit = { from: pos + 1, to: pos + 1 + node.content.size };
    return false;
  });
  if (!hit) throw new Error(`no ${nodeName}`);
  return hit;
}

function sel(editor: Editor, nodeName: string): ActionRef {
  const { from, to } = inside(editor, nodeName);
  return { kind: "selection", from, to, paragraphId: "" };
}

function ctxFor(editor: Editor, ref: ActionRef, canEdit?: boolean): ActionContext {
  return { editor, view: editor.view, ref, surface: "lightning", canEdit } as ActionContext;
}

const row = (id: ActionId) => VIRGIL_ACTION_REGISTRY[id]!;

// ---------------------------------------------------------------------------
// (1) the table
// ---------------------------------------------------------------------------

describe("task 968 (1) — refusalPhrase, the one table of words", () => {
  it("names each cause; a subject reads mid-sentence, proper spellings kept", () => {
    expect(refusalPhrase({ cause: "pen" })).toBe(PEN);
    expect(refusalPhrase({ cause: "host" })).toBe(HOST);
    expect(refusalPhrase({ cause: "needs-selection" })).toBe(NEEDS_SELECTION);
    expect(refusalPhrase({ cause: "capture" })).toMatch(/can't wrap/);
    expect(refusalPhrase({ cause: "container", subject: "titleField" })).toBe(
      "Not available inside this title field",
    );
    expect(refusalPhrase({ cause: "container", subject: "latexComment" })).toBe(
      "Not available inside this LaTeX comment",
    );
    expect(refusalPhrase({ cause: "kind", subject: "codeBlock" })).toBe(
      "Not available on this code block",
    );
    expect(refusalPhrase({ cause: "container", subject: null })).toBe("Not available here");
    expect(refusalPhrase({ cause: "kind", subject: "not-a-kind" })).toBe("Not available here");
  });
});

// ---------------------------------------------------------------------------
// (2) each shared gate
// ---------------------------------------------------------------------------

describe("task 968 (2) — verdictOf names the gate that refused", () => {
  it("an enabled row carries NO reason (and the state is the row's own applies())", () => {
    const { editor } = mount();
    const ctx = ctxFor(editor, sel(editor, "paragraph"));
    for (const id of ["bold", "tex", "citation", "footnote"] as ActionId[]) {
      const v = verdictOf(row(id), ctx);
      expect(v.state).toBe(row(id).applies(ctx));
      expect(v.state).toBe("ok");
      expect(v.reason).toBeNull();
    }
  });

  it("PEN: canEdit false on a host-writable surface → the pen reason, on every row", () => {
    const { editor } = mount(true);
    const ctx = ctxFor(editor, sel(editor, "paragraph"), false);
    for (const id of ["bold", "tex", "citation", "highlight", "heading-section"] as ActionId[]) {
      expect(verdictOf(row(id), ctx)).toEqual({ state: "disabled", reason: PEN });
    }
  });

  it("HOST: a host-read-only surface (the Reader) → the read-only reason, not the pen", () => {
    const { editor } = mount(false);
    // The surfaces fold the host axis into `canEdit` (task 733's conjunction).
    const ctx = ctxFor(editor, sel(editor, "paragraph"), false);
    expect(verdictOf(row("citation"), ctx)).toEqual({ state: "disabled", reason: HOST });
    // …and through a bare view too (the grab menu's ctx carries no `editor`).
    const viewOnly = { view: editor.view, ref: sel(editor, "paragraph"), canEdit: false } as ActionContext;
    expect(verdictOf(row("note"), viewOnly).reason).toBe(HOST);
  });

  it("the read-only reason WINS over a row's own refusal (whole-menu grey explains itself)", () => {
    const { editor } = mount(true);
    const ctx = ctxFor(editor, sel(editor, "titleField"), false);
    expect(verdictOf(row("citation"), ctx).reason).toBe(PEN);
  });

  it("SELECTION-MODE: highlight at a collapsed caret → select-text-first; with a range, none", () => {
    const { editor } = mount();
    const { from } = inside(editor, "paragraph");
    const caret = ctxFor(editor, { kind: "cursor", pos: from + 2, paragraphId: "" });
    expect(verdictOf(row("highlight"), caret)).toEqual({ state: "disabled", reason: NEEDS_SELECTION });
    expect(verdictOf(row("highlight"), ctxFor(editor, sel(editor, "paragraph"))).reason).toBeNull();
  });

  it("CARD container: Citation in a title, footnote in code → names the container", () => {
    const { editor } = mount();
    expect(verdictOf(row("citation"), ctxFor(editor, sel(editor, "titleField")))).toEqual({
      state: "disabled",
      reason: "Not available inside this title field",
    });
    expect(verdictOf(row("footnote"), ctxFor(editor, sel(editor, "codeBlock")))).toEqual({
      state: "disabled",
      reason: "Not available inside this code block",
    });
  });

  it("CARD kind: a block ref whose kind's curated set excludes the action → names the kind", () => {
    const { editor } = mount();
    const ref = { kind: "titleField", id: "title-A" } as ActionRef;
    const v = verdictOf(row("citation"), ctxFor(editor, ref));
    expect(v).toEqual({ state: "disabled", reason: "Not available on this title field" });
  });

  it("BLOCK-INSERT container: Raw LaTeX inside a code block → names the code block", () => {
    const { editor } = mount();
    const v = verdictOf(row("tex"), ctxFor(editor, sel(editor, "codeBlock")));
    expect(v).toEqual({ state: "disabled", reason: "Not available inside this code block" });
  });

  it("CAPTURE: Raw LaTeX over a cited sentence → the capture reason, not a container one", () => {
    const { editor } = mount();
    let cited: { from: number; to: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (cited || node.type.name !== "paragraph" || node.attrs.uuid !== "para-C") return !cited;
      cited = { from: pos + 1, to: pos + 1 + node.content.size };
      return false;
    });
    const { from, to } = cited!;
    const v = verdictOf(row("tex"), ctxFor(editor, { kind: "selection", from, to, paragraphId: "" }));
    expect(v.state).toBe("disabled");
    expect(v.reason).toBe(refusalPhrase({ cause: "capture" }));
  });

  it("FORMAT: a mark the container refuses → names the container", () => {
    const { editor } = mount();
    const v = verdictOf(row("bold"), ctxFor(editor, sel(editor, "codeBlock")));
    expect(v).toEqual({ state: "disabled", reason: "Not available inside this code block" });
  });
});

// ---------------------------------------------------------------------------
// (3) the grab menu renders it
// ---------------------------------------------------------------------------

const RECT = { left: 100, top: 100, right: 120, bottom: 140, width: 20, height: 40 };

function renderGrab(editor: Editor, target: ActionRef, canEdit: boolean): HTMLButtonElement[] {
  render(
    <DragHandleMenu
      anchorRect={RECT}
      kind="selection"
      target={target as never}
      editor={editor}
      canEdit={canEdit}
      onSelect={() => {}}
      onClose={() => {}}
    />,
  );
  return Array.from(
    document.querySelectorAll('[role="menu"] button[role="menuitem"]'),
  ) as HTMLButtonElement[];
}

const byLabel = (buttons: HTMLButtonElement[], label: string) =>
  buttons.find((b) => (b.textContent ?? "").includes(label))!;

describe("task 968 (3) — the grab menu RENDERS the reason", () => {
  it("canEdit=false: every row is greyed AND carries the pen reason as hint + description", () => {
    const { editor } = mount(true);
    const buttons = renderGrab(editor, sel(editor, "paragraph"), false);
    expect(buttons.length).toBeGreaterThanOrEqual(cardActionRows("grab").length);
    for (const b of buttons) {
      expect(b.disabled).toBe(true);
      expect(b.getAttribute("data-hint")).toBe(PEN);
      expect(b.getAttribute("aria-description")).toBe(PEN);
    }
  });

  it("a host-read-only surface: every row carries the read-only reason", () => {
    const { editor } = mount(false);
    for (const b of renderGrab(editor, sel(editor, "paragraph"), true)) {
      expect(b.disabled).toBe(true);
      expect(b.getAttribute("data-hint")).toBe(HOST);
    }
  });

  it("a selection inside a title: Citation says why; an enabled row carries no hint", () => {
    const { editor } = mount();
    const buttons = renderGrab(editor, sel(editor, "titleField"), true);
    const citation = byLabel(buttons, "Citation");
    expect(citation.disabled).toBe(true);
    expect(citation.getAttribute("data-hint")).toBe("Not available inside this title field");
    const enabled = buttons.filter((b) => !b.disabled);
    expect(enabled.length).toBeGreaterThan(0);
    for (const b of enabled) {
      expect(b.hasAttribute("data-hint")).toBe(false);
      expect(b.hasAttribute("aria-description")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// (4) the slash popup's door
// ---------------------------------------------------------------------------

describe("task 968 (4) — slashCommandReason answers the same gate", () => {
  it("a caret in a code block: a refused command names the container; in prose, none", () => {
    const { editor } = mount();
    const code = inside(editor, "codeBlock");
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, code.from + 1)),
    );
    expect(slashCommandReason(editor.view, "cite")).toBe("Not available inside this code block");
    const prose = inside(editor, "paragraph");
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, prose.from + 1)),
    );
    expect(slashCommandReason(editor.view, "cite")).toBeNull();
    expect(slashCommandReason(editor.view, "no-such-command")).toBeNull();
  });
});
