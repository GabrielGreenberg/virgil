// Shipped defaults the app has moved on from — read by every door a stored
// preference comes through.
//
// `usePreferences` persists the WHOLE preference object on any edit, so a saved
// blob holds a value for every key whether or not the user ever touched it.
// Merged over the defaults, those untouched values win, and a change to a
// shipped default never reaches an existing user. The dev mirror then feeds the
// same blob to the promoter, which folds it back over the new defaults, so a
// default changed in source is reverted by the next unattended promote.
//
// The two problems are one fact: a stored value equal to a default we have
// RETIRED was never a choice. This table names those values, and `dropRetired`
// removes them, so the current default shows through. Anything else in the blob
// stays, including a value that happens to be close: a colour the user picked
// by hand is theirs.
//
// Read by the RUNTIME (`usePreferences.loadPrefs`) and the PROMOTER
// (`tools/promote-defaults.mjs`), which cannot import each other's world, so
// this is an IMPORT-FREE LEAF like `pref-css-table.mjs`.
//
// Adding a row: when a commit changes a colour default, list the OLD value here
// in that commit. A key's list only grows. The current default may not appear
// in its own row; `retired-pref-defaults.test.ts` fails if it does.

/** @type {Readonly<Record<string, readonly string[]>>} */
export const RETIRED_PREF_DEFAULTS = Object.freeze({
  // The Sand ground: bar, tabs and Library stand on the one canvas colour, and
  // the cool hairlines and the sub-AA greys go warm.
  topbarBackground: ["#c5dbe2"],
  topbarBackgroundBottom: ["#c4c4c4"],
  topbarBorder: ["#cbc3b8", "#dcd3cb"],
  tabBg: ["#c5dbe2"],
  libraryBg: ["#ddeaee"],
  virgilBarText: ["#78716c"],
  headerBg: ["#c6cbcd"],
  borderLight: ["#c6cbcd"],
  mutedColor: ["#8a8580"],
  panelHeaderTextColor: ["#8a8580"],
  // Block labels leave the blue chip for quiet margin text, and % comments go
  // warm so they read as editor notes rather than a foreign colour.
  headingAnnotationColor: ["#6b9ac4"],
  headingAnnotationBorder: ["#a8c4de"],
  latexCommentColor: ["#7191b0"],
  // Tool windows lose their header band: the toolbar pod reads as the panel.
  podToolbar: ["#f5f3ef"],
});

/**
 * Remove every value that equals a retired default for its key.
 *
 * @param {Record<string, unknown>} stored
 * @returns {{ next: Record<string, unknown>, dropped: string[] }} `next` is
 *   `stored` itself when nothing was retired, so a caller can compare by
 *   identity; `dropped` lists the removed keys.
 */
export function dropRetiredDefaults(stored) {
  /** @type {string[]} */
  const dropped = [];
  for (const [key, retired] of Object.entries(RETIRED_PREF_DEFAULTS)) {
    const value = stored[key];
    if (typeof value === "string" && retired.includes(value.toLowerCase())) dropped.push(key);
  }
  if (dropped.length === 0) return { next: stored, dropped };
  const next = { ...stored };
  for (const key of dropped) delete next[key];
  return { next, dropped };
}
