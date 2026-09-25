/**
 * Task 530 — **a dialog that can hold a DRAFT states what a dismissal costs.**
 *
 * `SystemDialog` has always owned every dismiss TRIGGER — Escape, the backdrop
 * click, the scrimless outside-mousedown. Nothing owned what a dismissal COSTS,
 * so each dialog answered privately and the one holding real typed work
 * answered wrongly: `StyleEditorModal` had no dirty check anywhere in the file,
 * so a stray click outside its box discarded an edited LaTeX preamble with no
 * warning and no way back.
 *
 * The shell takes the missing half as a DECLARATION — `dismissGuard`, the twin
 * of `noCuedDefault` — and this census is what keeps the next such dialog from
 * shipping silent. The guard was never the part that could misbehave: a dialog
 * that hosts a field and declares nothing is, and it type-checks and renders
 * perfectly.
 *
 * **Membership is DISCOVERED, and by the QUESTION rather than by a mechanism**
 * (task 404's rule). A subtree-only needle is blind to `PreferencesModal`,
 * whose every field is composed by `PresetBar` / `PreferenceTree` /
 * `SmartPreferences` — so `draftHoldingDialogs()` resolves ONE level down.
 * Over-collection is the safe direction: an extra member costs one
 * `dismissIsFree` line, a missed one costs a silent draft loss.
 *
 * Both allowlists are EMPTY. A hit is DECLARE-it: either the dismissal has a
 * cost (supply a guard) or it does not (say so), and there is no third answer
 * a dialog holding a text field is entitled to give.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { commentsStripped, elementsNamed } from "@/lib/__tests__/_source-scan";
import {
  dialogElements,
  draftHoldingDialogs,
  hostsTextEntry,
  SRC_ROOT as ROOT,
} from "./_dialog-sites";

/** Does this dialog supply a guard — the "a dismissal costs something" half? */
function declaresGuard(tag: string): boolean {
  return /\bdismissGuard=/.test(tag);
}

/**
 * Does this dialog declare that a dismissal costs NOTHING?
 *
 * `dismissIsFree={false}` is NOT a declaration — it is the default spelled out,
 * so accepting it would let the prop's mere presence satisfy the rule. Same
 * reading `noCuedDefault` takes one census over.
 */
function declaresFree(tag: string): boolean {
  if (!/\bdismissIsFree\b/.test(tag)) return false;
  return !/\bdismissIsFree=\{false\}/.test(tag);
}

