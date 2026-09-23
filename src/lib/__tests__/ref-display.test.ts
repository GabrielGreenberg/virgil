// @vitest-environment jsdom
/**
 * TASK 550 — one label→display resolver, read by the parser, the numberer and
 * the ref popover.
 *
 * "What does `\ref{label}` show?" was answered three times: the parser's
 * `resolveRefs` (JSON, at load), the numberer's `resolveRef`
 * (`editor-extensions.ts`, on structural change), and the popover's
 * `resolveLabelDisplay` (`card-actions/ref.ts`, at insert / re-point). The
 * copies had drifted in BOTH directions — the popover copy had no figure
 * branch (a re-point at `fig:x` wrote `??` into the atom, and the numberer's
 * structural gate cannot see an atom attr write, so it stood), and the
 * numberer copy never registered a flat sub-item label, so a `\ref{ex:a}` the
 * parser resolved to "1a" at load flipped to `??` on the first structural
 * edit. `@/lib/ref-display` is the one table now.
 *
 * Legs: the leaf's contract over a PM doc; JSON/PM PARITY over ONE parsed
 * document (the parser's index and the live doc's index must be the same
 * table); the two DRIFT cases as defect legs; and the CENSUS — the leaf was
 * never the part that could misbehave, a fourth copy is, and a copy
 * type-checks perfectly.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import fs from "node:fs";
import path from "node:path";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import {
  buildRefTargetIndexJSON,
  buildRefTargetIndexPM,
  resolveLabelDisplay,
  resolveRefDisplay,
  resolveRefTarget,
} from "@/lib/ref-display";
import { REPO_ROOT, codeOnly, trackedFiles } from "./_source-scan";

function mainCtx(): EditorExtensionsCtx {
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

const editors: Editor[] = [];
function mount(content: JSONContent): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ed = new Editor({ element, editable: true, extensions: buildEditorExtensions(mainCtx()), content });
  editors.push(ed);
  return ed;
}
afterEach(() => {
  for (const ed of editors.splice(0)) ed.destroy();
  document.body.innerHTML = "";
});

/** A document exercising every target kind the resolver knows, plus one
 *  chip per shape so the numberer has something to write. */
function fixture(): JSONContent {
  const ref = (label: string, refCommand = "ref") => ({
    type: "labelRef",
    attrs: { label, displayText: "", refCommand, targetKind: null },
  });
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1, uuid: "h1", label: "sec:one" }, content: [{ type: "text", text: "One" }] },
      { type: "heading", attrs: { level: 2, uuid: "h2", label: "sec:one-a" }, content: [{ type: "text", text: "One A" }] },
      { type: "heading", attrs: { level: 1, uuid: "h3", label: "sec:star", numbered: false }, content: [{ type: "text", text: "Starred" }] },
      {
        type: "exampleBlock",
        attrs: { uuid: "ex-1", kind: "multi", tag: "ex:main", label: "", exnoOverride: null, suppressSpace: false, number: 1 },
        content: [
          {
            type: "exampleItemList",
            content: [
              {
                type: "exampleItem",
                attrs: { uuid: "it-a", tag: "", label: "ex:a", subLabel: "a" },
                content: [{ type: "paragraph", content: [{ type: "text", text: "First item." }] }],
              },
              {
                type: "exampleItem",
                attrs: { uuid: "it-b", tag: "", label: "", subLabel: "b" },
                content: [{ type: "paragraph", content: [
                  { type: "text", text: "Second item." },
                  { type: "text", text: "\\label{ex:body}", marks: [{ type: "latexCommand" }] },
                ] }],
              },
            ],
          },
        ],
      },
      {
        type: "figureBlock",
        attrs: { uuid: "fig-1", label: "fig:x", numbered: true },
        content: [{ type: "figureCaption", content: [{ type: "text", text: "A figure" }] }],
      },
      {
        // A float that emits NO `\caption` takes no number (task 319): the
        // predicate is `hasCaption || captionHasContent`, so the flag is the
        // half that says "none", not merely an empty caption child.
        type: "figureBlock",
        attrs: { uuid: "fig-2", label: "fig:nocap", numbered: true, hasCaption: false },
        content: [{ type: "figureCaption" }],
      },
      {
        type: "paragraph",
        attrs: { uuid: "p-refs" },
        content: [
          { type: "text", text: "See " }, ref("sec:one"), { type: "text", text: " " }, ref("sec:one-a", "getref"),
          { type: "text", text: " " }, ref("ex:main"), { type: "text", text: " " }, ref("ex:a"),
          { type: "text", text: " " }, ref("ex:main.ex:a", "getfullref"), { type: "text", text: " " }, ref("ex:body"),
          { type: "text", text: " " }, ref("fig:x"), { type: "text", text: " " }, ref("fig:nocap"),
          { type: "text", text: " " }, ref("sec:star"), { type: "text", text: " " }, ref("nope"),
        ],
      },
    ],
  };
}

