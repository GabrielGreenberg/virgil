// @vitest-environment jsdom
/**
 * renderAnnot keystroke bail (typing-latency fix 1c) — and the idempotent
 * `update()` law it grew into (task 551).
 *
 * The paragraph/list/heading NodeViews rebuild their annotation DOM
 * (`titleAnnot.innerHTML = ""` + span/button re-create + listener re-attach)
 * inside `renderAnnot()`. Before the bail, `update()` called it on EVERY
 * transaction touching the node — i.e. every keystroke typed inside the
 * block. The bail memoizes the render inputs (paragraph: parTitle + hasText;
 * heading: numbered + label) and skips the rebuild when they're unchanged.
 *
 * Pinned here via ELEMENT IDENTITY: typing must leave the annotation's child
 * elements identical (no rebuild); an actual input change must re-render.
 *
 * ## Task 551 — the fix reached three of five members
 *
 * The two expex NodeViews (block + item) are the same shape and never took
 * the bail: ProseMirror re-creates every ANCESTOR of an edited node, so one
 * character typed inside an example item ran BOTH views' `update()`, and each
 * rebuilt its annotation pods (`innerHTML = ""`), replaced the marker's text
 * node, and rewrote `className` / `data-number` / `data-kind` / `data-tag` /
 * `data-label` at their unchanged values — every one a style invalidation or
 * a DOM mutation, on the construct a linguistics paper types inside most.
 * The ordered-list view's `applyOrderedListAttrs` and the title field's
 * annotation text were the same disease one file over.
 *
 * The rule is stated once in `idempotent-dom.ts` (read first, write only on
 * a changed answer) and pinned three ways here: element identity on the real
 * main stack, a MUTATION-COUNT leg (N keystrokes record ZERO mutations on the
 * views' own elements), and a CENSUS — no `addNodeView` `update()` body in
 * either silo spells a bare DOM write. The census is the leg with teeth: the
 * door was never the part that could misbehave, a sixth NodeView that writes
 * around it is, and that type-checks perfectly.
 */
import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { REPO_ROOT, codeOnly } from "@/lib/__tests__/_source-scan";
import {
  nodeViewPopulation,
  nodeViewRegions,
  updateBodies,
} from "@/lib/tiptap/__tests__/_nodeview-census";

// Same storage stub as editor-extensions.test.ts — the extension barrel pulls
// @/lib/storage transitively and vitest can't resolve its backend require.
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { DocStructureObserver } from "@/lib/tiptap/doc-structure";
import {
  buildEditorExtensions,
  createParagraphWithTitle,
  createHeadingWithLabel,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";

function buildEditor() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    extensions: [
      StarterKit.configure({
        heading: false,
        paragraph: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        dropcursor: false,
      }),
      DocStructureObserver,
      createParagraphWithTitle(),
      createHeadingWithLabel({}, { surface: "main" }),
    ],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "p-titled", parTitle: "My title" },
          content: [{ type: "text", text: "Hello world" }],
        },
        { type: "paragraph", attrs: { uuid: "p-empty" } },
        {
          type: "heading",
          attrs: { level: 1, uuid: "h-1" },
          content: [{ type: "text", text: "Head" }],
        },
      ],
    },
  });
  return { editor, el };
}

const wrapperFor = (el: HTMLElement, uuid: string) =>
  el.querySelector<HTMLElement>(`[data-uuid="${uuid}"]`)!;

