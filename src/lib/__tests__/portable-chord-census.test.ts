// CENSUS — task 1376: an advertised chord is a CONSTANT its binding matches.
//
// Task 998 pinned this for `MenuActionRow shortcut=` (NEW_WINDOW_SHORTCUT) but
// not for a chord advertised through `useHint({ keys })` / `iconHint({ keys })`
// / `<Kbd keys>`. The ⚡ actions menu's hint said "Mod+/" (Ctrl+/ off Mac)
// while its window keydown hand-spelled `e.metaKey && !e.ctrlKey` — so the
// advertised Ctrl+/ was dead on Windows/Linux. This census walks every source
// file and requires:
//
//   1. No string-literal ⌘/Ctrl chord (`"Mod+…"`, `"Meta+…"`, `"Ctrl+…"`) is
//      passed as a `keys` / `shortcut` value — it must be an identifier.
//   2. Every UPPER_CASE identifier passed that way is matched by some binding:
//      `matchesPortableChord(e, ID)` or `chordPress(e, ID)`.
//
// `Hint.tsx` / `Kbd.tsx` are the renderers (their docblocks carry examples).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { chordPress, matchesPortableChord } from "@/lib/portable-chord";
import { trackedFiles } from "./_source-scan";

const SRC = path.resolve(__dirname, "../..");
const RENDERERS = new Set(["components/Hint.tsx", "components/Kbd.tsx"]);

const FILES = trackedFiles("src", /\.tsx?$/)
  .filter((abs) => !/\.test\.tsx?$/.test(abs) && !abs.includes("/__tests__/"))
  .map((abs) => ({
    rel: path.relative(SRC, abs).split(path.sep).join("/"),
    text: readFileSync(abs, "utf8"),
  }));

// A `keys` / `shortcut` value position, up to the end of its expression.
const ADVERTISED = /\b(?:keys|shortcut)\s*[:=]\s*\{?([^,}\n]*)/g;
const LITERAL_CHORD = /["'`](?:Mod|Meta|Ctrl)\+[^"'`]*["'`]/;
const CONST_ID = /\b[A-Z][A-Z0-9_]*_SHORTCUT\b/g;

describe("advertised chords read a constant the binding matches (task 1376)", () => {
  it("no hint / keycap / row shortcut passes a string-literal ⌘/Ctrl chord", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      if (RENDERERS.has(f.rel)) continue;
      for (const m of f.text.matchAll(ADVERTISED)) {
        if (LITERAL_CHORD.test(m[1])) offenders.push(`${f.rel}: ${m[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every advertised *_SHORTCUT constant is matched by a binding", () => {
    const advertised = new Set<string>();
    for (const f of FILES) {
      if (RENDERERS.has(f.rel)) continue;
      for (const m of f.text.matchAll(ADVERTISED)) {
        for (const id of m[1].matchAll(CONST_ID)) advertised.add(id[0]);
      }
    }
    // The population is not vacuous: the four pre-1376 advertisers are in it.
    expect([...advertised]).toEqual(
      expect.arrayContaining([
        "ACTIONS_MENU_SHORTCUT",
        "FIELD_COMMIT_SHORTCUT",
        "NEW_WINDOW_SHORTCUT",
      ]),
    );
    const all = FILES.map((f) => f.text).join("\n");
    const unmatched = [...advertised].filter(
      (id) =>
        !new RegExp(`\\b(?:matchesPortableChord|chordPress)\\(e, ${id}\\)`).test(all),
    );
    expect(unmatched).toEqual([]);
  });

  it("the window-level bindings no longer hand-spell their modifiers", () => {
    const text = (rel: string) => FILES.find((f) => f.rel === rel)!.text;
    expect(text("components/SelectionActionsMenu.tsx")).not.toMatch(/e\.metaKey|e\.ctrlKey/);
    expect(text("components/AIWindow.tsx")).not.toMatch(/e\.metaKey \|\| e\.ctrlKey/);
    expect(text("components/NodeEditPopover.tsx")).not.toMatch(/e\.metaKey \|\| e\.ctrlKey/);
    const layout = text("components/EditorLayout.tsx");
    expect(layout).toMatch(/chordPress\(e, PRINT_SHORTCUT\)/);
    expect(layout).toMatch(/chordPress\(e, SAVE_SHORTCUT\)/);
    expect(layout).not.toMatch(/e\.key\.toLowerCase\(\) === "[ps]"/);
  });
});

describe("chordPress — match ∧ deliberate", () => {
  const ev = (key: string, mods: Partial<KeyboardEvent> = {}) =>
    ({
      key,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      repeat: false,
      isComposing: false,
      keyCode: 0,
      ...mods,
    }) as KeyboardEvent;

  it("press / held / null", () => {
    expect(chordPress(ev("/", { metaKey: true }), "Mod+/")).toBe("press");
    expect(chordPress(ev("/", { ctrlKey: true }), "Mod+/")).toBe("press");
    expect(chordPress(ev("/", { metaKey: true, repeat: true }), "Mod+/")).toBe("held");
    expect(chordPress(ev("/", { metaKey: true, shiftKey: true }), "Mod+/")).toBeNull();
    expect(chordPress(ev("/", { metaKey: true, altKey: true }), "Mod+/")).toBeNull();
    expect(chordPress(ev("/"), "Mod+/")).toBeNull();
    expect(chordPress(ev("/", { metaKey: true, isComposing: true }), "Mod+/")).toBeNull();
  });

  it("FIELD_COMMIT_SHORTCUT matches ⌘/Ctrl+Enter only", () => {
    expect(matchesPortableChord(ev("Enter", { metaKey: true }), "Mod+Enter")).toBe(true);
    expect(matchesPortableChord(ev("Enter", { ctrlKey: true }), "Mod+Enter")).toBe(true);
    expect(matchesPortableChord(ev("Enter"), "Mod+Enter")).toBe(false);
  });
});
