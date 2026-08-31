#!/usr/bin/env python3
"""Apply approved citekey renames to the live library (or a fixture).

Per rename old->new (new must be FREE):
  * master.bib : rewrite the entry opener `@type{old,` -> `@type{new,` (NFC/NFD).
  * catalog    : row.citekey old->new; if pdf.filename == '<old>.<ext>' rename it.
  * papers/    : papers/<old>/ -> papers/<new>/ ; files named '<old>.*' -> '<new>.*'.
  * aliases    : drop new->old; add old->new; repoint any X->old to X->new.
  * dedup-distinct.json : substitute old->new in recorded pairs.

Locks master.bib + catalog for the whole op. Backup required (off-library).
Usage: rename_apply.py --library L --verdicts V.json [--dry-run] [--backup-dir D] [--selftest]
"""
import argparse, json, os, re, sys, shutil, unicodedata, tempfile
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))
import _tools
from _tools import rmtree_tolerant


def _forms(k):
    return [unicodedata.normalize("NFC", k), unicodedata.normalize("NFD", k)]


def rename_in_master_text(text, old, new):
    """Rewrite the first `@type{old,` opener to `@type{new,`. Returns (text, ok)."""
    for of in _forms(old):
        pat = re.compile(r"(@\w+\s*\{\s*)" + re.escape(of) + r"(\s*,)")
        m = pat.search(text)
        if m:
            return text[:m.start()] + m.group(1) + unicodedata.normalize("NFC", new) + m.group(2) + text[m.end():], True
    return text, False


def apply_all(library, renames, dry_run, backup_dir):
    library = Path(library)
    master_path = library / "master.bib"
    catalog_path = library / ".virgil" / "catalog.json"
    papers = library / "papers"

    # preflight: every new must be free
    master = _tools.read_master_bib(master_path)
    mk = set(master.keys())
    catalog = _tools.read_catalog(library)
    catk = {r.get("citekey") for r in catalog.get("entries", [])}
    folders = set(os.listdir(papers)) if papers.is_dir() else set()
    problems = []
    for r in renames:
        new = r["new"]
        if new in mk or new in catk or new in folders:
            problems.append((r["old"], new, "target not free"))
        if r["old"] not in mk and r["old"] not in catk and r["old"] not in folders:
            problems.append((r["old"], new, "old not present anywhere"))
    if problems:
        print("PREFLIGHT problems (skipping these):")
        for p in problems:
            print("  ", p)
    skip = {p[0] for p in problems}
    renames = [r for r in renames if r["old"] not in skip]

    if dry_run:
        fold = sum(1 for r in renames if r["old"] in folders)
        print(f"DRY RUN: would rename {len(renames)} keys ({fold} with folders). No writes.")
        return 0

    if not backup_dir:
        print("ABORT: --backup-dir required", file=sys.stderr)
        return 2
    backup_dir = Path(backup_dir); backup_dir.mkdir(parents=True, exist_ok=True)
    _tools._atomic_write_text(backup_dir / "master.bib.bak", master_path.read_text())
    _tools._atomic_write_text(backup_dir / "catalog.json.bak", catalog_path.read_text())

    done = []
    # 1. master.bib — all renames, one locked read->write
    with _tools.lock_master_bib(library):
        text = master_path.read_text()
        for r in renames:
            text, ok = rename_in_master_text(text, r["old"], r["new"])
            if ok:
                done.append(r)
        _tools._atomic_write_text(master_path, text)
    _tools._mark_bib_index_dirty(library)

    # 2. catalog + filesystem
    with _tools.lock_catalog(library):
        catalog = _tools.read_catalog(library)
        by = {}
        for e in catalog.get("entries", []):
            by[e.get("citekey")] = e
        moved_folders = 0; moved_files = 0
        for r in renames:
            old, new = r["old"], r["new"]
            # folder rename
            src = None
            for f in _forms(old):
                if (papers / f).is_dir():
                    src = papers / f; break
            if src is not None:
                dst = papers / new
                if not dst.exists():
                    os.rename(src, dst); moved_folders += 1
                    # rename files literally named '<old>.*'
                    for child in list(dst.iterdir()):
                        for f in _forms(old):
                            if child.is_file() and child.name.startswith(f + "."):
                                ext = child.name[len(f):]
                                nf = dst / (new + ext)
                                if not nf.exists():
                                    os.rename(child, nf); moved_files += 1
                                break
            # catalog row
            row = by.get(old)
            if row is not None:
                row["citekey"] = new
                pdf = row.get("pdf") or {}
                fn = pdf.get("filename")
                if fn:
                    for f in _forms(old):
                        if fn.startswith(f + "."):
                            pdf["filename"] = new + fn[len(f):]
                            row["pdf"] = pdf
                            break
        _tools.write_catalog(library, catalog)

    # 3. aliases: drop new->old, add old->new, repoint X->old to X->new
    apath = library / ".virgil" / "aliases.json"
    aliases = json.loads(apath.read_text()) if apath.exists() else {}
    rename_map = {r["old"]: r["new"] for r in renames}
    new_aliases = {}
    for loser, info in aliases.items():
        surv = info.get("survivor")
        # repoint survivor if it was renamed
        if surv in rename_map:
            surv = rename_map[surv]
        # a loser that IS a new canonical key (new->old): drop it (new is now canonical)
        if loser in set(rename_map.values()):
            continue
        info = dict(info); info["survivor"] = surv
        new_aliases[loser] = info
    # add old->new
    for old, new in rename_map.items():
        new_aliases[old] = {"survivor": new, "work_key": None, "at": None, "reason": "citekey-rename"}
    _tools._atomic_write_text(apath, json.dumps(new_aliases, indent=2, ensure_ascii=False) + "\n")

    # 4. distinct registry substitution
    dpath = library / ".virgil" / "dedup-distinct.json"
    if dpath.exists():
        reg = json.loads(dpath.read_text())
        reg["pairs"] = [[rename_map.get(a, a), rename_map.get(b, b)] for a, b in reg.get("pairs", [])]
        _tools._atomic_write_text(dpath, json.dumps(reg, indent=1, ensure_ascii=False) + "\n")

    print(f"renamed {len(done)} master keys; folders moved {moved_folders}, files {moved_files}, "
          f"aliases now {len(new_aliases)}")
    # warn on residual old-citekey references inside renamed folders
    for r in renames:
        d = papers / r["new"]
        if d.is_dir():
            for probe in ("main.tex", "references.bib"):
                p = d / probe
                if p.exists() and r["old"] in p.read_text(errors="ignore"):
                    print(f"  NOTE: {r['new']}/{probe} still contains the old citekey {r['old']!r}")
    return 0


