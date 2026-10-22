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
//   - each builder's native accept set is read out of `create_card.py`'s own
//     dict literals, so a door change re-shapes the census, not a copy here.
//
// Scope: calls handed a REAL request id (`<requestId>` / `<id>`). A
// `virtual:<panel>:<cardId>` id has no Task row, so its kind is never checked.

import { describe, it, expect } from "vitest";

import { readRepo as read, reviewRoutes } from "./_review-routes";

const CREATE_CARD = "editor/scripts/create_card.py";

/** Parse a `NAME = { "k": {"a", "b"}, "k2": set(), … }` literal out of the door. */
function pyKindTable(src: string, name: string): Record<string, Set<string>> {
  const m = new RegExp(`^${name}\\s*=\\s*\\{([\\s\\S]*?)^\\}|^${name}\\s*=\\s*\\{(.*)\\}\\s*$`, "m").exec(src);
  expect(m, `${name} not found in ${CREATE_CARD}`).toBeTruthy();
  const body = m![1] ?? m![2];
  const out: Record<string, Set<string>> = {};
  for (const e of body.matchAll(/"([a-z-]+)"\s*:\s*(\{[^}]*\}|set\(\))/g)) {
    out[e[1]] = new Set([...e[2].matchAll(/"([a-z-]+)"/g)].map((x) => x[1]));
  }
  expect(Object.keys(out).length, `${name} parsed empty`).toBeGreaterThan(0);
  return out;
}

const door = read(CREATE_CARD);
const NATIVE: Record<string, Set<string>> = {
  ...pyKindTable(door, "WORKFLOW_A_KINDS"),
  ...pyKindTable(door, "RESPONDER_TASK_KINDS"),
};

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
