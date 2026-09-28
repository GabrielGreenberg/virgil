// @vitest-environment jsdom
//
// Task 823 — the static card tier (T1) is "visually identical" to the live
// body as a DECLARED, TESTED property:
//
//  1. CENSUS — every NodeView-bearing node in a card-body scope is either a
//     declared static twin or T1-unsafe (derived), and a body holding an
//     unsafe node is promoted past T1 (`bodyNeedsLiveRender` +
//     `resolveCollapsedTier`).
//  2. PARITY — for each twin (and the latexCommand decoration's static pass),
//     the static HTML and a live read-only editor over the SAME extension
//     list paint the same visible structure: tags, classes, the empty-pill
//     flag, and text. Before task 823 this failed on citation italics, the
//     empty `[cite]` pill, `p-cmd-only`, and bare `.latex-cmd` runs.

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", () => ({
  isDevStorage: false,
  readTex: vi.fn(() => Promise.resolve("")),
}));

import { Editor } from "@tiptap/core";
import {
  STATIC_TWIN_NODE_TYPES,
  STATIC_MATH_SELECTORS,
  bodyNeedsLiveRender,
  extensionsForScope,
  renderBorrowedHtml,
  t1UnsafeNodeTypes,
} from "@/lib/borrowed-render";
import { resolveCollapsedTier } from "@/cards/presence";
import { citationDisplay } from "@/lib/tiptap/citation-display";
import type { CardBodySchemaScope } from "@/lib/tiptap/borrowed-schema";

const doc = (...content: object[]) => ({ type: "doc", content });
const para = (...content: object[]) => ({ type: "paragraph", content });
const text = (t: string) => ({ type: "text", text: t });
const cite = (command: string, displayText: string) => ({
  type: "citation",
  attrs: { citationId: "c1", command, displayText },
});

/** The visible structure of a rendered body: element tag + classes (minus
 *  ProseMirror's own view scaffolding) + the empty-pill flag + text. */
function signature(root: Element): string {
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      out.push(JSON.stringify(node.textContent));
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const classes = [...el.classList].filter((c) => !c.startsWith("ProseMirror"));
    if ([...el.classList].some((c) => c.startsWith("ProseMirror-"))) return;
    const empty = el.getAttribute("data-empty") === "true" ? "[empty]" : "";
    out.push(`<${el.tagName.toLowerCase()}${classes.sort().map((c) => `.${c}`).join("")}${empty}>`);
    el.childNodes.forEach(walk);
    out.push(`</${el.tagName.toLowerCase()}>`);
  };
  root.childNodes.forEach(walk);
  // Adjacent text nodes are one run on screen.
  return out.join("").replace(/"\s*"/g, "");
}

function staticSignature(body: object, scope: CardBodySchemaScope): string {
  const html = renderBorrowedHtml(body, scope);
  expect(html).not.toBeNull();
  const host = document.createElement("div");
  host.innerHTML = html!;
  return signature(host);
}

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

function liveSignature(body: object, scope: CardBodySchemaScope): string {
  const editor = new Editor({
    extensions: extensionsForScope(scope),
    content: body,
    editable: false,
  });
  editors.push(editor);
  return signature(editor.view.dom);
}

const PARITY_FIXTURES: Record<string, object> = {
  "citation with <i> display text": doc(
    para(text("As in "), cite("\\citetitle{heidegger1927}", "<i>Being and Time</i>, ch. 1"), text(".")),
  ),
  "empty cite → [cite] pill": doc(para(text("Cf. "), cite("\\cite{}", ""), text(" here."))),
  "plain citation": doc(para(cite("\\citet{abusch2014}", "Abusch (2014)"), text(" argues."))),
  "command-only paragraphs (p-cmd-only)": doc(para(text("\\vspace{1em}")), para(text("\\noindent"))),
  "bare commands in prose (.latex-cmd)": doc(para(text("see \\foo{bar} and \\baz here"))),
  "footnote marker": doc(
    para(text("Text"), { type: "footnote", attrs: { footnoteId: "f1", number: 3 } }, text(" more")),
  ),
  "label ref": doc(para(text("See "), { type: "labelRef", attrs: { displayText: "2.1" } }, text("."))),
};

