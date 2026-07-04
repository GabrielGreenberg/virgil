"""I/O bridge between the pure ``work_identity`` core and the live library.

``work_identity.py`` is deliberately I/O-free and parser-free (see its module
docstring). This module supplies the missing half:

* :func:`load_library_records` — read ``master.bib`` + ``.virgil/catalog.json``
  (+ ``papers/`` folder listing) and shape them into the record dicts that
  ``WorkIndex`` / ``cluster`` / ``pick_survivor`` consume, carrying the catalog
  ``meta`` (bib state, index depth, page/pgmark counts, folder presence, sha).
* :func:`loadbearing_keys` — the catalog-citekeys ∪ ``papers/`` folder-names set
  that winner-selection must never drop.
* Alias map I/O (``.virgil/aliases.json``): the durable record of every citekey
  a de-dup collapsed into a survivor, so a later intake of the collapsed key
  resolves straight through.
* :func:`find_work_in_library` — the single **intake guard** every write path
  calls: "does the library already hold this work under a different citekey?"

Import direction is one-way: this module imports ``work_identity`` and
``_tools``; nothing in the pure core imports this. Hardening call sites import
:func:`find_work_in_library` lazily (inside the call) to avoid any import cycle
through ``_tools``.
"""

from __future__ import annotations

import json
import os
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import work_identity as wi

ALIASES_REL = os.path.join(".virgil", "aliases.json")


# ─────────────────────────────────────────────────────────────────────────
# Record loading
# ─────────────────────────────────────────────────────────────────────────


def _nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s or "")


def _authors_to_field(authors) -> str:
    """catalog ``authors`` (list[str] | str) → a bib ``author`` string."""
    if isinstance(authors, list):
        return " and ".join(a for a in authors if a)
    return str(authors or "")


def load_library_records(
    library: Path,
    *,
    master: Optional[dict] = None,
    catalog: Optional[dict] = None,
) -> list[dict]:
    """Build the full record set for the library.

    One record per master.bib entry, joined to its catalog row (if any) for
    ``meta``. Catalog rows whose citekey is absent from master.bib (a small
    data-integrity residue) are added too, synthesised from the catalog's own
    top-level ``title/authors/year/doi`` so the index is complete.

    Record shape: ``{"citekey", "type", "fields", "meta"}`` where ``meta`` has
    ``bib_state, indexed_state, pgmarkCount, pageCount, has_folder, sha256,
    added_at``.
    """
    library = Path(library)
    if master is None:
        from _tools import read_master_bib
        master = read_master_bib(library / "master.bib")
    if catalog is None:
        from _tools import read_catalog
        catalog = read_catalog(library)

    cat_by_key: dict[str, dict] = {}
    for row in catalog.get("entries", []):
        cat_by_key[_nfc(row.get("citekey", ""))] = row

    papers_dir = library / "papers"
    folders = set(os.listdir(papers_dir)) if papers_dir.is_dir() else set()
    folders_nfc = {_nfc(f) for f in folders}

    def _meta_from_row(row: dict) -> dict:
        idx = row.get("indexed") or {}
        bib = row.get("bib") or {}
        pdf = row.get("pdf") or {}
        ck = _nfc(row.get("citekey", ""))
        return {
            "bib_state": bib.get("state"),
            "indexed_state": idx.get("state"),
            "pgmarkCount": idx.get("pgmarkCount", 0) or 0,
            "pageCount": (pdf.get("pageCount", 0) or 0),
            "has_folder": ck in folders_nfc,
            "sha256": pdf.get("sha256"),
            "added_at": row.get("addedAt"),
        }

    records: list[dict] = []
    seen: set[str] = set()
    for ck, m in master.items():
        ck_nfc = _nfc(ck)
        seen.add(ck_nfc)
        row = cat_by_key.get(ck_nfc, {})
        records.append({
            "citekey": ck,
            "type": m.get("type", "misc"),
            "fields": m.get("fields", {}),
            "meta": _meta_from_row(row) if row else {
                "bib_state": None, "indexed_state": None, "pgmarkCount": 0,
                "pageCount": 0, "has_folder": ck_nfc in folders_nfc,
                "sha256": None, "added_at": None,
            },
        })

    # Catalog-only rows (citekey not in master.bib): synthesise fields.
    for row in catalog.get("entries", []):
        ck = row.get("citekey", "")
        if _nfc(ck) in seen:
            continue
        fields = {
            "title": row.get("title", "") or "",
            "author": _authors_to_field(row.get("authors")),
            "year": str(row.get("year", "") or ""),
            "doi": row.get("doi", "") or "",
        }
        records.append({
            "citekey": ck,
            "type": "misc",
            "fields": {k: v for k, v in fields.items() if v},
            "meta": _meta_from_row(row),
        })

    return records


