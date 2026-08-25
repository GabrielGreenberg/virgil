---
description: |
  Developer-only meta-skill — stress-test and refine Virgil's editor
  skill set in a sandboxed sample paper. Triggers on: "iterate on the
  editor skills", "stress-test draft-footnote", "tune /editor/<skill>",
  "improve the editor skill markdown" — i.e., when a Virgil maintainer
  is working on the skill files themselves. Synthesizes representative
  AI requests, runs the target skill against a sandboxed copy of
  samples/annotation-history via fresh subagents, reads critique memos,
  edits skill markdown, and loops until each test case is clean. Does
  NOT trigger for end-user requests like "review my doc" — that's
  /editor/review. Args: [<skill-name>] [<max-attempts>].
---

# /editor/iterate-virgil-editor $ARGUMENTS

Drive a closed-loop iteration on the Virgil editor skill set. You (the
agent invoking this) act as the **loop driver**: brainstorm test cases,
clone `samples/annotation-history` into a scratch sandbox per attempt,
inject a synthetic AI request, spawn a fresh runner subagent that reads
the target skill markdown and executes it against the sandbox, read
the runner's critique memo, **route each proposed skill edit through the
boundary guard**, edit the skill markdown inline, and re-run the same
test case until the memo is no longer `flagged`.

Unlike `/library/iterate-skill`, which iterates against the user's
real `~/Virgil-Library/`, this skill iterates against **synthesized**
requests in a sandbox copy. The user's real paper folders are never
touched.

