// ---------------------------------------------------------------------------
// Task 379 — a figure carries EVERY figure-depth `\label`, and the one the
// model treats as the figure's own is the one LaTeX would resolve `\ref` to.
//
// Why this suite exists rather than a fixture in `figure-roundtrip.test.ts`:
// that suite's corpus invariant already asserts "every `\label` survives
// EXACTLY once", and it was GREEN on the pre-379 tree — because **no fixture
// anywhere in the repo carried two figure-depth labels**, so the invariant was
// vacuous for the one shape that breaks it. The same blindness covered two
// other members found by measurement rather than by the report:
//
//   • a caption-carried `\label` plus a body-level one round-tripped fine on
//     cycle 1 and DELETED the body-level key on cycle 2 (not a fixed point);
//   • two figure-depth `\caption`s swapped places on EVERY save, forever, on a
//     document nobody was editing.
//
// So every leg here runs TWO cycles (cycle 1 is where a loss lands, cycle 2 is
// where an oscillation shows) and asserts the BYTES, the SURVIVOR, and the
// FIXED POINT together — with single-label fixtures as passing CONTROLS so no
// leg can pass by making everything disappear.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import {
  extractFigureAttrs,
  figureNodeAttrsFromSource,
  withFigureGraphicsEdit,
  withUpdatedFigureWidth,
} from "@/lib/figures/parse-attrs";
import { serializeFigureEnvBody } from "@/lib/latex-serializer";

function parseBody(input: string): JSONContent {
  return parseLatex(
    `\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`,
  );
}

function findByType(
  node: JSONContent,
  type: string,
  out: JSONContent[] = [],
): JSONContent[] {
  if (node.type === type) out.push(node);
  if (node.content) for (const c of node.content) findByType(c, type, out);
  return out;
}

/** One env body → the bytes after two full save cycles. */
function cycles(body: string): { once: string; twice: string } {
  const input = `\\begin{figure}\n${body}\n\\end{figure}\n`;
  const once = serializeBodyOnly(parseBody(input));
  const twice = serializeBodyOnly(parseBody(once));
  return { once, twice };
}

