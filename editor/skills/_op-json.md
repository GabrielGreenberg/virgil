<!-- Canonical "how an op-json reaches the contract" doctrine for every editor
     skill that calls `apply_response.py` with a positional op argument.

     SSOT: this file is the single source of truth for the inline-vs-`@`-file
     rule. It is referenced by link (like `_ask-shape.md` /
     `_latex-allowlist.md`), not inlined — a skill reaches it at a decision
     point it takes deliberately, so the bundle shipping the file is enough
     for `[_op-json.md](_op-json.md)` to resolve. Do not paraphrase this
     doctrine back into a skill; link to it, then show YOUR op's own shell
     block (the block is a per-site instantiation — each op's JSON differs —
     while the RULE and the WHY live here once).

     A drift guard (`editor/skills/__tests__/op-scratch-file.test.ts`) holds
     it: the population of free-text sites is DISCOVERED by classifying every
     `apply_response.py` op invocation in the silo, so a new skill is covered
     by shipping. Allowlist EMPTY.

     Not a slash command — the leading underscore filters it out of the
     command mirror in both build scripts. -->

## Op-json delivery doctrine (load-bearing)

`apply_response.py` takes its op as a positional argument, and that argument
reaches it through **two hops of quoting at once**: the shell's, and JSON's.
The rule is keyed on **what the op CARRIES**, not on which skill carries it:

> **An op-json carrying FREE TEXT goes through an `@` scratch file. An op-json
> carrying only IDS stays inline.**

**Free text** = anything you or the user composed, or any span lifted verbatim
from the paper:

| key | what it holds |
|---|---|
| `body` | a card body you composed |
| `card` | a whole card object — it always carries prose inside |
| `content` / `text` | a card's body / its plain-text mirror |
| `original_text` | a span lifted **verbatim from the user's `.tex`** |
| `suggested_text` / `user_text` | the proposed replacement prose |
| `explanation` / `instructions` | your rationale / the user's request text |
| `summary` | the Task summary — routinely quotes the user's own first 60 chars |
| `note` | a free-text completion note inside the op |
| `entry` | a BibTeX block (`bibEdit`) |
| `fields` | BibTeX field values (`bibEdit` set-fields) |
| `replacement` | a `.tex` region blob (`texEdit`) |
| `text` under `annotationEdit` | an annotation you drafted |

**Ids** = `cardId`, `cardAId` / `cardBId`, `newAnchor`, `requestId`,
`bibReviewType`, `kind`, `panel`, `clearSourceFlag`.

An op-json written as a `'<op-json>'` **placeholder** is free text by
construction: a payload you compose rather than spell out is one whose bytes
nobody has seen yet.

### Why free text may not be an inline single-quoted argument

Two failure modes, and the second is the one that costs:

1. **Loud.** A stray apostrophe terminates the shell's single quote (every
   English possessive and contraction is one), or a raw `\emph{x}` is not
   JSON-escaped to `\\emph{x}`. The command errors and you retry — wasted
   turns, no damage.
2. **Silent.** The JSON parses but the escaping was wrong by one level, so a
   mangled body lands in the user's paper **through the pen, atomically, with
   `ok: true`.** A `\\emph` that should have been `\emph` (or the reverse)
   reaches `notes.json` / `footnotes.json` and, for a footnote, the `.tex`
   `\footnote{}` itself. Nothing reports it.

A verbatim LaTeX span — `original_text`, a BibTeX `entry`, a merged preamble —
is the worst possible input for a hand-built single-quoted shell argument that
must simultaneously be valid JSON: it routinely contains `\`, `{`, `}`, `'`
and newlines. A heredoc has none of those hazards: `<<'JSON'` is literal, so
you write the JSON and nothing else re-interprets it.

### The canonical block

```bash
op=$(mktemp -t virgil-op)
cat > "$op" <<'JSON'
{ …the op… }
JSON
python3 editor/scripts/apply_response.py <docPath> <subcommand> "@$op"; rc=$?
rm -f "$op"
exit "$rc"
```

Five things about it are load-bearing:

- **The heredoc TERMINATOR sits at column 0 when you run it.** Every block in
  these skills is shown indented, because its fence is nested inside a numbered
  step — but `<<'JSON'` ends only at a line that is exactly `JSON` with no
  leading whitespace. De-indent the block before running it, or the heredoc
  swallows the rest of your command and bash reports
  `here-document delimited by end-of-file`.

- **`mktemp`, never a fixed name.** Two concurrent runs on one paper would
  otherwise write the same path, and the loser's op is silently replaced
  between its `cat` and its `apply_response.py`.
- **`$TMPDIR`, never `<docPath>`.** The op file is **scratch** — it must
  **not** land in `<docPath>`, which is the user's (often sync-backed) paper
  folder where every write is sync traffic (tasks 363/415).
  `apply_response.py`'s `@` reader does
  `Path(arg[1:]).expanduser().resolve()`, so it **resolves any absolute path**
  — the scratch file has no relationship to the doc; only the op's CONTENT
  does.
- **`rm` on BOTH paths.** Capture `rc=$?` *before* the `rm` and re-raise it
  after, so a failing call still cleans up and still fails.
- **The heredoc is quoted** (`<<'JSON'`). Unquoted, the shell expands `$` and
  backticks inside your LaTeX.

### Why the id-only ops stay inline

`archive` / `restore` / `move` / `link` / `accept` / `reject`, and a bare
bib-review `complete-only`, carry `{"cardId":"…"}`-shaped payloads: no free
text, nothing to escape. Their one-line form is **correct as it stands** — do
not "fix" it. Blanket-mandating the file form would turn a payload with
nothing to escape into a five-line ceremony, and dead ceremony teaches you to
skip the rule where it actually matters.

If you are unsure which side a payload falls on, use the file. The cost of a
needless scratch file is four lines; the cost of a mis-escaped one is the
user's prose.
