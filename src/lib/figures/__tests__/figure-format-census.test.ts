// @vitest-environment jsdom
/**
 * Task 1590 — ONE census of what a figure file can be.
 *
 * The picker used to hand-list `.webp` beside `FIGURE_PROBE_EXTS`, which task
 * 1437 had ruled webp OUT of because pdfTeX cannot include one — so a figure
 * inserted through Virgil's own picker previewed fine and then broke the
 * compile. Now the picker's accept lists, the probe order and the rasterizer's
 * dispatch all derive from `FIGURE_FORMATS`, and a non-includable pick is
 * transcoded (webp → png) before it reaches the paper.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/storage-mode", () => ({ fsaPickerUsable: () => false }));

import {
  FIGURE_FORMATS,
  FIGURE_PROBE_EXTS,
  figureFormatFor,
  type FigureFormat,
} from "@/lib/figures/graphics-path";
import {
  FIGURE_PICKER_ACCEPT,
  HTML_INPUT_ACCEPT,
  toIncludableFigure,
} from "@/lib/figures/pick-file";
import { resolveAssetImport } from "@/lib/figures/asset-import";

const FORMATS = FIGURE_FORMATS as readonly FigureFormat[];
const HERE = path.resolve(__dirname, "..");

describe("census · the figure-format table is the only extension list", () => {
  it("every pickable format is includable, or transcodes to an includable one", () => {
    for (const f of FORMATS) {
      if (f.includable) continue;
      expect(f.transcodeTo, `.${f.ext} is pickable but neither includable nor transcoded`).toBeTruthy();
      expect(figureFormatFor(f.transcodeTo!)?.includable).toBe(true);
    }
  });

  it("the probe list is the includable rows, in pdfTeX's order", () => {
    expect([...FIGURE_PROBE_EXTS]).toEqual(
      FORMATS.filter((f) => f.includable).map((f) => f.ext),
    );
    expect(FIGURE_PROBE_EXTS).not.toContain("webp");
  });

  it("the picker's accept lists derive from the census", () => {
    const pickerExts = Object.values(FIGURE_PICKER_ACCEPT).flat().sort();
    expect(pickerExts).toEqual(FORMATS.map((f) => `.${f.ext}`).sort());
    for (const f of FORMATS) {
      expect(FIGURE_PICKER_ACCEPT[f.mime as `${string}/${string}`]).toContain(`.${f.ext}`);
      expect(HTML_INPUT_ACCEPT.split(",")).toContain(`.${f.ext}`);
      expect(HTML_INPUT_ACCEPT.split(",")).toContain(f.mime);
    }
  });

  for (const rel of ["pick-file.ts", "rasterize.ts"]) {
    it(`${rel} spells no figure extension of its own`, () => {
      const raw = readFileSync(path.join(HERE, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      // A `render === "pdf"` compares the census's render KIND, not an extension.
      expect(raw).not.toMatch(/(?<!render\s*===\s*)["'`]\.?(png|jpe?g|webp|pdf)["'`]/);
    });
  }
});

describe("toIncludableFigure · a webp pick becomes a png", () => {
  it("transcodes webp to <stem>.png, drops the handle, and imports as .png", async () => {
    const transcode = vi.fn(async () => new Blob(["PNGBYTES"], { type: "image/png" }));
    const handle = {} as FileSystemFileHandle;
    const out = await toIncludableFigure(
      { file: new File(["W"], "plot.final.webp", { type: "image/webp" }), handle },
      transcode,
    );
    expect(transcode).toHaveBeenCalledWith(expect.any(File), "image/png");
    expect(out.file.name).toBe("plot.final.png");
    expect(out.file.type).toBe("image/png");
    expect(out.handle).toBeNull();
    // The import door names the asset from the (converted) file's name.
    const bytes = new Uint8Array(await out.file.arrayBuffer());
    const { name } = await resolveAssetImport(out.file.name, bytes, async () => null);
    expect(name).toBe("plot.final.png");
  });

  it("passes an includable pick through untouched, handle kept", async () => {
    const transcode = vi.fn();
    const handle = {} as FileSystemFileHandle;
    const picked = { file: new File(["P"], "Plot.PNG"), handle };
    expect(await toIncludableFigure(picked, transcode)).toBe(picked);
    expect(transcode).not.toHaveBeenCalled();
  });

  it("is case-insensitive about the extension", async () => {
    const transcode = vi.fn(async () => new Blob(["P"], { type: "image/png" }));
    const out = await toIncludableFigure(
      { file: new File(["W"], "IMG.WEBP"), handle: null },
      transcode,
    );
    expect(out.file.name).toBe("IMG.png");
  });
});
