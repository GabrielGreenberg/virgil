"""Merge one library paper's `references.bib` into `master.bib`.

Per-paper unit of work for `/library/merge-bibs`. The orchestrator skill
spawns one subagent per paper that runs this script and reads the JSON
report it produces. All the heavy lifting (duplicate detection,
authentication, transient-skip, locked master.bib + catalog writes) lives
here so the subagent's AI time is minimal.

Rules (see plan):
  1. Dup against authenticated/canonical master → defer to master, skip.
  2. Dup against unauth master → authenticate using collective fields
     from both. If they resolve to the same work, fold the authenticated
     fields back under the master citekey. If they resolve to distinct
     works, split: authenticate each side independently and keep both.
  3. No dup, entry has transient markers (@unpublished, year=forthcoming
     /in press/to appear/manuscript/ms.) → skip.
  4. No dup, otherwise → write to master as unverified, authenticate.
     If auth comes back `manuscript` (late-detected transient), roll
     back. Otherwise keep with whatever state auth produced.

CLI:
    python3 merge_paper_references.py <citekey> [--dry-run]
                                                [--library PATH]
                                                [--report-dir PATH]

Output:
    .virgil/merge-reports/<citekey>.json  (default location)
    One-line summary on stdout: "+A ~D ⇄U ⤬T ⚠F ?M"
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))

from _bib_parse import read_bib_file  # noqa: E402
from _tools import (  # noqa: E402
    TERMINAL_BIB_STATES,
    admit_catalog_row,
    append_inbox_item,
    citekey_matches,
    lock_catalog,
    is_terminal_bib_state,
    lock_master_bib,
    mark_bib_imported,
    master_bib_state_map,
    normalize_citekey,
    read_catalog,
    read_master_bib,
    resolve_bib_state,
    update_master_bib_entry,
    upsert_catalog_entry,
    write_catalog,
    _atomic_write_text,
    _now,
)

# bib_auth is heavy (network); import lazily so --dry-run can skip it.


# ── helpers ───────────────────────────────────────────────────────────


TRANSIENT_MARKERS = (
    "forthcoming",
    "in press",
    "to appear",
    "manuscript",
    "ms.",
    "draft",
    "submitted",
    "under review",
)

# Word-stopper regex for the cheap (b. -> ms.) marker. Match the markers
# as whole tokens — `ms.` shouldn't fire on "filmmaker" etc.
_TRANSIENT_RX = re.compile(
    r"(?:^|[\s,;:])(?:" + "|".join(re.escape(m) for m in TRANSIENT_MARKERS) + r")(?:$|[\s,.;:])",
    re.IGNORECASE,
)


def _strip_braces(s: str) -> str:
    """{Some Title} → Some Title. Leaves balanced inner braces alone."""
    s = s.strip()
    while len(s) > 1 and s.startswith("{") and s.endswith("}"):
        s = s[1:-1].strip()
    return s


def _norm_title(s: str) -> str:
    """Lowercase, drop punctuation, collapse whitespace. For fuzzy match."""
    s = unicodedata.normalize("NFKD", _strip_braces(s)).lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _first_author_surname(author_field: str) -> str:
    """Pull the surname of the first author from a bib `author` field."""
    if not author_field:
        return ""
    first = re.split(r"\s+and\s+", author_field.strip(), maxsplit=1)[0]
    first = _strip_braces(first).strip()
    if "," in first:
        # "Smith, Jane" — surname before the comma
        return _norm_title(first.split(",", 1)[0])
    parts = first.split()
    return _norm_title(parts[-1]) if parts else ""


def _split_authors(author_field: str) -> list[str]:
    """`Smith, J. and Doe, J.` → ['Smith, J.', 'Doe, J.']."""
    if not author_field:
        return []
    return [a.strip() for a in re.split(r"\s+and\s+", author_field.strip()) if a.strip()]


def _normalize_doi(doi: str) -> str:
    """Lowercase, strip leading http(s)://doi.org/, strip whitespace."""
    if not doi:
        return ""
    s = doi.strip().lower()
    s = re.sub(r"^https?://(dx\.)?doi\.org/", "", s)
    return s.strip()


def _normalize_isbn(isbn: str) -> str:
    """Strip hyphens, spaces, lowercase. Keep just the digits + X."""
    if not isbn:
        return ""
    return re.sub(r"[^0-9xX]", "", isbn).lower()


