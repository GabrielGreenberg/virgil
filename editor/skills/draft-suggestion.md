---
description: Draft a `kind: suggestion` AI request — creates a RevisionSuggestionCard with author=ai for the user to accept or reject. Args - <docPath> <requestId>.
---

# /editor/draft-suggestion $ARGUMENTS

Resolve one AI request whose kind is `suggestion`. The user is asking
for a textual revision: rephrase, restructure, tighten, expand. Emit
a **RevisionSuggestionCard** with `author: "ai"`, `status: "pending"`.
The user accepts or rejects in the editor; never edit the .tex from
this skill.

## Args

- `<docPath>` — path to the doc folder.
- `<requestId>` — the request id from `list_requests.py`.

## Procedure

1. **Load.** Request from `ai-requests.json`. Paragraph context
   (neighbors=2) for whatever paragraph(s) the request anchors to. If
   `selectedText` is set on the request, that's the precise target;
   otherwise the whole anchored paragraph is the target.

2. **Compose.**
   - `original_text`: copy verbatim from the .tex (selected slice for
     Mode B, full paragraph for Mode A).
   - `suggested_text`: your proposed replacement.
   - `explanation`: one or two sentences on what changed and why.
   - `user_text`: empty (the user fills this when refining).

3. **Build the RevisionSuggestionCard** (see
   `src/lib/types.ts:314` analog for revisions):
   ```json
   { "kind": "suggestion",
     "id": "<new-uuid>",
     "createdAt": "<ISO now>",
     "author": "ai",
     "original_text": "<verbatim>",
     "suggested_text": "<your draft>",
     "explanation": "<rationale>",
     "user_text": "",
     "instructions": "<the request's `text` field>",
     "status": "pending",
     "selectedText": "<from request, if Mode B>",
     "links": [{ ...anchor matching the request's paragraphIds... }],
     "aiOriginRequestId": "<requestId>"
   }
   ```

4. **Apply.**
   ```bash
   python3 editor/scripts/apply_response.py <docPath> '<op-json>'
   ```
   ```json
   { "requestId": "<requestId>",
     "panel": "revisions",
     "card": { ...the suggestion... },
     "summary": "Drafted a suggestion: <first 60 chars of explanation>",
     "clearSourceFlag": false
   }
   ```

5. **Reply.**
   ```
   Done: drafted suggestion <newId> for request <requestId>. Output: revisions.json (+ ai-requests.json, notifications, version).
   ```

## Safety

- `original_text` MUST match the .tex byte-for-byte — accept-time
  replacement uses it as the search key.
- Don't propose `suggested_text` that's just a paraphrase of the
  request — the user wrote the request to ask for change, not to read
  it back.
