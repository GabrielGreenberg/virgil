/**
 * SUGGESTION-FIELD VOCABULARY CENSUS (task 1162).
 *
 * `SuggestionField` (and the handler shape `SuggestionFieldUpdater`) live ONCE,
 * in `suggestion-field-vocabulary.ts`. Before this task the five-member union
 * was hand-respelled at ten `updateSuggestionField`-shaped signatures across
 * the hooks, panels, omni builders and hosts — so a field added to the
 * vocabulary had to be typed into ten places by hand. This census pins that no
 * non-test source outside the vocabulary module spells the union inline.
 *
 * Second leg: `CutterSuggestionCard` used to re-export `CopyButton` /
 * `FieldTitleRow` "for backward compatibility" with zero importers, under two
 * comments calling them load-bearing (law: a registry earns its name by being
 * read — a re-export is not a caller). Its export surface is now exactly the
 * card and its trailing.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { commentsStripped, REPO_ROOT, walkFiles } from "@/lib/__tests__/_source-scan";

const VOCABULARY = "src/panels/_shared/suggestion-field-vocabulary.ts";

/** Two adjacent members of the union, in either order — the signature of an
 *  inline respelling (a lone `"original_text"` literal is an ordinary value). */
const INLINE_UNION =
  /"original_text"\s*\|\s*"suggested_text"|"suggested_text"\s*\|\s*"original_text"/;

describe("suggestion-field vocabulary CENSUS", () => {
  it("no source outside the vocabulary module spells the SuggestionField union inline", () => {
    const offenders: string[] = [];
    for (const root of ["src", "editor", "library"]) {
      for (const abs of walkFiles(path.join(REPO_ROOT, root))) {
        if (!/\.tsx?$/.test(abs)) continue;
        const rel = path.relative(REPO_ROOT, abs);
        if (rel === VOCABULARY || rel.includes("__tests__")) continue;
        const code = commentsStripped(fs.readFileSync(abs, "utf8"));
        if (INLINE_UNION.test(code)) offenders.push(rel);
      }
    }
    expect(
      offenders,
      `import SuggestionField / SuggestionFieldUpdater from ${VOCABULARY} instead`,
    ).toEqual([]);
  });

  it("the vocabulary module still owns the union and the updater type", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, VOCABULARY), "utf8");
    expect(src).toMatch(/export type SuggestionField\s*=/);
    expect(src).toMatch(/export type SuggestionFieldUpdater\s*=/);
  });

  it("CutterSuggestionCard exports only the card and its trailing (no dead re-exports)", () => {
    const code = commentsStripped(
      fs.readFileSync(
        path.join(REPO_ROOT, "src/panels/Cutter/CutterSuggestionCard.tsx"),
        "utf8",
      ),
    );
    const exported = [
      ...code.matchAll(/\bexport\s+(?:function|const|class|type|interface)\s+(\w+)/g),
    ].map((m) => m[1]);
    const reexports = [...code.matchAll(/\bexport\s*(?:type\s*)?\{([^}]*)\}/g)].flatMap(
      (m) => m[1].split(",").map((s) => s.trim()).filter(Boolean),
    );
    expect(reexports).toEqual([]);
    expect(exported.sort()).toEqual(["CutterSuggestionCard", "CutterSuggestionTrailing"]);
  });
});