def is_transient(entry: dict) -> tuple[bool, str]:
    """Return (is_transient, reason). Transient = won't yield to canonical
    auth right now (manuscript, forthcoming, in press, etc.)."""
    if entry.get("type") == "unpublished":
        return True, "entry_type=unpublished"
    fields = entry.get("fields", {})
    for key in ("year", "date", "note", "howpublished"):
        v = fields.get(key, "")
        if v and _TRANSIENT_RX.search(v):
            return True, f"{key}={v!r}"
    return False, ""


# ── duplicate detection ───────────────────────────────────────────────


def build_work_index(master: dict):
    """Build a `work_identity.WorkIndex` over the whole master.bib ONCE per run.

    Threaded into `find_duplicate` so the O(N) per-entry re-scan of master is
    replaced by a single index build + near-linear candidate lookups. Lazily
    imports `work_identity` at call time to avoid any import-cycle surprise and
    to keep the module importable even where the core isn't on the path.
    """
    import work_identity as wi

    records = [
        {"citekey": ck, "type": m.get("type", "misc"), "fields": m.get("fields", {})}
        for ck, m in master.items()
    ]
    return wi.WorkIndex(records)


def find_duplicate(
    entry: dict,
    master: dict,
    catalog_index: dict,
    *,
    work_index=None,
    library: Path | None = None,
    master_states: dict[str, str] | None = None,
) -> dict | None:
    """Locate a master.bib entry that already represents this work.

    Resolution order (first match wins):
      1. Exact citekey match (NFC-normalized) — cheap and authoritative.
      2. Work-identity `classify` via a shared `WorkIndex`:
           * a `same` verdict → duplicate found (returns the shaped record);
           * an `uncertain` verdict → routed to the report's `manual_review`
             bucket (this function returns None so the caller processes the
             entry as no-dup, but the ambiguity is recorded);
           * `distinct` → no dup.

    This WIDENS the old bespoke 4-stage matcher: the previous fuzzy stage
    required an EXACT (title, year, surname) triple, so year-drift (reprints,
    preprint vs published) and fuzzy title variants slipped through. Delegating
    to `work_identity` catches those (Rules C/D + the E/F uncertain tiers).

    `work_index` is a `WorkIndex` built ONCE per run (via `build_work_index`)
    and threaded in — the function no longer re-reads/re-scans master per entry.
    When omitted (legacy callers / tests), it is built from `master` on demand.

    `master_states` is the F#4 auth-state map for the SAME master.bib read
    (`master_bib_state_map`), threaded in so `_shape` answers from the state's
    HOME rather than from a catalog row that a fileless entry does not have
    (task 442). Omitted (legacy callers / tests) it is derived from `library`.

    Returns the master entry dict (with extra `citekey` and `bib_state` keys
    resolved through `resolve_bib_state`) or None. On an `uncertain` hit, records a
    `manual_review` note against the module-level `_UNCERTAIN_SINK` list if the
    caller registered one (`main()` points it at the run's Report).
    """
    import work_identity as wi

    e_fields = entry.get("fields", {})
    e_type = entry.get("type", "misc")
    e_ck = entry.get("citekey", "")

    states = master_states
    if states is None:
        master_path = (library or Path(".")) / "master.bib"
        states = master_bib_state_map(
            master_path.read_text() if master_path.exists() else ""
        )

    # Build a uniform lookup record per master citekey. The auth state comes
    # from the ONE door (master.bib's `% bib.state` comment first, a legacy
    # catalog row second) — never from the catalog alone, which cannot answer
    # for the 85% of the corpus that is fileless.
    cat_view = {"entries": list(catalog_index.values())}

    def _shape(ck: str) -> dict:
        m = master[ck]
        return {
            "citekey": ck,
            "type": m["type"],
            "fields": m["fields"],
            "bib_state": resolve_bib_state(
                library or Path("."), ck,
                master_states=states, catalog=cat_view,
            ),
        }

    # 1. Exact citekey — keep the cheap authoritative short-circuit.
    for ck in master:
        if citekey_matches(ck, e_ck):
            return _shape(ck)

    # 2. Work-identity delegation via the shared index.
    if work_index is None:
        work_index = build_work_index(master)

    matches = work_index.find(e_fields, e_type, exclude_ck=e_ck)
    best_same = None
    best_uncertain = None
    for ck, verdict in matches:
        if ck not in master:
            # Defensive: the index may hold catalog-only rows in other callers;
            # here it's built from master so this should not happen. Skip if so.
            continue
        if verdict.relation == "same" and best_same is None:
            best_same = (ck, verdict)
        elif verdict.relation == "uncertain" and best_uncertain is None:
            best_uncertain = (ck, verdict)

    if best_same is not None:
        return _shape(best_same[0])

    if best_uncertain is not None and _UNCERTAIN_SINK is not None:
        ck, verdict = best_uncertain
        _UNCERTAIN_SINK.append({
            "type": "uncertain_work_match",
            "paper_entry": e_ck,
            "master_entry": ck,
            "confidence": verdict.confidence,
            "reasons": list(verdict.reasons),
        })

    return None


