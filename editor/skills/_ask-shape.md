<!-- Canonical "answer the ask, not the panel" doctrine for every editor
     responder skill that resolves a free-text AI request.

     SSOT: this file is the single source of truth for the ask-shape rule.
     It is referenced by link (like `_latex-allowlist.md`), not inlined —
     a responder reaches it at a decision point it takes deliberately, so
     the bundle shipping the file is enough for
     `[_ask-shape.md](_ask-shape.md)` to resolve. Do not paraphrase this
     doctrine back into a skill; link to it. A drift guard
     (`editor/skills/__tests__/ask-shape-doctrine.test.ts`) holds every
     skill in REFERENCING_SKILLS to carrying its pointer — a responder
     that drops the link, or a new prose-panel responder added without
     one, fails CI.

     Not a slash command — the leading underscore filters it out of the
     command mirror in both build scripts. -->

## Ask-shape doctrine (load-bearing)

Which panel a request arrived from tells you **where the user's cursor
was**, not what they asked for. The routing table
(`editor/scripts/ai_request_routing.json`) is a frozen projection of
`CARD_REGISTRY` — it maps card kind → request kind → responder, and it is
structurally incapable of reading the request text. It must not be
hand-edited, and it could not carry this signal even if it were.

So **the ask-shape question is the responder's to answer**, and it is
answered *before* composing, not discovered while writing. Stated here
once and referenced, so it cannot drift skill to skill.

**1. The panel names the DEFAULT output shape; the request text names the
REQUIRED one.** They agree most of the time — a comment in the revisions
panel usually does want a revision. When they clearly disagree, the text
wins. A free-text comment box accepts any ask, so every prose panel is
heterogeneous; `todo` is not special in this respect, it was just the
first responder to notice.

**2. Ask what the ANSWER is, not what the question is about.** The ask's
grammar is the tell, not its subject matter:

| The request… | Its honest answer is | Shape |
|---|---|---|
| commands a change to the prose — "tighten this", "rewrite", "cut this" | replacement text | **suggestion** (the revisions/cutter default) |
| asks a question about the world — "can you check this quote", "is this right", "did X really say this", "what's in the source" | findings: what you looked up, what it said, where it diverges | **report** |
| asks for explanation or connection — "why does this matter", "how does this relate to X" | commentary beside the text | **note** |
| asks where something came from — "what's the source for this claim" | a located work | **citation** / **footnote** |
| asks for something you cannot do — "check with my coauthor", "look at the dataset" | a stated limit | complete with a note; don't pretend |

**3. The tell that you got it wrong: findings compressed into a rationale
field.** If you are proposing a rewrite mainly so that what you found has
somewhere to live — squeezing a verification result into a suggestion's
`explanation`, or a set of page cites into a card's one-line summary —
stop. That is this mistake, and it costs the user twice: the findings
arrive truncated and mis-filed, *and* they are handed a proposed edit
they never asked for and must now dismiss.

**4. Re-route rather than compress — and never emit both.** A re-routed
answer replaces the panel's default output; it does not accompany it.
Emitting a suggestion *and* a report "to be safe" is the compression
failure with an extra card attached.

**The mechanism is a function of what the target kind's builder NEEDS —
not of whether one exists.** That is the axis, and getting it wrong
documents a call that dies. Three tiers:

- **Tier 1 — a SELF-SUFFICIENT builder** (`note`, `report`, `todo`,
  `footnote`, `report-request`): everything it needs is something you are
  holding. Declare the Task kind you are draining and let the contract do
  the write:
  ```bash
  python3 editor/scripts/create_card.py <docPath> <requestId> \
      --kind=report --accept-task-kind suggestion \
      --author ai --title "<short title>" --body "<findings>"
  ```
  `--accept-task-kind` is general (a set union over the default 1:1
  `WORKFLOW_A_KINDS`), so any Task kind may be drained by any carded
  answer. It is the same door `answer-todo-request` uses to answer a
  `todo` Task with a `note`.
- **Tier 2 — a builder with a PREREQUISITE YOU DO NOT HOLD** (`citation`):
  `create_card.py --kind=citation` requires `--citekey`, and hard-refuses
  a key that is not already in `references.bib`
  (`_require_bib_keys` — *"don't fabricate a cite for a missing entry"*).
  Sourcing the work and adding the entry is a different job, so hand off
  to [`/editor/find-citation`](find-citation.md), which searches
  Crossref / OpenAlex / Semantic Scholar / arXiv, writes the `.bib` entry
  and the citation card in one atomic op. **Do not call
  `--kind=citation` to answer "find me a source for this"** — you have no
  citekey, and the call dies.
- **Tier 3 — NO builder** (`suggestion`): hand off to
  [`/editor/draft-suggestion`](draft-suggestion.md), which owns the L3
  propose path (`apply_response.py complete-task --propose`).

Tiers 2 and 3 differ in their reason and agree in their shape: a handoff.
State the reason, not just the destination — a future kind that gains a
prerequisite-gated builder belongs in tier 2, and one that gains a
self-sufficient one moves to tier 1.

**A follow-up you cannot file NOW is a `todo` CARD, never a hand-written
Task row.** There is no door that appends a *pending* `ai-requests.json`
request: `apply_response.py`'s subcommand set has none, and
`--synthesize-task` stamps the running write's own `status`, so it can
only synthesize the Task a write is *draining*. So when work remains that
you cannot do in this run — a bibkey you could not resolve, a source that
needs finding — file it as a **todo card** through Workflow B (no
`requestId`; `--anchor` supplies the paragraph, the contract synthesizes
and completes its own Task):
```bash
python3 editor/scripts/create_card.py <docPath> --kind=todo \
    --anchor <paragraph-uuid> --body "<what still needs doing, and why>"
```
It lands atomically under the pen, it is VISIBLE to the user in the Todos
panel rather than buried in a sidecar they never open, and flagging it
for AI later mints a real bridged `todo` Task that `/editor/review`
dispatches — which is how the loop closes. **Never edit
`ai-requests.json` with a file-editing tool.** That sidecar has one
authority (`apply_response.py`, atomic + version-bumped + under the pen);
a raw write is unserialized against both the app and every other skill,
and it is precisely the failure the contract exists to prevent.

Say what you did in the `Done:` line — name the kind you emitted **and**
the kind the panel implied, so the redirect is visible rather than
silent.

**5. When the ask is genuinely ambiguous, the panel wins.** This rule
fires on a *clear* mismatch, not on a close call. A comment that both
asks a question and wants the prose changed is a suggestion with the
answer in its explanation — that is the case the default handles well.
Re-routing on a coin-flip is worse than not re-routing: it makes the
panel's own affordance unreliable.

**6. If you cannot re-route, surface the mismatch — never fabricate the
request.** Where no handoff is available, answer as best the shape allows
and say plainly, in the reply, that the ask wanted a different shape.
This is [`_find-or-surface.md`](_find-or-surface.md)'s rule on the other
axis: that doctrine forbids inventing **content** you could not find;
this one forbids inventing a **request** the user did not make. A rewrite
proposed only to carry findings is a fabricated ask, and like a
fabricated citation it looks correct, survives every structural
validator, and is caught only by the human who reads it.
