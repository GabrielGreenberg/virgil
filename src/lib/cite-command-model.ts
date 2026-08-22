/**
 * The citation-command MODEL: what a `\cite…` command's parts are, where its
 * `[prenote][postnote]` annotations LIVE, and how the two directions
 * (bytes → model, model → bytes) are held to each other.
 *
 * ## Why this module exists (task 403)
 *
 * natbib and biblatex genuinely differ about the SCOPE of a citation's notes,
 * and before this module every consumer picked a home by convention:
 *
 *   - `parseNatbibCommand` put the notes at the TOP LEVEL and left `entries[]`
 *     note-less, because natbib's `[pre][post]` governs the whole citation;
 *   - `parseBiblatexCommand` put them on `entries[]` **and** mirrored
 *     `entries[0]`'s onto the top level;
 *   - `serializeCiteCommand` read `entries[]` only — so a natbib top-level
 *     note was silently DROPPED;
 *   - the panel's `rowsFromCommand` mirrored `entries[0]`'s note onto EVERY
 *     row under a comment that said "For natbib" over code that ran always —
 *     so a biblatex `\cites[p. 1]{a}{b}` showed "p. 1" on `b` and, on the next
 *     persist, WROTE `\cites[p. 1]{a}[p. 1]{b}` into the user's `.tex`: a page
 *     range invented on a citation that never had one;
 *   - the display formatter guessed a third way, from the command NAME plus
 *     the document's package.
 *
 * The tell for this bug class is always the same — a COMMENT asserting which
 * home is authoritative next to code that does not check. So the two homes are
 * made **unrepresentable**: `ParsedCiteCommand` is a discriminated union on
 * `noteScope`, the WHOLE arm's `entries[]` carries no note field at all, and
 * the PER-KEY arm has no top-level note. A reader can no longer pick the wrong
 * home, because on either arm it does not exist.
 *
 * ## The scope is a fact about the SYNTAX, not about the package
 *
 * A command whose bytes hold ONE bracket group before ONE brace group has
 * WHOLE-citation notes — natbib always (`\citep[p. 22]{a,b}`), and biblatex's
 * singular forms too (`\parencite[p. 22]{a,b}`). A command that repeats
 * `[…]{…}` has PER-KEY notes (`\cites[p. 1]{a}[p. 2]{b}`), which is the ONLY
 * thing biblatex's plural `\xxxs` forms buy.
 *
 * ## One placement rule, read by both renderers
 *
 * Everything downstream wants the same PER-KEY view: the display formatter
 * renders a note beside the key it governs, and the panel edits one note per
 * row. {@link resolveCiteNoteRows} is that projection, and it places a
 * whole-citation note where LaTeX itself renders it — prenote before the FIRST
 * key, postnote after the LAST — and nowhere else.
 *
 * This module is a LEAF (its only import is the command vocabulary), so the
 * layers that need the answer can reach it: `src/lib/bib-parser.ts` and the
 * Library silo's whole-file copy both consume it rather than re-deriving it.
 */

import { MULTI_CITE_NAMES } from "./cite-commands";

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/** One cited key, with the notes that govern IT (the per-key view). */
export interface ParsedCiteKey {
  key: string;
  prenote?: string;
  postnote?: string;
}

/** Where a command's `[prenote][postnote]` annotations live. */
export type CiteNoteScope = "whole" | "per-key";

interface CiteCommandShape {
  /** Normalized (lower-cased) command word: "cite", "citep", "parencites", … */
  type: string;
  starred: boolean;
  capitalized: boolean;
}

/** WHOLE-citation notes: ONE `[pre][post]` group governs every key. */
export interface WholeScopeNotes {
  noteScope: "whole";
  /** Note-less BY CONSTRUCTION — the notes live at the top level. */
  entries: ReadonlyArray<{ key: string }>;
  prenote?: string;
  postnote?: string;
}

/** PER-KEY notes: each key carries its own `[pre][post]`. */
export interface PerKeyScopeNotes {
  noteScope: "per-key";
  entries: ReadonlyArray<ParsedCiteKey>;
}

export interface WholeNoteCiteCommand extends CiteCommandShape, WholeScopeNotes {
  keys: string[];
}
export interface PerKeyNoteCiteCommand extends CiteCommandShape, PerKeyScopeNotes {
  keys: string[];
}

export type ParsedCiteCommand = WholeNoteCiteCommand | PerKeyNoteCiteCommand;