#: Optional module-level sink for `uncertain` verdicts surfaced by
#: `find_duplicate`. The top-level `main()` points this at the run's Report so
#: fuzzy-but-not-certain matches land in the `manual_review` bucket instead of
#: being silently treated as no-dup. Kept module-level (not a param) so the
#: function's return contract — `dict | None` — is unchanged for every caller.
_UNCERTAIN_SINK: list | None = None


# ── field merging + auth-result application ───────────────────────────


def merge_fields(d: dict, e: dict) -> dict:
    """Pick non-empty values; on conflict prefer the side with more info.

    Heuristic: presence of DOI > absence; longer title > shorter; longer
    author list > shorter; else prefer d. Conservative — we only use the
    output as input to bib_auth.authenticate(), not as the persisted bib.
    """
    out: dict[str, str] = {}
    for key in set(d) | set(e):
        dv = (d.get(key) or "").strip()
        ev = (e.get(key) or "").strip()
        if not dv:
            out[key] = ev
            continue
        if not ev:
            out[key] = dv
            continue
        if dv == ev:
            out[key] = dv
            continue
        # Conflict.
        if key == "doi":
            # Prefer whichever has a fuller-looking DOI; both being present
            # and different is itself a signal these may be distinct works
            # (caller handles split via same_work() check).
            out[key] = dv if len(dv) >= len(ev) else ev
        elif key == "title":
            out[key] = dv if len(dv) >= len(ev) else ev
        elif key == "author":
            d_authors = _split_authors(dv)
            e_authors = _split_authors(ev)
            out[key] = dv if len(d_authors) >= len(e_authors) else ev
        else:
            out[key] = dv  # default: prefer master side
    return out


def apply_field_changes(fields: dict, changes: list[dict]) -> dict:
    """Apply an AuthResult.field_changes list onto a fields dict.

    `field_changes` are `{field, from, to, source, at}` records; we use
    the `to` value verbatim. No filtering — that's a job for
    /authenticate-bib's human pass when needed.
    """
    out = dict(fields)
    for c in changes:
        fld = c.get("field")
        new = c.get("to")
        if fld and new is not None:
            out[fld] = new
    return out


def same_work(auth_record: dict, d_fields: dict, e_fields: dict) -> bool:
    """Decide whether the authenticated record represents the same work
    as BOTH `d` and `e`. If only one side matches, the other is distinct
    and the caller should split.
    """
    auth_doi = _normalize_doi(auth_record.get("doi", "") if auth_record else "")
    d_doi = _normalize_doi(d_fields.get("doi", ""))
    e_doi = _normalize_doi(e_fields.get("doi", ""))

    # DOI evidence is dispositive.
    if auth_doi and (d_doi or e_doi):
        d_hit = (not d_doi) or auth_doi == d_doi
        e_hit = (not e_doi) or auth_doi == e_doi
        return d_hit and e_hit

    # Otherwise compare normalized titles.
    auth_title = _norm_title(auth_record.get("title", "") if auth_record else "")
    if not auth_title:
        return False
    d_title = _norm_title(d_fields.get("title", ""))
    e_title = _norm_title(e_fields.get("title", ""))
    # Cheap Jaccard over word sets — a real-world entry-with-typo passes.
    def jacc(a: str, b: str) -> float:
        wa, wb = set(a.split()), set(b.split())
        if not wa or not wb:
            return 0.0
        return len(wa & wb) / len(wa | wb)

    return jacc(auth_title, d_title) >= 0.7 and jacc(auth_title, e_title) >= 0.7


# ── auth wrapper ──────────────────────────────────────────────────────


def _do_authenticate(library: Path, citekey: str, entry_type: str, fields: dict):
    """Call bib_auth.authenticate() and return the AuthResult.

    Imported lazily because bib_auth pulls in requests + rapidfuzz.
    """
    from bib_auth import authenticate
    title = _strip_braces(fields.get("title", ""))
    authors = _split_authors(fields.get("author", ""))
    return authenticate(
        title, authors, fields,
        entry_type=entry_type,
        library=library,
        citekey=citekey,
    )


# ── master.bib write helpers ──────────────────────────────────────────


