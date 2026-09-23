/**
 * Cross-language parity pin for the "is this AI request open?" predicate
 * (task 2026-07-05-043).
 *
 * The decision lives in TWO languages that must agree byte-for-byte:
 *
 *   - TS: `isRequestOpen` (`src/lib/ai-request-open.ts`) — the SSOT the bridge
 *     (`ai-request-bridge.ts`) and the migration (`migrate-ai-request-cards.ts`)
 *     both call.
 *   - Python: `list_ai_requests` (`editor/scripts/list_requests.py`) — the drain
 *     the external skills read.
 *
 * They silently drifted once already (the drain grew the
 * `in-progress`+`resultId ⇒ answered` clause; the bridge's copy didn't), which
 * is the bug this test exists to forbid. It pins parity two ways:
 *
 *   1. **Matrix** — enumerate every `status × {resultId set / unset}` cell and
 *      assert `isRequestOpen` matches a byte-for-byte transcription of the
 *      Python rule.
 *   2. **Source pin** — read the live `list_requests.py` and assert its two
 *      guard clauses are still present verbatim, so a Python-side edit forces a
 *      human to re-verify the transcription (mirrors how
 *      `ai-request-routing-manifest.test.ts` reads the drain-consumed manifest).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isRequestOpen, isTerminalStatus } from "@/lib/ai-request-open";
import type { AiRequest, AiRequestStatus } from "@/lib/types";

/** src/lib/__tests__ → repo root. */
function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../..");
}

/** Read a live Python source file, repo-relative — the source-pin door. */
function pySource(rel: string): string {
  return readFileSync(join(repoRoot(), rel), "utf8");
}

/** Byte-for-byte transcription of the Python drain rule
 *  (`list_requests.py` `list_ai_requests`):
 *
 *    status = r.get("status")
 *    if status in ("complete", "failed"):
 *        continue
 *    if status == "in-progress" and r.get("resultId"):
 *        continue
 *    # else: open
 *
 *  `undefined` models a status-absent row (`r.get("status")` → None). */
function drainOpenReference(
  status: AiRequestStatus | undefined,
  hasResultId: boolean,
): boolean {
  if (status === "complete" || status === "failed") return false;
  if (status === "in-progress" && hasResultId) return false;
  return true;
}

/** Every non-absent `status` value the on-disk schema can carry, as a
 *  compile-time-exhaustive tuple: the `satisfies` clause forces this list to
 *  grow whenever a new member is added to `AiRequestStatus`, so a new terminal
 *  status can't be introduced without a human touching the terminal-set pin
 *  below. */
const CONCRETE_STATUSES = [
  "pending",
  "in-progress",
  "complete",
  "failed",
  "draft",
  "submitted",
] as const satisfies readonly AiRequestStatus[];

// Exhaustiveness guard: if `AiRequestStatus` grows a member, this line fails to
// compile until it is added to CONCRETE_STATUSES (and thus enters the matrix +
// terminal-set assertions). `never` iff the two sets are equal.
type _StatusExhaustive = Exclude<
  AiRequestStatus,
  (typeof CONCRETE_STATUSES)[number]
> extends never
  ? true
  : ["AiRequestStatus grew a member — add it to CONCRETE_STATUSES"];
const _statusExhaustive: _StatusExhaustive = true;
void _statusExhaustive;

/** Every `status` value the on-disk schema can carry, plus the absent case. */
const STATUSES: (AiRequestStatus | undefined)[] = [...CONCRETE_STATUSES, undefined];

/** The terminal-status reference set — the `{ complete, failed }` vocabulary
 *  the drain and the bridge both resolve through `isTerminalStatus`. Kept as an
 *  independent literal here so a drift between the helper and the frozen set
 *  (e.g. someone widens `isTerminalStatus` without updating the drain rule)
 *  trips this test. */
const TERMINAL_REFERENCE = new Set<AiRequestStatus>(["complete", "failed"]);