/**
 * What {@link serializeCiteCommand} needs: the command's shape plus a note
 * plan. `noteScope` is REQUIRED and undefaulted — a defaulted discriminant is
 * a decision nobody made, and picking one on the caller's behalf is exactly
 * the convention this module retires.
 */
export type CiteSerializeInput =
  | (CiteCommandShape & WholeScopeNotes)
  | (CiteCommandShape & PerKeyScopeNotes);

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

// Natbib commands: \cite, \citet, \citep, \citealt, \citealp, \citeauthor,
// \citeyear, \citeyearpar, \citetext, \citenum, plus capitalized variants.
// Longest names listed first to avoid partial-match shadowing.
const NATBIB_HEAD_RE = /^\\(citeyearpar|citeauthor|citeyear|citealp|citealt|citetext|citenum|citep|citet|cite|Citeyearpar|Citeauthor|Citeyear|Citealp|Citealt|Citetext|Citenum|Citep|Citet|Cite)(\*?)(?:\[([^\]]*)\])?(?:\[([^\]]*)\])?\{([^}]+)\}$/;

// Biblatex command head: matches the leading `\cmd*` (no arguments).
// Longer names listed first so e.g. `\footfullcite` is preferred over
// `\footcite`, and `\textcites` over `\textcite` over `\cite`.
const BIBLATEX_HEAD_RE = /^\\(footfullcite|footfullcites|fullcite|fullcites|textcites|parencites|autocites|footcites|smartcites|textcite|parencite|autocite|footcite|smartcite|citetitle|citedate|citeurl|citeauthor|citeyear|nocite|cites|cite|Footfullcite|Footfullcites|Fullcite|Fullcites|Textcites|Parencites|Autocites|Footcites|Smartcites|Textcite|Parencite|Autocite|Footcite|Smartcite|Citetitle|Citedate|Citeurl|Citeauthor|Citeyear|Nocite|Cites|Cite)(\*?)/;

/** Parse a citation command string (natbib or biblatex) into its components. */
export function parseCiteCommand(command: string): ParsedCiteCommand | null {
  // Try natbib first
  const natbib = parseNatbibCommand(command);
  if (natbib) return natbib;

  // Try biblatex
  return parseBiblatexCommand(command);
}

/** Parse a natbib command string. Natbib's `[pre][post]` is WHOLE-citation by
 *  definition — it renders once, at the edges of the group — so the parse can
 *  only ever produce the `"whole"` arm. */
export function parseNatbibCommand(command: string): WholeNoteCiteCommand | null {
  const m = command.match(NATBIB_HEAD_RE);
  if (!m) return null;

  let cmdName = m[1];
  const starred = m[2] === "*";
  const capitalized = cmdName[0] === "C";
  if (capitalized) cmdName = cmdName[0].toLowerCase() + cmdName.slice(1);

  let prenote: string | undefined;
  let postnote: string | undefined;
  if (m[4] !== undefined) {
    prenote = m[3];
    postnote = m[4];
  } else if (m[3] !== undefined) {
    postnote = m[3];
  }

  // Split on comma, trim, and drop empty fragments so that an empty body
  // (`\cite{ }`) yields `[]` rather than `[""]`, and stray commas
  // (`\citep{a,,b}`) collapse to the real keys. An empty `keys` array is the
  // signal a pristine, key-less citation relies on (see useCitations.addCitation).
  const keys = m[5]
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  return {
    type: cmdName,
    starred,
    capitalized,
    keys,
    noteScope: "whole",
    entries: keys.map((k) => ({ key: k })),
    prenote,
    postnote,
  };
}

/**
 * Parse a biblatex command string. Supports:
 *   - single-key:   \textcite[pre][post]{key}
 *   - multi-key in single braces: \parencite{a,b,c}  (ONE bracket group ⇒
 *     WHOLE scope, exactly like natbib — biblatex renders it once too)
 *   - multi-cite plural form with per-key brackets:
 *       \cites[pre1][post1]{key1}[pre2][post2]{key2}   (PER-KEY scope)
 *
 * The discriminant is the SYNTAX: more than one consumed `[…]{…}` group means
 * the author wrote a note per key, and nothing else does.
 */
