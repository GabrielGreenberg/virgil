// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import {
  buildPreamble,
  detectBodyRequirements,
  ensurePreambleRequirements,
  stripAutoInjectedLines,
  SHIM_COMMAND_NAMES,
  VIRGIL_BASELINE_PACKAGES,
} from "@/lib/latex-requirements";
import { CLASSIC_PREAMBLE } from "@/lib/document-styles";
import {
  getStyleLibrarySync,
  STYLE_LIBRARY_KEY,
  STYLE_LIBRARY_VERSION,
} from "@/lib/style-library";
import { serializeToLatex } from "@/lib/latex-serializer";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";

// The v1 seed preamble — pre-baseline generation, missing graphicx / natbib /
// expex and four of the seven shims. Byte-identical to the frozen legacy
// literal in style-library.ts.
const LEGACY_CLASSIC_V1 = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{xcolor}

% Virgil entity-id markers — no-op commands that carry stable UUIDs for
% inline entities (footnotes, citations, examples) across .tex parse
% cycles. Without these, every re-parse regenerates the ids and any UI
% state keyed by them (e.g. popped-out cards) becomes stale.
\\providecommand{\\vfid}[1]{}
\\providecommand{\\vcid}[1]{}
\\providecommand{\\vexid}[1]{}

\\begin{document}