describe("isRequestOpen ↔ list_requests.py drain rule parity", () => {
  it("agrees with the drain rule across the status × resultId matrix", () => {
    for (const status of STATUSES) {
      for (const hasResultId of [false, true]) {
        const r = {
          status,
          ...(hasResultId ? { resultId: "card-x" } : {}),
        } as Pick<AiRequest, "status" | "resultId">;
        expect(isRequestOpen(r)).toBe(drainOpenReference(status, hasResultId));
      }
    }
  });

  it("classifies the answered-L3 cell (in-progress + resultId) as CLOSED", () => {
    // The one cell the two predicates disagreed on before the fix.
    expect(isRequestOpen({ status: "in-progress", resultId: "card-x" })).toBe(false);
    expect(isRequestOpen({ status: "in-progress" })).toBe(true);
  });

  it("treats an empty-string resultId as falsy (matches Python truthiness)", () => {
    // Python `r.get("resultId")` is falsy for "" — an in-progress row with a
    // blank resultId is still OPEN, same on both sides.
    expect(isRequestOpen({ status: "in-progress", resultId: "" })).toBe(true);
  });

  it("the live Python predicate still carries the two guard clauses verbatim", () => {
    // Since task 680 the two clauses live ONCE on the Python side too, in
    // `_common.is_request_open` — the twin of `isRequestOpen` — instead of
    // being transcribed at each reader. So the pin follows them there. A change
    // to either clause forces whoever edits the Python to re-check
    // `isRequestOpen` + `drainOpenReference` above.
    const collapsed = pySource("editor/scripts/_common.py").replace(/\s+/g, " ");
    expect(collapsed).toContain('if is_terminal_status(status): return False');
    expect(collapsed).toContain(
      'if status == STATUS_IN_PROGRESS and r.get("resultId"): return False',
    );
    expect(collapsed).toContain('TERMINAL_STATUSES = (STATUS_COMPLETE, STATUS_FAILED)');
  });

  it("the drain reads that ONE predicate — it does not re-inline the rule", () => {
    // The literal `("complete", "failed")` set used to appear in four Python
    // places (the drain's two lists, create_card's already-terminal no-op, and
    // apply_response's module constants). Folding them onto `_common` is what
    // makes a future terminal status land everywhere at once, exactly as
    // `isTerminalStatus` does on the TS side — so re-inlining it is the
    // regression this pins.
    const drain = pySource("editor/scripts/list_requests.py").replace(/\s+/g, " ");
    expect(drain).toContain("if not is_request_open(r): continue");
    expect(drain).not.toMatch(/\("complete", *"failed"\)/);
    const creator = pySource("editor/scripts/create_card.py").replace(/\s+/g, " ");
    expect(creator).not.toMatch(/\("complete", *"failed"\)/);
  });
});

/**
 * Cross-language parity pin for the CLOSE **arity** (task 2026-09-20-680).
 *
 * The open predicate above is only half the boundary. The other half is the
 * mutation it gates: archiving or deleting a flagged card must close EVERY
 * non-terminal linked row, because a card can carry TWO at once (an answered-L3
 * row plus a fresh re-toggled `pending` row — task 253). TS does that in the
 * bridge's `terminate` branch; Python does it in
 * `apply_response._Txn.close_linked_request`, which stopped at the FIRST match
 * for three months because nothing pinned the arity — the parity contract
 * covered the predicate and stopped one function short of the mutation the
 * predicate exists to gate.
 *
 * The BEHAVIOUR of the Python half is driven end-to-end through the real
 * `archive` op by `editor/scripts/tests/test_close_linked_arity.py` (run by
 * `npx vitest run` through `scripts/__tests__/python-suites.test.ts`). What is
 * pinned HERE is the thing only a cross-language test can see: that neither
 * side has quietly gone back to closing one row.
 */