export function parseBiblatexCommand(command: string): ParsedCiteCommand | null {
  const head = command.match(BIBLATEX_HEAD_RE);
  if (!head) return null;

  let cmdName = head[1];
  const starred = head[2] === "*";
  const capitalized = cmdName[0] >= "A" && cmdName[0] <= "Z";
  if (capitalized) cmdName = cmdName[0].toLowerCase() + cmdName.slice(1);

  const isMultiCite = MULTI_CITE_NAMES.has(cmdName);

  // Walk the rest of the string consuming `[pre][post]{key}` groups.
  let rest = command.slice(head[0].length);
  const entries: ParsedCiteKey[] = [];
  // Whether we consumed at least one `{...}` brace group. This distinguishes a
  // syntactically-complete but key-less command (`\cite{}` → empty keys, a
  // valid pristine citation) from an unparseable bare head (`\cite` → null).
  let matchedGroup = false;
  let groupCount = 0;
  let firstPre: string | undefined;
  let firstPost: string | undefined;
  const groupRe = /^(?:\[([^\]]*)\])?(?:\[([^\]]*)\])?\{([^}]*)\}/;
  while (rest.length > 0) {
    const m = rest.match(groupRe);
    if (!m) break;
    matchedGroup = true;
    let kPre: string | undefined;
    let kPost: string | undefined;
    if (m[2] !== undefined) { kPre = m[1]; kPost = m[2]; }
    else if (m[1] !== undefined) { kPost = m[1]; }
    if (groupCount === 0) { firstPre = kPre; firstPost = kPost; }
    groupCount++;

    const keyContent = m[3].trim();
    if (!isMultiCite && keyContent.includes(",")) {
      // Singular biblatex command with comma-separated keys: one bracket group
      // governs the whole brace group.
      for (const k of keyContent.split(",")) {
        const trimmed = k.trim();
        if (trimmed) entries.push({ key: trimmed, prenote: kPre, postnote: kPost });
      }
    } else if (keyContent.length > 0) {
      // Drop an empty key body (`\cite{}`) — it contributes no entry, leaving
      // `keys === []` so the pristine, key-less citation path fires correctly.
      entries.push({ key: keyContent, prenote: kPre, postnote: kPost });
    }
    rest = rest.slice(m[0].length);
  }

  // A bare head with no brace group at all is unparseable. But a command that
  // DID match a `{...}` group (even an empty one) is a valid, key-less citation.
  if (!matchedGroup) return null;
  if (rest.trim().length > 0) return null;

  const keys = entries.map((e) => e.key);
  const shape = { type: cmdName, starred, capitalized, keys };

  if (groupCount > 1) {
    return { ...shape, noteScope: "per-key", entries };
  }
  // ONE bracket group: the note governs the whole citation. Publishing it
  // per-key here is what made `\parencite[p. 1]{a,b}` re-serialize as
  // `\parencites[p. 1][]{a}[p. 1][]{b}` — the same invention as the headline
  // defect, one command shape over.
  return {
    ...shape,
    noteScope: "whole",
    entries: entries.map((e) => ({ key: e.key })),
    prenote: firstPre,
    postnote: firstPost,
  };
}

// ---------------------------------------------------------------------------
// The ONE placement rule
// ---------------------------------------------------------------------------

/**
 * Project a parsed command onto the PER-KEY view every renderer wants — the
 * display formatter (a note beside the key it governs) and the panel's
 * editable rows.
 *
 * A `"whole"` command's single `[pre][post]` group is placed where LaTeX puts
 * it: the prenote before the FIRST key, the postnote after the LAST, and
 * nowhere else. Mirroring it onto every key is what invented a page range on
 * key `b` of `\cites[p. 1]{a}{b}` (task 403).
 */
