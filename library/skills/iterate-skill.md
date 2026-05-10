---
description: Closed-loop iteration on a Library skill. Runs the target skill (index-paper / deep-index / authenticate-bib) on each citekey via a fresh subagent, reads the subagent's memo, edits the skill markdown to fix flagged ambiguities, then continues. Args: <skill-name> <citekey1> [citekey2] ...
---

# /iterate-skill $ARGUMENTS

Drive a closed-loop iteration on one of the three core Library skills.
You (the agent invoking this) act as the loop driver: spawn subagents to
execute the target skill, read their critique memos, edit the skill
markdown, repeat. The subagent runs against the user's REAL
`~/Virgil-Library/` — successful runs do real indexing/auth work — and
this skill iterates the *meta* layer (the skill markdown itself).

## Args

```
/library/iterate-skill <skill-name> <citekey1> [citekey2] [citekey3] ...
```

`<skill-name>` ∈ `{index-paper, deep-index, authenticate-bib}`. Anything
else: abort with a one-line error.

`<citekey...>` — one or more citekeys. Each must already exist in the
user's `master.bib` (and, for `index-paper`, have a source file at
`~/Virgil-Library/papers/<citekey>/<citekey>.{pdf,docx,tex}` or a
pre-triage file in `~/Virgil-Library/unsorted/`).

## Preflight

Run from the Virgil repo cwd. If `library/skills/<skill-name>.md` does
not exist relative to cwd, abort:

```
iterate-skill must be run from the Virgil repo (where library/skills/ lives).
Current cwd: <pwd>
```

Confirm `~/Virgil-Library/master.bib` is readable. If the library hasn't
been picked yet (no master.bib), abort with a pointer to set up the
library first.

## The loop

Maintain a small state log in your scratch context (NOT a file): for
each citekey, record whether the run produced `[block]` items. Use it to
decide early termination.

For each citekey, in the order given:

### 1. Spawn the subagent

Use the `Agent` tool with `subagent_type: "general-purpose"`. The prompt
is self-contained — the subagent has zero context from this session.
Use this template (substitute `<skill>`, `<citekey>`, `<date>`,
`<run-N>`):

> **You are running the Library skill `<skill>` on citekey `<citekey>` against the real `~/Virgil-Library/`. You are NOT iterating the skill; you are executing it as a fresh agent would.**
>
> Steps:
> 1. Read the skill source at `library/skills/<skill>.md` (relative to current cwd) IN FULL. Treat it as your instructions for what follows.
> 2. Execute the skill on citekey `<citekey>` exactly as the markdown describes. Mutate the real library (move files, run python scripts, write catalog rows, edit master.bib, etc.) just as if a user had invoked the skill directly. If the skill says to invoke a python script, invoke it. If it says to fetch DOI metadata, fetch it. Do not paper over ambiguity by guessing silently — when the markdown leaves a choice underspecified, log the ambiguity in section 3 of your memo.
> 3. After the skill run completes (success, partial, or failure), write a memo to `library/dev/iterations/<date>-<skill>/<citekey>.md` (relative to cwd, create parent dirs as needed) using EXACTLY this template:
>
> ```markdown
> # <skill> on <citekey> — run <run-N>
>
> **Skill SHA**: <output of: git rev-parse HEAD:library/skills/<skill>.md>
> **Run started**: <ISO timestamp>
> **Result**: success | partial | failure
>
> ## Actions taken
> <bulleted log of the concrete operations you performed: file moves, scripts invoked with their args, catalog/bib writes, HTTP fetches. One bullet per discrete action.>
>
> ## Ambiguities encountered
> <each entry: quote the line of skills/<skill>.md that was ambiguous, then state what the markdown should have said to remove the ambiguity. If none, write "None.">
>
> ## Judgment calls made
> <discretionary choices you made and why. If none, write "None.">
>
> ## Final library state
> - catalog.json entry for <citekey>: indexed.state=<v>, bib.state=<v>, warnings=<list>
> - files written: <paths under ~/Virgil-Library/>
> - queue files remaining: <paths or "none">
>
> ## Suggested skill edits
> <each entry prefixed with [block] or [nice-to-have], referencing a line number in skills/<skill>.md, with a concrete proposed change. [block] = the skill cannot be reliably executed without this fix. [nice-to-have] = quality improvement. If none, write "None.">
> ```
>
> 4. Reply with ONLY the absolute path to the memo file you wrote, plus a one-line summary of `[block]` count. Do not edit `library/skills/<skill>.md`. Do not write any other files in `library/`.
>
> Hard rules:
> - You operate on the user's real library. Do not create test fixtures.
> - You may not edit any file under `library/skills/`. Only the memo file you write is allowed inside this repo.
> - If the skill markdown contradicts itself, follow your best interpretation and log the contradiction as an ambiguity.
> - The point of this exercise is to surface friction. Be exact and unsparing about ambiguities — vague memos waste the iteration.

