// Task 350 defect D — the preservation gate: the net under every NON-USER-EDIT
// write of a `.tex`.
//
// `readDocBundle` re-serializes the parsed model and writes it back on OPEN,
// unconditionally, in both backends. Defects A and B made the reported parse
// impossible; this makes the CLASS non-destructive, including members nobody
// has found yet — a parser bug on that path becomes a LOUD REFUSAL with the
// file byte-identical, instead of silent loss.
//
// The suite's shape is set by the two things measurement (not reasoning) found:
//
//   1. A whole-document word count is DEFEATED BY VIRGIL'S OWN OUTPUT. The
//      first save injects the seven-line `\providecommand{\vfid}[1]{}` shim
//      plus any declared `\usepackage`; against a body that had just lost a
//      `\section` and a whole `\begin{quote}`, the sum came out POSITIVE and
//      the gate passed a real destruction. Hence the region split, and hence
//      the masking leg below — it is the one that would catch a "simplifying"
//      revert to a single count.
//   2. The real corpus moves by ZERO. The reference paper's body is 2611 → 2612
//      words on the first save (a gain) and exactly stable on the second, so
//      the slack absorbs no known behaviour.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import { serializeToLatex, assignUuids } from "@/lib/latex-serializer";
import {
  checkTexPreservation,
  measureContentWords,
  PRESERVATION_SLACK_WORDS,
} from "@/lib/tex-preservation";

const REPO = join(__dirname, "../../..");

/** ONE save cycle, mirroring what the load-writeback does in both backends. */
function save(tex: string): string {
  const content = parseLatex(tex);
  assignUuids(content);
  return serializeToLatex(content, extractPreambleAndPostamble(tex) ?? undefined);
}

function doc(body: string, packages = "\\usepackage{expex}"): string {
  return `\\documentclass{article}\n${packages}\n\n\\begin{document}\n\n${body}\n\n\\end{document}\n`;
}

describe("the gate passes an honest save", () => {
  it("the shipped reference paper, over two cycles", () => {
    // The corpus check. If this ever fails, the gate has started refusing real
    // documents — which is the failure direction a net must not have, and a
    // reason to widen the slack only after finding out WHAT moved.
    const src = readFileSync(
      join(REPO, "samples/annotation-history/document.tex"),
      "utf8",
    );
    const c1 = save(src);
    const c2 = save(c1);
    const v1 = checkTexPreservation(src, c1);
    const v2 = checkTexPreservation(c1, c2);
    expect(v1.ok, JSON.stringify(v1)).toBe(true);
    expect(v2.ok, JSON.stringify(v2)).toBe(true);
    // Measured, and pinned so a future regression reads as a CHANGE rather than
    // as noise inside the slack: an honest save loses nothing at all.
    expect(v1.body.lost).toBe(0);
    expect(v2.body.lost).toBe(0);
    expect(v2.preamble.lost).toBe(0);
  });

  it("growth and byte-identity both pass", () => {
    const tex = doc("Some prose.");
    expect(checkTexPreservation(tex, tex).ok).toBe(true);
    expect(checkTexPreservation(tex, doc("Some prose. And more.")).ok).toBe(true);
  });
});

