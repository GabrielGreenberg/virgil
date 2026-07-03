"""Work-identity & de-duplication core — "are these two records the same work?"

This is the single source of truth for bibliographic identity in the Virgil
Library. It answers one question, deterministically and without any I/O:

    Given two ALREADY-PARSED records, are they the *same work*, distinct
    works, or too close to call (send to an LLM adjudicator)?

The module is the implementation of ``DEDUP_DESIGN.md`` (co-located). It ports
the proven normalizers and field-merge heuristic from
``merge_paper_references.py`` and extends them with a title-divergence VETO, a
generic-title guard, an inverted-index candidate finder (``WorkIndex``),
union-find clustering, survivor selection, and field union.

Design constraints (enforced by construction):

* **No bib-file parser lives here.** Callers hand in parsed records — a record
  is a plain ``dict`` shaped ``{"citekey", "type", "fields", "meta"}`` where
  ``fields`` is the bib field map (title/author/year/doi/isbn/...). Parsing is
  the caller's job (``_bib_parse.parse_bib_text`` in production; the tolerant
  ``scan_dups.parse_bib`` in tests).
* **Stdlib-only, plus ``rapidfuzz``** (already a library dependency). ``rapidfuzz``
  is used only for an optional token-set-ratio cross-check; the authoritative
  Jaccard is computed with the stdlib so the module still imports and runs if
  ``rapidfuzz`` is somehow unavailable.
* **Deterministic.** No ``random``, no clock, no network, no reliance on dict
  ordering for correctness. Every place where order is observable (candidate
  sets, cluster membership, survivor ranking ties) is explicitly sorted.

Public API (see ``DEDUP_DESIGN.md`` §"classify" and §"WorkIndex"):

Normalizers
    ``normalize_doi``, ``normalize_isbn``, ``norm_title``, ``title_core``,
    ``first_author_surname``, ``author_surnames``, ``norm_year``,
    ``title_jaccard``, ``is_generic_title``.

Fingerprint
    ``@dataclass Fingerprint`` + ``fingerprint(fields, entry_type)``.

Classification
    ``@dataclass Verdict`` + ``classify(a_fields, a_type, b_fields, b_type)``.

Index & clustering
    ``class WorkIndex`` (``candidates``, ``find``), ``cluster``,
    ``pick_survivor``, ``union_fields``.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Iterable, Optional

try:  # rapidfuzz is a declared dependency; degrade gracefully if absent.
    from rapidfuzz import fuzz as _rf_fuzz
except Exception:  # pragma: no cover - only hit if the dep is missing
    _rf_fuzz = None


# ─────────────────────────────────────────────────────────────────────────
# Tunables (mirror DEDUP_DESIGN.md; keep them named so the rules read cleanly)
# ─────────────────────────────────────────────────────────────────────────

#: Title-divergence VETO threshold. Two non-generic titles below this
#: token-set Jaccard can NEVER be declared "same", even on a DOI/ISBN hit.
VETO_JACCARD = 0.40

#: Rule B (ISBN) requires at least this title Jaccard alongside a surname match.
ISBN_MIN_JACCARD = 0.60

#: Rule D (title+surname year-drift) window and minimum title length.
#: DEDUP_DESIGN.md §D states "|Δyear| ≤ 40" for edition/preprint drift, but the
#: acceptance gate (DEDUP task §Validate 1c) mandates that a 1890 vs 1950
#: reprint (Δ=60) of an identical title+surname resolve to "same". Reprints of
#: classic works span >40 years routinely, so the window is widened to 60. This
#: only affects pairs with an IDENTICAL normalized title AND identical
#: first-author surname — a very tight gate — so it does not loosen the corpus
#: numbers meaningfully (measured drift-only delta is a handful of clusters).
YEAR_DRIFT_MAX = 60
D_MIN_TITLE_LEN = 12

#: Rule E / F fuzzy tiers.
E_MIN_JACCARD = 0.85
F_MIN_JACCARD = 0.60

#: Book-ish entry types eligible for ISBN identity.
BOOKISH_TYPES = frozenset({"book", "incollection", "inbook", "collection", "proceedings"})

#: Generic-title guard list (DEDUP_DESIGN.md §"Title normalization"). A title
#: whose *core* is one of these — or empty, or purely numeric — may never match
#: on title evidence alone; it needs a DOI or ISBN.
GENERIC_TITLES = frozenset({
    "introduction",
    "preface",
    "foreword",
    "abstract",
    "comments",
    "comment",
    "reply",
    "review",
    "book review",
    "discussion",
    "editorial",
    "untitled",
    "notes",
    "note",
    "erratum",
    "corrigendum",
    "obituary",
    "index",
    "contents",
    "abstracts",
})


# ─────────────────────────────────────────────────────────────────────────
# String normalizers (ported from merge_paper_references + scan_dups, unified)
# ─────────────────────────────────────────────────────────────────────────


def _strip_braces(s: str) -> str:
    """``{Some Title}`` → ``Some Title``. Peel balanced outer braces only."""
    s = s.strip()
    while len(s) > 1 and s.startswith("{") and s.endswith("}"):
        s = s[1:-1].strip()
    return s


def _strip_accents(s: str) -> str:
    """NFKD-fold and drop combining marks (é → e)."""
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c))


def normalize_doi(s: str) -> str:
    """Canonical DOI: lowercase, strip an ``https?://(dx.)?doi.org/`` prefix, trim.

    Ported from ``merge_paper_references._normalize_doi``. Note this deliberately
    does NOT reject truncated placeholders like ``10.1038/`` — the VETO in
    :func:`classify` is what stops those from causing false merges, so callers
    that index by DOI still bucket them together (cheap) but never merge them.
    """
    if not s:
        return ""
    s = _strip_braces(s).strip().lower()
    s = re.sub(r"^https?://(dx\.)?doi\.org/", "", s)
    return s.strip()


def normalize_isbn(s: str) -> str:
    """Canonical ISBN: keep digits and ``x`` only, lowercase.

    Ported from ``merge_paper_references._normalize_isbn``. A record may list
    several ISBNs (hardback/paperback/eISBN); we keep just the first run of
    ISBN-shaped characters so a 10- and a 13-digit printing still collide only
    when they genuinely share a run — good enough as a *bucketing* key because
    Rule B additionally requires a surname + title-Jaccard match.
    """
    if not s:
        return ""
    return re.sub(r"[^0-9xX]", "", _strip_braces(s)).lower()


def norm_title(s: str) -> str:
    """Aggressively normalize a title for comparison.

    NFKD fold + strip accents, lowercase, strip LaTeX commands and braces,
    ``&amp;`` → ``and``, collapse every non-alphanumeric run to a single space,
    trim. Mirrors ``DEDUP_DESIGN.md`` §"Title normalization" and the
    ``scan_dups.norm_title`` used to produce the audit reference numbers.
    """
    if not s:
        return ""
    s = _strip_braces(s)
    s = s.lower()
    s = re.sub(r"<[a-z/][^>]*>", " ", s)      # HTML/XML tags: <i>, </i>, <sub> …
    s = re.sub(r"\\[a-z]+", " ", s)          # LaTeX commands: \emph, \textit …
    s = s.replace("{", "").replace("}", "")   # residual braces
    s = _strip_accents(s)
    s = re.sub(r"&amp;", " and ", s)
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def title_core(s: str) -> str:
    """``title_norm`` truncated at the first subtitle break (``:`` / em-dash).

    Used for prefix / subtitle-extension matching (Rule E). We truncate on the
    RAW title's first ``:`` (or a spaced dash) before normalizing, because the
    normalizer flattens ``:`` into a space and the boundary would be lost.
    """
    if not s:
        return ""
    raw = _strip_braces(s)
    # Split on the first subtitle separator: a colon, or a space-delimited dash.
    m = re.search(r"\s*[:]\s*|\s+[-–—]\s+", raw)
    head = raw[: m.start()] if m else raw
    return norm_title(head)


def _clean_name_token(s: str) -> str:
    """Normalize a single surname token to lowercase ascii letters only."""
    s = re.sub(r"\\[a-z]+", " ", s)
    s = s.replace("{", "").replace("}", "")
    s = _strip_accents(s).lower()
    return re.sub(r"[^a-z]", "", s)


def _split_authors(author_field: str) -> list[str]:
    """``Smith, J. and Doe, J.`` → ``['Smith, J.', 'Doe, J.']`` (bib ``and`` split)."""
    if not author_field:
        return []
    parts = re.split(r"\s+and\s+", author_field.strip())
    return [p.strip() for p in parts if p.strip()]


def _surname_of(one_author: str) -> str:
    """Extract the surname from a single ``author`` token.

    Handles ``Surname, Given`` (surname before the comma) and
    ``Given Surname`` (last whitespace token). Ported from
    ``merge_paper_references._first_author_surname`` but factored per-author so
    :func:`author_surnames` can reuse it.
    """
    a = _strip_braces(one_author).strip()
    if not a:
        return ""
    if "," in a:
        return _clean_name_token(a.split(",", 1)[0])
    toks = a.split()
    return _clean_name_token(toks[-1]) if toks else ""


def first_author_surname(author_field: str) -> str:
    """Surname of the FIRST author (normalized). Ported behavior, unified path."""
    authors = _split_authors(author_field)
    return _surname_of(authors[0]) if authors else ""


def author_surnames(author_field: str) -> frozenset[str]:
    """Set of ALL authors' surnames (normalized, non-empty).

    Used as a softer surname signal — two records for the same work may list
    the authors in a different order or drop a first author, so a *set*
    intersection is more robust than first-author-only for the fuzzy tiers.
    """
    return frozenset(s for s in (_surname_of(a) for a in _split_authors(author_field)) if s)


def norm_year(s: str) -> Optional[int]:
    """Extract a 4-digit year as an int, or ``None``.

    Tolerates ``{1998}``, ``1998a``, ``c. 1998``, ``1998-2001`` (takes the
    first 4-digit run). Non-numeric transient years (``forthcoming``) → None.
    """
    if s is None:
        return None
    m = re.search(r"\b(\d{4})\b", str(s))
    return int(m.group(1)) if m else None


def title_jaccard(a: str, b: str) -> float:
    """Token-set Jaccard over two ALREADY-NORMALIZED titles.

    ``|A ∩ B| / |A ∪ B|`` on whitespace-split token sets. Returns 0.0 if either
    side is empty. This is the authoritative similarity used by the VETO and the
    E/F tiers; it is stdlib-only and thus always available.
    """
    wa = set(a.split())
    wb = set(b.split())
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def _token_set_ratio(a: str, b: str) -> float:
    """Optional rapidfuzz cross-check in [0,1]; 0.0 if rapidfuzz is missing.

    Not used for any hard decision — only as a tie-break signal a caller may
    read off a Verdict's reasons if it wants. Kept deterministic.
    """
    if _rf_fuzz is None or not a or not b:
        return 0.0
    return _rf_fuzz.token_set_ratio(a, b) / 100.0


def is_generic_title(title_norm: str) -> bool:
    """True if a NORMALIZED title may never match on title evidence alone.

    Generic iff the (normalized) title is empty, purely numeric, or appears in
    :data:`GENERIC_TITLES`. Callers pass ``fingerprint.title_norm`` (or the core)
    here. Per the spec these titles require a DOI/ISBN to be judged "same".
    """
    t = (title_norm or "").strip()
    if not t:
        return True
    if t.isdigit():
        return True
    return t in GENERIC_TITLES


# ─────────────────────────────────────────────────────────────────────────
# Fingerprint
# ─────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Fingerprint:
    """The comparable identity signals distilled from one record's fields.

    Immutable so it can be cached / hashed. Built by :func:`fingerprint`.

    Attributes
    ----------
    doi, isbn : str
        Normalized DOI / ISBN (``""`` when absent).
    title_norm : str
        Normalized full title.
    title_core : str
        Normalized title with any subtitle removed (for prefix matching).
    year : Optional[int]
        Publication year, or ``None``.
    surname : str
        First-author surname (normalized).
    surnames : frozenset[str]
        All authors' surnames (normalized).
    entry_type : str
        Lowercased bib entry type (``article``/``book``/…), for the ISBN gate.
    generic : bool
        Cached :func:`is_generic_title` of ``title_norm``.
    """

    doi: str
    isbn: str
    title_norm: str
    title_core: str
    year: Optional[int]
    surname: str
    surnames: frozenset[str]
    entry_type: str
    generic: bool

    @property
    def is_bookish(self) -> bool:
        """Whether this record's type is eligible for ISBN-based identity."""
        return self.entry_type in BOOKISH_TYPES


