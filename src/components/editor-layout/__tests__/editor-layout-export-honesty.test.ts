/**
 * The editor-layout silo exports nothing that nothing calls (task 441).
 *
 * THE LAW (task 202's, one silo over)
 *
 *   A value exported from `src/components/editor-layout/**` is alive only if
 *   something CALLS it. A re-export is not a caller, and a SUITE is not a
 *   consumer.
 *
 * WHAT IT WOULD HAVE CAUGHT. `editor-layout/context.tsx` published
 * `EditorLayoutProvider`, `useEditorLayoutState` and `useEditorLayoutActions`.
 * The provider was mounted around essentially the ENTIRE editor tree
 * (`EditorLayout.tsx`, ~520 lines of JSX between its open and close tags),
 * handed `state={{ prefs }} actions={{ togglePanel, movePanel }}` — and the two
 * hooks had ZERO call sites anywhere in either silo, tests included. So the
 * context had a writer and no readers for as long as it existed.
 *
 * The docstring is what made it worse than inert, and it is the reason this
 * census exists rather than a quiet deletion. It stated an architecture that
 * was never built: "Extracted submodules (drag-drop, render-panel,
 * floating-cards, card-actions, event-bridges, etc.) READ WHAT THEY NEED FROM
 * THESE TWO CONTEXTS rather than receiving every value as a prop." They do not
 * — `drag-drop.tsx` takes a `deps` object and the panel hosts take props. That
 * is the shape AGENTS.md records twice (task 395's retired "topbar-left
 * sentinel", task 202's `LINK_REGISTRY`): a comment describing a mechanism that
 * does not exist is how the next reader concludes the invariant is held. And
 * here it was an INVITATION — to a context whose `state` value was a fresh
 * object literal on every `EditorLayout` render with no memo, so the first
 * subscriber added would have re-rendered on every parent render for a value
 * that rarely changes. The module is DELETED; the rule AGENTS.md states for
 * this shape is re-add it WITH its first real reader, never ahead of one.
 *
 * SCOPE, stated honestly. VALUE exports (function / class / const / let) under
 * this silo, not the whole repo — a repo-wide version needs a far larger
 * allowlist to say the same thing. TYPE exports are excluded: an interface that
 * only names its own function's signature is normal, not dead. In-file use
 * COUNTS as alive, so a dead mutually-recursive cluster is caught at its entry
 * point, which is where deleting it starts anyway.
 *
 * KNOWN HOLE, inherited from the sibling census and not closed here: this is a
 * bare-name grep with no module resolution, so a dead export whose name
 * collides with a live symbol anywhere in either silo reads alive. The honest
 * mitigation is that a scaffold usually gets a distinctive name, and the
 * alternative is a type-aware pass this suite cannot afford.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { codeOnly, commentsStripped } from "../../../lib/__tests__/_source-scan";

const SRC = path.resolve(__dirname, "../../..");
const SILO = path.join(SRC, "components", "editor-layout");
const LIBRARY = path.resolve(SRC, "../library");

function walk(root: string, out: string[] = []): string[] {
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root)) {
    if (entry === "node_modules") continue;
    const full = path.join(root, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Re-export clauses removed, then the SHARED stripper.
 *
 * `codeOnly` (comments + string/template literals blanked) is imported rather
 * than re-derived — the rule task 227 earned after two censuses were burned by
 * private copies, and the reason a symbol named inside its own error message
 * must not read as a caller.
 *
 * What it does NOT do is strip re-export clauses, which is the mechanism task
 * 202 found hiding a whole dead surface: `export { X } from "…"` publishes a
 * symbol without wanting it, and both spellings matter — the one-statement form
 * and the SPLIT barrel (`import { X } from "…"` on one line, `export { X };` on
 * another), which is already the idiom in this repo. Only the `export` half of
 * the split form is stripped; the `import` half stays, because an unused import
 * is a lint error and so does imply a use.
 */
function referenceText(src: string): string {
  return codeOnly(
    src
      .replace(/export\s*(?:type\s*)?\{[^}]*\}\s*from\s*["'][^"']+["']\s*;?/g, " ")
      .replace(/export\s*\*\s*(?:as\s+\w+\s*)?from\s*["'][^"']+["']\s*;?/g, " ")
      .replace(/export\s*(?:type\s*)?\{[^}]*\}\s*;/g, " "),
  );
}

