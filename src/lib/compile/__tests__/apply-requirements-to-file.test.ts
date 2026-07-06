import { describe, expect, it } from "vitest";
import { applyRequirementsToFile } from "@/lib/compile/apply-requirements-to-file";
import {
  detectBodyRequirements,
  ensurePreambleRequirements,
} from "@/lib/latex-requirements";

const BEGIN = "\\begin{document}";

/** The save-time injection, computed independently (the ground truth). */
function saveTimeInject(tex: string): string {
  const idx = tex.indexOf(BEGIN);
  if (idx === -1) return tex;
  const preamble = tex.slice(0, idx + BEGIN.length);
  const body = tex.slice(idx + BEGIN.length);
  return ensurePreambleRequirements(preamble, detectBodyRequirements(body)) + body;
}

const MINIMAL_PREAMBLE = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
`;

describe("applyRequirementsToFile — byte-identical to save-time injection", () => {
  it("matches save-time injection for a doc using xlist (the P2 self-suff case)", () => {
    const tex = `${MINIMAL_PREAMBLE}
${BEGIN}

\\begin{xlist}
\\a First tier.
\\end{xlist}

\\end{document}
`;
    const out = applyRequirementsToFile(tex);
    expect(out).toBe(saveTimeInject(tex));
    // And the whole point: expex + the xlist env are now present.
    expect(out).toContain("\\usepackage{expex}");
    expect(out).toContain("\\newenvironment{xlist}{\\pex}{\\xe}");
  });

  it("matches save-time injection for a doc using \\includegraphics + \\textcolor", () => {
    const tex = `${MINIMAL_PREAMBLE}
${BEGIN}

\\includegraphics{plot.png}
\\textcolor[HTML]{FF0000}{red}

\\end{document}
`;
    const out = applyRequirementsToFile(tex);
    expect(out).toBe(saveTimeInject(tex));
    expect(out).toContain("\\usepackage{graphicx}");
    expect(out).toContain("\\usepackage{xcolor}");
  });

  it("matches save-time injection for a doc using natbib cite commands", () => {
    const tex = `${MINIMAL_PREAMBLE}
${BEGIN}

As \\citep{smith2020} shows.

\\end{document}
`;
    const out = applyRequirementsToFile(tex);
    expect(out).toBe(saveTimeInject(tex));
    expect(out).toContain("\\usepackage{natbib}");
  });
});

describe("applyRequirementsToFile — no-op when already satisfied", () => {
  it("returns the input byte-identical when the preamble already has everything", () => {
    const tex = `\\documentclass{article}
\\usepackage{xcolor}
\\usepackage{graphicx}
\\usepackage{expex}
\\newenvironment{xlist}{\\pex}{\\xe}
\\providecommand{\\vfid}[1]{}
\\providecommand{\\vcid}[1]{}
\\providecommand{\\vbid}[1]{}
\\providecommand{\\vexid}[1]{}
\\providecommand{\\vxid}[1]{}
\\providecommand{\\vlid}[1]{}
\\providecommand{\\vlidend}[1]{}
${BEGIN}

\\begin{xlist}
\\a x
\\end{xlist}

\\end{document}
`;
    expect(applyRequirementsToFile(tex)).toBe(tex);
  });

  it("returns a fragment with no \\begin{document} byte-identical (nothing to do)", () => {
    const fragment = "\\section{Intro}\nSome body \\ex text \\xe with no preamble.";
    expect(applyRequirementsToFile(fragment)).toBe(fragment);
  });

  it("is idempotent — a second pass changes nothing", () => {
    const tex = `${MINIMAL_PREAMBLE}
${BEGIN}

\\begin{xlist}
\\a x
\\end{xlist}

\\end{document}
`;
    const once = applyRequirementsToFile(tex);
    expect(applyRequirementsToFile(once)).toBe(once);
  });
});

describe("applyRequirementsToFile — injection ORDER preserved", () => {
  it("injects packages before shims, right before \\begin{document}", () => {
    const tex = `${MINIMAL_PREAMBLE}
${BEGIN}

\\includegraphics{a.png}
\\begin{xlist}\\a x\\end{xlist}

\\end{document}
`;
    const out = applyRequirementsToFile(tex);
    const graphicxIdx = out.indexOf("\\usepackage{graphicx}");
    const expexIdx = out.indexOf("\\usepackage{expex}");
    const xlistEnvIdx = out.indexOf("\\newenvironment{xlist}");
    const shimIdx = out.indexOf("\\providecommand{\\vfid}");
    const beginIdx = out.indexOf(BEGIN);

    // Packages precede the shims / xlist-env; everything precedes \begin{document}.
    expect(graphicxIdx).toBeGreaterThan(-1);
    expect(expexIdx).toBeGreaterThan(-1);
    expect(graphicxIdx).toBeLessThan(expexIdx);
    expect(expexIdx).toBeLessThan(xlistEnvIdx);
    expect(xlistEnvIdx).toBeLessThan(shimIdx);
    expect(shimIdx).toBeLessThan(beginIdx);
  });

  it("does NOT write injected requirements past \\begin{document} (body untouched)", () => {
    const tex = `${MINIMAL_PREAMBLE}
${BEGIN}

\\includegraphics{a.png}

\\end{document}
`;
    const out = applyRequirementsToFile(tex);
    const body = out.slice(out.indexOf(BEGIN) + BEGIN.length);
    // The body is exactly what it was — no \usepackage leaked into it.
    expect(body).not.toContain("\\usepackage");
    expect(body).toBe(tex.slice(tex.indexOf(BEGIN) + BEGIN.length));
  });
});
