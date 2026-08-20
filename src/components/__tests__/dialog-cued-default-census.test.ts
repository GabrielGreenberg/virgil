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
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { codeOnly, elementsNamed } from "@/lib/__tests__/_source-scan";

const ROOT = join(__dirname, "..", "..");

/** The shell itself DEFINES the primitives; it declares nothing. */
const SHELL = ["components/system-dialog.tsx"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

interface FooteredDialog {
  rel: string;
  src: string;
}

/** Every production file that RENDERS a dialog footer. */
function footeredDialogs(): FooteredDialog[] {
  const out: FooteredDialog[] = [];
  for (const abs of walk(ROOT)) {
    const rel = abs.slice(ROOT.length + 1).replace(/\\/g, "/");
    if (SHELL.includes(rel)) continue;
    const src = codeOnly(readFileSync(abs, "utf8"));
    if (elementsNamed(src, "SystemDialogFooter").length === 0) continue;
    out.push({ rel, src });
  }
  return out;
}

/** Does this file register a cued default — an `autoFocus` SystemDialogButton? */
function declaresCue(src: string): boolean {
  return elementsNamed(src, "SystemDialogButton").some((h) =>
    /\bautoFocus\b/.test(h.tag),
  );
}

/** Does this file declare that it deliberately cues nothing? */
function declaresNone(src: string): boolean {
  return elementsNamed(src, "SystemDialog").some((h) =>
    /\bnoCuedDefault\b/.test(h.tag),
  );
}

describe("every footered SystemDialog declares its cued default", () => {
  const dialogs = footeredDialogs();

  it("the census finds the real dialog components (it is not scanning nothing)", () => {
    const rels = dialogs.map((d) => d.rel);
    expect(rels).toContain("components/ConfirmDialog.tsx");
    expect(rels).toContain("components/system-dialog-host.tsx");
    expect(rels).toContain("components/ManageStylesModal.tsx");
    expect(rels).toContain("components/TexFilePickerModal.tsx");
    expect(rels.length).toBeGreaterThanOrEqual(10);
  });

  it("each one either registers a cue or declares none", () => {
    const undeclared = dialogs
      .filter((d) => !declaresCue(d.src) && !declaresNone(d.src))
      .map((d) => d.rel);
    expect(undeclared).toEqual([]);
  });

  it("the two DELIBERATE no-cue shapes say so out loud", () => {
    const byRel = new Map(dialogs.map((d) => [d.rel, d.src]));
    // A picker whose answers are its body rows — Return must not mean "Cancel".
    expect(declaresNone(byRel.get("components/TexFilePickerModal.tsx")!)).toBe(true);
    // A single-button danger notice (task 386) — conditional, off the one SSOT.
    expect(declaresNone(byRel.get("components/ConfirmDialog.tsx")!)).toBe(true);
  });

  it("the library silo hosts no dialogs of its own (the walk is complete)", () => {
    // The census walks `src/` only. That is exhaustive TODAY because `library/`
    // imports the shell nowhere — pinned here rather than assumed, so a Library
    // dialog added later fails this instead of silently escaping the rule.
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

  it("CANARY: a footer with neither a cue nor a declaration is flagged", () => {
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
    expect(elementsNamed(bad, "SystemDialogFooter").length).toBe(1);
    expect(declaresCue(bad)).toBe(false);
    expect(declaresNone(bad)).toBe(false);
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
    const stripped = codeOnly(commentOnly);
    expect(declaresCue(stripped)).toBe(false);
    expect(declaresNone(stripped)).toBe(false);
  });
});
