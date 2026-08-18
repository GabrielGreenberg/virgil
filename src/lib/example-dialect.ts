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
 * The dialect an example carries when nothing says otherwise — every example
 * that existed before this attr did, every programmatically built node, and
 * every card-body / float / paste that has no document to ask.
 *
 * expex, because it is what Virgil has always emitted and what its
 * requirements pass auto-injects (`\usepackage{expex}` is declared by the
 * emit). linguex is NEVER auto-injected — it arrives only through the user's
 * own preamble — so defaulting the other way would be able to write a `.tex`
 * that does not compile.
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
 *    is always safe — the requirements pass injects `\usepackage{expex}` from
 *    the emit itself, where linguex is never injected at all.
 */
export function dominantExampleDialect(counts: {
  expex: number;
  linguex: number;
}): ExampleDialect {
  return counts.linguex > 0 && counts.expex === 0
    ? "linguex"
    : DEFAULT_EXAMPLE_DIALECT;
}