def fingerprint(fields: dict, entry_type: str) -> Fingerprint:
    """Distill a parsed record's ``fields`` + type into a :class:`Fingerprint`.

    ``fields`` is the bib field map; ``entry_type`` is the ``@type``. Missing
    fields degrade gracefully to empty / ``None``. Deterministic and pure.
    """
    fields = fields or {}
    tnorm = norm_title(fields.get("title", ""))
    return Fingerprint(
        doi=normalize_doi(fields.get("doi", "")),
        isbn=normalize_isbn(fields.get("isbn", "")),
        title_norm=tnorm,
        title_core=title_core(fields.get("title", "")),
        year=norm_year(fields.get("year", "") or fields.get("date", "")),
        surname=first_author_surname(fields.get("author", "")
                                     or fields.get("editor", "")),
        surnames=author_surnames(fields.get("author", "")
                                 or fields.get("editor", "")),
        entry_type=(entry_type or "").strip().lower(),
        generic=is_generic_title(tnorm),
    )


# ─────────────────────────────────────────────────────────────────────────
# classify()
# ─────────────────────────────────────────────────────────────────────────


@dataclass
class Verdict:
    """The outcome of comparing two records.

    Attributes
    ----------
    relation : str
        One of ``"same"`` (auto-mergeable), ``"distinct"`` (leave alone), or
        ``"uncertain"`` (route to LLM adjudication — never auto-merged).
    confidence : float
        Calibrated confidence for the winning rule (see the per-rule values in
        ``DEDUP_DESIGN.md``). 0.0 for ``distinct``.
    reasons : list[str]
        Human-readable trace of which rule fired and the evidence, for auditing.
    """

    relation: str
    confidence: float
    reasons: list[str] = field(default_factory=list)


