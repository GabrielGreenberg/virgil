// @vitest-environment node
//
// Task 2026-08-08-313 — the WIRING guard for the UNBRIDGE obligation's MODE.
//
// The sibling `applied-splice-wiring-guardrail` asks whether each lifecycle door
// PASSES the obligation. This one asks a question one axis in: whether each
// writer of `ai-requests.json` DECIDES the mode it writes in, or forwards a
// decision made upstream. That distinction is the whole of task 313.
//
// THE ORIGINAL SHAPE, WHICH NO BEHAVIOURAL TEST COULD SEE. The morph leg was
// registered, reachable, and fired its unbridge exactly when the registry said
// it should (task 198 saw to that, and `lifecycle-unbridge.test.ts` asserted it
// — green throughout). What it did NOT do was say which mode to write in, so it
// inherited `bridgeCardAiRequestFlag`'s `"toggle"` default while its two sibling
// terminal transitions passed `"terminate"`. `"toggle"` matches only rows
// `isRequestOpen` calls open, and an answered-L3 row (`in-progress` + a
// non-empty `resultId`) is deliberately NOT open — so the write matched nothing,
// wrote nothing, threw nothing, and stranded the row on a routing-less kind that
// could never toggle again. Every test of the executor passed, because the
// executor was never the part that misbehaved: the call site was.
//
// So the guard reads SOURCE, per call site:
//
//   1. Every `bridgeCardAiRequestFlag(` call in production `src/` passes a 6th
//      argument. (The compiler enforces this too, since 313 removed the default
//      — kept here because the compiler's version is silent about WHY, and
//      because a future re-defaulting would disarm it without touching a test.)
//   2. Any call passing a string LITERAL mode is on `PERMITTED_LITERAL_MODES`,
//      with a justification. A literal means "this site decided", which is
//      legitimate exactly where the site IS the intent (archive resolves; an
//      AIWindow cancel retracts) and is the bug everywhere else.
//   3. No file under `src/cards/lifecycle/` spells a mode literal in CODE at
//      all. The lifecycle layer is where the decision now lives, in ONE function
//      (`unbridgeModeFor`) that answers from the event — a second literal in
//      there is the fork re-opening.
//
// Deliberately a grep, for the same reason the other allowlist guards in this
// repo are (keystroke sanctity, scroll repositioners, highlight-mark writers,
// container fit): the property is about the shape of the call, and types can
// express "you must pass something" but not "you must not have chosen it".

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const EXTS = [".ts", ".tsx"];
const CALL_FORM = "bridgeCardAiRequestFlag(";

/**
 * The sites that legitimately DECIDE a mode, because at each one the user
 * intent and the mode are the same fact. Anything not listed must forward a
 * mode it was given.
 */
const PERMITTED_LITERAL_MODES: Array<{
  file: string;
  mode: string;
  why: string;
}> = [
  // (none today — every `bridgeCardAiRequestFlag` call in production forwards.
  // The two intent decisions that DO exist live one layer up, at
  // `clearAiRequestForKind` / `clearLinkedAiRequest` in EditorPane, which
  // dispatch onto the panel-hook setters rather than calling the bridge.)
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "__tests__") continue; // tests exercise both modes on purpose
      walk(p, out);
    } else if (
      EXTS.some((e) => p.endsWith(e)) &&
      !p.endsWith(".test.ts") &&
      !p.endsWith(".test.tsx")
    ) {
      out.push(p);
    }
  }
  return out;
}

/** Balanced-paren argument slice from a call's opening paren. */
function argSlice(src: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return src.slice(openParen + 1, i);
    }
  }
  return src.slice(openParen + 1);
}

/** Split an argument list on TOP-LEVEL commas (object/array/call args nest). */
function topLevelArgs(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      args.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = inner.slice(start).trim();
  if (tail) args.push(tail);
  return args;
}

