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
- **Model cache**: marker's ~1 GB of ML weights land in
  `<library>/.virgil/models/huggingface/` (not `~/.cache/huggingface/`).
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
   download (~1 GB, depending on bandwidth). Subsequent runs are
   instant if nothing's missing.

3. **Read the script output.** It logs four steps:
   - Step 1: pip installs (marker-pdf, ocrmypdf)
   - Step 2: system binary check (tesseract)
   - Step 3: marker model pre-download
   - Step 4: manifest write

   If Step 2 reports missing tesseract, surface the install hint in
   your reply — the user has to run `brew install tesseract` (macOS)
   or `apt install tesseract-ocr` (Debian/Ubuntu) themselves, then
   re-run `/library/setup` to update the manifest.

4. **Verify the cache landed in the right place.**

   ```bash
   ls -lh .virgil/models/huggingface/ 2>/dev/null | head -10
   du -sh .virgil/models/ 2>/dev/null
   ```

   Expect a populated `.virgil/models/huggingface/` directory in the
   hundreds-of-MB to GB range. If it's empty or missing, the
   pre-download failed silently — note it in your reply and check
   the script output for errors.

5. **Confirm no global cache pollution.**

   ```bash
   du -sh ~/.cache/huggingface/ 2>/dev/null || echo "  (no global cache — good)"
   ```

   If a global cache exists and is large, the user previously
   downloaded marker models there. Nothing for this skill to do
   about that — `/library/setup` doesn't touch existing global
   caches, just stamps the library-local one for future use.

## Reply format

Three lines:
1. `Setup complete — marker-pdf <version>, ocrmypdf <version>, tesseract <version>`
2. `Models cached: <size> at .virgil/models/huggingface/`
3. `Manifest: .virgil/models/manifest.json`

If anything's missing (especially tesseract on a fresh machine),
add a fourth line with the exact command the user needs to run, then
remind them to re-run `/library/setup` after installing.

If the orchestrator failed, paste the relevant traceback in a fenced
block and stop. Don't try to patch broken installs by hand — the
user needs to see the underlying pip/network error.
