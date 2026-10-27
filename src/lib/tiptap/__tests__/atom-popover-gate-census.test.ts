// TASK 1071 — CENSUS: every atom-popover click names its editability door.
//
// The math click gated on `editor.isEditable` (a constant `true` on MAIN) and
// the `\ref` bridge on nothing, so both opened a popover on a read-only doc
// whose save was silently filtered. The door is `atomPopoverMayOpen`
// (`src/lib/tiptap/atom-edit-target.ts`, over `surfaceEditableNow`). This
// census pins (a) every bridge listener for an atom popover that COMMITS a
// write asks it, and (b) the click sites never gate on `isEditable` again.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** The popover-opening click events whose popover commits a document write. */
const WRITE_POPOVER_EVENTS = ["virgil-math-click", "REF_CLICK_EVENT", "virgil-figure-click"];

describe("atom-popover gate CENSUS (task 1071)", () => {
  const bridges = read("src/components/editor-layout/event-bridges/marker-clicks.ts");

  for (const ev of WRITE_POPOVER_EVENTS) {
    it(`the ${ev} bridge listener asks atomPopoverMayOpen`, () => {
      const needle = ev.startsWith("virgil-")
        ? `window.addEventListener("${ev}", handler)`
        : `window.addEventListener(${ev}, handler)`;
      const at = bridges.indexOf(needle);
      expect(at, `listener for ${ev} not found`).toBeGreaterThan(-1);
      // The handler body is the `useEffect` block ending at the listener.
      const start = bridges.lastIndexOf("useEffect(", at);
      expect(bridges.slice(start, at)).toContain("atomPopoverMayOpen(owner)");
    });
  }

  const CLICK_SITES = [
    "src/lib/tiptap/math.ts",
    "src/lib/tiptap/label.ts",
    "src/components/FigureBlockNodeView.tsx",
  ];
  for (const rel of CLICK_SITES) {
    it(`${rel} gates its popover click on the door, never on isEditable`, () => {
      const src = read(rel);
      expect(src).toContain("atomPopoverMayOpen(editor)");
      expect(src).not.toMatch(/!\s*editor\??\.isEditable\)\s*return/);
    });
  }

  // Task 1082: the figure popover's COMMIT goes through the identity door —
  // `applyFigurePopoverEdit` (kind + uuid, else kind + seed, via
  // `resolveAtomEditTarget`) — never the bare per-kind writebacks, whose
  // kind fall-through stored a figure body as a graphic's `command`.
  it("handleFigureSave commits through applyFigurePopoverEdit, with no kind fall-through", () => {
    const layout = read("src/components/EditorLayout.tsx");
    const at = layout.indexOf("const handleFigureSave = useCallback(");
    expect(at, "handleFigureSave not found").toBeGreaterThan(-1);
    const body = layout.slice(at, layout.indexOf("}, [notifyAtomEditRefused]);", at));
    expect(body).toContain("applyFigurePopoverEdit(");
    expect(body).not.toContain("applyFigureEnvBodyEdit(");
    expect(body).not.toContain("applyGraphicsCommandEdit(");
    const door = read("src/lib/figures/popover-target.ts");
    expect(door).toContain("resolveAtomEditTarget(owner, at, isClickedFigure(clicked))");
  });

  // Task 1314: every edit popover's commit names its atom by a TRACKED
  // position (the door's signature takes a `TrackedPos`, so tsc pins that half)
  // and ANNOUNCES a refusal — a dropped return value is how a typed edit used to
  // vanish with no word.
  it("every edit-popover commit announces a refusal", () => {
    const layout = read("src/components/EditorLayout.tsx");
    for (const name of ["handleMathSave", "handleFigureSave"]) {
      const at = layout.indexOf(`const ${name} = useCallback(`);
      expect(at, `${name} not found`).toBeGreaterThan(-1);
      const body = layout.slice(at, layout.indexOf("[notifyAtomEditRefused]", at));
      expect(body, name).toMatch(/if \(!apply\w+\([\s\S]*?\)\) \{\s*notifyAtomEditRefused\(/);
    }
    const popover = layout.slice(layout.indexOf("<LabelRefPopover"));
    expect(popover).toMatch(/if \(!handleRefChangeLabel\([^)]*\)\) notifyAtomEditRefused/);
    expect(popover).toMatch(/if \(!handleRefChangeCommand\([^)]*\)\) notifyAtomEditRefused/);
    // And no session state reintroduces a raw click-time `pos`.
    const bridge = read("src/components/editor-layout/event-bridges/marker-clicks.ts");
    expect(bridge).not.toMatch(/setActive(?:Ref|Math|Figure)\(\{[\s\S]{0,400}?\bpos: detail\.pos/);
  });

  it("every virgil-figure-click detail carries the clicked uuid", () => {
    const view = read("src/components/FigureBlockNodeView.tsx");
    const sites = view.split('new CustomEvent("virgil-figure-click"').slice(1);
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) expect(site.slice(0, 600)).toMatch(/\buuid\b/);
    const registry = read("src/lib/actions/action-registry.ts");
    expect(registry).toMatch(/kind: "figureBlock",[\s\S]{0,1200}?\buuid,/);
    expect(registry).toMatch(/kind: "graphicsBlock",[\s\S]{0,200}?\buuid,/);
  });
});