def _write_master(library: Path, citekey: str, entry_type: str,
                  fields: dict, state: str) -> None:
    """Write the entry, but NEVER downgrade a settled one.

    Belt and braces beside the read fix (task 442): with `bib_state` resolved
    from its F#4 home, a terminal master entry is deferred to and this path is
    not reached for it at all. It is reached legitimately when an entry that
    was terminal a moment ago (a parallel run, a hand edit) is written from a
    collective auth whose verdict is weaker — and stamping `unverified` over
    `authenticated` would be exactly the silent downgrade the drop guard in
    `triage_apply` blocks one path over. The FIELDS still land (they are a
    merge, never a replacement); only the state holds.
    """
    if not is_terminal_bib_state(state):
        existing = resolve_bib_state(library, citekey)
        if is_terminal_bib_state(existing):
            state = existing
    update_master_bib_entry(library, citekey, entry_type, fields, bib_state=state)


def _remove_master_entry(library: Path, citekey: str) -> bool:
    """Delete one entry from master.bib (including its `% bib.state` line).
    Returns True if removed. Self-locks.
    """
    master_path = library / "master.bib"
    citekey_nfc = unicodedata.normalize("NFC", citekey)
    with lock_master_bib(library):
        if not master_path.exists():
            return False
        text = master_path.read_text()
        # Match in NFC then NFD.
        m = None
        for form in ("NFC", "NFD"):
            key_form = unicodedata.normalize(form, citekey_nfc)
            pat = re.compile(r"@\w+\s*\{\s*" + re.escape(key_form) + r"\s*,")
            m = pat.search(text)
            if m:
                break
        if not m:
            return False
        # Find the matching closing brace.
        brace_pos = text.index("{", m.start())
        depth = 1
        j = brace_pos + 1
        while j < len(text) and depth > 0:
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
            j += 1
        entry_start = m.start()
        entry_end = j
        # Include the `% bib.state` comment line if present.
        at_line_start = text.rfind("\n", 0, entry_start)
        at_line_start = at_line_start + 1 if at_line_start != -1 else 0
        prev_line_start = text.rfind("\n", 0, max(0, at_line_start - 1))
        prev_line_start = prev_line_start + 1 if prev_line_start != -1 else 0
        prev_line = text[prev_line_start:at_line_start].strip()
        if prev_line.startswith("% bib.state"):
            entry_start = prev_line_start
        # Also strip a single trailing blank line so we don't leave double
        # gaps when entries are stacked.
        end = entry_end
        if end < len(text) and text[end] == "\n":
            end += 1
        new_text = text[:entry_start] + text[end:]
        _atomic_write_text(master_path, new_text)
        return True


def _upsert_catalog_row(library: Path, citekey: str, bib_status: dict,
                        master_entry: dict) -> None:
    """Record the auth state for `citekey` after a merge.

    F#4 holdings-only gate: catalog.json carries ONLY rows for entries with
    a source document on disk (`papers/<citekey>/<citekey>.{pdf,docx,tex}`).
    A reference-only entry (cited but not held — the common case during a
    bib merge) must NOT mint a catalog row; its auth state lives solely in
    the `% bib.state` comment in master.bib, which `_write_master` already
    wrote before this call. So for a reference-only entry `admit_catalog_row`
    re-asserts that comment (idempotent) and answers False, and we return
    without touching the catalog.

    The gate used to be spelled here by hand. Since task 443 it is the one
    shared door in `_tools` — the ask and the discharge fused, so no writer
    can ask without discharging or discharge without asking.

    For a true holding, fall through to the catalog write, carrying over
    top-level fields (title/year/authors/doi) derived from master.
    """
    fields = master_entry.get("fields", {})
    if not admit_catalog_row(
        library, citekey,
        entry_type=master_entry.get("type", "misc"),
        fields=fields,
        bib_state=bib_status.get("state", "none"),
    ):
        return
    top: dict = {
        "title": _strip_braces(fields.get("title", "")),
        "authors": _split_authors(fields.get("author", "")),
        "year": _safe_int(fields.get("year", "")),
        "doi": _normalize_doi(fields.get("doi", "")) or None,
    }
    with lock_catalog(library):
        catalog = read_catalog(library)
        # Merge prior fieldChanges so they accumulate across runs (same
        # behavior as /authenticate-bib).
        prior_changes: list = []
        for e in catalog.get("entries", []):
            if citekey_matches(e.get("citekey", ""), citekey):
                prior_changes = ((e.get("bib") or {}).get("fieldChanges") or [])
                break
        merged_bib = dict(bib_status)
        merged_bib["fieldChanges"] = prior_changes + list(bib_status.get("fieldChanges", []))
        write_fields = {k: v for k, v in top.items() if v not in (None, "", [])}
        # This is a TRUE holding (admit_catalog_row passed above), so its catalog
        # row must carry pdf.present == True — otherwise the merge would mint the row
        # with upsert_catalog_entry's default pdf:{present:False}, the exact stale
        # flag the prune then has to defend against. upsert_catalog_entry deep-merges
        # nested dicts on an existing row, so this patch preserves any richer pdf
        # metadata (filename / pageCount / format) already on the row.
        write_fields["pdf"] = {"present": True}
        upsert_catalog_entry(catalog, citekey, **write_fields)
        # upsert_catalog_entry returns the row; re-find it to set bib.
        for e in catalog.get("entries", []):
            if citekey_matches(e.get("citekey", ""), citekey):
                e["bib"] = merged_bib
                break
        write_catalog(library, catalog)


