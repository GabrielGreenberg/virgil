// @vitest-environment jsdom
//
// Task 1198 — "which input / paste rules does a Virgil editor run?" is a
// MEASURED fact, read off the mounted stacks, not a source grep.
//
// ── WHAT WAS WRONG ────────────────────────────────────────────────────────
// Measured at `34bf7ec9`, typing one character at a time on the main editor:
// `` the `a' and `b' cases `` became `the ` + code(`a' and `) + `b' cases` —
// both backticks DELETED, `\texttt{a' and }` written to the `.tex`. In LaTeX
// the backtick OPENS A QUOTE. StarterKit's `code` / `bold` / `italic` /
// `strike` marks (and `highlight`, and the excerpt card body's `heading` /
// `codeBlock`) still carried their upstream markdown input + paste rules. Two
// members of the class had been killed one stack at a time (the heading `# `
// rules, task 1176's `---`), and `typed-latex-census.test.ts` could see none of
// them: it greps Virgil SOURCE for gated `handleTextInput` plugins, so a rule
// INHERITED from an upstream extension was an uncensused third provider.
//
// ── THE CENSUS ────────────────────────────────────────────────────────────
// Mount every production stack, ask each mounted extension what its
// `addInputRules` / `addPasteRules` actually return (the same field TipTap's
// ExtensionManager reads), and pin the provider set EXACTLY. A stock markdown
// rule re-entering any stack — a key left on, a `StarterKit` import that skips
// `VirgilStarterKit`, a new upstream extension — changes the set and fails.
// Virgil's typed-LaTeX rules are `handleTextInput` PLUGINS, not input rules;
// `typed-latex-census.test.ts` owns them, and this suite's typing legs prove the
// two halves together on the shipped `handleTextInput` path.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { readFileSync } from "node:fs";
import { Editor, getExtensionField, getSchemaTypeByName } from "@tiptap/core";
import type { AnyExtension, Extensions, JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { extensionsForScope } from "@/lib/borrowed-render";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import { commentsStripped, REPO_ROOT, trackedFiles } from "@/lib/__tests__/_source-scan";
import { MARKDOWN_RULE_EXTENSIONS, VirgilStarterKit } from "@/lib/tiptap/virgil-starter-kit";

function mainCtx(surface: "main" | "float" = "main"): EditorExtensionsCtx {
  return {
    surface,
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  } as unknown as EditorExtensionsCtx;
}

/** Every production stack. The card-body pair is `borrowed-render`'s own
 *  `extensionsForScope` — the composition `RichTextField` / `BorrowedMainText`
 *  mount too (they only add Placeholder / TabIndent, which carry no rules). */
const STACKS: Record<string, () => Extensions> = {
  main: () => buildEditorExtensions(mainCtx("main")),
  float: () => buildEditorExtensions(mainCtx("float")),
  "card-body:card": () => extensionsForScope("card"),
  "card-body:excerpt": () => extensionsForScope("excerpt"),
};

function mount(extensions: Extensions, content?: JSONContent): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({ element, extensions, content });
}

/** `name:input` / `name:paste` for every mounted extension whose rules field
 *  returns a non-empty list — read exactly as ExtensionManager reads it. */
function ruleProviders(ed: Editor): string[] {
  const out: string[] = [];
  for (const ext of ed.extensionManager.extensions as AnyExtension[]) {
    const ctx = {
      name: ext.name,
      options: ext.options,
      storage: (ed.storage as unknown as Record<string, unknown>)[ext.name],
      editor: ed,
      type: getSchemaTypeByName(ext.name, ed.schema),
    };
    for (const [field, label] of [
      ["addInputRules", "input"],
      ["addPasteRules", "paste"],
    ] as const) {
      const fn = getExtensionField<(() => unknown[]) | undefined>(ext, field, ctx);
      const rules = fn ? fn() : [];
      if (rules && rules.length) out.push(`${ext.name}:${label}`);
    }
  }
  return out.sort();
}

// The declared provider set. Each entry is a rule Virgil MEANS to run:
//   bulletList / orderedList / blockquote — the wrapper rules (`- ` / `1. ` /
//     `> `), mounted through `withWrapperGate` (task 731);
//   smartQuotes / autocorrect — Virgil's own typographic rules, on main AND
//     float (task 1288: a float edits the paper's own prose and writes it back,
//     so a popout that withheld them typed straight quotes into the `.tex`);
//   link:paste — autolinking a pasted URL (not markdown).
const WRAPPERS = ["blockquote:input", "bulletList:input", "orderedList:input"];
const EXPECTED: Record<string, string[]> = {
  main: [...WRAPPERS, "autocorrect:input", "link:paste", "smartQuotes:input"].sort(),
  float: [...WRAPPERS, "autocorrect:input", "link:paste", "smartQuotes:input"].sort(),
  "card-body:card": ["bulletList:input", "link:paste", "orderedList:input"].sort(),
  "card-body:excerpt": [...WRAPPERS, "link:paste"].sort(),
};