describe("every draft-holding dialog declares what a dismissal costs", () => {
  const drafts = draftHoldingDialogs();

  it("the census finds the real draft-holding dialogs (it is not scanning nothing)", () => {
    const rels = drafts.map((d) => d.rel);
    // The one at risk — a full CodeMirror LaTeX editor, conditionally mounted.
    expect(rels).toContain("components/StyleEditorModal.tsx");
    // Long-form prose, protected by the always-mounted `open`-prop shape.
    expect(rels).toContain("components/BugReportWindow.tsx");
    expect(rels).toContain("components/AIWindow.tsx");
    // Short drafts, each free for its own reason.
    expect(rels).toContain("components/NewDocumentModal.tsx");
    expect(rels).toContain("components/CollaboratorIdentityDialog.tsx");
    expect(rels).toContain("components/ManageStylesModal.tsx");
    // Composed fields — the member a subtree-only needle cannot see.
    expect(rels).toContain("components/PreferencesModal.tsx");
    // And the imperative host's `prompt` arm.
    expect(rels).toContain("components/system-dialog-host.tsx");
  });

  it("a dialog with NO field is out of the population", () => {
    const rels = new Set(drafts.map((d) => d.rel));
    // A confirm's only `<input>` is a checkbox; a picker's is a `Select`.
    expect(rels.has("components/DocTypeChangeDialog.tsx")).toBe(false);
    expect(rels.has("components/StyleApplyDialog.tsx")).toBe(false);
    expect(rels.has("components/PrintDialog.tsx")).toBe(false);
    expect(rels.has("components/TexFilePickerModal.tsx")).toBe(false);
    expect(rels.has("components/DocumentClassMismatchDialog.tsx")).toBe(false);
    // The population is a strict subset of every dialog.
    expect(drafts.length).toBeLessThan(dialogElements().length);
  });

  it("each one either guards its dismissal or declares it free", () => {
    const undeclared = drafts
      .filter((d) => !declaresGuard(d.tag) && !declaresFree(d.tag))
      .map((d) => d.rel);
    expect(undeclared).toEqual([]);
  });

  it("the one dialog whose draft is the only copy of real work GUARDS", () => {
    const guarded = drafts.filter((d) => declaresGuard(d.tag)).map((d) => d.rel);
    expect(guarded).toContain("components/StyleEditorModal.tsx");
  });

  it("a dialog never declares BOTH (the shell console.errors on that too)", () => {
    const both = drafts
      .filter((d) => declaresGuard(d.tag) && declaresFree(d.tag))
      .map((d) => d.rel);
    expect(both).toEqual([]);
  });

  it("the shell offers both halves of the declaration in the first place", () => {
    const shell = readFileSync(
      join(ROOT, "components/system-dialog.tsx"),
      "utf8",
    );
    expect(shell).toMatch(/dismissGuard\?: DismissGuard;/);
    expect(shell).toMatch(/dismissIsFree\?: boolean;/);
  });

  it("every dismiss path enters the ONE door", () => {
    const shell = commentsStripped(
      readFileSync(join(ROOT, "components/system-dialog.tsx"), "utf8"),
    );
    // Escape and the scrimless outside-mousedown call it; the modal backdrop
    // hands it to `useBackdropPress`, which calls it for a whole press on the
    // scrim (task 763).
    expect(shell.match(/requestDismiss\(\)/g)?.length ?? 0).toBe(2);
    expect(shell).toMatch(/useBackdropPress\(requestDismiss\)/);
    // And the door is the only thing that reaches `onClose` for a dismissal:
    // the pre-530 paths called it directly, which is exactly the shape that
    // let one path be guarded and another not.
    expect(shell).not.toMatch(/e\.preventDefault\(\);\s*onClose\(\);/);
  });

  it("CANARY: a dialog with a field and no declaration is flagged", () => {
    const bad = `
      export function Bad() {
        return (
          <SystemDialog open onClose={close}>
            <SystemDialogBody>
              <Input value={v} onChange={f} />
            </SystemDialogBody>
          </SystemDialog>
        );
      }`;
    const [hit] = elementsNamed(bad, "SystemDialog");
    expect(hostsTextEntry(hit.subtree ?? "")).toBe(true);
    expect(declaresGuard(hit.tag)).toBe(false);
    expect(declaresFree(hit.tag)).toBe(false);
  });

  it("CANARY: `dismissIsFree={false}` is the default spelled out, not a declaration", () => {
    const [hit] = elementsNamed(
      `<SystemDialog open dismissIsFree={false}></SystemDialog>`,
      "SystemDialog",
    );
    expect(declaresFree(hit.tag)).toBe(false);
  });

  it("CANARY: a checkbox or a radio is a switch, not a draft", () => {
    expect(hostsTextEntry(`<input type="checkbox" checked={x} />`)).toBe(false);
    expect(hostsTextEntry(`<input type="radio" name="n" />`)).toBe(false);
    expect(hostsTextEntry(`<input type="text" value={v} />`)).toBe(true);
    expect(hostsTextEntry(`<Textarea value={v} />`)).toBe(true);
  });

  it("CANARY: an always-mounted file is recognized by its own hide door", () => {
    expect(hidesWithoutUnmounting(`  if (!open) return null;`)).toBe(true);
    // A conditional mount answers the question elsewhere — its state dies with
    // it, so there is no second group to clear.
    expect(hidesWithoutUnmounting(`  return open ? <Dialog /> : null;`)).toBe(false);
  });

  it("CANARY: a declaration mentioned only in PROSE does not count", () => {
    const commentOnly = `
      // dismissIsFree would be the declaration here.
      /** A dismissGuard={fn} is what a draft-holding dialog supplies. */
      export function Prose() {
        return (
          <SystemDialog open onClose={close}>
            <Input value={v} onChange={f} />
          </SystemDialog>
        );
      }`;
    const [hit] = elementsNamed(commentsStripped(commentOnly), "SystemDialog");
    expect(declaresGuard(hit.tag)).toBe(false);
    expect(declaresFree(hit.tag)).toBe(false);
  });
});

