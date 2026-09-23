/**
 * TASK 728 — the census behind the source pod's read-only gate.
 *
 * THE RULE, stated once so the next one inherits it:
 *
 *   > An embedded code surface that writes a ProseMirror NODE ATTRIBUTE must
 *   > gate its editability on the main editor's `data-editable`.
 *
 * Three sibling surfaces already state that rule in prose — `ExampleCard`,
 * `example-block-body`, `example-item-body` all read `useMainEditable` and
 * each says in a comment why. `FigureBlockNodeView` takes the same gate
 * positionally. Nothing enforced it, so the source pod — which arrived later
 * and whose model IS its bytes — arrived ungated in BOTH of its wearers, and
 * a reader could type a whole tikz picture into a read-only doc and watch it
 * disappear.
 *
 * `view.editable` is pinned `true` always (Editor.tsx); read-only is enforced
 * downstream by `readOnlyEnforcer`'s `filterTransaction`, which drops every
 * `docChanged` transaction without `ignoreReadOnly`. So a module that mounts a
 * CodeMirror surface AND writes a node attr (`updateAttributes` /
 * `setNodeMarkup`) is, by construction, a surface whose every write is
 * refused read-only. That conjunction is the census's membership test: it
 * needs no allowlist, because the two CodeMirror modules that do NOT write
 * node attrs — the code PANE (`CodeEditor`, a full pane over the `.tex` file
 * with its own save path) and the style editor (a modal over a style file) —
 * fall out of it on their own rather than by being excused.
 *
 * Read-only on app source: a census asks the REAL tree, so a third wearer
 * cannot arrive gate-less, and a refactor that renames the write API cannot
 * empty the set silently (leg 3).
 *
 * AMENDED (task 729): "mounts a CodeMirror surface" is no longer the same
 * sentence as "imports `@uiw/react-codemirror`". The pod's CodeMirror
 * configuration was hoisted into ONE shared mount
 * (`components/source-pod-code-mirror.tsx`) so a keystroke stops reconfiguring
 * the editor, and both wearers now reach the vendor package THROUGH it. A
 * census that still read the package name would have quietly stopped covering
 * the very two modules the rule was written for — green, and empty.
 *
 * So the surface set is DERIVED rather than listed: a Virgil module counts as a
 * CodeMirror surface when it imports the vendor package and hands the mount an
 * `editable={…}` it takes from its CALLER. That property is the whole reason
 * the census has to follow it — a surface that DELEGATES its editability makes
 * its callers the gate-holders. The two CodeMirror modules that resolve their
 * own editability instead (`CodeEditor`, the full `.tex` pane with its own save
 * path, and the style-file modal) delegate nothing, so neither they nor their
 * callers are dragged in, and they still fall out on their own rather than by
 * being excused. A delegating surface is itself excluded from the population:
 * having no editability of its own to resolve, it has no gate to read.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const SRC = join(process.cwd(), "src");

/** The signal a gated surface reads — the hook over the main editor's
 *  declarative `data-editable` attribute. */
const GATE = "useMainEditable";
/** The vendor CodeMirror React surface. */
const CODEMIRROR = "@uiw/react-codemirror";
/** Handing a mounted surface its editability from the caller's own value —
 *  what makes a module a DELEGATING surface rather than a gate-holder. */
const DELEGATES_EDITABILITY = /editable=\{/;
/** Writing a ProseMirror node attribute — the two spellings in this tree. */
const ATTR_WRITE = /\bupdateAttributes\b|\bsetNodeMarkup\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/** A module path with its extension (and `/index`) dropped, so an import
 *  specifier and the file it names compare equal. */
const moduleId = (p: string) => p.replace(/\.(tsx?|jsx?)$/, "").replace(/\/index$/, "");

/** Every module specifier a file imports, resolved to a src-relative module id
 *  (`@/x` and `./x` alike) or left as the bare package name. */
function importsOf(file: string, text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/from\s+["']([^"']+)["']/g)) {
    const spec = m[1];
    if (spec.startsWith("@/")) out.add(moduleId(spec.slice(2)));
    else if (spec.startsWith("."))
      out.add(moduleId(relative(SRC, resolve(join(SRC, dirname(file)), spec))));
    else out.add(spec);
  }
  return out;
}

