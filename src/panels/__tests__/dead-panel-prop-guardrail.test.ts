/**
 * DEAD-PROP GUARDRAIL — a panel/host prop that nothing consumes is a feature
 * that does not exist.
 *
 * Task 106's defect in one line: `ArchivePanelProps` declared `onInsert` and
 * `onRestore`, `EditorPane` built real handlers for them, `ArchiveHost` passed
 * them down — and `ArchivePanel`'s parameter list never destructured them. So
 * for as long as the panel has existed there was NO WAY to un-archive text: the
 * whole chain was live and terminated in a discard. Nothing failed. TypeScript
 * proves a prop was PASSED; nothing in the type system proves it was USED, and
 * the panel that drops it on the floor type-checks exactly like the panel that
 * renders it.
 *
 * That is what this grep is for, and why it can only be a grep — the same
 * argument the `unbridge-mode-wiring-guardrail` makes about literals: types can
 * say "you must pass something", only source inspection can say "somebody has
 * to read it."
 *
 * THE RULE: every property declared in a `*Props` interface under the censused
 * roots must appear at least once MORE in its own file (destructured, read off
 * a `p.`, or forwarded). A declaration that appears exactly once is dead.
 *
 * Fixing a hit means one of two things, and the choice is a real one:
 *   • the feature was intended → WIRE it (render the control, consume the value);
 *   • the wiring is vestigial → DELETE the declaration and its pass-throughs.
 * Adding it to the allowlist below is neither, and is only correct for a prop
 * genuinely consumed in a way this grep cannot see (a `{...rest}` spread).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOTS = ["src/panels", "src/components/editor-layout/panels"];

/**
 * `file::Interface::prop` entries this census tolerates.
 *
 * `src/panels/**` is DRAINED — its allowlist share is empty and must stay that
 * way (task 106 removed the four that were there: the two dead archive verbs,
 * `ArchivePanelProps.panelSide`, `CitationsPanelProps.bibPath`).
 *
 * The HOST layer below is a PRE-EXISTING census recorded honestly rather than
 * swept: each of these is a `side`/`panelSide`/positional prop threaded from
 * `EditorPane` into a host that never reads it, and telling "vestigial" from
 * "half-finished feature" needs the same per-prop judgement task 106 needed for
 * `onInsert`/`onRestore` — which is a decision, not a sweep. They are pinned
 * here so the set can only SHRINK: a newly-dead prop anywhere fails.
 */
const PERMITTED_DEAD_PROPS = new Set<string>([
  "src/components/editor-layout/panels/todo-host.tsx::TodoHostProps::side",
  "src/components/editor-layout/panels/todo-host.tsx::TodoHostProps::panelSide",
  "src/components/editor-layout/panels/todo-host.tsx::TodoHostProps::addTodo",
  "src/components/editor-layout/panels/notes-host.tsx::NotesHostProps::side",
  "src/components/editor-layout/panels/notes-host.tsx::NotesHostProps::panelSide",
  "src/components/editor-layout/panels/footnotes-host.tsx::FootnotesHostProps::side",
  "src/components/editor-layout/panels/bibliography-host.tsx::BibliographyHostProps::side",
  "src/components/editor-layout/panels/bibliography-host.tsx::BibliographyHostProps::panelSide",
  "src/components/editor-layout/panels/bibliography-host.tsx::BibliographyHostProps::citationPositionMap",
  "src/components/editor-layout/panels/revisions-host.tsx::RevisionsHostProps::panelSide",
  // These two surfaced only once the census stopped counting the word `side`
  // inside the comment "client-side Apply / Keep / Revert" as a use — the
  // reason `stripComments` exists.
  "src/components/editor-layout/panels/revisions-host.tsx::RevisionsHostProps::side",
  "src/components/editor-layout/panels/cutter-host.tsx::CutterHostProps::side",
  "src/components/editor-layout/panels/citations-host.tsx::CitationsHostProps::side",
  "src/components/editor-layout/panels/citations-host.tsx::CitationsHostProps::citationPositionMap",
  "src/components/editor-layout/panels/reports-host.tsx::ReportsHostProps::side",
  "src/components/editor-layout/panels/reports-host.tsx::ReportsHostProps::panelSide",
  "src/components/editor-layout/panels/cutter-host.tsx::CutterHostProps::panelSide",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    // Source only. A `.d.ts` re-declaring a shape for consumption elsewhere, a
    // story, or a test fixture would each flag every member of its own `*Props`
    // with no honest fix available but an allowlist entry — which this guard's
    // header says is the wrong answer.
    else if (/\.tsx?$/.test(name) && !/\.(d\.ts|stories\.tsx?|test\.tsx?)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** Blank out comments so a prop merely NAMED in prose doesn't read as a use.
 *  This is load-bearing, not tidiness: `side` occurs in the phrase "client-side"
 *  in two host files, which was enough to hide two genuinely dead props from the
 *  first version of this census. Replaced with spaces so offsets are preserved. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

function deadPropsIn(file: string): string[] {
  const raw = readFileSync(file, "utf8");
  const src = stripComments(raw);
  const hits: string[] = [];
  // Every `*Props` shape: `interface XProps {`, `interface XProps<T> {`,
  // `interface XProps extends Y {`, and the `type XProps = {` alias. Body runs
  // non-greedily to the first column-0 `}`.
  const DECL = /(?:interface|type)\s+(\w*Props)\s*(?:<[^>]*>)?\s*(?:extends [^{]+)?=?\s*\{([\s\S]*?)\n\}/g;
  for (const m of src.matchAll(DECL)) {
    const [, iface, body] = m;
    // Top-level members only (two-space indent) — nested object literals are
    // the shape of a value, not a prop the component has to consume. Covers the
    // property form (`foo: T` / `foo?: T` / `readonly foo: T`) and the method
    // shorthand (`onFoo(id: string): void`), which the colon-only form missed.
    for (const pm of body.matchAll(/^ {2}(?:readonly\s+)?(\w+)\??\s*[:(]/gm)) {
      const prop = pm[1];
      const uses = src.match(new RegExp(`\\b${prop}\\b`, "g"))?.length ?? 0;
      if (uses <= 1) hits.push(`${file}::${iface}::${prop}`);
    }
  }
  return hits;
}

describe("dead-prop guardrail — a declared prop nobody reads is a dead feature", () => {
  it("every censused panel/host prop is consumed in its own file", () => {
    const flagged = ROOTS.flatMap((r) => walk(r)).flatMap(deadPropsIn);
    const unexpected = flagged.filter((f) => !PERMITTED_DEAD_PROPS.has(f));
    expect(unexpected).toEqual([]);
  });

  it("the allowlist has no stale entries (the census can only shrink)", () => {
    const flagged = new Set(ROOTS.flatMap((r) => walk(r)).flatMap(deadPropsIn));
    const stale = [...PERMITTED_DEAD_PROPS].filter((e) => !flagged.has(e));
    expect(stale).toEqual([]);
  });

  it("src/panels is fully drained — its share of the allowlist is empty", () => {
    const inPanels = [...PERMITTED_DEAD_PROPS].filter((e) => e.startsWith("src/panels/"));
    expect(inPanels).toEqual([]);
  });
});
