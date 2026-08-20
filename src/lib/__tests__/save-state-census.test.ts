/**
 * **THE CENSUS** — task 392's actual deliverable.
 *
 * Gabriel's ask was "verify that auto-save is working properly." A one-off
 * verification answers that for one afternoon; what makes it permanent is a
 * guard that fails when a gate is added without a voice — because the incident
 * of 2026-08-19 was not a broken autosave. It was a CORRECT guard that stopped
 * writing and told nobody, and the thing that made that possible is that each
 * silencing path decided for itself whether to speak.
 *
 * > **Every path in the save pipeline that declines to write REPORTS on the
 * > channel, or states in place why there was nothing to report. And every
 * > caller of the manual-save door ROUTES a blocked outcome rather than
 * > swallowing it.**
 *
 * Three properties make these legs worth their length, and each was learned by
 * an earlier census in this repo getting it wrong:
 *
 * - **Membership is DISCOVERED.** The write doors are the declarations in
 *   `useDocument.ts` that reach `save(` / `writeDocBundle(`, found by reading
 *   the file — never a hand list, which could only be missing the door that
 *   drifted (tasks 343, 358, 365).
 * - **The allowlists are EMPTY.** A silent return is JUSTIFY-it (an in-place
 *   `save-silent-ok:` marker) or REPORT-it, never an entry here.
 * - **The needles run over CODE**, with comments blanked — this file's own
 *   fixes explain themselves by quoting the shapes they retired.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { codeOnlyLines } from "./_source-scan";

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const DOC_HOOK = "src/hooks/useDocument.ts";

/** A top-level `const NAME = useCallback(` / `function NAME(` declaration and
 *  the lines it spans, resolved by INDENTATION (the file's one consistent
 *  structural signal) rather than by brace counting. */
interface Decl {
  name: string;
  start: number; // 0-based line index of the declaration
  end: number; // exclusive
}

function declarations(lines: string[]): Decl[] {
  const OPEN =
    /^ {2}(?:const|function) (\w+)\s*(?::[^=]*)?=?\s*(?:async\s*)?(?:useCallback|function|\(|<)/;
  const out: Decl[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = OPEN.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    // The declaration runs until the next line at the same indent that begins a
    // new top-level statement inside the hook body.
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim()) continue;
      if (/^ {2}\S/.test(l) && !/^ {2}[)}\];]/.test(l)) break;
      if (/^\S/.test(l)) break;
    }
    out.push({ name: m[1], start: i, end: j });
  }
  return out;
}