describe("renderAnnot keystroke bail (1c)", () => {
  it("paragraph: typing does not rebuild the title annotation; a parTitle change does", () => {
    const { editor, el } = buildEditor();
    try {
      const titleSpanBefore = wrapperFor(el, "p-titled").querySelector(".par-title-text");
      expect(titleSpanBefore).not.toBeNull();
      expect(titleSpanBefore!.textContent).toBe("My title");

      // Plain keystroke inside the titled paragraph (parTitle + hasText
      // unchanged) → the annotation's element identity must be stable.
      editor.view.dispatch(editor.state.tr.insertText("x", 5, 5));
      const titleSpanAfterTyping = wrapperFor(el, "p-titled").querySelector(".par-title-text");
      expect(titleSpanAfterTyping).toBe(titleSpanBefore);

      // Actual input change → re-render with the new title.
      editor.view.dispatch(editor.state.tr.setNodeAttribute(0, "parTitle", "Renamed"));
      const titleSpanAfterRename = wrapperFor(el, "p-titled").querySelector(".par-title-text");
      expect(titleSpanAfterRename!.textContent).toBe("Renamed");
    } finally {
      editor.destroy();
    }
  });

  it("paragraph: the has-text flip still re-renders (empty → typed)", () => {
    const { editor, el } = buildEditor();
    try {
      const emptyWrapper = wrapperFor(el, "p-empty");
      expect(emptyWrapper.classList.contains("has-text")).toBe(false);
      // p-titled nodeSize = 11 text + 2 = 13; p-empty content starts at 14.
      editor.view.dispatch(editor.state.tr.insertText("a", 14, 14));
      const after = wrapperFor(el, "p-empty");
      expect(after.classList.contains("has-text")).toBe(true);
      // The +T affordance materialized (hasText flip re-ran renderAnnot).
      expect(after.querySelector(".par-title-add")).not.toBeNull();
    } finally {
      editor.destroy();
    }
  });

  it("heading: typing does not rebuild the annotation; a label change does", () => {
    const { editor, el } = buildEditor();
    try {
      const chipBefore = wrapperFor(el, "h-1").querySelector(".heading-annotation-type-chip");
      expect(chipBefore).not.toBeNull();

      // Type inside the heading text (pos: p-titled 13 + p-empty 2 = 15;
      // heading content starts at 16).
      editor.view.dispatch(editor.state.tr.insertText("x", 17, 17));
      const chipAfterTyping = wrapperFor(el, "h-1").querySelector(".heading-annotation-type-chip");
      expect(chipAfterTyping).toBe(chipBefore);

      // Label change → re-render (label span appears).
      editor.view.dispatch(editor.state.tr.setNodeAttribute(15, "label", "sec:x"));
      const labelSpan = wrapperFor(el, "h-1").querySelector(".heading-label-text");
      expect(labelSpan).not.toBeNull();
      expect(labelSpan!.textContent).toBe("sec:x");
    } finally {
      editor.destroy();
    }
  });
});

// ---------------------------------------------------------------------------
// Task 551 — the REAL main stack, so the expex family, the ordered list and
// the title field are the shipped NodeViews (the 1c harness above mounts only
// the three views it was written for).
// ---------------------------------------------------------------------------

function ctx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

const T = (text: string): JSONContent => ({ type: "text", text });
const P = (text: string): JSONContent => ({ type: "paragraph", content: [T(text)] });

function mainFixture(): JSONContent {
  return {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { uuid: "p-0" }, content: [T("Lead paragraph.")] },
      {
        type: "exampleBlock",
        attrs: { uuid: "ex-1", kind: "multi", number: 1, parTitle: "Ex title", label: "ex:one" },
        content: [
          {
            type: "exampleItemList",
            content: [
              { type: "exampleItem", attrs: { uuid: "exi-1", label: "ex:a", subLabel: "a" }, content: [P("gloss one")] },
              { type: "exampleItem", attrs: { uuid: "exi-2", subLabel: "b" }, content: [P("gloss two")] },
            ],
          },
        ],
      },
      {
        type: "orderedList",
        attrs: { uuid: "ol-1", start: 3 },
        content: [{ type: "listItem", attrs: { uuid: "li-1" }, content: [P("item")] }],
      },
      { type: "titleField", attrs: { field: "title" }, content: [T("Paper")] },
    ],
  };
}

function buildMainEditor() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    extensions: buildEditorExtensions(ctx()),
    content: mainFixture(),
  });
  return {
    editor,
    el,
    destroy() {
      editor.destroy();
      el.remove();
    },
  };
}

/** Position of the node carrying `uuid` in the live doc. */
function posOf(editor: Editor, uuid: string): number {
  let found = -1;
  editor.state.doc.descendants((n, pos) => {
    if (found >= 0) return false;
    if (n.attrs?.uuid === uuid) {
      found = pos;
      return false;
    }
    return true;
  });
  if (found < 0) throw new Error(`no node with uuid ${uuid}`);
  return found;
}

