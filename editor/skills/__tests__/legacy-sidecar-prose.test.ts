// @vitest-environment node
//
// No skill describes a RETIRED sidecar as live (task 811).
//
// Task 726 retired `examples.json` — the app neither reads nor writes it, and
// `src/lib/sidecar-value.ts` declares it `legacy: true`. Two skill docs the
// agent actually reads were missed and went on teaching the old model:
// create-card.md said the app "reconciles it from the `.tex` on parse" (a
// maintained shadow), link-cards.md called it "the app's `\ex`-derived
// projection". The refusals in the scripts were right; the prose told an agent
// a file exists and is kept current by the app.
//
// The class is "a skill doc describes a sidecar the app has declared legacy",
// so the census DERIVES its vocabulary from the value table's `legacy` column —
// the next retirement is covered with no edit here. A sentence that names a
// legacy file together with a live-ness verb must also say `retired`/`legacy`.
// Sentences, not lines: skill prose is hard-wrapped, and the stale create-card
// claim split its filename and its verb across two lines. Empty allowlist.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LEGACY_SIDECAR_FILENAMES } from "@/lib/sidecar-value";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SKILL_DIRS = ["editor/skills", "virgil/skills", "library/skills"];

const LIVE_VERB = /\b(shadow|reconcil\w*|projection|derived|mirror\w*|re-derive\w*)\b/i;
const RETIRED = /\b(retired|legacy)\b/i;

function skillFiles(): string[] {
  return SKILL_DIRS.flatMap((dir) => {
    const abs = join(REPO, dir);
    if (!existsSync(abs)) return [];
    return readdirSync(abs)
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(dir, f));
  });
}

/** Unwrap hard-wrapped prose into paragraphs (blank line, list item, table
 *  row and heading are boundaries), then split each into sentences. */
function sentences(text: string): string[] {
  const paras: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) paras.push(cur.join(" "));
    cur = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^([-*+]|\d+\.|\||#|>)\s?/.test(line)) flush();
    cur.push(line);
  }
  flush();
  return paras.flatMap((p) => p.split(/(?<=[.;!?])\s+(?=[A-Z`*(])/));
}

function offendingSentences(text: string, legacy: readonly string[]): string[] {
  return sentences(text).filter(
    (s) => legacy.some((f) => s.includes(f)) && LIVE_VERB.test(s) && !RETIRED.test(s),
  );
}

describe("skill prose never describes a retired sidecar as live (task 811)", () => {
  it("derives a non-empty legacy vocabulary from the value table", () => {
    expect(LEGACY_SIDECAR_FILENAMES).toContain("examples.json");
  });

  it("no skill sentence names a legacy sidecar with a live-ness verb unless it says retired", () => {
    const offenders: string[] = [];
    for (const file of skillFiles()) {
      for (const s of offendingSentences(readFileSync(join(REPO, file), "utf8"), LEGACY_SIDECAR_FILENAMES)) {
        offenders.push(`${file}: ${s}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("catches the pre-811 create-card wording (wrapped across lines)", () => {
    const stale = [
      "- **`example`** is **tex-only**: the example *is* a TextObject in the `.tex`",
      "  (`\\vexid{}\\ex…\\xe`); `examples.json` is an",
      "  app-derived **shadow** (the app reconciles it from the `.tex` on parse), so the",
      "  skill writes only the `.tex`.",
    ].join("\n");
    expect(offendingSentences(stale, LEGACY_SIDECAR_FILENAMES)).toHaveLength(1);
  });

  it("catches the pre-811 link-cards wording", () => {
    const stale = [
      "  - an **`example`** — `examples.json` is the app's `\\ex`-derived projection, not",
      "    a writeback target, and a row lives only as long as its block.",
    ].join("\n");
    expect(offendingSentences(stale, LEGACY_SIDECAR_FILENAMES)).toHaveLength(1);
  });
});