describe("CENSUS: the input/paste rules every production stack runs (task 1198)", () => {
  for (const [id, build] of Object.entries(STACKS)) {
    it(`${id}: exactly the declared providers — no markdown rule`, () => {
      const ed = mount(build());
      const providers = ruleProviders(ed);
      ed.destroy();
      expect(providers).toEqual(EXPECTED[id]);
      for (const p of providers) {
        expect(MARKDOWN_RULE_EXTENSIONS.has(p.split(":")[0]), p).toBe(false);
      }
    });
  }

  it("SELF-CHECK: the probe sees the stock rules (a re-enabled StarterKit mark fails)", () => {
    const stock = mount([StarterKit]);
    const providers = ruleProviders(stock);
    stock.destroy();
    for (const p of ["bold:input", "bold:paste", "code:input", "code:paste", "italic:input", "strike:input", "heading:input", "codeBlock:input", "horizontalRule:input"]) {
      expect(providers, p).toContain(p);
    }
    const virgil = mount([VirgilStarterKit]);
    const stripped = ruleProviders(virgil);
    virgil.destroy();
    expect(stripped.filter((p) => MARKDOWN_RULE_EXTENSIONS.has(p.split(":")[0]))).toEqual([]);
  });

  it("no production file mounts the stock StarterKit — virgil-starter-kit.ts is the one door", () => {
    const importers = trackedFiles("src", /\.tsx?$/)
      .filter((f) => !f.includes("__tests__"))
      .filter((f) => /from\s+["']@tiptap\/starter-kit["']/.test(commentsStripped(readFileSync(f, "utf8"))))
      .map((f) => f.slice(REPO_ROOT.length + 1));
    expect(importers).toEqual(["src/lib/tiptap/virgil-starter-kit.ts"]);
  });
});

// ── the behaviour: LaTeX typed literally ─────────────────────────────────────

function typeChars(ed: Editor, text: string) {
  for (const ch of text) {
    const { from, to } = ed.state.selection;
    const handled = ed.view.someProp("handleTextInput", (f) =>
      (f as (...a: unknown[]) => boolean)(ed.view, from, to, ch),
    );
    if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to));
  }
}

function firstParagraph(ed: Editor) {
  return ed.state.doc.firstChild!;
}

function marksIn(ed: Editor): string[] {
  const names = new Set<string>();
  ed.state.doc.descendants((n) => {
    for (const m of n.marks) names.add(m.type.name);
  });
  return [...names].sort();
}

const ROWS = [
  "the `a' and `b' cases",
  "a `quoted' word, then ``double''",
  "p *one* q",
  "x **two** y",
  "x ~~s~~ y",
  "x _u_ y",
  "x ==h== y",
];

const EMPTY_DOC: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", attrs: { uuid: "p1" } }],
};

describe("typing LaTeX quotes and literal markdown characters (task 1198)", () => {
  for (const row of ROWS) {
    it(`main: \`${row}\` stays literal — no mark, nothing deleted, .tex as typed`, () => {
      const ed = mount(buildEditorExtensions(mainCtx("main")), EMPTY_DOC);
      ed.commands.setTextSelection(1);
      typeChars(ed, row);
      // Smart quotes may curl `'`; compare with the typographic layer folded
      // back so the assertion is about MARKDOWN, not typography.
      const text = firstParagraph(ed).textContent.replace(/[‘’]/g, (c) => (c === "‘" ? "`" : "'"));
      expect(text).toBe(row);
      expect(marksIn(ed)).toEqual([]);
      const tex = serializeBodyOnly(ed.state.doc.toJSON() as never);
      expect(tex).not.toContain("\\texttt");
      expect(tex).not.toContain("\\textbf");
      expect(tex).not.toContain("\\emph");
      expect(tex).not.toContain("\\textit");
      ed.destroy();
    });
  }

  for (const scope of ["card", "excerpt"] as const) {
    it(`card-body:${scope}: backtick quotes and *x* stay literal`, () => {
      const ed = mount(extensionsForScope(scope), EMPTY_DOC);
      ed.commands.setTextSelection(1);
      typeChars(ed, "the `a' and `b' cases, *one* **two**");
      expect(firstParagraph(ed).textContent).toBe("the `a' and `b' cases, *one* **two**");
      expect(marksIn(ed)).toEqual([]);
      ed.destroy();
    });
  }

  it("excerpt card body: `# ` and ``` at a block start do not convert", () => {
    const ed = mount(extensionsForScope("excerpt"), EMPTY_DOC);
    ed.commands.setTextSelection(1);
    typeChars(ed, "# ");
    expect(ed.state.doc.firstChild!.type.name).toBe("paragraph");
    ed.commands.setContent(EMPTY_DOC);
    ed.commands.setTextSelection(1);
    typeChars(ed, "``` ");
    expect(ed.state.doc.firstChild!.type.name).toBe("paragraph");
    ed.destroy();
  });

  it("main: ``` at a block start does not open a code block", () => {
    const ed = mount(buildEditorExtensions(mainCtx("main")), EMPTY_DOC);
    ed.commands.setTextSelection(1);
    typeChars(ed, "``` ");
    expect(ed.state.doc.firstChild!.type.name).toBe("paragraph");
    ed.destroy();
  });

  it("main: a plain-text PASTE of `` `a' and `b' `` and `**b**` stays literal", () => {
    const ed = mount(buildEditorExtensions(mainCtx("main")), EMPTY_DOC);
    ed.commands.setTextSelection(1);
    // jsdom has no ClipboardEvent; `pasteText` only needs one to construct.
    const g = globalThis as { ClipboardEvent?: unknown };
    g.ClipboardEvent ??= class extends Event {
      clipboardData = null;
    };
    ed.view.pasteText("the `a' and `b' cases **b**");
    expect(firstParagraph(ed).textContent).toContain("`a' and `b'");
    expect(firstParagraph(ed).textContent).toContain("**b**");
    expect(marksIn(ed)).toEqual([]);
    ed.destroy();
  });

  it("Mod-B (an explicit command) still bolds — only the rewrite-on-type rules are gone", () => {
    const ed = mount(buildEditorExtensions(mainCtx("main")), {
      type: "doc",
      content: [{ type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "word" }] }],
    });
    ed.commands.setTextSelection({ from: 1, to: 5 });
    expect(ed.commands.toggleBold()).toBe(true);
    expect(marksIn(ed)).toEqual(["bold"]);
    ed.destroy();
  });
});
