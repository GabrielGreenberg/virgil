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
 *
 * ---------------------------------------------------------------------------
 * TASK 441 — the scope was one subdirectory, and the rule had a blind spot the
 * silo it did not cover was sitting in.
 *
 * SCOPE. The censused root was `src/components/editor-layout/panels`, one
 * subdirectory of a ~45-file silo that `context.tsx` described as the
 * extraction target for the entire EditorLayout shell. So the silo that grew
 * an `EditorLayoutProvider` wrapping the whole editor tree with ZERO readers —
 * its docstring asserting that the extracted submodules read from it, which
 * they never did — was outside the one census that would have asked. The root
 * is now the SILO (`src/components/editor-layout`, which subsumes `/panels`),
 * and its new share of the allowlist is EMPTY, pinned by its own leg.
 *
 * `void <prop>;` IS A CONFESSION, NOT AN ALIBI. `StripButton`'s `stripRef` was
 * declared REQUIRED, destructured, discharged with `void stripRef;` under the
 * comment "kept to preserve the calling contract after extraction", and its ONE
 * caller satisfied it with
 * `null as unknown as React.RefObject<HTMLDivElement | null>` — a required prop
 * whose only call site must double-cast a `null` into it is not a preserved
 * contract, it is a dead field with the type error suppressed on top.
 *
 * The member rule above could not see it, and the reason is worth stating
 * because it is the rule's real boundary: that rule asks "does this member
 * occur a SECOND time in its own file?", and a discharged prop occurs three
 * times — declaration, destructuring binding, and the `void`. Measured on the
 * pre-441 tree, widening the root alone flagged NOTHING new. So the discharge
 * gets its OWN leg below, and it is the honest one to add: `void x;` exists for
 * exactly one purpose — to stop the compiler complaining that a binding is
 * never read — which is precisely the complaint this file is a grep for.
 *
 * Deliberately NOT widened, and the measurement is why. Making a BINDING not
 * count as a read (blanking destructuring patterns) and censusing INLINE props
 * object types alongside the named `*Props` shapes was tried and rejected: it
 * flagged 39 members, EIGHTEEN of them in `src/panels`, a silo the leg below
 * pins as drained. Several are `{...rest}` forwards and nested sub-shapes the
 * grep cannot see, so the honest reading is a broad false-positive surface plus
 * some real hits — an open-ended sweep, which is a task of its own and not this
 * one. The discharge leg names the reported shape exactly and drains to EMPTY.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/** The two silos this census covers. `src/components/editor-layout` subsumes
 *  the former `/panels` entry — see the SCOPE note above. */
const ROOTS = ["src/panels", "src/components/editor-layout"];

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

/**
 * Every props SHAPE in a file, as `[name, body]` — both the named
 * `interface XProps { … }` / `type XProps = { … }` form that `deadPropsIn`
 * censuses, and the INLINE object type annotating a destructured parameter
 * (`function C({ a, b }: { a: A; b: B })`), which that regex never saw and
 * which is the form `StripButton` uses.
 *
 * Only the discharge leg reads the inline shapes. Running the MEMBER rule over
 * them was measured and rejected — see the header's "Deliberately NOT widened".
 */
function propsShapes(src: string): Array<[string, string]> {
  const shapes: Array<[string, string]> = [];
  const DECL =
    /(?:interface|type)\s+(\w*Props)\s*(?:<[^>]*>)?\s*(?:extends [^{]+)?=?\s*\{([\s\S]*?)\n\}/g;
  for (const m of src.matchAll(DECL)) shapes.push([m[1], m[2]]);

  // Inline: a `{` in PARAMETER position (right after `(` or `,`) whose matching
  // `}` is followed by `:` — i.e. a destructured param with a type annotation.
  // The `:` is what keeps ordinary object-literal ARGUMENTS out (`f(a, { x })`
  // closes onto `)`), and the type literal's own `{` opens after `:`, never
  // after `(`/`,`, so it is never mistaken for a pattern.
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== "{") continue;
    if (!/[(,]\s*$/.test(src.slice(Math.max(0, i - 40), i))) continue;
    let depth = 0;
    let j = i;
    for (; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}" && --depth === 0) break;
    }
    if (j >= src.length) continue;
    let k = j + 1;
    while (k < src.length && /\s/.test(src[k])) k++;
    if (src[k] !== ":") continue;
    k++;
    while (k < src.length && /\s/.test(src[k])) k++;
    i = j;
    if (src[k] !== "{") continue; // a NAMED type — already covered by DECL
    let d2 = 0;
    let m2 = k;
    for (; m2 < src.length; m2++) {
      if (src[m2] === "{") d2++;
      else if (src[m2] === "}" && --d2 === 0) break;
    }
    const fn = [...src.slice(0, i).matchAll(/(?:function|const)\s+([A-Za-z_$][\w$]*)/g)].pop();
    shapes.push([`${fn ? fn[1] : "anonymous"}(inline)`, src.slice(k + 1, m2)]);
  }
  return shapes;
}

