# Virgil Library — Claude Code workspace

This folder is a self-contained Claude Code workspace for indexing and managing
academic source documents — PDFs, Word `.docx`, LaTeX `.tex` manuscripts, and
loose `.bib` files (each entry becomes a bib-only catalog row, no source file
required). The Virgil Library web app keeps `.claude/CLAUDE.md` (this file),
`.claude/commands/`, and `.virgil/scripts/` in sync — **don't hand-edit them**,
they get overwritten on the next app launch.

User-owned: `master.bib`, `papers/`, `unsorted/`. Skill-managed runtime state
lives under `.virgil/` (catalog, queue, notifications, logs, memos). User
notes per paper at `papers/<citekey>/virgil/notes.json` are also user-owned.

---

## When the user says "follow the instructions here"

Do this, in order:

1. **Check setup.** Run `python3 -c "import fitz, requests" 2>&1`. If pymupdf or
   requests are missing, run the install command from the **Setup** section
   below and tell the user.
2. **Inspect the queue.** List `.virgil/queue/*.json` (skip `_*.lock` and `*.done`).
3. **Process pending work:**
   - If any entry is `kind: "triage"` and `status: "requested"` → run `/triage-pdf`.
   - If any entry is `kind: "index"` and `status: "requested"` → run `/index-paper`.
   - If any entry is `kind: "authenticate"` and `status: "requested"` → run `/authenticate-bib`.
   - If any entry is `kind: "deepIndex"` (or legacy `"richIndex"`) and `status: "requested"` → run `/deep-index`.
   - If any entry is `kind: "paper-review"` or has a user `note` → run `/ai-requests`.
4. **If the queue is empty,** report that and ask the user what they'd like to
   do next.

If the user follows up with "watch", "keep going", or "drain continuously",
run `/loop /index-pending` instead — Claude wakes itself periodically and drains
new entries as they appear.

---

## Available commands

- **`/index-paper <citekey>`** — full pipeline for one paper. Reads
  `papers/<citekey>/<citekey>.{pdf,docx,tex}` (priority `tex > docx > pdf`),
  writes `papers/<citekey>/main.tex` (with `\pgmark{N}` printed-page anchors
  for PDFs; DOCX and TEX have none — TEX is a passthrough copy of the source),
  initializes Virgil sidecars, authenticates the `.bib` entry against external
  sources, updates `.virgil/catalog.json`.
- **`/triage-pdf <filename>`** — for a freshly-dropped source file (PDF, DOCX,
  `.tex`, or `.bib`) in `unsorted/`, proposes a citekey, moves the file to
  `papers/<citekey>/<citekey>.<ext>`, adds a `master.bib` stub if needed, and
  queues an indexing request. For `.bib` files (multi-entry fan-out), each
  entry produces a bib-only catalog row and queues `kind: "authenticate"`
  instead of `index`; the source `.bib` is deleted from `unsorted/` after
  successful fan-out.
- **`/authenticate-bib <citekey>`** — verifies a `.bib` entry against
  Crossref / OpenAlex / Semantic Scholar / arXiv. Standalone-callable when a
  user adds a `.bib` entry by hand and wants it cleaned up.
- **`/apply-bib-edit <citekey>`** — drains a manual bib edit queued by the
  frontend's "Edit" button. Reads `.virgil/queue/<citekey>-bibedit.json`,
  rewrites the `master.bib` block, re-emits `references.bib`, and bumps
  the catalog version.
- **`/deep-index <citekey>`** — applies structural cleanup to an
  already-indexed paper. Runs deterministic preprocessing (strips
  repeating headers/footers, removes leaked page numbers, rejoins
  hyphenated words, joins broken paragraphs), then AI-driven structural
  fixes (heading hierarchy, `\maketitle` cleanup, pgmark alignment,
  orphan footnote re-attachment). Sets `indexed.state = "deepIndexed"`
  (double checkmark in the frontend). Was previously `/rich-index`;
  legacy `richIndex` queue entries and `richIndexed` catalog rows are
  still accepted on read.
- **`/ai-requests`** — drains user-authored AI requests only (entries
  with a `note` field, plus all `paper-review` entries). Surfaces the
  user's note verbatim and acts on it. Skips general indexing/triage.
- **`/triage-pending`** — batch-triages every file in `unsorted/`.
- **`/index-pending`** — drains every queued request once, then exits.

All commands operate on the current working directory as the library root.
Always run them from inside the library folder (`cd ~/Virgil-Library`).

---

## Where to put files you create

Skills sometimes need to write a memo or a report. Use these conventions:

- **Dev memos** — suggestions for improving a skill, retros on what went
  wrong this run, ideas for future passes — go to
  `.virgil/memos/<YYYY-MM-DD>-<slug>.md`. These are **about the pipeline**,
  not about a specific paper. Never drop a dev memo at the library root.
- **Paper-specific reports** — written analyses, extracted summaries,
  anything *about* one citekey's content — go to
  `papers/<citekey>/notes/<slug>.md`. Co-located with the paper so the user
  finds them when browsing the paper folder.
- When in doubt, ask the user before writing a file you can't classify.

---

## Setup (first time only)

```bash
brew install poppler
pip3 install --user --break-system-packages -r .virgil/scripts/requirements.txt
```

Optional, for higher-quality output:

```bash
# Layout-aware extraction for academic PDFs (~1GB model on first use)
pip3 install --user --break-system-packages marker-pdf

# OCR support for scanned PDFs
brew install tesseract
pip3 install --user --break-system-packages ocrmypdf
```

The pipeline degrades gracefully if marker or ocrmypdf are missing — pymupdf
is the always-on fallback for digital-native PDFs.

---

## Disk layout

```
~/Virgil-Library/
├── master.bib                       # canonical bibliography (you own)
├── unsorted/                        # raw drops awaiting triage (you own)
├── papers/<citekey>/                # one folder per paper (you own)
│   ├── <citekey>.{pdf,docx}         # the source file
│   ├── main.tex                     # extracted LaTeX
│   ├── references.bib               # single-entry mirror of master.bib row
│   ├── virgil/{virgil,notes,footnotes}.json   # editor sidecars
│   ├── variants/                    # alternate sources from triage
│   ├── notes/                       # paper-specific AI reports / analyses
│   └── <user supplementary>         # extra files the user drops
├── .claude/                         # Claude Code config (app-managed)
│   ├── CLAUDE.md                    # this file
│   └── commands/library/*.md        # skill prompts
└── .virgil/                         # runtime state (app-managed)
    ├── catalog.json                 # frontend state-of-the-world
    ├── catalog-version.txt          # 1-byte counter, frontend polls it
    ├── queue/                       # {triage,index,authenticate,...} requests
    ├── notifications/inbox.json     # toast feed for the frontend
    ├── logs/<citekey>/              # per-run logs + summary.md
    ├── memos/                       # dev memos (skill-improvement notes)
    ├── scripts/*.py                 # Python pipeline
    └── .skill-bundle-version.json   # version stamp
```

---

## Failure handling

- If a Python script throws, capture the traceback verbatim in your reply.
  Don't try to patch broken extraction by hand — log the issue and stop.
- A queue entry that has failed three times has its `status` set to
  `"poisoned"` and is surfaced in the frontend with an "open log" link. Don't
  re-process poisoned entries unless the user explicitly asks.
- The orchestrator handles `.virgil/catalog.json`, `.virgil/catalog-version.txt`,
  and `.virgil/notifications/inbox.json` updates itself — you don't write to
  them directly.
