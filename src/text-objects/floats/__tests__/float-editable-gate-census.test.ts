// Task 1546 — every float editor takes its editability from ONE gate.
//
// THE RULE:
//
//   > A TipTap surface that joins the float sync (`useFloatMainSync`) mounts
//   > its editor with `useFloatEditable`'s value, and hands the SAME value to
//   > the sync, which keeps the live editor at it.
//
// A float's edits land in MAIN, and main drops every doc change on a
// read-only paper silently (`readOnlyEnforcer.filterTransaction`; main pins
// `view.editable` true so the Reader's grab handle can still lift text out).
// Read-only gating used to be spelled per body — a live gate in the two
// example bodies, a mount-time chrome flag in paragraph/heading, and
// `editable: true` in list, list item, figure, linked range and every
// single-block kind — so a reader could pop a list out of a read-only paper,
// type into it, and lose every keystroke with no banner.
//
// The population is DERIVED (a module that calls both `useEditor(` and
// `useFloatMainSync(`), so a new float body is covered the day it arrives.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { codeOnly, matchFrom, walkFiles } from "@/lib/__tests__/_source-scan";

const SRC = join(process.cwd(), "src");

const floatEditorModules = [...walkFiles(SRC, { skipDirs: ["__tests__"] })]
  .filter((f) => /\.tsx?$/.test(f))
  .filter((f) => {
    const code = codeOnly(readFileSync(f, "utf8"));
    return /\buseEditor\(/.test(code) && /\buseFloatMainSync\(/.test(code);
  })
  .map((f) => relative(SRC, f))
  .sort();

/** The `{ … }` argument of the first `name({` call in `code`, or null. */
function callArg(code: string, name: string): string | null {
  const at = code.search(new RegExp(`\\b${name}\\(\\{`));
  if (at < 0) return null;
  const open = code.indexOf("{", at);
  const close = matchFrom(code, open, "{", "}");
  return close < 0 ? null : code.slice(open, close + 1);
}

/** Every reason `code` breaks the rule; empty when it holds. */
function gateViolations(code: string): string[] {
  const out: string[] = [];
  const gate = /const\s+(\w+)\s*=\s*useFloatEditable\(/.exec(code)?.[1];
  if (!gate) return ["no `const … = useFloatEditable(…)` binding"];

  const editorArg = callArg(code, "useEditor");
  if (!editorArg) out.push("no `useEditor({…})` call");
  else {
    const values = [...editorArg.matchAll(/\beditable:\s*([^,\n}]+)/g)].map((m) =>
      m[1].trim(),
    );
    if (values.length === 0) out.push("useEditor names no `editable:`");
    for (const v of values) {
      if (v !== gate) out.push(`useEditor mounts with \`editable: ${v}\`, not \`${gate}\``);
    }
  }

  const syncArg = callArg(code, "useFloatMainSync");
  if (!syncArg) out.push("no `useFloatMainSync({…})` call");
  else if (!new RegExp(`\\beditable:\\s*${gate}\\b`).test(syncArg)) {
    out.push(`useFloatMainSync is not handed \`editable: ${gate}\``);
  }
  return out;
}

describe("float editability gate CENSUS (task 1546)", () => {
  it("derived a population that holds every TipTap float body", () => {
    // Nine TipTap float bodies at the time of writing (the source pod is
    // CodeMirror and is held by `embedded-source-editor-gate-census`).
    expect(floatEditorModules.length).toBeGreaterThanOrEqual(9);
    for (const body of ["list-body", "figure-body", "single-block-body", "linked-range-body"]) {
      expect(floatEditorModules.some((m) => m.endsWith(`floats/${body}.tsx`))).toBe(true);
    }
  });

  it.each(floatEditorModules)("%s takes its editability from useFloatEditable", (rel) => {
    const code = codeOnly(readFileSync(join(SRC, rel), "utf8"));
    expect(gateViolations(code)).toEqual([]);
  });

  it("goes RED when a body restores a hard-coded `editable: true`", () => {
    const rel = floatEditorModules.find((m) => m.endsWith("floats/list-body.tsx"))!;
    const code = codeOnly(readFileSync(join(SRC, rel), "utf8"));
    const regressed = code.replace(/(useEditor\(\{[\s\S]*?)editable: floatEditable/, "$1editable: true");
    expect(regressed).not.toBe(code);
    expect(gateViolations(regressed).join("\n")).toMatch(/editable: true/);
    // …and when the sync is never told.
    const unsynced = code.replace(/(useFloatMainSync\(\{[\s\S]*?)editable: floatEditable,/, "$1");
    expect(gateViolations(unsynced).join("\n")).toMatch(/useFloatMainSync is not handed/);
  });
});