/**
 * BLANK (don't remove) line + block comments, so prose ABOUT the calls isn't
 * mistaken for one — these files document the very shapes being flagged, and a
 * doc-block sketching the old buggy call is not a call. Comment characters
 * become spaces and newlines are preserved, so every reported line number still
 * points at real code. Naive about strings, which is the safe direction: a mode
 * literal inside a string is exactly what should be flagged.
 */
function blankComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^[ \t]*\/\/.*$/gm, blank);
}

interface Site {
  file: string;
  line: number;
  args: string[];
}

function collectSites(): Site[] {
  const sites: Site[] = [];
  for (const file of walk("src")) {
    const src = blankComments(readFileSync(file, "utf8"));
    let at = src.indexOf(CALL_FORM);
    while (at !== -1) {
      // Skip the declaration itself (`export async function bridgeCardAiRequestFlag(`).
      const before = src.slice(Math.max(0, at - 20), at);
      if (!/\bfunction\s+$/.test(before)) {
        sites.push({
          file,
          line: src.slice(0, at).split("\n").length,
          args: topLevelArgs(argSlice(src, at + CALL_FORM.length - 1)),
        });
      }
      at = src.indexOf(CALL_FORM, at + CALL_FORM.length);
    }
  }
  return sites;
}

const MODE_LITERAL = /^["'](toggle|terminate)["']$/;

describe("the ai-request unbridge MODE is forwarded, never re-decided (task 313)", () => {
  const sites = collectSites();

  it("finds the known bridge call sites (the guard itself is not silently dead)", () => {
    // 7 panel-hook setters + EditorPane's single lifecycle forwarder. If this
    // collapses, the grep stopped matching and the guard would "pass" while
    // checking nothing — the failure mode a coverage guard must never have.
    expect(sites.length).toBeGreaterThanOrEqual(8);
  });

  it("every call states a mode — none inherits one", () => {
    const silent = sites.filter((s) => s.args.length < 6);
    expect(
      silent.map((s) => `${s.file}:${s.line}`),
      "A writer of ai-requests.json must say whether it is a reversible flag " +
        "toggle or a terminal transition. Omitting the mode used to mean " +
        '"toggle", which silently preserved answered-L3 rows a departing card ' +
        "could never clear again (task 313).",
    ).toEqual([]);
  });

  it("no call HARD-CODES a mode outside the permitted intent sites", () => {
    const deciders = sites
      .filter((s) => s.args.length >= 6 && MODE_LITERAL.test(s.args[5]))
      .filter(
        (s) =>
          !PERMITTED_LITERAL_MODES.some(
            (p) => s.file.endsWith(p.file) && s.args[5].includes(p.mode),
          ),
      );
    expect(
      deciders.map((s) => `${s.file}:${s.line} — ${s.args[5]}`),
      "A hard-coded mode means this call site DECIDED. That is right only where " +
        "the site is the intent itself (archive resolves; an AIWindow cancel " +
        "retracts) — add it to PERMITTED_LITERAL_MODES with a why. Everywhere " +
        "else, forward the mode your caller gave you: for the lifecycle legs " +
        "that is `unbridgeModeFor(event.type)`, decided once in run-event.ts.",
    ).toEqual([]);
  });

  it("the lifecycle layer spells no mode literal at all — it derives them", () => {
    const offenders: string[] = [];
    for (const file of walk(join("src", "cards", "lifecycle"))) {
      const code = blankComments(readFileSync(file, "utf8"));
      for (const [i, line] of code.split("\n").entries()) {
        // The one sanctioned place a literal may appear is the return of
        // `unbridgeModeFor` itself, which is the SSOT this guard protects.
        if (/["'](toggle|terminate)["']/.test(line) && !/^\s*return\s/.test(line)) {
          offenders.push(`${file}:${i + 1} — ${line.trim()}`);
        }
      }
    }
    expect(
      offenders,
      "`src/cards/lifecycle/` owns the mode DECISION, which lives in exactly one " +
        "function (`unbridgeModeFor`). A second literal in this layer is the " +
        "per-call-site fork re-opening.",
    ).toEqual([]);
  });
});
