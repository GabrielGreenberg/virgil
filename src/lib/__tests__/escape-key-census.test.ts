// Task 1448 — **Escape has ONE spelling app-wide: `isCancelEscape`
// (src/lib/key-intent.ts), and every Escape door says what it does with a
// held key's auto-repeat.**
//
// Task 1188 gave Escape one spelling inside the MENU doors (pinned by
// `menu-key-intent-census.test.ts`) and named the rest as an unminted
// follow-up: ~25 bare `key === "Escape"` gates outside that population. The
// costliest were the two DIALOG doors (`SystemDialog`'s bubble listener and
// `useNonModalDialogKeys`), which hold drafts:
//
//   - an Escape pressed mid-composition (which cancels the IME's candidate
//     text) closed the whole dialog;
//   - a HELD Escape over a stacked pair closed the top dialog, the stack
//     popped, and the next auto-repeat closed the dialog beneath — one
//     gesture, two dialogs, the outcome the stack exists to prevent.
//
// This census widens 1188's rule to every production file in both silos
// (modelled on `enter-key-census.test.ts`, task 1165), and adds the repeat
// half: a file with an Escape door either asks `e.repeat` or is listed in
// REPEAT_LEDGER with the reason its repeats are harmless.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { REPO_ROOT, strip, walkFiles } from "./_source-scan";

/** A key/code compared to Escape, in any of the spellings JS allows. */
export const BARE_ESCAPE =
  /\b(?:key|code)\s*[!=]==?\s*["'`]Esc(?:ape)?["'`]|["'`]Esc(?:ape)?["'`]\s*[!=]==?\s*[\w.]*\b(?:key|code)\b|\bcase\s*["'`]Esc(?:ape)?["'`]\s*:/;

const OWNER = "src/lib/key-intent.ts";

const FIELD =
  "inline-field cancel: the first press reverts and leaves edit mode; a repeat falls to the enclosing door (dialog / margin edit / menu), which gates it";
const GESTURE =
  "pointer-gesture cancel: the first press ends the gesture and removes this listener";
const MENU = "menu-door population: repeat is answered by useMenuDismiss (task 1188)";

/**
 * Files whose Escape door does not ask `e.repeat`, each with the reason that is
 * safe. A file that starts asking `.repeat` must leave this list (stale-entry
 * leg); a NEW door that closes a surface holding a draft should gate repeat
 * (`if (e.repeat) return; swallowRepeatsUntilKeyup(e);`) rather than join it.
 */
const REPEAT_LEDGER: Record<string, string> = {
  "src/components/SizeStepper.tsx": FIELD,
  "src/components/FigureBlockNodeView.tsx": FIELD,
  "src/hooks/useLabelEditSession.ts": FIELD,
  "src/components/PanelTextSizeRow.tsx": FIELD,
  "src/components/SourcePodNodeView.tsx": FIELD,
  "src/hooks/useTabIndent.ts": FIELD,
  "library/components/BibCard.tsx": FIELD,
  "library/components/PagePicker.tsx": FIELD,
  "src/lib/tiptap/field-keys.ts": FIELD,
  "src/components/bib-review-request.tsx": FIELD,
  "src/components/InlineRenameInput.tsx": FIELD,
  "src/components/ManageStylesModal.tsx": FIELD,
  "src/panels/Outline/OutlinePanel.tsx": FIELD,
  "src/panels/Bibliography/BibliographyPanel.tsx": FIELD,
  "src/panels/Bibliography/bib-library-flow.tsx": FIELD,
  "src/text-objects/floats/float-title-field.tsx": FIELD,
  "src/panels/_shared/PanelGoalStrip.tsx": FIELD,
  "src/components/PreferencesModal.tsx": FIELD,
  "src/components/panel-primitives.tsx": FIELD,
  "src/panels/Citations/CitationCard.tsx": FIELD,
  "src/lib/pane-resize/use-pane-resize-handle.ts": GESTURE,
  "src/panels/Outline/focus-band-drag.ts": GESTURE,
  "src/components/FloatingPanel.tsx": GESTURE,
  "src/lib/pane-resize/pointer-invariants.ts": GESTURE,
  "src/text-objects/TextObjectGrabHandle.tsx": GESTURE,
  "src/components/drop-mode/pending-session.ts": GESTURE,
  "src/components/drop-mode/controller.ts": GESTURE,
  "src/components/HintLayer.tsx": "idempotent hide: a repeat hides an already-hidden hint",
  "src/components/library/BibEntryPickerMenu.tsx": MENU,
};

function productionFiles(): { rel: string; code: string }[] {
  return ["src", "library"].flatMap((root) =>
    walkFiles(path.join(REPO_ROOT, root), { skipDirs: ["__tests__"] })
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => ({
        rel: path.relative(REPO_ROOT, f),
        code: strip(readFileSync(f, "utf8"), true, true),
      })),
  );
}