describe("the ref-target index: one table for every kind (task 550)", () => {
  it("resolves heading / example / flat sub-item / dotted / body-label / figure keys", () => {
    const ed = mount(fixture());
    const index = buildRefTargetIndexPM(ed.state.doc);
    const show = (label: string, cmd = "ref") => resolveRefDisplay(index, label, cmd);
    expect(show("sec:one")).toEqual({ display: "1", targetKind: "heading" });
    expect(show("sec:one-a", "getref")).toEqual({ display: "(1.1)", targetKind: "heading" });
    expect(show("ex:main")).toEqual({ display: "1", targetKind: "example" });
    expect(show("ex:a")).toEqual({ display: "1a", targetKind: "example" });
    expect(show("ex:main.ex:a", "getfullref")).toEqual({ display: "(1a)", targetKind: "example" });
    expect(show("ex:body")).toEqual({ display: "1b", targetKind: "example" });
    expect(show("fig:x")).toEqual({ display: "1", targetKind: "figure" });
  });

  it("declares NO target for an unnumbered heading, a caption-less figure, or an unknown key", () => {
    const ed = mount(fixture());
    const index = buildRefTargetIndexPM(ed.state.doc);
    expect(resolveRefDisplay(index, "sec:star", "ref")).toEqual({ display: "??", targetKind: null });
    expect(resolveRefDisplay(index, "fig:nocap", "ref")).toEqual({ display: "??", targetKind: null });
    expect(resolveRefDisplay(index, "nope", "ref")).toEqual({ display: "??", targetKind: null });
    expect(resolveRefDisplay(index, "", "ref")).toEqual({ display: "??", targetKind: null });
  });

  it("carries the numbering rows the parser and the numberer both write from", () => {
    const ed = mount(fixture());
    const index = buildRefTargetIndexPM(ed.state.doc);
    expect(index.headings.map((h) => [h.label, h.number])).toEqual([
      ["sec:one", "1"], ["sec:one-a", "1.1"], ["sec:star", null],
    ]);
    expect(index.figures.map((f) => [f.label, f.number])).toEqual([["fig:x", 1], ["fig:nocap", null]]);
    // The fixture seeded no numbers, so every row's CURRENT differs from its
    // derived NUMBER where one is derived — that is the write the numberer does.
    expect(index.headings.every((h) => h.current === null)).toBe(true);
    expect(index.refs).toHaveLength(10);
  });

  it("a target carries its declaring node's position (a flat sub-item: the ITEM)", () => {
    const ed = mount(fixture());
    const index = buildRefTargetIndexPM(ed.state.doc);
    const item = resolveRefTarget(index, "ex:a");
    expect(item).not.toBeNull();
    expect(ed.state.doc.nodeAt(item!.pos)?.type.name).toBe("exampleItem");
    const block = resolveRefTarget(index, "ex:main");
    expect(ed.state.doc.nodeAt(block!.pos)?.type.name).toBe("exampleBlock");
    const fig = resolveRefTarget(index, "fig:x");
    expect(ed.state.doc.nodeAt(fig!.pos)?.type.name).toBe("figureBlock");
    const h = resolveRefTarget(index, "sec:one");
    expect(ed.state.doc.nodeAt(h!.pos)?.type.name).toBe("heading");
  });

  it("precedence: heading > example > figure for a key two kinds declare", () => {
    const ed = mount({
      type: "doc",
      content: [
        {
          type: "figureBlock",
          attrs: { uuid: "f", label: "dup", numbered: true },
          content: [{ type: "figureCaption", content: [{ type: "text", text: "c" }] }],
        },
        {
          type: "exampleBlock",
          attrs: { uuid: "e", kind: "single", tag: "dup", label: "", exnoOverride: null, suppressSpace: false, number: 1 },
          content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
        },
        { type: "heading", attrs: { level: 1, uuid: "h", label: "dup" }, content: [{ type: "text", text: "H" }] },
      ],
    });
    const index = buildRefTargetIndexPM(ed.state.doc);
    expect(resolveRefTarget(index, "dup")?.kind).toBe("heading");
  });

  it("the live-doc door (`resolveLabelDisplay`) answers the SAME table — figures included (the pre-550 popover gap)", () => {
    const ed = mount(fixture());
    expect(resolveLabelDisplay(ed.state.doc, "fig:x", "ref")).toEqual({ display: "1", targetKind: "figure" });
    expect(resolveLabelDisplay(ed.state.doc, "fig:x", "getref").display).toBe("(1)");
    expect(resolveLabelDisplay(ed.state.doc, "ex:a", "ref").display).toBe("1a");
  });
});

