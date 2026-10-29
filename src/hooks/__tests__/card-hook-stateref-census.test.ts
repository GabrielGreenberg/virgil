// Task 1164 — CENSUS: a card hook's mutators read live state through
// `stateRef`, never through the render closure.
//
// `usePersistentState` hands every sidecar hook a `stateRef` (refreshed on
// render). A `useCallback` that instead reads `state.cards` / `state.items`
// (or an alias like `const cards = state.cards`) and lists it as a dep gets a
// NEW identity on every card edit — every keystroke in any card body
// re-identified `addReport`, which re-identified `useCardCreation`'s callbacks
// in EditorPane and on down to the omni/float builders. Todos' clone already
// read the ref while Reports/Cutter/Revisions' clones read the closure; this
// census closes the drift so no sibling can rot back.
//
// Rule: in each hook below, no `useCallback` dependency array names a card
// COLLECTION (`state.cards` / `.items` / `.snippets` / …) or a top-level alias of
// one. A scalar setting a pure formatter genuinely renders from (useCitations'
// `getFormattedBib` on `state.citationStyle`) is not a collection and stays a
// dep. The memoized RETURN (`return useMemo(…, [state.cards, …])`) is not a
// useCallback and is exempt — exposing the list IS a render-time read.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_HOOKS = resolve(HERE, "..");

const COLLECTION = "(?:cards|items|snippets|citations|notes|entries)";

const CARD_HOOKS = [
  "useReports",
  "useCutter",
  "useRevisions",
  "useTodos",
  "useNotes",
  "useArchive",
  "useAnnotations",
  "useCitations",
  "useOrphanedFootnotes",
];

/** The dependency-array text of every `useCallback(` in `src`: walk to the
 *  call's matching close paren, then take its trailing `[...]`. */
function callbackDeps(src: string): string[] {
  const out: string[] = [];
  let at = src.indexOf("useCallback(");
  while (at !== -1) {
    let depth = 0;
    let end = -1;
    for (let i = at + "useCallback".length; i < src.length; i++) {
      const ch = src[i];
      if (ch === "(") depth++;
      else if (ch === ")" && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end === -1) break;
    const body = src.slice(at, end);
    const open = body.lastIndexOf("[");
    const close = body.lastIndexOf("]");
    if (open !== -1 && close > open && /^\s*,?\s*$/.test(body.slice(close + 1))) {
      out.push(body.slice(open, close + 1));
    }
    at = src.indexOf("useCallback(", end);
  }
  return out;
}

describe("card-hook mutators read state through stateRef — CENSUS (task 1164)", () => {
  for (const hook of CARD_HOOKS) {
    it(`${hook}: no useCallback dep names render-closure state`, () => {
      const src = readFileSync(resolve(SRC_HOOKS, `${hook}.ts`), "utf8");
      const aliases = [
        ...src.matchAll(new RegExp(`\\n {2}const (\\w+) = state\\.${COLLECTION};`, "g")),
      ].map((m) => m[1]);
      const forbidden = new RegExp(
        `(?<![\\w.])(state\\.${COLLECTION}\\b${aliases.map((a) => `|${a}`).join("")})(?![\\w])`,
      );
      const deps = callbackDeps(src);
      const offenders = deps.filter((d) => forbidden.test(d));
      expect(
        offenders,
        `${hook}: a useCallback lists render-closure state as a dep (${offenders.join(" ; ")}). ` +
          `Read \`stateRef.current.<field>\` inside the callback and depend on \`stateRef\` ` +
          `(stable) — a state dep re-identifies the mutator on every card edit.`,
      ).toEqual([]);
    });
  }

  it("the walker sees the mutators (non-vacuous)", () => {
    const src = readFileSync(resolve(SRC_HOOKS, "useReports.ts"), "utf8");
    expect(callbackDeps(src).length).toBeGreaterThan(10);
    expect(callbackDeps(src).some((d) => d.includes("stateRef"))).toBe(true);
  });
});
