// TASK 1338 — CENSUS: the margin-marker re-pin grab asks the surface door.
//
// The grab was gated on `editor?.isEditable !== false` in BOTH places that
// render a `MarkerButton` (the margin lane and the unanchored-cards chip).
// `editor.isEditable` is `view.editable`, which MAIN pins `true` for its whole
// life — so the Library Reader offered a grab whose drop the hit-test (which
// asks `surfaceEditableNow`, task 733) then refused everywhere. The one gate
// is `markerRepinGate` (`src/lib/marginalia.ts`, over `surfaceEditableNow`),
// re-asked by `MarkerButton` at PRESS time. Third re-spelling of this
// predicate (524, 579, 733) — hence the census.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Every file that hands a `MarkerButton` its re-pin gate. */
const GATE_SITES = ["src/components/Marginalia.tsx", "src/components/EditorPane.tsx"];

describe("marker re-pin gate CENSUS (task 1338)", () => {
  for (const rel of GATE_SITES) {
    it(`${rel} gates the re-pin grab on markerRepinGate, never on isEditable`, () => {
      const src = read(rel);
      expect(src).toContain("markerRepinGate(editor)");
      expect(src).not.toMatch(/dragEnabled\s*=\s*\{?\s*editor\??\.isEditable/);
      expect(src).not.toMatch(/const dragEnabled\s*=\s*editor\??\.isEditable/);
    });
  }

  it("the gate is the surface-editability door", () => {
    const lib = read("src/lib/marginalia.ts");
    const at = lib.indexOf("export function markerRepinGate(");
    expect(at).toBeGreaterThan(-1);
    expect(lib.slice(at, at + 200)).toContain("surfaceEditableNow(editor)");
  });

  it("MarkerButton re-asks the gate at PRESS time, not only at render", () => {
    const src = read("src/components/Marginalia.tsx");
    const at = src.indexOf("onMouseDown={reanchorKey ?");
    expect(at).toBeGreaterThan(-1);
    const handler = src.slice(at, src.indexOf("beginCardDropGesture({", at));
    expect(handler).toContain("repinGateOpen(dragEnabled)");
  });
});