def _safe_int(v) -> int | None:
    if v in ("", None):
        return None
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


# ── report container ──────────────────────────────────────────────────


@dataclass
class Report:
    citekey: str
    at: str
    entries_total: int = 0
    added: list = field(default_factory=list)
    deferred_dup: list = field(default_factory=list)
    skipped_transient: list = field(default_factory=list)
    auth_failed: list = field(default_factory=list)
    unauth_dup_handled: list = field(default_factory=list)
    manual_review: list = field(default_factory=list)
    dry_run: bool = False
    notes: list = field(default_factory=list)

    def to_json(self) -> dict:
        return {
            "citekey": self.citekey,
            "at": self.at,
            "entries_total": self.entries_total,
            "added": self.added,
            "deferred_dup": self.deferred_dup,
            "skipped_transient": self.skipped_transient,
            "auth_failed": self.auth_failed,
            "unauth_dup_handled": self.unauth_dup_handled,
            "manual_review": self.manual_review,
            "dry_run": self.dry_run,
            "notes": self.notes,
        }


# ── per-entry merge logic ─────────────────────────────────────────────


def _process_no_dup(
    *, library: Path, entry: dict, dry_run: bool, report: Report,
) -> None:
    e_ck = entry["citekey"]
    e_type = entry["type"]
    e_fields = entry["fields"]
    transient, reason = is_transient(entry)
    if transient:
        report.skipped_transient.append({"citekey": e_ck, "reason": reason})
        return

    if dry_run:
        report.added.append({"citekey": e_ck, "state": "would-auth", "dry_run": True})
        return

    # Stage as unverified (so the auth helper's recovery chain has a
    # place to read from if it needs to).
    _write_master(library, e_ck, e_type, e_fields, state="unverified")

    try:
        result = _do_authenticate(library, e_ck, e_type, e_fields)
    except Exception as exc:
        # Authentication crashed — leave the entry as unverified.
        report.auth_failed.append({
            "citekey": e_ck,
            "state": "unverified",
            "note": f"auth exception: {exc!r}",
        })
        _upsert_catalog_row(library, e_ck, {
            "state": "unverified",
            "doiVerified": False,
            "sources": [],
            "fieldChanges": [],
            "score": 0.0,
            "note": f"auth exception: {exc!r}",
        }, master_entry={"type": e_type, "fields": e_fields})
        return

    if result.state == "manuscript":
        # Late-detected transient. Roll back the master.bib write.
        _remove_master_entry(library, e_ck)
        report.skipped_transient.append({
            "citekey": e_ck,
            "reason": f"auth=manuscript ({result.note})",
        })
        return

    # Apply field changes + persist.
    proposed_type = result.proposed_type or e_type
    final_fields = apply_field_changes(e_fields, result.field_changes or [])
    _write_master(library, e_ck, proposed_type, final_fields, state=result.state)

    bib_status = {
        "state": result.state,
        "doiVerified": bool(result.doi_verified),
        "sources": list(result.sources or []),
        "fieldChanges": list(result.field_changes or []),
        "score": float(result.score or 0.0),
        "note": result.note or "",
    }
    if result.state == "authenticated":
        bib_status["authenticatedAt"] = _now()
    _upsert_catalog_row(library, e_ck, bib_status,
                        master_entry={"type": proposed_type, "fields": final_fields})

    append_inbox_item(library, {
        "kind": result.state,
        "citekey": e_ck,
        "at": _now(),
        "summary": (
            f"Merged {e_ck} (state={result.state}, "
            f"via {','.join(result.sources or []) or 'no-source'})"
        ),
    })

    if result.state in ("authenticated", "canonical"):
        report.added.append({"citekey": e_ck, "state": result.state})
    else:
        # unverified / failed — still added, but flagged.
        report.auth_failed.append({
            "citekey": e_ck,
            "state": result.state,
            "score": result.score,
            "note": result.note,
        })


