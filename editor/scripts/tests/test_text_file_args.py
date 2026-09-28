#!/usr/bin/env python3
r"""Task 815 — every FREE-TEXT flag of the two editor writing doors takes `@<path>`.

`create_card.py`'s `--body/--title/--notes/--item/--task-text` and
`apply_response.py complete-only --note` used to be plain argparse strings, and
the skills taught them as DOUBLE-QUOTED argv. Inside bash double quotes a
backtick is command substitution and `$x` is parameter expansion, so LaTeX
prose lost its ``opening quotes'' and its $math$ — silently, exit 0 — and a
footnote body was spliced into the .tex mangled, through the pen, `ok: true`.

This suite drives the REAL shell path the skills now teach (a quoted heredoc
into `mktemp -d` scratch, then `--body "@$t/body"`) and asserts the payload
lands BYTE-EXACT in the sidecar and in the .tex splice. The control leg runs
the retired double-quoted form through the same bash and shows the mangle, so
the suite proves the hazard it exists for rather than assuming it.

Run from anywhere:  python3 editor/scripts/tests/test_text_file_args.py
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SAMPLE = ROOT / "samples/annotation-history"
SCRIPTS = ROOT / "editor/scripts"
CREATE = str(SCRIPTS / "create_card.py")
APPLY = str(SCRIPTS / "apply_response.py")

sys.path.insert(0, str(SCRIPTS))
from _common import text_arg  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1
        print(f"  \033[31mFAIL\033[0m {label}")


def sandbox():
    d = Path(tempfile.mkdtemp(prefix="t815-"))
    dst = d / "paper"
    shutil.copytree(SAMPLE, dst)
    return dst


def bash(script):
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True)


def load(doc, name):
    return json.loads((doc / "virgil" / name).read_text())


def tex_of(doc):
    return next(doc.glob("*.tex")).read_text(encoding="utf-8")


def out_of(r):
    return json.loads(r.stdout) if r.stdout.strip().startswith("{") else {}


def first_text(content):
    return content.get("content", [{}])[0].get("content", [{}])[0].get("text")


# Every hazard a double-quoted argv eats or a hand-quoter trips on: backtick
# quotes (command substitution), $math$ (parameter expansion), an apostrophe,
# a backslash command, a literal double quote.
HAZARD = r"""As ``annotation'' shows, O'Neill's cost is $n$ per \emph{gloss} ("sic")."""
ANCHOR = "3301"
NOTE_REQ = "826ec44d-3572-4e53-8f4d-6c877fe02715"  # kind=note, open in the sample

# ---------------------------------------------------------------- the hazard is real
print("\n=== control: the retired double-quoted argv mangles LaTeX ===")
r = bash("printf '%s' \"As ``annotation'' shows, the cost is $n$ per x.\"")
check(r.stdout == "As annotation'' shows, the cost is $ per x.",
      f"bash ate the backticks and $n (got {r.stdout!r})")

# ---------------------------------------------------------------- text_arg unit
print("\n=== text_arg: @path reads the file; one heredoc newline dropped ===")
d = Path(tempfile.mkdtemp(prefix="t815u-"))
(d / "a").write_text(HAZARD + "\n", encoding="utf-8")
check(text_arg(f"@{d / 'a'}") == HAZARD, "trailing heredoc newline dropped, rest byte-exact")
(d / "b").write_text("line one\nline two\n\n", encoding="utf-8")
check(text_arg(f"@{d / 'b'}") == "line one\nline two\n", "only ONE trailing newline dropped; interior kept")
(d / "c").write_text("no newline", encoding="utf-8")
check(text_arg(f"@{d / 'c'}") == "no newline", "file without trailing newline unchanged")
check(text_arg("plain value") == "plain value", "a non-@ value passes through")
check(text_arg(None) is None, "None passes through")

# ---------------------------------------------------------------- footnote via the taught block
print("\n=== footnote (chat path) through heredoc scratch → footnotes.json + .tex ===")
sb = sandbox()
r = bash(f"""
t=$(mktemp -d -t virgil-txt.XXXXXX)
cat > "$t/body" <<'TXT'
{HAZARD}
TXT
cat > "$t/ask" <<'TXT'
add a footnote on O'Neill's `cost`
TXT
python3 "{CREATE}" "{sb}" --kind=footnote --anchor {ANCHOR} --safety-level 1 \\
    --body "@$t/body" --task-text "@$t/ask"; rc=$?