def loadbearing_keys(library: Path, *, catalog: Optional[dict] = None) -> set[str]:
    """Citekeys that are referenced and must survive: catalog rows ∪ ``papers/``
    folder names (NFC-normalized)."""
    library = Path(library)
    if catalog is None:
        from _tools import read_catalog
        catalog = read_catalog(library)
    keys = {_nfc(r.get("citekey", "")) for r in catalog.get("entries", [])}
    papers_dir = library / "papers"
    if papers_dir.is_dir():
        keys |= {_nfc(f) for f in os.listdir(papers_dir)}
    keys.discard("")
    return keys


def build_index(library: Path, *, records: Optional[list] = None) -> "wi.WorkIndex":
    """Convenience: load records (if not supplied) and build a WorkIndex."""
    if records is None:
        records = load_library_records(library)
    return wi.WorkIndex(records)


# ─────────────────────────────────────────────────────────────────────────
# Alias map  (.virgil/aliases.json)
# ─────────────────────────────────────────────────────────────────────────


def load_aliases(library: Path) -> dict:
    """Return the alias map ``{loser_citekey: {survivor, work_key, at, reason}}``
    (empty dict if absent/unreadable)."""
    p = Path(library) / ALIASES_REL
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text())
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def save_aliases(library: Path, aliases: dict) -> None:
    """Atomically write the alias map under a sidecar lock."""
    from _tools import _atomic_write_text, _flock_path
    p = Path(library) / ALIASES_REL
    p.parent.mkdir(parents=True, exist_ok=True)
    with _flock_path(p.with_name(p.name + ".lock")):
        _atomic_write_text(p, json.dumps(aliases, indent=2, ensure_ascii=False) + "\n")


def resolve_alias(library: Path, citekey: str, *, aliases: Optional[dict] = None) -> Optional[str]:
    """If ``citekey`` was collapsed into a survivor, return the survivor (following
    chains, cycle-safe); else None."""
    if aliases is None:
        aliases = load_aliases(library)
    seen: set[str] = set()
    cur = citekey
    out = None
    while cur in aliases and cur not in seen:
        seen.add(cur)
        cur = (aliases.get(cur) or {}).get("survivor")
        if not cur:
            break
        out = cur
    return out


# ─────────────────────────────────────────────────────────────────────────
# The intake guard
# ─────────────────────────────────────────────────────────────────────────


@dataclass
class Match:
    """A guard hit: the library already holds this work under ``citekey``."""
    citekey: str
    relation: str          # "same" | "uncertain" | "alias"
    confidence: float
    reasons: list


def find_work_in_library(
    fields: dict,
    entry_type: str,
    library: Path,
    *,
    index: Optional["wi.WorkIndex"] = None,
    incoming_citekey: Optional[str] = None,
    include_uncertain: bool = True,
    exclude_ck: Optional[str] = None,
) -> Optional[Match]:
    """Does the library already hold this work under a DIFFERENT citekey?

    Resolution order:
      1. Alias map — if ``incoming_citekey`` was previously collapsed, resolve
         straight to the survivor (relation ``"alias"``).
      2. WorkIndex — the best ``same`` hit (relation ``"same"``); or, if
         ``include_uncertain``, the best ``uncertain`` hit (caller decides
         whether to flag-vs-skip).

    Returns a :class:`Match` or ``None``. Never raises on a clean miss. Builds
    the index from the library if one isn't supplied (callers doing many checks
    should pass a shared ``index`` built once).
    """
    library = Path(library)

    if incoming_citekey:
        surv = resolve_alias(library, incoming_citekey)
        if surv and surv != incoming_citekey:
            return Match(surv, "alias", 1.0, [f"alias: {incoming_citekey} → {surv}"])

    if index is None:
        index = build_index(library)

    best_same = None
    best_uncertain = None
    for ck, verdict in index.find(fields, entry_type, exclude_ck=exclude_ck):
        if verdict.relation == "same" and best_same is None:
            best_same = Match(ck, "same", verdict.confidence, list(verdict.reasons))
        elif verdict.relation == "uncertain" and best_uncertain is None:
            best_uncertain = Match(ck, "uncertain", verdict.confidence, list(verdict.reasons))
    if best_same is not None:
        return best_same
    if include_uncertain and best_uncertain is not None:
        return best_uncertain
    return None


__all__ = [
    "load_library_records",
    "loadbearing_keys",
    "build_index",
    "load_aliases",
    "save_aliases",
    "resolve_alias",
    "Match",
    "find_work_in_library",
]
