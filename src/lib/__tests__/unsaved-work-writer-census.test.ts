/**
 * Task 1643 — the unsaved-work WRITER CENSUS.
 *
 * Task 1503 put the card-sidecar writers on the ONE unsaved-work channel
 * (`src/lib/unsaved-work.ts`) so the leave prompt and every "is my work on
 * disk?" door see them. Membership was opt-in per hook, and nothing listed
 * "the code that writes a document's files" — so 1503 found three writers and
 * missed two (`useAiRequests`, `useCitations`): a request the user just filed,
 * or a bib edit, in flight at a tab close, drew no warning.
 *
 * The fix moved membership onto the two doc-scoped DOORS (`trackDocWrite` in
 * `mutateAiRequests` / `mutateProjectBib`), which covers every caller at once.
 * This census makes the rest structural: every write PRIMITIVE is classified,
 * and every caller of a primitive that does not publish for itself either owns
 * a publisher or is excluded here with a reason. A new primitive, or a new
 * writer hook that forgets the channel, turns this red.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { walkFiles } from "./_source-scan";

const ROOT = join(__dirname, "..", "..", "..");
const SRC = join(ROOT, "src");

type Primitive =
  /** A doc-scoped door that publishes its own in-flight write. */
  | { kind: "door"; file: string }
  /** A low-level primitive with no document identity of its own to publish
   *  under: its CALLERS own the membership. */
  | { kind: "callers" }
  /** Writes something that is not the user's document work. */
  | { kind: "excluded"; reason: string };

/** Every write primitive in `src/lib`, classified. Keyed by export name. */
const PRIMITIVES: Record<string, Primitive> = {
  mutateAiRequests: { kind: "door", file: "src/lib/ai-requests-store.ts" },
  mutateProjectBib: { kind: "door", file: "src/lib/project-bib.ts" },
  mutateSidecar: { kind: "callers" },
  writeSidecar: { kind: "callers" },
  writeSidecarMerged: { kind: "callers" },
  mutateBib: { kind: "callers" },
  mutateLocalSidecar: { kind: "callers" },
  writeLocalSidecar: { kind: "callers" },
  mutateCollab: {
    kind: "excluded",
    reason: "collab.json is pen/presence bookkeeping between writers, not the user's work",
  },
  mutateIndex: {
    kind: "excluded",
    reason: "the app-level paper index in IndexedDB, not a document's files",
  },
  mutateMyPapers: {
    kind: "excluded",
    reason: "the app-level My Papers list in IndexedDB, not a document's files",
  },
};

/** Callers of a `callers`-class primitive that need not publish, and why. */
const EXCLUDED_CALLERS: Record<string, string> = {
  "src/hooks/useEditorUIState.ts":
    "editor-state.json is view state (scroll, folds), not the user's work",
  "src/lib/document-settings.ts":
    "a display pointer to the chosen style; the .tex preamble is the source of truth",
};

const PUBLISHER = /\bcreateSidecarWorkPublisher\b|\btrackDocWrite\s*\(/;

const FILES = walkFiles(SRC, { skipDirs: ["__tests__"] })
  .filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p))
  .map((abs) => ({
    rel: relative(ROOT, abs),
    text: readFileSync(abs, "utf8"),
  }));

const DEFINE = (name: string) =>
  new RegExp(`export\\s+(?:async\\s+function|function|const)\\s+${name}\\b`);
const CALL = (name: string) => new RegExp(`(?<![\\w.])${name}\\s*[<(]`);

describe("unsaved-work writer CENSUS (task 1643)", () => {
  it("every write primitive exported from src/lib is classified", () => {
    const found = new Set<string>();
    const shape =
      /export\s+(?:async\s+function|function|const)\s+(mutate[A-Z]\w*|write(?:Sidecar|LocalSidecar|Bib)\w*)\b/g;
    for (const f of FILES) {
      if (!f.rel.startsWith("src/lib/")) continue;
      for (const m of f.text.matchAll(shape)) found.add(m[1]);
    }
    const unclassified = [...found].filter((n) => !(n in PRIMITIVES)).sort();
    expect(
      unclassified,
      "classify each new write primitive in PRIMITIVES: a doc-scoped door that " +
        "publishes (trackDocWrite), a primitive whose callers publish, or excluded with a reason",
    ).toEqual([]);
    // No stale rows: a classified primitive still exists.
    const stale = Object.keys(PRIMITIVES).filter((n) => !found.has(n));
    expect(stale).toEqual([]);
  });

  it("every door publishes its own in-flight write through trackDocWrite", () => {
    for (const [name, p] of Object.entries(PRIMITIVES)) {
      if (p.kind !== "door") continue;
      const f = FILES.find((x) => x.rel === p.file);
      expect(f, `${name}: ${p.file} not found`).toBeDefined();
      const start = f!.text.search(DEFINE(name));
      expect(start, `${name} is not defined in ${p.file}`).toBeGreaterThanOrEqual(0);
      const end = f!.text.indexOf("\n}\n", start);
      const body = f!.text.slice(start, end);
      expect(body, `${name} must wrap its write in trackDocWrite`).toMatch(/\btrackDocWrite\s*\(/);
    }
  });

  it("every caller of a callers-class primitive publishes, is a primitive layer, or is excluded", () => {
    const callersClass = Object.entries(PRIMITIVES)
      .filter(([, p]) => p.kind === "callers")
      .map(([n]) => n);
    const allNames = Object.keys(PRIMITIVES);
    const offenders: string[] = [];
    const callingExcluded = new Set<string>();
    for (const f of FILES) {
      const calls = callersClass.filter((n) => CALL(n).test(f.text) && !DEFINE(n).test(f.text));
      if (calls.length === 0) continue;
      // A file that itself DEFINES a classified primitive is a layer of the
      // write stack (a door, a backend, the merged-write helper, the collab
      // store): its own row decides who publishes.
      if (allNames.some((n) => DEFINE(n).test(f.text))) continue;
      // `storage.ts` re-binds the backend's primitives; it calls nothing.
      if (f.rel === "src/lib/storage.ts") continue;
      if (f.rel in EXCLUDED_CALLERS) {
        callingExcluded.add(f.rel);
        continue;
      }
      if (!PUBLISHER.test(f.text)) offenders.push(`${f.rel} (${calls.join(", ")})`);
    }
    expect(
      offenders,
      "a writer of a document's files must publish to the unsaved-work channel " +
        "(createSidecarWorkPublisher) or be listed in EXCLUDED_CALLERS with a reason",
    ).toEqual([]);
    // No stale exclusions.
    expect(Object.keys(EXCLUDED_CALLERS).filter((r) => !callingExcluded.has(r))).toEqual([]);
  });
});
