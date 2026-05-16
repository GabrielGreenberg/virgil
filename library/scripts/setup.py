#!/usr/bin/env python3
"""Eager setup for a Virgil Library's heavy extraction tools.

Installs `marker-pdf` and `ocrmypdf`, verifies `tesseract` is present
(system binary — not pip-installable), pre-downloads marker's ML
models into `<library>/.virgil/models/huggingface/` so they're cached
inside the library instead of polluting the user's global
`~/.cache/huggingface/`, then writes a manifest at
`<library>/.virgil/models/manifest.json` recording versions + paths.

Idempotent: re-running detects the existing manifest and only
installs/downloads what's missing or stale. Pass `--force` to redo
everything from scratch.

CLI:

  python3 setup.py [<library>] [--force]

`<library>` defaults to CWD. The standard skill bootstrap (see
`library/skills/library-setup.md`) cd's into the library root first
so the arg can be omitted in normal use.

Design notes:

- Pip installs use `--user --break-system-packages`, matching the
  convention in `library/CLAUDE.md`. This sidesteps the Homebrew
  Python "externally managed" guard without requiring a venv.
- Tesseract is a system binary; we don't try to brew/apt it
  ourselves. We surface a clear install hint and continue — a
  partial setup is better than no setup, and the user can rerun
  after `brew install tesseract`.
- Two caches get redirected into the library — both must be set
  before any marker / surya import:
    * `HF_HOME` + `TRANSFORMERS_CACHE` → marker's huggingface_hub
      downloads land in `<library>/.virgil/models/huggingface/`.
    * `MODEL_CACHE_DIR` → surya-ocr's pydantic-settings reads this
      and stamps `<library>/.virgil/models/datalab/<model>/<date>/`
      for the bulk (~3 GB) of marker's footprint. Surya does NOT
      respect HF_HOME — it defaults via `platformdirs.user_cache_dir`
      and dumps weights into `~/Library/Caches/datalab/` otherwise.
  Every script that imports marker (extract.py, etc.) must call
  `_tools.ensure_model_env(library)` first to set both env vars.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).parent))
from _tools import (  # noqa: E402
    _atomic_write_text,
    _now,
    datalab_cache_dir,
    ensure_model_env,
    hf_cache_dir,
)


MANIFEST_SCHEMA = 1
MANIFEST_REL_PATH = ".virgil/models/manifest.json"

# Python versions with prebuilt marker-pdf (and its scikit-learn / torch
# pin) wheels on PyPI. Versions outside this range force pip to build
# from source, which has historically broken on yanked build-deps
# (e.g. scikit-learn 1.4.2's `numpy==2.0.0rc1` build requirement). Update
# this when marker's deps ship wheels for newer interpreters.
SUPPORTED_PY_MIN = (3, 10)
SUPPORTED_PY_MAX = (3, 12)

# pip package name (with version constraint) → importable module name
# used as the "is this installed?" probe.
#
# Split into LIGHT and HEAVY because pip's transaction is all-or-nothing:
# if HEAVY fails (e.g., marker-pdf>=1.0 hitting ResolutionImpossible on
# x86_64 macOS where torch>=2.5 has no wheel), we still want the LIGHT
# deps to land so the rest of the indexing pipeline can run with the
# explicit `--extractor pymupdf` fallback path.
#
# `marker-pdf>=1.0` is load-bearing: marker pre-1.0 has a completely
# different module layout (no `marker.converters`, no
# `marker.renderers.json.JSONRenderer`) so our Phase 3 structured walker
# can't drive it. Without the >=1.0 pin, pip's resolver happily
# backtracks to marker-pdf 0.2.6 on any platform where torch>=2.5
# isn't installable.
#
# The marker probe is `marker.converters` (a submodule unique to 1.x),
# not bare `marker`. This way an already-installed marker 0.2.6 doesn't
# fool the manifest into reporting `installed: true`.
LIGHT_PIP: dict[str, str] = {
    "PyMuPDF>=1.24": "fitz",
    "requests>=2.31": "requests",
    "rapidfuzz>=3.5": "rapidfuzz",
    "python-docx>=1.1": "docx",
}
HEAVY_PIP: dict[str, str] = {
    "marker-pdf>=1.0": "marker.converters",
    "ocrmypdf>=16.0": "ocrmypdf",
}
PIP_PACKAGES: dict[str, str] = {**LIGHT_PIP, **HEAVY_PIP}


def _pip_name(spec: str) -> str:
    """Strip a version constraint off a pip-style spec ('marker-pdf>=1.0' → 'marker-pdf')."""
    for sep in (">=", "<=", "==", ">", "<", "!=", "~="):
        if sep in spec:
            return spec.split(sep, 1)[0].strip()
    return spec.strip()


def _safe_find_spec(modname: str) -> bool:
    """`importlib.util.find_spec` raises ModuleNotFoundError when a parent
    package along the dotted path is missing (instead of returning None).
    Wrap it so the install detection treats "parent missing" the same as
    "module missing"."""
    try:
        return importlib.util.find_spec(modname) is not None
    except (ImportError, ValueError):
        return False

# System binaries we can't install via pip. Hint is shown verbatim when missing.
SYSTEM_BINARIES: dict[str, str] = {
    "tesseract": "brew install tesseract  (macOS) | apt install tesseract-ocr  (Debian/Ubuntu)",
}


def _pkg_version(pip_name: str) -> Optional[str]:
    """Return the installed version of a pip package, or None if not present.

    Uses `importlib.metadata` so we don't have to import the heavy module.
    """
    try:
        from importlib.metadata import PackageNotFoundError, version
    except ImportError:
        return None
    try:
        return version(pip_name)
    except PackageNotFoundError:
        return None
    except Exception:
        return None


def _system_tool_version(binary: str) -> Optional[str]:
    """Best-effort version string from `<binary> --version`. None if missing."""
    if shutil.which(binary) is None:
        return None
    try:
        r = subprocess.run(
            [binary, "--version"], capture_output=True, text=True, timeout=10
        )
        out = (r.stdout + r.stderr).strip().splitlines()
        return out[0] if out else "unknown"
    except Exception:
        return "unknown"


def _tool_entry(*, installed: bool, pip_name: str) -> dict:
    """Manifest row for a pip-installed tool. Only reports `version` when
    `installed` is true — otherwise a stale uninstalled-but-metadata-
    lingering entry could fool the manifest into reporting a version
    for something the import probe just said wasn't there."""
    return {
        "installed": installed,
        "version": _pkg_version(pip_name) if installed else None,
    }


