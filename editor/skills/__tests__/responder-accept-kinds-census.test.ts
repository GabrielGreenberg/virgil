// @vitest-environment node
//
// CENSUS — every create call a responder teaches ACCEPTS every Task kind that
// responder drains (task 1233).
//
// `create_card.py`'s `_resolve_context` refuses a real Task whose kind is not
// in the call's accept set: the builder's NATIVE set (`WORKFLOW_A_KINDS` for
// the carded kinds, `RESPONDER_TASK_KINDS` for suggestion/comment) ∪ every
// `--accept-task-kind` flag. A responder that drains more than one Task kind
// must therefore declare each foreign kind on EVERY create call it documents —
// one forgotten branch and a Task the umbrella routes to it dies before any
// write. `answer-note-request` drains `note` AND `highlight`; its paths (b),
// (c), (d) declared `highlight`, path (a) — the suggestion branch — did not,
// so every highlighted passage the user wanted rewritten was refused.
//
// Both halves are DERIVED, never hand-listed:
//   - the kinds a skill drains come from `/editor/review`'s dispatch table
//     (`reviewRoutes()`, itself pinned to the routing manifest by
//     `dispatch-coverage.test.ts`);
//   - each builder's native accept set is the door's own LIVE value, dumped by
//     importing `create_card.py` (task 1629: `WORKFLOW_A_KINDS` is DERIVED from
//     the routing manifest now, so there is no literal left to parse), so a
//     door change re-shapes the census, not a copy here.
//
// Scope: calls handed a REAL request id (`<requestId>` / `<id>`). A
// `virtual:<panel>:<cardId>` id has no Task row, so its kind is never checked.

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { readRepo as read, repoRoot, reviewRoutes } from "./_review-routes";

const CREATE_CARD = "editor/scripts/create_card.py";

/** The door's native accept sets, read from the imported module — not its source. */
function nativeAcceptSets(): Record<string, Set<string>> {
  const dumped = execFileSync(
    "python3",
    [
      "-c",
      [
        `import sys, json; sys.path.insert(0, ${JSON.stringify(join(repoRoot, "editor/scripts"))})`,
        "import create_card as CC",
        "print(json.dumps({k: sorted(v) for t in (CC.WORKFLOW_A_KINDS, CC.RESPONDER_TASK_KINDS)",
        "  for k, v in t.items()}))",
      ].join("\n"),
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const raw = JSON.parse(dumped) as Record<string, string[]>;
  expect(Object.keys(raw).length, `${CREATE_CARD} accept sets dumped empty`).toBeGreaterThan(0);
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, new Set(v)]));
}

const NATIVE: Record<string, Set<string>> = nativeAcceptSets();

interface Call {
  file: string;
  line: number;
  kind: string;
  accepts: Set<string>;
}

/** Every `create_card.py <docPath> <requestId|id> …` command, `\`-continuations joined. */
function realIdCreateCalls(file: string): Call[] {
  const lines = read(file).split("\n");
  const out: Call[] = [];
  lines.forEach((l, i) => {
    if (!/create_card\.py\s+<docPath>\s+<(?:requestId|id)>/.test(l)) return;
    let cmd = l;
    for (let j = i; /\\\s*$/.test(lines[j]) && j + 1 < lines.length; j++) cmd += " " + lines[j + 1];
    const kind = /--kind=([a-z<>-]+)/.exec(cmd)?.[1];
    if (!kind) return;
    const accepts = new Set([...cmd.matchAll(/--accept-task-kind\s+([a-z-]+)/g)].map((x) => x[1]));
    out.push({ file, line: i + 1, kind, accepts });
  });
  return out;
}

const routes = reviewRoutes();
const DRAINED = new Map<string, Set<string>>();
for (const r of routes) {
  if (!DRAINED.has(r.file)) DRAINED.set(r.file, new Set());
  DRAINED.get(r.file)!.add(r.kind);
}
const RESPONDERS = [...DRAINED.keys()].sort();
const CALLS = RESPONDERS.flatMap(realIdCreateCalls);

describe("responder create calls — accept-kind CENSUS (task 1233)", () => {
  // The can-see canary: every leg below passes vacuously on an empty parse.
  it("derives a non-trivial population from the door and the umbrella", () => {
    expect([...NATIVE.note]).toEqual(["note"]);
    expect([...NATIVE.suggestion]).toEqual(["suggestion"]);
    expect([...DRAINED.get("editor/skills/answer-note-request.md")!].sort()).toEqual([
      "highlight",
      "note",
    ]);
    expect(CALLS.length).toBeGreaterThanOrEqual(15);
    expect(CALLS.filter((c) => c.file.endsWith("answer-note-request.md")).length)
      .toBeGreaterThanOrEqual(4);
  });

  it("every call's --kind has a builder the door declares", () => {
    const unknown = CALLS.filter((c) => !NATIVE[c.kind]).map((c) => `${c.file}:${c.line} --kind=${c.kind}`);
    expect(unknown).toEqual([]);
  });

  it.each(RESPONDERS)("%s — every real-id create call accepts every Task kind it drains", (file) => {
    const drained = DRAINED.get(file)!;
    const misses: string[] = [];
    for (const c of CALLS.filter((x) => x.file === file)) {
      const accepted = new Set([...(NATIVE[c.kind] ?? []), ...c.accepts]);
      const missing = [...drained].filter((k) => !accepted.has(k));
      if (missing.length) {
        misses.push(
          `${file}:${c.line} --kind=${c.kind} refuses a ${missing.join("/")} Task — ` +
            `add ${missing.map((k) => `--accept-task-kind ${k}`).join(" ")}`,
        );
      }
    }
    expect(misses).toEqual([]);
  });
});