export function resolveCiteNoteRows(parsed: ParsedCiteCommand): ParsedCiteKey[] {
  if (parsed.noteScope === "per-key") {
    return parsed.entries.map((e) => ({
      key: e.key,
      prenote: e.prenote,
      postnote: e.postnote,
    }));
  }
  const last = parsed.entries.length - 1;
  return parsed.entries.map((e, i) => ({
    key: e.key,
    prenote: i === 0 ? parsed.prenote : undefined,
    postnote: i === last ? parsed.postnote : undefined,
  }));
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

// Biblatex commands that have a `\xxxs` plural form for multi-cite. Anything
// not in this set must use comma-separated keys in a single brace group.
const HAS_PLURAL_FORM = new Set<string>([
  "cite",
  "cites",
  "textcite",
  "textcites",
  "parencite",
  "parencites",
  "autocite",
  "autocites",
  "footcite",
  "footcites",
  "smartcite",
  "smartcites",
]);

function bracketsFor(pre: string | undefined, post: string | undefined): string {
  if (pre !== undefined && pre !== "") return `[${pre}][${post || ""}]`;
  if (post) return `[${post}]`;
  return "";
}

/** Reconstruct a LaTeX citation command from a shape plus a note plan. */
export function serializeCiteCommand(
  parsed: CiteSerializeInput,
  bibPackage: string = "natbib"
): string {
  const { type, starred, capitalized, entries } = parsed;
  if (entries.length === 0) return "";

  const cmdBase = capitalized ? type[0].toUpperCase() + type.slice(1) : type;
  const star = starred ? "*" : "";

  // ── WHOLE scope ─────────────────────────────────────────────────────
  // ONE bracket group before ONE brace group, in EITHER package — that is what
  // whole-citation notes ARE. Reading `entries[]` here (which carries no notes
  // on this arm, and now cannot) is what dropped a natbib `[p. 22]` on the
  // round trip.
  if (parsed.noteScope === "whole") {
    const keys = entries.map((e) => e.key).join(",");
    return `\\${cmdBase}${star}${bracketsFor(parsed.prenote, parsed.postnote)}{${keys}}`;
  }

  // ── PER-KEY scope ───────────────────────────────────────────────────
  const perKey = parsed.entries;

  if (bibPackage === "natbib") {
    // Natbib: \citep[pre][post]{key1,key2}. Prenote renders before the first
    // cite, postnote after the last — so pull each from where natbib will put
    // it. natbib CANNOT represent divergent per-key notes; the flatten is
    // lossy by the package's own definition, which is why the Package control
    // warns before it writes (see `citeNotesDroppedByPackage`).
    const pre = perKey[0]?.prenote;
    const post = perKey[perKey.length - 1]?.postnote;
    const brackets = bracketsFor(pre, post);
    const keys = perKey.map((e) => e.key).join(",");
    return `\\${cmdBase}${star}${brackets}{${keys}}`;
  }

  // ── Biblatex ────────────────────────────────────────────────────────
  // Single entry → singular form regardless of plural availability
  if (perKey.length === 1) {
    const { key, prenote: pre, postnote: post } = perKey[0];
    return `\\${cmdBase}${star}${bracketsFor(pre, post)}{${key}}`;
  }

  // Multiple entries: use plural `\xxxs` if available, otherwise fall back
  // to comma-separated keys (with shared pre/post from the first entry).
  const baseLower = cmdBase.toLowerCase();
  const hasPlural = HAS_PLURAL_FORM.has(baseLower);

  if (!hasPlural) {
    // Shared-pagination fallback (commands like \citeauthor / \nocite with no
    // plural form): prenote before the first cite, postnote after the last.
    const pre = perKey[0]?.prenote;
    const post = perKey[perKey.length - 1]?.postnote;
    const brackets = bracketsFor(pre, post);
    const keys = perKey.map((e) => e.key).join(",");
    return `\\${cmdBase}${star}${brackets}{${keys}}`;
  }

  const pluralType = type.endsWith("s") ? type : type + "s";
  const pluralBase = capitalized ? pluralType[0].toUpperCase() + pluralType.slice(1) : pluralType;
  const parts = perKey.map((e) => `${bracketsFor(e.prenote, e.postnote)}{${e.key}}`);
  return `\\${pluralBase}${star}${parts.join("")}`;
}

// ---------------------------------------------------------------------------
// Singular↔plural command derivation (T6-C16 — the CI-F5 family)
// ---------------------------------------------------------------------------

/** The biblatex commands whose singular form has a `\xxxs` plural sibling,
 *  mapping the *singular base* → its plural. Built from {@link HAS_PLURAL_FORM}
 *  (which holds BOTH forms) so the two can't drift. A command not in this map
 *  has no distinct plural form (e.g. `\citeauthor`, `\nocite`) — it serializes
 *  with comma-separated keys and is left untouched by the derivation. */
const SINGULAR_TO_PLURAL: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const cmd of HAS_PLURAL_FORM) {
    if (!cmd.endsWith("s")) m.set(cmd, `${cmd}s`);
  }
  return m;
})();

/** The reverse: plural form → its singular base. */
const PLURAL_TO_SINGULAR: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [singular, plural] of SINGULAR_TO_PLURAL) m.set(plural, singular);
  return m;
})();

/** The canonical singular base of a (possibly-plural) biblatex command type. */
export function singularBaseOf(type: string): string {
  return PLURAL_TO_SINGULAR.get(type) ?? type;
}

