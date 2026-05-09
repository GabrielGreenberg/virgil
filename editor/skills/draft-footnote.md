---
description: Draft a footnote in response to a `kind: footnote` AI request — writes the footnote into footnotes.json and inserts the LaTeX command into document.tex at the anchor position. Args - <docPath> <requestId>.
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
   When the bibkey isn't yet in `references.bib`, file a follow-up
   `kind: "citation"` AI request rather than fabricating an entry.

2. **Compose.** Draft the footnote body as plain LaTeX text — keep it
   under ~80 words. Match the doc's apparatus tone (read other
   footnotes in `footnotes.json` to gauge). Cite via `\citet{...}` /
   `\citep{...}` for natbib docs, `\textcite{...}` / `\parencite{...}`
   for biblatex (detect by reading `references.bib` + the doc's bib
   package usage).

3. **Build the FootnoteRef** (see `src/lib/types.ts:234`). Tiptap
   JSONContent shape:
   ```json
   { "id": "<footnote-uuid>",
     "content": { "type": "doc",
                  "content": [{ "type": "paragraph",
                                "content": [{ "type": "text",
                                              "text": "<the body>" }] }] },
     "createdAt": "<ISO now>"
   }
   ```

4. **Insert into the .tex.** Read the .tex file. Find the anchor
   paragraph by searching for `%!v:<uuid>` at end-of-line. Insert
   `\vfid{<footnote-uuid>}\footnote{<body>}` right before the
   `%!v:<uuid>` marker (so the footnote is part of the same logical
   paragraph). Preserve all surrounding whitespace verbatim.

   If the request's `selectedText` is set (Mode B), insert at the END
   of the selected substring rather than at end-of-paragraph. Match
   `selectedText` exactly in the paragraph; if it doesn't match
   verbatim, fall back to end-of-paragraph insertion and note the
   discrepancy in your reply.

5. **Apply.**
   ```bash
   python3 editor/scripts/apply_response.py <docPath> '<op-json>'
   ```
   where `<op-json>` is:
   ```json
   { "requestId": "<requestId>",
     "panel": "footnotes",
     "card": { ...the FootnoteRef... },
     "summary": "Drafted footnote: <first 60 chars>",
     "clearSourceFlag": false
   }
   ```
   Then write the modified `.tex` directly:
   ```bash
   # Use Edit on document.tex to splice in the \vfid + \footnote command.
   ```

6. **Reply.**
   ```
   Done: drafted footnote <newId> for request <requestId>. Output: footnotes.json + document.tex (+ ai-requests.json, notifications, version).
   ```

## Safety

- Don't insert a footnote anchor with mismatched UUIDs across
  `\vfid{}` and `footnotes.json` id — they must match.
- Don't fabricate a `\citet{key}` for a bibkey not in `references.bib`
  — file a `citation` AI request instead.
- If `paragraphIds` on the request is empty, ask the user which
  paragraph to anchor to before proceeding (don't guess).