describe("JSON / ProseMirror parity — the parser's table IS the live table", () => {
  const TEX = String.raw`\documentclass{article}
\usepackage{expex}
\usepackage{graphicx}
\begin{document}
\section{One}\label{sec:one}
\subsection{One A}\label{sec:one-a}
\section*{Starred}\label{sec:star}
Text \ref{sec:one} and \getref{sec:one-a}.
\pex<ex:main>
\a\label{ex:a} First.
\a Second. \label{ex:body}
\xe
\begin{figure}
\includegraphics{a.png}
\caption{A figure}\label{fig:x}
\end{figure}
See \ref{ex:main}, \ref{ex:a}, \getfullref{ex:main.ex:a}, \ref{ex:body}, \ref{fig:x}, \ref{sec:star}, \ref{nope}.
\end{document}`;

  function refsOf(doc: JSONContent): Record<string, string> {
    const out: Record<string, string> = {};
    (function walk(n: JSONContent) {
      if (n.type === "labelRef") out[`${n.attrs?.refCommand}:${n.attrs?.label}`] = n.attrs?.displayText as string;
      n.content?.forEach(walk);
    })(doc);
    return out;
  }

  it("the parsed JSON index and the mounted PM index are the same targets map", () => {
    const parsed = parseLatex(TEX);
    const jsonIndex = buildRefTargetIndexJSON(parsed);
    const ed = mount(parsed);
    const pmIndex = buildRefTargetIndexPM(ed.state.doc);
    const strip = (m: ReadonlyMap<string, { kind: string; number: string }>) =>
      [...m.entries()].map(([k, t]) => [k, t.kind, t.number]).sort();
    expect(strip(jsonIndex.targets)).toEqual(strip(pmIndex.targets));
    expect(strip(jsonIndex.targets).length).toBeGreaterThanOrEqual(6);
  });

  it("what the parser wrote at load is what the live door answers for every chip", () => {
    const parsed = parseLatex(TEX);
    const written = refsOf(parsed);
    const ed = mount(parsed);
    for (const [key, display] of Object.entries(written)) {
      const colon = key.indexOf(":");
      const cmd = key.slice(0, colon);
      const label = key.slice(colon + 1);
      expect(resolveLabelDisplay(ed.state.doc, label, cmd as "ref").display, key).toBe(display);
    }
    expect(written["ref:fig:x"]).toBe("1");
    expect(written["ref:ex:a"]).toBe("1a");
    expect(written["ref:sec:star"]).toBe("??");
  });

  it("DEFECT LEG (numberer drift): after a structural edit every chip still shows the parser's answer — a flat sub-item ref no longer flips to `??`", () => {
    const parsed = parseLatex(TEX);
    const written = refsOf(parsed);
    const ed = mount(parsed);
    // A structural change wakes the numberer (an added heading).
    ed.commands.insertContentAt(ed.state.doc.content.size, {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Appended" }],
    });
    const after = refsOf(ed.getJSON());
    expect(after).toEqual(written);
    expect(after["ref:ex:a"]).toBe("1a");
  });
});

