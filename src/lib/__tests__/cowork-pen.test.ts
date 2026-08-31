/**
 * **Task 489 — the cowork pen.**
 *
 * Gabriel: *"When Virgil is editing from cowork, can it flip a switch that
 * makes the doc read only (with some loud indicator to show what is
 * happening?). i feel like this might help with conflicted copies too."*
 *
 * The mechanism existed and the app could see half of it: `commit_under_pen`
 * writes `.virgil/pen-context.json` ALWAYS and `collab.json`'s pen only if that
 * file already exists, and `useCollab` read the second, and only while the USER
 * had turned collaborator mode on. On the ordinary solo paper the skill's pen
 * meant nothing at all.
 *
 * **No pre-489 suite could see any of this.** There is no `useCollab` suite in
 * the repo, `autosave-pause.test.ts` drove the watcher alone (a boolean with no
 * doc in it, so a per-document pause source is unrepresentable in it), and the
 * `save-state` suites sweep `UnsavedBlockReason` — a union `"cowork"` was not a
 * member of. Which is how a pen that the skills have been taking on every
 * commit for months reached exactly nothing.
 *
 * The leg with teeth is the CENSUS at the bottom, twice over: the ladder was
 * never the part that could misbehave — a consumer that re-derives "is the AI
 * editing?" from a hand-spelled holder string is, and so is a Python constant
 * that drifts from the TS vocabulary it cannot import.
 */

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import {
  COWORK_COLLAB_PEN_HOLDER,
  COWORK_PEN_CONTEXT_HOLDER,
  COWORK_PEN_CONTEXT_PATH,
  COWORK_PEN_MAX_AGE_MS,
  COWORK_PEN_TTL_MS,
  clearCoworkPen,
  coworkPenFromCollab,
  coworkPenFromContext,
  coworkPenHeld,
  getCoworkPen,
  isCoworkPenHolder,
  noteCoworkPen,
  resolveCoworkPen,
  subscribeCoworkPen,
} from "@/lib/cowork-pen";
import { describeBlockReason } from "@/lib/save-state";
import { codeOnly, commentsStripped, trackedFiles, REPO_ROOT } from "./_source-scan";

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const T0 = Date.parse("2026-08-26T12:00:00.000Z");
const iso = (t: number) => new Date(t).toISOString();

/** The record `acquire_pen` actually writes (see `_common.acquire_pen`). */
function penContextRecord(at = T0, ttlMs = COWORK_PEN_TTL_MS) {
  return {
    holder: COWORK_PEN_CONTEXT_HOLDER,
    acquired_at: iso(at),
    expires_at: iso(at + ttlMs),
    prior_collab_enabled: false,
    collab_existed: false,
    prior_pen: { holder: null },
  };
}

afterEach(() => clearCoworkPen());

/* ── The vocabulary ──────────────────────────────────────────────────── */

describe("the holder vocabulary", () => {
  it("recognises BOTH on-disk spellings, case-insensitively", () => {
    expect(isCoworkPenHolder("claude")).toBe(true);
    expect(isCoworkPenHolder("Claude")).toBe(true);
    expect(isCoworkPenHolder("  Claude  ")).toBe(true);
    expect(isCoworkPenHolder("CLAUDE")).toBe(true);
  });

  // The control that keeps the predicate from being "anything is the AI":
  // a HUMAN partner's pen must stay the human pen, or collaborator mode would
  // report every partner as a cowork skill and lock the doc with no takeover.
  it("does NOT recognise a human collaborator or a nonsense value", () => {
    expect(isCoworkPenHolder("Gabriel")).toBe(false);
    expect(isCoworkPenHolder("claudia")).toBe(false);
    expect(isCoworkPenHolder("")).toBe(false);
    expect(isCoworkPenHolder(null)).toBe(false);
    expect(isCoworkPenHolder(42)).toBe(false);
  });
});

/* ── Rung 1: the pen-context record ──────────────────────────────────── */