describe("the gate refuses a real loss", () => {
  it("catches a body the example-body whitelist truncates", () => {
    // A LIVE reproducer, not a synthetic one: defect C is still open, so
    // `parseExampleBodyAsBlocks` drops a heading and a blockquote inside an
    // `\ex` body. Measured through the REAL save pipeline.
    const src = doc(
      [
        "\\ex",
        "Body paragraph one.",
        "",
        "\\section{A heading inside the example body}",
        "",
        "\\begin{quote}",
        "A blockquote the whitelist drops.",
        "\\end{quote}",
        "",
        "Body paragraph two.",
        "\\xe",
        "",
        "Tail prose.",
      ].join("\n"),
    );
    const out = save(src);
    // The loss is real — assert it independently of the gate, so this leg
    // still means something if the gate's own arithmetic changes.
    expect(out).not.toContain("A heading inside the example body");
    const v = checkTexPreservation(src, out);
    expect(v.ok, JSON.stringify(v)).toBe(false);
    expect(v.body.ok).toBe(false);
  });

  it("a growing PREAMBLE cannot mask a shrinking body", () => {
    // The leg with teeth, and the one that fails on this fix's own first cut:
    // with a single whole-document count the shim injection (+23 words in the
    // measured case) outweighed the body's loss and the gate passed.
    const before = `\\documentclass{article}\n\n\\begin{document}\n\nAlpha beta gamma delta epsilon zeta eta theta iota kappa.\n\n\\end{document}\n`;
    const after = `\\documentclass{article}\n\\usepackage{expex}\n\\providecommand{\\vfid}[1]{}\n\\providecommand{\\vcid}[1]{}\n\\providecommand{\\vbid}[1]{}\n\\providecommand{\\vexid}[1]{}\n\\providecommand{\\vxid}[1]{}\n\\providecommand{\\vlid}[1]{}\n\\providecommand{\\vlidend}[1]{}\n\n\\begin{document}\n\nAlpha.\n\n\\end{document}\n`;
    const v = checkTexPreservation(before, after);
    expect(v.preamble.after).toBeGreaterThan(v.preamble.before); // really grew
    expect(measureContentWords(after)).toBeGreaterThan(
      measureContentWords(before),
    ); // …and the WHOLE document grew, which is the trap
    expect(v.ok).toBe(false); // …and the gate refuses anyway
    expect(v.body.ok).toBe(false);
  });

  it("a preamble the pass would gut is refused too", () => {
    const before = doc("Prose.", "\\usepackage{amsmath}\n\\usepackage{graphicx}\n\\newcommand{\\foo}{bar}\n\\definecolor{myblue}{rgb}{0.2,0.4,0.8}");
    const after = doc("Prose.", "");
    expect(checkTexPreservation(before, after).ok).toBe(false);
  });
});

describe("what the measure counts", () => {
  it("ignores Virgil's own markers on both sides", () => {
    // They are ADDED by the very pass being gated, so counting them would make
    // every first save look like a gain — and a gain is what masks a loss.
    const bare = "Alpha beta gamma.";
    const marked = "\\vexid{a1b2}Alpha beta gamma. %!v:c3d4";
    expect(measureContentWords(marked)).toBe(measureContentWords(bare));
  });

  it("counts a user comment as content", () => {
    // Since task 347 a `%` comment round-trips, so a pass that dropped every
    // comment is a loss like any other.
    expect(measureContentWords("Alpha. % a real note")).toBeGreaterThan(
      measureContentWords("Alpha."),
    );
  });

  it("is stable across the serializer's punctuation normalizations", () => {
    // Why the measure is WORDS and not characters: each of these moves bytes
    // and loses nothing, and a character-mass gate would need a tolerance wide
    // enough to hide real loss on a large document.
    expect(measureContentWords("\\(x^2\\)")).toBe(measureContentWords("$x^2$"));
    expect(measureContentWords("$$E=mc^2$$")).toBe(
      measureContentWords("$E=mc^2$"),
    );
  });

  it("a source with no \\begin{document} is weighed as all body", () => {
    // The fail-safe direction: every word falls under a comparison rather than
    // into an unweighed region.
    const v = checkTexPreservation(
      "Alpha beta gamma delta epsilon zeta eta theta.",
      "Alpha.",
    );
    expect(v.ok).toBe(false);
    expect(v.body.ok).toBe(false);
  });

  it("the small-document floor is the stated absolute, not a ratio", () => {
    // A ratio alone would make a short document hypersensitive to a single
    // normalized token; the floor is what keeps the gate from wedging one.
    const v = checkTexPreservation(doc("one two three"), doc("one two three"));
    expect(v.body.allowed).toBe(PRESERVATION_SLACK_WORDS);
  });
});
