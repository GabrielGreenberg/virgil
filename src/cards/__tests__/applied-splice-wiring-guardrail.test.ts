// @vitest-environment node
//
// Task 2026-07-27-238 — the WIRING guard for the SETTLE obligation.
//
// The executor's SETTLE step is only as good as its reach: it discharges the
// obligation for every event it is HANDED, and does nothing for an event routed
// through a door that never passes the ops bag. That is precisely the shape of
// the original bug — the morph chokepoint was registered, reachable, and worked;
// it simply had no way to reach the state it was destroying. A test of the
// executor alone cannot see that, because the executor is the part that behaves.
//
// So this greps the production sources for every LIFECYCLE DOOR — a
// `runCardLifecycleEvent(...)` or `makeUnbridgingDelete(...)` call — and asserts
// each one passes `appliedSplice`. A new door (a bulk action, a new panel's
// delete, a second morph entry point) that ends a card record without wiring the
// obligation fails HERE, at the moment it is written, rather than silently
// orphaning a user's applied change.
//
// Deliberately a grep and not a type: making the dep REQUIRED would force every
// caller to name it, but the only way to satisfy it without wiring is a "no
// splices here" sentinel — and that sentinel is the same silent escape hatch,
// just spelled in types. Same reasoning as the other grep-allowlist guards in
// this repo (keystroke sanctity, scroll repositioners, highlight-mark writers).

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src", "library"];
const EXTS = [".ts", ".tsx"];
const CALL_FORMS = ["runCardLifecycleEvent(", "makeUnbridgingDelete("];

/** The two DECLARATION sites (the executor + the delete factory themselves) —
 *  `export function runCardLifecycleEvent(` / `export function
 *  makeUnbridgingDelete(` are not call sites. Matched by the `function ` prefix
 *  rather than by path, so moving the files doesn't quietly disable the guard. */
function isDeclaration(src: string, at: number): boolean {
  const before = src.slice(Math.max(0, at - 20), at);
  return /\bfunction\s+$/.test(before);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "__tests__") continue; // tests construct deps bags freely
      walk(p, out);
    } else if (EXTS.some((e) => p.endsWith(e)) && !p.endsWith(".test.ts") && !p.endsWith(".test.tsx")) {
      out.push(p);
    }
  }
  return out;
}

/** The source slice of one call's argument list, via a balanced-paren scan from
 *  the call's opening paren. Quote/comment-naive, which is fine here: an
 *  unbalanced paren inside a string in these argument lists would be a far
 *  louder problem than this guard. */
function argSlice(src: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return src.slice(openParen, i + 1);
    }
  }
  return src.slice(openParen);
}

interface Door {
  file: string;
  line: number;
  form: string;
  wired: boolean;
}

function collectDoors(): Door[] {
  const doors: Door[] = [];
  for (const root of ROOTS) {
    let files: string[];
    try {
      files = walk(root);
    } catch {
      continue; // silo absent
    }
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const form of CALL_FORMS) {
        let at = src.indexOf(form);
        while (at !== -1) {
          if (!isDeclaration(src, at)) {
            const args = argSlice(src, at + form.length - 1);
            doors.push({
              file,
              line: src.slice(0, at).split("\n").length,
              form,
              wired: args.includes("appliedSplice"),
            });
          }
          at = src.indexOf(form, at + form.length);
        }
      }
    }
  }
  return doors;
}

describe("every lifecycle door wires the SETTLE obligation (task 238)", () => {
  const doors = collectDoors();

  it("finds the known doors (the guard itself is not silently dead)", () => {
    // If this drops to zero the grep stopped matching — the guard would then
    // "pass" while checking nothing, which is the failure mode a coverage guard
    // must never have.
    expect(doors.length).toBeGreaterThanOrEqual(6);
  });

  it("no door ends a card record without passing appliedSplice", () => {
    const unwired = doors.filter((d) => !d.wired);
    expect(
      unwired.map((d) => `${d.file}:${d.line} — ${d.form}`),
      "A lifecycle event that ends a card record must be able to settle the live " +
        "in-document splice that record owns (task 238). Pass the host's " +
        "`appliedSplice` ops bag — it is kind-agnostic, so pass it even for kinds " +
        "that cannot own a splice; the executor gates it on `ownsAppliedSplice`.",
    ).toEqual([]);
  });
});
