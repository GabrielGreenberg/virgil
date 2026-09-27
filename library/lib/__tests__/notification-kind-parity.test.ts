// @vitest-environment node
/**
 * The inbox `kind` vocabulary is owned by the Python append DOOR (task 799):
 * `_tools.resolve_inbox_item` maps a `bib.state` onto the toast enum, refuses
 * an undeclared kind, and stamps `severity`. The app's five core kinds are
 * stated twice — `NOTIFICATION_SEVERITY` here and
 * `_tools.NOTIFICATION_CORE_SEVERITY` there — because the silos cannot import
 * each other (the `QUEUE_SLOT_SUFFIX` precedent, task 618). This file holds
 * them equal, holds every skill's CLI example to the door, and pins that the
 * app honours the door's stamp.
 *
 * The Python half's own suite is `library/scripts/tests/test_inbox_kind_door.py`
 * (driven by the python-suites census). If `python3` is unavailable the test
 * FAILS rather than skips.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { NOTIFICATION_SEVERITY, notificationSeverity, notificationTtlMs, NOTIFICATION_TTL_MS } from "../queue";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SCRIPTS = path.join(REPO_ROOT, "library/scripts");
const SKILLS = path.join(REPO_ROOT, "library/skills");

function py(body: string): unknown {
  try {
    const out = execFileSync(
      "python3",
      ["-c", ["import json, sys", `sys.path.insert(0, ${JSON.stringify(SCRIPTS)})`, "import _tools", body].join("\n")],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return JSON.parse(out);
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    throw new Error(`python3 failed:\n${e.stdout ?? ""}\n${e.stderr ?? e.message}`);
  }
}

describe("inbox kind — TS ↔ Python parity (task 799)", () => {
  it("queue.ts NOTIFICATION_SEVERITY equals _tools.NOTIFICATION_CORE_SEVERITY", () => {
    expect(py("print(json.dumps(_tools.NOTIFICATION_CORE_SEVERITY))")).toEqual(NOTIFICATION_SEVERITY);
  });

  it("every severity the door can stamp is one the app knows", () => {
    const severities = py(
      [
        "s = set(_tools.NOTIFICATION_CORE_SEVERITY.values()) | set(_tools.NOTIFICATION_WRITER_SEVERITY.values())",
        "s |= {sev for sev, _ in _tools.NOTIFICATION_KIND_FAMILIES.values()}",
        "print(json.dumps(sorted(s)))",
      ].join("\n"),
    ) as string[];
    for (const s of severities) expect(Object.keys(NOTIFICATION_TTL_MS)).toContain(s);
  });
});

/** Every `"kind": "<literal>"` in a skill fence that pipes into the CLI door. */
function skillCliKinds(): { where: string; kind: string }[] {
  const out: { where: string; kind: string }[] = [];
  for (const name of readdirSync(SKILLS).filter((f) => f.endsWith(".md"))) {
    const text = readFileSync(path.join(SKILLS, name), "utf8");
    const fences = text.match(/```[\s\S]*?```/g) ?? [];
    for (const fence of fences) {
      if (!fence.includes("append_inbox_item.py")) continue;
      for (const m of fence.matchAll(/"kind"\s*:\s*"([^"<]+)"/g)) out.push({ where: name, kind: m[1] });
    }
  }
  return out;
}

describe("inbox kind — every skill's CLI example passes the door", () => {
  it("each literal kind a skill hands append_inbox_item.py resolves", () => {
    const sites = skillCliKinds();
    expect(sites.length).toBeGreaterThanOrEqual(5);
    const refused = py(
      [
        `sites = json.loads(${JSON.stringify(JSON.stringify(sites))})`,
        "bad = []",
        "for s in sites:",
        "    try: _tools.resolve_inbox_item({'kind': s['kind']})",
        "    except _tools.InboxKindError as e: bad.append(f\"{s['where']}: {e}\")",
        "print(json.dumps(bad))",
      ].join("\n"),
    );
    expect(refused).toEqual([]);
  });
});

describe("inbox kind — the app honours the door's stamp", () => {
  it("a stamped severity wins over the core-kind fallback", () => {
    expect(notificationSeverity({ kind: "triage-needs-title", severity: "attention" })).toBe("attention");
    expect(notificationTtlMs({ kind: "triage-needs-title", severity: "attention" })).toBe(NOTIFICATION_TTL_MS.attention);
  });

  it("an unstamped item falls back to the core table, then info", () => {
    expect(notificationSeverity({ kind: "failed" })).toBe("attention");
    expect(notificationSeverity({ kind: "indexed" })).toBe("info");
    expect(notificationSeverity({ kind: "something-legacy" })).toBe("info");
  });

  it("a junk severity value is ignored, not trusted", () => {
    expect(
      notificationSeverity({ kind: "failed", severity: "loud" as unknown as "info" }),
    ).toBe("attention");
  });
});
