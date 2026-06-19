"""Unit test for the bib-import flag helpers in _tools.py.

Covers the additions-only invalidation that backs the "imported" badge:
- references_bib_keys: parse the citekey set from references.bib
- mark_bib_imported: stamp imported + importedAt + importedKeys
- bib_import_added_keys / invalidate_bib_imported_if_added: a NEW entry
  flips imported off; a REMOVED entry does not (additions-only)
- invalidate_changed_imports: the steady-state sweep

Run from anywhere:  python3 library/scripts/tests/test_bib_import.py
"""
import json
import shutil
import sys
import tempfile
from pathlib import Path

# library/scripts is one level up from tests/
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import _tools as T

CK = "smith2020"


def _refs_text(*citekeys: str) -> str:
    return "".join(
        f"@article{{{ck},\n  title = {{Title {ck}}},\n  year = {{2020}}\n}}\n"
        for ck in citekeys
    )


def _write_refs(lib: Path, *citekeys: str) -> None:
    (lib / "papers" / CK / "references.bib").write_text(_refs_text(*citekeys))


def _seed_catalog(lib: Path) -> None:
    cat = {
        "version": 1,
        "generatedAt": "x",
        "entries": [{
            "citekey": CK,
            "addedAt": "x",
            "updatedAt": "x",
            "pdf": {"present": True},
            "indexed": {"state": "deepIndexed"},
            "bib": {"state": "authenticated"},
        }],
    }
    (lib / ".virgil" / "catalog.json").write_text(json.dumps(cat, indent=2) + "\n")


def _bib(lib: Path) -> dict:
    return T.read_catalog(lib)["entries"][0]["bib"]


def main() -> int:
    lib = Path(tempfile.mkdtemp())
    try:
        (lib / ".virgil").mkdir(parents=True)
        (lib / "papers" / CK).mkdir(parents=True)
        _seed_catalog(lib)
        _write_refs(lib, "smith2020", "jones2019", "doe2018")

        # references_bib_keys → sorted citekey set
        assert T.references_bib_keys(lib, CK) == ["doe2018", "jones2019", "smith2020"], \
            T.references_bib_keys(lib, CK)

        # Not imported yet → nothing added, invalidation is a no-op.
        assert T.bib_import_added_keys(lib, CK) == []
        assert T.invalidate_bib_imported_if_added(lib, CK) is False

        # Mark imported → flag + snapshot land on the row.
        T.mark_bib_imported(lib, CK)
        b = _bib(lib)
        assert b.get("imported") is True, b
        assert b.get("importedKeys") == ["doe2018", "jones2019", "smith2020"], b
        assert "importedAt" in b, b

        # No change → no additions, stays imported.
        assert T.bib_import_added_keys(lib, CK) == []
        assert T.invalidate_bib_imported_if_added(lib, CK) is False
        assert _bib(lib).get("imported") is True

        # REMOVAL only → additions-only means it stays imported.
        _write_refs(lib, "smith2020", "jones2019")  # dropped doe2018
        assert T.bib_import_added_keys(lib, CK) == []
        assert T.invalidate_bib_imported_if_added(lib, CK) is False
        assert _bib(lib).get("imported") is True

        # ADDITION (even alongside a removal) → flips off.
        _write_refs(lib, "smith2020", "jones2019", "newcite2021")
        assert T.bib_import_added_keys(lib, CK) == ["newcite2021"], \
            T.bib_import_added_keys(lib, CK)
        assert T.invalidate_bib_imported_if_added(lib, CK) is True
        assert _bib(lib).get("imported") is False

        # Re-import then add → the sweep clears it and reports the citekey.
        T.mark_bib_imported(lib, CK)
        assert _bib(lib).get("imported") is True
        _write_refs(lib, "smith2020", "jones2019", "newcite2021", "another2022")
        assert T.invalidate_changed_imports(lib) == [CK]
        assert _bib(lib).get("imported") is False

        # Sweep with nothing imported → empty, no error.
        assert T.invalidate_changed_imports(lib) == []

        print("OK test_bib_import")
        return 0
    finally:
        shutil.rmtree(lib, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
