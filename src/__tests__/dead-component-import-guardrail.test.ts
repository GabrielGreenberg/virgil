/**
 * DEAD-COMPONENT GUARDRAIL — a component IMPORT is a claim that this file
 * renders it.
 *
 * Task 495's defect in one line: `EditorLayout.tsx` imported
 * `PreferenceModePicker` and never rendered it. The picker was the ONLY
 * consumer of `usePreferenceMode`'s `on`/`toggle`, so the mode could never be
 * turned on; the four `body[data-pref-mode="on"]` CSS rules were therefore
 * unreachable; and six components went on stamping `data-prefs=` for a walker
 * that never mounted. ~500 lines of a whole feature, dead for four months —
 * while `usePreferenceMode.ts`'s architecture docstring opened with
 * "1. Host (EditorLayout) renders <PreferenceModePicker /> unconditionally"
 * and went on to teach the next agent how to EXTEND it.
 *
 * Nothing failed. `tsconfig.json` sets no `noUnusedLocals`, so the compiler is
 * silent by configuration; `npm run lint` reported 89 warnings on that one file,
 * so eslint's `no-unused-vars` was ambient noise rather than a signal. The
 * feature had a live successor (`SmartPreferences` in the Preferences modal),
 * so nothing was missing either — only its corpse remained.
 *
 * THE RULE: every PascalCase VALUE binding a production module imports must
 * occur at least once MORE in that module's own comment- and literal-stripped
 * source. A binding that appears exactly once is a claim the file does not
 * keep.
 *
 * The two honest fixes are the sibling census's two
 * ([dead-panel-prop-guardrail](../panels/__tests__/dead-panel-prop-guardrail.test.ts),
 * which asks the same question one level in — a declared PROP nobody reads):
 *   • the render was intended → WIRE it (render the component);
 *   • the import is vestigial → DELETE it.
 * The allowlist below is EMPTY and must stay that way.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SHAPE, AND NOT THE OBVIOUS ONE
 *
 * The obvious census — "does a `<Name` JSX tag exist somewhere in the repo?" —
 * is VACUOUS on this very defect: `PreferenceModePicker` is a real component
 * whose module is really imported, so a question keyed on the FILE passes while
 * the BINDING is dead. The question has to be asked of the binding, in the file
 * that made the claim.
 *
 * The rule is deliberately "used a second time AT ALL", not "appears in JSX".
 * A JSX-only needle would flag every legitimate non-JSX use of a component
 * value — `React.createElement(Foo)`, a `Foo` handed to a registry, a
 * `typeof Foo` — so it would trade this file's empty allowlist for a list of
 * exemptions. The permissive form still catches the reported shape, because a
 * dead import is dead in EVERY spelling.
 *
 * STATED REACH, the other direction: a binding that is MENTIONED but not
 * actually rendered — passed to a dead branch, or named only in a `typeof` —
 * satisfies this census. That is the same limit the sibling states about a prop
 * that is destructured and dropped, and the same trade: a census that cannot be
 * argued with is worth more than one that is nearly complete and noisy.
 *
 * SCREAMING_SNAKE constants (`FLOATING_PANEL_WIDTH`) are out of scope: they are
 * eslint's `no-unused-vars` question, they are not a claim about rendering, and
 * including them would put ~10 pre-existing hits into an allowlist this file
 * needs empty to be worth anything. A component name is PascalCase — at least
 * one lowercase letter after the first — which is exactly the test React itself
 * uses to tell a component from an intrinsic element.
 *
 * That test cannot separate a component from a PascalCase TYPE imported WITHOUT
 * the `type` keyword, and this census found one on its first run
 * (`Side` from `useViewPrefs`, unused in `EditorLayout` and deleted with the
 * rest). Recorded rather than narrowed: the over-collection costs nothing while
 * the allowlist is empty — a dead type import is a dead import — and narrowing
 * it would need this file to resolve the specifier and read the other module,
 * which is a compiler's job, not a grep's.
 *
 * ---------------------------------------------------------------------------
 * WHAT DRAINING IT COST, recorded because the number is the finding
 *
 * On the pre-495 tree this census named SEVENTEEN bindings, sixteen of them in
 * `EditorLayout.tsx` alone — `VirgilEditor`, `FloatingPanel`, `DockOutline`,
 * `CardLiftOutline`, `OmniFilterMenu`, `ExamplesPanel` and all ten panel
 * `*Host`s: residue of the extraction that moved every one of them into
 * `EditorPane` / the `editor-layout/` submodules. Each was verified to render
 * elsewhere before deletion. That pile IS the mechanism the finding names — the
 * signal that would have caught the seventeenth was buried under sixteen.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { relative } from "path";
import { codeOnly, trackedFiles, REPO_ROOT } from "@/lib/__tests__/_source-scan";

/**
 * `file::Binding` entries this census tolerates.
 *
 * EMPTY, and the emptiness is the point: a component import nobody uses has two
 * honest fixes and neither is a list entry. See the header.
 */