def _is_externally_managed() -> bool:
    """True iff the running Python carries the PEP 668 EXTERNALLY-MANAGED
    marker (Homebrew, uv-managed, or system Python on modern macOS /
    Debian). For those interpreters we need `--break-system-packages`;
    for genuine venv Pythons we don't (and adding the flag can land
    packages in the wrong place)."""
    import sysconfig
    # PEP 668: marker lives inside the stdlib dir, not its parent.
    stdlib = Path(sysconfig.get_paths().get("stdlib", ""))
    if (stdlib / "EXTERNALLY-MANAGED").exists():
        return True
    # Inside a venv, sys.prefix != sys.base_prefix and EXTERNALLY-MANAGED
    # is shadowed — pip happily installs.
    return False


def _in_venv() -> bool:
    """True if the running Python is inside a venv (sys.prefix differs
    from base_prefix). pip in a venv ignores any inherited
    EXTERNALLY-MANAGED marker."""
    return sys.prefix != getattr(sys, "base_prefix", sys.prefix)


def _pip_install(packages: list[str]) -> None:
    """Install via pip, choosing flags based on the interpreter.

    `--user --break-system-packages` is the documented PEP 668 escape
    hatch for both Homebrew Python and uv-managed Python. After install,
    user-site may not be on sys.path yet (Python only adds it at startup
    if the dir already exists), so the caller must `_refresh_sys_path()`
    before the subsequent find_spec checks.
    """
    cmd = [sys.executable, "-m", "pip", "install"]
    if _is_externally_managed() and not _in_venv():
        cmd += ["--user", "--break-system-packages"]
    cmd += packages
    print(f"  $ {' '.join(cmd)}")
    subprocess.run(cmd, check=True)