describe("rung 1 · .virgil/pen-context.json", () => {
  it("reads a live hold, with the record's own expiry", () => {
    const s = coworkPenFromContext(penContextRecord(), T0 + 1_000);
    expect(s).not.toBeNull();
    expect(s!.source).toBe("pen-context");
    expect(s!.holder).toBe("claude");
    expect(s!.expiresAt).toBe(T0 + COWORK_PEN_TTL_MS);
  });

  // Crash robustness — the whole reason this is the leading rung. A skill that
  // died between acquire and release leaves the file behind; nothing sweeps it,
  // so the TTL is what stops the document being wedged read-only.
  it("releases once the record's TTL has passed (a crashed skill)", () => {
    expect(
      coworkPenFromContext(penContextRecord(), T0 + COWORK_PEN_TTL_MS + 1),
    ).toBeNull();
  });

  // THE RELEASED RECORD (task 496). `release_pen` no longer DELETES the file —
  // on a mount that refuses deletion the raise rolled a committed collab
  // restore back to Claude-held and reported exit 2 on a landed write — so it
  // rewrites it with `holder: null`. This rung must read that as released
  // INSTANTLY, which it does because the holder gate runs before any clock
  // arithmetic: strictly better than delete-then-TTL, which leaves a 60 s
  // window in which a released pen still reads as live.
  it("reads a RELEASED record (holder: null) as no hold at all", () => {
    expect(
      coworkPenFromContext(
        { holder: null, released_at: new Date(T0).toISOString() },
        T0 + 1,
      ),
    ).toBeNull();
    // …and it is released for good, not merely not-yet-expired.
    expect(
      coworkPenFromContext(
        { holder: null, released_at: new Date(T0).toISOString() },
        T0 - 60_000,
      ),
    ).toBeNull();
  });

  // FAIL TOWARD RELEASING. A far-future expiry (clock skew, a hand-edited file,
  // a future skill that lengthens its own TTL) must not be able to hold the
  // document hostage: the app's ceiling wins.
  it("clamps an unbelievable expiry to the app's own ceiling", () => {
    const rec = penContextRecord(T0, 6 * 60 * 60 * 1000); // 6h
    const s = coworkPenFromContext(rec, T0 + 1_000);
    expect(s!.expiresAt).toBe(T0 + COWORK_PEN_MAX_AGE_MS);
    expect(
      coworkPenFromContext(rec, T0 + COWORK_PEN_MAX_AGE_MS + 1),
    ).toBeNull();
  });

  it("supplies a ceiling when the record states no expiry at all", () => {
    const rec = { ...penContextRecord(), expires_at: undefined };
    const s = coworkPenFromContext(rec, T0 + 1_000);
    expect(s!.expiresAt).toBe(T0 + COWORK_PEN_MAX_AGE_MS);
  });

  it("reads nothing from an absent, foreign or malformed record", () => {
    expect(coworkPenFromContext(null, T0)).toBeNull();
    expect(coworkPenFromContext(undefined, T0)).toBeNull();
    expect(coworkPenFromContext("not json", T0)).toBeNull();
    expect(
      coworkPenFromContext({ ...penContextRecord(), holder: "Gabriel" }, T0),
    ).toBeNull();
    expect(coworkPenFromContext({ acquired_at: iso(T0) }, T0)).toBeNull();
  });
});

/* ── Rung 2: the collab sidecar ──────────────────────────────────────── */

