import { describe, it, expect } from "vitest";
import { pdfOpenArgs } from "@/components/PdfViewer";

/**
 * Light unit test for the one pure seam in PdfViewer (F#10): the mapping from a
 * blob object URL + filename to the argument object passed to the vendored
 * pdf.js PDFViewerApplication.open(). The iframe/viewer integration itself is
 * browser-only and verified live; this guards the arg shape.
 */
describe("pdfOpenArgs", () => {
  it("passes the blob URL through and names the file with originalUrl", () => {
    expect(pdfOpenArgs("blob:https://app/abc-123", "genette1997.pdf")).toEqual({
      url: "blob:https://app/abc-123",
      originalUrl: "genette1997.pdf",
    });
  });

  it("does not mutate or re-encode the object URL", () => {
    const u = "blob:https://app/d4e5f6";
    expect(pdfOpenArgs(u, "x.pdf").url).toBe(u);
  });
});