/** Type `n` plain characters at the start of the text inside `exi-1`'s paragraph. */
function typeInItem(editor: Editor, n: number) {
  for (let i = 0; i < n; i++) {
    // exampleItem open (+1) → paragraph open (+1) → first text position.
    const at = posOf(editor, "exi-1") + 2;
    editor.view.dispatch(editor.state.tr.insertText("x", at, at));
  }
}

describe("task 551 — the expex family takes the renderAnnot bail", () => {
  it("exampleBlock: typing inside an item leaves the title strip, the label pod and the number IDENTICAL; a parTitle / label change re-renders", () => {
    const h = buildMainEditor();
    try {
      const wrapper = wrapperFor(h.el, "ex-1");
      const titleSpan = wrapper.querySelector(".par-title-annotation .par-title-text")!;
      const labelSpan = wrapper.querySelector(".expex-label-annotation .heading-label-text")!;
      const numberEl = wrapper.querySelector(".expex-number")!;
      const numberText = numberEl.firstChild!;
      expect(titleSpan.textContent).toBe("Ex title");
      expect(labelSpan.textContent).toBe("ex:one");

      typeInItem(h.editor, 3);

      expect(wrapper.querySelector(".par-title-annotation .par-title-text")).toBe(titleSpan);
      expect(wrapper.querySelector(".expex-label-annotation .heading-label-text")).toBe(labelSpan);
      expect(numberEl.firstChild).toBe(numberText);

      // A real input change still re-renders each strip.
      h.editor.view.dispatch(h.editor.state.tr.setNodeAttribute(posOf(h.editor, "ex-1"), "parTitle", "Renamed"));
      expect(wrapperFor(h.el, "ex-1").querySelector(".par-title-annotation .par-title-text")!.textContent).toBe("Renamed");
      h.editor.view.dispatch(h.editor.state.tr.setNodeAttribute(posOf(h.editor, "ex-1"), "label", "ex:two"));
      expect(wrapperFor(h.el, "ex-1").querySelector(".expex-label-annotation .heading-label-text")!.textContent).toBe("ex:two");
      expect(wrapperFor(h.el, "ex-1").querySelector(".expex-block")!.getAttribute("data-label")).toBe("ex:two");
    } finally {
      h.destroy();
    }
  });

  it("exampleItem: typing leaves the label pod and the marker's text node IDENTICAL; a renumber still moves the marker", () => {
    const h = buildMainEditor();
    try {
      const item = wrapperFor(h.el, "exi-1");
      const marker = item.querySelector(".expex-item-marker")!;
      const markerText = marker.firstChild!;
      const labelSpan = item.querySelector(".expex-item-label-annotation .heading-label-text")!;
      expect(marker.textContent).toBe("a.");
      expect(labelSpan.textContent).toBe("ex:a");

      typeInItem(h.editor, 3);

      expect(marker.firstChild).toBe(markerText);
      expect(item.querySelector(".expex-item-label-annotation .heading-label-text")).toBe(labelSpan);

      // Insert an item AHEAD of it: the numberer moves it to "b." and the
      // marker's text really changes.
      const listPos = posOf(h.editor, "exi-1") - 1; // exampleItemList open
      const schema = h.editor.state.schema;
      const fresh = schema.nodes.exampleItem.create(null, schema.nodes.paragraph.create(null, schema.text("new")));
      h.editor.view.dispatch(h.editor.state.tr.insert(listPos + 1, fresh));
      expect(wrapperFor(h.el, "exi-1").querySelector(".expex-item-marker")!.textContent).toBe("b.");
    } finally {
      h.destroy();
    }
  });

  it("N plain keystrokes inside an item record ZERO mutations on the block's and the item's own elements", () => {
    const h = buildMainEditor();
    try {
      const wrapper = wrapperFor(h.el, "ex-1");
      const blockDom = wrapper.querySelector<HTMLElement>(".expex-block")!;
      const item = wrapperFor(h.el, "exi-1");
      const observed: Array<[string, Element, MutationObserverInit]> = [
        ["block wrapper", wrapper, { attributes: true }],
        ["block dom", blockDom, { attributes: true, childList: true }],
        ["block number", wrapper.querySelector(".expex-number")!, { attributes: true, childList: true, characterData: true, subtree: true }],
        ["block title strip", wrapper.querySelector(".par-title-annotation")!, { attributes: true, childList: true, characterData: true, subtree: true }],
        ["block label pod", wrapper.querySelector(".expex-label-annotation")!, { attributes: true, childList: true, characterData: true, subtree: true }],
        ["item dom", item, { attributes: true, childList: true }],
        ["item marker", item.querySelector(".expex-item-marker")!, { attributes: true, childList: true, characterData: true, subtree: true }],
        ["item label pod", item.querySelector(".expex-item-label-annotation")!, { attributes: true, childList: true, characterData: true, subtree: true }],
      ];
      const observers = observed.map(([name, el, init]) => {
        const mo = new MutationObserver(() => {});
        mo.observe(el, init);
        return { name, mo };
      });
      // Drain anything the mount itself queued.
      for (const o of observers) o.mo.takeRecords();

      typeInItem(h.editor, 5);

      const dirty = observers
        .map((o) => {
          const recs = o.mo.takeRecords();
          o.mo.disconnect();
          return recs.length ? `${o.name}: ${recs.map((r) => r.type + (r.attributeName ? `(${r.attributeName})` : "")).join(", ")}` : null;
        })
        .filter(Boolean);
      expect(dirty, "a keystroke inside an example wrote to the views' own elements (task 551)").toEqual([]);
    } finally {
      h.destroy();
    }
  });

  it("orderedList: typing inside a start≠1 list writes no attribute on the <ol>", () => {
    const h = buildMainEditor();
    try {
      const ol = wrapperFor(h.el, "ol-1").querySelector("ol")!;
      expect(ol.getAttribute("start")).toBe("3");
      const mo = new MutationObserver(() => {});
      mo.observe(ol, { attributes: true });
      mo.takeRecords();
      for (let i = 0; i < 4; i++) {
        const at = posOf(h.editor, "li-1") + 2;
        h.editor.view.dispatch(h.editor.state.tr.insertText("x", at, at));
      }
      const recs = mo.takeRecords();
      mo.disconnect();
      expect(recs.map((r) => r.attributeName)).toEqual([]);
      // …and a real start change still lands.
      h.editor.view.dispatch(h.editor.state.tr.setNodeAttribute(posOf(h.editor, "ol-1"), "start", 7));
      expect(wrapperFor(h.el, "ol-1").querySelector("ol")!.getAttribute("start")).toBe("7");
    } finally {
      h.destroy();
    }
  });

  it("titleField: typing leaves the annotation's text node identical", () => {
    const h = buildMainEditor();
    try {
      const field = h.el.querySelector(".title-field-wrapper")!;
      const annot = field.querySelector(".title-field-annotation")!;
      const textNode = annot.firstChild!;
      let fieldPos = -1;
      h.editor.state.doc.descendants((n, pos) => {
        if (n.type.name === "titleField") fieldPos = pos;
        return fieldPos < 0;
      });
      for (let i = 0; i < 3; i++) {
        h.editor.view.dispatch(h.editor.state.tr.insertText("x", fieldPos + 1, fieldPos + 1));
      }
      expect(annot.firstChild).toBe(textNode);
    } finally {
      h.destroy();
    }
  });
});