const PERMITTED_DEAD_COMPONENT_IMPORTS = new Set<string>([]);

/** Production `.tsx` under the two silos. `.tsx` because a component that can
 *  be rendered is written in JSX; a `.ts` module exports no component to
 *  import. Stories/tests excluded for the reason the sibling states — a fixture
 *  legitimately imports a component to hand it to a harness. */
function productionTsx(): string[] {
  return [...trackedFiles("src", /\.tsx$/), ...trackedFiles("library", /\.tsx$/)].filter(
    (p) => !/__tests__/.test(p) && !/\.(stories|test)\.tsx$/.test(p),
  );
}

/** A component name: PascalCase with at least one lowercase letter, so a
 *  SCREAMING_SNAKE constant is not mistaken for one. See the header. */
const isComponentName = (n: string) => /^[A-Z][A-Za-z0-9$]*$/.test(n) && /[a-z]/.test(n);

/**
 * Every PascalCase VALUE binding an import statement introduces.
 *
 * `import type …` is skipped wholesale and an inline `type X` specifier is
 * skipped individually — a TYPE import makes no claim about rendering, and
 * `import { type Side }` is the idiom this repo uses. An `as` alias is read at
 * its LOCAL name, which is the name the file would have to use.
 */
function importedComponentBindings(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/import\s+(?!type\b)([^;]*?)\s+from\s+/g)) {
    const clause = m[1];
    // `import Default, { … } from` / `import Default from`
    const dflt = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause);
    if (dflt && isComponentName(dflt[1])) out.push(dflt[1]);
    const braced = /\{([\s\S]*?)\}/.exec(clause);
    if (!braced) continue;
    for (const raw of braced[1].split(",")) {
      const t = raw.trim();
      if (!t || /^type\s/.test(t)) continue;
      const alias = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(t);
      const name = alias ? alias[1] : t;
      if (isComponentName(name)) out.push(name);
    }
  }
  return out;
}

/** `file::Binding` for every imported component the file never mentions again.
 *
 *  Read off `codeOnly` source — comments AND string literals blanked — so a
 *  component merely NAMED in its own import's explanatory comment (which is
 *  exactly what `EditorLayout` had above `PreferenceModePicker`) cannot read as
 *  a use. */
function deadComponentImportsIn(abs: string): string[] {
  const src = codeOnly(readFileSync(abs, "utf8"));
  const rel = relative(REPO_ROOT, abs);
  const hits: string[] = [];
  for (const name of new Set(importedComponentBindings(src))) {
    const uses = src.match(new RegExp(`\\b${name}\\b`, "g"))?.length ?? 0;
    if (uses <= 1) hits.push(`${rel}::${name}`);
  }
  return hits;
}