`;

// The v0 seed preamble — the PRE-XCOLOR generation (2026-05-07 → 2026-05-16,
// a293e604..8471ef99): V1 minus the `\usepackage{xcolor}` line. Libraries
// seeded in that window stored these bytes; the one-shot v2 bump must
// upgrade them too.
const LEGACY_CLASSIC_V0 = LEGACY_CLASSIC_V1.replace(
  "\\usepackage{xcolor}\n",
  "",
);

const NONE = new Set<string>();

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("detectBodyRequirements — detection matrix", () => {
  it("detects expex constructs", () => {
    expect(detectBodyRequirements("\\ex\nHello.\n\\xe")).toContain("expex");
    expect(detectBodyRequirements("\\pex\n\\a One.\n\\xe")).toContain("expex");
    expect(detectBodyRequirements("\\begingl\n\\gla a //\n\\endgl")).toContain(
      "expex",
    );
    expect(detectBodyRequirements("See \\getref{ex:1}.")).toContain("expex");
    expect(detectBodyRequirements("See \\getfullref{ex:1.a}.")).toContain(
      "expex",
    );
    expect(detectBodyRequirements("\\begin{xlist}\n\\a x\n\\end{xlist}")).toContain(
      "expex",
    );
  });

  it("does not false-positive on longer command names sharing a prefix", () => {
    expect(detectBodyRequirements("\\example{foo} and \\pexample")).not.toContain(
      "expex",
    );
    expect(detectBodyRequirements("\\exp(x)")).not.toContain("expex");
  });

  it("detects graphicx / tikz / xcolor", () => {
    expect(
      detectBodyRequirements("\\includegraphics[width=2cm]{fig.png}"),
    ).toContain("graphicx");
    expect(
      detectBodyRequirements("\\begin{tikzpicture}\\end{tikzpicture}"),
    ).toContain("tikz");
    expect(
      detectBodyRequirements("\\textcolor[HTML]{FF0000}{red}"),
    ).toContain("xcolor");
  });

  it("classifies cite commands by family", () => {
    expect(detectBodyRequirements("\\citep{k}")).toContain("natbib");
    expect(detectBodyRequirements("\\Citet{k}")).toContain("natbib");
    expect(detectBodyRequirements("\\citeyearpar{k}")).toContain("natbib");
    expect(detectBodyRequirements("\\parencite{k}")).toContain("biblatex");
    expect(detectBodyRequirements("\\textcites{a}{b}")).toContain("biblatex");
    expect(detectBodyRequirements("\\footfullcite{k}")).toContain("biblatex");
  });

  it("treats bare \\cite / \\nocite as kernel-neutral", () => {
    const req = detectBodyRequirements("\\cite{k} and \\nocite{*}");
    expect(req.has("natbib")).toBe(false);
    expect(req.has("biblatex")).toBe(false);
  });

  it("prefers natbib when both families appear in one body", () => {
    const req = detectBodyRequirements("\\citep{a} but also \\parencite{b}");
    expect(req.has("natbib")).toBe(true);
    expect(req.has("biblatex")).toBe(false);
  });

  it("returns an empty set for plain prose", () => {
    expect(detectBodyRequirements("Just some plain text.").size).toBe(0);
  });

  // Three-bucket cite classification: SHARED commands (\citeauthor/\citeyear
  // — defined by BOTH packages) never pin biblatex-vs-natbib on their own.
  it("SHARED commands + a biblatex-only command → biblatex (shared cmds don't pin natbib)", () => {
    const req = detectBodyRequirements("\\parencite{k} and \\citeauthor{k}");
    expect(req.has("biblatex")).toBe(true);
    expect(req.has("natbib")).toBe(false);
  });

  it("SHARED commands + a natbib-only command → natbib", () => {
    const req = detectBodyRequirements("\\citep{k} and \\citeyear{k}");
    expect(req.has("natbib")).toBe(true);
    expect(req.has("biblatex")).toBe(false);
  });

  it("ONLY shared non-kernel commands (\\citeauthor/\\citeyear) → natbib (baseline default)", () => {
    for (const body of ["\\citeauthor{k}", "\\citeyear{k}", "\\Citeauthor{k}"]) {
      const req = detectBodyRequirements(body);
      expect(req.has("natbib")).toBe(true);
      expect(req.has("biblatex")).toBe(false);
    }
  });

  it("\\citeyearpar (natbib-only) is not shadowed by the shared \\citeyear", () => {
    const req = detectBodyRequirements("\\citeyearpar{k}");
    expect(req.has("natbib")).toBe(true);
  });
});

describe("detectBodyRequirements — inert LaTeX (comments + verbatim)", () => {
  it("ignores commands inside %-comments", () => {
    const req = detectBodyRequirements(
      "Live prose.\n% TODO maybe \\autocite{smith} here\n% \\ex commented example",
    );
    expect(req.has("biblatex")).toBe(false);
    expect(req.has("expex")).toBe(false);
  });

  it("ignores a comment tail after live text on the same line", () => {
    const req = detectBodyRequirements(
      "Real text. % reminder: switch to \\parencite{x}\n",
    );
    expect(req.has("biblatex")).toBe(false);
  });

  it("an escaped \\% does NOT start a comment — commands after it stay live", () => {
    const req = detectBodyRequirements(
      "Growth was 40\\% \\autocite{smith2020}.",
    );
    expect(req.has("biblatex")).toBe(true);
  });

  it("ignores commands inside verbatim environments", () => {
    const req = detectBodyRequirements(
      "\\begin{verbatim}\n\\ex An example line\n\\includegraphics{x}\n\\end{verbatim}\nProse after.",
    );
    expect(req.has("expex")).toBe(false);
    expect(req.has("graphicx")).toBe(false);
  });

  it("resumes detection after \\end{verbatim} (and inside verbatim* too)", () => {
    const req = detectBodyRequirements(
      "\\begin{verbatim*}\n\\ex inert\n\\end{verbatim*}\n\\parencite{live}",
    );
    expect(req.has("expex")).toBe(false);
    expect(req.has("biblatex")).toBe(true);
  });

  it("an unterminated \\begin{verbatim} swallows to the end of the body", () => {
    const req = detectBodyRequirements(
      "Prose.\n\\begin{verbatim}\n\\ex still inert\n\\autocite{x}",
    );
    expect(req.size).toBe(0);
  });

  it("a commented-out \\begin{verbatim} does NOT hide the live code after it", () => {
    const req = detectBodyRequirements(
      "% \\begin{verbatim}\n\\includegraphics{fig.png}\n",
    );
    expect(req.has("graphicx")).toBe(true);
  });
});

describe("ensurePreambleRequirements — injection", () => {
  it("always ensures xcolor + all 7 shims (legacy ensureVirgilCommands behavior)", () => {
    const out = ensurePreambleRequirements(LEGACY_CLASSIC_V1, NONE);
    for (const shim of SHIM_COMMAND_NAMES) {
      expect(out).toContain(`\\providecommand{\\${shim}}[1]{}`);
    }
    // xcolor already present — not duplicated.
    expect(countOccurrences(out, "{xcolor}")).toBe(1);
    // Injection lands before \begin{document}.
    expect(out.indexOf("\\providecommand{\\vlidend}[1]{}")).toBeLessThan(
      out.indexOf("\\begin{document}"),
    );
  });

  it("injects body-required packages before shims", () => {
    const out = ensurePreambleRequirements(
      LEGACY_CLASSIC_V1,
      new Set(["expex", "graphicx"]),
    );
    expect(out).toContain("\\usepackage{expex}");
    expect(out).toContain("\\usepackage{graphicx}");
    expect(out.indexOf("\\usepackage{expex}")).toBeLessThan(
      out.indexOf("\\providecommand{\\vbid}[1]{}"),
    );
  });

  it("is idempotent", () => {
    const req = new Set(["expex", "graphicx", "natbib", "tikz"]);
    const once = ensurePreambleRequirements(LEGACY_CLASSIC_V1, req);
    const twice = ensurePreambleRequirements(once, req);
    expect(twice).toBe(once);
  });

  it("accepts \\usepackage with options as satisfying", () => {
    const preamble = `\\documentclass{article}
