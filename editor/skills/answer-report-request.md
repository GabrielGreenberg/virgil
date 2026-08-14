---
description: |
  Answer a Report Request the user filed in Virgil's Reports panel.
  Triggers on: "answer my report request", "write the report I asked
  for", "draft the report on this paragraph", or when there's a pending
  `kind: report` request in the paper's AI-request inbox. Researches and
  composes the report, then drafts a Report card authored by AI, anchored
  to the same paragraph. Does NOT trigger for margin notes (use
  answer-note-request), revision requests (use answer-revision-request),
  or todos (use answer-todo-request). Args: <docPath> <requestId>.
---

# /editor/answer-report-request $ARGUMENTS

Resolve one AI request originating from a Reports-panel **Report Request**
with `aiRequest: true`. The Reports panel holds two polymorphic card
kinds: `report` (an authored content card carrying an `author` byline)
and `report-request` (the user's "ask"). This skill answers a flagged
Report Request by appending a **Report card authored by AI** to
`reports.json` — it never mutates the source request in place.

> **Allowable-LaTeX doctrine.** Any LaTeX you compose or edit must stick to
> the vocabulary Virgil renders meaningfully — read
> [_latex-allowlist.md](_latex-allowlist.md). In particular use the tie `~`
> (never `\textasciitilde{}`) for a non-breaking space, plus the `\cite…`
> family and inline marks it lists; anything outside it renders as raw grey
> monospace.

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
   request. Do the research/thinking the request asks for, then write it as
   focused plain text (short paragraphs; substance over length).
   `create_card.py` wraps the body as the report's rich-text `content` plus a
   plain-text `text` mirror — you no longer hand-build the card JSON. (Rich
   structure beyond paragraphs — `bulletList` / `bold` — isn't carried by
   `--body` yet; a richer-body flag is future work, not this chip.)

3. **Land it via the contract.** The research + composition above is this
   skill's job; the mechanical write is not. Hand the report to
   `create_card.py --kind=report` — it builds the `ReportCard`
   (`author: "ai"` → the "AI" byline, never "Claude"), anchors it to the
   paragraph, flips the Task's `status`/`result`, clears the source flag,
   stamps the `aiOriginRequestId` back-pointer, and bumps the version,
   atomically under the pen. A Report Request with no `safetyLevel` is a direct
   create; if it carries one, `create_card.py` honors it (1 → silent,
   2 → +comment, 3 → propose).

   - Real `requestId` (`kind: report`, `linkedTo.panel == "reports"`): anchor
     is read from the Task —
     ```bash
     python3 editor/scripts/create_card.py <docPath> <requestId> --kind=report \
         --author ai --title "<short title>" --body "<report body>"
     ```
   - Virtual id (`virtual:reports:<cardId>`): pass the source Report Request's
     paragraph as `--anchor` —
     ```bash
     python3 editor/scripts/create_card.py <docPath> virtual:reports:<cardId> \
         --kind=report --author ai --title "<short title>" \
         --body "<report body>" --anchor <uuid>
     ```

   The source Report Request is never overwritten — `create_card.py` appends a
   **new** `report` card and clears the request's `aiRequest` flag. This
   replaces the old "hand-build the ReportCard JSON, then call
   `apply_response.py`" dance — one call now owns the build + apply.

4. **Reply.** On success:
   ```
   Done: drafted report <id> for request <requestId>. Output: reports.json (+ ai-requests.json status/result, notifications, version).
   ```

## Idempotency

If the request is already `status: "complete"`, skip with:
```
Skipped <requestId> (already complete).
```

## Safety

- Don't hand-build the ReportCard JSON or call `apply_response.py` directly —
  route the write through `create_card.py` so the anchor, byline, status/result,
  and version bump stay centralized (the same contract `draft-footnote` /
  `create-card` use).
- Never edit the source Report Request in place — always create a new Report
  card; `create_card.py` clears the request's `aiRequest` flag for you.
- Never mutate `document.tex` — a Report is apparatus anchored beside the
  paragraph, not a change to the prose. If the user actually wanted a
  prose edit, draft a revision suggestion instead
  (`/editor/draft-suggestion`). This is the ask-shape rule read from the
  Reports side — [_ask-shape.md](_ask-shape.md) states it once, in both
  directions, for every panel.