describe("dead-component guardrail — an import is a claim that the file renders it", () => {
  it("every imported component is used in the file that imports it", () => {
    const flagged = productionTsx().flatMap(deadComponentImportsIn);
    const unexpected = flagged.filter((f) => !PERMITTED_DEAD_COMPONENT_IMPORTS.has(f));
    expect(unexpected).toEqual([]);
  });

  it("the allowlist is EMPTY — WIRE it or DELETE it, never list it", () => {
    expect([...PERMITTED_DEAD_COMPONENT_IMPORTS]).toEqual([]);
  });

  /** The population must be non-trivial, or the leg above passes vacuously —
   *  a `trackedFiles` root that stopped resolving would report zero files and
   *  zero hits, which is indistinguishable from a clean tree. */
  it("the population is real", () => {
    const files = productionTsx();
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith("/src/components/EditorLayout.tsx"))).toBe(true);
    expect(files.some((f) => /\/library\//.test(f))).toBe(true);
  });

  /** CAN-SEE canary, on a SYNTHETIC fixture rather than one of the lines this
   *  task drained — a canary standing on the defect evaporates the moment the
   *  defect is fixed, and the leg above then passes for no reason.
   *
   *  Spells every shape that must and must not flag: the DEFAULT import the
   *  reported defect used, a named one, an aliased one, a `type` specifier, a
   *  whole `import type` statement, a SCREAMING_SNAKE constant, and — the one
   *  that caught the reported shape's own disguise — a component named only in
   *  the comment sitting above its import. */
  it("the scanner sees a dead default import, and spares types, constants and prose", () => {
    const fixture = [
      '// DeadDefault is the picker; see its architecture guide for how to extend.',
      'import DeadDefault from "./DeadDefault";',
      'import LiveDefault from "./LiveDefault";',
      'import { DeadNamed, LiveNamed } from "./pair";',
      'import { Origin as DeadAlias, Other as LiveAlias } from "./aliases";',
      'import { type SideKind, LiveThird } from "./mixed";',
      'import type { PurelyAType } from "./types";',
      'import { FLOATING_PANEL_WIDTH } from "./constants";',
      'export function C() {',
      '  const label = "DeadDefault DeadNamed DeadAlias";',
      '  return <div title={label}><LiveDefault /><LiveNamed /><LiveAlias /><LiveThird /></div>;',
      '}',
    ].join("\n");
    const src = codeOnly(fixture);
    const flagged = [...new Set(importedComponentBindings(src))].filter(
      (n) => (src.match(new RegExp(`\\b${n}\\b`, "g"))?.length ?? 0) <= 1,
    );
    expect(flagged.sort()).toEqual(["DeadAlias", "DeadDefault", "DeadNamed"]);
    // …and the two shapes that are deliberately NOT this census's question.
    expect(importedComponentBindings(src)).not.toContain("PurelyAType");
    expect(importedComponentBindings(src)).not.toContain("SideKind");
    expect(importedComponentBindings(src)).not.toContain("FLOATING_PANEL_WIDTH");
  });

  /** The retired feature stays retired. Task 495 deleted the picker, its hook,
   *  the four unreachable CSS rules, the `--pref-mode-accent` token they read,
   *  and the six `data-prefs` stamps that fed the walker — including the
   *  `data-panel-theme` attribute, which was consumer-ONLY (read by the picker
   *  and the CSS, produced by nothing, while `panel-primitives` promised a
   *  producer that never existed). A future re-introduction has to reach a
   *  RENDERED consumer, which the census above is what enforces. */
  it("preference mode is gone from both silos — no half-alive third state", () => {
    const sources = [
      ...trackedFiles("src", /\.(tsx?|css)$/),
      ...trackedFiles("library", /\.(tsx?|css)$/),
    ].filter((p) => !/__tests__/.test(p));
    const needles = [
      "usePreferenceMode",
      "PreferenceModePicker",
      "data-pref-mode",
      "data-prefs",
      "data-panel-theme",
      "pref-mode-accent",
    ];
    const hits: string[] = [];
    for (const abs of sources) {
      const raw = readFileSync(abs, "utf8");
      for (const n of needles) if (raw.includes(n)) hits.push(`${relative(REPO_ROOT, abs)}::${n}`);
    }
    expect(hits).toEqual([]);
  });
});