/** Members declared by any props shape in the file.
 *
 *  Separator-based rather than the member rule's `^ {2,}` indent test, because
 *  an INLINE param type is routinely written on one line — where an indent test
 *  matches nothing at all. It therefore also collects members of NESTED object
 *  types, which for this leg is harmless over-collection: the set is only ever
 *  intersected with the file's `void <name>;` statements. */
function propMembers(src: string): Set<string> {
  const out = new Set<string>();
  for (const [, body] of propsShapes(src)) {
    for (const pm of body.matchAll(/(?:^|[;{])\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*[:(]/gm)) {
      out.add(pm[1]);
    }
  }
  return out;
}

/** `file::name` for every `void <name>;` statement discharging a PROPS member.
 *
 *  Scoped to props members on purpose: `void x;` is a legitimate and common
 *  idiom in this repo for the exhaustiveness proof AGENTS.md documents
 *  (`const unhandled: never = v; void unhandled;`) and for a few deliberate
 *  unread locals. Measured across `src/` and `library/`, 24 such statements
 *  exist and 23 are one of those; the ONLY one discharging a declared prop was
 *  `void stripRef;`. Outlawing the idiom wholesale would be a false claim about
 *  what is wrong with it.
 *
 *  Stated limit: the binding set is per FILE, not per function, so a `void x;`
 *  in one function where `x` names another component's prop in the same file
 *  would flag. That is a suspicious shape anyway, and the failure direction is
 *  a loud false report rather than a silent miss. */
function dischargedPropsIn(file: string): string[] {
  const src = stripComments(readFileSync(file, "utf8"));
  const members = propMembers(src);
  const hits: string[] = [];
  for (const m of src.matchAll(/(?:^|[;{}])\s*void\s+([A-Za-z_$][\w$]*)\s*;/gm)) {
    if (members.has(m[1])) hits.push(`${file}::${m[1]}`);
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

  /** Task 441's new scope. The panel HOSTS under it keep their pre-existing
   *  pinned share (see the allowlist header — those are a per-prop judgement,
   *  not a sweep); everything ELSE in the silo is drained and stays that way. */
  it("the editor-layout silo OUTSIDE panels/ is drained — no allowlist share", () => {
    const inSilo = [...PERMITTED_DEAD_PROPS].filter(
      (e) =>
        e.startsWith("src/components/editor-layout/") &&
        !e.startsWith("src/components/editor-layout/panels/"),
    );
    expect(inSilo).toEqual([]);
  });

  /** THE DISCHARGE LEG (task 441). No allowlist: a prop that has to be voided
   *  is a prop nobody reads, and the two honest fixes are the same two the
   *  header names — WIRE it or DELETE it. */
  it("no props member is discharged with `void` — a confession is not a read", () => {
    const flagged = ROOTS.flatMap((r) => walk(r)).flatMap(dischargedPropsIn);
    expect(flagged).toEqual([]);
  });

  /** CAN-SEE canary for the discharge leg, on a SYNTHETIC fixture rather than
   *  one of the drained lines — a canary standing on the defect evaporates the
   *  moment the defect is fixed, and the leg above then passes for no reason.
   *  Spells BOTH shapes: the named `*Props` interface and the INLINE param type
   *  that `StripButton` actually used, plus the exhaustiveness idiom that must
   *  NOT flag. */
  it("the discharge scanner sees both props shapes, and spares the never-proof", () => {
    const fixture = [
      "interface NamedProps {",
      "  liveOne: string;",
      "  dischargedOne: boolean;",
      "}",
      "export function Named({ liveOne, dischargedOne }: NamedProps) {",
      "  void dischargedOne;",
      "  return liveOne;",
      "}",
      "export function Inline({ shown, hiddenOne }: { shown: string; hiddenOne: number }) {",
      "  void hiddenOne;",
      "  const unhandled: never = shown as never;",
      "  void unhandled;",
      "  return shown;",
      "}",
    ].join("\n");
    const src = stripComments(fixture);
    const members = propMembers(src);
    expect([...members].sort()).toEqual(["dischargedOne", "hiddenOne", "liveOne", "shown"]);
    const flagged = [...src.matchAll(/(?:^|[;{}])\s*void\s+([A-Za-z_$][\w$]*)\s*;/gm)]
      .map((m) => m[1])
      .filter((n) => members.has(n));
    expect(flagged.sort()).toEqual(["dischargedOne", "hiddenOne"]);
  });
});
