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
    // Escape, the scrimless outside-mousedown, and the modal backdrop.
    expect(shell.match(/requestDismiss\(\)/g)?.length ?? 0).toBe(3);
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
