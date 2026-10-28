/**
 * **THE example-DIALECT vocabulary** — which LaTeX package's syntax a given
 * `exampleBlock` was written in, and is therefore emitted back in.
 *
 * Linguistics papers number their examples with one of two packages, and the
 * two are not interchangeable syntax:
 *
 * ```
 * expex     \ex \label{s1} … \xe          (an explicit close)
 * linguex   \ex.\label{s1} …              (terminated by a blank line)
 * ```
 *
 * Virgil models BOTH onto the same node (`exampleBlock` + `exampleItem`), so
 * everything downstream of the parse — numbering, cards, the Examples panel,
 * drag/drop, the float bodies — is dialect-BLIND by construction and gets
 * linguex support with nothing to change. The dialect is carried as a node
 * ATTR for one reason and one only: **the serializer must write each example
 * back in the dialect its author wrote it in.**
 *
 * That is a data-safety property, not a nicety. Virgil's `.tex` is the user's
 * only copy and it is co-authored on Overleaf: silently converting a
 * collaborator's linguex examples to expex would rewrite every example in the
 * file on OPEN — a diff bomb against a document Virgil was merely asked to
 * read. The doctrine is the one task 342 states for environments (*what the
 * system does not model, it CARRIES*) read one level in: what Virgil DOES
 * model, it models faithfully enough to give back unchanged.
 *
 * Zero imports, deliberately (the `latex-markers.ts` placement rule): the
 * parser, the serializer, the TipTap schema and the action registry all read
 * this, and they sit in layers that cannot import each other.
 */

/** The dialect an `exampleBlock` is written in. */
export type ExampleDialect = "expex" | "linguex";

/**
 * **THE example-package FAMILY** — every LaTeX package that defines `\ex`, of
 * which a document may load EXACTLY ONE (task 543). The two dialects Virgil
 * MODELS and can therefore inject are members; so is `gb4e`, which Virgil
 * never models (its `\begin{exe} \ex … \end{exe}` is carried raw, task 342)
 * and never injects, but which OWNS `\ex` in a paper that loads it.
 *
 * The family exists because a package the requirements pass injects lands
 * AFTER the user's own `\usepackage` lines, and the later load of `\ex` wins:
 * injecting expex into a gb4e or linguex paper redefines `\ex` under every
 * example the author wrote and the paper stops compiling — a preamble the user
 * never asked for, breaking a document that compiled before Virgil opened it.
 * Measured on the pre-543 tree for BOTH: a gb4e paper's carried `\ex` tripped
 * the expex detector, and an expex example under a linguex-only preamble
 * declared expex, and each injected it. `ensurePreambleRequirements` reads
 * this list as ONE mutual-exclusion rule: a loaded member outranks the model's
 * need for any other member, which is then surfaced as a conflict rather than
 * injected — the bib family's own "warn, never rewrite" posture, one package
 * family over.
 *
 * `gb4e` is deliberately a LOADED-ONLY member: nothing emits gb4e syntax, so
 * there is no inject line for it, and a paper that writes gb4e is a paper
 * Virgil carries rather than models. Pinned in
 * package-requirement-coverage.test.ts — every DIALECT has an inject line,
 * and the family is the exact set the exclusion rule reads.
 */
export const EXAMPLE_PACKAGE_FAMILY: readonly string[] = [
  "expex",
  "linguex",
  "gb4e",
];

/**
 * The members of `EXAMPLE_PACKAGE_FAMILY` whose syntax a BARE `\ex` (no
 * period) and a `\begin{xlist}` belong to (task 1206). Those two tokens are
 * SHARED vocabulary — expex's `\ex … \xe` and gb4e's
 * `\begin{exe} \ex … \end{exe}` both open with `\ex`, and gb4e defines
 * `xlist` itself (Virgil's `xlistenv` shim defines it over expex) — so a body
 * that holds only them needs SOME member that speaks them, not expex in
 * particular. linguex is deliberately absent: its `\ex.` is a period-
 * delimited macro, so a bare `\ex` under linguex is still an error and is
 * still surfaced as the conflict it is.
 *
 * Read by the `bare-ex` requirement (latex-requirements.ts): a loaded member
 * in this list satisfies it outright; with none loaded it resolves to expex
 * (`DEFAULT_EXAMPLE_DIALECT`). Before 1206 the fallback detector filed these
 * tokens as an expex PIN, and every gb4e paper got a notice claiming its
 * examples were "written for the expex package".
 */
export const BARE_EX_SPEAKERS: readonly string[] = ["expex", "gb4e"];

/**
 * The dialect an example carries when nothing says otherwise — every example
 * that existed before this attr did, every programmatically built node, and
 * every card-body / float / paste that has no document to ask.
 *
 * expex, because it is what Virgil has always emitted and what its baseline
 * preamble ships (`VIRGIL_BASELINE_PACKAGES`), so a Virgil-authored document
 * always compiles it. Both dialects are auto-injected since task 543 — each
 * emit declares its own package — but ONLY into a preamble that loads no other
 * member of `EXAMPLE_PACKAGE_FAMILY`, so the default still has to be the one
 * Virgil's own preamble carries.
 */
export const DEFAULT_EXAMPLE_DIALECT: ExampleDialect = "expex";

/** Narrow an arbitrary stored/parsed value to an `ExampleDialect`, or `null`
 *  when it is neither. A node attr is `unknown` at every read site (JSON from
 *  a `.tex` parse, a sidecar, a paste from another build). */
export function asExampleDialect(value: unknown): ExampleDialect | null {
  return value === "expex" || value === "linguex" ? value : null;
}

