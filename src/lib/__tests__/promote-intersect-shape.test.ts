// @vitest-environment node
//
// Task 904 — every promotion strategy is a KEY-INTERSECTION with the shipped
// shape, value-typed against the shipped value.
//
// The print-options strategy used to spread the snapshot (`...source`, plus a
// per-section spread of `elements` / `panels`), so any key in the developer's
// localStorage — including a retired print option — landed in
// `print.defaults.json`, which `print.ts` casts `as PrintOptions` with no CI
// failure. This drives the REAL promoter against a temp root with a snapshot
// carrying a bogus top-level key, a bogus `panels` id and wrong-typed values,
// and checks none of them reach the shipped files while the legitimate flips
// do.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import devPrefsRegistry from "@/lib/dev-prefs-registry.json";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PRINT_JSON = "src/lib/print.defaults.json";
const VIEW_JSON = "src/hooks/useViewPrefs.defaults.json";
const EDITOR_JSON = "src/hooks/usePreferences.defaults.json";

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "virgil-promote-904-"));
  const files = new Set<string>([
    "src/lib/dev-prefs-registry.json",
    "src/app/globals.css",
    ...devPrefsRegistry.promotable.map((e) => e.defaultsFile),
  ]);
  for (const rel of files) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), path.join(root, rel));
  }
  return root;
}

function promote(root: string, snapshot: Record<string, unknown>) {
  const snap = path.join(root, "snapshot.json");
  fs.writeFileSync(snap, JSON.stringify(snapshot));
  const run = spawnSync(
    process.execPath,
    [path.join(REPO, "tools/promote-defaults.mjs"), "--root", root, "--snapshot", snap],
    { encoding: "utf8" },
  );
  expect(run.status, run.stderr).toBe(0);
  return run.stdout;
}

const read = (root: string, rel: string) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));

describe("promotion is a typed key-intersection with the shipped shape (task 904)", () => {
  it("print options: unknown top-level / section keys and wrong-typed values are dropped", () => {
    const root = makeRoot();
    try {
      const shipped = read(root, PRINT_JSON);
      const [elKey] = Object.keys(shipped.elements);
      const [panelKey, panelKey2] = Object.keys(shipped.panels);
      const out = promote(root, {
        "virgil-view-prefs/global": {
          printOptions: {
            retiredTopLevel: true,
            fontSizeRem: 1.2,
            elements: { ...shipped.elements, [elKey]: !shipped.elements[elKey], retiredElement: true },
            panels: { [panelKey]: !shipped.panels[panelKey], [panelKey2]: "yes", bogusPanel: true },
          },
        },
      });
      const promoted = read(root, PRINT_JSON);

      // Vocabulary is exactly the shipped vocabulary, section by section.
      expect(Object.keys(promoted).sort()).toEqual(Object.keys(shipped).sort());
      expect(Object.keys(promoted.elements).sort()).toEqual(Object.keys(shipped.elements).sort());
      expect(Object.keys(promoted.panels).sort()).toEqual(Object.keys(shipped.panels).sort());

      // Legitimate values still promote.
      expect(promoted.fontSizeRem).toBe(1.2);
      expect(promoted.elements[elKey]).toBe(!shipped.elements[elKey]);
      expect(promoted.panels[panelKey]).toBe(!shipped.panels[panelKey]);
      // A wrong-typed value keeps the shipped one.
      expect(promoted.panels[panelKey2]).toBe(shipped.panels[panelKey2]);

      // And every drop is named in the log.
      for (const s of ["retiredTopLevel (unknown)", "elements.retiredElement (unknown)", "panels.bogusPanel (unknown)", `panels.${panelKey2} (string, expected boolean)`]) {
        expect(out).toContain(s);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("print options: a wrong-typed SECTION is dropped whole, not spread", () => {
    const root = makeRoot();
    try {
      const shipped = read(root, PRINT_JSON);
      promote(root, { "virgil-view-prefs/global": { printOptions: { panels: ["notes"], elements: null, fontSizeRem: "big" } } });
      expect(read(root, PRINT_JSON)).toEqual(shipped);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("whitelist and replace-all share the door: wrong-typed values are dropped", () => {
    const root = makeRoot();
    try {
      const view = read(root, VIEW_JSON);
      const editor = read(root, EDITOR_JSON);
      const numKey = Object.keys(editor).find((k) => typeof editor[k] === "number")!;
      const strKey = Object.keys(editor).find((k) => typeof editor[k] === "string")!;
      promote(root, {
        "virgil-view-prefs/global": { pageWidth: "wide", showHighlights: !view.showHighlights, notWhitelisted: 1 },
        "virgil-editor-prefs": { [numKey]: "12", [strKey]: editor[strKey] + "-x", retiredPref: "x" },
      });
      const v = read(root, VIEW_JSON);
      expect(v.pageWidth).toBe(view.pageWidth);
      expect(v.showHighlights).toBe(!view.showHighlights);
      expect(v).not.toHaveProperty("notWhitelisted");
      const e = read(root, EDITOR_JSON);
      expect(e[numKey]).toBe(editor[numKey]);
      expect(e[strKey]).toBe(editor[strKey] + "-x");
      expect(e).not.toHaveProperty("retiredPref");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