def _refresh_sys_path() -> None:
    """Append user-site to sys.path so find_spec picks up freshly-installed
    --user packages. site.getusersitepackages() returns the user-site
    path regardless of whether it was on the path at interpreter startup
    (which it isn't if the dir was created mid-run by pip install)."""
    import site
    user_site = site.getusersitepackages()
    if user_site and user_site not in sys.path:
        sys.path.insert(0, user_site)
    importlib.invalidate_caches()


def _install_block(packages: dict[str, str], *, force: bool) -> None:
    """Install one of the PIP_PACKAGES sub-blocks (LIGHT or HEAVY).

    Skips when all module probes already resolve and `force` is false.
    Invalidates the importer cache on success so the manifest-write
    step's find_spec checks see the freshly-installed modules.
    """
    missing = [spec for spec, mod in packages.items() if not _safe_find_spec(mod)]
    if not missing and not force:
        print("  All present — skipping.")
        return
    targets = list(packages.keys()) if force else missing
    print(f"  Installing: {targets}")
    try:
        _pip_install(targets)
        _refresh_sys_path()
    except subprocess.CalledProcessError as e:
        print(f"  PIP INSTALL FAILED: {e}")
        print("  Continuing — manifest will record what's installed.")


def _predownload_marker(library: Path) -> None:
    """Force marker to materialize its weights inside the library cache.

    Caller must have called `ensure_model_env(library)` first so HF_HOME
    and MODEL_CACHE_DIR are set before any marker / surya / huggingface
    import. Imports `marker.models` (which triggers
    `surya.settings.Settings()`, which reads MODEL_CACHE_DIR via
    pydantic-settings at import time).
    """
    hf = hf_cache_dir(library)
    datalab = datalab_cache_dir(library)
    assert os.environ.get("HF_HOME") == str(hf), (
        "HF_HOME must point at the library cache before predownload"
    )
    assert os.environ.get("MODEL_CACHE_DIR") == str(datalab), (
        "MODEL_CACHE_DIR must point at the library cache before predownload"
    )
    print(f"  Materializing marker weights into {library}/.virgil/models/")
    print("  (first run only — typically 5-15 minutes for ~3 GB)")
    from marker.models import create_model_dict  # type: ignore
    _ = create_model_dict()
    print("  Done.")


def _check_python_version() -> None:
    """Warn loudly if the current Python is outside marker's wheel range.

    Doesn't bail — the user might have a working alternate config (custom
    wheels, conda env, etc.) — but the next pip-install failure won't
    look mysterious if they did hit the source-build wall.
    """
    cur = sys.version_info[:2]
    if SUPPORTED_PY_MIN <= cur <= SUPPORTED_PY_MAX:
        return
    cur_s = f"{cur[0]}.{cur[1]}"
    min_s = f"{SUPPORTED_PY_MIN[0]}.{SUPPORTED_PY_MIN[1]}"
    max_s = f"{SUPPORTED_PY_MAX[0]}.{SUPPORTED_PY_MAX[1]}"
    # Try to locate a supported interpreter for a helpful hint.
    hint = ""
    for v in (f"3.{n}" for n in range(SUPPORTED_PY_MAX[1], SUPPORTED_PY_MIN[1] - 1, -1)):
        if shutil.which(f"python{v}"):
            hint = f"  Found python{v} on PATH — rerun: python{v} {Path(__file__).name}"
            break
    print()
    print(f"WARNING: Python {cur_s} is outside marker-pdf's tested range "
          f"({min_s}-{max_s}).")
    print("  marker-pdf and scikit-learn don't yet ship prebuilt wheels for "
          "this version,")
    print("  so pip will try to build them from source — historically that "
          "fails on")
    print("  yanked build-time numpy pins. If the pip step below errors, "
          "retry with")
    print("  a supported interpreter:")
    if hint:
        print(hint)
    else:
        print(f"    brew install python@{max_s} && "
              f"python{max_s} {Path(__file__).name}")
    print()


