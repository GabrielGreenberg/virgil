import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Resize-gutter grip vocabulary (task 2026-07-18-186).
 *
 * The `.band-grip` pill is the ONE visible affordance for every resize gutter,
 * in both orientations. Task 008 layered the pill over a pre-existing 1px
 * hairline vocabulary without removing the old layer; because the pill claimed
 * `::before` for horizontal gutters, the unshadowed horizontal `::after` kept
 * painting the dead blue hairline while dragging (vertical was fully shadowed
 * only by a specificity accident). These assertions pin the hairline layer dead
 * and the two-orientation pill state-set symmetric, so neither can grow back.
 */
const ROOT = path.resolve(__dirname, "..", "..");
const globals = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True if `selector` heads a rule block (a `{` follows, possibly across a
 *  selector list — these drag-gap rules are flat, no nested CSS). */
function hasRule(selector: string): boolean {
  return new RegExp(`${escape(selector)}[^{}]*\\{`).test(globals);
}

describe("resize-gutter grip — no legacy hairline layer", () => {
  it.each([
    // The base paint rule (content + --drag-highlight background).
    ".drag-gap::after",
    // The .dragging opacity that lit the hairline mid-drag.
    ".drag-gap.dragging::after",
    // The horizontal line geometry (full-span 1px) that leaked under the pill.
    ".drag-gap-h::after",
  ])("has deleted the dead hairline rule %s", (sel) => {
    // Must not exist as its own block — a `{` directly after the exact selector.
    expect(globals).not.toMatch(new RegExp(`${escape(sel)}\\s*\\{`));
  });

  it("no .drag-gap pseudo-element paints a 1px hairline line", () => {
    const re = /(\.drag-gap[^,{}]*::(?:before|after))[^{}]*\{([^}]*)\}/g;
    const offenders: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(globals))) {
      if (/\b(?:width|height):\s*1px/.test(m[2])) offenders.push(m[1].trim());
    }
    expect(offenders, `1px hairline still painted by: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("resize-gutter grip — orientation symmetry", () => {
  // Horizontal pill lives on ::before, vertical on ::after; each orientation
  // must carry the SAME state set (base + hover + dragging) or they drift.
  it.each([
    ["base", ".drag-gap-h.band-grip::before", ".drag-gap-v.band-grip::after"],
    ["hover", ".drag-gap-h.band-grip:hover::before", ".drag-gap-v.band-grip:hover::after"],
    ["dragging", ".drag-gap-h.band-grip.dragging::before", ".drag-gap-v.band-grip.dragging::after"],
  ])("defines the %s pill rule for both orientations", (_state, horizontal, vertical) => {
    expect(hasRule(horizontal), `missing horizontal ${horizontal}`).toBe(true);
    expect(hasRule(vertical), `missing vertical ${vertical}`).toBe(true);
  });

  it.each([
    // Each orientation claims exactly one pseudo for the pill; the OTHER pseudo
    // must never carry a band-grip rule (that cross-claim is what leaked).
    ".drag-gap-h.band-grip::after",
    ".drag-gap-v.band-grip::before",
  ])("does not cross-claim the other pseudo-element (%s)", (sel) => {
    expect(hasRule(sel), `unexpected cross-orientation pill rule ${sel}`).toBe(false);
  });
});