/** Whether a command base has a distinct `\xxxs` plural sibling. */
export function hasPluralForm(type: string): boolean {
  const base = singularBaseOf(type);
  return SINGULAR_TO_PLURAL.has(base);
}

/**
 * Derive the canonical command type for the CURRENT row set + package — the
 * TWO-WAY singular↔plural toggle (T6-C16, the CI-F5 family). Replaces the
 * one-way `shouldPromote ? type + "s" : type` that promoted singular→plural on
 * distinct postnotes but never demoted (so a card stranded as `\cites` with one
 * key — CI-F5-01/CI-F7-02 — or a package switch never re-derived — CI-F5-02).
 *
 * The plural `\xxxs` form exists for ONE reason: to carry per-key postnotes
 * through serialization (biblatex's `\cites[p1][q1]{a}[p2][q2]{b}`). So the rule
 * is a pure function of state:
 *   - PROMOTE to `\xxxs` ⟺ biblatex AND the base has a plural sibling AND there
 *     are ≥2 keys with distinct postnotes (the only case the plural form buys
 *     anything);
 *   - DEMOTE to the singular base otherwise (one key, or no distinct postnotes,
 *     or a non-biblatex package, or a base with no plural sibling — all cases
 *     where `\xxxs` is wrong or pointless).
 *
 * Idempotent and symmetric: feeding the result back in is a fixpoint, and the
 * same inputs always yield the same canonical type regardless of the prior
 * type's number. Callers pass the user-chosen command (which may already be
 * singular or plural); the singular base is recovered first so the decision is
 * order-independent.
 */
export function derivePlural(
  type: string,
  rows: ReadonlyArray<{ key: string; postnote?: string }>,
  bibPackage: string,
): string {
  const base = singularBaseOf(type);
  // No plural sibling (or natbib) → always the base; nothing to derive.
  if (bibPackage !== "biblatex" || !SINGULAR_TO_PLURAL.has(base)) return base;
  // Count only rows with a real key (empty draft rows don't serialize).
  const keyed = rows.filter((r) => r.key.trim());
  const distinctPostnotes =
    new Set(keyed.map((r) => r.postnote?.trim() || "")).size > 1;
  const shouldPromote = keyed.length >= 2 && distinctPostnotes;
  return shouldPromote ? (SINGULAR_TO_PLURAL.get(base) as string) : base;
}

// ---------------------------------------------------------------------------
// Is a package switch LOSSY? (the pre-write question, task 403 #3)
// ---------------------------------------------------------------------------

/**
 * The citekeys whose `[pre][post]` note this command would LOSE if the
 * document's package were switched to `nextPackage`.
 *
 * natbib's brackets are whole-citation BY DEFINITION, so
 * `\cites[p. 1]{a}[p. 99]{b}` cannot be represented under it — one of the two
 * ranges leaves the `.tex`. That is a real byte loss on a user action, so the
 * Package control asks this BEFORE it writes and names what would go (the
 * repo's standing posture: a loss the user has been told about and chosen
 * beats either a silent one or a blocked control).
 *
 * The answer is DERIVED by running the REAL serializer and reading the result
 * back through the REAL parser — never by restating the flatten rule, which is
 * exactly the second-copy-of-the-answer this module exists to retire.
 */
export function citeNotesDroppedByPackage(
  command: string,
  nextPackage: string,
): string[] {
  const parsed = parseCiteCommand(command);
  if (!parsed) return [];
  const before = resolveCiteNoteRows(parsed);
  if (!before.some((r) => (r.prenote || "").trim() || (r.postnote || "").trim())) {
    return [];
  }
  // Mirror the real gesture: the card re-derives its singular↔plural shape for
  // the new package and then serializes its rows.
  const nextType = derivePlural(parsed.type, before, nextPackage);
  const after = serializeCiteCommand(
    {
      type: nextType,
      starred: parsed.starred,
      capitalized: parsed.capitalized,
      noteScope: "per-key",
      entries: before,
    },
    nextPackage,
  );
  const reparsed = parseCiteCommand(after);
  const rows = reparsed ? resolveCiteNoteRows(reparsed) : [];
  const lost: string[] = [];
  before.forEach((b, i) => {
    const a = rows[i];
    const bPre = (b.prenote || "").trim();
    const bPost = (b.postnote || "").trim();
    const aPre = (a?.prenote || "").trim();
    const aPost = (a?.postnote || "").trim();
    if ((bPre && bPre !== aPre) || (bPost && bPost !== aPost)) lost.push(b.key);
  });
  return lost;
}
