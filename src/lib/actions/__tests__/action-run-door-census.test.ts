// TASK 1299 — ONE run door: every caller of a registry row's `run` crosses
// `runAction`, so the commit re-asks the question its offer greyed on.
//
// Before 1299 the doctrine "the commit re-asks the offer's question" (tasks
// 638 / 1168 / 1199) was held by four hand copies of the same two gates — the
// bridge, the slash path, the ¶ dropdown, the colour commit — and missed by the
// fifth caller, the lightning grid's `runGridAction`, which called `row.run(ctx)`
// trusting the render-time `disabled=`. This census fails a `run(ctx)` call on a
// row anywhere in shipped source outside `runAction` itself.
//
// NEGATIVE census: it shares no symbol with a file that would break it, so it
// lives in the guard family by its name (`_guard-family.ts`).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  codeOnlyLines,
  matchFrom,
  matchesWithLines,
  trackedFiles,
} from "@/lib/__tests__/_source-scan";

/** A row's run invoked with an action ctx: `spec.run(ctx)`, `row.run(ctx)`,
 *  `VIRGIL_ACTION_REGISTRY[id].run(c)`, … The arg names are the shapes this
 *  codebase spells a ctx with; `chain.run()` (no argument) never matches. */
const ROW_RUN = /\.run\(\s*(?:ctx|c|context|actionCtx)\b/;

const DOOR_FILE = "src/lib/actions/action-registry.ts";

function shipped(): string[] {
  return trackedFiles("src", /\.(ts|tsx)$/).filter(
    (p) => !/(^|\/)__tests__\//.test(path.relative(REPO_ROOT, p)) && !/\.test\.tsx?$/.test(p),
  );
}

/** The [first, last] line of `runAction`'s declaration in the door file. */
function doorLines(code: string): [number, number] {
  const start = code.indexOf("export function runAction(");
  expect(start, "`runAction` is declared in the door file").toBeGreaterThanOrEqual(0);
  // The body is the first `{` after the signature's closing `)` + return type.
  const sigClose = matchFrom(code, code.indexOf("(", start), "(", ")");
  const bodyOpen = code.indexOf("{", sigClose);
  const bodyClose = matchFrom(code, bodyOpen, "{", "}");
  const lineOf = (i: number) => code.slice(0, i).split("\n").length;
  return [lineOf(start), lineOf(bodyClose)];
}

describe("task 1299 — the registry's ONE run door", () => {
  it("CENSUS: no row `run(ctx)` call in shipped source outside `runAction`", () => {
    const offenders: string[] = [];
    let doorHits = 0;
    for (const abs of shipped()) {
      const rel = path.relative(REPO_ROOT, abs);
      const code = codeOnlyLines(readFileSync(abs, "utf8"));
      const door = rel === DOOR_FILE ? doorLines(code) : null;
      for (const hit of matchesWithLines(code, ROW_RUN)) {
        if (door && hit.line >= door[0] && hit.line <= door[1]) {
          doorHits++;
          continue;
        }
        offenders.push(`${rel}:${hit.line}  ${hit.text.trim()}`);
      }
    }
    expect(offenders, "route this call through `runAction` (action-registry.ts)").toEqual([]);
    // Un-vacuated: the door itself is found by the same scan.
    expect(doorHits).toBe(1);
  });
});