describe("rung 2 · collab.json's pen", () => {
  it("reads an AI hold on a collab-enabled paper", () => {
    const s = coworkPenFromCollab(
      { holder: COWORK_COLLAB_PEN_HOLDER, since: iso(T0), lastHeartbeat: iso(T0) },
      T0 + 1_000,
    );
    expect(s).not.toBeNull();
    expect(s!.source).toBe("collab");
  });

  // The AI never heartbeats — its whole hold is one atomic commit — so the
  // 5-minute `COLLAB_TIMINGS.penStaleMs` window a HUMAN holder gets would leave
  // a crashed skill holding a collab-enabled paper for five minutes.
  it("uses the AI's SHORT ceiling, not the human pen's 5-minute staleness", () => {
    const pen = {
      holder: COWORK_COLLAB_PEN_HOLDER,
      since: iso(T0),
      lastHeartbeat: iso(T0),
    };
    expect(coworkPenFromCollab(pen, T0 + COWORK_PEN_MAX_AGE_MS - 1)).not.toBeNull();
    expect(coworkPenFromCollab(pen, T0 + COWORK_PEN_MAX_AGE_MS + 1)).toBeNull();
  });

  it("reads nothing from a free pen or a HUMAN holder", () => {
    expect(coworkPenFromCollab({ holder: null }, T0)).toBeNull();
    expect(
      coworkPenFromCollab(
        { holder: "Gabriel", since: iso(T0), lastHeartbeat: iso(T0) },
        T0,
      ),
    ).toBeNull();
  });
});

/* ── The ladder ──────────────────────────────────────────────────────── */

describe("the ladder · one answer from two records", () => {
  it("answers from the pen-context record when both are present", () => {
    const s = resolveCoworkPen(
      {
        penContext: penContextRecord(),
        collabPen: {
          holder: COWORK_COLLAB_PEN_HOLDER,
          since: iso(T0),
          lastHeartbeat: iso(T0),
        },
      },
      T0 + 1_000,
    );
    expect(s!.source).toBe("pen-context");
  });

  // THE REPORTED CASE: an ordinary SOLO paper. `acquire_pen` touches
  // `collab.json` only if it already exists, so on this paper there is no
  // second record at all — and the pre-489 app read only that one.
  it("answers on a SOLO paper, where collab.json does not exist", () => {
    const s = resolveCoworkPen(
      { penContext: penContextRecord(), collabPen: null },
      T0 + 1_000,
    );
    expect(s).not.toBeNull();
    expect(s!.source).toBe("pen-context");
  });

  it("falls back to the sidecar rung when the pen-context record is gone", () => {
    const s = resolveCoworkPen(
      {
        penContext: null,
        collabPen: {
          holder: COWORK_COLLAB_PEN_HOLDER,
          since: iso(T0),
          lastHeartbeat: iso(T0),
        },
      },
      T0 + 1_000,
    );
    expect(s!.source).toBe("collab");
  });

  it("answers null when nothing holds the pen", () => {
    expect(resolveCoworkPen({ penContext: null, collabPen: null }, T0)).toBeNull();
    expect(resolveCoworkPen({}, T0)).toBeNull();
  });
});

/* ── The store ───────────────────────────────────────────────────────── */

describe("the store", () => {
  it("publishes and clears per document", () => {
    const s = coworkPenFromContext(penContextRecord(), T0)!;
    noteCoworkPen("a", s);
    expect(getCoworkPen("a")).not.toBeNull();
    expect(getCoworkPen("b")).toBeNull();
    noteCoworkPen("a", null);
    expect(getCoworkPen("a")).toBeNull();
  });

  // Keystroke sanctity's cousin: the poll runs every 5 s for the life of the
  // session, so an unchanged answer must cost ZERO notifications — otherwise
  // the whole EditorPane → paneState → EditorLayout cascade re-renders on a
  // clock nobody asked for.
  it("notifies only on a CHANGE, never once per poll", () => {
    let fired = 0;
    const un = subscribeCoworkPen(() => fired++);
    const s = coworkPenFromContext(penContextRecord(), T0)!;
    noteCoworkPen("a", s);
    expect(fired).toBe(1);
    noteCoworkPen("a", { ...s });
    noteCoworkPen("a", { ...s });
    expect(fired).toBe(1);
    noteCoworkPen("a", null);
    expect(fired).toBe(2);
    noteCoworkPen("a", null);
    expect(fired).toBe(2);
    un();
  });

  it("`coworkPenHeld` re-checks the expiry at READ time", () => {
    const s = coworkPenFromContext(penContextRecord(), T0)!;
    noteCoworkPen("a", s);
    expect(coworkPenHeld("a", T0 + 1_000)).toBe(true);
    expect(coworkPenHeld("a", s.expiresAt + 1)).toBe(false);
    expect(coworkPenHeld(null, T0)).toBe(false);
  });
});

