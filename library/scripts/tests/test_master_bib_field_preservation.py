"""Field-preservation guard on the `update_master_bib_entry.py` shim.

The shim's write is a WHOLE-BLOCK REPLACEMENT: `_tools.update_master_bib_entry`
replaces the brace-balanced `@<type>{<citekey>, ...}` block with one emitted from
exactly the fields dict handed in, and the shim passes `--fields-file` through
unmerged. A caller holding a *change-set* (an auth pass, a Crossref backfill, a
cover-page metadata correction) therefore used to destroy every field it didn't
mention — pages, volume, publisher, doi, isbn, url, note — in the library's
authoritative master.bib, silently (task 2026-07-18-164 M1).

The guard refuses that write and names the three ways through:
  --merge-existing    incoming fields merge OVER the entry's current ones
  --drop-field NAME   remove this NAMED field (composes with --merge-existing)
  --allow-field-drop  trust the caller's omissions (a complete, user-edited entry)

It is the replace-side twin of the append-side duplicate-work guard, so neither
half of the upsert can lose data.

Run: python3 -m pytest library/scripts/tests/test_master_bib_field_preservation.py -v
"""
import subprocess
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

from _tools import read_master_bib  # noqa: E402

_SHIM = str(_SCRIPTS / "update_master_bib_entry.py")

_FULL_ENTRY = """@article{smith2020,
  author = {Smith, John},
  title = {An Example Paper},
  year = {2020},
  journal = {Journal of Examples},
  volume = {12},
  pages = {45--67},
  doi = {10.1234/example.2020}
}
"""


def _init_library(tmp_path: Path, bib: str = _FULL_ENTRY) -> Path:
    (tmp_path / ".virgil").mkdir(parents=True, exist_ok=True)
    (tmp_path / "master.bib").write_text(bib)
    return tmp_path


def _run(library: Path, citekey: str, fields: dict, *extra: str,
         entry_type: str = "article") -> subprocess.CompletedProcess:
    import json
    ff = library / "_fields.json"
    ff.write_text(json.dumps(fields))
    return subprocess.run(
        [sys.executable, _SHIM, citekey,
         "--entry-type", entry_type,
         "--fields-file", str(ff),
         "--library", str(library), *extra],
        capture_output=True, text=True,
    )


def _fields(library: Path, citekey: str) -> dict:
    return read_master_bib(library / "master.bib")[citekey]["fields"]


def test_partial_fields_replace_is_refused(tmp_path):
    """The reported bug: a change-set write that would drop 5 fields."""
    lib = _init_library(tmp_path)
    r = _run(lib, "smith2020", {"title": "A Corrected Title"})
    assert r.returncode == 4, r.stderr
    # The message names what would have been lost, so the operator can choose.
    for lost in ("author", "year", "journal", "volume", "pages", "doi"):
        assert lost in r.stderr
    assert "--merge-existing" in r.stderr and "--allow-field-drop" in r.stderr
    # Nothing was written.
    assert _fields(lib, "smith2020")["title"] == "An Example Paper"


def test_merge_existing_keeps_untouched_fields(tmp_path):
    lib = _init_library(tmp_path)
    r = _run(lib, "smith2020",
             {"title": "A Corrected Title", "issn": "1234-5678"},
             "--merge-existing")
    assert r.returncode == 0, r.stderr
    f = _fields(lib, "smith2020")
    assert f["title"] == "A Corrected Title"   # incoming wins
    assert f["issn"] == "1234-5678"            # new field added
    assert f["doi"] == "10.1234/example.2020"  # untouched field survives
    assert f["pages"] == "45--67"
    assert f["author"] == "Smith, John"


def test_merge_existing_is_case_insensitive_per_field(tmp_path):
    """`read_master_bib` lowercases names — an incoming `DOI` must not
    land alongside the on-file `doi` as a duplicate field."""
    lib = _init_library(tmp_path)
    r = _run(lib, "smith2020", {"DOI": "10.9999/new"}, "--merge-existing")
    assert r.returncode == 0, r.stderr
    f = _fields(lib, "smith2020")
    assert f["doi"] == "10.9999/new"
    assert lib.joinpath("master.bib").read_text().lower().count("doi = {") == 1


def test_allow_field_drop_permits_deliberate_removal(tmp_path):
    lib = _init_library(tmp_path)
    r = _run(lib, "smith2020",
             {"author": "Smith, John", "title": "An Example Paper",
              "year": "2020", "booktitle": "A Collection",
              "publisher": "Example Press"},
             "--allow-field-drop", entry_type="incollection")
    assert r.returncode == 0, r.stderr
    f = _fields(lib, "smith2020")
    assert "journal" not in f            # dropped on the type change
    assert f["booktitle"] == "A Collection"
    assert read_master_bib(lib / "master.bib")["smith2020"]["type"] == "incollection"