/* ── Task 631: the ALWAYS-MOUNTED members answer the SECOND question ──── */

/**
 * Does this file hide its dialog WITHOUT unmounting it — the `open`-prop shape,
 * an early `return null` above the frame?
 *
 * That shape is what makes `dismissIsFree` a claim with two halves. A
 * conditionally-mounted dialog's state dies with it, so "free" can only mean
 * the draft is held somewhere else; an always-mounted one keeps EVERYTHING,
 * including the things that report a past moment — a terminal confirmation
 * pane, an error string — which a dismissal must end.
 */
function hidesWithoutUnmounting(src: string): boolean {
  return /if\s*\(\s*!open\s*\)\s*return null\s*;/.test(src);
}

function alwaysMountedDrafts(): string[] {
  const rels = new Set(draftHoldingDialogs().map((d) => d.rel));
  return [...rels]
    .filter((rel) =>
      hidesWithoutUnmounting(
        commentsStripped(readFileSync(join(ROOT, rel), "utf8")),
      ),
    )
    .sort();
}

describe("an always-mounted dialog declares BOTH halves of a free dismissal", () => {
  /**
   * The population is PINNED, and that is the point of the leg rather than a
   * convenience. A third always-mounted window is a decision — which of its
   * state is the draft `dismissIsFree` promises to keep, and which of it merely
   * reports what the window last DID — and the only way a census can force that
   * decision is to fail when the set changes.
   */
  it("exactly two dialogs hide without unmounting", () => {
    expect(alwaysMountedDrafts()).toEqual([
      "components/AIWindow.tsx",
      "components/BugReportWindow.tsx",
    ]);
  });

  it("the shell publishes the door that clears the transient half", () => {
    const shell = readFileSync(join(ROOT, "components/system-dialog.tsx"), "utf8");
    expect(shell).toMatch(/export function useClearedOnDismiss\(/);
  });

  /**
   * `BugReportWindow` is the member with a transient group: a `phase` that ends
   * on a terminal "Report written" pane, an `error`, the last send's folder
   * name. Before task 631 it cleared none of them, so a close-and-reopen
   * replayed the previous send's confirmation instead of a compose form.
   *
   * `AIWindow` is deliberately absent: its composer's text IS the draft, and
   * `composerOpen`/`composerKind` are how that draft stays reachable on reopen
   * — clearing them would hide typed work behind a collapsed composer. A member
   * with nothing transient declares that by never calling the door, which is
   * why this leg names the file rather than quantifying over the population.
   */
  it("the member with a terminal pane routes it through that ONE door", () => {
    const src = commentsStripped(
      readFileSync(join(ROOT, "components/BugReportWindow.tsx"), "utf8"),
    );
    expect(src).toMatch(/useClearedOnDismiss\(\s*open\s*,/);
    // And the folder hook it composes clears its own transient error the same
    // way, rather than hand-rolling a second `!open` effect beside it.
    const hook = commentsStripped(
      readFileSync(join(ROOT, "hooks/useBugReportFolder.ts"), "utf8"),
    );
    expect(hook).toMatch(/useClearedOnDismiss\(\s*open\s*,/);
  });
});
