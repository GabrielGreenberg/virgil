// Task 1188 — every MENU key door asks key-intent (src/lib/key-intent.ts).
//
// Task 994 made key-intent the owner of "is this keydown a fresh, deliberate,
// non-IME press?", and task 1165 gave Enter one spelling (`isCommitEnter`,
// pinned app-wide by `enter-key-census.test.ts`). But the menu primitive had
// four doors that decided the question themselves, or lost the fields it reads:
//
//   1. the bib picker's external-input adapter rebuilt the native keydown as
//      `{ key, metaKey, … }` — no `isComposing` / `keyCode` / `repeat` — so an
//      IME candidate-pick Enter committed the entry;
//   2. `useMenuDismiss` acted on any `key === "Escape"` — a composing Escape
//      (which cancels the COMPOSITION) cancelled the menu instead;
//   3. …and on a repeating one — a held Escape closed a whole nested chain,
//      then leaked to app-level Escape handlers;
//   4. `useMenuCombobox` ran its horizontal override and `onNavigate` before
//      any IME check, and handed repeating Enters to the caller.
//
// This census is the leg that catches the NEXT one. Its population is DERIVED:
// every production file under `src/components/menu/` plus every file that
// imports the menu primitive.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { REPO_ROOT, strip, walkFiles } from "@/lib/__tests__/_source-scan";

/** A key/code compared to Escape, in any of the spellings JS allows. */
export const BARE_ESCAPE =
  /\b(?:key|code)\s*[!=]==?\s*["'`]Esc(?:ape)?["'`]|["'`]Esc(?:ape)?["'`]\s*[!=]==?\s*[\w.]*\b(?:key|code)\b|\bcase\s*["'`]Esc(?:ape)?["'`]\s*:/;

/** A keyboard event built by hand and cast — the shape that drops the fields
 *  key-intent reads (`isComposing`, `keyCode`, `repeat`). */
const COERCED_KEY_EVENT = /\bas\s+(?:unknown\s+as\s+)?(?:React\.)?KeyboardEvent\b/;

const IMPORTS_MENU =
  /from\s+["'](?:@\/components\/menu(?:\/[\w-]+)?|(?:\.{1,2}\/)+(?:[\w-]+\/)*menu(?:\/[\w-]+)?)["']/;

const MENU_DIR = "src/components/menu/";

function population(): { rel: string; code: string }[] {
  return walkFiles(path.join(REPO_ROOT, "src"), { skipDirs: ["__tests__"] })
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => {
      const rel = path.relative(REPO_ROOT, f);
      return { rel, raw: readFileSync(f, "utf8") };
    })
    .filter(({ rel, raw }) => rel.startsWith(MENU_DIR) || IMPORTS_MENU.test(raw))
    .map(({ rel, raw }) => ({ rel, code: strip(raw, true, true) }));
}

function read(rel: string): string {
  return strip(readFileSync(path.join(REPO_ROOT, rel), "utf8"), true, true);
}

describe("menu key-intent CENSUS (task 1188)", () => {
  const files = population();

  it("the population is derived and sees the known doors (anchor)", () => {
    const rels = files.map((f) => f.rel);
    for (const known of [
      "src/components/menu/useMenuDismiss.ts",
      "src/components/menu/useMenuCombobox.ts",
      "src/components/menu/useMenuKeyboard.ts",
      "src/components/LabelRefPopover.tsx",
      "src/components/library/BibEntryPickerMenu.tsx",
      "src/components/panel-primitives.tsx",
    ]) expect(rels, known).toContain(known);
    expect(rels.length).toBeGreaterThan(15);
  });

  it("no menu-door file compares a key to Escape — it asks isCancelEscape(e)", () => {
    const offenders: string[] = [];
    for (const { rel, code } of files) {
      code.split("\n").forEach((line, i) => {
        if (BARE_ESCAPE.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(
      offenders,
      `Ask isCancelEscape(e) from @/lib/key-intent — a bare Escape gate cancels the menu/field with the Escape that only meant "cancel the IME composition":\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("no menu-door file hand-builds a keyboard event (pass the native event)", () => {
    const offenders: string[] = [];
    for (const { rel, code } of files) {
      code.split("\n").forEach((line, i) => {
        if (COERCED_KEY_EVENT.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(
      offenders,
      `A coerced { key, metaKey, … } event drops isComposing/keyCode/repeat, so key-intent reads "never composing". The combobox handler takes a native KeyboardEvent directly:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the combobox asks key-intent BEFORE any key routing", () => {
    const code = read("src/components/menu/useMenuCombobox.ts");
    const handler = code.slice(code.indexOf("onKeyDown: (e) =>"));
    const ime = handler.indexOf("isImeComposing(");
    const repeat = handler.search(/terminal\s*&&\s*e\.repeat/);
    expect(ime, "IME gate present").toBeGreaterThan(-1);
    expect(repeat, "repeat gate present").toBeGreaterThan(-1);
    for (const later of ["onArrowHorizontal(", "onNavigate?.()", "handleKeyDown?.(e)", "onKeyDown?.(e)"]) {
      const at = handler.indexOf(later);
      expect(at, later).toBeGreaterThan(ime);
      expect(at, later).toBeGreaterThan(repeat);
    }
  });

  it("useMenuDismiss's Escape is a deliberate press: IME + repeat gated, repeats swallowed", () => {
    const code = read("src/components/menu/useMenuDismiss.ts");
    const effect = code.slice(code.indexOf("!isCancelEscape(e)"));
    expect(effect.length).toBeLessThan(code.length);
    expect(effect).toMatch(/if\s*\(\s*e\.repeat\s*\)\s*return/);
    expect(effect).toMatch(/swallowRepeatsUntilKeyup\(e\)/);
    // The repeat gate precedes every way the press can act.
    const repeatAt = effect.search(/e\.repeat/);
    expect(effect.indexOf("onEscape()")).toBeGreaterThan(repeatAt);
    expect(effect.indexOf("endOnEscape()")).toBeGreaterThan(repeatAt);
  });

  it("the matchers catch every spelling (red leg)", () => {
    for (const bad of [
      `if (e.key === "Escape") go();`,
      `if (ev.key !== 'Escape') return;`,
      `if ("Escape" === e.key)`,
      `if (e.key === "Esc")`,
      `case "Escape":`,
    ]) expect(BARE_ESCAPE.test(bad), bad).toBe(true);
    for (const ok of [`if (isCancelEscape(e)) go();`, `<Kbd keys="Escape" />`, `esc: "Escape",`])
      expect(BARE_ESCAPE.test(ok), ok).toBe(false);
    expect(COERCED_KEY_EVENT.test(`} as unknown as React.KeyboardEvent);`)).toBe(true);
    expect(COERCED_KEY_EVENT.test(`(e: React.KeyboardEvent) => {`)).toBe(false);
    expect(IMPORTS_MENU.test(`import { MenuProvider } from "@/components/menu";`)).toBe(true);
    expect(IMPORTS_MENU.test(`import { useMenuDismiss } from "./menu/useMenuDismiss";`)).toBe(true);
    expect(IMPORTS_MENU.test(`import { x } from "@/components/menubar";`)).toBe(false);
  });
});
