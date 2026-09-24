// @vitest-environment jsdom
/**
 * TASK 742 — a `\ref` to an equation label rendered "??".
 *
 * The ref picker LISTED every label raw source declares (a `displayMath`'s
 * `latex`, an unmodelled `equation` / `align` / `table` riding a verbatim
 * carrier), but the ref-target index knew only headings, examples and
 * figures, so the chip resolved to the "broken reference" `??`. The index now
 * reads raw source through `@/lib/latex-counters` — LaTeX's own numbering
 * rules stated once — and the numberer's structural gate asks each touched
 * block whether its counter signature changed (`rawCountersTouched`).
 */
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import {
  rawCounterSignature,
  scanDisplayMathCounters,
  scanRawTextCounters,
} from "@/lib/latex-counters";
import { buildRefTargetIndexJSON, buildRefTargetIndexPM, resolveRefDisplay } from "@/lib/ref-display";

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

function refsOf(doc: JSONContent): Record<string, string> {
  const out: Record<string, string> = {};
  (function walk(n: JSONContent) {
    if (n.type === "labelRef") out[`${n.attrs?.refCommand}:${n.attrs?.label}`] = n.attrs?.displayText as string;
    n.content?.forEach(walk);
  })(doc);
  return out;
}

const TEX = String.raw`\documentclass{article}
\usepackage{amsmath}
\begin{document}
\section{Intro}\label{sec:intro}
First.
\begin{equation}
E = mc^2 \label{eq:one}
\end{equation}
Starred:
\begin{equation*}
a = b
\end{equation*}
Display:
\[
x = y \label{eq:display}
\]
Aligned:
\begin{align}
a &= b \label{eq:a1} \\
c &= d \nonumber \\
e &= f \label{eq:a3} \\
\end{align}
Tagged:
\begin{equation}
g = h \tag{$\ast$} \label{eq:tag}
\end{equation}
\begin{equation}
i = j \label{eq:last}
\end{equation}
\begin{table}
\centering
\begin{tabular}{c}x\end{tabular}
\caption{A table}\label{tab:one}
\end{table}
See \ref{eq:one}, \ref{eq:display}, \ref{eq:a1}, \ref{eq:a3}, \ref{eq:tag}, \ref{eq:last}, \ref{tab:one}, \ref{nope}.
\end{document}`;

describe("latex-counters: LaTeX's numbering rules over raw source", () => {
  it("equation takes one number; the starred form and \\[…\\] take none", () => {
    expect(scanRawTextCounters("\\begin{equation}x\\label{a}\\end{equation}")).toEqual([
      { type: "unit", counter: "equation", tag: null, labels: ["a"] },
    ]);
    expect(scanRawTextCounters("\\begin{equation*}x\\label{a}\\end{equation*}")).toEqual([
      { type: "inherit", key: "a", local: null },
    ]);
    expect(scanDisplayMathCounters("x \\label{a}")).toEqual([{ type: "inherit", key: "a", local: null }]);
    expect(scanDisplayMathCounters("x \\tag{7} \\label{a}")).toEqual([
      { type: "unit", counter: "equation", tag: "7", labels: ["a"] },
    ]);
  });

  it("align numbers each top-level row — not rows of a nested aligned/cases, not a \\nonumber row, not a trailing empty row", () => {
    const events = scanRawTextCounters(
      "\\begin{align}a&=\\begin{cases}1\\\\2\\end{cases}\\label{r1}\\\\ b \\notag \\\\ c\\label{r3}\\\\\n\\end{align}",
    );
    expect(events.filter((e) => e.type === "unit")).toHaveLength(2);
    expect(events).toEqual([
      { type: "unit", counter: "equation", tag: null, labels: ["r1"] },
      { type: "unit", counter: "equation", tag: null, labels: ["r3"] },
    ]);
  });

  it("a float steps its counter at each \\caption (never \\caption*); a commented-out label declares nothing", () => {
    expect(scanRawTextCounters("\\begin{table}\\caption{T}\\label{t}\\end{table}")).toEqual([
      { type: "unit", counter: "table", tag: null, labels: ["t"] },
    ]);
    expect(scanRawTextCounters("\\begin{figure}\\caption*{T}\\label{f}\\end{figure}")).toEqual([
      { type: "inherit", key: "f", local: null },
    ]);
    expect(scanRawTextCounters("% \\label{gone}\nplain")).toEqual([]);
  });

  it("the signature is blind to plain edits and sees a new row", () => {
    const sig = (t: string) => rawCounterSignature(scanRawTextCounters(t));
    const base = "\\begin{align}a&=b\\label{x}\\end{align}";
    expect(sig(base)).toBe(sig(base.replace("a&=b", "aa&=bb")));
    expect(sig(base)).not.toBe(sig(base.replace("a&=b", "a&=b\\\\c&=d")));
  });
});

describe("the ref-target index numbers equations and tables (task 742)", () => {
  it("every \\ref to a declared label renders a number, never ??", () => {
    const written = refsOf(parseLatex(TEX));
    expect(written["ref:eq:one"]).toBe("1");
    // `\[…\]` is unnumbered: its label takes \@currentlabel — the section.
    expect(written["ref:eq:display"]).toBe("1");
    expect(written["ref:eq:a1"]).toBe("2");
    expect(written["ref:eq:a3"]).toBe("3");
    expect(written["ref:eq:tag"]).toBe("$\\ast$");
    expect(written["ref:eq:last"]).toBe("4");
    expect(written["ref:tab:one"]).toBe("1");
    expect(written["ref:nope"]).toBe("??");
  });

  it("the parser's JSON table and the live PM table agree on every raw target", () => {
    const parsed = parseLatex(TEX);
    const ed = mount(parsed);
    const strip = (m: ReadonlyMap<string, { kind: string; number: string }>) =>
      [...m.entries()].map(([k, t]) => [k, t.kind, t.number]).sort();
    const pm = buildRefTargetIndexPM(ed.state.doc);
    expect(strip(buildRefTargetIndexJSON(parsed).targets)).toEqual(strip(pm.targets));
    expect(resolveRefDisplay(pm, "eq:a3", "getref")).toEqual({ display: "(3)", targetKind: "equation" });
    expect(resolveRefDisplay(pm, "tab:one", "ref").targetKind).toBe("table");
  });

  it("the numberer re-derives when an equation is added before a labelled one — and a plain keystroke does not wake it", () => {
    const ed = mount(parseLatex(TEX));
    expect(refsOf(ed.getJSON())["ref:eq:last"]).toBe("4");

    // Insert a NEW numbered display at the very top: every later number shifts.
    ed.commands.insertContentAt(0, {
      type: "paragraph",
      content: [{ type: "text", text: "\\begin{equation}z\\end{equation}" }],
    });
    const after = refsOf(ed.getJSON());
    expect(after["ref:eq:one"]).toBe("2");
    expect(after["ref:eq:last"]).toBe("5");

    // A plain keystroke inside that raw equation changes no signature.
    let appended = 0;
    ed.on("transaction", ({ transaction }) => {
      if (transaction.getMeta("appendedTransaction")) appended++;
    });
    const posInEq = ed.state.doc.firstChild!.content.size; // inside the first block's text
    ed.commands.insertContentAt(posInEq, "q");
    expect(appended).toBe(0);
    expect(refsOf(ed.getJSON())["ref:eq:last"]).toBe("5");
  });
});