def _check_macos_arch() -> None:
    """On Apple Silicon, warn when running an x86_64 Python under Rosetta.

    marker-pdf >= 1.0 requires `torch >= 2.5.1`, and torch's macOS x86_64
    wheels stopped at 2.2.2 — so an Intel-built Python (even on an
    arm64 Mac via Rosetta) cannot install modern marker via pip. Our
    requirements.txt pins `marker-pdf>=1.0` precisely so pip raises
    ResolutionImpossible here instead of silently falling back to the
    incompatible marker-pdf 0.2.6.

    Detection: Rosetta-translated processes return "1" from
    `sysctl sysctl.proc_translated` even though `uname -m` and
    `platform.machine()` lie and report `x86_64`. `hw.optional.arm64`
    is the hardware truth.
    """
    if sys.platform != "darwin":
        return

    def _sysctl(name: str) -> str:
        try:
            r = subprocess.run(
                ["sysctl", "-n", name], capture_output=True, text=True, timeout=5
            )
            return r.stdout.strip()
        except Exception:
            return ""

    translated = _sysctl("sysctl.proc_translated") == "1"
    arm64_hw = _sysctl("hw.optional.arm64") == "1"
    if arm64_hw and translated:
        print()
        print("WARNING: Apple Silicon Mac, but this Python is x86_64 "
              "(running under Rosetta).")
        print("  marker-pdf >= 1.0 requires torch >= 2.5.1, and torch's macOS")
        print("  x86_64 wheels stopped at 2.2.2 — the pip install below will")
        print("  fail with ResolutionImpossible.")
        print()
        print("  Fix: install arm64-native Homebrew + Python.")
        print("    Open Terminal in *native* mode (not Rosetta), then:")
        print('      /bin/bash -c "$(curl -fsSL '
              'https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"')
        print("    Then:")
        print("      /opt/homebrew/bin/brew install python@3.12 tesseract")
        print(f"      /opt/homebrew/bin/python3.12 {Path(__file__).name}")
        print()