const ALL_FILES = [...walk(path.join(SRC)), ...walk(LIBRARY)];
const REFERENCES = new Map(ALL_FILES.map((f) => [f, referenceText(readFileSync(f, "utf8"))]));
const SILO_FILES = ALL_FILES.filter(
  (f) => f.startsWith(SILO + path.sep) && !f.includes("__tests__"),
);

const VALUE_EXPORT = /^export\s+(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z0-9_]+)/gm;
const isTest = (f: string) => f.includes("__tests__") || /\.test\.tsx?$/.test(f);

/** Uses of `name` across both silos, not counting its own declaration, split by
 *  whether the caller is a TEST. The split is the point: a guard that counts a
 *  suite as a consumer says "alive" about every dead export that was ever
 *  tested, which in this repo is most of them. */
function callSites(name: string, declaredIn: string): { real: number; testOnly: number } {
  const re = new RegExp(`\\b${name}\\b`, "g");
  let real = 0;
  let testOnly = 0;
  for (const [file, text] of REFERENCES) {
    let hits = (text.match(re) ?? []).length;
    if (file === declaredIn) hits = Math.max(0, hits - 1);
    if (!hits) continue;
    if (isTest(file)) testOnly += hits;
    else real += hits;
  }
  return { real, testOnly };
}

function valueExports(file: string): string[] {
  return [...referenceText(readFileSync(file, "utf8")).matchAll(VALUE_EXPORT)].map((m) => m[1]);
}

function uncalled(): string[] {
  const out: string[] = [];
  for (const file of SILO_FILES) {
    for (const name of valueExports(file)) {
      if (callSites(name, file).real === 0) out.push(`${path.relative(SILO, file)}::${name}`);
    }
  }
  return out.sort();
}

/**
 * Uncalled value exports deliberately kept, each with its reason.
 *
 * PRE-EXISTING, recorded honestly rather than swept — the same posture
 * `dead-panel-prop-guardrail` takes toward its host layer. Task 441's scope was
 * the two DECLARATIONS it names plus this census; draining these ten is a
 * per-export judgement (is this a parked feature, a public seam, or a scaffold?)
 * and each is its own decision, not a sweep. Pinning them here is what makes the
 * set able only to SHRINK: a NEWLY dead export anywhere in the silo fails.
 *
 * `context.tsx` is NOT here — it was deleted, which is the answer this census
 * exists to push toward.
 */
const PERMITTED_UNCALLED_EXPORTS: Record<string, string> = {
  "contexts/card-creation.tsx::useOptionalCardCreationContext":
    "The null-tolerant twin of `useCardCreationContext`. Zero references anywhere, tests included — a scaffold, and the likeliest real deletion of the ten.",
  "contexts/pristine-cards.tsx::usePristineCardsContext":
    "Test-only (`pristine-single-manager-r21`), which pins the no-provider-returns-null contract. A suite is not a consumer, so this is dead by the law above — but the contract it pins is real and retiring it is a decision about the pristine-card seam.",
  "contexts/pristine-cards.tsx::usePristineKind":
    "Test-only, same suite and same seam as `usePristineCardsContext`; the two go together or not at all.",
  "jump-selection.ts::JUMP_SELECTION_PANELS":
    "Test-only. The suite uses it as the vocabulary it sweeps over, so it is closer to a published SSOT than a scaffold — its own module reads the type, not the array.",
  "panel-icons.tsx::IconFolder":
    "An icon with no panel. Zero references; deleting it is a UI decision (is a folder panel coming?) rather than a mechanical drain.",
  "panel-icons.tsx::IconSplit":
    "The split-view icon. Its natural consumer is `SplitEditorPanes`, which is itself PARKED (below) — so the two are one decision.",
  "panels/nest-footnote-children.ts::buildNestedFootnoteChildMap":
    "Test-only. A pure helper module whose three exports are exercised only by `nest-footnote-children.test.ts`; whether the nesting pass is still wired anywhere is the question, and it is one question for all three.",
  "panels/nest-footnote-children.ts::buildNestedFootnoteInfoMap":
    "Test-only, same module and same question.",
  "panels/nest-footnote-children.ts::nestFootnoteChildren":
    "Test-only, same module and same question.",
  "split-editor-panes.tsx::SplitEditorPanes":
    "PARKED, deliberately and on the record: AGENTS.md's permitted-keystroke-subscriber list states that `EditorMirror`'s subscription cannot run today because its only consumer, `SplitEditorPanes`, is deliberately unmounted. Kept because the file still makes the subscription and the guardrail greps files, not mounts.",
};