describe("static render parity (T1 ≡ live read-only body)", () => {
  for (const scope of ["card", "excerpt"] as const) {
    for (const [name, body] of Object.entries(PARITY_FIXTURES)) {
      it(`${scope}: ${name}`, () => {
        expect(staticSignature(body, scope)).toBe(liveSignature(body, scope));
      });
    }
  }

  it("the citation's italics are real elements, and the empty pill is flagged", () => {
    const sig = staticSignature(PARITY_FIXTURES["citation with <i> display text"]!, "card");
    expect(sig).toContain('<i>"Being and Time"</i>');
    expect(sig).not.toContain("&lt;i&gt;");
    expect(staticSignature(PARITY_FIXTURES["empty cite → [cite] pill"]!, "card")).toContain(
      '[empty]>"[cite]"',
    );
  });
});

describe("citationDisplay — the one answer both writers read", () => {
  it("keeps only i/b, decodes entities in the formatted branch, closes unclosed tags", () => {
    expect(citationDisplay("<i>A &amp; B</i> <span>x</span>", "").children).toEqual([
      ["i", "A & B"],
      " ",
      "x",
    ]);
    expect(citationDisplay("<b>bold <i>both", "").children).toEqual([["b", "bold ", ["i", "both"]]]);
  });
  it("unformatted text is literal (no entity decoding), and falls back to the command", () => {
    expect(citationDisplay("A &amp; B", "").children).toEqual(["A &amp; B"]);
    expect(citationDisplay("", "\\cite{x}")).toEqual({ empty: false, children: ["\\cite{x}"] });
    expect(citationDisplay("", "\\citep{ }").empty).toBe(true);
  });
});

describe("static-render census", () => {
  it("every NodeView-bearing node is a twin or T1-unsafe — and the unsafe set is derived", () => {
    const unsafe = t1UnsafeNodeTypes("excerpt");
    for (const name of STATIC_TWIN_NODE_TYPES) expect(unsafe.has(name)).toBe(false);
    // The NodeView-only looks the audit named, plus their siblings.
    for (const name of ["exampleBlock", "exampleItem", "exampleGloss", "latexComment", "figureBlock"]) {
      expect(unsafe.has(name)).toBe(true);
    }
    // The card scope has no expex at all.
    expect(t1UnsafeNodeTypes("card").has("exampleBlock")).toBe(false);
  });

  it("an archived example body needs the live render; a prose body does not", () => {
    const example = doc({
      type: "exampleBlock",
      attrs: { number: 4 },
      content: [para(text("Every linguist sleeps."))],
    });
    expect(bodyNeedsLiveRender(example, "excerpt")).toBe(true);
    expect(bodyNeedsLiveRender(PARITY_FIXTURES["plain citation"], "excerpt")).toBe(false);
    expect(bodyNeedsLiveRender(doc(para(text("\\% x"))), "card")).toBe(false);
  });

  it("an unsafe body is promoted past T1: to T2 where allowed, else to the T0 summary", () => {
    expect(resolveCollapsedTier("static", true, 3, true)).toBe(1);
    expect(resolveCollapsedTier("static", true, 3, false)).toBe(2);
    // Hidden pane / ramp stage 1: ceiling T1 → an unsafe body shows T0.
    expect(resolveCollapsedTier("static", true, 1, false)).toBe(0);
    expect(resolveCollapsedTier("static", true, 0, false)).toBe(0);
    expect(resolveCollapsedTier("near-live", false, 3, false)).toBe(2);
    expect(resolveCollapsedTier("near-live", false, 3, true)).toBe(1);
  });

  it("the KaTeX pass selects the math atoms the static HTML emits", () => {
    const html = renderBorrowedHtml(
      doc(para(text("x "), { type: "inlineMath", attrs: { latex: "a^2" } })),
      "card",
    )!;
    const host = document.createElement("div");
    host.innerHTML = html;
    expect(host.querySelectorAll(STATIC_MATH_SELECTORS.inline)).toHaveLength(1);
  });
});