\\usepackage[dvipsnames]{xcolor}
\\usepackage[draft]{graphicx}

\\begin{document}

`;
    const out = ensurePreambleRequirements(preamble, new Set(["graphicx"]));
    expect(countOccurrences(out, "{xcolor}")).toBe(1);
    expect(countOccurrences(out, "{graphicx}")).toBe(1);
  });

  it("bails unchanged when \\begin{document} is absent", () => {
    const fragment = "\\documentclass{article}\n\\usepackage{amsmath}\n";
    expect(ensurePreambleRequirements(fragment, new Set(["expex"]))).toBe(
      fragment,
    );
  });

  it("is a no-op on a fully satisfied preamble", () => {
    const out = ensurePreambleRequirements(
      CLASSIC_PREAMBLE,
      new Set(["expex", "graphicx", "natbib", "xcolor"]),
    );
    expect(out).toBe(CLASSIC_PREAMBLE);
  });

  it("recognizes a package inside a comma-separated \\usepackage list (no duplicate injection)", () => {
    const preamble = `\\documentclass{article}
\\usepackage[dvipsnames]{graphicx, xcolor ,amsmath}

\\begin{document}

`;
    const out = ensurePreambleRequirements(
      preamble,
      new Set(["xcolor", "graphicx"]),
    );
    expect(out).not.toContain("\\usepackage{xcolor}");
    expect(out).not.toContain("\\usepackage{graphicx}");
    expect(countOccurrences(out, "xcolor")).toBe(1);
    expect(countOccurrences(out, "graphicx")).toBe(1);
  });

  it("natbib in a comma-list → no second natbib injected", () => {
    const preamble = `\\documentclass{article}
\\usepackage{natbib,graphicx}

\\begin{document}

`;
    const out = ensurePreambleRequirements(preamble, new Set(["natbib"]));
    expect(countOccurrences(out, "natbib")).toBe(1);
    // …and the comma-list load also drives the exclusivity gate: a body
    // that reads as biblatex must not co-load it next to natbib.
    const out2 = ensurePreambleRequirements(preamble, new Set(["biblatex"]));
    expect(out2).not.toContain("biblatex");
  });

  it("\\RequirePackage loads satisfy the requirement", () => {
    const preamble = `\\documentclass{article}
\\RequirePackage{natbib}

\\begin{document}

`;
    const out = ensurePreambleRequirements(preamble, new Set(["natbib"]));
    expect(out).not.toContain("\\usepackage{natbib}");
    expect(countOccurrences(out, "natbib")).toBe(1);
  });

  it("a biblatex wrapper package (biblatex-chicago) satisfies biblatex AND gates natbib out", () => {
    const preamble = `\\documentclass{article}
\\usepackage[authordate]{biblatex-chicago}

\\begin{document}

`;
    // The wrapper loads biblatex → never co-load natbib (hard incompatibility),
    // even when the body's cite commands read as natbib-family.
    const out = ensurePreambleRequirements(preamble, new Set(["natbib"]));
    expect(out).not.toContain("natbib");
    // And biblatex itself is already satisfied — nothing injected.
    const out2 = ensurePreambleRequirements(preamble, new Set(["biblatex"]));
    expect(out2).not.toContain("\\usepackage{biblatex}");
  });

  it("does NOT false-satisfy on a package that merely contains the name as a substring", () => {
    const preamble = `\\documentclass{article}
