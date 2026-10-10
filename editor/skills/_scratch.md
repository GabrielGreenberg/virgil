<!-- Canonical "where a skill's scratch files live" doctrine for every skill in
     BOTH silos (editor + library) — task 2026-10-10-1050.

     SSOT: this file is the single source of truth. An identical copy lives at
     `editor/skills/_scratch.md` and `library/skills/_scratch.md` so each
     bundle ships it (the two silos land in separate on-disk folders, so each
     needs a local copy for `[_scratch.md](_scratch.md)` links to resolve).
     The copies are kept byte-identical — edit BOTH — and the rule itself is
     held by `library/lib/__tests__/scratch-file-census.test.ts`, whose
     population is DISCOVERED by scanning every skill markdown in every silo
     (allowlist EMPTY). Do not paraphrase this doctrine back into a skill; link
     to it, then show your own block. This file links nothing, because a link
     that resolves in one silo may not resolve in the other.

     Not a slash command — the leading underscore filters it out of the
     command mirror in both build scripts. -->

## Scratch-file doctrine (load-bearing)

A skill that hands a helper script a file — a patch, a field set, an inbox
item, a triage JSONL, a run-state env — writes that file as **scratch**. One
rule covers every such file in every silo:

> **Scratch is minted by `mktemp`, in `$TMPDIR`, never at a fixed name.**

### Why a fixed name is a defect, not a style choice

Two runs of one skill are routine: a queue drain and a user-typed command on
the same paper, two windows, two libraries open in two tabs. With a fixed name
both runs write the SAME path, and the loser's file is silently replaced
between the moment it is written and the moment it is read. Nothing errors.
The surviving run computes its verdict, its field writes, or — worst — its
`cd` target from the OTHER run's file. A name built from the citekey does not
help: two runs on one citekey are exactly the case that collides.

And scratch never lands in the paper or library folder: that folder is the
user's, often sync-backed, and every write there is sync traffic.

### One call: mint, use, remove

When the whole life of the file fits in ONE shell call, mint it in that call:

```bash
f=$(mktemp -t virgil-<skill>)
cat > "$f" <<'JSON'
{ …payload… }
JSON
python3 <helper> --patch-file "$f"; rc=$?
rm -f "$f"
exit "$rc"
```

Several files in one call share one directory: `t=$(mktemp -d -t
virgil-<skill>)`, write `"$t/fields.json"`, `"$t/base.bib"`, …, and finish
with `rm -rf "$t"`. Capture `rc` before the `rm` so a failing call still
cleans up and still fails. Keep the heredoc quoted (`<<'JSON'`) and its
terminator at column 0.

### Several calls: one run directory, carried as a literal

Shell state does not survive between tool calls — a variable minted in step 3
is gone by step 4. So a recipe whose files outlive one call mints ONE
directory for the whole run, at its first step, and prints it:

```bash
mktemp -d -t virgil-<skill>
```

From then on every block in that run writes `<runDir>` where the directory
goes, and you **substitute the printed path for `<runDir>` exactly as you
substitute `<citekey>`** — a literal, the same one for the whole run. Never
re-mint mid-run (a second `mktemp` is a second, empty directory), and never
fall back to a remembered fixed name. The run's last step removes it
(`rm -rf <runDir>`); a run that stops early leaves it in `$TMPDIR`, which is
harmless and is what `$TMPDIR` is for.

### Placeholders inside an include

An underscore include is never invoked as a command, so nothing substitutes
`$ARGUMENTS` in it — run literally, it is an empty shell variable. A block in
an include spells its inputs as placeholders (`<citekey>`, `<runDir>`), the
way every skill does.
