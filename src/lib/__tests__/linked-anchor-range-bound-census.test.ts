/**
 * ANCHOR LOOKUPS ON A LIVE EDITOR GO THROUGH THE BOUNDED DOOR (task 926).
 *
 * `findLinkedAnchorRange(doc, id)` with no `within` walks the WHOLE document.
 * Task 700 gave it a `within` bound fed by the DocStructure snapshot's mapped
 * `anchors` entry — O(range) — but only one caller took it, while the callers
 * that run per keystroke (the pending-change pill's placement, the linked-range
 * float's `readSource`) kept the unbounded form. The bug class is task 723's:
 * the bounded door exists, the hot callers never got it, nothing connects them.
 *
 * The connection is `resolveLinkedAnchorRange(state, id)` — the live door, which
 * reads the snapshot and passes `within` itself. This census pins the residue:
 * every UNBOUNDED call (fewer than four arguments) is in the allowlist below,
 * with a reason, and the counts are exact both ways — a new unbounded call
 * fails, and a removed one must shrink its row.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, codeOnly } from "./_source-scan";

const SRC = path.join(REPO_ROOT, "src");

/** file (repo-relative) → exact count of unbounded calls, and why each is safe. */
const ALLOWED_UNBOUNDED: Record<string, { count: number; why: string }> = {
  "src/lib/linked-anchor-range.ts": {
    count: 2,
    why: "the live door's own fallbacks: an observer-less editor, and snapshot drift",
  },
  "src/components/editor-layout/card-actions/drag-handle-actions.ts": {
    count: 3,
    why: "one-shot drag-handle gestures; two pass a non-linkedAnchor markType the snapshot does not index",
  },
  "src/components/editor-layout/card-actions/grab-menu-target.ts": {
    count: 1,
    why: "grab-menu open (one-shot), with a markType the snapshot does not index",
  },
  "src/text-objects/delete-range.ts": {
    count: 1,
    why: "a delete command reading the PRE-delete doc, which has no live state",
  },
  "src/links/pending-change-nav.ts": {
    count: 1,
    why: "pure doc sort, run off a card-source change or a nav click — never per keystroke",
  },
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules") continue;
      sourceFiles(p, out);
    } else if (/\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out.sort();
}

/** Number of `findLinkedAnchorRange(` CALLS in `src` with fewer than four
 *  top-level arguments (no `within`). The declaration is not a call. */
export function unboundedCalls(src: string): number {
  const code = codeOnly(src);
  const re = /\bfindLinkedAnchorRange\s*\(/g;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (/function\s+$/.test(code.slice(Math.max(0, m.index - 20), m.index))) continue;
    let depth = 0;
    let commas = 0;
    let sawArg = false;
    let last = "";
    for (let i = m.index + m[0].length - 1; i < code.length; i++) {
      const c = code[i];
      if (c === "(" || c === "{" || c === "[") depth++;
      else if (c === ")" || c === "}" || c === "]") {
        depth--;
        if (depth === 0) break;
      } else if (c === "," && depth === 1) commas++;
      if (depth >= 1 && i > m.index + m[0].length - 1 && !/\s/.test(c)) {
        sawArg = true;
        last = c;
      }
    }
    // A trailing comma adds no argument; `sawArg` keeps `f()` at zero.
    const args = sawArg ? commas + 1 - (last === "," ? 1 : 0) : 0;
    if (args < 4) n++;
  }
  return n;
}

describe("linked-anchor-range bound census (task 926)", () => {
  it("every unbounded findLinkedAnchorRange call is allowlisted, with exact counts", () => {
    const found: Record<string, number> = {};
    for (const f of sourceFiles(SRC)) {
      const n = unboundedCalls(fs.readFileSync(f, "utf8"));
      if (n > 0) found[path.relative(REPO_ROOT, f)] = n;
    }
    const expected = Object.fromEntries(
      Object.entries(ALLOWED_UNBOUNDED).map(([k, v]) => [k, v.count]),
    );
    expect(found).toEqual(expected);
  });

  it("the per-keystroke callers resolve through the live door", () => {
    for (const rel of [
      "src/components/PendingChangePill.tsx",
      "src/text-objects/floats/linked-range-body.tsx",
      "src/links/_shared/useLinkedAnchorText.ts",
      "src/links/links.ts",
    ]) {
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      expect(unboundedCalls(src), rel).toBe(0);
      expect(codeOnly(src), rel).toMatch(/\bresolveLinkedAnchorRange\s*\(/);
    }
  });

  it("plant: an unbounded call is counted; a bounded one and the declaration are not", () => {
    expect(unboundedCalls("const r = findLinkedAnchorRange(editor.state.doc, id);")).toBe(1);
    expect(unboundedCalls("findLinkedAnchorRange(doc, id, markType)")).toBe(1);
    expect(unboundedCalls("findLinkedAnchorRange(doc, id, undefined, { from: 1, to: 2 })")).toBe(0);
    expect(unboundedCalls("findLinkedAnchorRange(doc, id, undefined, entry)")).toBe(0);
    expect(unboundedCalls("export function findLinkedAnchorRange(\n  doc: PMNode,\n) {}")).toBe(0);
    expect(unboundedCalls("// findLinkedAnchorRange(doc, id) in a comment")).toBe(0);
  });
});
