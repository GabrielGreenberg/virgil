/**
 * Task 1423 — **a drop confirms only what it destroys.**
 *
 * Gabriel: "Don't prompt with a dialogue box on moving an anchor." Every
 * paragraph-side card drag (note, highlight, todo, report, archive, cutter,
 * revision — one factory, `textObjectSideReanchorSpec`) asked "Re-anchor this
 * note?" whenever the card was already anchored elsewhere, and task 1404 made
 * the margin-marker drag the obvious way to move a card, so the dialog fired on
 * nearly every move. The move is reversible (drag it back) and destroys
 * nothing, and the dialog had been papered over with a per-dialog "Don't show
 * this again" suppression (`reanchor-margin-item`) rather than a policy.
 *
 * The policy, stated once in `DropDecision` (`drop-mode/types.ts`): a drop
 * spec may return `kind: "confirm"` only with `tone: "danger"` — content
 * actually destroyed — and never with a `suppressId` (a danger confirm may not
 * be suppressed, and a confirm that wants suppressing should not exist). The
 * TYPE carries it; this census carries it past the `as unknown as` casts and
 * untyped helpers the type cannot see.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  REPO_ROOT,
  commentsStripped,
  matchFrom,
  trackedFiles,
} from "@/lib/__tests__/_source-scan";

/** Every shipped `.ts`/`.tsx` in both silos. */
const PRODUCTION = [
  ...trackedFiles("src", /\.tsx?$/),
  ...trackedFiles("library", /\.tsx?$/),
].filter((abs) => !/(^|[/\\])__tests__[/\\]/.test(abs));

function rel(abs: string): string {
  return abs.slice(REPO_ROOT.length + 1).replace(/\\/g, "/");
}

/** A file in the drop vocabulary: it lives in the drop engine, is a panel's
 *  drop spec, or speaks the decision's own words. */
function isDropFile(relPath: string, code: string): boolean {
  return (
    relPath.startsWith("src/components/drop-mode/") ||
    /(^|\/)drop-spec\.tsx?$/.test(relPath) ||
    /\b(classifyDrop|DropDecision|DropSpec)\b/.test(code)
  );
}

/** Index of the `{` opening the object literal that encloses `at`. */
function enclosingBrace(code: string, at: number): number {
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    const c = code[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

/** Every `kind: "confirm"` object literal in `code` that breaks the policy,
 *  with the reason. Exported shape for the fixture legs below. */
function confirmViolations(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/\bkind\s*:\s*["']confirm["']/g)) {
    const open = enclosingBrace(code, m.index!);
    const close = open < 0 ? -1 : matchFrom(code, open, "{", "}");
    const literal = open < 0 || close < 0 ? m[0] : code.slice(open, close + 1);
    const line = code.slice(0, m.index!).split("\n").length;
    if (!/\btone\s*:\s*["']danger["']/.test(literal)) {
      out.push(`line ${line}: confirm without tone: "danger"`);
    }
    if (/\bsuppressId\b/.test(literal)) {
      out.push(`line ${line}: confirm declares a suppressId`);
    }
  }
  return out;
}

describe("drop confirm policy — CENSUS (task 1423)", () => {
  it('every drop-spec confirm is tone: "danger" and unsuppressible', () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const abs of PRODUCTION) {
      const r = rel(abs);
      const code = commentsStripped(readFileSync(abs, "utf8"));
      if (!isDropFile(r, code)) continue;
      scanned++;
      for (const v of confirmViolations(code)) offenders.push(`${r} ${v}`);
    }
    // Non-vacuity: the drop vocabulary is a real population.
    expect(scanned).toBeGreaterThan(10);
    // A non-danger drop confirm is a dialog on a reversible gesture. Make the
    // drop `apply` (the undo is to drag it back) — or, if it truly destroys
    // content, say so with `tone: "danger"`.
    expect(offenders).toEqual([]);
  });

  it("the scanner has teeth (fixtures)", () => {
    expect(
      confirmViolations(`return { kind: "confirm", title: "Re-anchor?", message: "m" };`),
    ).toEqual(['line 1: confirm without tone: "danger"']);
    expect(
      confirmViolations(
        `return {\n  kind: "confirm",\n  tone: "danger",\n  message: "m",\n  suppressId: "x",\n};`,
      ),
    ).toEqual(["line 2: confirm declares a suppressId"]);
    expect(
      confirmViolations(
        `return { kind: "confirm", tone: "danger", message: { a: 1 }, confirmLabel: "Delete" };`,
      ),
    ).toEqual([]);
  });

  it("the TYPE states the policy: a confirm decision requires tone danger and has no suppressId", () => {
    const types = commentsStripped(
      readFileSync(`${REPO_ROOT}/src/components/drop-mode/types.ts`, "utf8"),
    );
    const at = types.indexOf("export type DropDecision");
    expect(at).toBeGreaterThan(-1);
    const arm = /kind: "confirm";([^}]*)\}/.exec(types.slice(at));
    expect(arm).not.toBeNull();
    expect(arm![1]).toMatch(/\btone: "danger";/); // required, not `tone?:`
    expect(arm![1]).not.toMatch(/suppressId/);
  });

  it("the card re-anchor spec asks nothing", () => {
    const code = commentsStripped(
      readFileSync(
        `${REPO_ROOT}/src/components/drop-mode/util/text-object-side-reanchor.ts`,
        "utf8",
      ),
    );
    expect(code).not.toMatch(/\bkind\s*:\s*["']confirm["']/);
  });

  it("the retired suppression id is gone from shipped code", () => {
    const offenders = PRODUCTION.filter((abs) =>
      commentsStripped(readFileSync(abs, "utf8")).includes("reanchor-margin-item"),
    ).map(rel);
    expect(offenders).toEqual([]);
  });
});