type Module = { file: string; text: string };

function allModules(): Module[] {
  return walk(SRC).map((file) => ({
    file: relative(SRC, file),
    text: readFileSync(file, "utf8"),
  }));
}

/** Virgil's own DELEGATING CodeMirror surfaces — the modules a wearer mounts
 *  instead of the vendor package, whose editability comes from the caller. */
function delegatingSurfaces(modules = allModules()): Set<string> {
  return new Set(
    modules
      .filter(
        (m) => importsOf(m.file, m.text).has(CODEMIRROR) && DELEGATES_EDITABILITY.test(m.text),
      )
      .map((m) => moduleId(m.file)),
  );
}

/** Every production module that mounts a CodeMirror surface — the vendor one or
 *  a delegating surface over it — AND writes a PM node attribute: i.e. every
 *  embedded editor over DOCUMENT bytes whose editability is its own to resolve. */
function embeddedSourceEditors(): Module[] {
  const modules = allModules();
  const delegating = delegatingSurfaces(modules);
  const surfaces = new Set<string>([CODEMIRROR, ...delegating]);
  return modules.filter(
    (m) =>
      !delegating.has(moduleId(m.file)) &&
      ATTR_WRITE.test(m.text) &&
      [...importsOf(m.file, m.text)].some((spec) => surfaces.has(spec)),
  );
}

describe("embedded source editors gate on the main editor's editability", () => {
  it("every CodeMirror surface that writes a node attr reads the gate", () => {
    const ungated = embeddedSourceEditors()
      .filter(({ text }) => !text.includes(GATE))
      .map(({ file }) => file);
    expect(
      ungated,
      `these mount a CodeMirror surface over document bytes but never read ` +
        `\`${GATE}\`, so on a read-only / partner-claimed doc they accept ` +
        `typing whose write-back \`readOnlyEnforcer\` silently drops`,
    ).toEqual([]);
  });

  it("names the two wearers the rule was written for", () => {
    const files = embeddedSourceEditors().map(({ file }) => file);
    // The in-place pod (`texBlock` + `forestBlock` wear it) and its float twin.
    expect(files).toContain("components/SourcePodNodeView.tsx");
    expect(files).toContain("text-objects/floats/source-pod-body.tsx");
  });

  it("is not vacuous — the membership test still matches a real surface", () => {
    // A rename of the write API (or of the CodeMirror package) would otherwise
    // empty the set and turn leg 1 into a permanent green.
    expect(embeddedSourceEditors().length).toBeGreaterThanOrEqual(2);
  });

  it("follows the pod's shared mount rather than the package name", () => {
    // The task-729 amendment's own canary. Both wearers reach CodeMirror only
    // THROUGH this module now, so a resolver that stopped seeing the
    // indirection would empty the population silently — which is exactly how
    // this suite first went green-and-empty.
    const delegating = delegatingSurfaces();
    expect(
      [...delegating],
      "the pod's shared CodeMirror mount must be discovered as a delegating surface",
    ).toContain("components/source-pod-code-mirror");
    for (const { text } of embeddedSourceEditors()) {
      // …and no member reaches the vendor package directly any more, so leg 2
      // is really being answered by the indirection, not by a leftover import.
      expect(text).not.toMatch(/from ["']@uiw\/react-codemirror["']/);
    }
  });

  it("does not drag in the callers of a surface that owns its own editability", () => {
    // `CodeEditor` (the full `.tex` pane) and the style-file modal delegate no
    // editability, so they are not surfaces to follow — and `EditorLayout`,
    // which mounts the code pane and separately writes node attrs for an
    // unrelated reason, must stay out of a rule about embedded DOCUMENT-byte
    // editors. A looser "anything that transitively reaches CodeMirror" test
    // would have swept it in and made leg 1 fail for a surface that has no
    // read-only problem.
    const files = embeddedSourceEditors().map(({ file }) => file);
    expect(files).not.toContain("components/EditorLayout.tsx");
    expect(files).not.toContain("components/CodeEditor.tsx");
    expect(files).not.toContain("components/StyleEditorModal.tsx");
  });
});
