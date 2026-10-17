// Task 1165 — **Enter has ONE spelling: `isCommitEnter` (src/lib/key-intent.ts).**
//
// Task 994 made `key-intent.ts` the owner of "is this keydown a fresh,
// deliberate press?" — but converted only the menu controller, the dialog
// Enter policy and the typed-LaTeX revert. Every other Enter gate kept a bare
// `e.key === "Enter"`, so with a Japanese/Chinese/Korean IME the Enter that
// picks a candidate ALSO committed the field: the Outline's rename and label
// inputs wrote the half-composed text into the `.tex`. 34 files spelled it.
//
// This census is the leg that catches the NEXT inline field: no production
// file in either silo compares a key to "Enter" except `key-intent.ts`, which
// defines the predicate. (PM `handleKeyDown` sites are converted too rather
// than exempted — prosemirror-view already drops composition keydowns, and the
// check is free, so one uniform rule beats an exemption list.)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { REPO_ROOT, strip, walkFiles } from "./_source-scan";

/** A key/code compared to Enter, in any of the spellings JS allows. */
export const BARE_ENTER =
  /\b(?:key|code)\s*[!=]==?\s*["'`](?:Numpad)?Enter["'`]|["'`](?:Numpad)?Enter["'`]\s*[!=]==?\s*[\w.]*\b(?:key|code)\b|\bcase\s*["'`](?:Numpad)?Enter["'`]\s*:/;

const OWNER = "src/lib/key-intent.ts";

function productionFiles(): string[] {
  return ["src", "library"].flatMap((root) =>
    walkFiles(path.join(REPO_ROOT, root), { skipDirs: ["__tests__"] })
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => path.relative(REPO_ROOT, f)),
  );
}

describe("Enter key CENSUS (task 1165)", () => {
  it("no production file compares a key to Enter outside key-intent.ts", () => {
    const offenders: string[] = [];
    for (const rel of productionFiles()) {
      if (rel === OWNER) continue;
      const code = strip(readFileSync(path.join(REPO_ROOT, rel), "utf8"), true, true);
      code.split("\n").forEach((line, i) => {
        if (BARE_ENTER.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(
      offenders,
      `Ask isCommitEnter(e) from @/lib/key-intent instead — a bare Enter gate commits the IME's candidate-pick Enter:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the owner still defines the one predicate", () => {
    const src = readFileSync(path.join(REPO_ROOT, OWNER), "utf8");
    expect(src).toMatch(/export function isCommitEnter\(/);
  });

  it("the matcher catches every spelling (red leg)", () => {
    for (const bad of [
      `if (e.key === "Enter") go();`,
      `if (ev.key !== 'Enter') return;`,
      `if (key == "Enter")`,
      `if ("Enter" === e.key)`,
      `if (e.code === "NumpadEnter")`,
      `case "Enter":`,
    ]) expect(BARE_ENTER.test(bad), bad).toBe(true);
    for (const ok of [`if (isCommitEnter(e)) go();`, `<Kbd keys="Enter" />`, `enter: "Enter",`])
      expect(BARE_ENTER.test(ok), ok).toBe(false);
  });
});
