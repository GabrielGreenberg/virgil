import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly as serializeBody } from "@/lib/latex-serializer";
import {
  canEditWidthInOptions,
  extractFigureAttrs,
  setWidthInOptions,
  withReplacedFigurePath,
  withUpdatedFigureWidth,
} from "@/lib/figures/parse-attrs";
import { buildFigureEnvBody } from "@/lib/figures/env-body";

function parseBody(input: string): JSONContent {
  const wrapped = `\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`;
  return parseLatex(wrapped);
}

function findByType(node: JSONContent, type: string, out: JSONContent[] = []): JSONContent[] {
  if (node.type === type) out.push(node);
  if (node.content) for (const c of node.content) findByType(c, type, out);
  return out;
}

describe("figureBlock round-trip", () => {
  it("parses `\\begin{figure}` with caption + label", () => {
    const input = `Before.

\\begin{figure}[ht]
  \\centering
  \\includegraphics[width=0.6\\textwidth]{figures/fig1}
  \\caption{A schematic.}
  \\label{fig:bands}
\\end{figure}

After.`;
    const json = parseBody(input);
    const figs = findByType(json, "figureBlock");
    expect(figs).toHaveLength(1);
    expect(figs[0].attrs?.source).toBe("figures/fig1");
    expect(figs[0].attrs?.widthPercent).toBe(60);
    expect(figs[0].attrs?.label).toBe("fig:bands");
    expect(figs[0].attrs?.placement).toBe("[ht]");
    expect(figs[0].attrs?.starred).toBe(false);
    // Caption is now a child node, not a flat attr — assert against the
    // child's inline text content.
    const captions = findByType(figs[0], "figureCaption");
    expect(captions).toHaveLength(1);
    const captionText = (captions[0].content || [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    expect(captionText).toBe("A schematic.");
    // Parser-side numbering pass assigns figureNumber on first paint.
    expect(figs[0].attrs?.figureNumber).toBe(1);
  });

  it("recognises `\\begin{figure*}` starred variant", () => {
    const input = `\\begin{figure*}\n  \\includegraphics{x}\n\\end{figure*}\n`;
    const json = parseBody(input);
    const figs = findByType(json, "figureBlock");
    expect(figs).toHaveLength(1);
    expect(figs[0].attrs?.starred).toBe(true);
  });

  it("captures subfigures (multiple \\includegraphics in one env)", () => {
    const input = `\\begin{figure}
  \\includegraphics[width=0.3\\textwidth]{a}
  \\includegraphics[width=0.3\\textwidth]{b}
  \\caption{Side by side.}
\\end{figure}\n`;
    const json = parseBody(input);
    const figs = findByType(json, "figureBlock");
    expect(figs).toHaveLength(1);
    expect(figs[0].attrs?.sources).toHaveLength(2);
    const sources = figs[0].attrs?.sources as Array<{ path: string }>;
    expect(sources[0].path).toBe("a");
    expect(sources[1].path).toBe("b");
  });

  it("round-trips the figure env body verbatim", () => {
    const body = `\n  \\centering\n  \\includegraphics[width=0.6\\textwidth]{figures/fig1}\n  \\caption{A schematic.}\n  \\label{fig:bands}\n`;
    const input = `\\begin{figure}[ht]${body}\\end{figure}\n`;
    const json = parseBody(input);
    const out = serializeBody(json);
    expect(out).toContain("\\begin{figure}[ht]");
    expect(out).toContain("\\includegraphics[width=0.6\\textwidth]{figures/fig1}");
    expect(out).toContain("\\caption{A schematic.}");
    expect(out).toContain("\\label{fig:bands}");
    expect(out).toContain("\\end{figure}");
  });

  it("preserves \\begin{figure*} on serialize", () => {
    const input = `\\begin{figure*}\n  \\includegraphics{x}\n\\end{figure*}\n`;
    const json = parseBody(input);
    const out = serializeBody(json);
    expect(out).toContain("\\begin{figure*}");
    expect(out).toContain("\\end{figure*}");
  });

  it("round-trips a \\cite inside the caption as a structured node", () => {
    const input = `\\begin{figure}
  \\centering
  \\includegraphics[width=0.5\\textwidth]{plot}
  \\caption{See \\cite{foo} for context.}
  \\label{fig:plot}
\\end{figure}\n`;
    const json = parseBody(input);
    const captions = findByType(json, "figureCaption");
    expect(captions).toHaveLength(1);
    const captionNodes = captions[0].content || [];
    // Caption body should have split into text + citation + text.
    const citationNodes = captionNodes.filter((c) => c.type === "citation");
    expect(citationNodes).toHaveLength(1);
    // Serializing back should reproduce the \cite{} marker (vcid marker
    // prefix is acceptable — the citation node round-trips with a stable id).
    const out = serializeBody(json);
    // The serializer emits a \vcid{…} stable-id marker before the citation;
    // accept anything between "See " and "\cite{foo}" so the assertion
    // doesn't break when the marker changes shape.
    expect(out).toMatch(/\\caption\{See .*?\\cite\{foo\}/);
    expect(out).toContain("for context.");
    expect(out).toContain("\\label{fig:plot}");
  });

  it("captures the optional \\caption[short] list-of-figures argument", () => {
    const input = `\\begin{figure}
  \\includegraphics{img}
  \\caption[Short LoF text]{Full descriptive caption}
  \\label{fig:x}
\\end{figure}\n`;
    const json = parseBody(input);
    const figs = findByType(json, "figureBlock");
    expect(figs).toHaveLength(1);
    expect(figs[0].attrs?.shortCaption).toBe("Short LoF text");
  });

  it("round-trips \\caption[short]{long} re-emitting the [short] bracket byte-for-byte (task 263)", () => {
    const input = `\\begin{figure}
  \\includegraphics{img}
  \\caption[Short LoF text]{Full descriptive caption}
  \\label{fig:x}
\\end{figure}\n`;
    const json = parseBody(input);
    const out = serializeBody(json);
    expect(out).toContain("\\caption[Short LoF text]{Full descriptive caption}");
  });

  it("leaves a bracket-free \\caption{...} byte-identical (no spurious [] on serialize)", () => {
    const input = `\\begin{figure}
  \\includegraphics{img}
  \\caption{Plain caption}
\\end{figure}\n`;
    const json = parseBody(input);
    const figs = findByType(json, "figureBlock");
    expect(figs[0].attrs?.shortCaption).toBeNull();
    const out = serializeBody(json);
    expect(out).toContain("\\caption{Plain caption}");
    expect(out).not.toContain("\\caption[");
  });

  it("preserves an empty \\caption[]{long} bracket (opaque, not dropped)", () => {
    const input = `\\begin{figure}
  \\includegraphics{img}
  \\caption[]{Long body}
\\end{figure}\n`;
    const json = parseBody(input);
    const figs = findByType(json, "figureBlock");
    expect(figs[0].attrs?.shortCaption).toBe("");
    const out = serializeBody(json);
    expect(out).toContain("\\caption[]{Long body}");
  });

  // The popover re-extraction path (FigureBlockNodeView / EditorLayout
  // `updateFromText`) rebuilds figure attrs from the edited source via
  // `extractFigureAttrs`, so that seam must surface `shortCaption` for the
  // re-thread to pick up — else editing the `[short]` bracket in the popover
  // is silently ignored (task 263, popover edit path).
  it("extractFigureAttrs surfaces shortCaption for the popover re-extraction seam", () => {
    const withShort = extractFigureAttrs(
      `\n  \\includegraphics{img}\n  \\caption[LoF text]{Long body}\n`,
    );
    expect(withShort.shortCaption).toBe("LoF text");
    const withoutShort = extractFigureAttrs(
      `\n  \\includegraphics{img}\n  \\caption{Long body}\n`,
    );
    expect(withoutShort.shortCaption).toBeNull();
  });

  // ---------------------------------------------------------------------
  // task 245 — a `\caption` / `\label` belongs to the figure only if it LIVES
  // at figure depth. First-match `indexOf` extraction was blind to three kinds
  // of containment, and each one produced a non-idempotent round-trip because
  // `extras` stripped different bytes than the serializer re-emitted.
  // ---------------------------------------------------------------------
  describe("caption/label containment (task 245)", () => {
    const nested = `\\begin{figure}
  \\begin{subfigure}{0.4\\textwidth}
    \\includegraphics{a}
    \\caption{Sub A}
    \\label{fig:suba}
  \\end{subfigure}
  \\caption{Main}
  \\label{fig:main}
\\end{figure}\n`;

    it("takes the figure's OWN caption, not a nested subfigure's", () => {
      const json = parseBody(nested);
      const figs = findByType(json, "figureBlock");
      expect(figs).toHaveLength(1);
      const captionText = (findByType(figs[0], "figureCaption")[0].content || [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      expect(captionText).toBe("Main");
      // The figure's own label survives — the old global `\label` strip
      // hoisted `fig:suba` and DELETED `fig:main` outright.
      expect(figs[0].attrs?.label).toBe("fig:main");
      // The subfigure rides along in `extras` byte-raw, subcaption included.
      const extras = figs[0].attrs?.extras as string;
      expect(extras).toContain("\\begin{subfigure}{0.4\\textwidth}");
      expect(extras).toContain("\\caption{Sub A}");
      expect(extras).toContain("\\label{fig:suba}");
      expect(extras).not.toContain("\\caption{Main}");
      expect(extras).not.toContain("\\label{fig:main}");
    });

    it("round-trips a nested subfigure to a fixed point (no relocation, no oscillation)", () => {
      const once = serializeBody(parseBody(nested));
      const twice = serializeBody(parseBody(once));
      // The oscillation: pre-fix the two captions swapped places every cycle.
      expect(twice).toBe(once);
      // Exactly one figure-level caption, and the subcaption is still INSIDE
      // its subfigure (it used to be ripped up to figure level).
      expect(once.match(/\\caption\{/g)).toHaveLength(2);
      const subStart = once.indexOf("\\begin{subfigure}");
      const subEnd = once.indexOf("\\end{subfigure}");
      expect(subStart).toBeGreaterThan(-1);
      expect(once.indexOf("\\caption{Sub A}")).toBeGreaterThan(subStart);
      expect(once.indexOf("\\caption{Sub A}")).toBeLessThan(subEnd);
      expect(once.indexOf("\\label{fig:suba}")).toBeLessThan(subEnd);
      // …and the figure's own caption/label sit outside it.
      expect(once.indexOf("\\caption{Main}")).toBeGreaterThan(subEnd);
      expect(once).toContain("\\label{fig:main}");
    });

    it("ignores a commented-out \\caption", () => {
      const input = `\\begin{figure}
  \\includegraphics{a}
  % \\caption{TODO write me}
  \\caption{Real}
\\end{figure}\n`;
      const json = parseBody(input);
      const figs = findByType(json, "figureBlock");
      const captionText = (findByType(figs[0], "figureCaption")[0].content || [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      expect(captionText).toBe("Real");
      const once = serializeBody(json);
      expect(serializeBody(parseBody(once))).toBe(once);
      // The comment is preserved verbatim, and the real caption is not doubled.
      expect(once).toContain("% \\caption{TODO write me}");
      expect(once.match(/\n\s*\\caption\{Real\}/g)).toHaveLength(1);
    });

    it("reads a caption-carried \\label into the attr so \\ref still resolves", () => {
      const input = `\\begin{figure}
  \\includegraphics{a}
  \\caption{Foo \\label{fig:x}}
\\end{figure}\n`;
      const json = parseBody(input);
      const figs = findByType(json, "figureBlock");
      expect(figs[0].attrs?.label).toBe("fig:x");
      const once = serializeBody(json);
      expect(once).toContain("\\caption{Foo \\label{fig:x}}");
      expect(serializeBody(parseBody(once))).toBe(once);
    });

    // A caption that QUOTES a label declares nothing. The verbatim skip keeps
    // the scan from reading it as the figure's label — and the figure's REAL
    // declaration, on the line below, is the one that reaches the attr.
    it("ignores a \\label quoted inside \\verb in the caption", () => {
      const input = `\\begin{figure}
  \\includegraphics{a}
  \\caption{Write \\verb|\\label{fig:x}| here}
  \\label{fig:real}
\\end{figure}\n`;
      const json = parseBody(input);
      const figs = findByType(json, "figureBlock");
      expect(figs[0].attrs?.label).toBe("fig:real");
      const once = serializeBody(json);
      expect(once).toContain("\\label{fig:real}");
      expect(serializeBody(parseBody(once))).toBe(once);
    });

    // A `%` inside inline verbatim is a percent sign, not a comment start —
    // the scan must not skip the rest of that line and lose the caption.
    it("does not read a \\verb-quoted % as a comment", () => {
      const input = `\\begin{figure}
  \\includegraphics{a}
  \\verb|%| \\caption{Foo}
  \\label{fig:v}
\\end{figure}\n`;
      const json = parseBody(input);
      const figs = findByType(json, "figureBlock");
      const captionText = (findByType(figs[0], "figureCaption")[0].content || [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      expect(captionText).toBe("Foo");
      expect(figs[0].attrs?.label).toBe("fig:v");
      const once = serializeBody(json);
      expect(once.match(/\\caption\{/g)).toHaveLength(1);
      expect(serializeBody(parseBody(once))).toBe(once);
    });

    // A BOX env is not a float: LaTeX binds a `\caption` inside `center` /
    // `minipage` to the enclosing figure, and depth-counting it stranded the
    // figure's own caption in `extras` while the always-present caption child
    // still emitted an empty `\caption{}` — two captions, two figure numbers.
    it.each(["center", "minipage{\\textwidth}"])(
      "treats a non-float %s wrapper as transparent",
      (env) => {
        const name = env.split("{")[0];
        const input = `\\begin{figure}
\\begin{${env}}
\\includegraphics{a}
\\caption{Foo}
\\label{fig:x}
\\end{${name}}
\\end{figure}\n`;
        const json = parseBody(input);
        const figs = findByType(json, "figureBlock");
        const captionText = (findByType(figs[0], "figureCaption")[0].content || [])
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("");
        expect(captionText).toBe("Foo");
        expect(figs[0].attrs?.label).toBe("fig:x");
        const once = serializeBody(json);
        expect(once.match(/\\caption\{/g)).toHaveLength(1);
        expect(once).not.toContain("\\caption{}");
        expect(serializeBody(parseBody(once))).toBe(once);
      },
    );

    // An unmatched `\begin{…}` (LaTeX shown as sample code) must not bury the
    // caption at an unreachable depth — that appended a fresh empty
    // `\caption{}` on EVERY save, growing without bound.
    // The mirror direction: an `\end` with no `\begin` puts the scan BELOW
    // figure level, and a later stray `\begin` nets the counter back to zero —
    // so "did it end at zero?" is not the question. The excursion is what
    // forfeits depth-awareness.
    it("falls back when depth dips NEGATIVE and returns to zero", () => {
      const input = `\\begin{figure}
\\end{subfigure}
\\caption{Real}
\\label{fig:a}
\\begin{subfigure}{0.4\\textwidth}
\\end{figure}\n`;
      const json = parseBody(input);
      const figs = findByType(json, "figureBlock");
      const captionText = (findByType(figs[0], "figureCaption")[0].content || [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      expect(captionText).toBe("Real");
      expect(figs[0].attrs?.label).toBe("fig:a");
      const once = serializeBody(json);
      expect(once.match(/\\caption\{/g)).toHaveLength(1);
      expect(serializeBody(parseBody(once))).toBe(once);
    });

    // `\verb` has no optional argument, so a `[` after it IS the delimiter —
    // scanning for a `]` ran into the caption on the next line and swallowed it.
    it("treats `[` after \\verb as the delimiter, not an option bracket", () => {
      const input = `\\begin{figure}
  \\verb[x[
  \\caption{Real [1]}
  \\label{fig:a}
\\end{figure}\n`;
      const json = parseBody(input);
      const figs = findByType(json, "figureBlock");
      const captionText = (findByType(figs[0], "figureCaption")[0].content || [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      expect(captionText).toContain("Real");
      expect(figs[0].attrs?.label).toBe("fig:a");
      const once = serializeBody(json);
      expect(once.match(/\\caption\{/g)).toHaveLength(1);
      expect(serializeBody(parseBody(once))).toBe(once);
    });

    // A listings option list can nest brackets; a flat `indexOf("]")` stopped
    // inside one and then guessed a delimiter that swallowed the caption.
    it("handles a nested bracket in a \\lstinline option list", () => {
      const input = `\\begin{figure}
  \\lstinline[keywordstyle=[2]\\color{red}]|x|
  \\caption{Real}
  \\label{fig:a}
\\end{figure}\n`;
      const json = parseBody(input);
      const figs = findByType(json, "figureBlock");
      const captionText = (findByType(figs[0], "figureCaption")[0].content || [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      expect(captionText).toBe("Real");
      expect(figs[0].attrs?.label).toBe("fig:a");
      const once = serializeBody(json);
      expect(once.match(/\\caption\{/g)).toHaveLength(1);
      expect(serializeBody(parseBody(once))).toBe(once);
    });

    it("falls back to depth-blind extraction on an unbalanced body", () => {
      const input = `\\begin{figure}
\\begin{subfigure}{0.4\\textwidth}
\\includegraphics{a}
\\caption{How to open a subfigure}
\\label{fig:code}
\\end{figure}\n`;
      const json = parseBody(input);
      const figs = findByType(json, "figureBlock");
      const captionText = (findByType(figs[0], "figureCaption")[0].content || [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      expect(captionText).toBe("How to open a subfigure");
      expect(figs[0].attrs?.label).toBe("fig:code");
      const once = serializeBody(json);
      const twice = serializeBody(parseBody(once));
      expect(twice).toBe(once);
      expect(once.match(/\\caption\{/g)).toHaveLength(1);
    });

    it("leaves the flat multi-\\includegraphics figure untouched (regression)", () => {
      const input = `\\begin{figure}
  \\centering
  \\includegraphics[width=0.3\\textwidth]{a}
  \\includegraphics[width=0.3\\textwidth]{b}
  \\caption{Side by side.}
  \\label{fig:pair}
\\end{figure}\n`;
      const json = parseBody(input);
      const figs = findByType(json, "figureBlock");
      expect(figs[0].attrs?.sources).toHaveLength(2);
      expect(figs[0].attrs?.label).toBe("fig:pair");
      const extras = figs[0].attrs?.extras as string;
      expect(extras).toContain("\\centering");
      expect(extras).toContain("\\includegraphics[width=0.3\\textwidth]{a}");
      expect(extras).not.toContain("\\caption");
      expect(extras).not.toContain("\\label");
      const once = serializeBody(json);
      expect(once).toContain("\\caption{Side by side.}");
      expect(once).toContain("\\label{fig:pair}");
      expect(serializeBody(parseBody(once))).toBe(once);
    });

    it("keeps a nested caption when the figure has none of its own", () => {
      const input = `\\begin{figure}
  \\begin{subfigure}{0.4\\textwidth}
    \\includegraphics{a}
    \\caption{Only sub}
  \\end{subfigure}
\\end{figure}\n`;
      const json = parseBody(input);
      const figs = findByType(json, "figureBlock");
      const captionText = (findByType(figs[0], "figureCaption")[0].content || [])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      expect(captionText).toBe("");
      const once = serializeBody(json);
      const subEnd = once.indexOf("\\end{subfigure}");
      expect(once.indexOf("\\caption{Only sub}")).toBeLessThan(subEnd);
      expect(serializeBody(parseBody(once))).toBe(once);
    });

    // Every hand-written case above pins ONE shape. Three review passes on this
    // change found five, then two, regressions that all shared a signature the
    // individual cases kept missing: the figure's own `\caption`/`\label` went
    // missing from the model, rode along in raw `extras`, and the always-present
    // caption child appended a second, empty `\caption{}` — a stable state that
    // never self-heals. So the property is asserted over a CORPUS: whatever the
    // scan decides about ownership, the round-trip must neither lose a
    // declaration nor invent a caption, and must be a fixed point. A future
    // change to the scan gets this for free.
    describe("corpus invariants", () => {
      const CORPUS: Record<string, string> = {
        centering: `\\centering\n\\includegraphics{a}\n\\caption{C}\n\\label{fig:a}`,
        centerEnv: `\\begin{center}\n\\includegraphics{a}\n\\caption{C}\n\\label{fig:a}\n\\end{center}`,
        minipagePair: `\\begin{minipage}{0.45\\textwidth}\n\\includegraphics{a}\n\\end{minipage}\n\\begin{minipage}{0.45\\textwidth}\n\\includegraphics{b}\n\\end{minipage}\n\\caption{C}\n\\label{fig:a}`,
        subfigurePair: `\\begin{subfigure}{0.45\\textwidth}\n\\includegraphics{a}\n\\caption{S1}\n\\label{fig:s1}\n\\end{subfigure}\n\\begin{subfigure}{0.45\\textwidth}\n\\includegraphics{b}\n\\caption{S2}\n\\label{fig:s2}\n\\end{subfigure}\n\\caption{C}\n\\label{fig:a}`,
        subfigureInCenter: `\\begin{center}\n\\begin{subfigure}{0.4\\textwidth}\n\\includegraphics{a}\n\\caption{S1}\n\\end{subfigure}\n\\caption{C}\n\\end{center}`,
        tikz: `\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}\n\\caption{C}\n\\label{fig:a}`,
        tabular: `\\begin{tabular}{cc}\na & b \\\\\n\\end{tabular}\n\\caption{C}`,
        commentAbove: `% \\caption{old}\n\\includegraphics{a}\n\\caption{C}`,
        commentTrailing: `\\includegraphics{a} % note\n\\caption{C}`,
        shortCaption: `\\includegraphics{a}\n\\caption[Short]{C}\n\\label{fig:a}`,
        emptyShort: `\\includegraphics{a}\n\\caption[]{C}`,
        labelFirst: `\\label{fig:a}\n\\includegraphics{a}\n\\caption{C}`,
        labelInCaption: `\\includegraphics{a}\n\\caption{C \\label{fig:a}}`,
        verbPercent: `\\verb|%| \\caption{C}\n\\label{fig:a}`,
        verbBracket: `\\verb[x[\n\\caption{C}\n\\label{fig:a}`,
        lstinlineOpts: `\\lstinline[keywordstyle=[2]\\color{red}]|x|\n\\caption{C}`,
        escapedPercent: `\\caption{50\\% done}\n\\label{fig:a}`,
        unbalancedBegin: `\\begin{subfigure}{0.4\\textwidth}\n\\includegraphics{a}\n\\caption{C}\n\\label{fig:a}`,
        unbalancedEnd: `\\end{subfigure}\n\\caption{C}\n\\label{fig:a}\n\\begin{subfigure}{0.4\\textwidth}`,
        wrapfigure: `\\begin{wrapfigure}{r}{0.3\\textwidth}\n\\includegraphics{a}\n\\caption{W}\n\\end{wrapfigure}\n\\caption{C}`,
        noCaption: `\\includegraphics{a}`,
        captionOnly: `\\caption{C}`,
      };

      const countOf = (s: string, re: RegExp) => (s.match(re) ?? []).length;

      it.each(Object.entries(CORPUS))(
        "%s: round-trips to a fixed point, losing no declaration and inventing no caption",
        (_name, body) => {
          const input = `\\begin{figure}\n${body}\n\\end{figure}\n`;
          const once = serializeBody(parseBody(input));
          const twice = serializeBody(parseBody(once));
          // A fixed point — no oscillation, no per-save accumulation.
          expect(twice).toBe(once);
          // Every `\label` the author wrote survives, by key — and EXACTLY
          // once. The count is the task-318 half: a label written inside the
          // caption used to reach the file twice, once from the caption's own
          // bytes and once from the attr, giving LaTeX a "multiply defined"
          // warning on the first save of a file Virgil merely opened.
          for (const m of body.matchAll(/\\label\{([^}]*)\}/g)) {
            expect(once).toContain(`\\label{${m[1]}}`);
            expect(
              countOf(once, new RegExp(`\\\\label\\{${m[1]}\\}`, "g")),
            ).toBe(1);
          }
          // Every caption BODY survives somewhere (at figure level or, for a
          // sub-float, byte-raw inside it).
          for (const m of body.matchAll(/\\caption(?:\[[^\]]*\])?\{([A-Za-z0-9 ]+)\}/g)) {
            expect(once).toContain(m[1]);
          }
          // NO caption is invented — not even the empty `\caption{}` the
          // always-present caption child used to emit for a caption-less
          // figure. In LaTeX that byte is not cosmetic: it consumes a figure
          // number and adds a blank List-of-Figures row, renumbering every
          // later `\ref` (task 319). This bound was `before + 1` while that
          // was tolerated; it is an equality now.
          const before = countOf(body, /\\caption[[{]/g);
          expect(countOf(once, /\\caption[[{]/g)).toBe(before);
        },
      );
    });

    // ── tasks 318 + 319 ───────────────────────────────────────────────────
    // Both are the same shape: the model recorded WHAT a figure's caption and
    // label say and not WHETHER / WHERE the source wrote them, so the emitter
    // had to guess from bytes. It now emits from declared facts — `hasCaption`
    // provenance, and the caption's own SCANNED bytes for the label. Every leg
    // below fails on the pre-fix tree.
    describe("caption/label provenance (tasks 318, 319)", () => {
      it("emits a caption-carried \\label exactly ONCE, inside the caption", () => {
        const input = `\\begin{figure}
  \\includegraphics{a}
  \\caption{Foo \\label{fig:x}}
\\end{figure}\n`;
        const json = parseBody(input);
        const figs = findByType(json, "figureBlock");
        // The attr still names the figure, so `\ref` resolves and the lozenge
        // shows the key — the caption is merely where the bytes live.
        expect(figs[0].attrs?.label).toBe("fig:x");
        expect(figs[0].attrs?.hasCaption).toBe(true);
        const once = serializeBody(json);
        expect(once).toContain("\\caption{Foo \\label{fig:x}}");
        expect(once.match(/\\label\{fig:x\}/g)).toHaveLength(1);
        expect(serializeBody(parseBody(once))).toBe(once);
      });

      // THE GUARD ON THE REVERTED FIX. Suppressing the figure-level emit by
      // testing whether the caption text CONTAINS `\label{fig:x}` passes here
      // and deletes the figure's real declaration — which is why task 245
      // reverted it. The question is answered by the same lexical scan the
      // extractor uses, so a label QUOTED in `\verb` declares nothing.
      it("keeps the real \\label when the caption merely QUOTES the same key", () => {
        const input = `\\begin{figure}
  \\includegraphics{a}
  \\caption{Write \\verb|\\label{fig:x}| here}
  \\label{fig:x}
\\end{figure}\n`;
        const json = parseBody(input);
        expect(findByType(json, "figureBlock")[0].attrs?.label).toBe("fig:x");
        const once = serializeBody(json);
        // The declaration survives at figure level — on its own line, i.e.
        // outside the caption braces that only quote it.
        expect(once).toMatch(/\n\s*\\label\{fig:x\}/);
        expect(once).toContain("\\verb|\\label{fig:x}|");
        expect(serializeBody(parseBody(once))).toBe(once);
      });

      // A stored `labelInCaption` flag would go stale the moment the lozenge
      // renames the label; deriving the answer from the live caption keeps the
      // declaration reachable — the caption's own bytes are now a DIFFERENT
      // key, so the figure-level `\label` is emitted again.
      it("re-emits the figure-level \\label when a rename leaves the caption behind", () => {
        const json = parseBody(
          `\\begin{figure}\n  \\includegraphics{a}\n  \\caption{Foo \\label{fig:x}}\n\\end{figure}\n`,
        );
        const fig = findByType(json, "figureBlock")[0];
        fig.attrs = { ...(fig.attrs || {}), label: "fig:renamed" };
        const once = serializeBody(json);
        expect(once).toMatch(/\n\s*\\label\{fig:renamed\}/);
        expect(once).toContain("\\caption{Foo \\label{fig:x}}");
      });

      it("round-trips a caption-less figure without inventing \\caption{}", () => {
        const input = `\\begin{figure}\n  \\includegraphics{a}\n\\end{figure}\n`;
        const json = parseBody(input);
        const figs = findByType(json, "figureBlock");
        expect(figs[0].attrs?.hasCaption).toBe(false);
        // LaTeX leaves a caption-less float unnumbered, so Virgil's own
        // `Figure N:` chrome must not claim a number the PDF won't print.
        expect(figs[0].attrs?.figureNumber).toBe(null);
        const once = serializeBody(json);
        expect(once).not.toContain("\\caption");
        expect(serializeBody(parseBody(once))).toBe(once);
      });

      it("does not let a caption-less figure consume a later figure's number", () => {
        const input = `\\begin{figure}
  \\includegraphics{a}
\\end{figure}

\\begin{figure}
  \\includegraphics{b}
  \\caption{First real one}
\\end{figure}\n`;
        const figs = findByType(parseBody(input), "figureBlock");
        expect(figs[0].attrs?.figureNumber).toBe(null);
        expect(figs[1].attrs?.figureNumber).toBe(1);
      });

      // The second-order requirement of choosing "emit only what the source
      // had": a figure that HAD a caption keeps `\caption{}` when the user
      // empties the text, so it cannot silently lose its LaTeX number (and
      // every `\ref` to it) through an ordinary editing keystroke.
      it("keeps \\caption{} when a real caption's text is cleared in the editor", () => {
        const once = serializeBody({
          type: "doc",
          content: [
            {
              type: "figureBlock",
              attrs: { extras: "\n  \\includegraphics{a}", label: "", hasCaption: true },
              content: [{ type: "figureCaption" }],
            },
          ],
        });
        expect(once).toContain("\\caption{}");
      });

      // …and the converse: text typed into a caption-less figure reaches the
      // file, so the user can caption one without visiting the popover.
      it("emits a caption once the user types one into a caption-less figure", () => {
        const doc: JSONContent = {
          type: "doc",
          content: [
            {
              type: "figureBlock",
              attrs: { extras: "\n  \\includegraphics{a}", label: "", hasCaption: false },
              content: [
                { type: "figureCaption", content: [{ type: "text", text: "Typed later" }] },
              ],
            },
          ],
        };
        expect(serializeBody(doc)).toContain("\\caption{Typed later}");
      });

      // The popover surface used to rebuild the env with a SECOND, hand-written
      // builder that never emitted the `[short]` bracket — so every rebuild
      // through it deleted task 263's byte. One builder, so it cannot drift.
      it("builds the popover's raw env body with the serializer's own bytes", () => {
        const input = `\\begin{figure}\n  \\includegraphics{a}\n  \\caption[Short]{Long}\n  \\label{fig:a}\n\\end{figure}\n`;
        const fig = findByType(parseBody(input), "figureBlock")[0];
        const captionChild = findByType(fig, "figureCaption")[0];
        const raw = buildFigureEnvBody({
          extras: fig.attrs?.extras as string,
          captionTex: (captionChild.content || [])
            .map((c) => c.text ?? "")
            .join(""),
          hasCaption: fig.attrs?.hasCaption !== false,
          shortCaption: (fig.attrs?.shortCaption as string | null) ?? null,
          label: (fig.attrs?.label as string) ?? "",
        });
        expect(raw).toContain("\\caption[Short]{Long}");
        // …and it IS the serializer's body, byte for byte.
        expect(serializeBody(parseBody(input))).toContain(raw);
      });
    });

    it("extractFigureAttrs is depth-aware at the popover re-extraction seam", () => {
      const attrs = extractFigureAttrs(
        `\n  \\begin{subfigure}{0.4\\textwidth}\n    \\caption{Sub}\n    \\label{fig:sub}\n  \\end{subfigure}\n  \\caption{Own}\n  \\label{fig:own}\n`,
      );
      expect(attrs.caption).toBe("Own");
      expect(attrs.label).toBe("fig:own");
      expect(attrs.extras).toContain("\\caption{Sub}");
      expect(attrs.extras).toContain("\\label{fig:sub}");
    });
  });

  it("numbers multiple figures sequentially", () => {
    const input = `\\begin{figure}
  \\includegraphics{a}
  \\caption{First}
\\end{figure}

Some text.

\\begin{figure}
  \\includegraphics{b}
  \\caption{Second}
\\end{figure}\n`;
    const json = parseBody(input);
    const figs = findByType(json, "figureBlock");
    expect(figs).toHaveLength(2);
    expect(figs[0].attrs?.figureNumber).toBe(1);
    expect(figs[1].attrs?.figureNumber).toBe(2);
  });
});

describe("graphicsBlock (bare \\includegraphics) round-trip", () => {
  it("parses a standalone block-level \\includegraphics", () => {
    const input = `Before.

\\includegraphics[width=0.5\\textwidth]{figures/standalone}

After.`;
    const json = parseBody(input);
    const blocks = findByType(json, "graphicsBlock");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs?.source).toBe("figures/standalone");
    expect(blocks[0].attrs?.widthPercent).toBe(50);
    expect(blocks[0].attrs?.command).toBe(
      "\\includegraphics[width=0.5\\textwidth]{figures/standalone}",
    );
  });

  it("parses \\includegraphics without options", () => {
    const input = `\\includegraphics{plain}\n`;
    const json = parseBody(input);
    const blocks = findByType(json, "graphicsBlock");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs?.source).toBe("plain");
    expect(blocks[0].attrs?.widthPercent).toBeNull();
  });

  it("round-trips the command verbatim", () => {
    const input = `\\includegraphics[width=0.5\\textwidth]{figures/foo}\n`;
    const json = parseBody(input);
    const out = serializeBody(json);
    expect(out).toContain("\\includegraphics[width=0.5\\textwidth]{figures/foo}");
  });
});

describe("setWidthInOptions", () => {
  it("replaces an existing \\textwidth width", () => {
    expect(setWidthInOptions("width=0.5\\textwidth", 70)).toEqual({
      options: "width=0.7\\textwidth",
      ok: true,
    });
  });

  it("inserts a width when none is set", () => {
    expect(setWidthInOptions("", 60)).toEqual({
      options: "width=0.6\\textwidth",
      ok: true,
    });
    expect(setWidthInOptions("clip", 60)).toEqual({
      options: "width=0.6\\textwidth,clip",
      ok: true,
    });
  });

  it("refuses to rewrite absolute-unit widths", () => {
    expect(setWidthInOptions("width=5cm", 60).ok).toBe(false);
    expect(setWidthInOptions("width=5cm", 60).options).toBe("width=5cm");
    expect(setWidthInOptions("width=120pt,clip", 60).ok).toBe(false);
    expect(setWidthInOptions("width=2.5in", 60).ok).toBe(false);
  });

  it("preserves \\linewidth and \\columnwidth units", () => {
    expect(setWidthInOptions("width=0.5\\linewidth", 70).options).toBe(
      "width=0.7\\linewidth",
    );
    expect(setWidthInOptions("width=0.5\\columnwidth", 70).options).toBe(
      "width=0.7\\columnwidth",
    );
  });

  it("preserves other options around the width directive", () => {
    expect(
      setWidthInOptions("width=0.5\\textwidth,angle=45,clip", 70).options,
    ).toBe("width=0.7\\textwidth,angle=45,clip");
    expect(
      setWidthInOptions("angle=45,width=0.5\\textwidth,clip", 70).options,
    ).toBe("angle=45,width=0.7\\textwidth,clip");
  });

  it("formats fractions with no trailing zeros", () => {
    expect(setWidthInOptions("width=0.5\\textwidth", 35).options).toBe(
      "width=0.35\\textwidth",
    );
    expect(setWidthInOptions("width=0.5\\textwidth", 100).options).toBe(
      "width=1.0\\textwidth",
    );
  });
});

describe("canEditWidthInOptions", () => {
  it("returns true for empty or relative-unit options", () => {
    expect(canEditWidthInOptions("")).toBe(true);
    expect(canEditWidthInOptions("clip")).toBe(true);
    expect(canEditWidthInOptions("width=0.5\\textwidth")).toBe(true);
  });

  it("returns false for absolute-unit widths", () => {
    expect(canEditWidthInOptions("width=5cm")).toBe(false);
    expect(canEditWidthInOptions("width=120pt,clip")).toBe(false);
  });
});

describe("withUpdatedFigureWidth", () => {
  it("rewrites the width inside a graphicsBlock command", () => {
    expect(
      withUpdatedFigureWidth(
        "\\includegraphics[width=0.5\\textwidth]{figures/foo}",
        80,
      ),
    ).toBe("\\includegraphics[width=0.8\\textwidth]{figures/foo}");
  });

  it("rewrites the first \\includegraphics inside a figureBlock body", () => {
    const raw =
      "\n  \\centering\n  \\includegraphics[width=0.6\\textwidth]{figures/sample}\n  \\caption{x}\n";
    const out = withUpdatedFigureWidth(raw, 90);
    expect(out).toBe(
      "\n  \\centering\n  \\includegraphics[width=0.9\\textwidth]{figures/sample}\n  \\caption{x}\n",
    );
  });

  it("preserves the starred form", () => {
    expect(
      withUpdatedFigureWidth(
        "\\includegraphics*[width=0.5\\textwidth]{foo}",
        70,
      ),
    ).toBe("\\includegraphics*[width=0.7\\textwidth]{foo}");
  });

  it("preserves untouched options", () => {
    expect(
      withUpdatedFigureWidth(
        "\\includegraphics[width=0.5\\textwidth,angle=45,clip]{foo}",
        70,
      ),
    ).toBe("\\includegraphics[width=0.7\\textwidth,angle=45,clip]{foo}");
  });

  it("returns null for absolute-unit widths", () => {
    expect(
      withUpdatedFigureWidth("\\includegraphics[width=5cm]{foo}", 70),
    ).toBeNull();
  });

  it("returns null when no \\includegraphics is present", () => {
    expect(withUpdatedFigureWidth("\\caption{just a caption}", 70)).toBeNull();
  });

  it("inserts a width when the command has no options", () => {
    expect(withUpdatedFigureWidth("\\includegraphics{foo}", 60)).toBe(
      "\\includegraphics[width=0.6\\textwidth]{foo}",
    );
  });
});

describe("withReplacedFigurePath", () => {
  it("swaps the path argument and preserves the options", () => {
    expect(
      withReplacedFigurePath(
        "\\includegraphics[width=0.5\\textwidth,angle=45]{old}",
        "figures/new",
      ),
    ).toBe("\\includegraphics[width=0.5\\textwidth,angle=45]{figures/new}");
  });

  it("works on an empty-path stub", () => {
    expect(
      withReplacedFigurePath(
        "\\includegraphics[width=0.5\\textwidth]{}",
        "figures/foo.png",
      ),
    ).toBe("\\includegraphics[width=0.5\\textwidth]{figures/foo.png}");
  });

  it("targets only the first \\includegraphics in a figureBlock raw body", () => {
    const raw =
      "\n  \\includegraphics[width=0.3\\textwidth]{first}\n  \\includegraphics[width=0.3\\textwidth]{second}\n";
    const out = withReplacedFigurePath(raw, "swapped");
    expect(out).toBe(
      "\n  \\includegraphics[width=0.3\\textwidth]{swapped}\n  \\includegraphics[width=0.3\\textwidth]{second}\n",
    );
  });

  it("returns null when no \\includegraphics is present", () => {
    expect(withReplacedFigurePath("\\caption{none}", "x")).toBeNull();
  });
});
