/**
 * The ONE LaTeX language door for Virgil's CodeMirror surfaces (task
 * 2026-11-12-1582) — the palette's sibling (`virgil-cm-palette.ts`, task 1245).
 *
 * `codemirror-lang-latex`'s `latex(config)` defaults EVERY option ON
 * (`enableLinting`, `enableAutocomplete`, `enableTooltips`, `autoCloseTags`,
 * `autoCloseBrackets` — node_modules/codemirror-lang-latex/dist/index.js,
 * `function latex`). Until this module each mount spelled its own call, so two
 * of the three took the package defaults unseen: the style editor flagged every
 * preamble "Missing document environment" (the package linter fires on any
 * >100-char text without `\begin{document}`), and the code view ran a SECOND
 * diagnostics channel beside Virgil's Errors panel with different rules. Every
 * option is now stated here, once, and every mount calls `virgilLatex(surface)`
 * instead of `latex(`. `virgil-cm-language-census.test.ts` keeps a fourth mount
 * from taking the package defaults.
 *
 * The choices:
 * - `enableLinting: false` everywhere — Virgil's diagnostics owner
 *   (`syntax-check.ts` / `latex-rules.ts` → Errors panel) is the one lint
 *   authority; the package linter is a parallel channel with false positives
 *   on fragments and multi-file papers, and an O(doc) tree walk per pause.
 * - `enableAutocomplete: true` — PRESERVES the live behaviour (a completion
 *   popup while typing). The mounts' `basicSetup.autocompletion: false` does
 *   NOT turn completion off: it only keeps basicSetup from adding a SECOND,
 *   duplicate `autocompletion()` beside the one this option installs.
 * - `enableTooltips`, `autoCloseTags`, `autoCloseBrackets: true` — the live
 *   behaviour, now written down.
 *
 * Memoised per surface: the returned `LanguageSupport` is a description, not a
 * live object, so one value is safely shared by every mount of a surface — and
 * a stable identity is what the source pod's reconfigure guard needs (task 729:
 * `SOURCE_POD_EXTENSIONS` is minted once at module scope).
 */

import { latex } from "codemirror-lang-latex";
import type { LanguageSupport } from "@codemirror/language";

/** The CodeMirror surfaces that edit LaTeX. */
export type VirgilLatexSurface = "code-view" | "style-editor" | "source-pod";

type LatexConfig = NonNullable<Parameters<typeof latex>[0]>;

/** Every `latex()` option, stated explicitly per surface. All three surfaces
 *  currently agree; the table is per-surface so a divergence is one row. */
export const VIRGIL_LATEX_OPTIONS: Record<
  VirgilLatexSurface,
  Required<
    Pick<
      LatexConfig,
      | "enableLinting"
      | "enableAutocomplete"
      | "enableTooltips"
      | "autoCloseTags"
      | "autoCloseBrackets"
    >
  >
> = {
  "code-view": {
    enableLinting: false,
    enableAutocomplete: true,
    enableTooltips: true,
    autoCloseTags: true,
    autoCloseBrackets: true,
  },
  "style-editor": {
    enableLinting: false,
    enableAutocomplete: true,
    enableTooltips: true,
    autoCloseTags: true,
    autoCloseBrackets: true,
  },
  "source-pod": {
    enableLinting: false,
    enableAutocomplete: true,
    enableTooltips: true,
    autoCloseTags: true,
    autoCloseBrackets: true,
  },
};

const memo = new Map<VirgilLatexSurface, LanguageSupport>();

/** The LaTeX language support for one surface — the only sanctioned caller of
 *  `latex(` in production code. Same surface → same value. */
export function virgilLatex(surface: VirgilLatexSurface): LanguageSupport {
  let support = memo.get(surface);
  if (!support) {
    support = latex(VIRGIL_LATEX_OPTIONS[surface]);
    memo.set(surface, support);
  }
  return support;
}