describe("terminate-mode CLOSE arity ↔ close_linked_request parity", () => {
  /** The body of `close_linked_request`, from `def` to the next `def` at the
   *  same indentation. */
  function closeLinkedRequestBody(): string {
    const src = pySource("editor/scripts/apply_response.py");
    const start = src.indexOf("    def close_linked_request(");
    expect(start).toBeGreaterThan(-1);
    const next = src.indexOf("\n    def ", start + 1);
    return src.slice(start, next === -1 ? undefined : next);
  }

  it("the Python half closes ALL matches — no early return inside the match loop", () => {
    const body = closeLinkedRequestBody();
    // The pre-680 shape: `return True` immediately after stamping the row.
    expect(body).not.toMatch(/r\["result"\] = result\s*\n\s*self\.mark\(ar_path\)\s*\n\s*return True/);
    // The accumulator shape: keep scanning, mark once, report whether any closed.
    const collapsed = body.replace(/\s+/g, " ");
    expect(collapsed).toContain("closed = False");
    expect(collapsed).toContain("closed = True");
    expect(collapsed).toContain("if closed: self.mark(ar_path)");
    expect(collapsed).toContain("return closed");
  });

  it("it skips terminal rows through the shared predicate, so it stays idempotent", () => {
    const collapsed = closeLinkedRequestBody().replace(/\s+/g, " ");
    expect(collapsed).toContain("if is_terminal_status(status): continue");
    // The 043 hold: force=False leaves an answered-L3 row alone.
    expect(collapsed).toContain(
      'if not force and status == STATUS_IN_PROGRESS and r.get("resultId"): continue',
    );
  });

  it("the TS half maps over every match rather than finding the first", () => {
    const bridge = readFileSync(
      join(repoRoot(), "src/lib/ai-request-bridge.ts"),
      "utf8",
    );
    // Just the terminate branch — the `toggle` branch below it legitimately
    // uses `findIndex` (it matches ONE open row to re-use or replace).
    const start = bridge.indexOf('if (mode === "terminate")');
    expect(start).toBeGreaterThan(-1);
    const end = bridge.indexOf("\n    }", start);
    const collapsed = bridge.slice(start, end).replace(/\s+/g, " ");
    expect(collapsed).toContain("requests.map(");
    expect(collapsed).not.toContain("findIndex");
  });

  it("both halves stamp the same terminal pair (complete / auto-applied)", () => {
    const py = closeLinkedRequestBody().replace(/\s+/g, " ");
    expect(py).toContain('r["status"] = STATUS_COMPLETE');
    expect(py).toContain('r["result"] = result');
    // The caller that means "the card is gone" passes the same result token the
    // TS terminate branch names.
    const apply = pySource("editor/scripts/apply_response.py").replace(/\s+/g, " ");
    expect(apply).toContain("RESULT_AUTO_APPLIED = \"auto-applied\"");
    expect(apply).toContain("result=RESULT_AUTO_APPLIED, force=True");
    // The TS stamp itself now lives once, in `closeRequestRow` (task 720) —
    // the shape both terminal transitions write — and the terminate branch
    // names the same `"auto-applied"` token through it.
    const openSrc = readFileSync(
      join(repoRoot(), "src/lib/ai-request-open.ts"),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(openSrc).toContain('return { ...r, status: "complete", result };');
    const bridge = readFileSync(
      join(repoRoot(), "src/lib/ai-request-bridge.ts"),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(bridge).toContain('closeRequestRow(r, "auto-applied")');
  });
});

/**
 * Result-vocabulary parity (task 720).
 *
 * `status` had a cross-language pin from task 043 on; `result` never did — so
 * `"withdrawn"`, which the APP writes and no skill ever does, could have landed
 * on one side only, and a Python reader validating `--result` would have
 * refused a token its own file already carried. The two vocabularies are the
 * same set, and this reads both live.
 */
describe("AiRequestResult ↔ apply_response ALL_RESULTS", () => {
  /** Every member of the TS `AiRequestResult` union, read from its source. */
  function tsResults(): string[] {
    const src = readFileSync(join(repoRoot(), "src/lib/types.ts"), "utf8");
    const start = src.indexOf("export type AiRequestResult =");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf(";", start));
    return [...body.matchAll(/\|\s*"([a-z-]+)"/g)].map((m) => m[1]).sort();
  }

  /** Every member of the Python `ALL_RESULTS` set, resolved through `RESULT_*`. */
  function pyResults(): string[] {
    const src = pySource("editor/scripts/apply_response.py");
    const consts = new Map(
      [...src.matchAll(/^(RESULT_[A-Z_]+) = "([a-z-]+)"$/gm)].map((m) => [m[1], m[2]]),
    );
    const start = src.indexOf("ALL_RESULTS = {");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("}", start));
    return [...body.matchAll(/RESULT_[A-Z_]+/g)]
      .map((m) => {
        const v = consts.get(m[0]);
        expect(v, `${m[0]} has no RESULT_* literal`).toBeDefined();
        return v!;
      })
      .sort();
  }

  it("names exactly the same outcome tokens on both sides", () => {
    expect(tsResults()).toEqual(pyResults());
  });

  it("includes the app-only withdrawal token", () => {
    expect(tsResults()).toContain("withdrawn");
    expect(pyResults()).toContain("withdrawn");
  });

  it("reflect.py maps every outcome to a tier", () => {
    const reflect = pySource("editor/scripts/reflect.py");
    const start = reflect.indexOf("RESULT_TIER = {");
    expect(start).toBeGreaterThan(-1);
    const body = reflect.slice(start, reflect.indexOf("\n}", start));
    const mapped = [...body.matchAll(/"([a-z-]+)":\s*TIER_/g)].map((m) => m[1]).sort();
    expect(mapped).toEqual(tsResults());
  });
});

