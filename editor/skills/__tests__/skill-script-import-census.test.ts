// @vitest-environment node
//
// A skill reaches the helper scripts by their BUNDLE PATH, never by a dotted
// Python import (task 1313).
//
// `sync-bib-to-library` closed its run with
// `python3 -c "from editor.scripts._common import append_notification, …"`.
// That dotted path resolves only with cwd = the Virgil source repo (namespace
// packages — there is no `editor/__init__.py`); in a paper folder the helpers
// live at `.virgil/scripts/editor/`, so the import raised ModuleNotFoundError
// and the app was never told the run finished. Worse, the two helpers it called
// were the only `_common` writers that bypassed the editing pen, kept alive by
// that one line of prose.
//
// So: every write goes through a SCRIPT (`apply_response.py`, `create_card.py`,
// the library shims), invoked by path — the form every other step already uses.
// A Task-less run closes through `apply_response.py <doc> notify`. This census
// forbids the inline-import spelling in every skill document, and pins that the
// deleted standalone writers stay deleted.

import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { walkFiles } from "../../../src/lib/__tests__/_source-scan";

// editor/skills/__tests__/ → repo root is three levels up.
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

const SKILL_ROOTS = ["editor/skills", "library/skills"] as const;

const mdUnder = (root: string): string[] =>
  walkFiles(join(REPO, root), { skipDirs: ["__tests__"] })
    .filter((abs) => abs.endsWith(".md"))
    .map((abs) => relative(REPO, abs));

/** `from editor.scripts…` / `import library.scripts…` — the source-repo-only spelling. */
const INLINE_IMPORT = /\b(?:from|import)\s+(?:editor|library)\.scripts\b/;

describe("skill → script door CENSUS (task 1313)", () => {
  const files = SKILL_ROOTS.flatMap(mdUnder);

  it("walks a real tree", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain("editor/skills/sync-bib-to-library.md");
  });

  it("no skill document imports the helper scripts as a dotted Python package", () => {
    const hits: string[] = [];
    for (const rel of files) {
      read(rel)
        .split("\n")
        .forEach((line, i) => {
          if (INLINE_IMPORT.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits, "invoke the script by its bundle path (python3 \"$scripts_dir/<script>.py\" …) instead").toEqual([]);
  });

  it("sync-bib-to-library closes its run through `apply_response.py … notify`", () => {
    const md = read("editor/skills/sync-bib-to-library.md");
    expect(md).toMatch(/python3 "\$scripts_dir\/apply_response\.py" "<docPath>" notify\b/);
  });

  it("`notify` is a declared subcommand of the writeback door", () => {
    const py = read("editor/scripts/apply_response.py");
    const subs = py.slice(py.indexOf("SUBCOMMANDS = {"), py.indexOf("}", py.indexOf("SUBCOMMANDS = {")));
    expect(subs).toContain('"notify"');
    expect(py).toMatch(/def cmd_notify\(/);
  });

  it("the unpenned standalone notification/version writers stay deleted", () => {
    const common = read("editor/scripts/_common.py");
    for (const name of ["append_notification", "bump_version", "notification_appended", "version_bumped"]) {
      expect(common, name).not.toMatch(new RegExp(`def ${name}\\(`));
    }
  });
});
