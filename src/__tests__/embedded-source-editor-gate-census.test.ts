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
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");

/** The signal a gated surface reads — the hook over the main editor's
 *  declarative `data-editable` attribute. */
const GATE = "useMainEditable";
/** The CodeMirror React surface. */
const CODEMIRROR = "@uiw/react-codemirror";
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

/** Every production module that mounts a CodeMirror surface AND writes a PM
 *  node attribute — i.e. every embedded editor over DOCUMENT bytes. */
function embeddedSourceEditors(): { file: string; text: string }[] {
  return walk(SRC)
    .map((file) => ({ file: relative(SRC, file), text: readFileSync(file, "utf8") }))
    .filter(({ text }) => text.includes(CODEMIRROR) && ATTR_WRITE.test(text));
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
});
