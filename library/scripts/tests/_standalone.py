"""A no-pytest test runner that injects fixtures BY NAME (task 510).

WHY THIS EXISTS. Three suites in this directory carried the same hand-written
`__main__` runner, and all three injected their fixture POSITIONALLY::

    fn(Path(d))          # every test takes exactly `tmp_path`, or else

`test_f4_writer_side.py` has one leg that also takes pytest's `capsys` (it
asserts on the JSON `merge_bibs_postflight` prints). Under pytest it passes;
under the standalone runner it raised ``TypeError: missing 1 required
positional argument: 'capsys'`` and the file reported 18/19 — locally, for
months, with nobody's CI the wiser, because nothing in `npm test` drove that
file at all.

That is the class this file closes: **a leg that cannot run is a habit, not a
guard.** The runner now reads each test's SIGNATURE and builds the fixtures it
names, so a leg taking a fixture nobody supports FAILS LOUDLY, naming it,
instead of disappearing into a TypeError that reads like an ordinary failure.

WHAT IT SUPPORTS, and what it deliberately does not. Two fixtures — `tmp_path`
and `capsys` — because those are the two these suites use. It is not a pytest
re-implementation: no parametrize, no yield fixtures, no monkeypatch (the
suites that need `monkeypatch` already run under their own `_run_standalone`
and are untouched). Adding one is a table entry plus a builder; guessing at
one is how a shim starts lying about what it ran.
"""

from __future__ import annotations

import inspect
import io
import tempfile
import traceback
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from typing import Any, Callable, Iterator


class _Captured:
    """The `.out` / `.err` pair `capsys.readouterr()` answers with."""

    def __init__(self, out: str, err: str) -> None:
        self.out = out
        self.err = err


class _CapSys:
    """A minimal `capsys`: capture stdout/stderr, drained by `readouterr()`.

    pytest's fixture drains on every read (a second call sees only what was
    written since the first), which the shipped legs rely on, so this does the
    same rather than accumulating.
    """

    def __init__(self, out: io.StringIO, err: io.StringIO) -> None:
        self._out = out
        self._err = err

    def readouterr(self) -> _Captured:
        out, err = self._out.getvalue(), self._err.getvalue()
        self._out.seek(0)
        self._out.truncate(0)
        self._err.seek(0)
        self._err.truncate(0)
        return _Captured(out, err)


def _run_one(fn: Callable[..., Any]) -> None:
    """Call `fn`, building each fixture its signature names."""
    params = list(inspect.signature(fn).parameters)
    unknown = [p for p in params if p not in ("tmp_path", "capsys")]
    if unknown:
        # Loud, and named. The whole point: the alternative is a TypeError
        # that reads like the test itself failing.
        raise AssertionError(
            f"standalone runner cannot supply fixture(s) {unknown!r} — "
            f"teach _standalone.py or drop them from {fn.__name__}"
        )
    with tempfile.TemporaryDirectory() as d:
        kwargs: dict[str, Any] = {}
        if "tmp_path" in params:
            kwargs["tmp_path"] = Path(d)
        if "capsys" not in params:
            fn(**kwargs)
            return
        out, err = io.StringIO(), io.StringIO()
        kwargs["capsys"] = _CapSys(out, err)
        with redirect_stdout(out), redirect_stderr(err):
            fn(**kwargs)


def run_standalone(namespace: dict[str, Any]) -> int:
    """Run every `test_*` in `namespace`; print a `<n>/<n> passed` tally.

    The tally format is load-bearing: the vitest shells that drive these
    suites assert on it (`f4-write-gate-python.test.ts` and its siblings), so
    a runner that printed something else would fail those guards on a machine
    where the Python actually passed.
    """
    fns = [v for k, v in sorted(namespace.items())
           if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            _run_one(fn)
            print(f"PASS {fn.__name__}")
        except Exception:
            failed += 1
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    return 1 if failed else 0