def _process_dup_authenticated(report: Report, entry: dict, dup: dict) -> None:
    report.deferred_dup.append({
        "paper_entry": entry["citekey"],
        "master_entry": dup["citekey"],
        "master_state": dup["bib_state"],
    })


def _process_dup_unauth(
    *, library: Path, entry: dict, dup: dict, dry_run: bool, report: Report,
) -> None:
    """Collective-info auth + same-work-vs-split decision."""
    if dry_run:
        report.unauth_dup_handled.append({
            "paper_entry": entry["citekey"],
            "master_entry": dup["citekey"],
            "action": "would-collective-auth",
            "dry_run": True,
        })
        return

    d_fields = dup["fields"]
    e_fields = entry["fields"]
    merged = merge_fields(d_fields, e_fields)
    try:
        result = _do_authenticate(library, dup["citekey"], dup["type"], merged)
    except Exception as exc:
        report.manual_review.append({
            "type": "unauth_dup_auth_exception",
            "paper_entry": entry["citekey"],
            "master_entry": dup["citekey"],
            "note": f"collective auth raised: {exc!r}",
        })
        return

    if result.state not in ("authenticated", "canonical"):
        report.manual_review.append({
            "type": "unauth_dup_no_resolution",
            "paper_entry": entry["citekey"],
            "master_entry": dup["citekey"],
            "auth_state": result.state,
            "auth_note": result.note,
        })
        return

    if same_work(result.matched_record or {}, d_fields, e_fields):
        # Same work — fold the authenticated fields back under master's citekey.
        proposed_type = result.proposed_type or dup["type"]
        final_fields = apply_field_changes(merged, result.field_changes or [])
        _write_master(library, dup["citekey"], proposed_type, final_fields, state=result.state)
        bib_status = {
            "state": result.state,
            "doiVerified": bool(result.doi_verified),
            "sources": list(result.sources or []),
            "fieldChanges": list(result.field_changes or []),
            "score": float(result.score or 0.0),
            "note": (result.note or "") + " [collective-auth merge from " + entry["citekey"] + "]",
        }
        if result.state == "authenticated":
            bib_status["authenticatedAt"] = _now()
        _upsert_catalog_row(library, dup["citekey"], bib_status,
                            master_entry={"type": proposed_type, "fields": final_fields})
        append_inbox_item(library, {
            "kind": result.state,
            "citekey": dup["citekey"],
            "at": _now(),
            "summary": (
                f"Collective-auth: merged {entry['citekey']} into {dup['citekey']} "
                f"(state={result.state})"
            ),
        })
        report.unauth_dup_handled.append({
            "paper_entry": entry["citekey"],
            "master_entry": dup["citekey"],
            "action": "merged",
            "state": result.state,
        })
        return

    # Different works. Authenticate each independently and keep both.
    # Master entry first.
    try:
        d_result = _do_authenticate(library, dup["citekey"], dup["type"], d_fields)
    except Exception as exc:
        d_result = None
        d_exc = exc
    else:
        d_exc = None

    if d_result is not None and d_result.state not in ("manuscript",):
        d_proposed = d_result.proposed_type or dup["type"]
        d_final = apply_field_changes(d_fields, d_result.field_changes or [])
        _write_master(library, dup["citekey"], d_proposed, d_final, state=d_result.state)
        d_bib_status = {
            "state": d_result.state,
            "doiVerified": bool(d_result.doi_verified),
            "sources": list(d_result.sources or []),
            "fieldChanges": list(d_result.field_changes or []),
            "score": float(d_result.score or 0.0),
            "note": d_result.note or "",
        }
        if d_result.state == "authenticated":
            d_bib_status["authenticatedAt"] = _now()
        _upsert_catalog_row(library, dup["citekey"], d_bib_status,
                            master_entry={"type": d_proposed, "fields": d_final})

    # Paper entry. Use its own citekey (which may collide with the master
    # citekey only if exact-citekey dedup hit — but if we're in unauth-dup
    # land via DOI/ISBN/fuzzy, the citekeys differ).
    if citekey_matches(entry["citekey"], dup["citekey"]):
        # Citekey collision and split — refuse to clobber master. Surface.
        report.manual_review.append({
            "type": "split_citekey_collision",
            "paper_entry": entry["citekey"],
            "master_entry": dup["citekey"],
            "note": "Split would require renaming paper entry; not done automatically.",
        })
        return

    _write_master(library, entry["citekey"], entry["type"], entry["fields"], state="unverified")
    try:
        e_result = _do_authenticate(library, entry["citekey"], entry["type"], entry["fields"])
    except Exception as exc:
        e_result = None
        e_exc = exc
    else:
        e_exc = None

    if e_result is None or e_result.state == "manuscript":
        # Roll back the paper entry — its split partner couldn't be authenticated.
        _remove_master_entry(library, entry["citekey"])
        report.manual_review.append({
            "type": "split_paper_unauthenticatable",
            "paper_entry": entry["citekey"],
            "master_entry": dup["citekey"],
            "note": (e_exc and f"auth raised: {e_exc!r}") or (e_result and e_result.note) or "",
        })
        return

    e_proposed = e_result.proposed_type or entry["type"]
    e_final = apply_field_changes(entry["fields"], e_result.field_changes or [])
    _write_master(library, entry["citekey"], e_proposed, e_final, state=e_result.state)
    e_bib_status = {
        "state": e_result.state,
        "doiVerified": bool(e_result.doi_verified),
        "sources": list(e_result.sources or []),
        "fieldChanges": list(e_result.field_changes or []),
        "score": float(e_result.score or 0.0),
        "note": e_result.note or "",
    }
    if e_result.state == "authenticated":
        e_bib_status["authenticatedAt"] = _now()
    _upsert_catalog_row(library, entry["citekey"], e_bib_status,
                        master_entry={"type": e_proposed, "fields": e_final})

    append_inbox_item(library, {
        "kind": "authenticated" if e_result.state == "authenticated" else e_result.state,
        "citekey": entry["citekey"],
        "at": _now(),
        "summary": (
            f"Split-and-auth: {entry['citekey']} authenticated as distinct work "
            f"from {dup['citekey']} (state={e_result.state})"
        ),
    })

    report.unauth_dup_handled.append({
        "paper_entry": entry["citekey"],
        "master_entry": dup["citekey"],
        "action": "split",
        "paper_state": e_result.state,
        "master_state": d_result.state if d_result is not None else "unknown",
    })
    report.added.append({"citekey": entry["citekey"], "state": e_result.state})