def selftest():
    """Build a tiny fixture library, rename, assert everything moved consistently."""
    tmp = Path(tempfile.mkdtemp(prefix="rename_selftest_"))
    (tmp / ".virgil").mkdir()
    (tmp / "papers" / "woods2002shape").mkdir(parents=True)
    (tmp / "papers" / "woods2002shape" / "woods2002shape.pdf").write_text("PDF")
    (tmp / "papers" / "woods2002shape" / "main.tex").write_text("\\pgmark{1} body")
    (tmp / "master.bib").write_text(
        "% bib.state = authenticated\n@article{woods2002shape,\n  title = {Shape perception},\n"
        "  author = {Murray, Scott O.},\n  year = {2002}\n}\n")
    cat = {"version": 1, "generatedAt": "x", "entries": [
        {"citekey": "woods2002shape", "pdf": {"present": True, "filename": "woods2002shape.pdf"},
         "indexed": {"state": "deepIndexed"}, "bib": {"state": "authenticated"}}]}
    (tmp / ".virgil" / "catalog.json").write_text(json.dumps(cat))
    (tmp / ".virgil" / "aliases.json").write_text(json.dumps({
        "murray2002shape": {"survivor": "woods2002shape", "reason": "dup"}}))
    renames = [{"old": "woods2002shape", "new": "murray2002shape", "decision": "approve"}]
    apply_all(tmp, renames, dry_run=False, backup_dir=str(tmp / "bk"))
    # asserts
    m = _tools.read_master_bib(tmp / "master.bib")
    assert "murray2002shape" in m and "woods2002shape" not in m, "master key not renamed"
    assert (tmp / "papers" / "murray2002shape" / "murray2002shape.pdf").exists(), "pdf not renamed"
    assert (tmp / "papers" / "murray2002shape" / "main.tex").exists(), "main.tex lost"
    assert not (tmp / "papers" / "woods2002shape").exists(), "old folder remains"
    cat2 = json.loads((tmp / ".virgil" / "catalog.json").read_text())
    row = cat2["entries"][0]
    assert row["citekey"] == "murray2002shape", "catalog citekey not renamed"
    assert row["pdf"]["filename"] == "murray2002shape.pdf", "pdf.filename not updated"
    al = json.loads((tmp / ".virgil" / "aliases.json").read_text())
    assert al.get("woods2002shape", {}).get("survivor") == "murray2002shape", "old->new alias missing"
    assert "murray2002shape" not in al, "stale new->old alias remains"
    rmtree_tolerant(tmp, what="selftest scratch dir")
    print("SELFTEST PASS: master+folder+pdf+catalog+aliases all renamed consistently")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--library"); ap.add_argument("--verdicts")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--backup-dir")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        selftest(); return 0
    verd = json.load(open(a.verdicts))
    renames = [v for v in verd if v.get("decision") == "approve"]
    return apply_all(a.library, renames, a.dry_run, a.backup_dir)


if __name__ == "__main__":
    sys.exit(main())
