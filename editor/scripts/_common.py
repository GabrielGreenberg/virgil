"""Shared helpers for editor-side Python scripts.

These run against a user's paper folder (passed as `<docPath>` to every
script). The folder layout is:

  <doc>/
    <something>.tex          one .tex at the root; we glob to find it
    references.bib           usually present
    virgil/
      ai-requests.json       unified queue (with status field)
      bib-review-requests.json
      notes.json, todos.json, cutter.json, revisions.json, ...
      virgil.json            paragraph fingerprint map
      notifications.json     append-only inbox we write to on completion
      version.txt            single integer, bumped on every writeback

All helpers here are stdlib-only (Python 3.10+) — no third-party deps.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Paragraph UUID regex (mirrors src/lib/uuid.ts).
#
# .tex paragraphs end with `%!v:<4hex>` markers, e.g. "Some text. %!v:f1c5".
# ---------------------------------------------------------------------------

NODE_UUID_REGEX = re.compile(r"%!v:([0-9a-f]{4})")
NODE_UUID_ANCHOR = re.compile(r"^[ \t]*%!v:([0-9a-f]{4})", re.MULTILINE)


def find_paragraph_uuids(text: str) -> list[dict]:
    """Return [{uuid, line}] for every `%!v:xxxx` marker in `text`.

    Lines are 1-based to match editor conventions. The marker line is the
    line that owns the trailing `%!v:xxxx` comment — for single-line
    paragraphs `startLine == endLine`, but inline-style assignments may
    have distinct start/end (we don't reconstruct those here; the marker
    line is what cards anchor to).
    """
    out = []
    for m in NODE_UUID_REGEX.finditer(text):
        line = text.count("\n", 0, m.start()) + 1
        out.append({"uuid": m.group(1), "line": line})
    return out


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------


def resolve_doc(doc_path: str) -> Path:
    """Resolve `<docPath>` to an absolute Path. Errors if it doesn't look
    like a Virgil paper folder (no `virgil/` subdir)."""
    p = Path(doc_path).expanduser().resolve()
    if not p.is_dir():
        die(f"docPath is not a directory: {p}")
    if not (p / "virgil").is_dir():
        die(f"docPath has no virgil/ subdir: {p}")
    return p


def find_tex_file(doc: Path) -> Path:
    """Find the doc's main .tex file. Errors if not exactly one .tex sits
    at the folder root."""
    candidates = sorted([f for f in doc.iterdir() if f.suffix == ".tex"])
    if len(candidates) == 0:
        die(f"no .tex file found in {doc}")
    if len(candidates) == 1:
        return candidates[0]
    # Heuristics matching storage-fsa.ts resolveBibFilename:
    stem = doc.name
    by_stem = [c for c in candidates if c.stem == stem]
    if by_stem:
        return by_stem[0]
    for preferred in ("main.tex", "document.tex"):
        for c in candidates:
            if c.name == preferred:
                return c
    return candidates[0]


def find_bib_file(doc: Path) -> Path | None:
    """Find the references .bib for the doc, or None if absent."""
    tex = find_tex_file(doc)
    text = tex.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"\\(?:bibliography|addbibresource)\{([^}]+)\}", text)
    if m:
        name = m.group(1).strip()
        if not name.endswith(".bib"):
            name += ".bib"
        cand = doc / name
        if cand.exists():
            return cand
    bibs = sorted([f for f in doc.iterdir() if f.suffix == ".bib"])
    if len(bibs) == 1:
        return bibs[0]
    if len(bibs) > 1:
        stem_match = next((b for b in bibs if b.stem == tex.stem), None)
        return stem_match or bibs[0]
    return None


def virgil_dir(doc: Path) -> Path:
    return doc / "virgil"


def sidecar(doc: Path, name: str) -> Path:
    return virgil_dir(doc) / name


# ---------------------------------------------------------------------------
# JSON I/O
# ---------------------------------------------------------------------------


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        die(f"invalid JSON in {path}: {e}")


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# Card → paragraph helpers (mirrors src/links/links.ts).
# ---------------------------------------------------------------------------


def card_paragraph_ids(card: dict) -> list[str]:
    """Pull paragraphIds from a card's links array. Mirrors
    `getLinkedParagraphIds()` in src/links/links.ts."""
    out: list[str] = []
    for link in card.get("links", []) or []:
        anchor = link.get("anchor") or {}
        if anchor.get("type") == "anchor":
            for pid in anchor.get("paragraphIds", []) or []:
                if pid not in out:
                    out.append(pid)
    return out


def card_text_anchor(card: dict) -> str | None:
    """Mode B text snapshot if any."""
    for link in card.get("links", []) or []:
        anchor = link.get("anchor") or {}
        tr = anchor.get("textRange")
        if isinstance(tr, dict) and tr.get("textSnapshot"):
            return tr["textSnapshot"]
    return None


# ---------------------------------------------------------------------------
# Notification + version writers
# ---------------------------------------------------------------------------


def append_notification(doc: Path, item: dict) -> None:
    path = sidecar(doc, "notifications.json")
    inbox = read_json(path, default={"items": []}) or {"items": []}
    items = inbox.get("items", []) if isinstance(inbox, dict) else []
    items.append(item)
    # Cap at 200 items so the file doesn't grow unbounded.
    if len(items) > 200:
        items = items[-200:]
    write_json(path, {"items": items})


def bump_version(doc: Path) -> int:
    path = sidecar(doc, "version.txt")
    n = 0
    if path.exists():
        try:
            n = int(path.read_text(encoding="utf-8").strip() or "0")
        except ValueError:
            n = 0
    n += 1
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(n) + "\n", encoding="utf-8")
    return n


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


def die(msg: str, code: int = 2) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


# ---------------------------------------------------------------------------
# ISO timestamp
# ---------------------------------------------------------------------------


def now_iso() -> str:
    from datetime import datetime, timezone

    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )
