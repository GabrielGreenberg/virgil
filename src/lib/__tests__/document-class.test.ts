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

  it("skips a commented-out \\documentclass and reads the live one", () => {
    const src =
      "% \\documentclass{article}\n\\documentclass{report}\n\\begin{document}";
    const info = extractDocumentClass(src);
    expect(info?.className).toBe("report");
    // matchStart must point at the LIVE class so rewrite splices correctly.
    expect(src.slice(info!.matchStart, info!.matchEnd)).toBe(
      "\\documentclass{report}",
    );
  });

  it("returns null when the only \\documentclass is commented out", () => {
    expect(extractDocumentClass("% \\documentclass{article}\ntext")).toBeNull();
  });

  it("ignores a \\documentclass inside a verbatim environment", () => {
    const src =
      "\\begin{verbatim}\n\\documentclass{article}\n\\end{verbatim}\n\\documentclass{book}";
    expect(extractDocumentClass(src)?.className).toBe("book");
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

  it("ignores occurrences in lstlisting / minted (FULL family)", () => {
    const src =
      "\\begin{lstlisting}\n\\chapter{ignore}\n\\end{lstlisting}\n\\begin{minted}\n\\part{nope}\n\\end{minted}\n\\section{keep}";
    const found = findSectioningCommands(src);
    expect(found.has("chapter")).toBe(false);
    expect(found.has("part")).toBe(false);
    expect(found.has("section")).toBe(true);
  });

  it("does NOT let \\verbatim / \\verbdef swallow a following \\section (word-boundary bug)", () => {
    // The former inline-verb regex /\\verb\*?(.)[\s\S]*?\1/ mis-read
    // `\verbatim` as `\verb` + delimiter `a` and consumed through to the
    // next `a`, eating the real `\section`. \verb needs a NON-letter
    // delimiter, so \verbatim/\verbdef must not be treated as inline verb.
    const found1 = findSectioningCommands("\\verbatim\n\\section{X}");
    expect(found1.has("section")).toBe(true);
    const found2 = findSectioningCommands("\\verbdef\\cmd{x}\n\\chapter{Y}");
    expect(found2.has("chapter")).toBe(true);
  });

  it("still ignores a genuine inline \\verb|...| run", () => {
    const found = findSectioningCommands("\\verb|\\chapter{fake}|\n\\section{real}");
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

  it("sees the LIVE class, not a commented-out one (report, not article)", () => {
    // A commented `% \documentclass{article}` above a live
    // `\documentclass{report}`: the mismatch logic must read `report`, so
    // \chapter is NOT flagged (report supports chapters). Reading the
    // commented `article` would wrongly flag \chapter.
    const src =
      "% \\documentclass{article}\n\\documentclass{report}\n\\begin{document}\n\\chapter{Intro}\n\\end{document}";
    expect(detectDocumentClassMismatch(src)).toBeNull();
  });

  it("flags a mismatch against the LIVE class even when a compatible class is commented", () => {
    // Live class is article (no \chapter); a commented `report` must not
    // rescue it.
    const src =
      "% \\documentclass{report}\n\\documentclass{article}\n\\begin{document}\n\\chapter{Intro}\n\\end{document}";
    const m = detectDocumentClassMismatch(src);
    expect(m?.currentClass).toBe("article");
    expect(m?.offenders).toEqual(["chapter"]);
  });
});

describe("rewriteDocumentClass — live-offset awareness", () => {
  it("rewrites the LIVE class, leaving a commented one intact", () => {
    const src =
      "% \\documentclass{article}\n\\documentclass{report}\n\\begin{document}";
    expect(rewriteDocumentClass(src, "book")).toBe(
      "% \\documentclass{article}\n\\documentclass{book}\n\\begin{document}",
    );
  });
});
