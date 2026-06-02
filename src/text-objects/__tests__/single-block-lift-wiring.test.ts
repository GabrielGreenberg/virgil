/**
 * Deterministic lock for bodyless-kinds Chip 1 (memo L3g): the prose lift
 * wiring for `blockquote` + `codeBlock`. Before this chip both kinds fell to
 * `popoutKeyForLift`'s `default: return null` (lift was a no-op) and carried
 * no `liftMode` (instant-popout default) with the placeholder float body.
 *
 * This pins all three touch-points so a regression that drops a
 * `popoutKeyForLift` case, un-flips `liftMode`, or loses the body
 * registration fails loudly. Float-schema membership for both kinds is
 * already covered by `src/lib/__tests__/editor-extensions.test.ts`
 * (`EXPECTED_FLOAT_ORDER`) — not re-asserted here.
 */
import { describe, it, expect, vi } from "vitest";

// The float-body barrel transitively imports the editor-extensions factory,
// which imports `@/lib/storage` (figure / graphics / tex-block NodeViews).
// storage.ts picks its backend with a raw `require("@/lib/storage-fsa")` the
// vitest resolver can't follow; we never CALL storage here, so a stub is
// enough — same pattern as linked-range-popout-fidelity.test.ts.
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

import { popoutKeyForLift } from "../TextObjectGrabHandle";
import {
  TEXT_OBJECT_REGISTRY,
  textObjectPopoutKey,
} from "../text-object-registry";
import type { TextObjectKind } from "../types";
// Side-effect import: runs every `registerFloatBody(...)`, including the two
// new `SingleBlockBody` registrations this chip adds.
import "../floats";

const MIGRATED: TextObjectKind[] = ["blockquote", "codeBlock"];

describe("bodyless-kinds Chip 1 — blockquote + codeBlock lift wiring (L3g)", () => {
  it("popoutKeyForLift returns the canonical key for both kinds (was null)", () => {
    for (const kind of MIGRATED) {
      const key = popoutKeyForLift({ kind, id: "ab12" });
      expect(key).toBe(textObjectPopoutKey({ kind, id: "ab12" }));
      expect(key).toBe(`textobject:${kind}:ab12`);
    }
  });

  it("still returns null for a not-yet-migrated bodyless kind (control)", () => {
    // displayMath is one of the 7 kinds still on `default: return null`. This
    // documents the remaining work AND proves the switch is specific, not a
    // blanket non-null.
    expect(popoutKeyForLift({ kind: "displayMath", id: "ab12" })).toBeNull();
  });

  it("flips liftMode to lifted-overlay for both kinds (was undefined)", () => {
    for (const kind of MIGRATED) {
      expect(TEXT_OBJECT_REGISTRY[kind].liftMode).toBe("lifted-overlay");
    }
  });

  it("registers ONE shared float body for both kinds (the ListBody precedent)", () => {
    const bqBody = TEXT_OBJECT_REGISTRY.blockquote.floatBodyComponent;
    const codeBody = TEXT_OBJECT_REGISTRY.codeBlock.floatBodyComponent;
    expect(typeof bqBody).toBe("function");
    // Same component instance drives both kinds (kind is resolved from the
    // cardKey inside the body), not two hand-rolled bodies.
    expect(bqBody).toBe(codeBody);
    expect((bqBody as { name?: string }).name).toBe("SingleBlockBody");
  });
});