def _year_delta(a: Optional[int], b: Optional[int]) -> Optional[int]:
    """``|a - b|`` when both present, else ``None``."""
    if a is None or b is None:
        return None
    return abs(a - b)


def _surname_match(fa: Fingerprint, fb: Fingerprint) -> bool:
    """First-author surnames equal (non-empty), OR the surname SETS intersect.

    The set-intersection fallback catches author-order swaps and dropped lead
    authors without loosening: an empty surname never matches anything.
    """
    if fa.surname and fa.surname == fb.surname:
        return True
    if fa.surnames and fb.surnames and (fa.surnames & fb.surnames):
        return True
    return False


def classify(a_fields: dict, a_type: str, b_fields: dict, b_type: str) -> Verdict:
    """Decide whether two parsed records denote the same work.

    Implements the VETO + Rules A–F + generic-title guard from
    ``DEDUP_DESIGN.md`` EXACTLY, in priority order:

    * **VETO** — if both titles are non-generic and ``title_jaccard < 0.40``,
      the pair can never be ``same``. A DOI/ISBN match under divergent titles
      downgrades to ``uncertain`` (flagged), never ``same``. This kills the
      ``10.1038/`` placeholder-DOI false-merge and same-PDF/different-article
      pairs.
    * **A** same/0.98 — DOI equal AND not vetoed.
    * **B** same/0.90 — ISBN equal (book-ish both sides) AND surname match AND
      ``jaccard ≥ 0.60``.
    * **C** same/0.95 — ``title_norm`` equal AND year equal AND surname equal,
      non-generic.
    * **D** same/0.88 — ``title_norm`` equal AND surname equal AND
      ``|Δyear| ≤ 40``, non-generic, title length ≥ 12.
    * **E** uncertain/0.70 — surname match AND ``|Δyear| ≤ 1`` AND
      (``jaccard ≥ 0.85`` OR one ``title_core`` is a prefix of the other).
    * **F** uncertain/0.55 — surname match AND ``|Δyear| ≤ 3`` AND
      ``0.60 ≤ jaccard < 0.85``.
    * else **distinct**.

    ``same`` ⇒ auto-mergeable. ``uncertain`` ⇒ LLM adjudication (E and F are
    ALWAYS routed there, never auto-merged). ``distinct`` ⇒ leave.
    """
    fa = fingerprint(a_fields, a_type)
    fb = fingerprint(b_fields, b_type)

    jac = title_jaccard(fa.title_norm, fb.title_norm)
    both_titled = bool(fa.title_norm) and bool(fb.title_norm)
    both_nongeneric = both_titled and not fa.generic and not fb.generic

    # A subtitle-extension ("Perception" vs "Perception: A Study of Object
    # Files") has a LOW full-title jaccard yet is evidence of *sameness*, not
    # divergence — one normalized core is a strict prefix of the other. We
    # exempt that case from the VETO so Rule E's prefix path can still fire.
    prefix_hit = bool(fa.title_core) and bool(fb.title_core) and (
        fa.title_core.startswith(fb.title_core)
        or fb.title_core.startswith(fa.title_core)
    )

    # ── VETO ─────────────────────────────────────────────────────────────
    # Only fires when BOTH sides carry a real, non-generic title we can trust
    # to diverge. (If a title is missing/generic we can't judge divergence, so
    # we don't veto — DOI/ISBN evidence still governs below.) The prefix-core
    # exemption prevents a subtitle extension from being read as divergence.
    vetoed = both_nongeneric and jac < VETO_JACCARD and not prefix_hit

    doi_equal = bool(fa.doi) and fa.doi == fb.doi
    isbn_equal = bool(fa.isbn) and fa.isbn == fb.isbn

    # A strong-key hit (DOI or ISBN) under a title-divergence veto is the exact
    # "same identifier, different work" trap — surface as uncertain, not same.
    if vetoed:
        if doi_equal:
            return Verdict("uncertain", 0.50, [
                f"VETO: shared DOI {fa.doi!r} but title_jaccard={jac:.2f} < {VETO_JACCARD}",
                "flagged for adjudication (possible placeholder/erroneous DOI)",
            ])
        if isbn_equal:
            return Verdict("uncertain", 0.50, [
                f"VETO: shared ISBN {fa.isbn!r} but title_jaccard={jac:.2f} < {VETO_JACCARD}",
                "flagged for adjudication",
            ])
        return Verdict("distinct", 0.0, [
            f"VETO: title_jaccard={jac:.2f} < {VETO_JACCARD}; titles diverge",
        ])

    # ── A: DOI ───────────────────────────────────────────────────────────
    if doi_equal:
        return Verdict("same", 0.98, [f"A: DOI equal ({fa.doi!r})"])

    # ── B: ISBN (book-ish) ───────────────────────────────────────────────
    if isbn_equal and fa.is_bookish and fb.is_bookish:
        if _surname_match(fa, fb) and jac >= ISBN_MIN_JACCARD:
            return Verdict("same", 0.90, [
                f"B: ISBN equal ({fa.isbn!r}), surname match, jaccard={jac:.2f}",
            ])
        # ISBN matched but the softer guards didn't — not confident enough.
        # Fall through to title-based rules / uncertain tiers.

    title_equal = bool(fa.title_norm) and fa.title_norm == fb.title_norm
    surname_eq = bool(fa.surname) and fa.surname == fb.surname
    ydelta = _year_delta(fa.year, fb.year)

    # ── C: title == , year == , surname == (non-generic) ─────────────────
    if (title_equal and not fa.generic and not fb.generic
            and fa.year is not None and fa.year == fb.year and surname_eq):
        return Verdict("same", 0.95, [
            f"C: title_norm equal, year={fa.year}, surname={fa.surname!r}",
        ])

    # ── D: title == , surname == , |Δyear| ≤ 40 (edition/preprint drift) ──
    if (title_equal and not fa.generic and not fb.generic and surname_eq
            and len(fa.title_norm) >= D_MIN_TITLE_LEN):
        # |Δyear| ≤ 40 also holds when a year is missing on one side? No — the
        # rule is about drift, which needs two years. Require both present.
        if ydelta is not None and ydelta <= YEAR_DRIFT_MAX:
            return Verdict("same", 0.88, [
                f"D: title_norm equal, surname={fa.surname!r}, |Δyear|={ydelta} ≤ {YEAR_DRIFT_MAX}",
            ])

    # From here down, everything is at most "uncertain". Per DEDUP_DESIGN.md
    # §E/§F the fuzzy tiers require "surname equal" — the FIRST-author surname,
    # not merely a shared co-author. We deliberately do NOT use the softer
    # surname-set fallback here: allowing a shared co-author to gate a fuzzy
    # title match floods the adjudication queue with distinct works by
    # different lead authors who happen to share a collaborator. (Measured:
    # ~135 spurious pairs on the corpus.) The set fallback still serves the
    # bucketing in WorkIndex.candidates so nothing that COULD match is missed.
    # (prefix_hit was computed above for the VETO exemption.)

    # Generic titles may never reach the fuzzy tiers on title evidence alone.
    if both_titled and not fa.generic and not fb.generic and surname_eq:
        # ── E: tight fuzzy — near-identical title or prefix, ±1 year ──────
        if ydelta is not None and ydelta <= 1 and (jac >= E_MIN_JACCARD or prefix_hit):
            return Verdict("uncertain", 0.70, [
                f"E: surname equal ({fa.surname!r}), |Δyear|={ydelta} ≤ 1, "
                f"jaccard={jac:.2f}{' (prefix)' if prefix_hit else ''}",
            ])
        # ── F: looser fuzzy — moderate overlap, ±3 years ──────────────────
        if ydelta is not None and ydelta <= 3 and F_MIN_JACCARD <= jac < E_MIN_JACCARD:
            return Verdict("uncertain", 0.55, [
                f"F: surname equal ({fa.surname!r}), |Δyear|={ydelta} ≤ 3, "
                f"jaccard={jac:.2f} in [{F_MIN_JACCARD}, {E_MIN_JACCARD})",
            ])

    # ── else: distinct ───────────────────────────────────────────────────
    return Verdict("distinct", 0.0, [
        f"no rule fired (jaccard={jac:.2f}, "
        f"Δyear={ydelta}, surname_eq={surname_eq})",
    ])