\\usepackage{tikzsymbols}

\\begin{document}

`;
    const out = ensurePreambleRequirements(preamble, new Set(["tikz"]));
    expect(out).toContain("\\usepackage{tikz}");
  });

  it("a commented-out \\usepackage does NOT false-satisfy a live requirement", () => {
    // Body detection strips comments (projectDetectableBody), so the
    // satisfaction test must too — else a `% \usepackage{tikz}` suppresses the
    // real injection and the saved .tex has \begin{tikzpicture} with no tikz.
    const preamble = `\\documentclass{article}
% \\usepackage{tikz}

\\begin{document}

`;
    const out = ensurePreambleRequirements(preamble, new Set(["tikz"]));
    // A live (uncommented) \usepackage{tikz} line is injected; the comment is
    // left intact (matching by line so the comment's substring isn't counted).
    expect(out).toMatch(/^\\usepackage\{tikz\}$/m);
    expect(out).toContain("% \\usepackage{tikz}");
  });

  it("a commented bib package does NOT gate out the other family's injection", () => {
    // The mutual-exclusivity check runs on the inert-stripped preamble too, so
    // a commented `% \usepackage{biblatex}` no longer suppresses natbib.
    const preamble = `\\documentclass{article}
% \\usepackage{biblatex}

\\begin{document}

`;
    const out = ensurePreambleRequirements(preamble, new Set(["natbib"]));
    expect(out).toContain("\\usepackage{natbib}");
  });

  it("never injects natbib when the preamble already carries biblatex (and vice versa)", () => {
    const biblatexPreamble = `\\documentclass{article}
\\usepackage[style=apa]{biblatex}

\\begin{document}

`;
    const out1 = ensurePreambleRequirements(
      biblatexPreamble,
      new Set(["natbib"]),
    );
    expect(out1).not.toContain("\\usepackage{natbib}");

    const natbibPreamble = `\\documentclass{article}
\\usepackage{natbib}

\\begin{document}

