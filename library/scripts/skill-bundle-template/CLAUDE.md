# Virgil Library — Claude Code workspace

This folder is a self-contained Claude Code workspace for indexing and managing
academic source documents (PDF and Word `.docx` files). The Virgil Library web
app keeps `CLAUDE.md`, `.claude/commands/`, and `scripts/` in sync — **don't
hand-edit them**, they get overwritten on the next app launch.

User-owned files (the app never touches these): `master.bib`, `catalog.json`,
`papers/`, `pdfs/`, `queue/`, `logs/`, `notifications/`, and any
`papers/<citekey>/virgil/notes.json` you write into.

---

## When the user says "follow the instructions here"

Do this, in order:

1. **Check setup.** Run `python3 -c "import fitz, requests" 2>&1`. If pymupdf or
   requests are missing, run the install command from the **Setup** section
   below and tell the user.
2. **Inspect the queue.** List `queue/*.json` (skip `_*.lock` and `*.done`).
3. **Process pending work:**
   - If any entry is `kind: "triage"` and `status: "requested"` → run `/triage-pdf`.
   - If any entry is `kind: "index"` and `status: "requested"` → run `/index-paper`.
   - If any entry is `kind: "authenticate"` and `status: "requested"` → run `/authenticate-bib`.
   - If any entry is `kind: "richIndex"` and `status: "requested"` → run `/rich-index`.
   - If any entry is `kind: "paper-review"` or has a user `note` → run `/ai-requests`.
4. **If the queue is empty,** report that and ask the user what they'd like to
   do next.

If the user follows up with "watch", "keep going", or "drain continuously",
run `/loop /index-pending` instead — Claude wakes itself periodically and drains
new entries as they appear.

---

## Available commands

- **`/index-paper <citekey>`** — full pipeline for one paper. Reads
  `pdfs/<citekey>.pdf` or `pdfs/<citekey>.docx`, writes
  `papers/<citekey>/main.tex` (with `\pgmark{N}` printed-page anchors for
  PDFs; DOCX has none), initializes Virgil sidecars, authenticates the `.bib`
  entry against external sources, updates `catalog.json`.
- **`/triage-pdf <filename>`** — for a freshly-dropped source file (PDF or
  DOCX) in `pdfs/unsorted/`, proposes a citekey, renames the file to
  `pdfs/<citekey>.<ext>`, adds a `master.bib` stub if needed, and queues an
  indexing request.
- **`/authenticate-bib <citekey>`** — verifies a `.bib` entry against
  Crossref / OpenAlex / Semantic Scholar / arXiv. Standalone-callable when a
  user adds a `.bib` entry by hand and wants it cleaned up.
- **`/apply-bib-edit <citekey>`** — drains a manual bib edit queued by the
  frontend's "Edit" button. Reads `queue/<citekey>-bibedit.json`,
  rewrites the `master.bib` block, re-emits `references.bib`, and bumps
  the catalog version.
- **`/rich-index <citekey>`** — applies structural cleanup to an
  already-indexed paper. Runs deterministic preprocessing (strips
  repeating headers/footers, removes leaked page numbers, rejoins
  hyphenated words, joins broken paragraphs), then AI-driven structural
  fixes (heading hierarchy, `\maketitle` cleanup, pgmark alignment,
  orphan footnote re-attachment). Sets `indexed.state = "richIndexed"`
  (double checkmark in the frontend).
- **`/ai-requests`** — drains user-authored AI requests only (entries
  with a `note` field, plus all `paper-review` entries). Surfaces the
  user's note verbatim and acts on it. Skips general indexing/triage.
- **`/triage-pending`** — batch-triages every file in `pdfs/unsorted/`.
- **`/index-pending`** — drains every queued request once, then exits.

All commands operate on the current working directory as the library root.
Always run them from inside the library folder (`cd ~/Virgil-Library`).

---

## Setup (first time only)

```bash
brew install poppler
pip3 install --user --break-system-packages -r scripts/requirements.txt
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
├── CLAUDE.md                  # this file (app-managed)
├── .claude/commands/*.md      # skill prompts (app-managed)
├── scripts/*.py               # Python pipeline (app-managed)
├── master.bib                 # canonical bibliography (you own)
├── catalog.json               # frontend state-of-the-world (skill-managed)
├── catalog-version.txt        # 1-byte counter, frontend polls it
├── pdfs/<citekey>.{pdf,docx}  # one source file per citekey (PDF or Word)
├── pdfs/unsorted/             # raw drops awaiting triage
├── papers/<citekey>/          # indexed paper folder (Virgil-compatible)
│   ├── main.tex
│   ├── references.bib
│   └── virgil/{virgil,notes,footnotes}.json
├── queue/                     # {triage,index,authenticate,reindex} requests
├── logs/<citekey>/            # per-run logs + summary.md
└── notifications/inbox.json   # toast feed for the frontend
```

---

## Failure handling

- If a Python script throws, capture the traceback verbatim in your reply.
  Don't try to patch broken extraction by hand — log the issue and stop.
- A queue entry that has failed three times has its `status` set to
  `"poisoned"` and is surfaced in the frontend with an "open log" link. Don't
  re-process poisoned entries unless the user explicitly asks.
- The orchestrator handles `catalog.json`, `catalog-version.txt`, and
  `notifications/inbox.json` updates itself — you don't write to them
  directly.
