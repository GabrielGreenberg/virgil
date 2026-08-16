#!/usr/bin/env python3
"""sync_skills slice — the terminal-side skill sync (twin of skill-sync.ts).

Pins the behavior contract the app's sync engine defines, against a local
fixture bundle (no network):

  • the routing table: all four disk_path_for rules land where skill-sync.ts's
    diskPathFor lands them, and an unrecognized shape is SKIPPED, not written
  • a fresh folder syncs whole and stamps {version, syncedAt, files}
  • version-match → early return, nothing rewritten (mtime pinned)
  • a file that LEFT the bundle is deleted on the next sync
  • --check reports stale (exit 1) / fresh (exit 0) and never writes
  • folder resolution: explicit arg wins; else nearest .virgil/ ancestor
  • a network/manifest error exits 2 (soft-fail — a session must not block)

Run from anywhere:  python3 editor/scripts/tests/test_sync_skills.py
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "editor/scripts"
SYNC = str(SCRIPTS / "sync_skills.py")

sys.path.insert(0, str(SCRIPTS))
import sync_skills  # noqa: E402

PASS = 0
FAIL = 0


def check(cond, msg):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  \033[32mPASS\033[0m {msg}")
    else:
        FAIL += 1
        print(f"  \033[31mFAIL\033[0m {msg}")


def make_bundle(tmp: Path, version: str, editor_files: dict[str, str]) -> Path:
    """A minimal served-bundle dir: manifest + the four routing shapes."""
    bundle = tmp / f"bundle-{version}"
    sources = [
        {"name": "library", "version": "lib1", "files": ["CLAUDE.md", "claude-commands/deep-index.md"]},
        {"name": "editor", "version": version, "files": list(editor_files)},
        {"name": "manifest", "version": "man1", "files": ["INDEX.md"]},
    ]
    (bundle / "library").mkdir(parents=True)
    (bundle / "library/CLAUDE.md").write_text("workspace claude\n")
    (bundle / "library/claude-commands").mkdir()
    (bundle / "library/claude-commands/deep-index.md").write_text("deep index\n")
    (bundle / "manifest").mkdir()
    (bundle / "manifest/INDEX.md").write_text("manifest index\n")
    for rel, body in editor_files.items():
        p = bundle / "editor" / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body)
    (bundle / "bundle-manifest.json").write_text(
        json.dumps({"version": version, "generatedAt": "t", "sources": sources})
    )
    return bundle


def run(args, cwd=None):
    return subprocess.run([sys.executable, SYNC, *args],
                          capture_output=True, text=True, cwd=cwd)


tmp = Path(tempfile.mkdtemp(prefix="sync-skills-test-"))
paper = tmp / "paper"
(paper / ".virgil").mkdir(parents=True)

v1 = make_bundle(tmp, "v1aaaaaaaaaa", {
    "claude-commands/draft-footnote.md": "df v1\n",
    "claude-commands/_ask-shape.md": "doctrine v1\n",
    "scripts/apply_response.py": "print('apply v1')\n",
    "unrecognized/odd.bin": "never lands\n",
})

print("— routing + fresh sync —")
r = run([str(paper), "--from-local", str(v1)])
check(r.returncode == 0, f"fresh sync exits 0 (got {r.returncode}: {r.stdout}{r.stderr})")
check((paper / ".claude/CLAUDE.md").read_text() == "workspace claude\n",
      "library/CLAUDE.md → .claude/CLAUDE.md")
check((paper / ".claude/commands/library/deep-index.md").exists(),
      "library claude-commands → .claude/commands/library/")
check((paper / ".claude/commands/editor/draft-footnote.md").exists()
      and (paper / ".claude/commands/editor/_ask-shape.md").exists(),
      "editor claude-commands (incl. _-prefixed doctrine) → .claude/commands/editor/")
check((paper / ".virgil/scripts/editor/apply_response.py").exists(),
      "editor scripts → .virgil/scripts/editor/")
check((paper / ".claude/virgil/INDEX.md").exists(), "manifest → .claude/virgil/")
check(not list(paper.rglob("odd.bin")), "unrecognized bundle shape is skipped, not written")

stamp = json.loads((paper / ".virgil/.skill-bundle-version.json").read_text())
check(stamp["version"] == "v1aaaaaaaaaa" and "syncedAt" in stamp,
      "stamp carries {version, syncedAt}")
check("editor/scripts/apply_response.py" in stamp["files"]
      and "editor/unrecognized/odd.bin" not in stamp["files"],
      "stamp files list = managed entries only")

print("— idempotence —")
marker = paper / ".claude/commands/editor/draft-footnote.md"
before = marker.stat().st_mtime_ns
r = run([str(paper), "--from-local", str(v1)])
check(r.returncode == 0 and marker.stat().st_mtime_ns == before,
      "version match → early return, nothing rewritten")

print("— --check —")
r = run([str(paper), "--from-local", str(v1), "--check"])
check(r.returncode == 0 and "fresh" in r.stdout, "--check on fresh folder exits 0")
v2 = make_bundle(tmp, "v2bbbbbbbbbb", {
    "claude-commands/draft-footnote.md": "df v2\n",
    "scripts/apply_response.py": "print('apply v2')\n",
})
r = run([str(paper), "--from-local", str(v2), "--check"])
check(r.returncode == 1 and "STALE" in r.stdout, "--check on stale folder exits 1")
check(marker.read_text() == "df v1\n", "--check never writes")

print("— update + departed-file cleanup —")
r = run([str(paper), "--from-local", str(v2)])
check(r.returncode == 0 and marker.read_text() == "df v2\n", "stale folder updates in place")
check(not (paper / ".claude/commands/editor/_ask-shape.md").exists(),
      "a file that left the bundle is deleted")
check((paper / ".claude/CLAUDE.md").exists(),
      "…while still-listed files survive")
stamp2 = json.loads((paper / ".virgil/.skill-bundle-version.json").read_text())
check(stamp2["version"] == "v2bbbbbbbbbb", "stamp advances")

print("— folder resolution —")
nested = paper / "sections/deep"
nested.mkdir(parents=True)
r = run(["--from-local", str(v2), "--check"], cwd=str(nested))
check(r.returncode == 0, "no arg → nearest .virgil/ ancestor of cwd (fresh)")
r = run(["--from-local", str(v2), "--check"], cwd=str(tmp))
check(r.returncode == 2, "no .virgil/ anywhere above cwd → exit 2, no crash")

print("— soft failure —")
r = run([str(paper), "--from-local", str(tmp / "nonexistent-bundle")])
check(r.returncode == 2 and "continuing with the on-disk bundle" in r.stdout,
      "unreadable bundle source → exit 2 with a soft-fail message")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
