// @vitest-environment jsdom
//
// Copy-convention pin for the four ATOM-BLOCK `confirmDestructive` closures
// (task 2026-08-04-293). Atom blocks always warn (no meaningful empty state),
// so they don't route through `descriptorForSimpleBlock`; historically each
// hand-wrote its own descriptor and two of them (`displayMath`, `texBlock`)
// let their confirm BUTTON fall back to the generic "Delete block" while their
// own title/message already named the kind and their siblings named theirs.
//
// The deepFix folds all four onto `descriptorForAtomBlock`, whose confirmLabel
// is `${label} ${kindLabel}` — the same convention every non-atom kind already
// follows (paragraph/list/example/heading/passage). This test pins the button
// copy so a future atom kind can't regress to the bare "block", and pins the
// two byte-identical siblings (graphic/figure) so the fold stayed behavior-
// preserving.
//
// The registry transitively imports `@/lib/storage` (via NodeView components in
// the extension barrel), whose backend pick does a raw `require("@/lib/storage-
// fsa")` vitest can't follow. We never CALL a storage fn, so a wholesale stub is
// enough — same pattern as block-atom-facet-parity.test.ts.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import type { Node as PMNode } from "@tiptap/pm/model";
import { TEXT_OBJECT_REGISTRY } from "../text-object-registry";
import type { ConfirmDestructiveContext } from "../types";

// The atom-block closures ignore doc/uuid/ctx entirely (they always warn), so a
// dummy doc + ctx is faithful to the real call.
const DOC = null as unknown as PMNode;
const CTX: ConfirmDestructiveContext = {
  outerRange: { from: 0, to: 0 },
  hasAnchorsOrAtoms: false,
};

function confirm(kind: keyof typeof TEXT_OBJECT_REGISTRY, action: "delete" | "archive") {
  return TEXT_OBJECT_REGISTRY[kind].confirmDestructive?.(DOC, "u", action, CTX);
}

describe("atom-block confirmDestructive copy convention (task 293)", () => {
  it("displayMath + texBlock buttons name the kind, not the generic 'block'", () => {
    expect(confirm("displayMath", "delete")?.confirmLabel).toBe("Delete math block");
    expect(confirm("displayMath", "archive")?.confirmLabel).toBe("Archive math block");
    expect(confirm("texBlock", "delete")?.confirmLabel).toBe("Delete TeX block");
    expect(confirm("texBlock", "archive")?.confirmLabel).toBe("Archive TeX block");
  });

  it("the atom-block title and its button agree on the kind name", () => {
    const d = confirm("displayMath", "delete");
    expect(d?.title).toBe("Delete this math block?");
    expect(d?.confirmLabel).toBe("Delete math block");
    const t = confirm("texBlock", "delete");
    expect(t?.title).toBe("Delete this TeX block?");
    expect(t?.confirmLabel).toBe("Delete TeX block");
  });

  it("texBlock keeps its 'raw LaTeX block' message granularity", () => {
    expect(confirm("texBlock", "delete")?.message).toBe("Delete this raw LaTeX block.");
    expect(confirm("texBlock", "archive")?.message).toBe("Archive this raw LaTeX block.");
  });

  it("graphicsBlock + figureBlock copy is unchanged (already correct)", () => {
    expect(confirm("graphicsBlock", "delete")?.confirmLabel).toBe("Delete graphic");
    expect(confirm("graphicsBlock", "delete")?.message).toBe("Delete this graphic.");
    expect(confirm("figureBlock", "delete")?.confirmLabel).toBe("Delete figure");
    expect(confirm("figureBlock", "delete")?.message).toBe(
      "Delete this figure and its caption.",
    );
  });
});
