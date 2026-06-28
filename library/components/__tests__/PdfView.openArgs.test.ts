import { describe, it, expect } from "vitest";
import { pdfOpenArgs } from "../PdfView";

/**
 * Light unit test for the one pure seam in PdfView (F#10): the mapping from a
 * blob object URL + citekey to the argument object passed to the vendored
 * pdf.js PDFViewerApplication.open(). The iframe/viewer integration itself is
 * browser-only and verified live; this guards the arg shape.
 */
describe("pdfOpenArgs", () => {
  it("passes the blob URL through and sets a friendly originalUrl from the citekey", () => {
    expect(pdfOpenArgs("blob:https://app/abc-123", "genette1997")).toEqual({
      url: "blob:https://app/abc-123",
      originalUrl: "genette1997.pdf",
    });
  });

  it("omits originalUrl when there is no citekey", () => {
    expect(pdfOpenArgs("blob:https://app/abc-123", null)).toEqual({
      url: "blob:https://app/abc-123",
    });
  });

  it("does not mutate or re-encode the object URL", () => {
    const u = "blob:https://app/d4e5f6";
    expect(pdfOpenArgs(u, "x").url).toBe(u);
  });
});
