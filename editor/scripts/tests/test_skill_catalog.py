#!/usr/bin/env python3
r"""Task 1056 — `skill_catalog.py` is the front door's routing vocabulary.

The harness skill listing drops or truncates descriptions under its budget, so
`/virgil/start` reads every skill's frontmatter through this helper instead.
This suite runs it against the REAL skill dirs (the repo layout) and against a
synthetic managed folder (`.claude/commands/<silo>/`, the synced layout, with
the helper at `.virgil/scripts/editor/`), and pins the parse on the shapes
that defeat a naive reader: a `Heavy operation` hard-wrapped across a line, a
`HEAVY` casing, a bracketed optional id, a plain (non-block) scalar.

Run from anywhere:  python3 editor/scripts/tests/test_skill_catalog.py
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HELPER = ROOT / "editor/scripts/skill_catalog.py"

sys.path.insert(0, str(HELPER.parent))
import skill_catalog  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok  {label}")
    else:
        FAIL += 1
        print(f"  FAIL {label}")


def run(*args, script=HELPER):
    r = subprocess.run([sys.executable, str(script), *args], capture_output=True, text=True)
    rows = [json.loads(l) for l in r.stdout.splitlines() if l.strip()]
    return r, {row["name"]: row for row in rows}


# ---------------------------------------------------------------- the real skill set
print("\n=== the repo's own skills (derived from the helper's location) ===")
r, cat = run()
check(r.returncode == 0, "exits 0")
on_disk = sorted(
    f"{silo}:{p.stem}"
    for silo in ("editor", "library")
    for p in (ROOT / silo / "skills").glob("*.md")
    if not p.name.startswith("_")
)
check(sorted(cat) == on_disk, f"one row per skill file ({len(on_disk)})")
check(all(len(v["description"]) > 40 for v in cat.values()), "no empty description")
check(all("\n" not in v["description"] and "  " not in v["description"] for v in cat.values()),
      "every description whitespace-normalised")

heavy = sorted(n.split(":", 1)[1] for n, v in cat.items() if v["heavy"] and n.startswith("library:"))
for n in ("ai-requests", "deep-index", "index-pending", "merge-bibs", "triage-pending"):
    check(n in heavy, f"library:{n} heavy")
check("setup" not in heavy, "library:setup not heavy ('the heavy extraction tools' is an adjective)")
for n in ("index-paper", "triage-pdf", "authenticate-bib", "apply-bib-edit"):
    check(cat[f"library:{n}"]["light"] and not cat[f"library:{n}"]["heavy"], f"library:{n} light")

check(cat["editor:create-card"]["requiredIds"] == [], "create-card: bracketed [<requestId>] is optional")
check(cat["editor:draft-footnote"]["requiredIds"] == ["<requestId>"], "draft-footnote requires <requestId>")
check(cat["editor:answer-bib-review"]["requiredIds"] == ["<bibKey>"], "answer-bib-review requires <bibKey>")
check(cat["editor:accept-suggestion"]["requiredIds"] == [], "accept-suggestion takes a cardId, no inbox id")
check(cat["editor:dream"]["developerOnly"] and not cat["editor:review"]["developerOnly"], "developerOnly")
check(cat["editor:review"]["slash"] == "/editor/review", "slash spelling")

# ---------------------------------------------------------------- parse edge cases
print("\n=== parse shapes ===")
d = skill_catalog.parse_description(
    "---\ndescription: |\n  Drains it. Heavy\n  operation — from the library.\n---\nbody\n")
check(d == "Drains it. Heavy operation — from the library.", "block scalar, wrap collapsed")
d = skill_catalog.parse_description("---\ndescription: Plain one\n  continues here.\nname: x\n---\n")
check(d == "Plain one continues here.", "plain scalar with continuation, stops at next key")
d = skill_catalog.parse_description('---\ndescription: "Quoted value"\n---\n')
check(d == "Quoted value", "quoted scalar")
check(skill_catalog.parse_description("no frontmatter") is None, "no frontmatter → None")
check(skill_catalog.required_ids("X. Args: <docPath> [<requestId>] --kind=<k>.") == [],
      "bracketed id is optional")
check(skill_catalog.required_ids("X. Args: <docPath> <requestId>.") == ["<requestId>"],
      "terminal Args line")

# ---------------------------------------------------------------- the synced layout
print("\n=== a managed folder (helper synced under .virgil/scripts/editor/) ===")
tmp = Path(tempfile.mkdtemp(prefix="t1056-"))
try:
    scripts = tmp / ".virgil/scripts/editor"
    scripts.mkdir(parents=True)
    shutil.copy(HELPER, scripts / "skill_catalog.py")
    lib = tmp / ".claude/commands/library"
    lib.mkdir(parents=True)
    (lib / "big-op.md").write_text(
        "---\ndescription: |\n  Does it all. Triggers on: \"go\". HEAVY\n  operation — library only.\n---\n")
    (lib / "_include.md").write_text("---\ndescription: not a skill\n---\n")
    r, cat = run(script=scripts / "skill_catalog.py")
    check(r.returncode == 0 and list(cat) == ["library:big-op"], "reads .claude/commands, skips _includes")
    check(cat.get("library:big-op", {}).get("heavy") is True, "wrapped HEAVY operation detected")
    r, cat = run("--root", str(tmp / "nowhere"))
    check(r.returncode == 1 and "no skills found" in r.stderr, "empty vocabulary exits 1, loud")
finally:
    shutil.rmtree(tmp)

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