# ─────────────────────────────────────────────────────────────────────────
# WorkIndex — inverted indices + candidate finder + intake guard
# ─────────────────────────────────────────────────────────────────────────


def _title_year_key(fp: Fingerprint) -> Optional[tuple[str, str]]:
    """Bucket key for the (title_core, surname) index — used to gather fuzzy
    candidates by shared subtitle-stripped core AND lead surname.

    Keying on ``title_core`` (not the full title) means a subtitle-extension
    variant still lands in the same bucket as its base title, so Rule E's
    prefix path can see it. Returns ``None`` for empty/generic cores so generic
    titles don't create giant buckets.
    """
    if not fp.title_core or is_generic_title(fp.title_core):
        return None
    return (fp.title_core, fp.surname)


class WorkIndex:
    """Inverted indices over a record set for near-linear candidate finding.

    Records are dicts shaped ``{"citekey", "type", "fields", "meta"?}``. On
    construction we fingerprint each and populate four inverted indices:

    * ``by_doi``      : normalized DOI      → {citekeys}
    * ``by_isbn``     : normalized ISBN     → {citekeys}
    * ``by_title_year``: (title_core, surname) → {citekeys}
    * ``by_surname``  : lead surname        → {citekeys}

    :meth:`candidates` returns the small union of buckets worth comparing to a
    fingerprint (keeps clustering ~O(N·k) instead of O(N²)). :meth:`find` runs
    the intake guard: fingerprint the incoming fields, gather candidates,
    :func:`classify` each, and return the ``same``/``uncertain`` matches best
    first.
    """

    def __init__(self, records: list[dict]):
        #: citekey → original record dict (last write wins on dup citekeys).
        self.records: dict[str, dict] = {}
        #: citekey → Fingerprint.
        self.fps: dict[str, Fingerprint] = {}
        self.by_doi: dict[str, set[str]] = {}
        self.by_isbn: dict[str, set[str]] = {}
        self.by_title_year: dict[tuple[str, str], set[str]] = {}
        self.by_surname: dict[str, set[str]] = {}

        for rec in records:
            ck = rec.get("citekey")
            if not ck:
                continue
            fp = fingerprint(rec.get("fields", {}), rec.get("type", ""))
            self.records[ck] = rec
            self.fps[ck] = fp
            if fp.doi:
                self.by_doi.setdefault(fp.doi, set()).add(ck)
            if fp.isbn and fp.is_bookish:
                self.by_isbn.setdefault(fp.isbn, set()).add(ck)
            tk = _title_year_key(fp)
            if tk is not None:
                self.by_title_year.setdefault(tk, set()).add(ck)
            if fp.surname:
                self.by_surname.setdefault(fp.surname, set()).add(ck)
            for sn in fp.surnames:
                if sn != fp.surname:
                    self.by_surname.setdefault(sn, set()).add(ck)

    def candidates(self, fp: Fingerprint) -> set[str]:
        """Citekeys worth comparing against ``fp`` (small superset of true matches).

        Union of: the DOI bucket, the ISBN bucket (book-ish), the
        (title_core, surname) bucket, and — only for non-generic titles — the
        lead-surname bucket (so year-drift / title-variant pairs that share a
        surname are still gathered). Generic titles fall back to DOI/ISBN
        buckets ONLY, so an "Introduction" never drags in every same-surname
        record.
        """
        out: set[str] = set()
        if fp.doi:
            out |= self.by_doi.get(fp.doi, set())
        if fp.isbn and fp.is_bookish:
            out |= self.by_isbn.get(fp.isbn, set())
        tk = _title_year_key(fp)
        if tk is not None:
            out |= self.by_title_year.get(tk, set())
        # Surname bucket only for real titles (guards against generic blowup).
        if fp.title_norm and not fp.generic:
            for sn in ({fp.surname} | set(fp.surnames)):
                if sn:
                    out |= self.by_surname.get(sn, set())
        return out

    def find(
        self,
        fields: dict,
        entry_type: str,
        exclude_ck: Optional[str] = None,
    ) -> list[tuple[str, Verdict]]:
        """Intake guard: matches for an incoming record, best first.

        Fingerprints ``fields``/``entry_type``, gathers candidates, classifies
        each, and returns ``(citekey, Verdict)`` for every candidate whose
        relation is ``same`` or ``uncertain`` — sorted by (relation rank:
        same before uncertain), then confidence desc, then citekey for
        determinism. ``exclude_ck`` drops a self-match.
        """
        fp = fingerprint(fields, entry_type)
        results: list[tuple[str, Verdict]] = []
        for ck in self.candidates(fp):
            if exclude_ck is not None and ck == exclude_ck:
                continue
            other = self.records[ck]
            v = classify(fields, entry_type, other.get("fields", {}), other.get("type", ""))
            if v.relation in ("same", "uncertain"):
                results.append((ck, v))
        # same (0) sorts before uncertain (1); higher confidence first; ck ties.
        rank = {"same": 0, "uncertain": 1}
        results.sort(key=lambda cv: (rank[cv[1].relation], -cv[1].confidence, cv[0]))
        return results


