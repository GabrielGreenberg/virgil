/**
 * Regression guard (Chip 3): the legacy shift-mousedown-on-float-header
 * drop-mode entry stays retired.
 *
 * Before the card rework (req-7), a Shift+mousedown on a float's header armed
 * a drop-mode (re)anchor session straight from `FloatingPanel.onHeaderMouseDown`
 * — a hidden, undiscoverable affordance with no visible control. The card
 * rework removed it; (re)anchoring is now driven only by the explicit drop
 * button (`DropChevrons`) in `FloatChrome`, which routes through
 * `LiftHost.beginLift` (textobject) or `beginCardDropGesture` (card).
 *
 * `FloatingPanel.tsx` owns the header-mousedown handler; the shift entry lived
 * there. A source-level guard (matching the `float-window-drag-blocklist`
 * source-guard precedent) is the cheapest, clearest pin: assert the file
 * carries no `shiftKey` reference at all. The component reads `e.target` /
 * modifier-free deltas only — it has no legitimate reason to inspect
 * `shiftKey`, so a bare substring check can't false-positive, and a resurrected
 * shift branch (which would necessarily read `e.shiftKey`) trips it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, ".."); // src/components/
const FLOATING_PANEL = path.join(SRC, "FloatingPanel.tsx");

describe("FloatingPanel header drag carries no shift-drag drop-mode entry (req-7 regression guard)", () => {
  it("FloatingPanel.tsx references no shiftKey", () => {
    const src = readFileSync(FLOATING_PANEL, "utf8");
    expect(
      src.includes("shiftKey"),
      "FloatingPanel.tsx must not read e.shiftKey — the legacy shift-drag " +
        "(re)anchor entry was retired in the card rework; (re)anchoring is " +
        "the explicit FloatChrome drop button only.",
    ).toBe(false);
  });

  it("the header-mousedown handler does not enter drop-mode (no drop-gesture / drop-session IMPORT)", () => {
    // Belt-and-suspenders: the shift entry called into the drop machinery. The
    // header path must not reach it at all — the drop button (FloatChrome) is
    // the sole entry point now. We pin the absence of an *import* of the drop
    // gesture/session modules (a bare `beginCardDropGesture` mention survives in
    // a doc comment that points readers AT the drop button, so we can't match
    // the identifier loosely — an import is the unambiguous "reaches the
    // machinery" signal).
    const src = readFileSync(FLOATING_PANEL, "utf8");
    expect(src).not.toContain("drop-mode/card-drop-gesture");
    expect(src).not.toContain("drop-mode/controller");
    // No `import { … } from "…card-drop-gesture"` / drop-mode controller at all.
    expect(/from\s+["'][^"']*drop-mode\/(card-drop-gesture|controller)["']/.test(src)).toBe(
      false,
    );
  });
});
