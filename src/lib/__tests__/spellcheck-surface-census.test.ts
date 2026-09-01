// Task 2026-08-31-518 — the census.
//
// The checker was never the part that could misbehave. A PROSE SURFACE that
// never names it is, and that surface type-checks perfectly, renders perfectly,
// and fails in the quietest possible way: the browser keeps drawing its own
// underline there, so nothing is visibly broken and the LaTeX-awareness is
// simply absent on that one editor. Task 517 named this exact hazard one layer
// up ("twelve threads are twelve chances for the thirteenth surface to be
// forgotten") and answered it with a single `<body>` attribute; a DECORATION
// cannot be inherited, so the answer here is a census instead.
//
// MEMBERSHIP IS DISCOVERED — every production file that builds an editor
// extension stack — never a hand list, which could only be missing the surface
// that drifted. Both allowlists are EMPTY.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { commentsStripped, trackedFiles, REPO_ROOT } from "@/lib/__tests__/_source-scan";

const PRODUCTION = [
  ...trackedFiles("src", /\.(ts|tsx)$/),
  ...trackedFiles("library", /\.(ts|tsx)$/),
].filter((p) => !p.includes("__tests__"));

const rel = (abs: string) => abs.slice(REPO_ROOT.length + 1);
const code = (abs: string) => commentsStripped(readFileSync(abs, "utf8"));

