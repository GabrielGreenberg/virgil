/**
 * GUARDRAIL — the shell files carry no dead bindings (task 1275).
 *
 * The shell→pane migration moved behaviour out of `EditorLayout` into
 * `EditorPane` but left 52 bindings behind. Several were not noise: two dead
 * copies of the panel-side rule that CONTRADICTED `src/lib/panel-side.ts`,
 * dead confirm dialogs whose copy differed from the live ones, never-set state
 * that made a highlight branch unreachable. A dead copy of a live rule is a
 * fork waiting to be reconnected.
 *
 * `npm run lint` reports `no-unused-vars` only as a WARNING, and CI runs
 * vitest, not lint — so nothing stopped the residue accruing. This guard runs
 * the rule at ERROR over the shell files through the ESLint Node API (the
 * repo's own `eslint.config.mjs`, so the parser/plugins match `npm run lint`)
 * and fails on any hit. Also `no-unused-expressions`: a bare ternary used as a
 * statement is the same "dead-looking" shape and hid in EditorPane.
 *
 * Fix a red run by DELETING the binding (or the whole dead derivation), not by
 * renaming it `_x` — a hook called only for its side effects keeps the call
 * and drops the destructure.
 */
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { REPO_ROOT } from "@/lib/__tests__/_source-scan";

const SHELL_FILES = [
  "src/components/EditorLayout.tsx",
  "src/components/EditorPane.tsx",
  "src/components/panel-primitives.tsx",
  "src/components/FloatingPanel.tsx",
  "src/components/ActionsMenuPanel.tsx",
  "src/components/RichTextField.tsx",
];

const RULES = new Set([
  "@typescript-eslint/no-unused-vars",
  "@typescript-eslint/no-unused-expressions",
]);

describe("shell unused-bindings GUARDRAIL", () => {
  it(
    "the shell files lint clean of unused bindings and bare expressions",
    async () => {
      const eslint = new ESLint({
        cwd: REPO_ROOT,
        overrideConfig: {
          rules: {
            "@typescript-eslint/no-unused-vars": "error",
            "@typescript-eslint/no-unused-expressions": "error",
          },
        },
      });
      const results = await eslint.lintFiles(
        SHELL_FILES.map((f) => path.join(REPO_ROOT, f)),
      );
      const hits = results.flatMap((r) =>
        r.messages
          .filter((m) => m.ruleId && RULES.has(m.ruleId))
          .map(
            (m) =>
              `${path.relative(REPO_ROOT, r.filePath)}:${m.line} ${m.message}`,
          ),
      );
      expect(hits, `dead bindings in the shell:\n${hits.join("\n")}`).toEqual(
        [],
      );
      // Non-vacuous: every listed file was actually linted.
      expect(results.map((r) => path.relative(REPO_ROOT, r.filePath)).sort()).toEqual(
        [...SHELL_FILES].sort(),
      );
    },
    120_000,
  );
});