/**
 * Terminal-status SSOT pin (task 2026-07-23-221).
 *
 * `isTerminalStatus` is the shared `{ complete, failed }` predicate that BOTH
 * `isRequestOpen` (clause 1) and the bridge's `terminate`-mode guard
 * (`ai-request-bridge.ts` `isLinkedNonTerminal` — the `cmd_archive` "close EVERY
 * non-terminal linked row" match, task 253) now derive from, retiring the two hand-inlined copies. These
 * pins ensure a future terminal `AiRequestStatus` trips a test on BOTH
 * predicates, not just the open one: the exhaustiveness guard above forces the
 * new member into the matrix, and the coupling assertion forces it to agree with
 * `isRequestOpen`.
 */
describe("isTerminalStatus terminal-set SSOT", () => {
  it("matches the frozen { complete, failed } set across the full status matrix", () => {
    for (const status of CONCRETE_STATUSES) {
      expect(isTerminalStatus(status)).toBe(TERMINAL_REFERENCE.has(status));
    }
  });

  it("is coupled to isRequestOpen: every terminal status is CLOSED to the drain", () => {
    // This is the invariant the bridge's `terminate` guard leans on — a row it
    // treats as terminal (`!isTerminalStatus`) is exactly one `isRequestOpen`
    // treats as closed. If a new terminal status were added to `isTerminalStatus`
    // but `isRequestOpen`'s clause 1 stopped reading it, this fails.
    for (const status of CONCRETE_STATUSES) {
      if (isTerminalStatus(status)) {
        // resultId is irrelevant for a terminal row — closed either way.
        expect(isRequestOpen({ status })).toBe(false);
        expect(isRequestOpen({ status, resultId: "card-x" })).toBe(false);
      }
    }
  });

  it("agrees with the drain's terminal literal (the Python { complete, failed })", () => {
    // The same `("complete", "failed")` set the drain source-pin above asserts
    // verbatim — proving the TS terminal SSOT and the Python drain rule share one
    // terminal vocabulary.
    for (const status of CONCRETE_STATUSES) {
      const pythonTerminal = status === "complete" || status === "failed";
      expect(isTerminalStatus(status)).toBe(pythonTerminal);
    }
  });
});
