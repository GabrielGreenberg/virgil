/**
 * The workspace entry doc points every folder's agent at the LaTeX allowlist
 * (task 1349).
 *
 * The allowlist (`editor/skills/_latex-allowlist.md`) is the one statement of
 * which LaTeX forms Virgil RENDERS; anything else shows as a grey raw-code
 * span. It is an underscore include, so only a skill prompt that links it
 * loads it — and the commonest cowork mode is no skill at all: an agent
 * editing the `.tex` directly at the user's request. That agent wrote a named
 * `\textcolor{blue}{…}`, which compiles but renders grey, and then found no
 * guidance by grepping.
 *
 * The one doc Claude Code auto-loads in EVERY synced folder (paper or
 * library) is the workspace entry point, `library/scripts/skill-bundle-template/
 * CLAUDE.md` → `.claude/CLAUDE.md`. So the pointer lives there, and this suite
 * pins it from the SSOTs rather than from constants:
 *   1. the entry doc ships, and lands at the auto-loaded `.claude/CLAUDE.md`;
 *   2. its SHIPPED bytes carry a markdown link that resolves, on disk, to the
 *      allowlist's own shipped disk path — so renaming or un-shipping the
 *      allowlist leaves the link un-rewritten and goes red here;
 *   3. it is a POINTER, not a restatement (task 803 / 1348): no allowlisted
 *      command form is spelled in the entry doc, so no second copy can drift.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { posix, resolve, join } from "node:path";
import { shippedPathMap, shippedBytes, shippedSources } from "../../build/bundle-sources.mjs";

const ROOT = resolve(__dirname, "../../..");
const ENTRY = "library/scripts/skill-bundle-template/CLAUDE.md";
const ALLOWLIST = "editor/skills/_latex-allowlist.md";

describe("workspace entry doc → LaTeX allowlist pointer", () => {
  it("ships the entry doc to the auto-loaded .claude/CLAUDE.md", async () => {
    const lib = await shippedSources(ROOT, "library");
    expect(lib.some((s) => s.repoPath === ENTRY)).toBe(true);
    const map = await shippedPathMap(ROOT);
    expect(map.get(ENTRY)).toBe(".claude/CLAUDE.md");
  });

  it("its shipped bytes link to the allowlist's shipped disk path", async () => {
    const map = await shippedPathMap(ROOT);
    const allowDisk = map.get(ALLOWLIST);
    expect(allowDisk, "the allowlist must ship to paper folders").toBeTruthy();
    const entryDisk = map.get(ENTRY)!;
    const shipped = shippedBytes(ENTRY, readFileSync(join(ROOT, ENTRY), "utf8"), map);
    const hrefs = [...shipped.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
    const resolved = hrefs.map((h) => posix.normalize(posix.join(posix.dirname(entryDisk), h)));
    expect(resolved).toContain(allowDisk);
    // The folder-relative spelling an agent reads (and can `cat`) is named too.
    expect(shipped).toContain(allowDisk!);
  });

  it("points at the allowlist without restating any of its forms", () => {
    const src = readFileSync(join(ROOT, ENTRY), "utf8");
    const allow = readFileSync(join(ROOT, ALLOWLIST), "utf8");
    const forms = new Set([...allow.matchAll(/`(\\[A-Za-z]+)/g)].map((m) => m[1]));
    expect(forms.size).toBeGreaterThan(10);
    const restated = [...forms].filter((f) => new RegExp(`\\${f}(?![A-Za-z])`).test(src));
    expect(restated).toEqual([]);
  });
});