// ---------------------------------------------------------------------------
// Task 551 — CENSUS: no `addNodeView` `update()` body spells a bare DOM write.
// Population and reach are the shared helpers the task-548 timer census reads
// (`_nodeview-census.ts`); the question here is asked of each `update(…) {}`
// METHOD body — the helper a body calls (`renderTitle()`, a pod's `render()`)
// is gated at the call site, and the behavioural legs above measure that gate.
// Allowlist EMPTY: a hit is ROUTE-it through `idempotent-dom.ts`.
// Stated limit: a bare write hidden one helper down is invisible here, exactly
// as the timer census states about an imported helper.
// ---------------------------------------------------------------------------

const BARE_DOM_WRITE =
  /(?:\.dataset\.\w+|\.className|\.textContent|\.innerHTML|\.title)\s*=(?!=)|\bdelete\s+[\w$.]+\.dataset\.\w+|\.(?:setAttribute|removeAttribute)\s*\(/g;

const DOOR = "src/lib/tiptap/idempotent-dom.ts";
const DOOR_VERBS = /\bset(?:Attr|Data|Text|ClassName|Title)IfChanged\s*\(/g;

describe("task 551 — census: a NodeView update() writes to the DOM only through the idempotent door", () => {
  const files = nodeViewPopulation();
  // Not point-free: `flatMap` would pass the INDEX as the reading (task 552).
  const regions = files.flatMap((f) => nodeViewRegions(f));
  const bodies = regions.flatMap((r) => updateBodies(r).map((body) => ({ label: r.label, body })));

  it("the population is discovered and non-empty (the five members are in it)", () => {
    for (const f of [
      "src/lib/tiptap/expex.ts",
      "src/lib/editor-extensions.ts",
      "src/lib/tiptap/title.ts",
      "src/lib/tiptap/label.ts",
      "src/lib/tiptap/footnote.ts",
    ]) {
      expect(files).toContain(f);
    }
    expect(bodies.length).toBeGreaterThan(8);
  });

  it("can see every shape of a bare write (synthetic canary)", () => {
    const planted = [
      "update(n) { dom.dataset.kind = n.attrs.kind; }",
      "update(n) { delete dom.dataset.tag; }",
      "update(n) { dom.className = `a ${b}`; }",
      "update(n) { marker.textContent = `${n.attrs.subLabel}.`; }",
      "update(n) { dom.title = t; }",
      "update(n) { el.setAttribute(\"start\", s); }",
      "update(n) { el.removeAttribute(\"start\"); }",
    ];
    for (const p of planted) {
      expect(Array.from(codeOnly(p).matchAll(BARE_DOM_WRITE)), p).toHaveLength(1);
    }
    const clean = [
      "update(n) { if (numberEl.textContent !== next) return; }",
      "update(n) { setDataIfChanged(dom, \"kind\", kind); setTextIfChanged(marker, s); }",
      "update(n) { if (dom.className === c) return; }",
    ];
    for (const c of clean) {
      expect(Array.from(codeOnly(c).matchAll(BARE_DOM_WRITE)), c).toHaveLength(0);
    }
  });

  it("no update() body in either silo spells a bare dataset / className / textContent / title / (set|remove)Attribute write", () => {
    const hits: string[] = [];
    for (const { label, body } of bodies) {
      for (const m of body.matchAll(BARE_DOM_WRITE)) {
        hits.push(`${label}: ${m[0].trim()}`);
      }
    }
    expect(hits, "a derived DOM write inside a NodeView update() — route it through idempotent-dom.ts (task 551)").toEqual([]);
  });

  it("the door has real NodeView callers, and the helpers the update bodies reach speak it too", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, DOOR))).toBe(true);
    const callers = new Set<string>();
    for (const f of files) {
      const src = codeOnly(fs.readFileSync(path.join(REPO_ROOT, f), "utf8"));
      if (DOOR_VERBS.test(src)) callers.add(f);
      DOOR_VERBS.lastIndex = 0;
    }
    for (const f of [
      "src/lib/tiptap/expex.ts",
      "src/lib/editor-extensions.ts",
      "src/lib/tiptap/title.ts",
      "src/lib/tiptap/label.ts",
      "src/lib/tiptap/citation.ts",
      "src/lib/tiptap/footnote.ts",
    ]) {
      expect(callers, `${f} should enter the door`).toContain(f);
    }
    // The uuid stamp every anchorable view calls from update() is a caller too.
    const stamp = codeOnly(fs.readFileSync(path.join(REPO_ROOT, "src/lib/tiptap/uuid-attr.ts"), "utf8"));
    expect(stamp).toMatch(/\bsetAttrIfChanged\s*\(/);
  });
});