# ── top-level ─────────────────────────────────────────────────────────


def _resolve_library(library_arg: str | None) -> Path:
    if library_arg:
        p = Path(library_arg).expanduser().resolve()
        if not p.exists():
            raise FileNotFoundError(f"--library path does not exist: {p}")
        return p
    # Try library_path.py — synced PWA folders + repo both ship it.
    for candidate in (
        ".virgil/scripts/editor/library_path.py",
        "editor/scripts/library_path.py",
    ):
        cand = Path.cwd() / candidate
        if cand.exists():
            import subprocess
            try:
                out = subprocess.check_output(
                    ["python3", str(cand), "--get"],
                    stderr=subprocess.DEVNULL,
                ).decode().strip()
                if out:
                    return Path(out).expanduser().resolve()
            except subprocess.CalledProcessError:
                continue
    # Last-ditch: assume CWD is the library root.
    return Path.cwd().resolve()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Merge one paper's references.bib into master.bib.")
    ap.add_argument("citekey")
    ap.add_argument("--library", default=None,
                    help="Library root (default: auto-resolve via library_path.py).")
    ap.add_argument("--dry-run", action="store_true",
                    help="Report what would happen without writing master.bib / catalog.")
    ap.add_argument("--report-dir", default=None,
                    help="Override location of the JSON report directory.")
    args = ap.parse_args(argv)

    library = _resolve_library(args.library)
    citekey = args.citekey

    paper_dir = library / "papers" / citekey
    refs_path = paper_dir / "references.bib"
    report_dir = (Path(args.report_dir).expanduser().resolve()
                  if args.report_dir else library / ".virgil" / "merge-reports")
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / f"{citekey}.json"

    report = Report(citekey=citekey, at=_now(), dry_run=args.dry_run)

    if not refs_path.exists():
        report.notes.append(f"no references.bib at {refs_path}")
        _atomic_write_text(report_path, json.dumps(report.to_json(), indent=2) + "\n")
        print(f"+0 ~0 ⤬0 ⚠0 ?0  (no references.bib)")
        return 0

    paper_entries = read_bib_file(refs_path)
    report.entries_total = len(paper_entries)
    if not paper_entries:
        report.notes.append("references.bib is empty")
        if not args.dry_run:
            try:
                mark_bib_imported(library, citekey, [])
            except KeyError:
                report.notes.append("no catalog row to mark imported")
        _atomic_write_text(report_path, json.dumps(report.to_json(), indent=2) + "\n")
        print(f"+0 ~0 ⤬0 ⚠0 ?0  (empty references.bib)")
        return 0

    # Index catalog rows by NFC citekey so dedup can read bib state.
    catalog = read_catalog(library)
    catalog_index = {
        normalize_citekey(e.get("citekey", "")): e
        for e in catalog.get("entries", [])
    }

    # Route uncertain work-matches from find_duplicate into manual_review.
    global _UNCERTAIN_SINK
    _UNCERTAIN_SINK = report.manual_review

    # Re-read master.bib for each entry so parallel runs see each other's writes.
    # The set is `_tools.TERMINAL_BIB_STATES` — spelled once, so this branch
    # and `triage_apply`'s drop guard cannot again disagree about which states
    # are settled (pre-442 the drop guard was missing `canonical`).
    TERMINAL_STATES = TERMINAL_BIB_STATES
    master_path = library / "master.bib"
    for entry in paper_entries:
        # ONE read of master.bib per entry, feeding BOTH the entry parse and
        # the F#4 `% bib.state` map — the state's HOME, without which
        # `bib_state` reads "none" for every fileless reference and the
        # "defer to an authenticated master entry" rule above cannot fire.
        master_text = master_path.read_text() if master_path.exists() else ""
        master = read_master_bib(master_path, text=master_text)
        master_states = master_bib_state_map(master_text)
        # Build the WorkIndex once per entry-view of master. master is re-read
        # each iteration (parallel runs may have written), so the index tracks
        # it; within a single find_duplicate call the index is reused across all
        # candidate comparisons (no per-candidate re-scan).
        work_index = build_work_index(master)
        dup = find_duplicate(entry, master, catalog_index, work_index=work_index,
                             library=library, master_states=master_states)
        if dup is None:
            _process_no_dup(library=library, entry=entry, dry_run=args.dry_run, report=report)
        elif dup["bib_state"] in TERMINAL_STATES:
            _process_dup_authenticated(report, entry, dup)
        elif is_transient(entry)[0]:
            # Master is unauth and the paper entry can't be authenticated —
            # collective-auth would just return manuscript/fail. Defer.
            transient, reason = is_transient(entry)
            report.skipped_transient.append({
                "citekey": entry["citekey"],
                "reason": f"transient + unauth-dup; {reason}",
                "master_entry": dup["citekey"],
                "master_state": dup["bib_state"],
            })
        else:
            _process_dup_unauth(
                library=library, entry=entry, dup=dup,
                dry_run=args.dry_run, report=report,
            )
        # Refresh the catalog index after each entry so subsequent
        # passes see fresh bib states.
        catalog = read_catalog(library)
        catalog_index = {
            normalize_citekey(e.get("citekey", "")): e
            for e in catalog.get("entries", [])
        }

    # Mark the paper imported: snapshot the references.bib citekey set so a
    # later *addition* can clear the flag (additions-only invalidation). Runs
    # for both /library/import-bib and the whole-library /library/merge-bibs,
    # since both call this engine. Skipped on --dry-run.
    #
    # BEFORE the report write, and that ordering is load-bearing: under F#4 a
    # reference-only citekey has no catalog row, so this is the branch that
    # records "no catalog row to mark imported" — the ONE signal
    # `/library/import-bib` step 5 reads to decide whether to announce the
    # blue "imported" check. Written first, the report went to disk with an
    # empty `notes[]` and the note lived only in memory, so the skill read the
    # artifact, found nothing, and announced a check the user could not see.
    # (The empty-`references.bib` early return above already appends before
    # its own write; this was the ordinary path.)
    if not args.dry_run:
        try:
            mark_bib_imported(library, citekey, [
                normalize_citekey(e["citekey"])
                for e in paper_entries if e.get("citekey")
            ])
        except KeyError:
            report.notes.append("no catalog row to mark imported")

    _atomic_write_text(report_path, json.dumps(report.to_json(), indent=2) + "\n")

    print(
        f"+{len(report.added)} "
        f"~{len(report.deferred_dup)} "
        f"⇄{len(report.unauth_dup_handled)} "
        f"⤬{len(report.skipped_transient)} "
        f"⚠{len(report.auth_failed)} "
        f"?{len(report.manual_review)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
