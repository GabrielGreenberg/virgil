/**
 * EDITOR CALLBACK PRODUCER CENSUS — an optional callback the editor CONSUMES
 * has a PRODUCER at the one place that mounts it, or it is not on the bag.
 *
 * Task 534's defect in one line: `<VirgilEditor>` declared
 * `onConfirmLabelRename` (and `isLabelTaken`), the heading NodeView, the figure
 * lozenge and eight float bodies all consumed it — through refs, a proxy on
 * `EditorHandle`, the extension factory's `callbacks` bag — and NOTHING passed
 * it. The one production mount (`EditorPane`) supplied every SIBLING
 * (`onConfirmHeadingDelete`, `onConfirmFigureDelete`, `onOpenHeadingTypeMenu`)
 * and not these two, so `updateRefs` was `false` on every path, every label
 * rename orphaned every `\ref`, and the "label already in use" warning could
 * never fire. `onConfirmFootnoteMove` had rotted the same way behind a comment
 * asserting that "EditorLayout always wires the callback". Every one of those
 * props is OPTIONAL, so it all type-checked — for five months.
 *
 * This is the "A registry earns its name by being read" law (AGENTS.md) in its
 * PRODUCER tense. `action-context-honesty` asks whether a declared FIELD is
 * READ; `dead-panel-prop-guardrail` asks whether a declared PROP is CONSUMED
 * by its own component. Neither can see a consumed prop that no one SUPPLIES:
 * the consumer reads it (so the field census is happy), the component
 * destructures it (so the prop census is happy), and the mount that should
 * pass it simply does not.
 *
 * THE RULE, in three legs:
 *   1. every OPTIONAL callback prop `EditorProps` declares is READ inside
 *      `Editor.tsx` — a prop destructured and never used is dead the other way
 *      (`onAddComment` / `onArchive` were exactly that, and are deleted);
 *   2. every one of them is PASSED at the sole production `<VirgilEditor>`
 *      mount — the population is DISCOVERED from the interface, so a callback
 *      added tomorrow is covered by declaring itself;
 *   3. every member of the extension factory's `callbacks` bag is one of those
 *      props — a bag member is a NodeView's promise that a host answers it.
 *
 * Allowlist EMPTY. A hit is WIRE-it (supply it at the mount) or DELETE-it (the
 * prop, its ref mirror, and its consumers); a callback the app has no producer
 * for is a feature that silently does nothing.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  REPO_ROOT,
  codeOnly,
  commentsStripped,
  elementsNamed,
  trackedFiles,
} from "../../lib/__tests__/_source-scan";

const EDITOR = path.join(REPO_ROOT, "src/components/Editor.tsx");
const EXTENSIONS = path.join(REPO_ROOT, "src/lib/editor-extensions.ts");
const read = (p: string) => fs.readFileSync(p, "utf8");

/** The `{ … }` body of `interface <name>`, brace-balanced. */
function interfaceBody(source: string, name: string): string {
  const m = new RegExp(`interface ${name}\\s*\\{`).exec(source);
  if (!m) throw new Error(`interface ${name} not found`);
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(m.index + m[0].length, i);
    }
  }
  throw new Error(`interface ${name} unterminated`);
}

interface Member { name: string; optional: boolean; type: string }

