---
description: |
  Install the heavy extraction tools the Virgil Library needs and
  pre-download their ML models into the library itself (no global
  cache pollution). Triggers on: "set up my library", "install
  marker", "set up extraction tools", "/library/setup", "Virgil,
  install the heavy indexing tools", "my library says it's missing
  extraction models", "fix the models toast". Idempotent — re-runs
  only install what's missing. Pass `--force` to redo from scratch.
  Does NOT trigger for indexing a paper (use /library/index-paper) or
  cleaning up an already-indexed paper (use /library/deep-index).
---

# /library/setup $ARGUMENTS

## Bootstrap (run this first)

This skill operates on the user's Virgil Library. Resolve the library
root and cd into it before running anything else — that way the skill
works from any Virgil-managed folder.

```bash
# Find library_path.py — synced PWA folders have it under .virgil/scripts/,
# the Virgil source repo has it under editor/scripts/. Either is fine.
library_path_py=""
for candidate in .virgil/scripts/editor/library_path.py editor/scripts/library_path.py; do
  [ -f "$candidate" ] && { library_path_py="$candidate"; break; }
done
if [ -z "$library_path_py" ]; then
  echo "No library set up. Pick a library in Virgil first."
  exit 1
fi
library_root="$(python3 "$library_path_py" --get 2>/dev/null)" || {
  echo "No library set up. Pick a library in Virgil first."
  echo "  (Or run: python3 $library_path_py --set <abs-path>)"
  exit 1
}
cd "$library_root"
export VIRGIL_LIBRARY_ROOT="$library_root"
```

---

## What this skill does

Eagerly installs the extraction tools the indexing and deep-indexing
pipelines depend on, and pre-downloads marker's ML weights INTO the
library folder rather than the user's global cache. The result is:

- **Light deps** (always succeeds): `PyMuPDF`, `requests`, `rapidfuzz`,
  `python-docx` — the baseline indexing pipeline.