const countOf = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("figure multi-label / multi-caption round trip (task 379)", () => {
  // ── the reported defect ────────────────────────────────────────────────
  it("keeps BOTH labels when one sits either side of the caption", () => {
    const body = `\\includegraphics{a}\\label{fig:one}\n\\caption{c}\\label{fig:two}`;
    const { once, twice } = cycles(body);
    expect(once).toContain("\\label{fig:one}");
    expect(once).toContain("\\label{fig:two}");
    expect(countOf(once, /\\label\{fig:one\}/g)).toBe(1);
    expect(countOf(once, /\\label\{fig:two\}/g)).toBe(1);
    expect(twice).toBe(once);
  });

  it("treats the POST-caption label as the figure's own", () => {
    // `\caption` calls `\refstepcounter{figure}`, so `fig:two` is the key that
    // names the figure and `fig:one` names whatever was stepped before it.
    // Pre-379 the model kept `fig:one` — silently promoting a key that named
    // nothing and turning every `\ref{fig:two}` into `??`.
    const attrs = extractFigureAttrs(
      `\n\\includegraphics{a}\\label{fig:one}\n\\caption{c}\\label{fig:two}\n`,
    );
    expect(attrs.label).toBe("fig:two");

    const figs = findByType(
      parseBody(
        `\\begin{figure}\n\\includegraphics{a}\\label{fig:one}\n\\caption{c}\\label{fig:two}\n\\end{figure}\n`,
      ),
      "figureBlock",
    );
    expect(figs[0].attrs?.label).toBe("fig:two");
  });

  it("a label INSIDE the caption binds, and a body-level one still survives", () => {
    // Both genuinely bind here (the in-caption one is after the counter step),
    // so this is pure reference loss with no survivor ambiguity. Pre-379 it
    // looked correct on cycle 1 and DELETED `fig:out` on cycle 2 — the shape a
    // one-cycle test cannot see.
    const body = `\\includegraphics{a}\\label{fig:out}\n\\caption{c \\label{fig:in}}`;
    const { once, twice } = cycles(body);
    expect(countOf(once, /\\label\{fig:out\}/g)).toBe(1);
    expect(countOf(once, /\\label\{fig:in\}/g)).toBe(1);
    expect(twice).toBe(once);
    expect(countOf(twice, /\\label\{fig:out\}/g)).toBe(1);

    const attrs = extractFigureAttrs(`\n${body}\n`);
    expect(attrs.label).toBe("fig:in");
  });

  it("keeps both labels when the figure has no caption at all", () => {
    // No `\caption` ⇒ nothing has stepped the figure counter, so no label
    // genuinely binds; the model needs a key regardless and takes the first,
    // which is the pre-379 answer and the only stable one.
    const { once, twice } = cycles(`\\label{a}\\label{b}`);
    expect(countOf(once, /\\label\{a\}/g)).toBe(1);
    expect(countOf(once, /\\label\{b\}/g)).toBe(1);
    expect(twice).toBe(once);
    expect(extractFigureAttrs(`\n\\label{a}\\label{b}\n`).label).toBe("a");
  });

  it("keeps both labels when both follow the caption", () => {
    const { once, twice } = cycles(`\\caption{c}\n\\label{a}\n\\label{b}`);
    expect(countOf(once, /\\label\{a\}/g)).toBe(1);
    expect(countOf(once, /\\label\{b\}/g)).toBe(1);
    expect(twice).toBe(once);
    expect(extractFigureAttrs(`\n\\caption{c}\n\\label{a}\n\\label{b}\n`).label).toBe("a");
  });

  // ── the oscillation the split closes for free ──────────────────────────
  it("a second figure-depth \\caption stops swapping places on every save", () => {
    // Two `\caption`s in one float is not legal LaTeX, but a leftover old
    // caption is ordinary drafting. Pre-379 the model kept the first and
    // re-emitted the second from `extras` — i.e. AHEAD of the one it kept — so
    // the two traded places on every save of an unedited document.
    const { once, twice } = cycles(`\\includegraphics{a}\n\\caption{A}\n\\caption{B}`);
    expect(countOf(once, /\\caption[[{]/g)).toBe(2);
    expect(once.indexOf("\\caption{A}")).toBeLessThan(once.indexOf("\\caption{B}"));
    expect(twice).toBe(once);
  });

  // ── the non-regressions ────────────────────────────────────────────────
  it("leaves nested subfigure labels untouched", () => {
    const body =
      `\\begin{subfigure}{0.45\\textwidth}\n\\includegraphics{a}\n\\caption{S1}\n\\label{fig:s1}\n\\end{subfigure}\n` +
      `\\begin{subfigure}{0.45\\textwidth}\n\\includegraphics{b}\n\\caption{S2}\n\\label{fig:s2}\n\\end{subfigure}\n` +
      `\\caption{C}\n\\label{fig:a}`;
    const { once, twice } = cycles(body);
    for (const key of ["fig:s1", "fig:s2", "fig:a"]) {
      expect(countOf(once, new RegExp(`\\\\label\\{${key}\\}`, "g")), key).toBe(1);
    }
    // The sub-labels stay INSIDE their own subfigure envs — the whole reason
    // the scan is depth-aware.
    const firstSubEnd = once.indexOf("\\end{subfigure}");
    expect(once.indexOf("\\label{fig:s1}")).toBeLessThan(firstSubEnd);
    expect(twice).toBe(once);
    expect(extractFigureAttrs(`\n${body}\n`).label).toBe("fig:a");
  });

  it.each([
    ["caption then label", `\\includegraphics{a}\n\\caption{C}\n\\label{fig:a}`],
    ["label first", `\\label{fig:a}\n\\includegraphics{a}\n\\caption{C}`],
    ["label in caption", `\\includegraphics{a}\n\\caption{C \\label{fig:a}}`],
    ["no label", `\\includegraphics{a}\n\\caption{C}`],
  ])("control — a single-label figure is unchanged (%s)", (_name, body) => {
    const { once, twice } = cycles(body);
    expect(twice).toBe(once);
    // POSITION, not just presence (task 1262): the label stays on the side of
    // the caption it was written on — which is what `\ref` to it prints.
    const label = once.indexOf("\\label{fig:a}");
    const caption = once.indexOf("\\caption{");
    const bodyLabel = body.indexOf("\\label{fig:a}");
    const bodyCaption = body.indexOf("\\caption{");
    if (bodyLabel !== -1) expect(label < caption).toBe(bodyLabel < bodyCaption);
    if (body.includes("\\label")) {
      expect(countOf(once, /\\label\{fig:a\}/g)).toBe(1);
      expect(extractFigureAttrs(`\n${body}\n`).label).toBe("fig:a");
    }
    expect(countOf(once, /\\caption[[{]/g)).toBe(1);
  });

  // ── the split itself ───────────────────────────────────────────────────
  it("splits the body at the caption, so nothing crosses it", () => {
    const attrs = extractFigureAttrs(
      `\n\\includegraphics{a}\\label{fig:one}\n\\caption{c}\\label{fig:two}\n% trailing note\n`,
    );
    // What preceded the caption stays before it…
    expect(attrs.extras).toContain("\\includegraphics{a}");
    expect(attrs.extras).toContain("\\label{fig:one}");
    expect(attrs.extras).not.toContain("trailing note");
    // …and what followed it stays after.
    expect(attrs.trailingExtras).toContain("trailing note");
    expect(attrs.trailingExtras).not.toContain("\\label{fig:one}");
    // Neither half re-emits the two commands the model holds.
    expect(attrs.extras).not.toContain("\\caption");
    expect(attrs.trailingExtras).not.toContain("\\caption");
    expect(attrs.trailingExtras).not.toContain("\\label{fig:two}");
  });

  it("a figure with nothing after its caption carries an EMPTY trailing half", () => {
    // The common case: the split must not invent bytes, or every figure in the
    // repo would gain a blank line per save.
    const attrs = extractFigureAttrs(
      `\n\\includegraphics{a}\n\\caption{C}\n\\label{fig:a}\n`,
    );
    expect(attrs.trailingExtras.trim()).toBe("");
  });

  // ── task 1262: a SOLE label written before the caption ────────────────
  describe("a sole label before the caption keeps its side (task 1262)", () => {
    const body = `  \\includegraphics{a}\n  \\label{fig:x}\n  \\caption{Cap}`;
    const env = `\\begin{figure}\n${body}\n\\end{figure}\n`;

    const figureOf = (src: string) => findByType(parseBody(src), "figureBlock")[0];
    const before = (s: string, key = "fig:x") =>
      s.indexOf(`\\label{${key}}`) < s.indexOf("\\caption{");

    it("round-trips byte-for-byte, label still before the caption", () => {
      const { once, twice } = cycles(body);
      expect(once).toContain(body);
      expect(before(once)).toBe(true);
      expect(countOf(once, /\\label\{fig:x\}/g)).toBe(1);
      expect(twice).toBe(once);
    });

    it("still gives the model its key (lozenge / rename / \\ref display)", () => {
      const attrs = extractFigureAttrs(`\n${body}\n`);
      expect(attrs.label).toBe("fig:x");
      expect(attrs.labelBeforeCaption).toBe(true);
      expect(figureOf(env).attrs?.labelBeforeCaption).toBe(true);
    });

    it("a rename through the attr rewrites THAT declaration, in place", () => {
      const fig = figureOf(env);
      const renamed = { ...fig, attrs: { ...fig.attrs, label: "fig:y" } };
      const out = serializeFigureEnvBody(renamed);
      expect(out).not.toContain("fig:x");
      expect(countOf(out, /\\label\{fig:y\}/g)).toBe(1);
      expect(before(out, "fig:y")).toBe(true);
    });

    it("clearing the label removes the declaration rather than keeping a stale one", () => {
      const fig = figureOf(env);
      const out = serializeFigureEnvBody({ ...fig, attrs: { ...fig.attrs, label: "" } });
      expect(out).not.toContain("\\label");
      expect(out).toContain("\\caption{Cap}");
    });

    it("a popover save (synthesize → re-extract → emit) keeps the side", () => {
      const fig = figureOf(env);
      const synthesized = serializeFigureEnvBody(fig);
      const reparsed = figureNodeAttrsFromSource(extractFigureAttrs(synthesized));
      const out = serializeFigureEnvBody({ ...fig, attrs: { ...fig.attrs, ...reparsed } });
      expect(out.trim()).toBe(synthesized.trim());
      expect(before(out)).toBe(true);
    });

    it("a width-stepper edit keeps the label before the caption", () => {
      const fig = figureOf(env);
      const next = withFigureGraphicsEdit(
        {
          extras: fig.attrs?.extras as string,
          trailingExtras: fig.attrs?.trailingExtras as string,
        },
        (t) => withUpdatedFigureWidth(t, 50),
      );
      expect(next).not.toBeNull();
      const out = serializeFigureEnvBody({ ...fig, attrs: { ...fig.attrs, ...next } });
      expect(out).toContain("width=");
      expect(before(out)).toBe(true);
      expect(countOf(out, /\\label\{fig:x\}/g)).toBe(1);
    });

    it("a label AFTER the caption still binds and is still emitted after it", () => {
      const attrs = extractFigureAttrs(`\n\\label{fig:pre}\n\\caption{C}\\label{fig:post}\n`);
      expect(attrs.label).toBe("fig:post");
      expect(attrs.labelBeforeCaption).toBe(false);
    });
  });
});
