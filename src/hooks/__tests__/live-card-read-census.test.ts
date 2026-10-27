// @vitest-environment node
//
// Task 1326 — CENSUS: consumers that act right after their own sidecar writes
// read the LIVE collection, never the render snapshot.
//
// Task 1295 made `usePersistentState`'s `stateRef` authoritative (written
// before the render is scheduled). Two consumers on the AI-request surface
// still decided from the render snapshot: the note + highlight "ask Virgil"
// setters (`notes.find` / `highlights.find` — a create-then-flag filed no row),
// and the auto-apply driver (a splice re-fires its pass before React commits
// `pending → applied`, so a snapshot read let a SECOND applied change land on
// one paragraph). This census pins both:
//
//   1. every `set…AiRequest` setter in `src/hooks/` resolves its card through
//      `stateRef.current` — no `.find(` on any other receiver;
//   2. `useAutoApplyPendingChanges` reads a family's `.cards` ONLY as the batch
//      effect's gate (`const revisionCards = revisions.cards` and its cutter
//      twin); every decision goes through `getCards()`.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { codeOnly, REPO_ROOT } from "@/lib/__tests__/_source-scan";

const HOOKS = path.join(REPO_ROOT, "src/hooks");

/** The body of each `const set…AiRequest = useCallback(` up to its dep list. */
function aiRequestSetters(): Array<{ file: string; name: string; body: string }> {
  const out: Array<{ file: string; name: string; body: string }> = [];
  for (const f of fs.readdirSync(HOOKS)) {
    if (!/\.tsx?$/.test(f)) continue;
    const code = codeOnly(fs.readFileSync(path.join(HOOKS, f), "utf8"));
    const re = /const (set\w*AiRequest) = useCallback\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      // The callback ends at its dependency array — on its own line
      // (`    [update, …],\n  );`) or after the body's brace (`}, [update, …]);`).
      const rest = code.slice(m.index + m[0].length);
      const end = rest.search(/\n\s*(?:\},\s*)?\[[^\]]*\]\s*,?\s*\)\s*;/);
      if (end < 0) throw new Error(`${f} ${m[1]}: no dependency list found`);
      out.push({ file: f, name: m[1], body: rest.slice(0, end) });
    }
  }
  return out;
}

describe("live-card-read CENSUS (task 1326)", () => {
  it("every set…AiRequest setter resolves its card through stateRef.current", () => {
    const setters = aiRequestSetters();
    // Non-vacuity: the seven flag setters (note, highlight, todo, footnote,
    // revision comment, cutter comment, report request).
    expect(setters.length).toBeGreaterThanOrEqual(7);
    // Each body is one callback, not the rest of the file.
    for (const s of setters) expect(s.body.length, s.name).toBeLessThan(3000);
    const offenders: string[] = [];
    for (const s of setters) {
      const finds = [...s.body.matchAll(/([\w.$]+(?:\(\))?)\.find\(/g)];
      for (const f of finds) {
        if (!/^stateRef\.current\.\w+$/.test(f[1])) {
          offenders.push(`${s.file} ${s.name}: ${f[1]}.find(`);
        }
      }
    }
    expect(offenders, "read the card through stateRef.current (task 1295/1326)").toEqual([]);
  });

  it("useAutoApplyPendingChanges reads a family's .cards only as the effect gate", () => {
    const code = codeOnly(
      fs.readFileSync(path.join(HOOKS, "useAutoApplyPendingChanges.ts"), "utf8"),
    );
    const reads = code
      .split("\n")
      .filter((l) => /\.cards\b/.test(l))
      .map((l) => l.trim());
    expect(reads).toEqual([
      "const revisionCards = revisions.cards;",
      "const cutterCards = cutter.cards;",
    ]);
    // …and the decisions do go through the live getter.
    expect(code).toMatch(/\.getCards\(\)/);
  });
});
