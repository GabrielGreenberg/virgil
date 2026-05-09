---
description: Closed-loop iteration on the editor skill set. Synthesizes user requests, runs the target skill in a sandboxed copy of samples/annotation-history via fresh subagents, reads critique memos, edits skill markdown, and re-runs until each test case is clean. Args - [<skill-name>] [<max-attempts>].
---

# /editor/iterate-virgil-editor $ARGUMENTS

Drive a closed-loop iteration on the Virgil editor skill set. You (the
agent invoking this) act as the **loop driver**: brainstorm test cases,
clone `samples/annotation-history` into a scratch sandbox per attempt,
inject a synthetic AI request, spawn a fresh runner subagent that reads
the target skill markdown and executes it against the sandbox, read
the runner's critique memo, edit the skill markdown, and re-run the
same test case until it produces zero `[block]` items.

Unlike `/library/iterate-skill`, which iterates against the user's
real `~/Virgil-Library/`, this skill iterates against **synthesized**
requests in a sandbox copy. The user's real paper folders are never
touched.

## Args

```
/editor/iterate-virgil-editor                          # iterate every skill in dependency order (default)
/editor/iterate-virgil-editor <skill-name>             # iterate just that one skill
/editor/iterate-virgil-editor <skill-name> <max-attempts>  # cap total attempts for that skill
```

`<skill-name>` ∈ `{review, draft-footnote, find-citation,
draft-quotation, answer-note-request, answer-todo-request,
answer-cutter-comment, answer-revision-comment, draft-suggestion,
answer-bib-review, style-merge}`. Anything else: abort with a one-line
error.

`<max-attempts>` defaults to **12** per skill (enough for ~4 test
cases × 3 attempts). Hard ceiling **20**. When the cap is hit,
unresolved `[block]` items are logged in the final summary so the user
can pick them up by hand.

## Preflight

Run from the Virgil repo cwd. If `editor/skills/` does not exist
relative to cwd, abort:

```
iterate-virgil-editor must be run from the Virgil repo (where editor/skills/ lives).
Current cwd: <pwd>
```

Confirm the fixture is present:
```bash
test -d samples/annotation-history/virgil
```
If absent: abort with a pointer to restore from `samples/`.

Confirm the dev dirs exist (they should — `.gitkeep` files are
checked in):
```bash
mkdir -p editor/dev/iterations editor/dev/sandboxes
```

## Skill-iteration order (when no skill named)

Process leaf subskills first, then the umbrella, so umbrella iterations
exercise already-stabilized subskills:

1. `draft-footnote`
2. `find-citation`
3. `draft-quotation`
4. `answer-note-request`
5. `answer-todo-request`
6. `answer-cutter-comment`
7. `answer-revision-comment`
8. `draft-suggestion`
9. `answer-bib-review`
10. `style-merge`
11. `review` (umbrella — exercises dispatch, not per-kind logic)

After every 3 skills stabilize, run the **survey pass** (see below)
before moving to the next skill.

## The per-skill loop

Maintain a small state log in your scratch context (NOT a file): for
each test case, record attempt count and `[block]` items raised. Use
it to decide stability and the final summary.

For each target skill:

### 1. Brainstorm test cases

Read `editor/skills/<skill>.md` once. Write down 3–5 representative
synthetic requests covering at minimum:

- **Happy path** — well-formed request with all expected fields.
- **Missing context** — no `paragraphIds`, or `paragraphIds` referencing a UUID not in the .tex.
- **Mode B (selection)** — `selectedText` set to a substring of the anchored paragraph.
- **Underspecified ask** — terse request text that forces a judgment call.
- **Cross-skill edge** — e.g. footnote requesting a missing citation (should file a follow-up `kind: citation` request, not fabricate); answer-note-request that the markdown classifies as wanting a doc edit (should produce a suggestion, not a note).

For umbrella `review`: the test cases should each pre-load the
sandbox with a different mix of open requests (e.g. one with all
three kinds, one with only bib-reviews, one with only virtual
card-flag requests).

