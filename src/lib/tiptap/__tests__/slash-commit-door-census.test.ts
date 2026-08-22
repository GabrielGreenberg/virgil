/**
 * Task 398 — the CENSUS, and the leg with teeth.
 *
 * The verdict door was never the part that could misbehave; a call site that
 * doesn't ask it is. That is not a hypothetical here — it is literally what
 * shipped. `slash-popup.ts` and `latex-command.ts` each owned a PRIVATE copy of
 * the same three steps (resolve the name, DELETE the typed `\name`, run the
 * action), and each let the action refuse afterwards. A fix applied to the
 * popup alone would have closed the reported case and left the other door
 * eating the user's characters in the very same containers, with every
 * behavioural test of the popup green.
 *
 * So the rule is asserted at the source: **every production consumer of the
 * slash-command vocabulary commits through `commitSlashCommand`, and nobody
 * re-derives what `slash-applicability.ts` publishes.** Membership is
 * DISCOVERED (the files that IMPORT the vocabulary), never hand-listed — a hand
 * list inside a guard that outlaws hand lists could only be missing the door
 * that drifted.
 *
 * Every allowlist here is EMPTY. A hit is MIGRATE-it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
// TWO views of each file, and the split is load-bearing (the trap
// `_source-scan`'s own header documents, and the one task 389 was burned by):
//   • `withStrings` — comments blanked, string literals KEPT — for the needles
//     that ARE quoted text (the module specifier, `surface: "slash"`);
//   • `codeOnly` — literals blanked too — for the SYMBOL needles, because
//     `action-registry.ts` names `VIRGIL_COMMANDS` inside error-message
//     templates and would otherwise be indicted for prose.
import { codeOnly, codeOnlyLines, strip } from "@/lib/__tests__/_source-scan";

const withStrings = (src: string) => strip(src, true, true);

const SRC = join(process.cwd(), "src");
const LIB = join(process.cwd(), "library");

/** Every production `.ts`/`.tsx` under a root — suites and stories excluded. */
function productionFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === "__tests__" || name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(name)) continue;
      if (/\.test\.tsx?$/.test(name)) continue;
      out.push(full);
    }
  };
  walk(root);
  return out;
}

const PRODUCTION = [...productionFiles(SRC), ...productionFiles(LIB)];
const rel = (p: string) => p.slice(process.cwd().length + 1);

const COMMANDS_MODULE = join(SRC, "lib", "tiptap", "commands.ts");
const DOOR_MODULE = join(SRC, "lib", "tiptap", "slash-applicability.ts");
const BARREL = join(SRC, "lib", "tiptap", "index.ts");

/** Imports the slash-command module (relative or aliased). */
const IMPORTS_COMMANDS = /from\s+"(?:\.\/commands|\.\.\/commands|@\/lib\/tiptap\/commands)"/;

/**
 * A file that can RUN a slash command — it reaches a `VirgilCommand` (through
 * `COMMAND_MAP` or the array) or the door itself. Deliberately NARROWER than
 * "imports the module": `action-registry.ts` reads `VIRGIL_COMMAND_NAMES` for
 * its three-way slash reconciliation and executes nothing, so the vocabulary
 * NAMES are not the hazard — reaching a command's `action` is.
 */
const REACHES_AN_ACTION = /\bCOMMAND_MAP\b|\bVIRGIL_COMMANDS\b|\bcommitSlashCommand\b/;

function executorPopulation(): string[] {
  return PRODUCTION.filter((f) => {
    if (f === COMMANDS_MODULE || f === BARREL) return false;
    const src = readFileSync(f, "utf8");
    return (
      IMPORTS_COMMANDS.test(withStrings(src)) && REACHES_AN_ACTION.test(codeOnly(src))
    );
  });
}

