/**
 * DEAD-COMPONENT GUARDRAIL — a component IMPORT is a claim that this file
 * renders it.
 *
 * Task 495's defect in one line: `EditorLayout.tsx` imported
 * `PreferenceModePicker` and never rendered it. That picker was the only place
 * `usePreferenceMode`'s `on` was read, and its `toggle` had NO reader anywhere
 * — `EditorLayout` destructured both and used neither — so the mode could never
 * be turned on, the two `body[data-pref-mode="on"]` rulesets (four selectors)
 * were unreachable, and four components went on stamping `data-prefs=` for a
 * walker that never mounted. ~480 lines of a whole feature, dead for four
 * months — while `PreferenceModePicker.tsx`'s own Lifecycle contract opened
 * with "1. Host (EditorLayout) renders <PreferenceModePicker /> unconditionally"
 * and `usePreferenceMode.ts`'s threading map put a "[top-bar button]" under
 * `EditorLayout.tsx` that "renders the toggle button; uses isOn & toggle()".
 * Both false; the second file went on to teach the next agent how to EXTEND it.
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
 * Two more stated reaches, both measured EMPTY on this tree rather than argued:
 * a NAMESPACE import (`import * as Panels from "./panels"`) introduces no
 * PascalCase specifier and is not collected — there are zero of them in the 281
 * production `.tsx` files; and the name test's character class omits `_`, so
 * `Playfair_Display` / `Source_Serif_4` / `Geist_Mono` (`next/font/google`, in
 * `layout.tsx`) are skipped. All three are fonts rather than components, so the
 * exclusion is right by accident and not by the rule — which is why it is
 * written down here instead of left to be rediscovered.
 *
 * ---------------------------------------------------------------------------
 * WHAT DRAINING IT COST, recorded because the number is the finding
 *
 * On the pre-495 tree this census named EIGHTEEN bindings, and every one of them
 * was in `EditorLayout.tsx` — no other production `.tsx` in either silo had a
 * hit. Seventeen besides the picker: `VirgilEditor`, `FloatingPanel`,
 * `DockOutline`, `CardLiftOutline`, `OmniFilterMenu`, `ExamplesPanel`, `Side`
 * and all ten panel `*Host`s, residue of the extraction that moved every one of
 * them into `EditorPane` / the `editor-layout/` submodules. Each was verified to
 * render elsewhere, and each module verified to still be loaded through
 * `EditorPane`, before deletion. That pile IS the mechanism the finding names —
 * the signal that would have caught the eighteenth was buried under seventeen.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { relative } from "path";
import {
  codeOnly,
  commentsStripped,
  cssCommentsStripped,
  swallowedLines,
  trackedFiles,
  REPO_ROOT,
} from "@/lib/__tests__/_source-scan";

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
   *  zero hits, which is indistinguishable from a clean tree.
   *
   *  PER SILO, not a total: the two roots collapse independently, and a total
   *  floor cannot see one of them go. Nor may the library pin be a path
   *  SUBSTRING test — `/library/` matches every path in a checkout that happens
   *  to live under a directory of that name, so it would answer true with the
   *  silo empty. Both are anchored on the repo-relative path instead. */
  it("the population is real, per silo", () => {
    const rel = productionTsx().map((f) => relative(REPO_ROOT, f));
    const inSrc = rel.filter((f) => f.startsWith("src/"));
    const inLibrary = rel.filter((f) => f.startsWith("library/"));
    expect(inSrc.length).toBeGreaterThan(100);
    expect(inLibrary.length).toBeGreaterThan(10);
    expect(rel).toContain("src/components/EditorLayout.tsx");
    // …and the population must actually COLLECT something, or the use-count
    // rule is being asked of nothing.
    const bindings = productionTsx().flatMap((f) =>
      importedComponentBindings(codeOnly(readFileSync(f, "utf8"))),
    );
    expect(bindings.length).toBeGreaterThan(300);
  });

  /** SWALLOW SELF-CHECK — the convention `_source-scan.ts`'s own header asks
   *  every caller for, and this census needs it more than most: measured over
   *  the real population, 61% of collected bindings sit at exactly TWO
   *  occurrences (the import plus one use), so ONE swallowed line is a spurious
   *  failure with no diagnostic attached.
   *
   *  The scanner models a quoted string as newline-terminated, so a stray quote
   *  — an apostrophe in JSX text, a quote inside a regex literal, the one
   *  construct it does not model — corrupts at most its own line. That is
   *  exactly enough to eat a component's only use. Today `react/no-unescaped-
   *  entities` forces `&apos;` and the tree is clean, but nothing this census
   *  owns holds that.
   *
   *  The obvious form of this leg has NO TEETH and was measured to have none: a
   *  swallow eats to end of LINE, so counting surviving `import` lines (or
   *  file lines) sees nothing — planting a real JSX apostrophe leaves both
   *  intact. `swallowedLines` asks the scanner's own question instead.
   */
  it("the stripper swallows nothing across the population", () => {
    const offenders: string[] = [];
    for (const abs of productionTsx()) {
      const lines = swallowedLines(readFileSync(abs, "utf8"));
      if (lines.length) offenders.push(`${relative(REPO_ROOT, abs)}:${lines.join(",")}`);
    }
    expect(offenders).toEqual([]);
  });

  /** CAN-SEE canary for the swallow check, on synthetic fixtures — including
   *  the two shapes that would actually reach this repo (a raw apostrophe in
   *  JSX text; a quote inside a regex literal) and, as accepting controls, the
   *  escaped-quote and multi-line-template forms that must NOT report. */
  it("the swallow detector sees a lost line, and spares the legal shapes", () => {
    expect(swallowedLines(`const el = <p>It's here <Badge /></p>;`)).toEqual([1]);
    expect(swallowedLines(`s.replace(/['"]/g, ""); const el = <Badge />;`)).toEqual([1]);
    expect(swallowedLines(`const a = 1;\nconst b = "it's fine";\nconst c = <Badge />;`)).toEqual([]);
    expect(swallowedLines(`const s = 'a\\'b';`)).toEqual([]);
    expect(swallowedLines("const t = `line one\nline two`;\nconst c = 2;")).toEqual([]);
    // A comment may hold anything at all.
    expect(swallowedLines("// it's fine\n/* and it's\n   fine here too */\nconst x = 1;")).toEqual([]);
    // …and the line NUMBER is the diagnostic, so it must be right.
    expect(swallowedLines(`const a = 1;\nconst b = 2;\nconst el = <p>It's here</p>;`)).toEqual([3]);
  });

  /** The retired feature stays retired. Task 495 deleted the picker, its hook,
   *  the two unreachable CSS rulesets, the `--pref-mode-accent` token they read,
   *  the four `data-prefs` stamps that fed the walker (and the `dataPrefs` prop
   *  that carried one of them), the `data-bar-h` twin of the same dead
   *  integration, and the two exports whose only caller was the picker
   *  (`findLeafByKey`, and `useLoadPanelColors` — whose zero consumers were the
   *  same class one file over). `data-panel-theme` went with them: it was
   *  consumer-ONLY, read by the picker and the CSS, produced by nothing, while
   *  `panel-primitives` promised a producer that never existed.
   *
   *  COMMENTS ARE STRIPPED, deliberately. This repo's convention is to
   *  renegotiate a retired claim IN PLACE with the reason at the site, and a
   *  raw-source needle would make writing that sentence a test failure —
   *  outlawing the very prose the fix is made of. What the leg forbids is a
   *  live CODE mention. Literals are KEPT, because `data-prefs="…"` and
   *  `"@/hooks/usePreferenceMode"` are how a re-introduction would actually be
   *  spelled.
   *
   *  Stated reach: `data-prefs` and `data-panel-theme` are generic names inside
   *  a LIVE family (`data-panel-id`, `data-panel-side`, … all ship), so a future
   *  attribute of those exact names trips this leg. That is the right direction
   *  for a retirement pin — a loud question beats a silent re-introduction — and
   *  the answer at that point is to rename or to retire the pin on purpose. */
  it("preference mode is gone from both silos — no half-alive third state", () => {
    const needles = [
      "usePreferenceMode",
      "PreferenceModePicker",
      "data-pref-mode",
      "data-prefs",
      "dataPrefs",
      "data-panel-theme",
      "data-bar-h",
      "pref-mode-accent",
      "findLeafByKey",
      "useLoadPanelColors",
    ];
    const hits: string[] = [];
    const scan = (root: string, ext: RegExp, strip: (s: string) => string) => {
      for (const abs of trackedFiles(root, ext)) {
        if (/__tests__/.test(abs)) continue;
        const src = strip(readFileSync(abs, "utf8"));
        for (const n of needles) {
          if (src.includes(n)) hits.push(`${relative(REPO_ROOT, abs)}::${n}`);
        }
      }
    };
    for (const root of ["src", "library"]) {
      scan(root, /\.tsx?$/, commentsStripped);
      scan(root, /\.css$/, cssCommentsStripped);
    }
    expect(hits).toEqual([]);
  });

  /** CAN-SEE canary for the retirement leg. Synthetic, for the reason the other
   *  canary states — and it also pins the comment/code asymmetry the leg rests
   *  on, which is the half a `toEqual([])` can never demonstrate. */
  it("the retirement leg reads CODE, not the prose that records the retirement", () => {
    const live = commentsStripped('const el = <div data-prefs="surfaceColor" />;');
    expect(live).toContain("data-prefs");
    const prose = commentsStripped("// Retired in 495: EditorLayout rendered <PreferenceModePicker />.\nconst x = 1;");
    expect(prose).not.toContain("PreferenceModePicker");
    expect(prose).toContain("const x = 1;");
    const cssProse = cssCommentsStripped("/* the old body[data-pref-mode=\"on\"] rule */\n.a { color: red; }");
    expect(cssProse).not.toContain("data-pref-mode");
    expect(cssProse).toContain("color: red");
  });
});