describe("census — ONE index, and every reader reads it", () => {
  const production = (root: string) =>
    trackedFiles(root, /\.tsx?$/).filter(
      (f) => !f.includes(`${path.sep}__tests__${path.sep}`) && !/\.test\.tsx?$/.test(f),
    );
  const rel = (f: string) => path.relative(REPO_ROOT, f).split(path.sep).join("/");
  const read = (f: string) => fs.readFileSync(f, "utf8");

  it("exactly one production file builds the ref-target index, and no other spells a heading/example/figure→number map", () => {
    const builders: string[] = [];
    const maps: string[] = [];
    for (const root of ["src", "library"]) {
      for (const f of production(root)) {
        const code = codeOnly(read(f));
        if (/function buildRefTargetIndex\b/.test(code)) builders.push(rel(f));
        if (/\b(headingMap|exampleMap|figureMap)\b/.test(code)) maps.push(rel(f));
      }
    }
    expect(builders).toEqual(["src/lib/ref-display.ts"]);
    expect(maps).toEqual([]);
  });

  it("the parser, the numberer and the popover handlers all import the leaf; the numberer keeps no private `resolveRef`", () => {
    const must = [
      "src/lib/latex-parser.ts",
      "src/lib/editor-extensions.ts",
      "src/components/editor-layout/card-actions/ref.ts",
      "src/components/EditorPane.tsx",
      "src/components/EditorLayout.tsx",
    ];
    for (const m of must) {
      expect(read(path.join(REPO_ROOT, m)), m).toMatch(/from "@\/lib\/ref-display"/);
    }
    const ext = codeOnly(read(path.join(REPO_ROOT, "src/lib/editor-extensions.ts")));
    expect(ext).not.toMatch(/const resolveRef\b/);
    expect(ext).toMatch(/buildRefTargetIndexPM\(/);
    const parser = codeOnly(read(path.join(REPO_ROOT, "src/lib/latex-parser.ts")));
    expect(parser).not.toMatch(/function (numberHeadings|numberFigures|resolveRefs)\b/);
    expect(parser).toMatch(/buildRefTargetIndexJSON\(/);
  });

  it("`card-actions/ref.ts` resolves nothing of its own: no `sectionNumber` read, no private display resolver", () => {
    const code = codeOnly(read(path.join(REPO_ROOT, "src/components/editor-layout/card-actions/ref.ts")));
    expect(code).not.toMatch(/sectionNumber/);
    expect(code).not.toMatch(/function resolveLabelDisplay\b/);
    expect(code).toMatch(/resolveLabelDisplay\(/);
  });

  it("the stale numberer prose ('displayText may stay stale') is renegotiated, not standing", () => {
    const raw = read(path.join(REPO_ROOT, "src/lib/editor-extensions.ts"));
    expect(raw).not.toMatch(/displayText may stay stale/);
    expect(raw).toMatch(/SAME table this pass reads/);
  });
});