def run_setup(library: Path, *, force: bool = False) -> dict:
    """Install heavy tools and pre-download models. Returns the new manifest."""
    library = library.expanduser().resolve()
    if not (library / ".virgil").exists():
        raise SystemExit(
            f"{library} doesn't look like a Virgil Library "
            f"(no .virgil/ directory). Cd into the library root first."
        )

    _check_python_version()
    _check_macos_arch()

    models_root = library / ".virgil" / "models"
    models_root.mkdir(parents=True, exist_ok=True)
    manifest_path = library / MANIFEST_REL_PATH

    print(f"Virgil Library setup → {library}")
    print(f"  Model cache: {models_root}")
    print(f"    huggingface/ — marker text/layout weights via huggingface_hub")
    print(f"    datalab/     — surya-ocr layout/table/OCR weights (~3 GB)")
    print()

    # 1. Install pip packages. Two passes so a failure in the heavy
    # block (typically marker-pdf>=1.0 hitting ResolutionImpossible on
    # x86_64 macOS) doesn't take the light block down with it.
    print("Step 1: pip install (light deps)")
    _install_block(LIGHT_PIP, force=force)
    print()
    print("Step 1: pip install (heavy deps)")
    _install_block(HEAVY_PIP, force=force)
    print()

    # 2. Check system binaries; we don't auto-install these.
    print("Step 2: system binaries")
    missing_system: list[tuple[str, str]] = []
    for binary, install_hint in SYSTEM_BINARIES.items():
        if shutil.which(binary) is None:
            missing_system.append((binary, install_hint))
    if missing_system:
        print("  Missing — install manually then re-run /library/setup:")
        for binary, hint in missing_system:
            print(f"    {binary}: {hint}")
    else:
        print("  All system binaries present.")
    print()

    # 3. Pre-download marker weights into the library-local caches.
    # ensure_model_env() sets HF_HOME + TRANSFORMERS_CACHE + MODEL_CACHE_DIR
    # so huggingface_hub AND surya-ocr's pydantic-settings BOTH land
    # their downloads in <library>/.virgil/models/. Without
    # MODEL_CACHE_DIR, surya's ~3 GB of weights still go to
    # ~/Library/Caches/datalab/ (surya defaults via platformdirs and
    # doesn't read HF_HOME).
    print("Step 3: pre-download marker models")
    ensure_model_env(library)
    marker_present = _safe_find_spec("marker.converters")
    datalab = datalab_cache_dir(library)
    if not marker_present:
        print("  Skipping — marker-pdf failed to install (see step 1).")
    else:
        already_cached = datalab.exists() and any(datalab.iterdir())
        if already_cached and not force:
            print(f"  Already cached at {datalab}; skipping download.")
        else:
            try:
                _predownload_marker(library)
            except Exception as e:
                print(f"  PREDOWNLOAD FAILED: {e}")
                print("  Models will download on first index instead.")
    print()

    # 4. Write the manifest.
    print("Step 4: write manifest")
    manifest = {
        "schemaVersion": MANIFEST_SCHEMA,
        "setupAt": _now(),
        "library": str(library),
        "modelsCache": str(models_root),
        "huggingfaceCache": str(hf_cache_dir(library)),
        "datalabCache": str(datalab_cache_dir(library)),
        "tools": {
            "marker-pdf": _tool_entry(
                installed=_safe_find_spec("marker.converters"),
                pip_name="marker-pdf",
            ),
            "ocrmypdf": _tool_entry(
                installed=_safe_find_spec("ocrmypdf"),
                pip_name="ocrmypdf",
            ),
            "tesseract": {
                "installed": shutil.which("tesseract") is not None,
                "version": _system_tool_version("tesseract"),
                "system": True,
            },
            "pymupdf": _tool_entry(
                installed=_safe_find_spec("fitz"),
                pip_name="PyMuPDF",
            ),
        },
    }
    _atomic_write_text(manifest_path, json.dumps(manifest, indent=2) + "\n")
    print(f"  Wrote {manifest_path}")
    return manifest


def _summary_line(manifest: dict) -> str:
    tools = manifest["tools"]
    parts = []
    for name, info in tools.items():
        status = "ok" if info["installed"] else "MISSING"
        parts.append(f"{name}={status}")
    return "  " + ", ".join(parts)


def _main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        description="Eagerly install heavy extraction tools for a Virgil Library."
    )
    ap.add_argument(
        "library", nargs="?", default=".",
        help="Library root (defaults to CWD)",
    )
    ap.add_argument(
        "--force", action="store_true",
        help="Reinstall + redownload even if already present",
    )
    args = ap.parse_args(argv)
    manifest = run_setup(Path(args.library), force=args.force)

    print()
    print("Summary:")
    print(_summary_line(manifest))
    print()
    missing = [n for n, t in manifest["tools"].items() if not t["installed"]]
    if missing:
        print(f"SETUP INCOMPLETE — missing: {', '.join(missing)}")
        print("Install the missing tools manually and re-run.")
        return 1
    print("SETUP COMPLETE — all heavy tools cached inside the library.")
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