/* ── The save-state vocabulary ───────────────────────────────────────── */

describe("the save-state reason", () => {
  it("`cowork` names no flow — the way out is to WAIT, not to answer", () => {
    const d = describeBlockReason("cowork");
    expect(d.flow).toBeNull();
    expect(d.short.toLowerCase()).toContain("virgil is editing");
    // The `never` arm's fallback would give the generic "Not saving" — the leg
    // that proves the reason is a real member rather than falling through.
    expect(d.short).not.toBe("Not saving");
  });
});

/* ── THE CENSUS ──────────────────────────────────────────────────────── */

describe("census · one pen vocabulary, one pause door", () => {
  const SSOT = "src/lib/cowork-pen.ts";

  /** Every shipped `.ts`/`.tsx` under `src/` and `library/`, tests excluded. */
  function productionFiles(): string[] {
    return [
      ...trackedFiles("src", /\.tsx?$/),
      ...trackedFiles("library", /\.tsx?$/),
    ].filter(
      (f) =>
        !f.includes("__tests__") &&
        !f.endsWith(".test.ts") &&
        !f.endsWith(".test.tsx"),
    );
  }

  // The door was never the part that could misbehave — a consumer that spells
  // the holder string itself is, and `pen.holder === "Claude"` type-checks
  // perfectly while answering a question this module owns. Allowlist EMPTY.
  it("nothing outside the SSOT spells a cowork holder or the pen-context path", () => {
    const needles = [
      `"${COWORK_PEN_CONTEXT_HOLDER}"`,
      `"${COWORK_COLLAB_PEN_HOLDER}"`,
      // The pen-context RECORD, by name. The hidden dir `.virgil/` itself is
      // deliberately NOT a needle: the Library silo reads its own skill-bundle
      // version file out of the same folder, which is a different question —
      // what this leg polices is the PEN record.
      "pen-context.json",
    ];
    const offenders: string[] = [];
    for (const abs of productionFiles()) {
      const f = relative(ROOT, abs);
      if (f === SSOT) continue;
      // Comments STRIPPED, string literals KEPT: the drift this leg exists to
      // catch lives in literals (`pen.holder === "Claude"`), while a file that
      // merely NAMES the AI in prose — `AuthorByline`'s "we never display
      // 'Claude'" — is not a second speller of the vocabulary.
      const src = commentsStripped(read(f));
      for (const n of needles) {
        if (src.includes(n)) offenders.push(`${f} · ${n}`);
      }
    }
    expect(
      offenders,
      "a cowork holder / the pen-context record's path is spelled in ONE place; " +
        "read the answer through `@/lib/cowork-pen` instead",
    ).toEqual([]);
    // …and the canary: the needles really do match, in the one file allowed to.
    const ssot = commentsStripped(read(SSOT));
    for (const n of needles) expect(ssot, `needle ${n} matches nothing`).toContain(n);
  });

  // The pre-489 shape: four call sites each hard-coding the mapping from "the
  // door said pause" to "the channel hears `conflict`". A second pause SOURCE
  // added under that shape gets the wrong voice — silently.
  it("no write door hard-codes the pause reason", () => {
    const src = codeOnly(read("src/hooks/useDocument.ts"));
    expect(src).not.toMatch(/noteSaveBlocked\(\s*docId\s*,\s*"conflict"\s*\)/);
    expect(src).toContain("autosavePauseReason(");
    // Every pause branch quotes the door's own answer.
    expect(src).toMatch(/noteSaveBlocked\(\s*docId\s*,\s*paused\s*\)/);
  });

  // The read-only gate is the other consumer, and it is the one the report is
  // about: a `canEditMainText` that asks only `sidecar.enabled` is the pre-489
  // tree, and it type-checks.
  it("the read-only gate reads the ladder's answer", () => {
    const src = codeOnly(read("src/hooks/useCollab.ts"));
    expect(src).toMatch(
      /const canEditMainText =\s*coworkPen === null &&\s*\(!sidecar\.enabled \|\| iHavePen\)/,
    );
    expect(src).toContain("resolveCoworkPen(");
    expect(src).toContain("noteCoworkPen(");
  });

  // The badge is the third, and a badge inside the collapse gate is a notice a
  // layout preference can hide — the rule task 357 wrote and task 392 restated.
  it("the badge is mounted BEFORE the topbarRightCollapsed gate", () => {
    const src = read("src/components/editor-layout/StatusCluster.tsx");
    const badge = src.indexOf("<CoworkPenBadge");
    const gate = src.indexOf("TIER 3: the collapsible tool group");
    expect(badge).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(-1);
    expect(badge).toBeLessThan(gate);
  });
});

