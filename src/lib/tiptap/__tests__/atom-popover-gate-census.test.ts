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
});
