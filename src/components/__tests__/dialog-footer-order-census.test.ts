/**
 * Task 1258 — **a dialog footer's ORDER is a rule the code is held to, not
 * prose that drifts.**
 *
 * STYLE_GUIDE → "Modal footers" said "ghost cancel, destructive far left" for
 * months while no footer had a ghost Cancel (the button could not even spell
 * `ghost`) and `StyleApplyDialog` seated its destructive "Hard update" directly
 * beside its cued "AI-managed update" — the one placement the rule exists to
 * prevent. Nothing checked, so nothing failed. The spec now describes the
 * shipped convention; this census holds it, over the shared `_dialog-sites`
 * footer population (per ELEMENT, both silos):
 *
 *   1. a `danger` button is never ADJACENT to a `primary` one;
 *   2. in a footer holding both, the danger button is FIRST and carries
 *      `mr-auto` (far left, away from the default);
 *   3. every button's variant is READABLE — a literal, the shell default, or
 *      the confirm-cue policy's `confirmActionVariant(…)` (read as "may be
 *      danger") — so no footer can escape the census by computing its look;
 *   4. the footer variants are the `Button` vocabulary itself: the
 *      `SystemDialogButtonVariant` union is DERIVED from `ButtonVariant`, so an
 *      alias like the retired `"accent"` (= `primary`) cannot come back.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { commentsStripped } from "@/lib/__tests__/_source-scan";
import { dialogFooterElements, SRC_ROOT, type DialogFooterSite } from "./_dialog-sites";

type Look = "primary" | "secondary" | "danger" | "maybe-danger";

/**
 * What does this button paint as?
 *   - no `variant` → `secondary` (the shell's default)
 *   - a literal → that member
 *   - `confirmActionVariant(…)` → `maybe-danger` (it yields danger OR primary)
 *   - anything else → null, UNRESOLVABLE (its own leg, expected empty)
 */
function lookOf(tag: string): Look | null {
  if (!/\bvariant\b\s*=/.test(tag)) return "secondary";
  if (/\bvariant\s*=\s*\{\s*confirmActionVariant\(/.test(tag)) return "maybe-danger";
  const m = /\bvariant\s*=\s*\{?"([^"]+)"\}?/.exec(tag);
  if (!m) return null;
  return m[1] as Look;
}

const isDanger = (l: Look | null) => l === "danger" || l === "maybe-danger";

/** Every order violation in one footer, as human-readable strings. */
function footerViolations(site: Pick<DialogFooterSite, "rel" | "buttons">): string[] {
  const looks = site.buttons.map(lookOf);
  const out: string[] = [];
  looks.forEach((l, i) => {
    if (l === null) out.push(`${site.rel}: button ${i} has an unreadable variant`);
    else if (!["primary", "secondary", "danger", "maybe-danger"].includes(l))
      out.push(`${site.rel}: button ${i} spells unknown variant "${l}"`);
  });
  for (let i = 0; i + 1 < looks.length; i++) {
    const [a, b] = [looks[i], looks[i + 1]];
    if ((isDanger(a) && b === "primary") || (a === "primary" && isDanger(b)))
      out.push(`${site.rel}: danger button ${isDanger(a) ? i : i + 1} sits beside a primary`);
  }
  const hasPrimary = looks.includes("primary");
  looks.forEach((l, i) => {
    if (l !== "danger" || !hasPrimary) return;
    if (i !== 0 || !/\bmr-auto\b/.test(site.buttons[i]))
      out.push(`${site.rel}: danger button ${i} in a footer with a primary must be first, with mr-auto`);
  });
  return out;
}

describe("dialog footer order CENSUS (task 1258)", () => {
  const footers = dialogFooterElements();

  it("the census finds the real footers (it is not scanning nothing)", () => {
    const rels = footers.map((f) => f.rel);
    expect(footers.length).toBeGreaterThanOrEqual(12);
    expect(rels).toContain("components/StyleApplyDialog.tsx");
    expect(rels).toContain("components/ConfirmDialog.tsx");
    expect(footers.every((f) => f.buttons.length > 0)).toBe(true);
  });

  it("no production footer violates the order rule", () => {
    expect(footers.flatMap(footerViolations)).toEqual([]);
  });

  it("SystemDialogButtonVariant is derived from ButtonVariant (no alias names)", () => {
    const shell = commentsStripped(
      readFileSync(join(SRC_ROOT, "components/system-dialog.tsx"), "utf8"),
    );
    expect(shell).toMatch(
      /export type SystemDialogButtonVariant\s*=\s*Extract<\s*ButtonVariant\s*,/,
    );
    expect(shell).not.toMatch(/"accent"/);
  });

  it("CANARY: the pre-fix StyleApplyDialog footer is flagged", () => {
    const v = footerViolations({
      rel: "x.tsx",
      buttons: [
        '<SystemDialogButton variant="secondary" onClick={c}>',
        '<SystemDialogButton variant="danger" onClick={h}>',
        '<SystemDialogButton variant="primary" onClick={a} autoFocus>',
      ],
    });
    expect(v.some((s) => s.includes("beside a primary"))).toBe(true);
    expect(v.some((s) => s.includes("must be first"))).toBe(true);
  });

  it("CANARY: the retired accent alias is flagged as unknown", () => {
    expect(
      footerViolations({ rel: "x.tsx", buttons: ['<SystemDialogButton variant="accent">'] }),
    ).toEqual(['x.tsx: button 0 spells unknown variant "accent"']);
  });

  it("CANARY: shipped shapes pass — far-left danger, two-button danger confirm, policy confirm", () => {
    const ok = [
      ['<SystemDialogButton variant="danger" className="mr-auto">', "<SystemDialogButton>", '<SystemDialogButton variant="primary">'],
      ['<SystemDialogButton variant="secondary" autoFocus>', '<SystemDialogButton variant="danger">'],
      ["<SystemDialogButton>", "<SystemDialogButton variant={confirmActionVariant(tone)}>"],
    ];
    for (const buttons of ok) expect(footerViolations({ rel: "x.tsx", buttons })).toEqual([]);
  });

  it("CANARY: a dynamic variant is unreadable", () => {
    expect(lookOf("<SystemDialogButton variant={look}>")).toBeNull();
  });
});