/* ── PARITY with the skill side ──────────────────────────────────────── */

describe("parity · editor/scripts/_common.py", () => {
  // Python cannot import the TS SSOT, so what holds the two halves together is
  // this leg — the same instrument the marker census and the preservation
  // measure already use for the code they cannot reach. A rename on either side
  // is silent otherwise: the skill keeps taking a pen the app stops recognising,
  // and the document stops going read-only with nothing failing anywhere.
  const py = readFileSync(join(ROOT, "editor/scripts/_common.py"), "utf8");

  it("the pen-context holder matches", () => {
    expect(py).toContain(`PEN_CONTEXT_HOLDER = "${COWORK_PEN_CONTEXT_HOLDER}"`);
  });

  it("the collab display holder matches", () => {
    expect(py).toContain(`COLLAB_PEN_HOLDER = "${COWORK_COLLAB_PEN_HOLDER}"`);
  });

  it("the TTL matches", () => {
    expect(py).toContain(`PEN_TTL_SECONDS = ${COWORK_PEN_TTL_MS / 1000}`);
  });

  it("the pen-context record's path matches", () => {
    const [dir, file] = COWORK_PEN_CONTEXT_PATH.split("/");
    expect(py).toContain(`doc / "${dir}"`);
    expect(py).toContain(`"${file}"`);
  });

  // The app's ceiling must be at least the TTL the skill writes, or a LIVE hold
  // would be released the moment it was taken.
  it("the app's ceiling is at least the skill's own TTL", () => {
    expect(COWORK_PEN_MAX_AGE_MS).toBeGreaterThanOrEqual(COWORK_PEN_TTL_MS);
  });

  // …and the record's field names, which the ladder parses by hand.
  it("the record still carries the fields the ladder reads", () => {
    expect(py).toContain('"holder": PEN_CONTEXT_HOLDER');
    expect(py).toContain('"acquired_at": now_s');
    expect(py).toContain('"expires_at": expires_s');
  });

  // The RELEASE half of the same seam (task 496). The skill releases by
  // REWRITING the record with `holder: null` rather than deleting it, and the
  // rung above reads exactly that as released. If the skill ever went back to
  // a delete-and-hope, this leg is what says so — the behavioural rung would
  // stay green (an absent file is also "no hold"), while the delete is what
  // rolls the collab restore back and wedges the paper.
  it("the release REWRITES a released record rather than deleting it", () => {
    const body = py.slice(
      py.indexOf("def release_pen"),
      py.indexOf("def commit_under_pen"),
    );
    expect(body).toContain('"holder": None');
    expect(body).toContain("json_dumps(released)");
    // No `content is None` (delete) entry in the release's write-set.
    expect(body).not.toContain("), None)");
  });

  // A release-time IO error must not replace a LANDED commit's outcome.
  it("commit_under_pen guards its release", () => {
    const body = py.slice(py.indexOf("def commit_under_pen"));
    const finallyBlock = body.slice(body.indexOf("finally:"), body.indexOf("finally:") + 400);
    expect(finallyBlock).toMatch(/try:\s*\n\s*release_pen\(doc\)/);
    expect(finallyBlock).toContain("except Exception");
  });
});
