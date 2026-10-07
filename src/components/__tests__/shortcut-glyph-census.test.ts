// Task 985 — shortcut hints have ONE source of truth.
//
// `src/STYLE_GUIDE.md` "Keyboard shortcuts — `<Kbd>`": `<Kbd>` /
// `data-hint-keys` is the only way to render a shortcut. A hand-spelled `⌘B`
// is Mac-only (Windows/Linux read Ctrl+B), lands in an accessible NAME when it
// rides a label, and is tied to no keymap — the ⚡ grid's "Bold (⌘B)" cells
// and AIWindow's `title="Submit (⌘↵)"` were all three. A chord is stated in
// portable form (`Mod+Shift+S`, or a registry `keybinding` translated by
// `keysFromKeybinding`) and `Kbd.tsx`'s glyph table is the only place a
// modifier glyph is spelled.
//
// So: no `⌘` / `⇧` / `⌥` in non-comment source under `src/` outside `Kbd.tsx`.
// Tests are exempt (they may assert on what `<Kbd>` renders).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { strip, walkFiles } from "@/lib/__tests__/_source-scan";

const ROOT = join(__dirname, "..", "..");
const GLYPH = /[⌘⇧⌥]/;
const ALLOWED = new Set(["components/Kbd.tsx"]);

const sources = (dir: string): string[] =>
  walkFiles(dir, { skipDirs: ["__tests__"] }).filter(
    (p) => /\.(ts|tsx)$/.test(p) && !/\.test\.(ts|tsx)$/.test(p),
  );

describe("shortcut glyph census (task 985)", () => {
  it("no modifier glyph is hand-spelled outside Kbd.tsx", () => {
    const hits: string[] = [];
    let scanned = 0;
    for (const file of sources(ROOT)) {
      const rel = relative(ROOT, file);
      if (ALLOWED.has(rel)) continue;
      const raw = readFileSync(file, "utf8");
      scanned++;
      if (!GLYPH.test(raw)) continue;
      const code = strip(raw, true, true).split("\n");
      code.forEach((line, i) => {
        if (GLYPH.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(scanned).toBeGreaterThan(500);
    expect(hits, "spell the chord as Kbd `keys` (Mod+Shift+S), not a glyph").toEqual([]);
  });

  it("the census can see a glyph (Kbd.tsx itself spells them)", () => {
    const kbd = strip(readFileSync(join(ROOT, "components/Kbd.tsx"), "utf8"), true, true);
    expect(GLYPH.test(kbd)).toBe(true);
  });
});