/** The doors: declarations whose body reaches a write. */
function writeDoors(lines: string[]): Decl[] {
  return declarations(lines).filter((d) => {
    const body = lines.slice(d.start, d.end).join("\n");
    return /\bsave\(|writeDocBundle\(|\bsave\b\s*\(/.test(body);
  });
}

describe("census · every silencing gate has a voice", () => {
  const raw = read(DOC_HOOK);
  const lines = codeOnlyLines(raw).split("\n");
  const rawLines = raw.split("\n");

  it("the write doors are DISCOVERED, and there are several of them", () => {
    const doors = writeDoors(lines).map((d) => d.name);
    // A guard that discovered nothing would pass every leg below vacuously.
    expect(doors.length).toBeGreaterThanOrEqual(5);
    // …and the ones the incident ran through are among them.
    for (const must of ["save", "flushPending", "debouncedSave", "flushNow"]) {
      expect(doors, `discovery missed ${must}`).toContain(must);
    }
  });

  it("every early return inside a write door REPORTS or is justified in place", () => {
    const doors = writeDoors(lines);
    const offenders: string[] = [];
    for (const d of doors) {
      for (let i = d.start; i < d.end; i++) {
        const line = lines[i];
        // A bare `return;` or a `return <falsy>;` that is not the door's own
        // successful result. `return await`, `return door(` etc. are answers,
        // not silences.
        if (!/(^|[^\w.])return\s*(;|false\s*;|null\s*;|undefined\s*;)/.test(line))
          continue;
        // The report may be on this line, in the statement it closes, or in the
        // six lines above it (the `if (…) { noteSaveBlocked(…); return; }` and
        // the multi-line block shapes).
        const window = lines.slice(Math.max(d.start, i - 6), i + 1).join("\n");
        if (/noteSaveBlocked\(/.test(window)) continue;
        // …or the site states why there is nothing to report.
        const rawWindow = rawLines
          .slice(Math.max(0, i - 6), i + 1)
          .join("\n");
        if (/save-silent-ok:/.test(rawWindow)) continue;
        offenders.push(`${d.name} · ${DOC_HOOK}:${i + 1} · ${line.trim()}`);
      }
    }
    expect(
      offenders,
      "a save path that declines to write must publish a reason " +
        "(`noteSaveBlocked`) or carry a `save-silent-ok: <why>` marker",
    ).toEqual([]);
  });

  it("every catch inside a write door reports too", () => {
    const doors = writeDoors(lines);
    for (const d of doors) {
      const body = lines.slice(d.start, d.end).join("\n");
      if (!/\bcatch\s*\(/.test(body)) continue;
      expect(
        /noteSaveBlocked\(/.test(body),
        `${d.name} catches a write failure without publishing a reason`,
      ).toBe(true);
    }
  });

  it("the dirty predicate is ONE thing, not a per-path debounce-handle read", () => {
    // `saveTimerRef.current !== null` is unsound in both directions for "does
    // this document hold work that is not on disk?" — the debounce callback
    // nulls the handle BEFORE calling `save`, so a REFUSED write leaves the
    // doc dirty with the flag already cleared. Task 391 migrated `beforeunload`
    // off it; task 392 migrated the other three flush paths, so the comparison
    // may now appear only inside the ONE predicate.
    const code = codeOnlyLines(raw);
    const reads = code
      .split("\n")
      .filter((l) => /saveTimerRef\.current\s*===\s*null/.test(l));
    expect(
      reads,
      "the null-handle test is the ONE predicate's business — every flush " +
        "path asks `hasWorkToWrite()`",
    ).toEqual([]);
    expect(code).toContain("const hasWorkToWrite");
  });

  it("the retired dead state stays retired", () => {
    // `saveStatus` was declared, written at six sites and READ by nothing —
    // the task-202 dead-export shape, in a hook whose whole subject is telling
    // the user what is happening. The channel is what surfaces read now.
    const code = codeOnlyLines(raw);
    expect(code).not.toContain("setSaveStatus");
    expect(code).not.toContain("SaveStatus");
    for (const rel of ["src/components/EditorPane.tsx"]) {
      expect(codeOnlyLines(read(rel))).not.toContain("saveStatus");
    }
  });
});

describe("census · the manual-save door", () => {
  const CALLERS = ["src/components/SaveStateBadge.tsx", "src/components/EditorLayout.tsx"];

  it("every caller of `requestSaveNow` also routes a blocked outcome", () => {
    // A Save button that asks for a write and drops the refusal on the floor is
    // this incident's silence with a button on it. The routing call is what
    // turns a blocked answer into the flow that can unblock it.
    for (const rel of CALLERS) {
      const code = codeOnlyLines(read(rel));
      if (!code.includes("requestSaveNow(")) continue;
      expect(
        code.includes("requestBlockingFlow("),
        `${rel} asks for a manual save without routing a blocked outcome`,
      ).toBe(true);
    }
  });

  it("nothing outside the door module registers or reads a save door", () => {
    // The registry is keyed per document (multi-pane keep-alive), and a second
    // publisher through some other channel would reinstate "whichever pane
    // wrote last owns the button".
    const offenders: string[] = [];
    for (const rel of walk("src")) {
      if (rel === "src/lib/save-request.ts") continue;
      if (rel.includes("__tests__")) continue;
      const code = codeOnlyLines(read(rel));
      if (rel !== "src/hooks/useDocument.ts" && code.includes("registerSaveDoor(")) {
        offenders.push(rel);
      }
    }
    expect(
      offenders,
      "only `useDocument` publishes a document's manual-save door",
    ).toEqual([]);
  });

  it("the reason → flow mapping is spelled once", () => {
    // Both halves of "Save now" — the button's routing and each surface's
    // opener — must read the SAME table, or a reason leads to one dialog in one
    // place and another somewhere else. `describeBlockReason` is that table.
    const req = codeOnlyLines(read("src/lib/save-request.ts"));
    expect(req).toContain("describeBlockReason(");
    const offenders: string[] = [];
    for (const rel of walk("src")) {
      if (rel === "src/lib/save-state.ts") continue;
      if (rel.includes("__tests__")) continue;
      const code = codeOnlyLines(read(rel));
      // A second speller pairs a reason literal with a flow literal.
      if (
        /"external-change"/.test(code) &&
        /"conflict"/.test(code) &&
        rel !== "src/lib/save-request.ts"
      ) {
        offenders.push(rel);
      }
    }
    expect(offenders, "the reason → flow mapping has one home").toEqual([]);
  });
});

describe("census · a data-integrity state is never hideable", () => {
  const CLUSTER = "src/components/editor-layout/StatusCluster.tsx";

  it("the save badge and the conflict badge render BEFORE the collapse gate", () => {
    const src = read(CLUSTER);
    const gate = src.indexOf("{!topbarRightCollapsed &&");
    expect(gate, "the collapse gate must exist to be measured against").toBeGreaterThan(0);
    for (const el of ["<SaveStateBadge", "<ExternalChangeBadge"]) {
      const at = src.indexOf(el);
      expect(at, `${el} is not rendered at all`).toBeGreaterThan(0);
      expect(
        at,
        `${el} sits INSIDE the collapse gate — a data-integrity notice must ` +
          "not be hideable by a layout preference (the task-357 rule)",
      ).toBeLessThan(gate);
    }
  });

  it("the badge decides hideability from the SSOT, not from its own opinion", () => {
    // The clean/pending tiers are a reassurance and may collapse; the two loud
    // tiers may not. That split is `isSaveTierProtected`, and the badge must
    // ASK it rather than restate it — the census's own reason for existing.
    const code = codeOnlyLines(read("src/components/SaveStateBadge.tsx"));
    expect(code).toContain("isSaveTierProtected(");
  });
});

// ── helpers ───────────────────────────────────────────────────────────────

function walk(rel: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const child = `${dir}/${name}`;
      const st = statSync(join(ROOT, child));
      if (st.isDirectory()) {
        if (name === "node_modules" || name === ".next") continue;
        visit(child);
      } else if (/\.tsx?$/.test(name)) {
        out.push(child);
      }
    }
  };
  visit(rel);
  return out;
}
