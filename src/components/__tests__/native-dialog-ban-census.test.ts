/**
 * Task 1378 — **no production code opens a native browser dialog.** CENSUS.
 *
 * Every ask in Virgil goes through the ONE dialog door, `useSystemDialog()`
 * (task 820 moved `src/` onto it). The Library silo escaped that migration:
 * delete paper, remove from references.bib and delete library still called
 * `window.confirm` — browser chrome ("localhost says…"), plain-text `\n\n`
 * copy, no destructive styling, generic OK/Cancel, and a synchronous block of
 * the main thread — while `BibEditModal` in the same silo already asked
 * through `systemDialog.confirm`. Nothing banned the native alert, so the two
 * silos' destructive asks drifted apart unseen.
 *
 * The population is `productionFiles()` — the SAME two-silo walk every
 * SystemDialog census reads — so this guard cannot walk a smaller world than
 * the others. The allowlist is EMPTY.
 *
 * Read `codeOnly`: a needle inside a string or comment ("replaces native
 * `window.confirm`") is prose, not a call.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { codeOnly } from "@/lib/__tests__/_source-scan";
import { productionFiles } from "./_dialog-sites";

const NAMES = ["confirm", "alert", "prompt"] as const;

/** Every native-dialog reach in `code` (already comment/string-stripped):
 *  `window.confirm` / `globalThis.alert` / `self.prompt` in any position (a
 *  call, or the function passed by reference), and a BARE `confirm(` call in
 *  a file that binds no `confirm` of its own — where the bare name can only
 *  resolve to the global. */
function nativeDialogReaches(code: string): string[] {
  const hits: string[] = [];
  for (const m of code.matchAll(/\b(?:window|globalThis|self)\s*\??\.\s*(confirm|alert|prompt)\b/g)) {
    hits.push(m[0].replace(/\s+/g, ""));
  }
  for (const name of NAMES) {
    const bareCall = new RegExp(`(?<![\\w$.])${name}\\s*\\(`, "g");
    const calls = [...code.matchAll(bareCall)].filter((m) => !isMethodDeclaration(code, m.index!));
    if (calls.length === 0) continue;
    // Any mention of the name that is NOT a bare call and NOT a member access
    // is a binding (`const confirm`, `{ confirm }`, a parameter, an import),
    // which makes the bare call a local function's.
    const nonCall = new RegExp(`(?<![\\w$.])${name}\\b(?!\\s*\\()`);
    if (!nonCall.test(code)) hits.push(`${name}(`);
  }
  return hits;
}

/** `confirm(opts) {…}` / `confirm(opts: …): Promise<boolean>;` — a method
 *  shorthand or interface member NAMED like the global (the dialog API's own
 *  declarations), not a call: it opens its line (bar an `async`) and its
 *  parameter list is followed by a body `{` or a return-type `:`. */
function isMethodDeclaration(code: string, at: number): boolean {
  const lineStart = code.lastIndexOf("\n", at - 1) + 1;
  if (!/^\s*(?:async\s+)?$/.test(code.slice(lineStart, at))) return false;
  let depth = 0;
  let i = code.indexOf("(", at);
  for (; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) break;
  }
  return /^\s*[{:]/.test(code.slice(i + 1));
}

describe("no native browser dialog in production code (task 1378)", () => {
  const files = productionFiles();

  it("walks BOTH silos (it is not scanning nothing)", () => {
    expect(files.some((f) => f.rel.startsWith("library/"))).toBe(true);
    expect(files.some((f) => !f.rel.startsWith("library/"))).toBe(true);
  });

  it("finds zero window.confirm / alert / prompt — allowlist empty", () => {
    const offenders: string[] = [];
    for (const { abs, rel } of files) {
      for (const hit of nativeDialogReaches(codeOnly(readFileSync(abs, "utf8")))) {
        offenders.push(`${rel}: ${hit} — ask through useSystemDialog() instead`);
      }
    }
    expect(offenders).toEqual([]);
  });

  describe("the detector fails on a planted one", () => {
    it.each([
      ["const ok = window.confirm(msg);", "window.confirm"],
      ["window.alert(msg)", "window.alert"],
      ["const answer = window?.prompt(q)", "window?.prompt"],
      ["globalThis.confirm(msg)", "globalThis.confirm"],
      ["const ask = window.confirm;", "window.confirm"],
      ["if (!confirm(msg)) return;", "confirm("],
      ["alert(msg);", "alert("],
      ["function f() {\n  confirm(msg);\n}", "confirm("],
    ])("flags %s", (code, hit) => {
      expect(nativeDialogReaches(code)).toContain(hit);
    });

    it.each([
      "const { confirm } = useSystemDialog(); await confirm({ message });",
      "async function run(confirm: () => Promise<boolean>) { await confirm(); }",
      "await systemDialog.confirm({ message });",
      "dialog.alert({ title })",
      "installEvent.prompt()",
      "const api = {\n  confirm(opts) {\n    return enqueue(opts);\n  },\n};",
      "interface Api {\n  alert(opts: AlertOptions): Promise<void>;\n}",
    ])("leaves a local binding or the dialog API alone: %s", (code) => {
      expect(nativeDialogReaches(code)).toEqual([]);
    });
  });
});
