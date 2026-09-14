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

import { codeOnlyLines, commentsStripped, strip } from "./_source-scan";

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

  it("the save badge and the conflict badge render OUTSIDE the collapsible group", () => {
    // Renegotiated in place by task 395, same invariant, new spelling. The
    // collapsible tools used to be an inline `{!topbarRightCollapsed && (<>`
    // fragment; the bar's occupancy rule needs the group's NATURAL width in
    // BOTH states, so it is now a `max-content` wrapper that collapses by
    // width instead of unmounting. The question the census asks is unchanged
    // and is now structural rather than positional: a data-integrity badge
    // must not be a DESCENDANT of the group a layout preference can hide.
    const src = read(CLUSTER);
    // Anchored on the element that HIDES (the group wrapper carrying the
    // width/aria-hidden), not on the inner measurement marker a few lines
    // below it — a census should name the thing whose absence it is asserting.
    const gate = src.indexOf('data-bar-tier="collapsible"');
    expect(gate, "the collapsible tool group must exist to be measured against").toBeGreaterThan(0);
    for (const el of ["<SaveStateBadge", "<ExternalChangeBadge"]) {
      const at = src.indexOf(el);
      expect(at, `${el} is not rendered at all`).toBeGreaterThan(0);
      expect(
        at,
        `${el} sits INSIDE the collapsible tool group — a data-integrity ` +
          "notice must not be hideable by a layout preference (the task-357 rule)",
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

describe("census · ONE tone table for every surface that presents an interruption (task 571)", () => {
  // Pre-571 the band held a private tone → token switch, five topbar pills
  // each hand-wrote the same tokens, and the save badge re-derived its colour
  // from its TIER — so a cowork hold and a netted conflict were amber on the
  // band and red on the save pill beside it. The table was never the part
  // that could misbehave; a surface that paints without asking it is, and it
  // type-checks and renders perfectly. So the population here is DISCOVERED
  // by the QUESTION — which production components READ an interruption /
  // save-state vocabulary, i.e. present one of these states — never a hand
  // list of the pills someone remembered.
  const LEAF = "src/lib/interruption-tone.ts";
  const VOCABULARIES = [
    "@/lib/document-interruption",
    "@/hooks/useDocumentInterruption",
    '@/lib/save-state"',
    "@/hooks/useSaveState",
    "@/hooks/usePreservationNotice",
    "@/lib/cowork-pen",
  ];
  /** A hand-spelled palette token of the two families the register paints.
   *  The needle lives INSIDE a string literal, so the legs that ask it read
   *  `commentsStripped` / `strip(…, true, true)` — `codeOnly` blanks the very
   *  bytes it greps for (the trap `_source-scan`'s own header records). */
  const PALETTE_LITERAL = /var\(--(?:danger|amber)/;

  it("the literal needle can see (a census whose needle is quoted text needs a canary)", () => {
    expect(PALETTE_LITERAL.test(strip('x = { bg: "var(--amber-100)" }; // c', true, true))).toBe(true);
    expect(PALETTE_LITERAL.test(strip('x = { bg: "var(--danger-soft)" };', false, true))).toBe(false);
  });

  const presenters = () =>
    walk("src/components").filter((rel) => {
      if (rel.includes("__tests__") || !rel.endsWith(".tsx")) return false;
      const code = codeOnlyLines(read(rel));
      // The imports name the vocabulary as a STRING, which `codeOnlyLines`
      // blanks — so the population is read off the raw source, and the
      // needles below off the code.
      const raw = read(rel);
      return VOCABULARIES.some((v) => raw.includes(v)) && code.length > 0;
    });

  it("the population is discovered, and it can see the surfaces the defect lived on", () => {
    const pop = presenters();
    for (const must of [
      "src/components/SaveStateBadge.tsx",
      "src/components/DocumentInterruptionBanner.tsx",
      "src/components/CoworkPenBadge.tsx",
      "src/components/ExternalChangeBadge.tsx",
      "src/components/PreservationNoticeBadge.tsx",
    ]) {
      expect(pop, `discovery missed ${must}`).toContain(must);
    }
  });

  /** A hit excused IN PLACE, with its reason — scoped to the LINE it sits
   *  above, never to the file (task 204's rule). The one shape that earns it:
   *  a menu row's destructive-CHOICE ink, which is task 528's family (a
   *  button's paint describes what pressing it DOES), not a state's register. */
  const EXEMPT = "interruption-tone-exempt:";
  const hits = () => {
    const spellers: string[] = [];
    const excused: string[] = [];
    for (const rel of presenters()) {
      const lines = strip(read(rel), true, true).split("\n");
      const rawLines = read(rel).split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!PALETTE_LITERAL.test(lines[i])) continue;
        // The marker sits in the comment block DIRECTLY above the hit.
        const above = rawLines.slice(Math.max(0, i - 6), i).join("\n");
        (above.includes(EXEMPT) ? excused : spellers).push(`${rel}:${i + 1} · ${lines[i].trim()}`);
      }
    }
    return { spellers, excused };
  };

  it("no presenter spells a palette token of its own — every one paints through `paletteForTone`", () => {
    // Allowlist EMPTY: a hit is MIGRATE-it. A pill about a state the leaf does
    // not model names its TONE (`paletteForTone("warning")`), never a token.
    expect(hits().spellers, "a surface presenting an interruption paints its own palette").toEqual([]);
  });

  it("every exemption marker still excuses a real hit, and the excused set is exactly the two menu rows", () => {
    // A marker that has stopped excusing anything is a standing licence for
    // the next literal added beneath it — so the excused set is pinned EXACTLY,
    // and each marker must sit above a hit.
    expect(hits().excused.map((h) => h.split(" · ")[0].replace(/:\d+$/, "")).sort()).toEqual([
      "src/components/ExternalChangeBadge.tsx",
      "src/components/PreservationNoticeBadge.tsx",
    ]);
    for (const rel of presenters()) {
      const rawLines = read(rel).split("\n");
      const stripped = strip(read(rel), true, true).split("\n");
      rawLines.forEach((line, i) => {
        if (!line.includes(EXEMPT)) return;
        const below = stripped.slice(i + 1, i + 8).join("\n");
        expect(PALETTE_LITERAL.test(below), `${rel}:${i + 1} carries a marker that excuses nothing`).toBe(true);
      });
    }
  });

  it("the painters are an EXACT set, and the one non-painter states its reason", () => {
    // A member that paints nothing (the update banner lists blocked documents
    // in its own chrome and reads only the SENTENCE) is declared here with
    // its reason, so a new presenter must either enter the door or be named
    // — and a painter that quietly stopped asking the door fails as a
    // non-painter nobody declared.
    const NON_PAINTERS: Record<string, string> = {
      "src/components/SoftwareUpdateBanner.tsx":
        "reads describeBlockReason(...).sentence into the blocked list; paints no interruption tone",
    };
    const painters = presenters().filter((rel) => codeOnlyLines(read(rel)).includes("paletteForTone("));
    const silent = presenters().filter((rel) => !painters.includes(rel));
    expect(silent.sort()).toEqual(Object.keys(NON_PAINTERS).sort());
    expect(painters.sort()).toEqual(
      [
        "src/components/CoworkPenBadge.tsx",
        "src/components/DocumentInterruptionBanner.tsx",
        "src/components/ExternalChangeBadge.tsx",
        "src/components/MirrorRecoveryBadge.tsx",
        "src/components/PreservationNoticeBadge.tsx",
        "src/components/SaveStateBadge.tsx",
      ].sort(),
    );
  });

  it("the tone → palette map and the kind → tone table each have ONE home", () => {
    const declarers = walk("src").filter((rel) => {
      if (rel.includes("__tests__")) return false;
      const code = codeOnlyLines(read(rel));
      return /(?:const|function) (?:TONE_PALETTE|paletteForTone|INTERRUPTION_TONE|toneForInterruptionKind)\b/.test(code);
    });
    expect(declarers).toEqual([LEAF]);
    // …and no production file re-derives the map as a switch over the tones —
    // the band's retired shape.
    const switches = walk("src").filter((rel) => {
      if (rel.includes("__tests__") || rel === LEAF) return false;
      const code = commentsStripped(read(rel));
      return /case "live":|case "warning":|case "info":/.test(code);
    });
    expect(switches, "a second tone → token switch").toEqual([]);
    expect(codeOnlyLines(read("src/components/DocumentInterruptionBanner.tsx"))).not.toContain(
      "function paletteFor",
    );
  });

  it("the badge and the vocabulary both READ the table — neither re-derives a tone from the tier", () => {
    const badge = codeOnlyLines(read("src/components/SaveStateBadge.tsx"));
    expect(badge).toContain("desc.tone");
    expect(badge).toContain("paletteForTone(");
    // The retired shape: a colour chosen by `blocked ? … : …`.
    expect(badge).not.toMatch(/blocked\s*\?\s*\{?\s*background/);
    const vocab = codeOnlyLines(read("src/lib/save-state.ts"));
    expect(vocab).toContain("toneForInterruptionKind(interruptionKindForReason(reason))");
    // The band's vocabulary states every branch's tone from the table, never
    // as a literal (the `conflictOutcomeNotice` dialog tone below it is a
    // different vocabulary — a confirm's `"danger" | "default"`).
    const raw = commentsStripped(read("src/lib/document-interruption.ts"));
    const derivation = raw.slice(
      raw.indexOf("export function deriveDocumentInterruption"),
      raw.indexOf("export function conflictOutcomeNotice"),
    );
    expect(derivation.length).toBeGreaterThan(100);
    expect(derivation).not.toMatch(/tone:\s*"(?:live|warning|info|danger)"/);
    expect((derivation.match(/toneForInterruptionKind\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("a blocked reason with NO action renders NO button — the vocabulary decides, the badge obeys", () => {
    // 489 offered "Try again" on a cowork hold and 545 decided `recommended:
    // null` for the same state; the badge read the older table. The table is
    // one now (`action: null`), and the badge must not invent a button for it.
    const vocab = codeOnlyLines(read("src/lib/save-state.ts"));
    expect(vocab).toMatch(/action:\s*string \| null/);
    const badge = codeOnlyLines(read("src/components/SaveStateBadge.tsx"));
    expect(badge).toMatch(/action !== null &&/);
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