function read(rel: string): string {
  return strip(readFileSync(path.join(REPO_ROOT, rel), "utf8"), true, true);
}

describe("Escape key CENSUS (task 1448)", () => {
  const files = productionFiles();

  it("no production file compares a key to Escape outside key-intent.ts", () => {
    const offenders: string[] = [];
    for (const { rel, code } of files) {
      if (rel === OWNER) continue;
      code.split("\n").forEach((line, i) => {
        if (BARE_ESCAPE.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(
      offenders,
      `Ask isCancelEscape(e) from @/lib/key-intent instead — a bare Escape gate cancels the surface with the Escape that only meant "cancel the IME composition":\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("every Escape door asks e.repeat or is in REPEAT_LEDGER with a reason", () => {
    const doors = files.filter(({ rel, code }) => rel !== OWNER && /\bisCancelEscape\(/.test(code));
    expect(doors.length, "population anchor").toBeGreaterThan(20);
    const unlisted = doors
      .filter(({ rel, code }) => !/\.repeat\b/.test(code) && !(rel in REPEAT_LEDGER))
      .map(({ rel }) => rel);
    expect(
      unlisted,
      `These Escape doors ignore auto-repeat. A door that closes a surface gates it (\`if (e.repeat) return; swallowRepeatsUntilKeyup(e);\`); a door whose repeats are harmless joins REPEAT_LEDGER with the reason:\n${unlisted.join("\n")}`,
    ).toEqual([]);
    const byRel = new Map(files.map((f) => [f.rel, f.code]));
    const stale = Object.keys(REPEAT_LEDGER).filter((rel) => {
      const code = byRel.get(rel);
      return code === undefined || !/\bisCancelEscape\(/.test(code) || /\.repeat\b/.test(code);
    });
    expect(stale, "stale REPEAT_LEDGER entries (file gone, no Escape door, or now repeat-gated)").toEqual([]);
  });

  it("both dialog doors are IME- and repeat-gated before they act", () => {
    const shell = read("src/components/system-dialog.tsx");
    const bubble = shell.slice(shell.indexOf("const onBubble"));
    const sd = bubble.slice(bubble.indexOf("isCancelEscape(e)"));
    expect(sd.length).toBeLessThan(bubble.length);
    const sdRepeat = sd.search(/if\s*\(\s*e\.repeat\s*\)/);
    expect(sdRepeat, "SystemDialog repeat gate").toBeGreaterThan(-1);
    expect(sd.indexOf("swallowRepeatsUntilKeyup(e)")).toBeGreaterThan(sdRepeat);
    expect(sd.indexOf("requestDismiss()")).toBeGreaterThan(sd.indexOf("swallowRepeatsUntilKeyup(e)"));

    const contract = read("src/components/dialog-contract.ts");
    const nm = contract.slice(contract.indexOf("!isCancelEscape(e)"));
    expect(nm.length).toBeLessThan(contract.length);
    const nmRepeat = nm.search(/if\s*\(\s*e\.repeat\s*\)\s*return/);
    expect(nmRepeat, "useNonModalDialogKeys repeat gate").toBeGreaterThan(-1);
    expect(nm.indexOf("swallowRepeatsUntilKeyup(e)")).toBeGreaterThan(nmRepeat);
    expect(nm.indexOf("onCancelRef.current()")).toBeGreaterThan(nm.indexOf("swallowRepeatsUntilKeyup(e)"));
  });

  it("the matcher catches every spelling (red leg)", () => {
    for (const bad of [
      `if (e.key === "Escape") go();`,
      `if (ev.key !== 'Escape') return;`,
      `if ("Escape" === e.key)`,
      `if (e.key === "Esc")`,
      `case "Escape":`,
    ]) expect(BARE_ESCAPE.test(bad), bad).toBe(true);
    for (const ok of [`if (isCancelEscape(e)) go();`, `<Kbd keys="Escape" />`, `esc: "Escape",`])
      expect(BARE_ESCAPE.test(ok), ok).toBe(false);
  });

  it("the owner still defines the one predicate", () => {
    expect(readFileSync(path.join(REPO_ROOT, OWNER), "utf8")).toMatch(/export function isCancelEscape\(/);
  });
});