/** The dialect to READ off a node's attrs — the narrow, with the default. */
export function exampleDialectOf(attrs: unknown): ExampleDialect {
  const raw =
    attrs && typeof attrs === "object"
      ? (attrs as Record<string, unknown>).dialect
      : undefined;
  return asExampleDialect(raw) ?? DEFAULT_EXAMPLE_DIALECT;
}

/**
 * The dialect a NEW example minted in the editor takes, given how many of each
 * the document already holds. Stated ONCE, here, because there is exactly one
 * canonical example creator (`buildExampleNode`) and this is the only decision
 * it makes that the user did not.
 *
 * **A document that is PURELY linguex mints linguex; everything else mints
 * expex.** Two properties make that the right shape rather than the obvious
 * one:
 *
 *  - It is DERIVED from what the document actually contains, and a linguex
 *    example only exists in the tree because the parse found the package
 *    loaded — so this reads the package signal downstream of the one place
 *    that is entitled to ask it (the parse), rather than re-deriving a
 *    preamble question in a layer that has no preamble.
 *  - Its fallback direction is the SAFE one. The task text's gloss for this
 *    rule was "linguex iff the package is loaded and expex is not", and that
 *    is materially different for the documents this feature exists for:
 *    Gabriel's own paper loads BOTH packages and writes every example in
 *    linguex, so the package rule would start minting expex examples into a
 *    linguex file. The dominant-dialect rule matches what the author writes.
 *    A MIXED document is the genuinely ambiguous case and takes expex, which
 *    is the SAFER answer rather than a free one: a mixed document's preamble
 *    already has to load whatever its existing examples need, and where it
 *    loads only linguex the requirements pass will NOT inject expex over it
 *    (`EXAMPLE_PACKAGE_FAMILY` — exactly one member may be loaded) but will
 *    surface the conflict, which is the honest outcome for an example the
 *    author minted in a syntax their preamble cannot compile.
 */
export function dominantExampleDialect(counts: {
  expex: number;
  linguex: number;
}): ExampleDialect {
  return counts.linguex > 0 && counts.expex === 0
    ? "linguex"
    : DEFAULT_EXAMPLE_DIALECT;
}

/**
 * **How to WRITE an example, per dialect** — the text the Example card's "?"
 * help shows (task 1341). A per-dialect FACT, so it lives with the dialect
 * vocabulary rather than as hand-written JSX in the card: before 1341 the
 * card carried one fixed expex explainer, so a linguex example taught
 * `\ex … \xe` / `\pex` / `\begingl` — syntax a linguex paper does not
 * define, and whose package the requirements pass refuses to inject there
 * (`EXAMPLE_PACKAGE_FAMILY`). Typed as a `Record` over `ExampleDialect`, so a
 * third dialect cannot be added without its help; plain data (code / prose
 * segments) so this leaf stays import-free and the card renders it.
 *
 * Every line states only what the PARSER MODELS for that dialect — the help
 * must never advertise a construct Virgil carries raw. linguex `\gll`
 * glosses and nested `\a.` tiers are carried, not modelled (latex-parser.ts
 * `readLinguexExample` / `splitLinguexBody`), so they are not taught.
 */
/** One run of help text: LaTeX source (rendered mono) or plain prose. */
export type HelpSegment = { code: string } | { text: string };

export interface ExampleDialectHelp {
  /** The lead sentence above the list. */
  intro: HelpSegment[];
  /** One bullet per construct. */
  lines: HelpSegment[][];
}

export const EXAMPLE_DIALECT_HELP: Record<ExampleDialect, ExampleDialectHelp> = {
  expex: {
    intro: [{ code: "expex" }, { text: " renders numbered linguistic examples." }],
    lines: [
      [{ code: "\\ex … \\xe" }, { text: " — a single numbered example." }],
      [
        { code: "\\pex … \\xe" },
        { text: " — a multi-part example; use " },
        { code: "\\a" },
        { text: " to introduce each sub-item (auto-labeled " },
        { code: "a, b, c…" },
        { text: ")." },
      ],
      [
        { code: "\\label{name}" },
        { text: " on either the top block or a " },
        { code: "\\a" },
        { text: " item makes it referenceable with " },
        { code: "\\ref{name}" },
        { text: "." },
      ],
      [
        { code: "<tag>" },
        { text: " right after " },
        { code: "\\ex" },
        { text: " / " },
        { code: "\\a" },
        { text: " sets a custom display tag (e.g. " },
        { code: "\\ex<*>" },
        { text: " for an ungrammatical example)." },
      ],
      [
        { code: "\\begingl … \\endgl" },
        { text: " with " },
        { code: "\\gla / \\glb / \\glc" },
        { text: " rows and a " },
        { code: "\\glft" },
        { text: " free-translation row produces an interlinear gloss." },
      ],
    ],
  },
  linguex: {
    intro: [
      { code: "linguex" },
      { text: " renders numbered linguistic examples; this paper writes them in its syntax." },
    ],
    lines: [
      [
        { code: "\\ex." },
        { text: " — a single numbered example, ended by a blank line (no closing command)." },
      ],
      [
        { code: "\\ex." },
        { text: " followed by " },
        { code: "\\a." },
        { text: ", " },
        { code: "\\b." },
        { text: ", " },
        { code: "\\c." },
        { text: " … — a multi-part example, one marker per sub-item." },
      ],
      [
        { code: "\\label{name}" },
        { text: " right after " },
        { code: "\\ex." },
        { text: " or a sub-item marker makes it referenceable with " },
        { code: "\\ref{name}" },
        { text: "." },
      ],
      [
        { text: "A blank line inside an example ends it — keep each example one paragraph." },
      ],
    ],
  },
};