### 2. Read the memo

Read the memo file the subagent wrote. Specifically extract:
- Result (success / partial / failure)
- Count of `[block]` items
- Count of `[nice-to-have]` items

### 3. Update the skill markdown

For each `[block]` item: edit `library/skills/<skill>.md` directly to
apply the suggested change (or a better version of it — the suggestion
is advisory, the goal is to make the skill unambiguous to a fresh
agent).

For `[nice-to-have]` items: judgment call. Apply if it's a clear win
(typo, missing example, broken link). Skip if it'd bloat the skill or
add scope.

If the memo flags only environmental issues (PDF missing, master.bib
entry absent, etc.) and zero ambiguity items: do not edit the skill.

### 4. Decide whether to continue

After processing each citekey, decide:
- If 2 consecutive memos had zero `[block]` items: stop early. The
  skill has stabilized for this corpus.
- If the citekey list is exhausted: stop.
- Otherwise: move to the next citekey.

## End-of-loop

Once the loop exits:

1. **Rebuild the bundle.** Run from the repo root:
   ```bash
   npm run build:library-bundle
   ```
   This regenerates `.claude/commands/library/<skill>.md` and the public
   skill bundle so the user's next `/library/<skill>` invocation picks
   up the edits.

2. **Print a summary** in your reply, ≤8 lines:
   - Skill iterated, citekeys processed, total `[block]` items raised
     vs. addressed.
   - Whether the skill stabilized (last 2 memos clean) or whether
     unresolved issues remain.
   - Path to the iterations dir for this run:
     `library/dev/iterations/<date>-<skill>/`.
   - One-line note per unresolved `[block]` item, if any.

## Memo discipline

The memos written by subagents live at
`library/dev/iterations/<YYYY-MM-DD>-<skill>/<citekey>.md`. This dir is
gitignored — memos are dev-time scratch. Do NOT route them to
`~/Virgil-Library/.virgil/memos/` (which is for cowork dev memos *about
the library*, not about Virgil's skill markdown). Do NOT write them to
`papers/<citekey>/notes/` either (that's for paper-specific reports the
user reads).

## What this skill does NOT do

- It does not reset library state. If a previous run left `<citekey>`
  in a bad state, fix it manually before iterating.
- It does not re-run the skill on the same citekey unless you re-invoke
  with that citekey again. The loop processes each citekey once.
- It does not commit changes. After iteration, the user inspects
  `git diff library/skills/<skill>.md` and commits when ready.

## Don't synchronously drain queues from inside the loop

If you (the driver) want to drain the index queue as part of a
session that's also running this loop — e.g. "drain the backlog,
then iterate the skill on representatives of whatever indexed" — do
**not** spawn a subagent that synchronously runs
`/library/index-pending` on a large queue. The subagent's turn
budget will expire mid-drain, the orphaned `drain_queue.py` child
will keep running, and the audit/follow-up step will silently never
run. This is exactly the failure mode that bit us on 2026-05-09.

Use the detach-and-poll pattern from `library/skills/index-pending.md`
("Large queues / running from inside a subagent") instead: kick off
the drain in a detached shell, arm a Bash background waiter on the
empty-queue condition, and only spawn iterate-skill subagents after
the waiter fires.

## Reply format

End-of-loop summary as described above. If the loop aborted before
processing all citekeys (e.g., subagent failed catastrophically), say
so plainly and name the failed citekey.