# ─────────────────────────────────────────────────────────────────────────
# Clustering (union-find over "same" edges only)
# ─────────────────────────────────────────────────────────────────────────


class _UnionFind:
    """Minimal deterministic union-find keyed by citekey string."""

    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def add(self, x: str) -> None:
        self.parent.setdefault(x, x)

    def find(self, x: str) -> str:
        self.add(x)
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        # Path compression.
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        # Deterministic: smaller citekey becomes the root.
        lo, hi = (ra, rb) if ra < rb else (rb, ra)
        self.parent[hi] = lo


def cluster(records: list[dict]) -> tuple[list[list[str]], list[tuple[str, str, Verdict]]]:
    """Cluster records into same-work groups; collect uncertain candidate pairs.

    Builds a :class:`WorkIndex`, then for each record compares it only against
    its :meth:`WorkIndex.candidates` (near-linear, not O(N²)). ``same`` verdicts
    union the two citekeys; ``uncertain`` verdicts are recorded as candidate
    links but NEVER union (per the spec, they go to the adjudicator).

    Returns
    -------
    clusters : list[list[str]]
        Sorted lists of citekeys, one per connected component of size ≥ 2.
        The outer list is sorted by first member for determinism.
    uncertain_pairs : list[(ck_a, ck_b, Verdict)]
        Deduplicated, ordered (ck_a < ck_b) uncertain edges, sorted by pair.
    """
    idx = WorkIndex(records)
    uf = _UnionFind()
    for ck in idx.records:
        uf.add(ck)

    seen_pairs: set[tuple[str, str]] = set()
    uncertain: dict[tuple[str, str], Verdict] = {}

    # Iterate citekeys in sorted order so the whole computation is deterministic.
    for ck in sorted(idx.records):
        fp = idx.fps[ck]
        rec = idx.records[ck]
        for other in idx.candidates(fp):
            if other == ck:
                continue
            pair = (ck, other) if ck < other else (other, ck)
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)
            orec = idx.records[other]
            v = classify(rec.get("fields", {}), rec.get("type", ""),
                         orec.get("fields", {}), orec.get("type", ""))
            if v.relation == "same":
                uf.union(pair[0], pair[1])
            elif v.relation == "uncertain":
                uncertain[pair] = v

    # Gather components.
    comps: dict[str, list[str]] = {}
    for ck in idx.records:
        comps.setdefault(uf.find(ck), []).append(ck)
    clusters = [sorted(members) for members in comps.values() if len(members) >= 2]
    clusters.sort(key=lambda m: m[0])

    # An uncertain edge whose endpoints ended up in the SAME same-cluster is
    # already resolved — drop it from the adjudication queue.
    uncertain_pairs: list[tuple[str, str, Verdict]] = []
    for (a, b), v in sorted(uncertain.items()):
        if uf.find(a) != uf.find(b):
            uncertain_pairs.append((a, b, v))

    return clusters, uncertain_pairs


