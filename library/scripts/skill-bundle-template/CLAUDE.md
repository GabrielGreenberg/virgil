# Virgil — Claude Code workspace

This folder is a Virgil-managed Claude Code workspace. The Virgil web app keeps
`.claude/CLAUDE.md` (this file), `.claude/commands/{editor,library}/`, and
`.virgil/scripts/{editor,library}/` in sync — **don't hand-edit them**, they get
overwritten when Virgil updates.

Two namespaces of skills are available everywhere:

- **`/editor:*`** — operate on the current paper folder (paragraph anchors,
  AI requests, footnote drafting, suggestion review, sidecars). Useful when
  this folder is one of your papers.
- **`/library:*`** — operate on your Virgil Library (catalog, master.bib,
  unsorted triage, deep indexing). Useful when this folder is your Library
  *or* when you want to authenticate / triage / index from inside a paper.

Library skills resolve the library root automatically via
`./.virgil/library-path.json` (written by Virgil), `VIRGIL_LIBRARY_ROOT`,
`~/.config/virgil/library-path.json`, or `~/Virgil-Library/` — in that order.
If no library is configured, library-touching skills print "No library set up
— pick a library in Virgil first" and exit cleanly.

---

## When the user says "follow the instructions here"

The right answer depends on what kind of folder this is.

**If this is your Library folder** (contains `master.bib`, `.virgil/catalog.json`,
`papers/<citekey>/...`), follow the library queue-drain workflow:

1. **Check setup.** Run `python3 -c "import fitz, requests" 2>&1`. If pymupdf or
   requests are missing, run the install command from the **Setup** section.
2. **Inspect the queue.** List `.virgil/queue/*.json` (skip `_*.lock` and `*.done`).
3. **Process pending work:**
   - `kind: "triage"` + `status: "requested"` → `/library:triage-pdf`.
   - `kind: "index"` + `status: "requested"` → `/library:index-paper`.
   - `kind: "authenticate"` + `status: "requested"` → `/library:authenticate-bib`.
   - `kind: "deepIndex"` (or legacy `"richIndex"`) + `status: "requested"` → `/library:deep-index`.
   - `kind: "paper-review"` or any entry with a user `note` → `/library:ai-requests`.
4. If the queue is empty, report that and ask the user what to do next.

To poll continuously: `/loop /library:index-pending`.

**If this is a paper folder** (contains `main.tex`, `references.bib`,
`virgil/ai-requests.json`), follow the editor-review workflow:

1. **Drain open AI requests.** Run `/editor:review` — it dispatches each
   pending request in `virgil/ai-requests.json` to the appropriate per-kind
   subskill (footnote, citation, note, suggestion, bib-review, style-merge).
2. If no AI requests are pending, ask the user what they'd like to work on
   next (revisions, todos, library-side authentication of a new citekey, etc.).

To poll continuously: `/loop /editor:review`.

---

## Available commands

### Editor skills (operate on this paper)
- `/editor:review` — umbrella: drain all open AI requests, routing each to
  the right per-kind subskill.
- `/editor:draft-footnote` / `/editor:draft-quotation` / `/editor:draft-suggestion`
  — produce per-kind cards in response to AI requests.
- `/editor:answer-note-request` / `/editor:answer-todo-request` /
  `/editor:answer-cutter-comment` / `/editor:answer-revision-comment` /
  `/editor:answer-bib-review` — respond to flagged comments / todo requests.
- `/editor:find-citation` — find an authoritative source for a citation request.
- `/editor:sync-bib-to-library` — diff `references.bib` against your library
  and reconcile (requires a configured library).
- `/editor:style-merge` — merge local preamble customizations into the active
  document style.

### Library skills (operate on your library)
- `/library:index-paper <citekey>` — full pipeline for one source.
- `/library:triage-pdf <filename>` / `/library:triage-pending` — process
  files in `unsorted/`.
- `/library:authenticate-bib <citekey>` — verify a `.bib` entry against
  Crossref / OpenAlex / Semantic Scholar / arXiv.
- `/library:apply-bib-edit <citekey>` — apply a queued manual bib edit.
- `/library:deep-index <citekey>` — structural cleanup (deterministic + AI).
- `/library:fuse-alternate <citekey>` — fuse a PDF alternate's pgmarks into
  a TEX/DOCX primary.
- `/library:ai-requests` — drain user-authored AI requests on library papers.
- `/library:index-pending` — drain every queued request once, then exit.

---

## Where to put files you create

Skills sometimes write a markdown memo. There are **three** memo streams and
they **never mix** — route by what the note is *about*, not by where you happen
to be running:

- **Cowork memo** — a note *about this paper's content* (an ambiguity worth
  surfacing, a decision you made while editing) →
  `<docPath>/.virgil/memos/<YYYY-MM-DD>-<slug>.md`, inside the paper folder.
- **Library memo** — a note *about the library pipeline* (an extraction retro,
  a triage call, an indexing-flow idea) →
  `~/Virgil-Library/.virgil/memos/<YYYY-MM-DD>-<slug>.md`, inside the library
  folder (resolved via `library_path.py`).
- **Reflection** — a note *about Virgil's skill set itself* (how a skill
  behaved, a tooling improvement) is **not** a `.virgil/memos/` file. It is a
  dev-loop reflection: DEV mode only, handled by `/editor:reflect`, which writes
  it to Virgil's dev-loop reflection sink **outside** any paper or library
  folder. **Never file a reflection under `.virgil/memos/`.** Outside DEV mode
  there is nowhere to put one — skip it, don't fall back to `.virgil/memos/`.

The one decision rule: the words *reflect / reflection* **always** mean the
dev-loop stream — never `.virgil/memos/`. The full routing rule ships to this
folder at [`.claude/virgil/memos.md`](.claude/virgil/memos.md).

Reports are separate from memos:

- **Paper-specific reports / analyses** → `<paper-folder>/notes/<slug>.md` (when
  inside a paper) or `<library>/papers/<citekey>/notes/<slug>.md` (when reaching
  from the library). Co-located with the paper.

When in doubt, ask the user before writing a file you can't classify.

---

## Setup (first time only)

```bash
brew install poppler
pip3 install --user --break-system-packages -r .virgil/scripts/library/requirements.txt
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

## Failure handling

- If a Python script throws, capture the traceback verbatim in your reply.
  Don't try to patch broken extraction by hand — log the issue and stop.
- A queue entry that has failed three times has its `status` set to
  `"poisoned"` and is surfaced in the frontend with an "open log" link. Don't
  re-process poisoned entries unless the user explicitly asks.
- The library orchestrator handles `master.bib`, `.virgil/catalog.json`, and
  `.virgil/notifications/inbox.json` updates via Python CLI shims with file
  locks — you don't write to them directly.
