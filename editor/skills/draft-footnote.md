---
description: |
  Add a footnote to a paragraph in a Virgil document. Triggers on:
  "Virgil, add a footnote here", "draft me a footnote on X", "footnote
  this claim", "write a footnote about Y", or when there's a pending
  `kind: footnote` request in the paper's AI-request inbox. Writes the
  footnote into footnotes.json and inserts the LaTeX command at the
  anchor paragraph. Does NOT trigger for adding a citation (use
  find-citation) or a margin note (use answer-note-request). Args:
  <docPath> <requestId>.
---

# /editor/draft-footnote $ARGUMENTS

Resolve one AI request whose kind is `footnote`. Footnote requests are
**direct creates** — they produce both a `FootnoteRef` in
`footnotes.json` and an inline `\vfid{<uuid>}\footnote{...}` command in
`document.tex` at the anchor.

## Args

- `<docPath>` — path to the doc folder.
- `<requestId>` — the request id from `list_requests.py`.

## Procedure

0. **Validate.** Before doing anything, check the request:
   - `kind == "footnote"` (otherwise refuse — this skill only handles footnotes).
   - `status == "submitted"` (otherwise no-op; don't reprocess `complete`).
   - `paragraphIds` is non-empty.

   If `paragraphIds` is empty, halt: leave the request `submitted`,
   don't edit `.tex`, append a `kind: "ai-request-failed"` notification
   (the schema's only "needs attention" kind — `DocNotification.kind`
   in `src/lib/types.ts:213` — used here to surface a clarify-needed
   state), bump `version.txt` so the frontend picks it up, and reply
   with the halt template (step 6). `selectedText` does not substitute
   for `paragraphIds` — the paragraph anchor is still required.

   Concrete shape for the notification:
   ```json
   { "kind": "ai-request-failed",
     "at": "<ISO now>",
     "summary": "Halted: footnote request needs paragraph anchor",
     "requestId": "<requestId>"
   }
   ```
   Append via `editor/scripts/_common.py`'s `append_notification`
   helper (or write directly — the schema is `{ "items": [...] }`).
   Bump version with `bump_version` from the same helper, or write
   `version.txt` manually as `<previous + 1>`.

1. **Load.** Read the request from `<docPath>/virgil/ai-requests.json`.
   Fetch paragraph context:
   ```bash
   python3 editor/scripts/get_para_context.py <docPath> <uuid> --neighbors=1
   ```
   Pull adjacent cards (other notes / footnotes / citations on the same
   paragraph) so you don't duplicate existing apparatus:
   ```bash
   python3 editor/scripts/cards_for_paragraph.py <docPath> <uuid>
   ```
   If the request mentions a citation (e.g. "with a citation to
   X"), resolve the bibkey:
   ```bash
   python3 editor/scripts/bib_resolve.py <docPath> <bibKey>
   ```
   When the bibkey isn't yet in `references.bib`:
   1. **Don't fabricate a `\citet{key}`** in the footnote body. Draft
      the footnote prose without the citation — cite the claim
      generically or omit the source reference.
   2. After step 5 finishes (footnote landed, original request
      closed), file a follow-up by appending an entry directly to
      `<docPath>/virgil/ai-requests.json` (no helper script exists for
      this — edit the file):
      ```json
      { "id": "<new-uuid>",
        "kind": "citation",
        "text": "Find/add a bib entry for <author/year>; once it's in references.bib, splice \\citet{<bibkey>} into footnote <footnoteId> on paragraph <uuid>.",
        "createdAt": "<ISO now>",
        "status": "submitted",
        "paragraphIds": ["<paragraph uuid>"],
        "linkedTo": { "panel": "footnotes", "cardId": "<footnoteId>" }
      }
      ```
      The `linkedTo` carries the structured trail back to the footnote
      so the citation responder can splice the `\citet` deterministically.
   3. The original footnote request still closes `complete` — the
      footnote artifact landed; the citation hole is tracked separately.
      Mention the follow-up in your reply (see step 6).

2. **Compose.** Draft the footnote body as plain LaTeX text — keep it
   under ~80 words. Word count is rendered prose: contents of `\emph{}`,
   `\textbf{}`, `\underline{}`, and other rendering wrappers count;
   command tokens themselves (`\citet`, `\vcid`, `\emph`, etc.) and
   bibkey arguments don't. Match the doc's apparatus tone (read
   other footnotes in `footnotes.json` to gauge). Cite via `\citet{...}`
   / `\citep{...}` for natbib docs, `\textcite{...}` /
   `\parencite{...}` for biblatex (detect by reading `references.bib` +
   the doc's bib package usage). Use LaTeX double-quote ligatures
   ` `` ... '' ` for inline quotation, matching surrounding apparatus.

   Prepend a fresh `\vcid{<uuid>}` marker before each `\citet` /
   `\citep` / `\textcite` / `\parencite` in the body — e.g.
   `\vcid{a1b2…}\citet{grafton1997}`. These are stable-id markers the
   serializer round-trips; the editor regenerates missing ones on
   parse, but emitting them is the canonical form and matches existing
   apparatus in the .tex.

3. **Build the FootnoteRef** (see `src/lib/types.ts:234`). Required
   fields: `id`, `content`, `createdAt`. Don't set `aiRequest`,
   `tags`, `pinned`, or other optional fields — leave them undefined.
   Tiptap JSONContent shape:
   ```json
   { "id": "<footnote-uuid>",
     "content": { "type": "doc",
                  "content": [{ "type": "paragraph",
                                "content": [{ "type": "text",
                                              "text": "<the body>" }] }] },
     "createdAt": "<ISO now>"
   }
   ```

4. **Determine the splice.** Use the `lineRange` returned by
   `get_para_context.py` in step 1 to locate the anchor paragraph; the
   `%!v:<uuid>` marker is always at end-of-line on the last line of
   that range. For a multi-line range the splice always happens on the
   last line (the one carrying the marker).

   **End-of-paragraph (default).** Splice the anchor immediately after
   the paragraph's terminal punctuation, with no leading space, leaving
   the existing ` %!v:<uuid>` untouched. Replace
   `<terminal-punct> %!v:<uuid>` with
   `<terminal-punct>\vfid{<footnote-id>}\footnote{<body>} %!v:<uuid>`.

   Before:
   ```
   …final sentence of the paragraph. %!v:ac7b
   ```
   After:
   ```
   …final sentence of the paragraph.\vfid{<footnote-uuid>}\footnote{<body>} %!v:ac7b
   ```

   This matches the house style of existing footnotes in the doc
   (anchor adjacent to a token, no floating whitespace before it).

   **Mode B (selected substring).** If the request's `selectedText` is
   set, splice the anchor immediately after the last character of the
   matched substring. Match `selectedText` against the paragraph body
   verbatim — same case, same internal whitespace, ignoring only the
   trailing ` %!v:<uuid>` marker line. Replace `<selectedText>` with
   `<selectedText>\vfid{<footnote-id>}\footnote{<body>}`; absorb no
   surrounding whitespace or punctuation. If `selectedText` matches
   multiple times in the paragraph, anchor at the first occurrence.
   If it doesn't match verbatim, fall back to end-of-paragraph
   insertion and note the discrepancy in your reply.

5. **Apply — order matters.** Do the .tex edit FIRST, then
   `apply_response.py`. This keeps the version bump (which the editor
   watches as the change marker) trailing a consistent on-disk state.

   **5a.** Edit `document.tex` using the Edit tool, applying the
   splice computed in step 4.

   **5b.** Run apply_response.py for the sidecar writeback, status
   flip, version bump, and notification append:
   ```bash
   python3 editor/scripts/apply_response.py <docPath> '<op-json>'
   ```
   Worked example of `<op-json>`:
   ```json
   {
     "requestId": "29294b7e-3bc2-478d-9b66-4849cc47b691",
     "panel": "footnotes",
     "card": {
       "id": "564fa9bf-c7d1-4876-9b96-115e2339b76d",
       "content": {
         "type": "doc",
         "content": [{
           "type": "paragraph",
           "content": [{
             "type": "text",
             "text": "The phrase belongs to \\vcid{97b70b85-3eaf-491c-89ab-a82328e7c730}\\citet{grafton1997}, whose monograph remains the standard treatment."
           }]
         }]
       },
       "createdAt": "2026-05-09T10:00:00.000Z"
     },
     "summary": "Drafted footnote: The phrase belongs to Grafton (1997)",
     "clearSourceFlag": false
   }
   ```
   For long op-json blobs, write to a temp file and pass `@/tmp/op.json`
   instead of inlining (apply_response.py accepts `@<path>`).
   `clearSourceFlag` stays `false` for `ai-requests.json` requests.
   It's only set to `true` when the request id has a `virtual:<panel>:<cardId>`
   prefix or carries a `linkedTo` (the responder skills), in which case
   the source card's `aiRequest` flag is cleared.

   `apply_response.py` creates `footnotes.json`, `notifications.json`,
   and `version.txt` if they don't yet exist (a fresh paper folder
   won't have them). Don't pre-create them.

   If 5a succeeds but 5b fails, revert 5a by undoing the Edit before
   retrying — otherwise the .tex carries a `\vfid` whose footnote sidecar
   never landed.

6. **Reply.** On success:
   ```
   Done: drafted footnote <newId> for request <requestId>. Output: footnotes.json + document.tex (+ ai-requests.json, notifications, version).
   ```
   If a follow-up citation request was filed (missing bibkey), append:
   ```
   Filed follow-up citation request <newRequestId> for missing bibkey <bibkey>.
   ```
   On halt (step 0 validation failed):
   ```
   Halted: request <requestId> has no paragraphIds; needs anchor before drafting.
   ```

## Safety

- Don't insert a footnote anchor with mismatched UUIDs across
  `\vfid{}` and `footnotes.json` id — they must match.
- Don't fabricate a `\citet{key}` for a bibkey not in `references.bib`
  — file a `citation` AI request instead.
- If `paragraphIds` on the request is empty, halt per step 0 (don't
  guess an anchor from the request text).