`;
    const out2 = ensurePreambleRequirements(
      natbibPreamble,
      new Set(["biblatex"]),
    );
    expect(out2).not.toContain("\\usepackage{biblatex}");
  });
});

describe("stripAutoInjectedLines — normalization", () => {
  it("strip round-trips: normalized form is invariant under injection", () => {
    const req = new Set(["expex", "graphicx", "natbib"]);
    const injected = ensurePreambleRequirements(LEGACY_CLASSIC_V1, req);
    expect(injected).not.toBe(LEGACY_CLASSIC_V1);
    expect(stripAutoInjectedLines(injected)).toBe(
      stripAutoInjectedLines(LEGACY_CLASSIC_V1),
    );
  });

  it("legacy seed and current seed normalize to the same string (drift gate)", () => {
    expect(stripAutoInjectedLines(LEGACY_CLASSIC_V1)).toBe(
      stripAutoInjectedLines(CLASSIC_PREAMBLE),
    );
  });
});

describe("buildPreamble", () => {
  it("starts with the documentclass, carries the baseline block, ends with begin-document", () => {
    const p = buildPreamble("\\documentclass[11pt]{report}");
    expect(p.startsWith("\\documentclass[11pt]{report}\n")).toBe(true);
    for (const pkg of VIRGIL_BASELINE_PACKAGES) expect(p).toContain(pkg);
    for (const shim of SHIM_COMMAND_NAMES) {
      expect(p).toContain(`\\providecommand{\\${shim}}[1]{}`);
    }
    expect(p.endsWith("\\begin{document}\n\n")).toBe(true);
  });

  it("places extras after the baseline packages and before the shims", () => {
    const p = buildPreamble("\\documentclass{article}", [
      "\\usepackage{hyperref}",
    ]);
    expect(p.indexOf("\\usepackage{hyperref}")).toBeGreaterThan(
      p.indexOf("\\usepackage{expex}"),
    );
    expect(p.indexOf("\\usepackage{hyperref}")).toBeLessThan(
      p.indexOf("\\providecommand{\\vfid}[1]{}"),
    );
  });

  it("produces a preamble the requirements pass leaves untouched", () => {
    const p = buildPreamble("\\documentclass{article}");
    expect(
      ensurePreambleRequirements(
        p,
        new Set(["expex", "graphicx", "natbib", "xcolor"]),
      ),
    ).toBe(p);
  });
});

describe("serializeToLatex — requirements integration", () => {
  const exampleDoc: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { uuid: "0001" },
        content: [{ type: "text", text: "Consider the following." }],
      },
      {
        type: "exampleBlock",
        attrs: { uuid: "ab12", kind: "single" },
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "An example sentence." }],
          },
        ],
      },
    ],
  };

  it("exampleBlock doc + legacy classic preamble → exactly ONE \\usepackage{expex}", () => {
    const out = serializeToLatex(exampleDoc, { preamble: LEGACY_CLASSIC_V1 });
    expect(countOccurrences(out, "\\usepackage{expex}")).toBe(1);
  });

  it("exampleBlock doc + current classic preamble → still exactly ONE \\usepackage{expex}", () => {
    const out = serializeToLatex(exampleDoc, { preamble: CLASSIC_PREAMBLE });
    expect(countOccurrences(out, "\\usepackage{expex}")).toBe(1);
  });

  it("double-serialize through the real save loop is byte-stable", () => {
    const tex1 = serializeToLatex(exampleDoc, { preamble: LEGACY_CLASSIC_V1 });
    const parsed = parseLatex(tex1);
    const delimiters = extractPreambleAndPostamble(tex1);
    const tex2 = serializeToLatex(parsed, delimiters ?? undefined);
    expect(tex2).toBe(tex1);
  });

  it("double-serialize with the CURRENT classic preamble is byte-stable", () => {
    const tex1 = serializeToLatex(exampleDoc, { preamble: CLASSIC_PREAMBLE });
    const parsed = parseLatex(tex1);
    const delimiters = extractPreambleAndPostamble(tex1);
    const tex2 = serializeToLatex(parsed, delimiters ?? undefined);
    expect(tex2).toBe(tex1);
  });

  it("no-options DEFAULT_PREAMBLE path carries all 7 shims (regression: was skipped)", () => {
    const plainDoc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "0001" },
          content: [{ type: "text", text: "Hello." }],
        },
      ],
    };
    const out = serializeToLatex(plainDoc);
    for (const shim of SHIM_COMMAND_NAMES) {
      expect(out).toContain(`\\providecommand{\\${shim}}[1]{}`);
    }
  });

  it("\\parencite + \\citeauthor doc with a bare preamble → biblatex injected, not natbib", () => {
    // \citeauthor is SHARED (both packages define it) — it must not drag
    // natbib in next to the biblatex-only \parencite.
    const citeDoc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "0001" },
          content: [
            { type: "text", text: "As " },
            {
              type: "citation",
              attrs: { citationId: "c1", command: "\\citeauthor{smith2020}" },
            },
            { type: "text", text: " argues " },
            {
              type: "citation",
              attrs: { citationId: "c2", command: "\\parencite{smith2020}" },
            },
            { type: "text", text: "." },
          ],
        },
      ],
    };
    // LEGACY_CLASSIC_V1 carries neither bib package (bare preamble).
    const out = serializeToLatex(citeDoc, { preamble: LEGACY_CLASSIC_V1 });
    expect(out).toContain("\\usepackage{biblatex}");
    expect(out).not.toContain("\\usepackage{natbib}");
  });

  it("comment-only construct mentions do not inject packages through the real serialize path", () => {
    const commentDoc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "0001" },
          content: [{ type: "text", text: "Plain prose." }],
        },
        {
          type: "latexComment",
          attrs: { uuid: "0002" },
          content: [
            { type: "text", text: "TODO maybe \\autocite{smith} and \\ex here" },
          ],
        },
      ],
    };
    const out = serializeToLatex(commentDoc, { preamble: LEGACY_CLASSIC_V1 });
    expect(out).not.toContain("\\usepackage{biblatex}");
    expect(out).not.toContain("\\usepackage{expex}");
  });

  it("no-options path injects needs-driven packages (tikz via texBlock)", () => {
    const tikzDoc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "texBlock",
          attrs: {
            uuid: "0002",
            code: "\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}",
          },
        },
      ],
    };
    const out = serializeToLatex(tikzDoc);
    expect(countOccurrences(out, "\\usepackage{tikz}")).toBe(1);
  });

  it("commented-only \\usepackage{tikz} + tikzpicture body → real tikz still injected", () => {
    // End-to-end: a preamble whose ONLY tikz mention is commented, plus a body
    // that uses \begin{tikzpicture}, must save with a LIVE \usepackage{tikz}
    // (else the .tex fails to compile).
    const tikzDoc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "texBlock",
          attrs: {
            uuid: "0003",
            code: "\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}",
          },
        },
      ],
    };
    const preamble = `\\documentclass{article}