- **Heavy deps** (may fail on incompatible platforms — see "Platform
  notes" below): `marker-pdf>=1.0` (the default PDF extractor),
  `ocrmypdf` (scanned-PDF preprocessing).
- **Model caches** (two — `setup.py` names both at its start): marker's
  huggingface_hub snapshots land in `<library>/.virgil/models/huggingface/`
  (not `~/.cache/huggingface/`), and surya's layout/table/OCR weights —
  the ~3 GB bulk — in `<library>/.virgil/models/datalab/` (not
  `~/Library/Caches/datalab/`).
- **System binary**: `tesseract` is verified — if missing, the script
  prints an install hint (we don't auto-install system packages).
- **Manifest**: `<library>/.virgil/models/manifest.json` records
  exactly what's installed, with versions.

The library is the right home for these models because: (a) `index-paper`
and `deep-index` both share them, (b) backing up / moving the library
takes the models with it, (c) different libraries don't fight over a
single global cache.

## Platform notes

The split-install above is load-bearing: pip's transaction is all-or-
nothing, so a heavy-block failure shouldn't take the light block down
with it. The light block is what lets the pipeline still run
`--extractor pymupdf` (the explicit-fallback extractor) even when
marker can't be installed.

**Apple Silicon macOS users**: `marker-pdf>=1.0` requires `torch>=2.5.1`,
and torch's macOS x86_64 wheels stopped at 2.2.2. If your `python3` is
x86_64 (running under Rosetta) on an arm64 Mac, the heavy install
fails with `ResolutionImpossible`. The setup script detects this and
prints the fix (install arm64-native Homebrew + python). Surface that
warning in your reply if you see it.

## Steps

1. **Pick a supported Python interpreter.** marker-pdf (and its
   scikit-learn pin) ship prebuilt wheels for Python **3.10–3.12**
   only. On a too-new interpreter (3.13+) pip falls back to source
   builds, which currently fail on a yanked numpy build-dep.

   Also check the architecture: on Apple Silicon Macs, the user's
   `python3` is often x86_64 Homebrew (running under Rosetta) — that
   Python can't install `torch>=2.5.1` (marker's hard floor) and the
   heavy install will fail.

   The most reliable path on any platform — and the recommended one
   for users who don't already have a working `python3.10`-`3.12`
   matching their CPU — is **`uv`**, Astral's standalone Python
   installer. It needs no sudo, no Homebrew, no Xcode CLT prompts;
   it just downloads a self-contained arm64- (or x86_64-) native
   Python into `~/.local/share/uv/`:

   ```bash
   # One-time: install uv if missing.
   command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh

   # Install + select an arm64-native Python 3.12.
   ~/.local/bin/uv python install 3.12
   PY="$(~/.local/bin/uv python find 3.12)"
   "$PY" --version
   ```

   If the user already has a supported Python matching their CPU
   (`brew install python@3.12` on arm64 Homebrew, etc.), prefer that
   and skip the uv bootstrap:

   ```bash
   PY=$(command -v python3.12 || command -v python3.11 || command -v python3.10 || command -v python3)
   "$PY" --version
   ```

   The orchestrator prints loud warnings if the chosen Python is
   out-of-range or running under Rosetta on arm64 hardware — surface
   those warnings in your reply if you see them.

2. **Run the setup orchestrator.** From the library root:

   ```bash
   "$PY" .virgil/scripts/library/setup.py
   ```

   Pass `--force` if the user wants to reinstall / re-download everything:

   ```bash
   "$PY" .virgil/scripts/library/setup.py --force
   ```

   First run typically takes 5–15 minutes for the marker model
   download (~3 GB, depending on bandwidth). Subsequent runs are
   instant if nothing's missing.

3. **Read the script output.** It logs five steps (Step 1 prints twice):
   - Step 1: pip install, in two blocks — `(light deps)` then
     `(heavy deps)` (`setup.py`'s `LIGHT_PIP` / `HEAVY_PIP`; marker-pdf is
     heavy). Installed separately so a heavy-block failure (typically
     marker-pdf on x86_64 macOS) does not take the light block down.
   - Step 2: system binary check (tesseract)
   - Step 3: marker model pre-download
   - Step 4: manifest write
   - Step 5: model-cache verification (read in steps 4–5 below)

   If Step 2 reports missing tesseract, surface the install hint in
   your reply — the user has to run `brew install tesseract` (macOS)
   or `apt install tesseract-ocr` (Debian/Ubuntu) themselves, then
   re-run `/library/setup` to update the manifest.

4. **Read the cache verdict — don't hand-check paths.** `setup.py`'s
   Step 5 measures both library caches itself and prints one line each:

   ```
     CACHE huggingface: ok 1.1 GB at <library>/.virgil/models/huggingface
     CACHE datalab: ok 3.2 GB at <library>/.virgil/models/datalab
   ```

   A cache is `EMPTY` when it holds no file bytes (the directory always
   exists — setup creates it). An `EMPTY` cache after a run means the
   download did not land: Step 3 will show either a `PREDOWNLOAD FAILED:`
   line (quote it in your reply) or `Skipping — marker-pdf failed to
   install` (the Step 1 heavy-deps failure is the cause). To re-check
   later without installing anything:

   ```bash
   "$PY" .virgil/scripts/library/setup.py --verify-only        # add --json for the dict
   ```

   (exit 1 when either cache is empty).

5. **Report global cache pollution from the same verdict.** Step 5 also
   checks every global default either cache falls back to when its
   redirect is unset — `~/.cache/huggingface` (or
   `$XDG_CACHE_HOME/huggingface`) and surya's `~/Library/Caches/datalab`
   (or `~/.cache/datalab`) — printing `GLOBAL CACHE <name>: <size> at
   <path>` for each that holds weights, or `GLOBAL CACHE: none`.

   If a global cache is listed, those weights were downloaded outside
   the library (a previous install, or a run that skipped
   `ensure_model_env`). Nothing for this skill to do about that —
   `/library/setup` doesn't touch existing global caches — but name the
   path and size in your reply so the user can reclaim the space.

## Reply format

Three lines:
1. `Setup complete — marker-pdf <version>, ocrmypdf <version>, tesseract <version>`
2. `Models cached: huggingface <size>, datalab <size> at .virgil/models/` (from Step 5's `CACHE` lines; add `— global cache: <size> at <path>` when Step 5 lists one)
3. `Manifest: .virgil/models/manifest.json`

If anything's missing (especially tesseract on a fresh machine),
add a fourth line with the exact command the user needs to run, then
remind them to re-run `/library/setup` after installing.

If the orchestrator failed, paste the relevant traceback in a fenced
block and stop. Don't try to patch broken installs by hand — the
user needs to see the underlying pip/network error.