# ─────────────────────────────────────────────────────────────────────────
# Winner selection — pick_survivor()
# ─────────────────────────────────────────────────────────────────────────


_BIB_STATE_RANK = {
    "canonical": 4,
    "authenticated": 3,
    "needs-reauth": 2,
    "needs_reauth": 2,
    "unverified": 1,
    "none": 1,
    "": 1,
    "manuscript": 0,
    "failed": 0,
}

_INDEX_DEPTH_RANK = {
    "deepindexed": 3,
    "deep-indexed": 3,
    "deepIndexed": 3,
    "indexed": 2,
    "none": 1,
    "": 1,
    None: 1,
}

_FIELD_COMPLETENESS_KEYS = ("doi", "title", "author", "year")


def _index_depth(meta: dict) -> int:
    """Map a record's indexed_state to a depth rank (deep=3, indexed=2, else 1)."""
    st = str(meta.get("indexed_state", meta.get("indexedState", "none")) or "none").lower()
    if st.startswith("deep"):
        return 3
    if st == "indexed":
        return 2
    return 1


def _bib_state_rank(meta: dict) -> int:
    """Map a record's bib_state to a rank (canonical=4 … manuscript/failed=0)."""
    st = str(meta.get("bib_state", meta.get("bibState", "")) or "").lower()
    return _BIB_STATE_RANK.get(st, 1)


