# Plan — dev-dream: capture paper-directed cowork sessions

**Branch:** `dev-dream-cowork-capture` (worktree off `main@76ca7ff5`)
**Goal:** every future paper-editing (cowork/code) session accumulates reflection
("dev") memos the repo-side `/editor/dream` can consume. Today they produce **zero**.
**Grounded by:** workflow `wf_be7e5f89-c33` (10-reader investigation + design brief).

---

## Why zero today — three stacked blockers (each fully blocks the loop)

1. **Toggle off.** `VIRGIL_DEV=1` lives in the repo's `.claude/settings.local.json`;
   a paper-cowork session's cwd is the paper **workspace root** (outside the repo),
   so the toggle never reaches it → `reflect.py` no-ops.
2. **No trigger.** Only `/editor/review` enforces reflect, and only for the subskills
   it dispatches. A hand-invoked `draft-footnote` never calls reflect. The AGENTS.md
   convention that would cover direct invocation isn't even synced to paper folders.
3. **Wrong sink.** Run from the synced copy `.virgil/scripts/editor/reflect.py`,
   `REPO_ROOT = parents[2]` resolves to `<workspace>/.virgil`, so a memo (if it ever
   fired) lands in `<workspace>/.virgil/editor/dev/memos` — a dir the dream never reads.
   And the bundled markdown invocation `python3 editor/scripts/reflect.py` doesn't even
   resolve in a paper folder (scripts are at `.virgil/scripts/editor/`).

## Verified ground truth (from the brief)

- **cwd = workspace root**, not `papers/<citekey>/`. `<docPath>` is a cwd-independent arg
  (`_common.resolve_doc()` resolves it absolutely) — the doc-facing side is already robust.
- **`apply_response.py` is the single writeback chokepoint** every mutating skill routes
  through; both finalizers (`cmd_write` :918, `_mutation_commit` :1051) end at
  `commit_under_pen`. A DEV-gated side-effect on the tail adds **no** subcommand, **no**
  `RESULT_*/STATUS_*` value, **no** op-json key → stays outside the **B2** contract-shape
  boundary the dream may not cross.
- **`_memos_root()` is duplicated verbatim** in `reflect.py:164` and `dream.py:106`; the
  `VIRGIL_DEV_MEMOS_DIR` env override already bypasses `REPO_ROOT` in both → the env var
  alone makes the sink correct from any cwd. Code changes are defense-in-depth + the two
  `git -C REPO_ROOT` sha calls the env var doesn't cover.
- **Two independent DEV gates** (`reflect.py` no-ops without `VIRGIL_DEV`; the tail-trigger
  is itself gated) keep the loop inert for end users even though scripts ship to everyone.
  So we **never** put `VIRGIL_DEV` in any synced settings — the runtime gate is the guard.
- **Greenfield:** `editor/dev/memos` and `dream-digests` hold only `.gitkeep` — zero memos,
  zero digests. No migration cost whichever sink we choose.

## The key simplifier

