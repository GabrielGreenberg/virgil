---
description: |
  Answer a Report Request the user filed in Virgil's Reports panel.
  Triggers on: "answer my report request", "write the report I asked
  for", "draft the report on this paragraph", or when there's a pending
  `kind: report` request in the paper's AI-request inbox. Researches and
  composes the report, then drafts a Report card authored by AI, anchored
  to the same paragraph. Does NOT trigger for margin notes (use
  answer-note-request), revision comments (use answer-revision-comment),
  or todos (use answer-todo-request). Args: <docPath> <requestId>.
---

# /editor/answer-report-request $ARGUMENTS

Resolve one AI request originating from a Reports-panel **Report Request**
with `aiRequest: true`. The Reports panel holds two polymorphic card
kinds: `report` (an authored content card carrying an `author` byline)
and `report-request` (the user's "ask"). This skill answers a flagged
Report Request by appending a **Report card authored by AI** to
`reports.json` — it never mutates the source request in place.

## Args

- `<docPath>` — path to the doc folder.
- `<requestId>` — a real `ai-requests.json` id with `kind: "report"` and
  `linkedTo.panel == "reports"` (Report Requests bridge to a real request
  entry when their `aiRequest` flag flips on), or `virtual:reports:<cardId>`.

## Procedure

1. **Load.** The source Report Request from
   `<docPath>/virgil/reports.json` `cards[]` via `linkedTo.cardId` (the
   `report-request` card). Its `text` / `content` is what report the user
   wants. Pull paragraph context for the request's anchor:
   ```bash
   python3 editor/scripts/get_para_context.py <docPath> <uuid> --neighbors=2
   ```
   And the sibling cards on the same paragraph, so the report doesn't
   repeat existing apparatus:
   ```bash
   python3 editor/scripts/cards_for_paragraph.py <docPath> <uuid>
   ```

2. **Compose the report.** A Report is free-form prose (sans-serif, like
   a margin Note) — an analysis, summary, or write-up that answers the
   request. Do the research/thinking the request asks for. Keep it
   focused; short paragraphs, and bullet lists where they help (the body
   is Tiptap rich text — `bulletList` / `orderedList` + `bold` / `italic`
   are supported). Substance over length.

3. **Build the Report card** (see `ReportCard` in `src/lib/types.ts`):
   ```json
   { "kind": "report",
     "id": "<new-uuid>",
     "createdAt": "<ISO now>",
     "author": "ai",
     "title": "<short title for the report>",
     "text": "<plain-text mirror of content>",
     "content": {
        "type": "doc",
        "content": [
           { "type": "paragraph",
             "content": [{ "type": "text", "text": "<paragraph 1>" }] }
        ]
     },
     "links": [{
        "id": "<new-link-uuid>",
        "kind": "anchor",
        "anchor": {
           "type": "anchor",
           "paragraphIds": ["...copy from the request's anchor..."],
           "margin": {"side": "left"}
        },
        "target": {
           "type": "card",
           "ref": {"kind": "report", "id": "<new-uuid>"}
        },
        "createdAt": "<ISO now>"
     }]
   }
   ```
   - `author: "ai"` → renders as the "AI" byline (never "Claude"). A
     human-authored report would carry `"human"`; this skill always emits
     `"ai"`.
   - Copy `paragraphIds` from the source request's anchor link so the
     report lands on the same paragraph. Reports sit on the **left**
     margin (`"side": "left"`).
   - `content` is the rich-text body; `text` is its plain-text flattening
     (used for search + the compressed card preview).

4. **Apply.**
   ```bash
   python3 editor/scripts/apply_response.py <docPath> '<op-json>'
   ```
   ```json
   { "requestId": "<requestId>",
     "panel": "reports",
     "card": { ...the new report card... },
     "summary": "Drafted report for request <cardId>",
     "clearSourceFlag": true
   }
   ```
   `clearSourceFlag: true` flips the source Report Request's `aiRequest`
   back to `false` (the request stays in the panel as a record of the ask).

5. **Reply.** On success:
   ```
   Done: drafted report <id> for request <requestId>. Output: reports.json (+ ai-requests.json, notifications, version).
   ```

## Idempotency

If the request is already `status: "complete"`, skip with:
```
Skipped <requestId> (already complete).
```

## Safety

- Never edit the source Report Request in place — always create a new
  Report card. The bridge clears `aiRequest` via `clearSourceFlag`.
- Never mutate `document.tex` — a Report is apparatus anchored beside the
  paragraph, not a change to the prose. If the user actually wanted a
  prose edit, draft a revision suggestion instead
  (`/editor/draft-suggestion`).
