/**
 * Task 515 — **every member of the dialog shell's positioning taxonomy has a
 * production CALLER.**
 *
 * `SystemDialog`'s `variant` axis is a declared TAXONOMY (STYLE_GUIDE →
 * "Positioning variants"), and a taxonomy is only as good as its members being
 * things the app actually does. A third member, `"anchored"`, sat in the union
 * — with an `at={{x,y}}` prop and an `outsideClickGuard` escape that existed to
 * serve it, and a suite pinning all three — for four months after task 495
 * deleted its ONE consumer. Nothing failed. Nothing could: the shell was never
 * the part that could misbehave, and neither existing census can see the shape
 * (`dead-component-import-guardrail` asks about IMPORTS; the dead-PROP sibling
 * asks whether a prop is read in its OWN declaring file, which
 * `outsideClickGuard` was). Task 202's rule is that an untaken capability is a
 * dead SSOT the next reader trusts — worse than none, because reaching for it
 * you would be its first caller and would not know it.
 *
 * So the decision that retired the variant leaves an INSTRUMENT behind: a
 * member with no caller is a failing test, not a memo. WIRE it or DELETE it.
 *
 * Membership is DISCOVERED — the union's members are read out of the shell's own
 * source, and the population out of the shared `_dialog-sites` walk — so a
 * fourth variant, or a dialog added tomorrow, is covered by existing. The
 * allowlist is EMPTY and stays that way: there is no true statement of the form
 * "this variant is part of the taxonomy but nothing may call it".
 *
 * ## Stated scope, and what was measured rather than assumed
 *
 * This asks about the VARIANT union only, not about every prop of the shell.
 * The prop-level question was measured before it was declined: of the twelve
 * members of `SystemDialogProps`, exactly one (`describedBy`, the
 * `aria-describedby` counterpart of `labelledBy`) has no production caller
 * today. That is an a11y counterpart mandated by the ARIA pattern rather than a
 * positioning capability someone might reach for, so requiring a caller there
 * would ship a guard with an exemption on day one — which is the shape this
 * repo's own rule about exemptions is against. Recorded here so the next reader
 * knows the question was asked and answered, not skipped.
 *
 * The sibling unions of this component family were measured too and are all
 * fully called (`ButtonVariant` 5/5, `SystemDialogSize` 5/5), so the phenomenon
 * was specific to this union rather than general — which is why this census is
 * scoped to it instead of sweeping every string-literal union in the tree.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { commentsStripped } from "@/lib/__tests__/_source-scan";
import { dialogElements, SRC_ROOT, type DialogSite } from "./_dialog-sites";

const SHELL_SRC = readFileSync(
  join(SRC_ROOT, "components/system-dialog.tsx"),
  "utf8",
);

/** The union's members, read out of the shell rather than restated here. */
function declaredVariants(): string[] {
  const m = /export type SystemDialogVariant\s*=\s*([^;]+);/.exec(SHELL_SRC);
  if (!m) throw new Error("SystemDialogVariant declaration not found");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/**
 * The member a caller gets by writing no `variant` at all — read out of the
 * shell's own destructuring default. Without this the census would indict
 * `"modal"`, which every unadorned `<SystemDialog>` in the app is.
 */
function defaultVariant(): string {
  const m = /variant\s*=\s*"([^"]+)",/.exec(SHELL_SRC);
  if (!m) throw new Error("SystemDialog variant default not found");
  return m[1];
}

/**
 * What variant does this element ask for?
 *   - a string literal → that member
 *   - no `variant` attribute at all → the shell's default
 *   - anything else (`variant={someExpr}`) → `null`, i.e. UNRESOLVABLE
 *
 * Unresolvable fails CLOSED (its own leg, expected empty) rather than being
 * waved through: a site the census cannot read is a site that can silently
 * become the last caller of a member, which is the whole failure being closed.
 * No production site is dynamic today; if a real one ever needs to be, that is
 * a decision to take deliberately, not one a regex should make.
 */
function variantOf(site: DialogSite): string | null {
  if (!/\bvariant\b\s*=/.test(site.tag)) return defaultVariant();
  const m = /\bvariant\s*=\s*\{?"([^"]+)"\}?/.exec(site.tag);
  return m ? m[1] : null;
}

describe("SystemDialog positioning taxonomy — every variant has a caller", () => {
  const sites = dialogElements();
  const variants = declaredVariants();

  it("the census finds the real dialog sites (it is not scanning nothing)", () => {
    const rels = sites.map((s) => s.rel);
    expect(sites.length).toBeGreaterThan(10);
    expect(rels).toContain("components/ConfirmDialog.tsx");
    expect(rels).toContain("components/PreferencesModal.tsx");
    // Per ELEMENT, not per file — ManageStylesModal hosts several.
    expect(sites.length).toBeGreaterThan(new Set(rels).size);
  });

  it("the union is read from the shell, and has members", () => {
    expect(variants.length).toBeGreaterThan(0);
    expect(variants).toContain(defaultVariant());
  });

  it("every declared variant is spelled by at least one production caller", () => {
    const called = new Set(
      sites.map(variantOf).filter((v): v is string => v !== null),
    );
    const orphaned = variants.filter((v) => !called.has(v));
    expect(orphaned).toEqual([]);
  });

  it("no production caller picks its variant dynamically (the census can read every site)", () => {
    const unresolvable = sites.filter((s) => variantOf(s) === null).map((s) => s.rel);
    expect(unresolvable).toEqual([]);
  });

  it("the RETIRED anchored capability stays retired in production source", () => {
    // `variant="anchored"` cannot come back silently — it would not typecheck.
    // `outsideClickGuard` and the `at` prop can: they are ordinary optional
    // members of the shell's own interface, so re-adding either type-checks,
    // renders, and is invisible to every behavioural test of the dialog. Read
    // COMMENT-STRIPPED, because this repo renegotiates a retired claim in place
    // with the reason at the site — the docblock that explains the deletion
    // names both, and a raw-source needle would outlaw the very prose the fix
    // is made of.
    const code = commentsStripped(SHELL_SRC);
    expect(code).not.toMatch(/outsideClickGuard/);
    expect(code).not.toMatch(/\bat\?:\s*\{\s*x:/);
    expect(code).not.toMatch(/anchoredPos/);
  });

  it("CANARY: an orphaned member is flagged", () => {
    const called = new Set(["modal", "draggable"]);
    const pretend = ["modal", "draggable", "anchored"];
    expect(pretend.filter((v) => !called.has(v))).toEqual(["anchored"]);
  });

  it("CANARY: an unadorned <SystemDialog> counts as a caller of the DEFAULT", () => {
    const bare: DialogSite = { rel: "x.tsx", tag: "<SystemDialog open onClose={c}>", subtree: "" };
    expect(variantOf(bare)).toBe(defaultVariant());
  });

  it("CANARY: both literal spellings resolve, and a dynamic one does not", () => {
    const mk = (tag: string): DialogSite => ({ rel: "x.tsx", tag, subtree: "" });
    expect(variantOf(mk('<SystemDialog open variant="draggable">'))).toBe("draggable");
    expect(variantOf(mk('<SystemDialog open variant={"draggable"}>'))).toBe("draggable");
    expect(variantOf(mk("<SystemDialog open variant={mode}>"))).toBeNull();
  });

  it("CANARY: a variant named only in PROSE is not a caller", () => {
    // The population is comments-stripped, so a mention in a comment cannot
    // keep a dead member alive.
    const stripped = commentsStripped(
      `// <SystemDialog variant="anchored"> would go here.\nconst x = 1;`,
    );
    expect(stripped).not.toMatch(/anchored/);
  });
});