The `apply_response` tail-trigger spawns `reflect.py` via a **sibling path computed in
Python** (`Path(__file__).parent / "reflect.py"`), so it is immune to the broken markdown
script-paths. The mechanical memo floor therefore works even from the synced copy, even if
every skill markdown still says `editor/scripts/…`. That makes:
- **Trigger (#2)** the load-bearing fix,
- **Sink env var + SSOT (#3-misroute)** the correctness guarantee,
- **Markdown path rewrite (#3-locate)** a secondary enrichment nicety (only the *agent-driven
  qualitative buckets* need it; the mechanical floor doesn't).

---

## Design decisions

### D1 — Sink: one canonical machine-global memo root  *(pinned by env, guaranteed by SSOT)*
Hoist `dev_home()/memos_root()/digests_root()` into `_common.py` so the **writer**
(`reflect`) and **reader** (`dream`) resolve **identically** — the one hard invariant
(divergence = dream reads an empty dir with no error). `VIRGIL_DEV_MEMOS_DIR` pins it
absolute so repo, worktree, and paper-folder sessions all deposit into one dir.

### D2 — Trigger: DEV-gated best-effort reflect emit on the `apply_response` tail  *(the deep seam)*
One `_common.spawn_reflection(doc, skill, task_id)` helper — DEV-gated, short timeout,
swallows all errors, never blocks/raises the commit — called after `commit_under_pen` in
both finalizers. Reuses `reflect.py` wholesale (sink, tier floor, idempotency). This is the
unified seam: the same script every skill already funnels through becomes the one trigger,
for umbrella-dispatched **and** hand-invoked skills, with new skills inheriting it free.
Writes a correctly-classified memo (skill/taskId/result/tier/paragraphIds); the qualitative
4 buckets are added later by the convention (the "ceiling"). Fires for every writeback.

### D3 — Umbrella call: KEEP it (revised after reading review.md:87)
The umbrella's reflect call is a **bare mechanical** `reflect.py <doc> <subskill> <taskId>`
(same floor the tail-trigger gives) **plus optional buckets** when the subagent surfaced
friction. So the tail-trigger and umbrella **merge harmoniously** via `(skill, taskId)`
idempotency: for an unambiguous kind (`footnote → draft-footnote`) the tail writes the floor
first, then the umbrella *enriches the same memo* (buckets added, tier rises, `reflectedAt`
kept). **Keep** the umbrella call — it's the accurate enrichment path for review-dispatched
skills; removing it would lose its buckets and isn't needed. Rare duplicate only for an
ambiguous kind (`note`/`comment`) where the tail's derived skill ≠ the real subskill —
low-harm, dream-tolerated, noted as a cosmetic follow-up.

### Trigger placement (locked): single site in `apply_response.main()`
`cmd_write` returns `{ok, version, requestId, status, result}` and `main()` has the
subcommand name (`rest[0]`) — enough for a **single-site** best-effort trigger after
successful dispatch (before `return 0`), with **no op re-parse**. Skill derived by
`_skill_for(subcommand, kind)`: an optional stripped `--skill` hint → a mutation-subcommand
map → a `kind → skill` map (kind added to `cmd_write`'s **return**, additive/output-only, not
a B2 op-json-input change) → the subcommand name. taskId = `result.get("requestId") or "-"`.

### D4 — Locating (secondary): make the synced markdown resolve `reflect.py`
Give `reflect.md` the dual-path resolver already in `answer-bib-review.md` (`for candidate in
.virgil/scripts/editor editor/scripts`). Class fix (build-time rewrite of the paper bundle's
invocation prefixes, or a shared resolver) is a **follow-on** — not needed for the floor.

### D5 — Fix the misrouting synced doc
The paper-facing `CLAUDE.md` still says "Dev memos → `.virgil/memos/`" (the retired phrasing
AGENTS.md was rewritten to kill). Correct it + route the reflect-vs-cowork-memo rule via the
**manifest** subsystem (lands at `.claude/virgil/`, never clobbers user-owned files).

---

## Ordered change-list (the implementation spine)

| # | Change | Files |
|---|--------|-------|
| 1 | **Config** — `VIRGIL_DEV=1` + `VIRGIL_DEV_MEMOS_DIR` (+ optional `VIRGIL_DREAM_DIGESTS_DIR`) user-scope; drop redundant `VIRGIL_DEV` from project local | `~/.claude/settings.json`, `.claude/settings.local.json` |
| 2 | **Sink SSOT** — `dev_home/memos_root/digests_root` helper; repoint reflect/dream; fix `_skill_sha`/`_dream_sha` to resolve the source repo independently of `__file__` (env `VIRGIL_REPO_ROOT` / upward-walk / `'unknown'`) | `_common.py`, `reflect.py`, `dream.py` |
| 3 | **Trigger seam** — `_common.spawn_reflection` + DEV-gated best-effort call after `commit_under_pen` in both finalizers; resolve the skill name in scope | `_common.py`, `apply_response.py` |
| 4 | **Dedupe** — remove the umbrella reflect-enforce block once idempotency confirmed | `review.md` |
| 5 | **Locating** — dual-path resolver in `reflect.md` (+ note the class fix) | `reflect.md` |
| 6 | **Misrouting doc** — correct paper-facing memo routing via manifest subsystem | `docs/workspace/*` → `.claude/virgil/`, bundle |
| 7 | **Tests** — extend the capture slice: paper-cowork completion → exactly one memo under the passed sink (DEV-on); zero (DEV-off) | `test_reflect_capture_slice.py` |
| 8 | **Propagate** — `npm run build:skill-bundles`; note deploy + reload/refresh-skills to reach open papers | build artifacts |
| 9 | **Verify empirically** — run reflect from a REAL FSA-synced paper folder; confirm memo lands in the global sink and `dream select` consumes it | — |

## Implementation status (live)

| # | Change | Status |
|---|--------|--------|
| 1 | Config: `VIRGIL_DEV=1` + sink pin user-scope | **BLOCKED on explicit consent** — code default already resolves `~/.virgil-dev`, so only `VIRGIL_DEV=1` is strictly required; snippet ready |
| 2 | Sink SSOT (`_common` dev_home/memos_root/digests_root/iterations_root/source_repo_root; reflect+dream+dev_loop delegate; REPO_ROOT removed) | ✅ done — 15 suites green + SSOT-identity proven |
| 3 | Tail-trigger — **REWORKED after review**: now in the two commit finalizers `cmd_write`/`_mutation_commit` (covers create_card's in-process path too); skill from the **Task kind** (`_KIND_SKILL`) / op label (`_OP_SKILL`); `main()`+`--skill`+return-shape additions reverted | ✅ done — HIGH-scenario merge proven end-to-end |
| R1 | Adversarial review round 1 (`wmn7v62wx`): 5 confirmed → **HIGH/LOW/LOW/NIT fixed** (trigger→finalizers, task-kind skill, `$HOME`-anchored dirs, docstring); MED mitigated (3→2 memos) | ✅ addressed |
| R2 | Re-review of the rework (`w4j2oke57`): 3 confirmed (2 MED, 1 NIT), 0 refuted → **all fixed**: panel-aware `_write_skill` (virtual card-flag `virtual:notes:` → answer-note-request; bridged `kind:suggestion`+panel → answer-cutter/revision-comment; dead `*-comment` kinds dropped); docstring "after stdout" corrected | ✅ addressed |
| T | Skill-attribution now covers kind + panel across native / bridged / virtual / mutation paths; 21-assertion tail-trigger test guards each | ✅ green (16 suites) |
| 4 | Umbrella call — **kept** (merges via idempotency; D3 removal deferred) | ✅ decided |
| 5 | Locating: `reflect.md` dual-path resolver | ✅ done |
| 6 | Misrouting synced CLAUDE.md (D5) | ⏭ deferred → follow-up (orthogonal; tail-trigger closes reason #2 mechanically) |
| 7 | Tests: `test_reflect_tail_trigger.py` (26 assertions) | ✅ done — green |
| 8 | Propagate: rebuild bundle + deploy + resync | ⏳ note only — `public/skill-bundle/` is gitignored/auto-built; user runs `npm run build:skill-bundles` + deploy + "Refresh skills" |
| — | Docs: README + AGENTS.md + reflect.md + dev_loop docstring | ✅ done |
| — | Adversarial verification workflow over the diff | ⏳ running (`wmn7v62wx`) |
| — | 21-skill markdown path-robustness class | ⏭ deferred → follow-up (pre-existing; tail-trigger doesn't depend on it) |

## Top risks to verify (from the brief §6)

1. Does the bundled reflect actually run + land in the global sink from a **real FSA-synced**
   paper folder (not the dev preview — this is the dev-masking class)?
2. Writer/reader `memos_root` resolve identically (else silent empty read).
3. `VIRGIL_DEV` actually present in a paper-folder-cwd session (user-scope env merge).
4. Idempotency across the apply_response trigger + umbrella double-fire.
5. Skill name reaches the finalizer without crossing B2 (internal field, not a shape axis).