rm -rf "$t"
exit "$rc"
""")
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:160]})")
fid = out_of(r).get("footnoteId")
entry = next((f for f in load(sb, "footnotes.json")["footnotes"] if f["id"] == fid), {})
check(first_text(entry.get("content", {})) == HAZARD, "footnotes.json body byte-exact")
check(f"\\vfid{{{fid}}}\\footnote{{{HAZARD}}}" in tex_of(sb), ".tex \\footnote{} splice byte-exact")
syn = next((q for q in load(sb, "ai-requests.json")["requests"] if q.get("resultId") == fid), {})
check("O'Neill's `cost`" in json.dumps(syn, ensure_ascii=False), "--task-text @file recorded on the synthesized Task")

# ---------------------------------------------------------------- note title + body
print("\n=== note: --title and --body both @file ===")
sb = sandbox()
r = bash(f"""
t=$(mktemp -d -t virgil-txt.XXXXXX)
cat > "$t/title" <<'TXT'
Re: ``gloss'' at $x$
TXT
cat > "$t/body" <<'TXT'
{HAZARD}
TXT
python3 "{CREATE}" "{sb}" --kind=note --anchor 4402 --safety-level 1 \\
    --title "@$t/title" --body "@$t/body"; rc=$?
rm -rf "$t"
exit "$rc"
""")
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:160]})")
nid = out_of(r).get("cardId")
note = next((c for c in load(sb, "notes.json")["cards"] if c["id"] == nid), {})
check(note.get("title") == "Re: ``gloss'' at $x$", f"note title byte-exact (got {note.get('title')!r})")
check(first_text(note.get("content", {})) == HAZARD, "note body byte-exact")

# ---------------------------------------------------------------- todo notes keep interior newlines
print("\n=== todo: --notes @file keeps an interior newline ===")
sb = sandbox()
t = Path(tempfile.mkdtemp(prefix="t815n-"))
(t / "body").write_text("Check $p$ in ``Bayle''.\n", encoding="utf-8")
(t / "notes").write_text("first line\nsecond `line`\n", encoding="utf-8")
r = subprocess.run([sys.executable, CREATE, str(sb), "--kind=todo", "--anchor", "4402",
                    "--safety-level", "1", "--body", f"@{t / 'body'}", "--notes", f"@{t / 'notes'}"],
                   capture_output=True, text=True)
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:160]})")
tid = out_of(r).get("cardId")
todo = next((c for c in load(sb, "todos.json")["items"] if c["id"] == tid), {})
check(todo.get("text") == "Check $p$ in ``Bayle''.", "todo text byte-exact")
check(todo.get("notes") == "first line\nsecond `line`", "todo notes byte-exact incl. newline")

# ---------------------------------------------------------------- example rows (repeatable flag)
print("\n=== example: each repeated --item reads its own file ===")
sb = sandbox()
(t / "i1").write_text("a gloss on $p$;\n", encoding="utf-8")
(t / "i2").write_text("an ``interlinear'' note.\n", encoding="utf-8")
r = subprocess.run([sys.executable, CREATE, str(sb), "--kind=example", "--anchor", "2208",
                    "--label", "ex:t815", "--item", f"@{t / 'i1'}", "--item", f"@{t / 'i2'}"],
                   capture_output=True, text=True)
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:160]})")
tex = tex_of(sb)
check("\\a a gloss on $p$;" in tex and "\\a an ``interlinear'' note." in tex, "both \\a rows byte-exact in .tex")

# ---------------------------------------------------------------- complete-only --note
print("\n=== complete-only --note @file ===")
sb = sandbox()
(t / "note").write_text("Could not find ``the'' source for $n$.\n", encoding="utf-8")
r = subprocess.run([sys.executable, APPLY, str(sb), "complete-only", NOTE_REQ,
                    "--result", "impossible", "--note", f"@{t / 'note'}"],
                   capture_output=True, text=True)
check(r.returncode == 0, f"complete-only exited 0 (stderr={r.stderr.strip()[:160]})")
# The note becomes the completion's `summary`, which the audit notification carries.
landed = json.dumps(load(sb, "notifications.json"), ensure_ascii=False)
check("Could not find ``the'' source for $n$." in landed, "completion note byte-exact in the notification summary")

# ---------------------------------------------------------------- missing file fails loud
print("\n=== a missing @file fails loud, writes nothing ===")
sb = sandbox()
before = (sb / "virgil" / "footnotes.json").read_text()
r = subprocess.run([sys.executable, CREATE, str(sb), "--kind=footnote", "--anchor", ANCHOR,
                    "--safety-level", "1", "--body", "@/nonexistent/t815-body"],
                   capture_output=True, text=True)
check(r.returncode != 0 and "text file not found" in r.stderr, "non-zero exit naming the missing file")
check((sb / "virgil" / "footnotes.json").read_text() == before, "footnotes.json untouched")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
