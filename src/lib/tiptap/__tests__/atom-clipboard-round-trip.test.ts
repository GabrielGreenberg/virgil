// @vitest-environment jsdom
//
// Task 1068 — an inline atom survives the in-editor clipboard.
//
// ProseMirror's copy/cut → paste is an HTML round trip (`renderHTML` →
// `parseHTML`). Before the shared attr codec, a footnote's rich `content`
// pasted back as "[object Object]", `\thanks` became `\footnote`, every id was
// dropped, and `$1.50$` / `\ref{1.10}` were number-coerced to `$1.5$` /
// `\ref{1.1}`. And the plain-text flavour emitted "" for every atom but `\cite`.
//
// CENSUS: every `inline && atom` node of the LIVE main schema — so a new atom,
// or a new attr on an old one, is covered without editing this file.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import {
  DOMParser as PMDOMParser,
  DOMSerializer,
  Fragment,
  Slice,
  type NodeType,
} from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import { ATOM_REGISTRY, atomMetaForNodeName } from "@/lib/tiptap/atom-registry";
import { ATOM_PLAIN_TEXT } from "@/lib/tiptap/atom-clipboard";

function ctx(surface: "main" | "float" = "main"): EditorExtensionsCtx {
  return {
    surface,
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  } as EditorExtensionsCtx;
}

const mounted: Editor[] = [];
function mount(content: JSONContent): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(ctx()),
    content,
  });
  mounted.push(editor);
  return editor;
}

const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;
beforeEach(() => {
  // jsdom has no ClipboardEvent; `view.pasteHTML` constructs one.
  if (typeof globalThis.ClipboardEvent === "undefined") {
    (globalThis as { ClipboardEvent?: unknown }).ClipboardEvent = class extends Event {
      clipboardData = null;
    };
  }
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => emptyList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => emptyList;
});
afterEach(() => {
  while (mounted.length) mounted.pop()?.destroy();
  document.body.innerHTML = "";
});

/** A value for `attr` that TipTap's default codec would mangle: numeric-looking
 *  strings, flipped booleans, non-default numbers, an object for a null-default
 *  `content`. */
function hostileValue(attr: string, dflt: unknown): unknown {
  if (attr === "content") {
    return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Real note" }] }] };
  }
  if (typeof dflt === "boolean") return !dflt;
  if (typeof dflt === "number") return dflt + 6;
  // string and null defaults: a numeric-looking STRING with a trailing zero.
  return "1.50";
}

function inlineAtomTypes(editor: Editor): NodeType[] {
  return Object.values(editor.schema.nodes).filter((t) => t.isInline && t.isLeaf && !t.isText);
}

/** The real copy path: PM's own clipboard serializer over a slice. */
function copy(editor: Editor, from: number, to: number) {
  return editor.view.serializeForClipboard(editor.state.doc.slice(from, to));
}

function pasteAtEnd(editor: Editor, html: string) {
  const end = editor.state.doc.content.size - 1;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)),
  );
  editor.view.pasteHTML(html);
}

function atoms(editor: Editor, name: string) {
  const out: Record<string, unknown>[] = [];
  editor.state.doc.descendants((n) => {
    if (n.type.name === name) out.push({ ...n.attrs });
    return true;
  });
  return out;
}