**This is one of two entry points to a single dev-loop engine** (chip 19;
[editor/dev/README.md](../dev/README.md)). `iterate` is the *synthesized-input,
single-skill, synchronous* entry; [`/editor/dream`](dream.md) is the
*real-input, cross-skill, ambient* entry. They share the same critique-memo
shape, the same reader, and the same boundary guard — built from two real
consumers, not duplicated. What stays **specialized to `iterate`**: it
synthesizes its own input + sandboxes it, and it lands every non-refused edit
**inline in the working tree** (synchronous, no commit — the maintainer watches
`git diff editor/skills/`). It does **not** take on `dream`'s autonomous
acts-on-branch / propose-via-worktree machinery — see
[The boundary guard](#the-boundary-guard-chip-19) below.

## Args

```
/editor/iterate-virgil-editor                          # iterate every skill in dependency order (default)
/editor/iterate-virgil-editor <skill-name>             # iterate just that one skill
/editor/iterate-virgil-editor <skill-name> <max-attempts>  # cap total attempts for that skill
```

`<skill-name>` ∈ `{review, draft-footnote, find-citation,
answer-note-request, answer-todo-request,
answer-cutter-comment, answer-revision-request, draft-suggestion,
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
3. `answer-note-request`
4. `answer-todo-request`
5. `answer-cutter-comment`
6. `answer-revision-request`
7. `draft-suggestion`
8. `answer-bib-review`
9. `style-merge`
10. `review` (umbrella — exercises dispatch, not per-kind logic)

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
- **Cross-skill edge** — e.g. footnote requesting a missing citation (should file a missing-bibkey **todo card** through Workflow B, not fabricate a `\citet` and not hand-append an `ai-requests.json` row — see [_ask-shape.md](_ask-shape.md) §4); answer-note-request that the markdown classifies as wanting a doc edit (should produce a suggestion, not a note).

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
  answer-revision-request: also flip `aiRequest: true` on a card in
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
`<attempt-k>`, `<request-json>`, `<kind>`, `<paragraph-uuid>`.

The runner no longer hand-writes the memo markdown. It composes a structured
**critique JSON** and hands it to `dev_loop.py write-iteration-memo`, which
renders it in the **unified memo shape** (the same frontmatter + four buckets +
tiers as `/editor/reflect`'s memos) and writes it to the canonical iterations
path. This is the chip-19 unification: one memo shape, one writer, read by the
one shared reader. The script does the `[block]`→`flagged`/`[nice-to-have]`→`noted`
+ bucket mapping; the runner just supplies the qualitative critique.

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
> 3. After the run completes, write your critique as JSON to `<sandbox-abs-path>/.iterate-critique.json` using EXACTLY this schema (omit a field that's empty):
>
> ```json
> {
>   "skill": "<skill>",
>   "case": "<case-slug>",
>   "attempt": <attempt-k>,
>   "taskId": "<the synthetic request id, or '-'>",
>   "kind": "<kind>",
>   "paragraphIds": ["<paragraph-uuid>"],
>   "sandbox": "<sandbox-abs-path>",
>   "result": "success | partial | failure",
>   "summary": "<one-line summary of what you were asked to resolve / your Done: line>",
>   "actions": ["<one bullet per discrete op: scripts + args, sidecars written, .tex edits with line ranges, HTTP fetches>"],
>   "ambiguities": [{"quote": "<the ambiguous line of editor/skills/<skill>.md>", "fix": "<what it should have said to remove the ambiguity>"}],
>   "judgmentCalls": ["<a discretionary choice you made and why>"],
>   "edits": [{"severity": "block | nice-to-have", "line": <line number in editor/skills/<skill>.md>, "change": "<the concrete proposed change>"}],
>   "finalState": {"ai-requests": "<id → status>", "cards": "<panel/id>", "tex": "<line ranges or none>", "notifications": <count>, "version": "<new value>"}
> }
> ```
>
>    `severity: "block"` = the skill cannot be reliably executed without this fix (→ the memo is `flagged`). `severity: "nice-to-have"` = a quality improvement (→ `noted`). Ambiguities go to the `issues` bucket; judgment calls to `alignment`; `block` edits to `issues`; `nice-to-have` edits to `streamlining`.
> 4. Hand the critique to the writer (it computes the tier + the memo path and writes the unified-shape memo to `editor/dev/iterations/<date>-<skill>/<case-slug>-attempt<attempt-k>.md`):
>
>    ```bash
>    python3 editor/scripts/dev_loop.py write-iteration-memo --json @<sandbox-abs-path>/.iterate-critique.json
>    ```
> 5. Reply with ONLY the script's `Done:` line (it carries the memo path + `tier=<t>, block=<n>, nice=<m>`). Do not edit `editor/skills/<skill>.md`. Do not write any file outside the sandbox (the writer owns the memo path).
>
> Hard rules:
> - All mutations confined to `<sandbox-abs-path>` (your critique JSON included). The writer script is the ONLY thing that writes outside the sandbox, and only to the iterations memo path.
> - You may not edit any file under `editor/skills/`.
> - If the skill markdown contradicts itself, follow your best interpretation and log the contradiction as an ambiguity.
> - The point is to surface friction. Be exact and unsparing about ambiguities — vague memos waste the iteration.

#### 2d. Read the memo, route each edit through the guard, apply inline

Read the memo file the runner wrote. It is now in the **unified shape** — the
same frontmatter + four buckets the dream reads. Extract via the one shared
reader (no second parser):

```bash
# the frontmatter (tier, blockCount, niceCount, result) + the buckets:
python3 -c "import sys; sys.path.insert(0,'editor/scripts'); from reflect import _parse_memo; \
fm,sec=_parse_memo(open('<memo-path>').read()); print(fm['tier'], fm['blockCount'], fm['niceCount']); print(sec['issues'])"
```

- `tier: flagged` (≥1 `[block]`) → fixes are needed; build a change per block item.
- `tier: noted` (`[nice-to-have]` only, or logged friction) → advisory; apply only the clear wins (typo, missing example, broken link). Skip anything that would bloat the skill.
- `tier: unremarkable` → clean. Nothing to apply.

The `issues` bucket holds the ambiguities + `[block]` items; `streamlining` the
`[nice-to-have]` items; `alignment` the judgment calls. If the memo flags only a
sandbox/environmental issue (e.g. "fixture missing X") and no real skill
ambiguity: do not edit the skill — re-clone if it was a sandbox quirk, else advance.

**Then route every proposed edit through the boundary guard before applying it**
— this is iterate's chip-19 safety net. For each edit you intend to make, build a
change object and classify it:

```bash
# edits.json: a list of change objects you're about to make to skill markdown
# [{ "summary": "...", "paths": ["editor/skills/<skill>.md"],
#    "intent": "tighten-wording|add-example|fix-typo|expand-guidance|clarify",
#    "oldText": "<exact text to replace>", "newText": "<replacement>" }]
python3 editor/scripts/dev_loop.py route-edits --edits @edits.json
# → { "acts": [...], "surface": [...], "blocked": [...], "counts": {...} }
```

Then act on the partition (you stay **synchronous + inline** — no worktree, no commit):

- **`acts`** (single-skill prose polish) → apply the edit to `editor/skills/<skill>.md` directly. The suggestion is advisory; the goal is to make the skill unambiguous to a fresh agent.
- **`surface`** (`proposes`-class: cross-skill / `.py` / manifest / contract-adjacent / structural) → still apply it inline (the maintainer is watching the diff), **but flag it** in your scratch log + the final summary as *"needs extra scrutiny — consider a separate pass."* Do **not** spin up a worktree; that is `dream`'s job, not iterate's.
- **`blocked`** (`refused`: an `editor/AGENTS.md` Don't-rule, the `apply_response.py` contract shape, or the `VIRGIL_DEV` gate) → **do NOT apply it.** Record the refusal (its `boundary` + `reason`) in scratch + the final summary. A `[block]` whose only fix is a refused edit cannot be resolved here — surface it to the maintainer instead of working around the boundary.

#### 2e. Re-run or advance

The clean criterion is now the memo **tier**, and the guard gates the re-run:

- **`tier: noted` or `unremarkable`**: this test case is clean (no `[block]`). Advance to the next test case.
- **`tier: flagged` AND you applied ≥1 inline edit (acts/surface) this attempt AND attempts < 4 AND total attempts for this skill < cap**: re-run the same test case with `attempt<k+1>` against a fresh sandbox to verify the edit actually fixed the friction (and didn't introduce new ambiguity). The synthetic request body is reused verbatim.
- **`tier: flagged` but every proposed edit was `blocked` (refused)**: do NOT re-run — re-running can't converge on a boundary you won't cross. Log the refused block(s) for the maintainer and advance.
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
3. **Route every drift edit through the same guard** (`dev_loop.py route-edits`)
   before applying it — the survey is exactly where boundary crossings hide,
   because it reads/edits `editor/AGENTS.md` and touches several skills at once:
   - A genuinely-cross-skill edit (≥2 skill prompts, e.g. unifying the `Done:`
     line everywhere) classifies as **`surface`** (proposes). Apply it inline but
     flag it as a cross-skill change for extra scrutiny — these are the edits most
     worth a deliberate, separate pass.
   - An edit to an `editor/AGENTS.md` Don't-rule, the contract shape, or the DEV
     gate classifies as **`blocked`** (refused) — do NOT apply it; surface it.
   - Single-skill drift fixes classify as **`acts`** — apply inline as usual.
   If the survey edits a skill that has already been marked stable, re-run one
   happy-path iteration on that skill to confirm it still passes.

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
   - Skills iterated, total test cases run, total attempts, total `flagged` (`[block]`) memos raised vs. addressed.
   - Per-skill stability verdict (✓ stable / ✗ unresolved blocks).
   - **Surfaced (`proposes`-class) edits** that landed inline but want a deliberate separate pass (cross-skill / script / manifest / contract-adjacent).
   - **Refused (boundary) edits** the guard blocked — one line each with its boundary, so the maintainer can decide deliberately (the loop never crosses them).
   - Path to iterations dir for this run: `editor/dev/iterations/<date>-*/`.
   - Sandbox dir for inspection: `editor/dev/sandboxes/<date>-*/`.
   - Reminder: `git diff editor/skills/` to review edits, `rm -rf editor/dev/sandboxes/` to clean up.

## The boundary guard (chip 19)

iterate and [`/editor/dream`](dream.md) share one boundary guard
([`dream_land.classify_change`](../scripts/dream_land.py)), routed for iterate
through [`dev_loop.route_edits`](../scripts/dev_loop.py). Every skill edit — at
the per-case apply step (2d) **and** the cross-skill survey (3) — is classified
into one of three modes, and iterate honors each:

| Mode | What it is | What iterate does |
|---|---|---|
| **acts** | single-skill prose polish, no contract token | apply inline (the normal case) |
| **surface** | `proposes`-class: cross-skill / `.py` / manifest / contract-adjacent / structural | apply inline **and flag** for a deliberate separate pass — **no worktree** |
| **blocked** | `refused`: an `editor/AGENTS.md` Don't-rule, the `apply_response.py` contract shape, or the `VIRGIL_DEV` gate | **do NOT apply** — record the boundary + surface it |

**The autonomy layer is `dream`-only.** `dream` runs unattended overnight, so its
`proposes` verdict means *stage it in a `dream/<date>` worktree for review*.
iterate runs **synchronously with the maintainer watching the diff**, so it lands
every non-refused edit **inline in the working tree** and uses `surface` only to
*flag* — it never stands up a worktree and never commits. iterate adopts
`dream_land` purely as a **boundary guard** (the `refused` safety net it
previously lacked) plus a scrutiny signal — not as an autonomy model.

## The unified memo shape (chip 19)

The runner's critique memo and `/editor/reflect`'s memos are now **one shape**,
read by **one reader** ([`reflect._parse_memo`](../scripts/reflect.py)):
frontmatter (`skill` · `tier` · `result` · the shared keys) + the four buckets
(`issues` · `streamlining` · `alignment` · `userTagged`) + a tier
(`flagged`/`noted`/`unremarkable`). [`dev_loop.write_iteration_memo`](../scripts/dev_loop.py)
does the mapping: a `[block]` edit → `flagged` + the `issues` bucket; a
`[nice-to-have]` → `noted` + `streamlining`; ambiguities → `issues`; judgment
calls → `alignment`. iterate-specific facts (the synthetic `result`, `case`,
`attempt`, `sandbox`, the per-attempt actions log) ride extra frontmatter +
trailing body sections the shared reader tolerates.

`editor/dev/iterations/` and `editor/dev/memos/` are **two labeled streams, one
shape**: iterate's synthesized stress-test runs vs reflect's real ambient
captures. The dream consumes only `memos/`; iterate consumes only `iterations/`
(inline, this loop) — but both read through the one reader, and both route edits
through the one guard. See [editor/dev/README.md](../dev/README.md).

## Hard rules

- Never mutate `samples/annotation-history/` or `virgil-data/doc_devtest/` — only sandbox copies.
- Never commit. Loop ends with diffs in the working tree for the user to inspect.
- Never run a skill against the real fixture; sandboxes are mandatory.
- Memos live at `editor/dev/iterations/<date>-<skill>/<case-slug>-attempt<k>.md`, written by `dev_loop.py write-iteration-memo` in the **unified shape**. They are gitignored dev scratch — do NOT route them to `<docPath>/.virgil/memos/` (that channel is the cowork-memo / paper-note stream — notes *about a paper*, not about Virgil's skill markdown).
- **Route every skill edit through `dev_loop.py route-edits` (the guard) before applying it.** Honor `blocked` (refused — never apply, never work around the boundary); flag `surface` (proposes — apply inline but surface for scrutiny); apply `acts` inline. The three boundaries are law.
- **No worktree, no commit.** iterate is synchronous + inline; the propose-via-worktree autonomy is `dream`'s, not iterate's.
- Loop driver edits skill markdown directly. Runner subagents never edit `editor/skills/`; they only write their critique JSON (in the sandbox) and call the writer script.
- One seam, no fork: reuse `reflect._parse_memo` (the reader) and `dream_land` (the guard) via `dev_loop` — never write a second parser or a parallel routing rule.

## What this skill does NOT do

- It does not commit, and it does not stage edits in a worktree. The user inspects `git diff editor/skills/` and commits when satisfied. (Worktree-staging of `proposes`-class changes is `dream`'s autonomy model — not iterate's.)
- It does not cross the three boundaries. A `refused` edit is recorded and surfaced, never applied.
- It does not run against the user's real paper folders. The fixture is always `samples/annotation-history`.
- It does not retry skills that hit the per-skill cap. Re-invoke `/editor/iterate-virgil-editor <skill-name>` to take another pass.
- It does not delete sandboxes. They're left for inspection; `rm -rf editor/dev/sandboxes/` cleans up.

## Reply format

End-of-loop summary as described above. If the loop aborted before
processing all skills (e.g., subagent failed catastrophically), say
so plainly and name the failed skill + test case.
