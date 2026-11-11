// Task 1569 — flipping editability is not a content change.
//
// THE RULE:
//
//   > Every production `setEditable` call passes `false` as its second
//   > argument, so it emits no `update`.
//
// TipTap's `setEditable(editable, emitUpdate = true)` emits `update` on every
// call, with no equality check and an empty transaction. `update` is what a
// surface's write-back, autosave and card persist hang off, so the default
// hands each of them a write for a change that never happened. Inside an
// `onUpdate` it is worse: the linked-range float's refusal called it from its
// own write-back and re-entered itself until the stack overflowed.
//
// The population is DERIVED: every `.setEditable(` in non-test source.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { codeOnly, matchFrom, walkFiles } from "@/lib/__tests__/_source-scan";

const SRC = join(process.cwd(), "src");

function calls(): { file: string; args: string }[] {
  const out: { file: string; args: string }[] = [];
  for (const f of walkFiles(SRC, { skipDirs: ["__tests__"] })) {
    if (!/\.tsx?$/.test(f)) continue;
    const code = codeOnly(readFileSync(f, "utf8"));
    for (const m of code.matchAll(/\.setEditable\(/g)) {
      const open = m.index + m[0].length - 1;
      out.push({ file: relative(SRC, f), args: code.slice(open + 1, matchFrom(code, open, "(", ")")) });
    }
  }
  return out;
}

describe("setEditable emits no update CENSUS (task 1569)", () => {
  it("found the production calls", () => {
    const files = calls().map((c) => c.file);
    expect(files.some((f) => f.endsWith("lib/float-sync.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("components/EditorLayout.tsx"))).toBe(true);
  });

  it("every call passes false as emitUpdate", () => {
    const emitting = calls()
      .filter((c) => !/,\s*false\s*$/.test(c.args))
      .map((c) => `${c.file}: setEditable(${c.args})`);
    expect(emitting).toEqual([]);
  });
});
