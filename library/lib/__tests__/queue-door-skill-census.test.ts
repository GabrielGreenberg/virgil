/**
 * CENSUS — no skill retires a Library queue request by hand (task 1431).
 *
 * `library/scripts/queue_slot.py` states the queue contract once: a worker
 * CLAIMS before it works and retires only what it claimed (task 1291), and
 * every request kind — triage included, addressed by `--file` — has a door
 * (contract item 10). The intake skills still spelled retirement by hand:
 * `rm -f` of a slot, "delete its queue file", a `_triage-*.json` glob that
 * swept every other drop's request, and bare `retire` calls that took
 * whatever sat in the slot NOW (a request the user re-filed mid-run) as the
 * claimed one. This census kills the class in skill prose:
 *
 *   1. no code block removes a `.virgil/queue/` path;
 *   2. no prose line tells the reader to delete a queue file/entry;
 *   3. no skill globs the triage requests (`_triage-*`);
 *   4. every `queue_slot.py retire` names the request it claimed
 *      (`--requested-at`), and the same skill CLAIMS that kind;
 *   5. every skill that CLAIMS a kind also spells the claim's third verb,
 *      `queue_slot.py release` for that kind, naming its claim and its
 *      reason (`--requested-at`, `--error`) — task 1575. Without it every
 *      STOP after the claim stranded the request `running` for an hour:
 *      the app refused the user's re-file as "already being processed",
 *      merge-bibs counted a phantom writer, and the failure was never
 *      charged toward poisoning.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { readdirSync, readFileSync } from "node:fs";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILL_DIRS = ["library/skills", "editor/skills"];

function skills(): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  for (const dir of SKILL_DIRS) {
    const abs = path.join(REPO_ROOT, dir);
    for (const name of readdirSync(abs, { recursive: true }) as string[]) {
      if (!name.endsWith(".md") || name.includes("__tests__")) continue;
      out.push({ name: `${dir}/${name}`, text: readFileSync(path.join(abs, name), "utf8") });
    }
  }
  return out;
}

const codeBlocks = (text: string) => text.match(/```[\s\S]*?```/g) ?? [];
const prose = (text: string) => text.replace(/```[\s\S]*?```/g, "");

describe("CENSUS: skills retire queue requests only through the claimed door (task 1431)", () => {
  const all = skills();

  it("finds the skills it censuses", () => {
    expect(all.some((s) => s.name.endsWith("library/skills/triage-pdf.md"))).toBe(true);
  });

  it("no code block removes a .virgil/queue/ file", () => {
    const offenders: string[] = [];
    for (const { name, text } of all) {
      for (const block of codeBlocks(text)) {
        for (const line of block.split("\n")) {
          if (/\.virgil\/queue\//.test(line) && /\brm\b|\bunlink\b|os\.remove/.test(line)) {
            offenders.push(`${name}: ${line.trim()}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no prose tells the reader to delete a queue file or entry", () => {
    const offenders: string[] = [];
    for (const { name, text } of all) {
      for (const line of prose(text).split("\n")) {
        if (/\bnever\b|\bnot\b|n't\b/i.test(line)) continue;
        if (/\bdelet\w*\b[^.\n]{0,40}\bqueue (file|entry)/i.test(line)) {
          offenders.push(`${name}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no skill globs the triage requests", () => {
    const offenders = all.filter(({ text }) => /_triage-\*/.test(text)).map((s) => s.name);
    expect(offenders).toEqual([]);
  });

  it("every queue_slot.py retire names its claim, and the skill claims that kind", () => {
    const offenders: string[] = [];
    for (const { name, text } of all) {
      const claimed = new Set(
        [...text.matchAll(/queue_slot\.py claim --kind (\S+)/g)].map((m) => m[1]),
      );
      for (const m of text.matchAll(/queue_slot\.py retire --kind (\S+)[^\n]*/g)) {
        if (!m[0].includes("--requested-at")) offenders.push(`${name}: ${m[0]} (no --requested-at)`);
        if (!claimed.has(m[1])) {
          offenders.push(`${name}: retires ${m[1]} but never claims it`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every skill that claims a kind can release that claim (task 1575)", () => {
    const offenders: string[] = [];
    for (const { name, text } of all) {
      const released = new Set(
        [...text.matchAll(/queue_slot\.py release --kind (\S+)/g)].map((m) => m[1]),
      );
      for (const m of text.matchAll(/queue_slot\.py claim --kind (\S+)/g)) {
        if (!released.has(m[1])) offenders.push(`${name}: claims ${m[1]} but never releases it`);
      }
      for (const m of text.matchAll(/queue_slot\.py release --kind (\S+)[^\n]*/g)) {
        if (!m[0].includes("--requested-at")) offenders.push(`${name}: ${m[0]} (no --requested-at)`);
        if (!m[0].includes("--error")) offenders.push(`${name}: ${m[0]} (no --error)`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
