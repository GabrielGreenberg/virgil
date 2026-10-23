// TASK 1251 — CENSUS: every vanilla-NodeView edit door asks the write gate
// before it offers an input.
//
// On MAIN `view.editable` is pinned `true`; a read-only host (Library Reader)
// or a held pen is enforced only downstream by `readOnlyEnforcer`, which drops
// the write SILENTLY. So a door that opens an input without asking
// `surfaceEditableNow` offers an edit that does nothing. Task 1017 gated the
// heading chip; the paragraph / list / example title strips and the example
// label pod were left ungated until 1251. The ONE spelling of the gate for a
// door whose write may proxy to main is `proxiedSurfaceEditableNow`
// (`surface-editable.ts`). This census pins:
//   (a) every `createParTitleSession({` call site passes a REAL `mayWrite`
//       (TypeScript makes it required; this forbids a constant `() => true`);
//   (b) every `createExampleLabelPod({` call site passes the gate;
//   (c) the doors themselves ask it before mounting (session `begin`, pod click);
//   (d) the heading chip's `chipMayWrite` is the same spelling.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { REPO_ROOT, trackedFiles } from "@/lib/__tests__/_source-scan";

const ROOT = REPO_ROOT;
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Non-test source files under src/, discovered — a new caller is enrolled. */
const sources = (): string[] =>
  trackedFiles("src", /\.tsx?$/).filter(
    (p) => !p.includes(`${sep}__tests__${sep}`) && !/\.test\.tsx?$/.test(p),
  );

/** Each `<factory>({ … })` argument block in the tree (balanced braces). */
function callBlocks(factory: string): { file: string; body: string }[] {
  const out: { file: string; body: string }[] = [];
  const needle = `${factory}({`;
  for (const abs of sources()) {
    const src = readFileSync(abs, "utf8");
    let at = src.indexOf(needle);
    while (at !== -1) {
      let i = at + needle.length - 1;
      let depth = 0;
      for (; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}" && --depth === 0) break;
      }
      out.push({ file: relative(ROOT, abs), body: src.slice(at, i + 1) });
      at = src.indexOf(needle, i);
    }
  }
  return out;
}

const GATE = /mayWrite(:\s*\(\)\s*=>\s*proxiedSurfaceEditableNow\(|,)/;

describe("vanilla-NodeView write-gate CENSUS (task 1251)", () => {
  for (const factory of ["createParTitleSession", "createExampleLabelPod"]) {
    const sites = callBlocks(factory);

    it(`${factory} has call sites (the census is not vacuous)`, () => {
      expect(sites.length).toBeGreaterThan(0);
    });

    for (const { file, body } of sites) {
      it(`${file}: ${factory} is handed the write gate`, () => {
        expect(body, `${factory} call in ${file} passes no mayWrite`).toMatch(GATE);
        expect(body).not.toMatch(/mayWrite:\s*\(\)\s*=>\s*true/);
      });
    }
  }

  it("a shorthand `mayWrite` is bound to the gate in its own scope", () => {
    for (const { file, body } of callBlocks("createParTitleSession")) {
      if (!/\bmayWrite,/.test(body)) continue;
      const src = read(file);
      const at = src.indexOf(body);
      const before = src.slice(0, at);
      const decl = before.lastIndexOf("const mayWrite = ");
      expect(decl, `${file}: shorthand mayWrite has no local declaration`).toBeGreaterThan(-1);
      expect(src.slice(decl, decl + 120)).toContain("proxiedSurfaceEditableNow(");
    }
  });

  it("the session door asks mayWrite before mounting AND before committing", () => {
    const src = read("src/lib/tiptap/title-edit-session.ts");
    const begin = src.slice(src.indexOf("const begin = (): void => {"), src.indexOf("const setup ="));
    expect(begin).toContain("if (!mayWrite()) return;");
    expect(src).toContain("if (next !== original && mayWrite()) commit(next);");
  });

  it("the example label pod asks mayWrite before its click swaps or opens anything", () => {
    const src = read("src/lib/tiptap/expex.ts");
    const begin = src.indexOf("const beginLabelEdit = ");
    expect(src.slice(begin, begin + 200)).toContain("!mayWrite()");
    const click = src.indexOf('labelAnnot.addEventListener("click"', begin);
    const swap = src.indexOf('target.classList.contains("heading-label-text")', click);
    expect(src.slice(click, swap)).toContain("if (!mayWrite()) return;");
  });

  it("the × (Remove title) handlers ask the gate", () => {
    const src = read("src/lib/editor-extensions.ts");
    expect(src).not.toMatch(/e\.stopPropagation\(\);\s*setTitle\(null\)/);
    expect(src.match(/if \(mayWrite\(\)\) setTitle\(null\)/g)?.length).toBe(2);
  });

  it("the heading chip's gate is the same spelling (task 1017)", () => {
    const src = read("src/lib/editor-extensions.ts");
    expect(src).toMatch(/const chipMayWrite = \(\): boolean =>\s*proxiedSurfaceEditableNow\(nodeEditor, getTarget\(\)\)/);
  });
});
