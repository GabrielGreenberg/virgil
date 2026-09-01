/**
 * NATIVE SPELLCHECK — one policy, one switch, one write (task 517, the memo's
 * Tier A).
 *
 * Chrome spellchecks any editable text unless told not to, and Virgil said
 * "don't" in eleven places that had never been collected into a rule: two
 * CodeMirror source pods, the read-only branch of the main editor, and eight
 * discrete form inputs (citekey, label key, two hex-colour fields, the math and
 * figure LaTeX textareas, the bib picker, the raw-BibTeX textarea). Every one
 * of those decisions was right and none of them was STATED, so from outside the
 * pattern read as arbitrary — and there was no way to turn the thing off.
 *
 * ## The switch is ONE attribute on <body>, not a prop on every prose surface
 *
 * `spellcheck` is an INHERITED HTML attribute: an element with no `spellcheck`
 * of its own acts on its ancestors', and an explicit descendant value wins over
 * an inherited one. So the whole policy is one write on `<body>`:
 *
 *   - pref ON  → no attribute at all (the browser default — byte-identical to
 *     the behaviour that shipped before this switch existed);
 *   - pref OFF → `spellcheck="false"`, inherited by every contenteditable and
 *     every input in the app, portaled float popouts included.
 *
 * The alternative was a `checkSpelling` prop threaded into each surface's
 * ProseMirror `editorProps.attributes` — and there are TWELVE of those blocks
 * (the main editor, `RichTextField`, `BorrowedMainText`, nine float bodies,
 * `ExampleCard`), none of which sets `spellcheck` today. Twelve threads are
 * twelve chances for the thirteenth surface to be forgotten; the body attribute
 * covers every surface that exists and every surface that will, by
 * construction. It is the same mechanism — and the same reasoning — as
 * `EditorLayout`'s `.hide-card-titles` / `.card-outline-chrome` body classes.
 *
 * ## The deliberate opt-outs stay opted out
 *
 * They are DESCENDANT `false`s, so they win over an inherited `true` and are
 * unaffected by the pref in either position. They spell it through the two
 * constants below rather than a bare literal, which is what makes "the surfaces
 * deliberately left out" a checkable list instead of eleven scattered
 * literals — the census in `spellcheck-policy.test.ts` has an EMPTY allowlist.
 *
 * Two CodeMirror surfaces (the code view, the style/preamble editor) set
 * nothing and are nevertheless always off: CodeMirror 6 hardcodes
 * `spellcheck: "false"` in its own default content attributes. The two source
 * pods below restate it as defence-in-depth; that redundancy is deliberate and
 * predates this module.
 *
 * ## What this is NOT
 *
 * It governs the BROWSER's spellcheck. Virgil's own LaTeX-aware checker (task
 * 518) is what flips this pref OFF when it takes over, so there is one
 * underline rather than two — this module is the switch it will reach for.
 *
 * ## Cost class
 *
 * O(1), on the pref's change EDGE only. Nothing here runs per keystroke or per
 * render. (A browser re-checks lazily, so a surface already on screen may keep
 * its existing squiggles until it is next edited or refocused — a property of
 * the browser's checker, not of this write.)
 */

import { useEffect } from "react";

/**
 * The ProseMirror `editorProps.attributes` fragment for a surface that is
 * NEVER natively spellchecked, whatever the preference says. Spread it.
 */
export const NEVER_SPELLCHECK_ATTRS: { readonly spellcheck: "false" } = {
  spellcheck: "false",
};

/**
 * The React prop for an `<input>` / `<textarea>` that is NEVER natively
 * spellchecked, whatever the preference says. Spread it.
 */
export const NEVER_SPELLCHECK_PROPS: { readonly spellCheck: false } = {
  spellCheck: false,
};

/** The attribute this policy writes on `<body>`. */
export const SPELLCHECK_ATTR = "spellcheck";

/**
 * Reflect the preference onto `<body>`. ON removes the attribute rather than
 * writing `"true"`: the default state IS on, so the pref's default position
 * leaves the DOM exactly as it was before this switch existed.
 */
export function applyNativeSpellcheck(on: boolean): void {
  if (typeof document === "undefined") return;
  if (on) document.body.removeAttribute(SPELLCHECK_ATTR);
  else document.body.setAttribute(SPELLCHECK_ATTR, "false");
}

/**
 * Mount the policy. Called ONCE, from the app root that already reads the view
 * prefs (`EditorLayout`) — the census pins that it has exactly one caller, so a
 * second writer cannot come to disagree with the first about the attribute.
 */
export function useNativeSpellcheck(on: boolean): void {
  useEffect(() => {
    applyNativeSpellcheck(on);
    return () => applyNativeSpellcheck(true);
  }, [on]);
}