/** The factory every main/float prose stack is built by. */
const BUILDS_STACK = /\bbuildEditorExtensions\s*\(\s*\{/;
/** The second stack — card bodies compose their own list. */
const MOUNTS_DECORATOR = /\bSpellcheckDecorator\.configure\s*\(/;

describe("every production prose stack names the spellchecker", () => {
  it("…and it can SEE one that does not — the canary", () => {
    // Synthetic, never standing on a drained production line.
    const fixture = commentsStripped("  extensions: buildEditorExtensions({\n    surface: 'main',\n  }),\n");
    expect(BUILDS_STACK.test(fixture)).toBe(true);
    expect(/spellcheckPortRef/.test(fixture)).toBe(false);
  });

  it("every `buildEditorExtensions` caller states `spellcheckPortRef`", () => {
    const offenders: string[] = [];
    for (const abs of PRODUCTION) {
      // The factory's own file DECLARES the field; it is not a caller.
      if (rel(abs) === "src/lib/editor-extensions.ts") continue;
      const src = code(abs);
      if (!BUILDS_STACK.test(src)) continue;
      if (!/spellcheckPortRef/.test(src)) offenders.push(rel(abs));
    }
    // EMPTY by design: a hit is THREAD-it (pass `useSpellcheckPortRef()`) or
    // STATE-it (`spellcheckPortRef: null`), never list-it.
    expect(offenders).toEqual([]);
  });

  it("…and there really are callers to speak for — the population is non-empty", () => {
    const callers = PRODUCTION.filter(
      (abs) => rel(abs) !== "src/lib/editor-extensions.ts" && BUILDS_STACK.test(code(abs)),
    );
    // The main editor, ExampleCard and nine float bodies.
    expect(callers.length).toBeGreaterThanOrEqual(11);
  });

  it("the SECOND stack (card bodies) mounts the decorator directly", () => {
    // `RichTextField` composes its own extension list rather than going through
    // the factory, so it is the one surface the leg above cannot speak for.
    const rtf = code(`${REPO_ROOT}/src/components/RichTextField.tsx`);
    expect(MOUNTS_DECORATOR.test(rtf)).toBe(true);
    expect(rtf).toContain("useSpellcheckPortRef");
  });

  it("exactly TWO production files mount the decorator", () => {
    // The factory and the card-body list. A third is a third stack nobody
    // knows about; zero means the feature silently left the app.
    const mounts = PRODUCTION.filter((abs) => MOUNTS_DECORATOR.test(code(abs))).map(rel).sort();
    expect(mounts).toEqual([
      "src/components/RichTextField.tsx",
      "src/lib/editor-extensions.ts",
    ]);
  });
});

describe("one owner per question", () => {
  it("only the decorator declines the browser's checker on Virgil's behalf", () => {
    // `VIRGIL_CHECKED_ATTRS` is the third CLAIM in `spellcheck-policy.ts` —
    // "Virgil underlines this surface". A second speller would be a surface
    // that suppresses the browser's underline and paints nothing.
    const users = PRODUCTION.filter((abs) => /VIRGIL_CHECKED_ATTRS/.test(code(abs))).map(rel).sort();
    expect(users).toEqual([
      "src/lib/spellcheck-policy.ts",
      "src/lib/tiptap/spellcheck-decorator.ts",
    ]);
  });

  it("nothing but the worker/client pair builds a dictionary engine", () => {
    // The engine is a pure function of two vendored assets and lives off the
    // main thread. A second construction site would put 550 KB of Hunspell
    // back on it. The needle is the IDENTIFIER rather than a call, because the
    // worker passes it as a function reference (`.then(createSpellEngine)`) —
    // a call-shaped needle is blind to exactly the file that owns the engine.
    const users = PRODUCTION.filter((abs) => /\bcreateSpellEngine\b/.test(code(abs))).map(rel).sort();
    expect(users).toEqual([
      "src/lib/spell/spell-client.ts",
      "src/lib/spell/spell-core.ts",
      "src/lib/spell/spell.worker.ts",
    ]);
  });

  it("nothing re-derives the accepted-word test", () => {
    // "Is this word the user's own?" is `accepted-words.ts`'s question, and a
    // surface that answered it privately (a bib-name list of its own, a second
    // possessive strip) is how a term added in the popover stays flagged.
    const offenders = PRODUCTION.filter((abs) => {
      const r = rel(abs);
      if (r.startsWith("src/lib/spell/")) return false;
      return /\bbibNameWords\s*\(|\bacceptedWordKey\s*\(/.test(code(abs));
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it("only the PLUGIN opens the suggestion menu", () => {
    // The menu offers corrections and two "add to dictionary" doors, all of
    // which act on a range the DECORATION established. A second opener would
    // be a surface offering a correction for a word nothing has checked.
    const users = PRODUCTION.filter((abs) => {
      // The store DECLARES it; the question is who CALLS it.
      if (rel(abs) === "src/lib/spell/spell-menu-store.ts") return false;
      return /\bopenSpellMenu\s*\(/.test(code(abs));
    }).map(rel);
    expect(users).toEqual(["src/lib/tiptap/spellcheck-decorator.ts"]);
  });

  it("the menu is mounted exactly ONCE, at the app root", () => {
    // It is a gesture-scoped singleton whose request carries the document's own
    // port. Mounted per PANE it would render N times under keep-alive; mounted
    // nowhere the squiggle is read-only.
    const mounts = PRODUCTION.filter((abs) => /<SpellSuggestionMenu\s*\/>/.test(code(abs))).map(rel);
    expect(mounts).toEqual(["src/components/EditorLayout.tsx"]);
  });

  it("only the MENU reaches the two accept doors", () => {
    // "Add to dictionary" is a user gesture with a visible consequence; a
    // second caller would be a word accepted by something the user did not do.
    const users = PRODUCTION.filter((abs) => {
      const r = rel(abs);
      if (r === "src/lib/spell/spell-port.ts") return false;
      if (r === "src/lib/spell/spellcheck-context.tsx") return false;
      return /\.acceptInPaper\s*\(|\.acceptGlobally\s*\(/.test(code(abs));
    }).map(rel);
    expect(users).toEqual(["src/components/SpellSuggestionMenu.tsx"]);
  });

  it("nothing writes the global list except through the port", () => {
    const users = PRODUCTION.filter((abs) => {
      const r = rel(abs);
      if (r === "src/lib/spell/global-dictionary.ts") return false;
      if (r === "src/lib/spell/spellcheck-context.tsx") return false;
      return /\baddToGlobalDictionary\s*\(|\bsetGlobalDictionary\s*\(/.test(code(abs));
    }).map(rel);
    expect(users).toEqual([]);
  });

  it("the paper dictionary is DECLARED as a sidecar", () => {
    const sv = readFileSync(`${REPO_ROOT}/src/lib/sidecar-value.ts`, "utf8");
    expect(sv).toContain('"dictionary.json": { tier: "content", store: "disk", mount: true }');
  });
});
