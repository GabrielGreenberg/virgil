/**
 * Task 389 — **every footered dialog DECLARES its cued default.**
 *
 * The shell now states one keyboard rule for every dialog: `Enter` activates the
 * registered cued default whatever holds focus. That rule is only as good as the
 * REGISTRATION — a dialog with a footer and no `autoFocus` button has a `Return`
 * key that does nothing, which is the pre-389 symptom arriving by a different
 * route. And "no cue" is ambiguous by itself: a single-button DANGER notice
 * cues nothing ON PURPOSE (task 386 — cueing the only button would arm the
 * destructive action under an already-moving hand), and so does a picker whose
 * real answers live in its BODY. So the shell takes a `noCuedDefault`
 * DECLARATION and this census requires one or the other.
 *
 * The policy and the shell were never the parts that could misbehave — a dialog
 * that ships a footer and forgets to cue anything is, and that type-checks
 * perfectly. So membership is DISCOVERED from the tree (every production file
 * that renders a `<SystemDialogFooter>`), never hand-listed: a dialog added
 * tomorrow is covered by existing.
 *
 * Stated limit: this asks whether a cue is DECLARED, not whether at most one can
 * be live at a time. `ConfirmDialog` renders three mutually-exclusive
 * `autoFocus={cuedDefault === …}` buttons off one `confirmDialogCuedDefault()`
 * call — exclusivity is a property of that SSOT, and a source census cannot
 * prove it. What it can prove, and does, is that nobody ships a footer with no
 * answer at all.
 *
 * **And since task 528 it asks a SECOND question of the same tree: is the
 * declared cue SAFE?** The header used to say — correctly, and this is the gap
 * it named rather than a renegotiation — that DECLARED was the only question
 * here. So `system-dialog-host.tsx` sat in this population and PASSED with a
 * bare `autoFocus` on the button that runs the destruction, for as long as that
 * door has existed: a `tone: "danger"` confirm opened with **Reset** focused and
 * `Enter` wiped the example document. A cue that is declared and destructive is
 * worse than none, so the two questions ship together.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { commentsStripped, elementsNamed } from "@/lib/__tests__/_source-scan";
import {
  canRenderDanger,
  dialogButtonElements,
  dialogElements,
  hasBareAutoFocus,
  variantAttr,
  walk,
  SRC_ROOT as ROOT,
  type DialogSite,
} from "./_dialog-sites";

/**
 * Every production `<SystemDialog>` that must declare an answer for `Enter`:
 * one with a FOOTER (its buttons are the answers), or a MODAL one (which owns
 * the keyboard and swallows an out-of-frame Enter whether or not it has a cue,
 * so the swallow must be deliberate).
 *
 * A FILTER over the shared population (`_dialog-sites.ts`), never a second walk
 * — the variant census asks a different question of the same set, and two
 * enumerations of "who the dialog sites are" is how one guard comes to be
 * scanning a set the other no longer is.
 *
 * The scrimless needle names `draggable` alone since task 515 retired the only
 * other member; a third one is added to the union and to this line together, and
 * `system-dialog-variants-census.test.ts` is what makes the union side of that
 * pair impossible to skip.
 */
