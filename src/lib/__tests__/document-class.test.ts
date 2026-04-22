import { describe, it, expect } from "vitest";
import {
  detectDocumentClassMismatch,
  extractDocumentClass,
  findSectioningCommands,
  rewriteDocumentClass,
} from "@/lib/document-class";

describe("extractDocumentClass", () => {
  it("reads a plain class", () => {
    expect(extractDocumentClass("\\documentclass{article}\n")).toMatchObject({
      className: "article",
      options: null,
    });
  });

  it("preserves options", () => {
    const info = extractDocumentClass("\\documentclass[11pt,a4paper]{report}");
    expect(info?.className).toBe("report");
    expect(info?.options).toBe("11pt,a4paper");
  });

  it("returns null when absent", () => {
    expect(extractDocumentClass("just some text")).toBeNull();
  });
});

describe("rewriteDocumentClass", () => {
  it("swaps the class name, preserving options", () => {
    const src = "\\documentclass[11pt]{article}\n\\begin{document}";
    expect(rewriteDocumentClass(src, "report")).toBe(
      "\\documentclass[11pt]{report}\n\\begin{document}",
    );
  });

  it("is a no-op without a documentclass", () => {
    expect(rewriteDocumentClass("no preamble", "book")).toBe("no preamble");
  });
});

describe("findSectioningCommands", () => {
  it("detects chapter, section, subsection", () => {
    const src = "\\chapter{A}\n\\section{B}\n\\subsection*{C}";
    const found = findSectioningCommands(src);
    expect(found.has("chapter")).toBe(true);
    expect(found.has("section")).toBe(true);
    expect(found.has("subsection")).toBe(true);
  });

  it("ignores occurrences in %-comments", () => {
    const src = "% \\chapter{ignore me}\n\\section{keep}";
    const found = findSectioningCommands(src);
    expect(found.has("chapter")).toBe(false);
    expect(found.has("section")).toBe(true);
  });

  it("ignores occurrences in verbatim", () => {
    const src =
      "\\begin{verbatim}\n\\chapter{ignore}\n\\end{verbatim}\n\\section{keep}";
    const found = findSectioningCommands(src);
    expect(found.has("chapter")).toBe(false);
    expect(found.has("section")).toBe(true);
  });
});

describe("detectDocumentClassMismatch", () => {
  it("flags \\chapter in article", () => {
    const src =
      "\\documentclass{article}\n\\begin{document}\n\\chapter{Intro}\n\\end{document}";
    const m = detectDocumentClassMismatch(src);
    expect(m).not.toBeNull();
    expect(m?.currentClass).toBe("article");
    expect(m?.offenders).toEqual(["chapter"]);
    expect(m?.suggestions).toContain("report");
    expect(m?.suggestions[0]).toBe("report"); // article → report is closest
  });

  it("does not flag \\chapter in report", () => {
    const src =
      "\\documentclass{report}\n\\begin{document}\n\\chapter{Intro}\n\\end{document}";
    expect(detectDocumentClassMismatch(src)).toBeNull();
  });

  it("flags \\section in letter", () => {
    const src =
      "\\documentclass{letter}\n\\begin{document}\n\\section{Oh no}\n\\end{document}";
    const m = detectDocumentClassMismatch(src);
    expect(m?.currentClass).toBe("letter");
    expect(m?.offenders).toContain("section");
    expect(m?.suggestions).toContain("article");
  });

  it("stays silent for unknown classes (custom journal cls)", () => {
    const src =
      "\\documentclass{acmart}\n\\begin{document}\n\\chapter{X}\n\\end{document}";
    expect(detectDocumentClassMismatch(src)).toBeNull();
  });

  it("stays silent when there's no documentclass at all", () => {
    expect(detectDocumentClassMismatch("\\chapter{bare}")).toBeNull();
  });
});
