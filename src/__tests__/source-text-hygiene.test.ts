/**
 * Source-text hygiene: every text source file the repo ships is TEXT to grep.
 *
 * Task 432 — "a census can only see the files its grep can read".
 *
 * Four production files carried a raw NUL BYTE inside a string literal — a
 * composite-key separator typed as the byte itself rather than the `"\0"`
 * escape (`live.join("<NUL>")`, `` `${a}<NUL>${b}` ``). The runtime string is
 * identical either way. What differs is what `grep` makes of the FILE: one
 * byte below 0x20 and the whole file is "binary", every match is reported as
 * `Binary file … matches` — and the zsh `grep` wrapper every worker, auditor and
 * catcher reaches for SUPPRESSES those lines entirely. So
 * `disk-watcher.tsx`, the one production caller of `createSidecarWatcher`, was
 * invisible to a shell census, and task 415's worker filed "built, tested, and
 * MOUNTED NOWHERE" about a watcher that had been mounted for seven weeks.
 * Gabriel then ruled on a decision (mount vs delete) that did not exist.
 *
 * The repo's OWN censuses (`_source-scan.ts` + ~40 guardrail suites) read
 * files through Node and were never fooled — which is precisely why nothing
 * noticed: the instruments that could see the file agreed with each other, and
 * the instrument that could not is the one humans and agents use at the shell.
 *
 * Rule: a text source file contains no control byte other than TAB / LF / CR.
 * A NUL separator is spelled `"\0"`. Population DISCOVERED from `git ls-files`
 * (the repo's own "what ships" door, task 429), never a hand list.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { trackedFiles } from "../lib/__tests__/_source-scan";

const REPO_ROOT = path.resolve(__dirname, "../..");

/** Text source the shell censuses grep. Binary assets (images, fonts, PDFs,
 *  wasm) are out of population by construction — the filter is on EXTENSION,
 *  so a new text format joins by being named here. */
const TEXT_EXT =
  /\.(ts|tsx|js|mjs|cjs|css|md|py|json|sh|yml|yaml|txt|tex|bib|html|svg)$/;

const ROOTS = ["src", "library", "editor", "tools", "scripts", "docs", "."];

/** Bytes that make grep call a file binary. TAB (9), LF (10), CR (13) are text. */
function controlByteOffsets(buf: Buffer): number[] {
  const out: number[] = [];
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b < 0x20 && b !== 9 && b !== 10 && b !== 13) out.push(i);
  }
  return out;
}

function lineOf(buf: Buffer, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset; i++) if (buf[i] === 10) n++;
  return n;
}

function population(): string[] {
  const seen = new Set<string>();
  for (const root of ROOTS) {
    for (const abs of trackedFiles(root, TEXT_EXT)) {
      // `trackedFiles(".")` returns the whole tree; dedupe across roots.
      seen.add(abs);
    }
  }
  return [...seen].sort();
}

describe("source-text hygiene: no text source file is binary to grep", () => {
  it("has a population that includes the file the defect hid in", () => {
    const pop = population().map((p) => path.relative(REPO_ROOT, p));
    expect(pop).toContain(
      "src/components/editor-layout/contexts/disk-watcher.tsx",
    );
    expect(pop.length).toBeGreaterThan(500);
  });

  it("contains no control byte other than TAB/LF/CR (allowlist EMPTY)", () => {
    const offenders: string[] = [];
    for (const abs of population()) {
      const buf = fs.readFileSync(abs);
      const bad = controlByteOffsets(buf);
      if (bad.length === 0) continue;
      const rel = path.relative(REPO_ROOT, abs);
      const first = bad[0];
      offenders.push(
        `${rel}:${lineOf(buf, first)} — ${bad.length} control byte(s), first 0x${buf[first]
          .toString(16)
          .padStart(2, "0")}. Spell a NUL separator as "\\0"; grep reads this file as BINARY and every shell census skips it.`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it("the detector sees a raw NUL where the escape is fine (canary)", () => {
    // Synthetic, not standing on a drained production line.
    expect(controlByteOffsets(Buffer.from('a.join("\\0")', "utf8"))).toEqual([]);
    expect(controlByteOffsets(Buffer.from("a.join(\"\0\")", "utf8"))).toHaveLength(1);
    expect(controlByteOffsets(Buffer.from("x\ty\r\n", "utf8"))).toEqual([]);
  });
});