describe("editor-layout export honesty — a published export nothing calls is dead", () => {
  it("every value export in the silo has a non-test caller", () => {
    const unexpected = uncalled().filter((e) => !(e in PERMITTED_UNCALLED_EXPORTS));
    expect(unexpected).toEqual([]);
  });

  it("the allowlist has no stale entries (the census can only shrink)", () => {
    const flagged = new Set(uncalled());
    const stale = Object.keys(PERMITTED_UNCALLED_EXPORTS).filter((e) => !flagged.has(e));
    expect(stale).toEqual([]);
  });

  /** The deletion, pinned. `context.tsx` is gone and no file in either silo may
   *  name its exports again — re-adding a context is cheap the day something
   *  needs one, and that day it arrives WITH its reader. */
  it("the dead EditorLayout context stays deleted", () => {
    expect(existsSync(path.join(SILO, "context.tsx"))).toBe(false);
    const RETIRED = ["EditorLayoutProvider", "useEditorLayoutState", "useEditorLayoutActions"];
    const survivors: string[] = [];
    for (const [file, text] of REFERENCES) {
      for (const name of RETIRED) {
        if (new RegExp(`\\b${name}\\b`).test(text)) survivors.push(`${path.relative(SRC, file)}::${name}`);
      }
    }
    expect(survivors).toEqual([]);
  });

  /** CAN-SEE canary, on a SYNTHETIC fixture rather than one of the drained
   *  lines — a canary standing on the defect evaporates the moment the defect
   *  is fixed. Pins the two things this census must not be fooled by: a
   *  re-export is not a caller, and a name inside a STRING is not a reference
   *  (the dead `createLink` was kept alive for a draft of the sibling census by
   *  its own error message). */
  it("a re-export is not a caller and a string is not a reference", () => {
    const declaring = 'export function ghostSymbol() { throw new Error("ghostSymbol failed"); }';
    const barrel = 'export { ghostSymbol } from "./ghost";';
    const splitBarrel = 'import { ghostSymbol } from "./ghost";\nexport { ghostSymbol };';
    const realCaller = "ghostSymbol();";

    const count = (src: string) =>
      (referenceText(src).match(/\bghostSymbol\b/g) ?? []).length;

    expect(count(declaring)).toBe(1); // the declaration only — the string is gone
    expect(count(barrel)).toBe(0);
    expect(count(splitBarrel)).toBe(1); // the import half survives, the export half does not
    expect(count(realCaller)).toBe(1);
  });

  /** SWALLOW self-check for the shared stripper, which its own header asks each
   *  caller to carry. A regex literal holding a quote is the one construct the
   *  one-pass scanner does not model, and the failure it caused in the sibling
   *  census was specific: a runaway ate whole regions and the census silently
   *  stopped SEEING THE `export` DECLARATIONS below them.
   *
   *  So the check is aimed at exactly that — the declaration count must be the
   *  same whether or not string/template literals are blanked. A line-ratio
   *  heuristic was tried and is wrong: `codeOnly` legitimately collapses a
   *  multi-line template, so a template-heavy file reports a 5x "loss" with
   *  nothing at all swallowed. */
  it("blanking literals costs the census no export declaration", () => {
    const deExport = (src: string) =>
      src
        .replace(/export\s*(?:type\s*)?\{[^}]*\}\s*from\s*["'][^"']+["']\s*;?/g, " ")
        .replace(/export\s*\*\s*(?:as\s+\w+\s*)?from\s*["'][^"']+["']\s*;?/g, " ")
        .replace(/export\s*(?:type\s*)?\{[^}]*\}\s*;/g, " ");
    for (const file of SILO_FILES) {
      const raw = readFileSync(file, "utf8");
      const withStrings = commentsStripped(deExport(raw));
      const withoutStrings = referenceText(raw);
      const count = (t: string) => [...t.matchAll(VALUE_EXPORT)].length;
      expect(count(withoutStrings), path.relative(SRC, file)).toBe(count(withStrings));
    }
  });
});