def test_complete_field_set_passes_unflagged(tmp_path):
    """No flag needed when the caller really does hand a complete entry."""
    lib = _init_library(tmp_path)
    complete = dict(_fields(lib, "smith2020"))
    complete["title"] = "A Corrected Title"
    r = _run(lib, "smith2020", complete)
    assert r.returncode == 0, r.stderr
    assert _fields(lib, "smith2020")["doi"] == "10.1234/example.2020"


def test_append_is_never_field_guarded(tmp_path):
    """A brand-new citekey has nothing to drop — triage's append path."""
    lib = _init_library(tmp_path)
    r = _run(lib, "jones2021", {"author": "Jones, Ada", "title": "New Work",
                                "year": "2021"}, "--no-guard")
    assert r.returncode == 0, r.stderr
    assert _fields(lib, "jones2021")["title"] == "New Work"


def test_drop_field_composes_with_merge_existing(tmp_path):
    """The @article → @incollection auth path: `journal` stops applying, but
    --merge-existing re-adds every current field, so omission can no longer say
    "remove this". --drop-field is applied AFTER the merge and is the one
    removal signal that survives it. (--allow-field-drop is inert here — it
    trusts omissions, and the merge leaves nothing omitted.)"""
    lib = _init_library(tmp_path)
    r = _run(lib, "smith2020",
             {"booktitle": "A Collection", "publisher": "Example Press"},
             "--merge-existing", "--drop-field", "journal",
             entry_type="incollection")
    assert r.returncode == 0, r.stderr
    f = _fields(lib, "smith2020")
    assert "journal" not in f              # named removal took effect
    assert f["booktitle"] == "A Collection"
    assert f["doi"] == "10.1234/example.2020"   # merge still preserved the rest
    assert f["pages"] == "45--67"


def test_drop_field_alone_needs_no_allow_flag(tmp_path):
    """Naming a field IS the deliberate-removal signal, so it does not also
    trip the omission refusal for that field."""
    lib = _init_library(tmp_path)
    r = _run(lib, "smith2020", {}, "--merge-existing", "--drop-field", "DOI")
    assert r.returncode == 0, r.stderr
    f = _fields(lib, "smith2020")
    assert "doi" not in f                  # case-insensitive match on the name
    assert f["author"] == "Smith, John"


_NFD_ENTRY = (
    "@article{tichý1976,\n"
    "  author = {Tichý, Pavel},\n"
    "  title = {Verisimilitude Redefined},\n"
    "  year = {1976},\n"
    "  journal = {BJPS},\n"
    "  pages = {25--42},\n"
    "  doi = {10.1093/bjps/27.1.25}\n"
    "}\n"
)


def test_diacritic_citekey_cannot_bypass_the_guard(tmp_path):
    """The entry is stored NFD; the caller passes NFC. `read_master_bib` keys
    entries byte-for-byte while the writer searches under BOTH forms — so a raw
    `citekey in existing` test would report "append", skip the guard entirely,
    and then let the writer find and whole-block-replace the entry anyway. That
    is the exact data loss the guard exists to prevent (1976-Tichý memo)."""
    lib = _init_library(tmp_path, _NFD_ENTRY)
    nfc = "tichý1976"
    r = _run(lib, nfc, {"title": "A Corrected Title"})
    assert r.returncode == 4, f"guard was bypassed: rc={r.returncode} {r.stderr}"
    assert "author" in r.stderr and "doi" in r.stderr
    # Untouched on disk.
    assert "Verisimilitude Redefined" in (lib / "master.bib").read_text()


def test_diacritic_citekey_merge_is_not_a_silent_noop(tmp_path):
    """Same normalization mismatch, with --merge-existing: the flag must
    actually merge rather than fall through to an unguarded whole-block write."""
    lib = _init_library(tmp_path, _NFD_ENTRY)
    r = _run(lib, "tichý1976", {"title": "A Corrected Title"},
             "--merge-existing")
    assert r.returncode == 0, r.stderr
    text = (lib / "master.bib").read_text()
    assert "A Corrected Title" in text
    for kept in ("Tich", "1976", "BJPS", "25--42", "10.1093/bjps/27.1.25"):
        assert kept in text, f"{kept!r} was destroyed"


def test_empty_valued_field_is_not_a_silent_clear(tmp_path):
    """`""` values are stripped before the write, so clearing a field via an
    empty string reads as a DROP and is refused rather than applied silently."""
    lib = _init_library(tmp_path)
    complete = dict(_fields(lib, "smith2020"))
    complete["doi"] = ""
    r = _run(lib, "smith2020", complete)
    assert r.returncode == 4
    assert "doi" in r.stderr
    assert _fields(lib, "smith2020")["doi"] == "10.1234/example.2020"