describe("slash surface — one commit door", () => {
  it("the census can SEE the population (self-check)", () => {
    expect(PRODUCTION.length).toBeGreaterThan(400);
    expect(PRODUCTION).toContain(join(SRC, "lib", "tiptap", "slash-popup.ts"));
    expect(PRODUCTION).toContain(join(SRC, "lib", "tiptap", "latex-command.ts"));
  });

  /**
   * The membership leg. Discovered from the imports, so a THIRD executor is
   * covered by existing. The barrel is a pure re-export (it names the module in
   * an `export … from` clause, not an import) and is excluded by the needle
   * itself; it is asserted separately below so the exclusion cannot silently
   * grow.
   */
  it("every consumer of the slash vocabulary commits through the door", () => {
    const offenders: string[] = [];
    for (const file of executorPopulation()) {
      const code = codeOnly(readFileSync(file, "utf8"));
      // Reaching the raw lookup is HOW a private executor gets built — it is
      // exactly what both pre-398 doors imported.
      if (/\bCOMMAND_MAP\b|\bVIRGIL_COMMANDS\b/.test(code)) {
        offenders.push(`${rel(file)} — reaches a VirgilCommand directly (use commitSlashCommand)`);
        continue;
      }
      if (!/\bcommitSlashCommand\b/.test(code)) {
        offenders.push(`${rel(file)} — can run a slash command but never enters the door`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("both known executors are in the discovered population (canary)", () => {
    const consumers = executorPopulation().map(rel);
    // Both pre-398 delete-then-ask doors, so the leg above is not vacuous.
    expect(consumers).toContain("src/lib/tiptap/slash-popup.ts");
    expect(consumers).toContain("src/lib/tiptap/latex-command.ts");
  });

  /**
   * The ORDERING leg. The whole fix is that the ask happens BEFORE the delete;
   * a reorder inside the door is caught by the behavioural suite, and this
   * localizes the failure to the line that caused it.
   */
  it("the door ASKS before it deletes", () => {
    const src = codeOnlyLines(readFileSync(COMMANDS_MODULE, "utf8"));
    const body = src.slice(src.indexOf("export function commitSlashCommand"));
    const ask = body.indexOf("slashCommandEnabled(");
    const del = body.indexOf(".delete(");
    expect(ask, "the door must consult slashCommandEnabled").toBeGreaterThan(-1);
    expect(del, "the door must own the delete").toBeGreaterThan(-1);
    expect(ask).toBeLessThan(del);
  });

  /**
   * ONE verdict table. Forward-looking rather than a defect leg — the pre-398
   * popup asked NOTHING, so there was no second table to find. It is what stops
   * the next author from resolving a slash name against the registry inline
   * (which type-checks perfectly) instead of through the door.
   */
  it("nobody outside the door resolves a slash name against the registry", () => {
    const offenders: string[] = [];
    for (const file of executorPopulation()) {
      if (file === DOOR_MODULE) continue;
      const code = codeOnly(readFileSync(file, "utf8"));
      if (/\bSLASH_NAME_TO_ACTION_ID\b|\bVIRGIL_ACTION_REGISTRY\b/.test(code)) {
        offenders.push(rel(file));
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * ONE ctx constructor. The offer and the view-only commit must ask the same
   * question of the same object; a hand-built slash ctx is how the two come to
   * differ by a field nobody notices. Measured on the pre-398 tree this names
   * `commands.ts`, whose `runViewOnlyAction` built one inline.
   */
  it("only the door builds a slash ActionContext", () => {
    const offenders: string[] = [];
    for (const file of PRODUCTION) {
      if (file === DOOR_MODULE) continue;
      const lines = withStrings(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        if (!/surface:\s*"slash"/.test(line)) return;
        // A `runAction(id, { surface: "slash", payload })` OPTION bag is a
        // different shape and legitimate; a CONTEXT carries `canEdit` beside it.
        const window = lines.slice(Math.max(0, i - 4), i + 5).join("\n");
        if (/\bcanEdit\b/.test(window)) offenders.push(`${rel(file)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The popup RENDERS the verdict. The store can carry `disabled` and the
   * component ignore it — the dead-prop class this repo drained in task 106 —
   * and no test of the plugin can see that.
   */
  it("the popup component renders the disabled verdict", () => {
    const src = withStrings(
      readFileSync(join(SRC, "components", "SlashCommandPopup.tsx"), "utf8"),
    );
    expect(src).toMatch(/state\.disabled/);
    expect(src).toMatch(/disabled=\{/);
  });
});
