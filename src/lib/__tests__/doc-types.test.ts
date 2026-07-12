import { describe, it, expect } from "vitest";
import {
  DOC_TYPES,
  DEFAULT_DOC_TYPE_ID,
  getDocType,
  buildDocTypeTex,
  buildDocTypeFiles,
} from "@/lib/doc-types";
import {
  DOCUMENT_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
  getTemplate,
} from "@/lib/document-templates";
import {
  extractDocumentClass,
  findSectioningCommands,
  detectDocumentClassMismatch,
  CLASS_COMMANDS,
} from "@/lib/document-class";

describe("DOC_TYPES SSOT", () => {
  it("offers the collapsed pure doc-type set (blank / article / book / report)", () => {
    expect(DOC_TYPES.map((d) => d.id)).toEqual([
      "blank",
      "article",
      "book",
      "report",
    ]);
    // The old feature-toggle variant is gone.
    expect(DOC_TYPES.some((d) => d.id === "article-bib")).toBe(false);
  });

  it("defaults to blank", () => {
    expect(DEFAULT_DOC_TYPE_ID).toBe("blank");
    expect(getDocType(DEFAULT_DOC_TYPE_ID)).toBeDefined();
  });

  for (const dt of DOC_TYPES) {
    describe(`doc type "${dt.id}"`, () => {
      const tex = buildDocTypeTex(dt);

      it("emits \\documentclass as the first preamble line, with the declared class + options", () => {
        expect(tex.startsWith("\\documentclass")).toBe(true);
        const info = extractDocumentClass(tex);
        expect(info).not.toBeNull();
        expect(info!.className).toBe(dt.documentClass);
        expect(info!.options).toBe(dt.classOptions);
      });

      it("uses only sectioning commands its class supports", () => {
        const used = findSectioningCommands(tex);
        const supported = CLASS_COMMANDS[dt.documentClass];
        for (const cmd of used) expect(supported.has(cmd)).toBe(true);
        // A fresh doc must never trip the compile-time class/section mismatch.
        expect(detectDocumentClassMismatch(tex)).toBeNull();
      });

      it("scaffolds bibliography material iff includeBib", () => {
        const files = buildDocTypeFiles(dt);
        if (dt.includeBib) {
          expect(files["references.bib"]).toBeDefined();
          expect(tex).toContain("\\bibliography{references}");
          expect(tex).toContain("\\bibliographystyle{plainnat}");
        } else {
          expect(files["references.bib"]).toBeUndefined();
          expect(tex).not.toContain("\\bibliography{references}");
        }
      });

      it("closes the document", () => {
        expect(tex.trimEnd().endsWith("\\end{document}")).toBe(true);
      });
    });
  }

  it("every TYPED class carries bibliography material by default (only blank is bare)", () => {
    for (const dt of DOC_TYPES) {
      if (dt.id === "blank") expect(dt.includeBib).toBe(false);
      else expect(dt.includeBib).toBe(true);
    }
  });

  it("book uses \\frontmatter/\\mainmatter; report does not", () => {
    const book = buildDocTypeTex(getDocType("book")!);
    expect(book).toContain("\\frontmatter");
    expect(book).toContain("\\mainmatter");
    const report = buildDocTypeTex(getDocType("report")!);
    expect(report).not.toContain("\\frontmatter");
    expect(report).not.toContain("\\mainmatter");
  });

  it("chaptered classes get a table of contents; article/blank do not", () => {
    expect(buildDocTypeTex(getDocType("book")!)).toContain("\\tableofcontents");
    expect(buildDocTypeTex(getDocType("report")!)).toContain("\\tableofcontents");
    expect(buildDocTypeTex(getDocType("article")!)).not.toContain(
      "\\tableofcontents",
    );
    expect(buildDocTypeTex(getDocType("blank")!)).not.toContain(
      "\\tableofcontents",
    );
  });

  it("blank stays minimal — no title block, no bib, bare body", () => {
    const blank = getDocType("blank")!;
    const tex = buildDocTypeTex(blank);
    expect(tex).not.toContain("\\maketitle");
    expect(tex).not.toContain("\\section");
    expect(tex).not.toContain("\\bibliography");
    expect(tex).toContain("Start writing here");
  });
});

describe("DOCUMENT_TEMPLATES derived from DOC_TYPES", () => {
  it("mirrors the doc-type ids one-for-one", () => {
    expect(DOCUMENT_TEMPLATES.map((t) => t.id)).toEqual(
      DOC_TYPES.map((d) => d.id),
    );
    expect(DEFAULT_TEMPLATE_ID).toBe(DEFAULT_DOC_TYPE_ID);
  });

  it("each template's main .tex key matches its mainTexFilename", () => {
    for (const t of DOCUMENT_TEMPLATES) {
      expect(t.files[t.mainTexFilename]).toBeDefined();
    }
  });

  it("typed templates ship a references.bib; blank does not", () => {
    expect(getTemplate("article")!.files["references.bib"]).toBeDefined();
    expect(getTemplate("book")!.files["references.bib"]).toBeDefined();
    expect(getTemplate("report")!.files["references.bib"]).toBeDefined();
    expect(getTemplate("blank")!.files["references.bib"]).toBeUndefined();
  });
});
