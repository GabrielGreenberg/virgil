// @vitest-environment node
/**
 * The bibliographic vocabulary is stated twice — here (the app's edit form,
 * dashboard and raw-entry emitter) and in `library/scripts/` (the coherence
 * pre-flight, the bib-state door, the master/paper .bib writers) — because the
 * silos cannot import each other (the `QUEUE_SLOT_SUFFIX` precedent, task 618).
 * Task 1471: the halves had drifted. The edit form OFFERED `volume` on `@book`
 * and `publisher` on `@unpublished` — fields the pre-flight forbids, so filling
 * them pushed the paper back into re-authentication — and its "N fields empty"
 * link actively asked for them; `@manual` had no Publication section; the
 * dashboard's needs-action count had forgotten `needs-reauth`; and the emitter
 * claimed parity with a Python function that did not exist.
 *
 * If `python3` is unavailable the test FAILS rather than skips.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { BIB_ENTRY_TYPES, emitBibEntry, PUBLICATION_FIELDS_BY_TYPE } from "../bib-edit";
import { BIB_ACTION_NEEDED_STATES, TERMINAL_BIB_STATES } from "../catalog";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SCRIPTS = path.join(REPO_ROOT, "library/scripts");

function py(body: string, stdin?: string): unknown {
  try {
    const out = execFileSync(
      "python3",
      ["-c", ["import json, sys", `sys.path.insert(0, ${JSON.stringify(SCRIPTS)})`, body].join("\n")],
      { cwd: REPO_ROOT, encoding: "utf8", input: stdin, stdio: ["pipe", "pipe", "pipe"] },
    );
    return JSON.parse(out);
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    throw new Error(`python3 failed:\n${e.stdout ?? ""}\n${e.stderr ?? e.message}`);
  }
}

const DISALLOWED = py(
  "import _bib_types\nprint(json.dumps({t: sorted(f) for t, f in _bib_types.DISALLOWED_FIELDS.items()}))",
) as Record<string, string[]>;

describe("bib entry types — form ↔ coherence pre-flight (task 1471)", () => {
  it("the form never offers a field the pre-flight forbids for that type", () => {
    const offenders: string[] = [];
    for (const [type, offered] of Object.entries(PUBLICATION_FIELDS_BY_TYPE)) {
      for (const f of offered) if ((DISALLOWED[type] ?? []).includes(f)) offenders.push(`@${type}.${f}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the type dropdown covers every type the pre-flight names, and each has a Publication section", () => {
    for (const type of Object.keys(DISALLOWED)) {
      expect(BIB_ENTRY_TYPES as readonly string[]).toContain(type);
      expect(PUBLICATION_FIELDS_BY_TYPE[type], `@${type}`).toBeDefined();
    }
  });

  it("every dropdown type has a Publication section (no type renders an empty form)", () => {
    for (const type of BIB_ENTRY_TYPES) expect(PUBLICATION_FIELDS_BY_TYPE[type], `@${type}`).toBeDefined();
  });
});

describe("bib states — app ↔ door (task 1471)", () => {
  const door = py(
    [
      "import _tools",
      "c = sorted(_tools.CANONICAL_BIB_STATES)",
      "print(json.dumps({'canonical': c, 'terminal': sorted(_tools.TERMINAL_BIB_STATES),",
      "  'attention': sorted(s for s in c if _tools.bib_state_to_notification_kind(s) == 'failed')}))",
    ].join("\n"),
  ) as { canonical: string[]; terminal: string[]; attention: string[] };

  it("TERMINAL_BIB_STATES equals the Python set", () => {
    expect([...TERMINAL_BIB_STATES].sort()).toEqual(door.terminal);
  });

  it("action-needed is the door's attention set minus `none`, and partitions the vocabulary", () => {
    expect([...BIB_ACTION_NEEDED_STATES].sort()).toEqual(door.attention.filter((s) => s !== "none"));
    expect([...TERMINAL_BIB_STATES, ...BIB_ACTION_NEEDED_STATES, "none"].sort()).toEqual(door.canonical);
  });
});

describe("emitBibEntry ↔ _bib_parse.emit_bib_entry (task 1471)", () => {
  const cases: [string, string, Record<string, string>][] = [
    ["article", "smith2001", { title: "On Things", author: "Smith, J.", year: "2001" }],
    ["book", "jones1998", { title: "  Padded  ", note: "", series: "   ", volume: "3" }],
    ["misc", "empty2000", {}],
    ["misc", "blanks2000", { title: " ", note: "" }],
  ];

  it("both emitters produce byte-identical blocks, and `_tools` delegates to the same door", () => {
    const out = py(
      [
        "import _bib_parse, _tools",
        "cases = json.load(sys.stdin)",
        "print(json.dumps([[_bib_parse.emit_bib_entry(k, t, f), _tools.emit_bib_entry(k, t, f)] for t, k, f in cases]))",
      ].join("\n"),
      JSON.stringify(cases),
    ) as [string, string][];
    cases.forEach(([type, key, fields], i) => {
      expect(emitBibEntry(type, key, fields)).toBe(out[i][0]);
      expect(out[i][1]).toBe(out[i][0]);
    });
  });
});