describe("attr codec census — every inline atom of the main schema", () => {
  it("covers every ATOM_REGISTRY kind (the census is not vacuous)", () => {
    const editor = mount({ type: "doc", content: [{ type: "paragraph" }] });
    const names = inlineAtomTypes(editor).map((t) => t.name);
    for (const meta of Object.values(ATOM_REGISTRY)) expect(names).toContain(meta.nodeName);
  });

  it("DOMSerializer → DOMParser preserves every attr, deep-equal", () => {
    const editor = mount({ type: "doc", content: [{ type: "paragraph" }] });
    const schema = editor.schema;
    const failures: string[] = [];
    for (const type of inlineAtomTypes(editor)) {
      const attrs: Record<string, unknown> = {};
      for (const [name, spec] of Object.entries(type.spec.attrs ?? {})) {
        attrs[name] = hostileValue(name, (spec as { default?: unknown }).default);
      }
      // Some atoms legitimately reject a combination (e.g. `\thanks` + an
      // override) only at SERIALIZE time; the node itself must carry it.
      const node = type.create(attrs);
      const para = schema.nodes.paragraph.create(null, node);
      const dom = DOMSerializer.fromSchema(schema).serializeFragment(Fragment.from(para));
      const host = document.createElement("div");
      host.appendChild(dom);
      const parsed = PMDOMParser.fromSchema(schema).parseSlice(host);
      let back: Record<string, unknown> | null = null;
      parsed.content.descendants((n) => {
        if (n.type === type) back = { ...n.attrs };
        return back === null;
      });
      if (!back) {
        failures.push(`${type.name}: did not parse back at all`);
        continue;
      }
      for (const [k, v] of Object.entries(node.attrs)) {
        if (JSON.stringify((back as Record<string, unknown>)[k]) !== JSON.stringify(v)) {
          failures.push(
            `${type.name}.${k}: ${JSON.stringify(v)} → ${JSON.stringify((back as Record<string, unknown>)[k])}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("every atom kind states its plain text", () => {
    // Record<AtomKind, …> makes this a compile error too; the runtime check
    // keeps the table and the registry in step.
    expect(Object.keys(ATOM_PLAIN_TEXT).sort()).toEqual(Object.keys(ATOM_REGISTRY).sort());
  });
});

const SOURCE =
  "Area $1.50$ and $.5$ see \\ref{1.10} x\\footnote{Real note} y\\thanks{T} z\\footnote[3]{Three} w\\cite{knuth}.";

describe("copy → paste through the real paste path", () => {
  it("a pasted copy saves byte-identical LaTeX (ids aside)", () => {
    const source = mount(parseLatex(SOURCE));
    const para = source.state.doc.child(0);
    const { dom } = copy(source, 1, 1 + para.content.size);
    const target = mount({ type: "doc", content: [{ type: "paragraph" }] });
    pasteAtEnd(target, dom.innerHTML);
    const strip = (s: string) => s.replace(/\\v[fc]id\{[^}]*\}/g, "").trim();
    expect(strip(serializeBodyOnly(target.getJSON()))).toBe(
      strip(serializeBodyOnly(source.getJSON())),
    );
    // Into a doc that holds none of them, every card-bearing id is KEPT.
    const ids = (e: Editor, n: string, k: string) => atoms(e, n).map((a) => a[k]);
    expect(ids(target, "footnote", "footnoteId")).toEqual(ids(source, "footnote", "footnoteId"));
    expect(ids(target, "citation", "citationId")).toEqual(ids(source, "citation", "citationId"));
  });

  it("COPY → paste in the same doc re-mints the colliding ids; the body travels", () => {
    const editor = mount(parseLatex("A\\footnote{Body text}\\cite{knuth} B."));
    const para = editor.state.doc.child(0);
    const { dom } = copy(editor, 1, 1 + para.content.size);
    pasteAtEnd(editor, dom.innerHTML);
    const fns = atoms(editor, "footnote");
    const cites = atoms(editor, "citation");
    expect(fns).toHaveLength(2);
    expect(cites).toHaveLength(2);
    expect(fns[0].footnoteId).toBeTruthy();
    expect(fns[1].footnoteId).toBeTruthy();
    expect(fns[1].footnoteId).not.toBe(fns[0].footnoteId);
    expect(fns[1].linkId || fns[1].footnoteId).toBe(fns[1].footnoteId);
    expect(cites[1].citationId).not.toBe(cites[0].citationId);
    expect(JSON.stringify(fns[1].content)).toBe(JSON.stringify(fns[0].content));
  });

  it("CUT → paste keeps the id (the card follows its text)", () => {
    const editor = mount(parseLatex("A\\footnote{Body text} B.\n\nSecond."));
    const para = editor.state.doc.child(0);
    const before = atoms(editor, "footnote")[0].footnoteId;
    const { dom } = copy(editor, 1, 1 + para.content.size);
    // The cut's delete lands before the paste.
    editor.view.dispatch(editor.state.tr.delete(1, 1 + para.content.size));
    expect(atoms(editor, "footnote")).toHaveLength(0);
    pasteAtEnd(editor, dom.innerHTML);
    const after = atoms(editor, "footnote");
    expect(after).toHaveLength(1);
    expect(after[0].footnoteId).toBe(before);
    expect(serializeBodyOnly(editor.getJSON())).toContain("\\footnote{Body text}");
  });
});

describe("plain-text flavour", () => {
  it("projects every atom through ATOM_PLAIN_TEXT", () => {
    const editor = mount(parseLatex("area $\\pi r^2$ (see \\ref{s2}) x\\footnote{N} y\\cite{knuth}."));
    const para = editor.state.doc.child(0);
    const { text } = copy(editor, 1, 1 + para.content.size);
    expect(text).toContain("$\\pi r^2$");
    expect(text).toMatch(/see (\\ref\{s2\}|\?\?|\S+)\)/);
    expect(text).not.toContain("see )");
    expect(text).toContain("x y");
    expect(text).toContain("knuth");
  });

  it("a slice with no atoms is untouched", () => {
    const editor = mount(parseLatex("Just words."));
    const slice = new Slice(Fragment.from(editor.state.doc.child(0)), 0, 0);
    expect(editor.view.serializeForClipboard(slice).text).toBe("Just words.");
    expect(atomMetaForNodeName("paragraph")).toBeNull();
  });
});