function dialogSites(): DialogSite[] {
  return dialogElements().filter(({ tag, subtree }) => {
    const scrimless = /variant=\{?"draggable"/.test(tag);
    const footered = elementsNamed(subtree, "SystemDialogFooter").length > 0;
    return footered || !scrimless;
  });
}

/** Does this dialog register a cued default — an `autoFocus` SystemDialogButton? */
function declaresCue(subtree: string): boolean {
  return elementsNamed(subtree, "SystemDialogButton").some((h) =>
    /\bautoFocus\b/.test(h.tag),
  );
}

/**
 * Does this dialog declare that it deliberately cues nothing?
 *
 * `noCuedDefault={false}` is NOT a declaration — it is the default spelled out,
 * so accepting it would let the prop's mere presence satisfy the rule.
 */
function declaresNone(tag: string): boolean {
  if (!/\bnoCuedDefault\b/.test(tag)) return false;
  return !/\bnoCuedDefault=\{false\}/.test(tag);
}

describe("every SystemDialog that owns Enter declares its cued default", () => {
  const dialogs = dialogSites();

  it("the census finds the real dialog sites (it is not scanning nothing)", () => {
    const rels = dialogs.map((d) => d.rel);
    expect(rels).toContain("components/ConfirmDialog.tsx");
    expect(rels).toContain("components/system-dialog-host.tsx");
    expect(rels).toContain("components/ManageStylesModal.tsx");
    expect(rels).toContain("components/TexFilePickerModal.tsx");
    // A MODAL with no footer is in scope too — it swallows an out-of-frame
    // Enter, so the swallow has to be deliberate.
    expect(rels).toContain("components/AIWindow.tsx");
    // ManageStylesModal renders ONE dialog and hosts three more; enumerating per
    // element rather than per file is what keeps a sibling from excusing it.
    expect(dialogs.length).toBeGreaterThan(new Set(rels).size);
  });

  it("each one either registers a cue or declares none", () => {
    const undeclared = dialogs
      .filter((d) => !declaresCue(d.subtree) && !declaresNone(d.tag))
      .map((d) => d.rel);
    expect(undeclared).toEqual([]);
  });

  it("the DELIBERATE no-cue shapes say so out loud", () => {
    const none = dialogs.filter((d) => declaresNone(d.tag)).map((d) => d.rel);
    // A picker whose answers are its body rows — Return must not mean "Cancel".
    expect(none).toContain("components/TexFilePickerModal.tsx");
    // A single-button danger notice (task 386) — conditional, off the one SSOT.
    expect(none).toContain("components/ConfirmDialog.tsx");
    // A modal whose actions live in its body, not a footer.
    expect(none).toContain("components/AIWindow.tsx");
  });

  it("the library silo hosts no dialogs of its own (the walk is complete)", () => {
    const lib = join(ROOT, "..", "library");
    const offenders = walk(lib)
      .filter((abs) => /SystemDialog/.test(readFileSync(abs, "utf8")))
      .map((abs) => abs.slice(lib.length + 1));
    expect(offenders).toEqual([]);
  });

  it("the shell offers the declaration in the first place", () => {
    const shell = readFileSync(join(ROOT, "components/system-dialog.tsx"), "utf8");
    expect(shell).toMatch(/noCuedDefault\?: boolean;/);
  });

  it("CANARY: a dialog with neither a cue nor a declaration is flagged", () => {
    const bad = `
      export function Bad() {
        return (
          <SystemDialog open onClose={close}>
            <SystemDialogFooter>
              <SystemDialogButton onClick={a}>Cancel</SystemDialogButton>
              <SystemDialogButton variant="primary" onClick={b}>Go</SystemDialogButton>
            </SystemDialogFooter>
          </SystemDialog>
        );
      }`;
    const [hit] = elementsNamed(bad, "SystemDialog");
    expect(declaresCue(hit.subtree ?? "")).toBe(false);
    expect(declaresNone(hit.tag)).toBe(false);
  });

  it("CANARY: `noCuedDefault={false}` is the default spelled out, not a declaration", () => {
    const [hit] = elementsNamed(
      `<SystemDialog open noCuedDefault={false}></SystemDialog>`,
      "SystemDialog",
    );
    expect(declaresNone(hit.tag)).toBe(false);
  });

  it("CANARY: a cue mentioned only in PROSE does not count", () => {
    const commentOnly = `
      // <SystemDialogButton autoFocus> would be the cue here.
      /** noCuedDefault is what a picker declares. */
      export function Prose() {
        return (
          <SystemDialog open onClose={close}>
            <SystemDialogFooter>
              <SystemDialogButton onClick={a}>Cancel</SystemDialogButton>
            </SystemDialogFooter>
          </SystemDialog>
        );
      }`;
    const stripped = commentsStripped(commentOnly);
    const [hit] = elementsNamed(stripped, "SystemDialog");
    expect(declaresCue(hit.subtree ?? "")).toBe(false);
    expect(declaresNone(hit.tag)).toBe(false);
  });
});

/**
 * The SAFE half (task 528) — **a button that can render DESTRUCTIVE may never be
 * the unconditional cue.**
 *
 * `autoFocus` marks the cued default, so a bare one on a red button hands the
 * destruction to `Enter` under a hand that is already moving (task 386). The
 * rule is checkable at SOURCE in exactly one direction: whether the cue is
 * DERIVED. Whether the derivation is *correct* is a property of
 * `confirmDialogCuedDefault`, which the behavioural legs in
 * `dialog-enter-contract.test.tsx` drive for both doors.
 *
 * Both allowlists are EMPTY. A hit is DERIVE-it, never an entry: there is no
 * true statement of the form "this button destroys and must nonetheless be
 * cued unconditionally".
 */
describe("no destructive dialog button is the unconditional cue", () => {
  const buttons = dialogButtonElements();
  const dangerous = buttons.filter((b) => canRenderDanger(b.tag));

  it("the census finds the real danger-capable buttons (it is not scanning nothing)", () => {
    const rels = dangerous.map((b) => b.rel);
    // DERIVED — `confirmActionVariant(tone)`; an expression is danger-capable
    // by the fail-closed rule, which is what keeps these two in scope after the
    // hand-spelled ternary they used to carry is gone.
    expect(rels).toContain("components/ConfirmDialog.tsx");
    expect(rels).toContain("components/system-dialog-host.tsx");
    // LITERAL `variant="danger"` — statically destructive buttons, the
    // strongest members: none of them may ever be cued.
    expect(rels).toContain("components/StyleApplyDialog.tsx");
    expect(rels).toContain("components/DocTypeChangeDialog.tsx");
    expect(rels).toContain("components/ManageStylesModal.tsx");
    // The population is the WHOLE button tree, so the safe majority is in it too.
    expect(buttons.length).toBeGreaterThan(dangerous.length);
  });

  it("none of them carries a BARE autoFocus", () => {
    const armed = dangerous
      .filter((b) => hasBareAutoFocus(b.tag))
      .map((b) => b.rel);
    expect(armed).toEqual([]);
  });

  it("nobody hand-spells the tone→variant map — it comes from the policy leaf", () => {
    const handRolled = buttons
      .filter((b) => {
        const v = variantAttr(b.tag);
        return !!v && "expr" in v && /\bdanger\b/.test(v.expr);
      })
      .map((b) => b.rel);
    // The fork task 528 closed was TWO attributes wide, not one: both doors
    // hand-derived the cue AND hand-spelled `tone === "danger" ? "danger" : …`
    // four lines apart. Unifying only the cue would have left the same disease
    // live one prop over.
    expect(handRolled).toEqual([]);
  });

  it("an alert's SOLE dismiss button is never painted destructive", () => {
    // Its tone describes the MESSAGE; red is a claim about the AFFORDANCE, and
    // this button commits nothing. Spelled as a LITERAL at its site precisely
    // so there is no derivation to get backwards.
    const host = readFileSync(join(ROOT, "components/system-dialog-host.tsx"), "utf8");
    const alertBranch = host.slice(
      host.indexOf('if (pending.kind === "alert")'),
      host.indexOf('if (pending.kind === "confirm")'),
    );
    expect(alertBranch).not.toHaveLength(0);
    expect(alertBranch).toContain('variant="primary"');
    expect(alertBranch).not.toMatch(/variant=\{/);
  });

  it("the policy leaf is import-free, so BOTH doors can read it", () => {
    // The placement rule `latex-markers.ts` earned: a facet the layer that
    // needs it cannot import will be re-copied — which is exactly what the host
    // did with both halves of this policy.
    const leaf = readFileSync(join(ROOT, "components/confirm-cue-policy.ts"), "utf8");
    expect(leaf).not.toMatch(/^\s*import\s/m);
    expect(leaf).toMatch(/export function confirmDialogCuedDefault\(/);
    expect(leaf).toMatch(/export function confirmActionVariant\(/);
  });

  it("CANARY: a bare autoFocus on a literal danger button is flagged", () => {
    const bad = `<SystemDialogButton variant="danger" autoFocus onClick={boom}>Delete</SystemDialogButton>`;
    expect(canRenderDanger(bad)).toBe(true);
    expect(hasBareAutoFocus(bad)).toBe(true);
  });

  it("CANARY: a bare autoFocus on a DERIVED variant is flagged too", () => {
    // The pre-528 host spelling, verbatim. It reads as ordinary code and is
    // what shipped.
    const bad = `<SystemDialogButton
            variant={tone === "danger" ? "danger" : "primary"}
            autoFocus
            onClick={() => done(true)}
          >`;
    expect(canRenderDanger(bad)).toBe(true);
    expect(hasBareAutoFocus(bad)).toBe(true);
    const v = variantAttr(bad);
    expect(v && "expr" in v && /danger/.test(v.expr)).toBe(true);
  });

  it("CANARY: a DERIVED autoFocus on a danger button passes, and a safe literal is out of scope", () => {
    const derived = `<SystemDialogButton variant={confirmActionVariant(tone)} autoFocus={cuedDefault === "confirm"} onClick={ok}>`;
    expect(canRenderDanger(derived)).toBe(true);
    expect(hasBareAutoFocus(derived)).toBe(false);

    const safe = `<SystemDialogButton variant="primary" autoFocus onClick={ok}>`;
    expect(canRenderDanger(safe)).toBe(false);

    const bare = `<SystemDialogButton onClick={ok}>`;
    expect(canRenderDanger(bare)).toBe(false);
  });

  it("CANARY: a nested-brace variant expression is read WHOLE", () => {
    // `[^}]*` truncates at the first `}` and stops seeing the word — failing
    // OPEN, which for a census is the direction that costs.
    const nested = `<SystemDialogButton variant={pick({ tone }) === "x" ? "danger" : "primary"} onClick={ok}>`;
    const v = variantAttr(nested);
    expect(v && "expr" in v && /danger/.test(v.expr)).toBe(true);
    expect(canRenderDanger(nested)).toBe(true);
  });
});