For `style-merge`: synthesize a request with a realistic
`payload` (targetStyleId, currentPreamble with one user-added
package, targetPreamble that's the stock style).

For `answer-bib-review`: pick a `bibKey` already present in
`samples/annotation-history/references.bib` (e.g. `grafton1997`
for `type: fields`, `vannevar1945` for `type: notes`).

Each test case gets a short kebab-case slug (`happy-path`,
`missing-paragraphids`, `mode-b-selection`, `terse-ask`,
`citation-followup`).

### 2. Per test case — re-run until clean

For each test case in the brainstormed list:

#### 2a. Sandbox

Fresh clone for every attempt — prior attempts' state must not
contaminate the next:

```bash
DATE=$(date +%Y-%m-%d)
SBOX="editor/dev/sandboxes/${DATE}-<skill>-<case-slug>-attempt<k>"
rm -rf "$SBOX"
cp -R samples/annotation-history "$SBOX"
```

#### 2b. Inject the synthetic request

Write the request directly into the appropriate sandbox sidecar:

- `ai-requests.json`: kinds `footnote` / `note` / `quotation` / `citation` / `todo` / `suggestion` / `style-merge`.
- `bib-review-requests.json`: kind `bib-review`.
- For Mode B / `linkedTo` variants targeting answer-note-request /
  answer-todo-request / answer-cutter-comment /
  answer-revision-comment: also flip `aiRequest: true` on a card in
  the corresponding sidecar (`notes.json` / `todos.json` /
  `cutter.json` / `revisions.json`) and set the request's
  `linkedTo: { panel, cardId }`.

The request body MUST be identical across attempts for the same test
case — same uuids, same text, same paragraph anchors. The only
variable across attempts is the skill markdown. Generate ids on the
first attempt and reuse:

```bash
RID=$(python3 -c 'import uuid;print(uuid.uuid4())')
# Pick a real paragraph anchor:
PARA=$(grep -oE '%!v:[0-9a-f]{4}' "$SBOX/document.tex" | head -1 | sed 's/%!v://')
```

Edit the sidecar JSON in place. Use Python for safe JSON manipulation
rather than text munging:

```bash
python3 - <<PY
import json, pathlib
p = pathlib.Path("$SBOX/virgil/ai-requests.json")
data = json.loads(p.read_text())
data["requests"].append({
    "id": "$RID",
    "kind": "footnote",
    "text": "<the synthetic ask>",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
    "status": "submitted",
    "paragraphIds": ["$PARA"],
})
p.write_text(json.dumps(data, indent=2) + "\n")
PY
```

#### 2c. Spawn the runner subagent

Use the `Agent` tool with `subagent_type: "general-purpose"`. The
prompt is fully self-contained — the runner has zero context from this
session. Substitute `<skill>`, `<sandbox-abs-path>`, `<case-slug>`,
`<attempt-k>`, `<request-json>`, `<date>`:

> **You are running the Virgil editor skill `<skill>` against a sandboxed paper folder. You are NOT iterating the skill; you are executing it as a fresh agent would.**
>
> Sandbox: `<sandbox-abs-path>`
> Synthetic request:
> ```json
> <verbatim request JSON, including its id>
> ```
>
> Steps:
> 1. Read `editor/skills/<skill>.md` (relative to cwd) IN FULL. Treat it as your instructions for what follows.
> 2. Execute the skill on the sandbox path. Run python helpers from `editor/scripts/`, edit `.tex`, invoke `apply_response.py` — exactly as a real user invocation would. The sandbox is yours to mutate; **do not touch `samples/annotation-history` or any other path**. When the markdown leaves a choice underspecified, log it as an ambiguity rather than guessing silently.
> 3. After the run completes (success, partial, or failure), write a memo to `editor/dev/iterations/<date>-<skill>/<case-slug>-attempt<attempt-k>.md` (relative to cwd; create parent dirs) using EXACTLY this template:
>
> ```markdown
> # <skill> on <case-slug> — attempt <attempt-k>
>
> **Skill SHA**: <output of: git rev-parse HEAD:editor/skills/<skill>.md>
> **Run started**: <ISO timestamp>
> **Result**: success | partial | failure
> **Synthetic request**: <one-line summary of what you were asked to resolve>
> **Sandbox**: <sandbox-abs-path>
>
> ## Actions taken
> <bulleted log of concrete operations: scripts invoked with their args, sidecars written, .tex edits with line ranges, HTTP fetches. One bullet per discrete action.>
>
> ## Ambiguities encountered
> <each entry: quote the line of editor/skills/<skill>.md that was ambiguous, then state what the markdown should have said to remove the ambiguity. If none, write "None.">
>
> ## Judgment calls made
> <discretionary choices you made and why. If none, write "None.">
>
> ## Final sandbox state
> - ai-requests.json status flips: <id → status>
> - result cards created: <panel/id>
> - .tex edits: <line ranges or "none">
> - notifications appended: <count>
> - version.txt: <new value>
>
> ## Suggested skill edits
> <each entry prefixed with [block] or [nice-to-have], referencing a line number in editor/skills/<skill>.md, with a concrete proposed change. [block] = the skill cannot be reliably executed without this fix. [nice-to-have] = quality improvement. If none, write "None.">
> ```
>
> 4. Reply with ONLY the absolute path to the memo file you wrote, plus a one-line summary in the form `BLOCK=<n> NICE=<m>`. Do not edit `editor/skills/<skill>.md`. Do not write any other files outside the sandbox or the memo path.
>
> Hard rules:
> - All mutations confined to `<sandbox-abs-path>`. No edits anywhere else in the repo except your memo file.
> - You may not edit any file under `editor/skills/`. Only the memo file you write is allowed.
> - If the skill markdown contradicts itself, follow your best interpretation and log the contradiction as an ambiguity.
> - The point is to surface friction. Be exact and unsparing about ambiguities — vague memos waste the iteration.

#### 2d. Read the memo + apply edits

Read the memo file the runner wrote. Extract:
- Result (success / partial / failure)
- Count of `[block]` items
- Count of `[nice-to-have]` items
- The full text of every `Suggested skill edits` entry

For each `[block]` item: edit `editor/skills/<skill>.md` directly to
apply the suggested change (or a better version of it — the suggestion
is advisory, the goal is to make the skill unambiguous to a fresh
agent).

For `[nice-to-have]` items: judgment call. Apply if it's a clear win
(typo, missing example, broken link). Skip if it'd bloat the skill or
add scope.

If the memo flags only sandbox/environmental issues (e.g. "fixture
missing X") and zero ambiguity items: do not edit the skill. Re-clone
the sandbox if the issue was a sandbox quirk; otherwise advance.

#### 2e. Re-run or advance

- **Zero `[block]` items**: this test case is clean. Advance to the next test case.
- **≥1 `[block]` item AND attempts < 4 AND total attempts for this skill < cap**: re-run the same test case with `attempt<k+1>` against a fresh sandbox to verify the edit actually fixed the friction (and didn't introduce new ambiguity). The synthetic request body is reused verbatim.
- **Per-case cap (4 attempts) hit OR skill cap hit**: log the unresolved blocks in scratch state, advance to the next test case anyway.

#### 2f. Skill-stable check

After all test cases for the skill have been processed, the skill is
"stable" iff every test case passed clean within ≤2 attempts (i.e.
either first-try clean, or the first edit fixed it). Record the
verdict for the final summary, then move to the next skill.

### 3. Survey pass (every 3 skills stabilize)

After every 3 skills stabilize, pause for a survey — the loop driver
itself, no subagent:

1. Read every file under `editor/skills/` and `editor/AGENTS.md`.
2. Check for cross-skill drift:
   - Same arg-resolution prose (path resolution: explicit arg → cwd with `virgil/` → error).
   - Same `Done: …` reply format.
   - All Python helper invocations use the same path (`editor/scripts/<x>.py` from repo root).
   - All `apply_response.py` op-json shapes match the schema.
   - No skill duplicates logic that lives in `editor/scripts/_common.py`.
3. Edit any drift inline. If the survey edits a skill that has
   already been marked stable, re-run one happy-path iteration on
   that skill to confirm it still passes.

## End-of-loop

Once the loop exits (all skills processed or single-skill mode
complete):

1. **Rebuild the bundle.** From the repo root:
   ```bash
   npm run build:editor-bundle
   ```
   This regenerates `.claude/commands/editor/<skill>.md` for every
   skill so the user's next invocation picks up the edits.

2. **Print a summary** in your reply, ≤15 lines:
   - Skills iterated, total test cases run, total attempts, total `[block]` items raised vs. addressed.
   - Per-skill stability verdict (✓ stable / ✗ unresolved blocks).
   - Path to iterations dir for this run: `editor/dev/iterations/<date>-*/`.
   - Sandbox dir for inspection: `editor/dev/sandboxes/<date>-*/`.
   - One-line note per unresolved `[block]` item, if any.
   - Reminder: `git diff editor/skills/` to review edits, `rm -rf editor/dev/sandboxes/` to clean up.

## Hard rules

- Never mutate `samples/annotation-history/` or `virgil-data/doc_devtest/` — only sandbox copies.
- Never commit. Loop ends with diffs in the working tree for the user to inspect.
- Never run a skill against the real fixture; sandboxes are mandatory.
- Memos live at `editor/dev/iterations/<date>-<skill>/<case-slug>-attempt<k>.md`. They are gitignored dev scratch — do NOT route them to `<docPath>/.virgil/memos/` (that channel is for cowork dev memos *about a paper*, not about Virgil's skill markdown).
- Loop driver edits skill markdown directly. Runner subagents never edit `editor/skills/`.

## What this skill does NOT do

- It does not commit. The user inspects `git diff editor/skills/` and commits when satisfied.
- It does not run against the user's real paper folders. The fixture is always `samples/annotation-history`.
- It does not retry skills that hit the per-skill cap. Re-invoke `/editor/iterate-virgil-editor <skill-name>` to take another pass.
- It does not delete sandboxes. They're left for inspection; `rm -rf editor/dev/sandboxes/` cleans up.

## Reply format

End-of-loop summary as described above. If the loop aborted before
processing all skills (e.g., subagent failed catastrophically), say
so plainly and name the failed skill + test case.