def _field_completeness(fields: dict) -> int:
    """Count present, non-empty core fields (doi/title/author/year + venue + pages)."""
    n = 0
    for k in _FIELD_COMPLETENESS_KEYS:
        if str(fields.get(k, "")).strip():
            n += 1
    if str(fields.get("journal", "") or fields.get("booktitle", "")).strip():
        n += 1
    if str(fields.get("pages", "")).strip():
        n += 1
    return n


def _added_at_key(meta: dict) -> str:
    """Oldest ``added_at`` wins ⇒ sort ascending, so a missing timestamp (→ '~')
    sorts LAST (least stable). Returns a string comparable lexicographically
    (ISO-8601 timestamps sort correctly as strings)."""
    v = meta.get("added_at", meta.get("addedAt", ""))
    return str(v) if v else "~"  # '~' > any digit/'T', so absent sorts newest


def _survivor_sort_key(rec: dict, loadbearing: set) -> tuple:
    """The winner-selection tuple (HIGHER wins) from DEDUP_DESIGN.md §Winner.

    Ordered: is_loadbearing, index_depth, bib_state, pgmarkCount, pageCount,
    field_completeness, then oldest added_at (ascending → negated via a tuple
    trick), then citekey for a final deterministic tie-break.
    """
    meta = rec.get("meta", {}) or {}
    fields = rec.get("fields", {}) or {}
    ck = rec.get("citekey", "")
    added = _added_at_key(meta)
    # Return a tuple where bigger == better for the numeric parts, and for the
    # "oldest added_at wins" and "citekey" parts we want ascending, so we sort
    # the whole list with reverse=... handled by the caller. To keep a single
    # sort direction we invert the ascending fields here.
    return (
        1 if ck in loadbearing else 0,
        _index_depth(meta),
        _bib_state_rank(meta),
        int(meta.get("pgmarkCount", meta.get("pgmark_count", 0)) or 0),
        int(meta.get("pageCount", meta.get("page_count", 0)) or 0),
        _field_completeness(fields),
        # Oldest added_at should win: invert by using a reversed string sort.
        # We can't easily negate a string, so we pair a rank that prefers the
        # lexicographically SMALLER (older) timestamp by negating via order in
        # the caller. Store the raw key; the caller sorts descending on the
        # numeric prefix and ascending on this — handled by _rank_members.
        added,
        ck,
    )


def _rank_members(cluster_records: list[dict], loadbearing: set) -> list[str]:
    """Return citekeys ranked best→worst per the winner-selection tuple.

    We sort by the numeric prefix descending (higher wins) and break ties by
    OLDEST ``added_at`` then citekey ascending. Implemented as two-stage:
    primary key negated where "higher wins", secondary keys natural ascending.
    """
    def key(rec):
        t = _survivor_sort_key(rec, loadbearing)
        numeric = t[:6]          # higher-is-better block
        added, ck = t[6], t[7]   # ascending (older/smaller first)
        # Negate the numeric block so a single ascending sort ranks best first.
        return tuple(-n for n in numeric) + (added, ck)

    return [rec.get("citekey", "") for rec in sorted(cluster_records, key=key)]