/** Top-level members of an interface body (multi-line types included). */
function members(body: string): Member[] {
  const out: Member[] = [];
  const lines = body.split("\n");
  let cur: Member | null = null;
  for (const line of lines) {
    const m = /^ {2}(\w+)(\??):\s*(.*)$/.exec(line);
    if (m) {
      if (cur) out.push(cur);
      cur = { name: m[1], optional: m[2] === "?", type: m[3] };
    } else if (cur) {
      cur.type += "\n" + line;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** The optional members whose type is a FUNCTION. */
function optionalCallbacks(body: string): string[] {
  return members(body)
    .filter((m) => m.optional && /=>/.test(m.type))
    .map((m) => m.name);
}

const isProduction = (p: string) => !/__tests__|\.test\.|\.spec\./.test(p);

/** Every production `<VirgilEditor …>` element in `src/` + `library/`. */
function productionMounts(): { file: string; tag: string }[] {
  const out: { file: string; tag: string }[] = [];
  for (const root of ["src", "library"]) {
    for (const file of trackedFiles(root, /\.tsx$/)) {
      if (!isProduction(file)) continue;
      const src = commentsStripped(read(file));
      for (const hit of elementsNamed(src, "VirgilEditor")) {
        out.push({ file: path.relative(REPO_ROOT, file), tag: hit.tag });
      }
    }
  }
  return out;
}

const editorSource = commentsStripped(read(EDITOR));
const EDITOR_CALLBACKS = optionalCallbacks(interfaceBody(editorSource, "EditorProps"));

describe("editor callback producer census (task 534)", () => {
  it("CANARY: the parser sees an optional callback, and only an optional callback", () => {
    const body = interfaceBody(
      `interface P {\n  a: string;\n  onB?: () => void;\n  onC?: (\n    x: number,\n  ) => Promise<boolean>;\n  d?: number;\n  onE: () => void;\n}`,
      "P",
    );
    expect(optionalCallbacks(body)).toEqual(["onB", "onC"]);
  });

  it("the population is the live one — the props this task wired are in it, the ones it deleted are not", () => {
    expect(EDITOR_CALLBACKS).toEqual(
      expect.arrayContaining([
        "onConfirmLabelRename",
        "onConfirmFootnoteMove",
        "onConfirmHeadingDelete",
        "onConfirmFigureDelete",
        "onOpenHeadingTypeMenu",
      ]),
    );
    // Deleted: the predicate is `@/lib/labels`' own (no prop), and the two
    // never-read handlers.
    expect(EDITOR_CALLBACKS).not.toContain("isLabelTaken");
    expect(EDITOR_CALLBACKS).not.toContain("onAddComment");
    expect(EDITOR_CALLBACKS).not.toContain("onArchive");
    expect(EDITOR_CALLBACKS.length).toBeGreaterThanOrEqual(5);
  });

  it("leg 1 — every optional callback is READ in Editor.tsx (declaration + destructure + a use)", () => {
    const code = codeOnly(read(EDITOR));
    const unread = EDITOR_CALLBACKS.filter((name) => {
      const n = (code.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
      return n < 3;
    });
    expect(unread, "declared and destructured but never used — WIRE-it or DELETE-it").toEqual([]);
  });

  it("leg 2 — every optional callback is PASSED at the sole production <VirgilEditor> mount", () => {
    const mounts = productionMounts();
    // ONE mount: `EditorPane` (the Library Reader mounts EditorPane, not the
    // editor). A second mount would be a second place for a producer to go
    // missing, and must be censused here rather than discovered by an audit.
    expect(mounts.map((m) => m.file)).toEqual(["src/components/EditorPane.tsx"]);
    const [{ tag }] = mounts;
    const unsupplied = EDITOR_CALLBACKS.filter(
      (name) => !new RegExp(`\\b${name}=`).test(tag),
    );
    expect(
      unsupplied,
      "consumed by a NodeView / the drop handler and supplied by nobody — the task-534 shape",
    ).toEqual([]);
  });

  it("leg 3 — every member of the extension factory's `callbacks` bag is a produced prop", () => {
    const ext = commentsStripped(read(EXTENSIONS));
    const bag = members(interfaceBody(ext, "EditorExtensionsCallbackRefs")).map((m) => m.name);
    expect(bag.length).toBeGreaterThanOrEqual(4);
    const orphaned = bag.filter((name) => !EDITOR_CALLBACKS.includes(name));
    expect(orphaned, "a bag member no <VirgilEditor> prop feeds").toEqual([]);
    // …and Editor.tsx actually threads each one into the bag it builds.
    const literal = /callbacks:\s*\{([^}]*)\}/.exec(editorSource)?.[1] ?? "";
    for (const name of bag) expect(literal).toMatch(new RegExp(`\\b${name}:`));
  });
});

describe("the label predicate has ONE home and the rename has ONE door", () => {
  const production = (root: string) =>
    trackedFiles(root, /\.tsx?$/).filter(isProduction);

  it("no production file threads `isLabelTaken` as a prop / ref / handle proxy — the SSOT is `@/lib/labels`", () => {
    const offenders: string[] = [];
    for (const root of ["src", "library"]) {
      for (const file of production(root)) {
        const code = codeOnly(read(file));
        if (/\bisLabelTakenRef\b|\.isLabelTaken\(/.test(code)) {
          offenders.push(path.relative(REPO_ROOT, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the retired outline primitive stays retired", () => {
    for (const root of ["src", "library"]) {
      for (const file of production(root)) {
        expect(codeOnly(read(file)), path.relative(REPO_ROOT, file)).not.toMatch(
          /\bupdateHeadingLabelByUuid\b/,
        );
      }
    }
  });

  it("the three rename producers enter the door, and nothing else re-derives the ref walk", () => {
    const callers: string[] = [];
    const walkers: string[] = [];
    for (const root of ["src", "library"]) {
      for (const file of production(root)) {
        const rel = path.relative(REPO_ROOT, file);
        const code = codeOnly(read(file));
        if (/\brenameLabelWithRefs\(/.test(code)) callers.push(rel);
        // The retired copies' own shape: a walk matching refs on the OLD key.
        if (/\.label === oldLabel\b/.test(code)) walkers.push(rel);
      }
    }
    // The door plus its three producers — an EXACT set, so a fourth rename
    // surface has to be acknowledged here (and enter the door) rather than
    // quietly write the attr alone.
    expect(callers.sort()).toEqual([
      "src/components/FigureAnnotation.tsx",
      "src/components/editor-layout/card-actions/editor-ops.ts",
      "src/lib/editor-extensions.ts",
      "src/lib/tiptap/label-rename.ts",
    ]);
    // The ONE exemption is the LabelRefPopover's re-point of a SINGLE ref at a
    // different, existing label (`handleRefChangeLabel`) — a different gesture
    // (no declaration moves), and it stops after the first hit, which the
    // second expectation keeps true.
    expect(walkers.sort()).toEqual([
      "src/components/editor-layout/card-actions/ref.ts",
      "src/lib/tiptap/label-rename.ts",
    ]);
    const refTs = codeOnly(read(path.join(REPO_ROOT, "src/components/editor-layout/card-actions/ref.ts")));
    const handler = /const handleRefChangeLabel = useCallback\(([\s\S]*?)\n  \);/.exec(refTs)?.[1] ?? "";
    expect(handler).toMatch(/\.label === oldLabel/);
    expect(handler).toMatch(/return false;/);
  });
});
