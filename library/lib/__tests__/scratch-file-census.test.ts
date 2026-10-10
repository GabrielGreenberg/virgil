// @vitest-environment node
//
// The cross-silo SCRATCH-FILE census (task 2026-10-10-1050).
//
// The editor silo had a load-bearing scratch rule since task 466 — "`mktemp`,
// never a fixed name" (`editor/skills/_op-json.md`) — but it was stated for
// ONE kind of file (an `apply_response.py` op) and held by a census that only
// classifies those ops and `create_card.py` flags. Every OTHER scratch file in
// either silo was outside it, and the rule never crossed to the library at
// all: measured at 5ae70030, 15 library skills plus the editor's
// sync-bib-to-library wrote ~120 fixed `/tmp/…` paths and minted none. The
// worst was merge-bibs' run state — one library-agnostic env file every later
// block SOURCED and then `cd`-ed by, so a second merge on another library
// steered the first run into writing the OTHER library. A citekey-derived
// name does not help: two runs on ONE key (a queue drain + a typed command)
// are exactly the collision.
//
// The rule now lives ONCE, in `_scratch.md` (a byte-identical twin in each
// silo so each bundle's links resolve). This census holds it:
//
//   1. NO FIXED SCRATCH PATH anywhere in any skill markdown, in any silo —
//      prose included (a prompt's prose is run as surely as its fences are;
//      iterate-skill's fixed path lived in a blockquoted subagent prompt).
//      Silos are DISCOVERED (every top-level `*/skills/`), files are
//      discovered, allowlist EMPTY: a hit is MINT-it, never list-it.
//   2. CARRY MEANS MINT. A skill that spells the carried `<runDir>` literal
//      mints one (`mktemp -d`) and names the doctrine — a `<runDir>` with no
//      minting step is a fixed name with extra steps.
//   3. NO `$ARGUMENTS` IN AN INCLUDE'S FENCES. An `_`-include is never
//      invoked as a command, so nothing substitutes it; `_doctrine.md`'s
//      metadata-lock recipe ran with an empty citekey. (Prose may NAME the
//      variable — the doctrine has to, to forbid it; only a fence runs.)
//   4. The twin is byte-identical, and `_op-json.md` points at it.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { fenceBlocks } from "./_shell-fence";
import { walkFiles } from "../../../src/lib/__tests__/_source-scan";

const REPO_ROOT = path.resolve(__dirname, "../../..");

/** A literal path under a temp root that something WRITES or READS by name. */
const FIXED_SCRATCH =
  /(?<![\w.~$-])\/(?:private\/|var\/)?tmp\/|\$\{?TMPDIR(?::-[^}]*)?\}?\//g;

/** Each fixed-scratch hit in `source`, as `line: text`. */
function fixedScratchHits(source: string): string[] {
  const hits: string[] = [];
  source.split("\n").forEach((line, i) => {
    if (FIXED_SCRATCH.test(line)) hits.push(`${i + 1}: ${line.trim()}`);
    FIXED_SCRATCH.lastIndex = 0;
  });
  return hits;
}

/** Each `$ARGUMENTS` / `${ARGUMENTS}` occurrence in `source`, as `line: text`. */
function argumentsHits(source: string): string[] {
  return source
    .split("\n")
    .flatMap((line, i) =>
      /\$\{?ARGUMENTS\b/.test(line) ? [`${i + 1}: ${line.trim()}`] : [],
    );
}

/** Every top-level directory that authors skills: `<silo>/skills/`. */
function skillDirs(): string[] {
  return readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
    .map((d) => path.join(d.name, "skills"))
    .filter((d) => existsSync(path.join(REPO_ROOT, d)))
    .sort();
}

/** Every skill markdown under the discovered dirs (tests excluded), repo-relative. */
function skillMarkdown(): string[] {
  return skillDirs()
    .flatMap((d) => walkFiles(path.join(REPO_ROOT, d), { skipDirs: ["__tests__"] }))
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.relative(REPO_ROOT, f))
    .sort();
}

const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

describe("scratch-file census (cross-silo, task 1050)", () => {
  const files = skillMarkdown();

  it("discovers both silos' skills", () => {
    expect(skillDirs()).toEqual(
      expect.arrayContaining(["editor/skills", "library/skills"]),
    );
    expect(files).toContain("library/skills/merge-bibs.md");
    expect(files).toContain("editor/skills/sync-bib-to-library.md");
  });

  it("the detector is red on a planted fixed path and green on minted scratch", () => {
    expect(fixedScratchHits('cat > /tmp/foo.json <<\'EOF\'')).toHaveLength(1);
    expect(fixedScratchHits('--patch-file "/tmp/$CITEKEY-x.json"')).toHaveLength(1);
    expect(fixedScratchHits('cat > "$TMPDIR/foo.json"')).toHaveLength(1);
    expect(fixedScratchHits('d="${TMPDIR:-/tmp}/run"')).toHaveLength(1);
    expect(fixedScratchHits(". /private/tmp/run.env")).toHaveLength(1);
    expect(fixedScratchHits("f=$(mktemp -t virgil-x)")).toEqual([]);
    expect(fixedScratchHits('cat > "$t/patch.json"')).toEqual([]);
    expect(fixedScratchHits(". <runDir>/run.json.env")).toEqual([]);
    expect(fixedScratchHits("Scratch lives in `$TMPDIR`, never a fixed name.")).toEqual([]);
    expect(argumentsHits('update_catalog_entry.py "$ARGUMENTS"')).toHaveLength(1);
    expect(argumentsHits('update_catalog_entry.py "<citekey>"')).toEqual([]);
  });

  it("no skill markdown in any silo names a fixed scratch path", () => {
    const offenders = files.flatMap((f) =>
      fixedScratchHits(read(f)).map((h) => `${f}:${h}`),
    );
    expect(
      offenders,
      "mint scratch with `mktemp` (one call) or a carried `<runDir>` " +
        "(several calls) — see _scratch.md",
    ).toEqual([]);
  });

  it("a skill that carries <runDir> mints it and names the doctrine", () => {
    const offenders = files.filter((f) => {
      const src = read(f);
      if (!src.includes("<runDir>") || path.basename(f) === "_scratch.md") return false;
      return !/mktemp -d/.test(src) || !src.includes("_scratch.md");
    });
    expect(offenders).toEqual([]);
  });

  it("no underscore include spells $ARGUMENTS (an include is never substituted)", () => {
    const offenders = files
      .filter((f) => path.basename(f).startsWith("_"))
      .flatMap((f) =>
        fenceBlocks(f, read(f)).flatMap((b) =>
          argumentsHits(b.body.join("\n")).map((h) => `${f}:fence@${b.openLine}:${h}`),
        ),
      );
    expect(offenders, "spell the input as a placeholder (`<citekey>`)").toEqual([]);
  });

  it("ships _scratch.md byte-identical in each silo, and _op-json.md points at it", () => {
    expect(read("editor/skills/_scratch.md")).toBe(read("library/skills/_scratch.md"));
    expect(read("editor/skills/_op-json.md")).toContain("](_scratch.md)");
  });
});
