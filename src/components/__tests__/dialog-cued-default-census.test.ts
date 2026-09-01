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
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { commentsStripped, elementsNamed } from "@/lib/__tests__/_source-scan";
import {
  dialogElements,
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
