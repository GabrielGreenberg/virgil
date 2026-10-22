/**
 * A `vi.mock` factory that omits an export the code under test CALLS must fail
 * the test that made the call — not log a line and pass (task 1231).
 *
 * Not a suite; a helper `vitest.setup.ts` installs for every file (it lives
 * beside [_mock-storage.ts](_mock-storage.ts) for the reason that one does).
 *
 * THE GAP. A factory replaces its module WHOLESALE, and vitest answers a read
 * of a name the factory did not return by THROWING
 * `[vitest] No "<name>" export is defined on the "<module>" mock`. Thrown from
 * inside a hook's save, that error lands in the hook's own `catch` — which, for
 * every content sidecar, is a `console.error("Failed to save …")` and a refusal
 * record. The test then passes without the write it believes it exercised. The
 * 2026-10-22 gate sweep found nineteen such lines from seven suites whose
 * hand-written `@/lib/storage` factories predated `mutateSidecar` (task 1078's
 * one write door), and every future export of every mocked module reopens the
 * same silent gap.
 *
 * THE RULE. The setup file wraps `console.error` / `console.warn` once per
 * worker; any argument whose text (a string, or an Error's message / cause
 * chain) carries vitest's missing-export message is RECORDED, and the setup's
 * `afterEach` (and `afterAll`, for a write that settles after the file's last
 * test) calls {@link assertNoMockExportGaps}, which throws — failing the test.
 * It is module-agnostic: any mocked module, not just storage. A missing export
 * that escapes as an unhandled rejection already fails the run on its own.
 *
 * The residual, stated rather than implied: a suite that REPLACES
 * `console.error` with a silent spy (`vi.spyOn(console, "error")
 * .mockImplementation(() => {})`) sits above the wrapper and hides what it
 * swallows, and a `catch` that logs nothing at all is invisible here. The
 * construction half — {@link mockStorageModule} derives every storage export —
 * is what covers those.
 *
 * Pinned by [mock-export-gap.test.tsx](mock-export-gap.test.tsx).
 */

/** vitest's own wording (`startVitestModuleRunner`'s `callFunctionMock`). */
export const MOCK_EXPORT_GAP = /No "([^"]+)" export is defined on the "([^"]+)" mock/;

/**
 * The detector's state lives on `globalThis`, not in this module: the setup
 * file re-evaluates per test file inside one worker, and a wrapper installed by
 * an earlier evaluation must record into the SAME list the later one drains.
 */
const STORE = Symbol.for("virgil.mockExportGap");

interface GapStore {
  installed: boolean;
  gaps: string[];
}

function store(): GapStore {
  const g = globalThis as unknown as Record<symbol, GapStore | undefined>;
  return (g[STORE] ??= { installed: false, gaps: [] });
}

/** The missing-export message carried by `value`, if any. */
function gapIn(value: unknown, depth = 0): string | null {
  if (depth > 4 || value == null) return null;
  if (typeof value === "string") {
    const m = MOCK_EXPORT_GAP.exec(value);
    return m ? `"${m[1]}" is not defined on the "${m[2]}" mock` : null;
  }
  if (value instanceof Error || (typeof value === "object" && "message" in value)) {
    const err = value as { message?: unknown; cause?: unknown };
    return gapIn(err.message, depth + 1) ?? gapIn(err.cause, depth + 1);
  }
  return null;
}

/** Record every missing-export message among one console call's arguments. */
export function noteMockExportGaps(args: readonly unknown[]): void {
  for (const arg of args) {
    const gap = gapIn(arg);
    if (gap) store().gaps.push(gap);
  }
}

/** Wrap `console.error` / `console.warn` — once per worker, however many files run. */
export function installMockExportGapDetector(): void {
  const s = store();
  if (s.installed) return;
  s.installed = true;
  for (const level of ["error", "warn"] as const) {
    const original = console[level];
    console[level] = function (this: Console, ...args: unknown[]) {
      noteMockExportGaps(args);
      return original.apply(this, args);
    };
  }
}

/** Drain what has been recorded (the pinning suite's way of clearing its own gap). */
export function takeMockExportGaps(): string[] {
  return store().gaps.splice(0);
}

/**
 * Throw if any missing-export message was logged since the last check. Called
 * by `vitest.setup.ts`'s `afterEach` / `afterAll`.
 */
export function assertNoMockExportGaps(when: string): void {
  const gaps = takeMockExportGaps();
  if (gaps.length === 0) return;
  const unique = [...new Set(gaps)];
  throw new Error(
    `A vi.mock factory is missing an export the code under test called ` +
      `(${when}; ${gaps.length} logged): ${unique.join("; ")}. The call threw ` +
      `inside a catch that only logged it, so the test was about to pass ` +
      `without the behaviour it exercises. Add the export to the factory — for ` +
      `@/lib/storage, use mockStorageModule() from ` +
      `src/lib/__tests__/_mock-storage.ts, which derives every export (task 1231).`,
  );
}
