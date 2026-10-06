<!-- Canonical "where does a responder read its request from" rule for every
     editor responder skill `/editor/review` dispatches an AI-request row to.

     SSOT: this file is the single source of truth for the request-load rule.
     It is referenced by link (like `_ask-shape.md`), not inlined. Do not
     paraphrase it back into a skill; link to it. A census
     (`editor/skills/__tests__/request-load-doctrine.test.ts`) holds every
     dispatch target to carrying the pointer and fails on any skill that
     loads its request from the raw `ai-requests.json` row (task 980).

     Not a slash command — the leading underscore filters it out of the
     command mirror in both build scripts. -->

## Request-load rule (load-bearing)

**A responder reads its request from the DRAIN ROW — the row
`list_requests.py` emits for `<requestId>` — never from the raw
`ai-requests.json` row.**

```bash
python3 editor/scripts/list_requests.py <docPath>
```

Pick the row whose `id` is `<requestId>` (a real Task id and a
`virtual:<panel>:<cardId>` id alike — the drain is the only place a virtual
row exists). Everything a responder needs is on it: `kind`, `text`,
`paragraphIds`, `selectedText`, `linkedTo`, and under `extra` the `status`,
`safetyLevel`, `resultId` and `payload`.

**Why the raw row is wrong.** A bridged row's stored `text` is a SNAPSHOT
taken when the bridge fired — often just the first few words the user typed
into the card's comment box. The linked card is the source of truth for what
the user asked, and `list_requests.py` reads the drain row's `text` from that
card's CURRENT body (`live_linked_text`, task 955), falling back to the stored
text only when the card is gone. Reading the raw row answers — and stamps — an
ask the user has since rewritten.

**So, wherever a skill writes `<request.text>`** (a suggestion's
`instructions`, a classify step, a surface banner) it means the drain row's
`text`. Paragraph context, selected text and the Task's safety level come off
the same row.

**A `<requestId>` the drain does not emit is CLOSED** (terminal, or an L3
proposal whose card already landed — `_common.is_request_open`). Re-running a
closed Task is a no-op: report it and stop. Do not go to the raw sidecar to
find it.

The sidecar is still READ for the card a request links to (`todos.json`,
`notes.json`, `footnotes.json`, …) — that is where the live ask lives — and it
is still WRITTEN only through `apply_response.py`, never by hand
([_ask-shape.md](_ask-shape.md) §4).