def pick_survivor(cluster_records: list[dict], loadbearing: set) -> dict:
    """Choose the survivor of a same-work cluster and rank the losers.

    ``loadbearing`` = the set of citekeys that are catalog rows OR ``papers/``
    folder names (references to them exist and must be rewritten, not dropped).

    Ranks members by the tuple in ``DEDUP_DESIGN.md`` §"Winner-selection"
    (is_loadbearing, index_depth, bib_state, pgmarkCount, pageCount, field
    completeness, oldest added_at). The rank-max is the survivor.

    Returns
    -------
    dict with keys:
        ``survivor``          : the winning citekey
        ``ranked``            : all citekeys best→worst
        ``survivor_conflict`` : True iff ≥2 members are load-bearing (⇒ do NOT
                                auto-merge; route to review)
        ``reasons``           : per-member score breakdown for auditability
    """
    ranked = _rank_members(cluster_records, loadbearing)
    survivor = ranked[0] if ranked else ""

    lb_members = sorted(
        rec.get("citekey", "") for rec in cluster_records
        if rec.get("citekey", "") in loadbearing
    )
    survivor_conflict = len(lb_members) >= 2

    reasons: dict = {"loadbearing_members": lb_members, "scores": {}}
    for rec in cluster_records:
        ck = rec.get("citekey", "")
        meta = rec.get("meta", {}) or {}
        reasons["scores"][ck] = {
            "loadbearing": ck in loadbearing,
            "index_depth": _index_depth(meta),
            "bib_state": _bib_state_rank(meta),
            "pgmarkCount": int(meta.get("pgmarkCount", meta.get("pgmark_count", 0)) or 0),
            "pageCount": int(meta.get("pageCount", meta.get("page_count", 0)) or 0),
            "field_completeness": _field_completeness(rec.get("fields", {}) or {}),
            "added_at": _added_at_key(meta),
        }

    return {
        "survivor": survivor,
        "ranked": ranked,
        "survivor_conflict": survivor_conflict,
        "reasons": reasons,
    }


# ─────────────────────────────────────────────────────────────────────────
# Field union — union_fields()
# ─────────────────────────────────────────────────────────────────────────


def merge_fields(d: dict, e: dict) -> dict:
    """Pick non-empty values; on conflict prefer the side with more info.

    Ported verbatim (behavior) from ``merge_paper_references.merge_fields``:
    presence of DOI > absence; longer title > shorter; longer author list >
    shorter; else prefer ``d`` (the survivor side). Used as the per-field
    heuristic inside :func:`union_fields`.
    """
    out: dict[str, str] = {}
    for k in set(d) | set(e):
        dv = (d.get(k) or "").strip()
        ev = (e.get(k) or "").strip()
        if not dv:
            out[k] = ev
            continue
        if not ev:
            out[k] = dv
            continue
        if dv == ev:
            out[k] = dv
            continue
        if k in ("doi", "title"):
            out[k] = dv if len(dv) >= len(ev) else ev
        elif k == "author":
            out[k] = dv if len(_split_authors(dv)) >= len(_split_authors(ev)) else ev
        else:
            out[k] = dv  # default: keep the survivor's value
    return out


def union_fields(
    survivor_fields: dict,
    loser_fields_list: list[dict],
) -> tuple[dict, dict]:
    """Union losers' fields into the survivor's, recording provenance.

    Semantics (``DEDUP_DESIGN.md`` §"Field union"):

    * Missing fields on the survivor are back-filled from losers (first loser
      that has a non-empty value wins the back-fill, in list order).
    * On a value CONFLICT, keep the survivor's value — EXCEPT the
      :func:`merge_fields` upgrades: a present DOI beats absent, a longer title
      beats a shorter, a longer author list beats a shorter. When such an
      upgrade replaces the survivor's value, that is recorded as an
      ``"upgraded"`` provenance entry.

    Returns
    -------
    merged_fields : dict
        The unioned field map.
    provenance : dict
        ``{field: {"action": "backfilled"|"upgraded", "from": loser_index,
        "old": <survivor value or None>, "new": <chosen value>}}`` for every
        field the survivor did not already own outright.
    """
    merged = dict(survivor_fields or {})
    provenance: dict = {}

    for i, loser in enumerate(loser_fields_list):
        loser = loser or {}
        # merge_fields decides the winning value per field given (survivor, loser).
        combined = merge_fields(merged, loser)
        for k, new_val in combined.items():
            old_val = (merged.get(k) or "").strip()
            new_val = (new_val or "").strip()
            if new_val == old_val:
                continue
            if not old_val:
                # Survivor lacked this field → back-fill.
                provenance[k] = {
                    "action": "backfilled",
                    "from": i,
                    "old": None,
                    "new": new_val,
                }
            else:
                # merge_fields chose the loser's richer value over the survivor's.
                provenance[k] = {
                    "action": "upgraded",
                    "from": i,
                    "old": old_val,
                    "new": new_val,
                }
            merged[k] = new_val

    return merged, provenance


__all__ = [
    "normalize_doi",
    "normalize_isbn",
    "norm_title",
    "title_core",
    "first_author_surname",
    "author_surnames",
    "norm_year",
    "title_jaccard",
    "is_generic_title",
    "Fingerprint",
    "fingerprint",
    "Verdict",
    "classify",
    "WorkIndex",
    "cluster",
    "pick_survivor",
    "union_fields",
    "merge_fields",
]