% \\usepackage{tikz}

\\begin{document}

`;
    const out = serializeToLatex(tikzDoc, { preamble });
    // Live (uncommented) injection present; the comment line still there too.
    expect(out).toMatch(/^\\usepackage\{tikz\}$/m);
    expect(out).toContain("% \\usepackage{tikz}");
  });
});

describe("style-library seed migration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("fresh seed is written at the current version", () => {
    const lib = getStyleLibrarySync();
    expect(lib.version).toBe(STYLE_LIBRARY_VERSION);
    expect(lib.styles.find((s) => s.id === "classic")?.preamble).toBe(
      CLASSIC_PREAMBLE,
    );
  });

  it("upgrades untouched v1 seeds on version bump and persists the new version", () => {
    localStorage.setItem(
      STYLE_LIBRARY_KEY,
      JSON.stringify({
        version: 1,
        defaultStyleId: "classic",
        styles: [
          {
            id: "classic",
            name: "Classic",
            preamble: LEGACY_CLASSIC_V1,
            origin: "seed",
            createdAt: "1970-01-01T00:00:00.000Z",
            updatedAt: "1970-01-01T00:00:00.000Z",
          },
          {
            id: "greenberg",
            name: "Greenberg",
            preamble: LEGACY_CLASSIC_V1,
            origin: "seed",
            createdAt: "1970-01-01T00:00:00.000Z",
            updatedAt: "1970-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    const lib = getStyleLibrarySync();
    expect(lib.version).toBe(STYLE_LIBRARY_VERSION);
    expect(lib.styles.find((s) => s.id === "classic")?.preamble).toBe(
      CLASSIC_PREAMBLE,
    );
    expect(lib.styles.find((s) => s.id === "greenberg")?.preamble).toBe(
      CLASSIC_PREAMBLE,
    );
    // Persisted: a second read sees the bumped version without re-migrating.
    const stored = JSON.parse(localStorage.getItem(STYLE_LIBRARY_KEY)!);
    expect(stored.version).toBe(STYLE_LIBRARY_VERSION);
  });

  it("upgrades untouched v0 (pre-xcolor) seeds too — the one-shot bump must not seal them out", () => {
    localStorage.setItem(
      STYLE_LIBRARY_KEY,
      JSON.stringify({
        version: 1,
        defaultStyleId: "classic",
        styles: [
          {
            id: "classic",
            name: "Classic",
            preamble: LEGACY_CLASSIC_V0,
            origin: "seed",
            createdAt: "1970-01-01T00:00:00.000Z",
            updatedAt: "1970-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    const lib = getStyleLibrarySync();
    expect(lib.version).toBe(STYLE_LIBRARY_VERSION);
    expect(lib.styles.find((s) => s.id === "classic")?.preamble).toBe(
      CLASSIC_PREAMBLE,
    );
  });

  it("leaves user-edited seeds and user styles untouched", () => {
    const editedSeed = LEGACY_CLASSIC_V1 + "% my tweak\n";
    localStorage.setItem(
      STYLE_LIBRARY_KEY,
      JSON.stringify({
        version: 1,
        defaultStyleId: "classic",
        styles: [
          {
            id: "classic",
            name: "Classic",
            preamble: editedSeed,
            origin: "seed",
            createdAt: "1970-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "style_abc123",
            name: "Mine",
            preamble: LEGACY_CLASSIC_V1,
            origin: "user",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    const lib = getStyleLibrarySync();
    expect(lib.version).toBe(STYLE_LIBRARY_VERSION);
    expect(lib.styles.find((s) => s.id === "classic")?.preamble).toBe(
      editedSeed,
    );
    // origin:"user" is never touched even when byte-identical to a legacy seed.
    expect(lib.styles.find((s) => s.id === "style_abc123")?.preamble).toBe(
      LEGACY_CLASSIC_V1,
    );
  });
});
