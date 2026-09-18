// @vitest-environment jsdom
//
// Cross-window storage guardrail (task 177) — the CI half of the
// storage-event contract, in the same shape as the keystroke-sanctity,
// scroll-reposition, pane-drag and editor-observer guards:
//
//   1. SOURCE-GREP ALLOWLIST — walk `src/` AND `library/` and flag every file
//      that registers a RAW `addEventListener("storage", …)`. The permitted
//      set is exactly ONE file: the primitive itself. Everything else must
//      route through `subscribeToStorageKey`, so the contract's two subtle
//      guards can't be re-derived (and re-broken) per store.
//
//   2. CONTRACT UNIT TESTS — pin those two guards directly, since the whole
//      point of centralizing is that they are stated once.
//
//   3. STORE-SHAPE CENSUS (task 599) — the half the law is actually about.
//      Sweep 1 sees the door used WRONGLY; it cannot see a store that uses the
//      door NOT AT ALL, and four such stores (the whole global view-prefs blob
//      among them) sat under a green guard. So: every shipped file that both
//      READS and WRITES `localStorage` is a store until proven otherwise, and
//      must SUBSCRIBE through the primitive or sit in a ledger whose stated
//      reason is itself checked against the file's code.
//
// WHY the contract is subtle enough to deserve a guard: a `storage` handler
// must ignore foreign keys, AND must treat `key === null` as a clear() that
// counts only when `storageArea === localStorage` — a peer's
// `sessionStorage.clear()` fires with a null key too. Before this landed,
// three hand-rolled copies existed and two of them were missing the null-key
// branch entirely.

import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { subscribeToStorageKey } from "../cross-window-storage";
import { commentsStripped, trackedFiles, REPO_ROOT } from "./_source-scan";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../.."); // src/
const LIBRARY = path.resolve(HERE, "../../../library"); // the Library silo

// ── The permitted raw-listener allowlist ────────────────────────────────────
// The ONE file allowed to touch the native event. A new entry here means a
// store re-implemented the contract instead of consuming it — which is the
// regression this guard exists to catch, so an entry needs a real reason.
const PERMITTED_RAW_STORAGE_LISTENERS: Record<string, string> = {
  "lib/cross-window-storage.ts":
    "The primitive itself — the single encoding of the foreign-key + null-key/storageArea guards.",
};

// Deliberately EMPTY: the Library silo has no cross-window store of its own
// today. Its localStorage helpers (`list-columns`, `row-viewed-store`,
// `library-store`) re-read per call rather than caching a module snapshot. A
// first entry here should consume the primitive, not hand-roll a listener.
const PERMITTED_LIBRARY_RAW_STORAGE_LISTENERS: Record<string, string> = {};

/** A raw registration of the native `storage` event, in either quote style. */
export function detectRawStorageListener(source: string): boolean {
  return /addEventListener\(\s*["']storage["']/.test(source);
}

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip test + fixture trees so the guard never scans itself.
      if (entry === "__tests__" || entry === "__fixtures__") continue;
      if (entry === "node_modules") continue;
      out.push(...walkSource(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function flagged(root: string): string[] {
  return walkSource(root)
    .filter((f) => detectRawStorageListener(readFileSync(f, "utf8")))
    .map((f) => path.relative(root, f).split(path.sep).join("/"))
    .sort();
}

describe("cross-window storage guardrail — source allowlist", () => {
  it("routes every src/ storage listener through the primitive", () => {
    // If this fails with an EXTRA file: a store hand-rolled its own `storage`
    // listener. Check it handles BOTH guards (foreign keys; `key === null`
    // only from localStorage) — then don't add it here, migrate it to
    // `subscribeToStorageKey`, which is where those guards live.
    expect(flagged(SRC)).toEqual(Object.keys(PERMITTED_RAW_STORAGE_LISTENERS).sort());
  });

  it("keeps the Library silo free of hand-rolled storage listeners", () => {
    expect(flagged(LIBRARY)).toEqual(
      Object.keys(PERMITTED_LIBRARY_RAW_STORAGE_LISTENERS).sort(),
    );
  });

  it("would flag a NEW hand-rolled listener (regression fixture)", () => {
    // The exact shape this guard exists to catch — note the missing null-key
    // branch, which is what two of the three pre-177 copies got wrong.
    const naiveFixture = `
      useEffect(() => {
        const onStorage = (e: StorageEvent) => {
          if (e.key !== MY_KEY) return;
          refresh();
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
      }, []);
    `;
    expect(detectRawStorageListener(naiveFixture)).toBe(true);
    // …and the primitive's own consumers do NOT trip it.
    expect(
      detectRawStorageListener(`const off = subscribeToStorageKey(KEY, refresh);`),
    ).toBe(false);
  });
});

describe("cross-window storage guardrail — the contract itself", () => {
  it("ignores foreign keys", () => {
    const cb = vi.fn();
    const off = subscribeToStorageKey("mine", cb);
    window.dispatchEvent(new StorageEvent("storage", { key: "theirs" }));
    expect(cb).not.toHaveBeenCalled();
    off();
  });

  it("treats key === null as a clear, but only from localStorage", () => {
    const cb = vi.fn();
    const off = subscribeToStorageKey("mine", cb);

    // A peer's sessionStorage.clear() also fires with a null key.
    window.dispatchEvent(
      new StorageEvent("storage", { key: null, storageArea: sessionStorage }),
    );
    expect(cb).not.toHaveBeenCalled();

    // jsdom's constructor accepts only a real Storage for `storageArea`.
    const clearEvent = new StorageEvent("storage", { key: null });
    Object.defineProperty(clearEvent, "storageArea", { value: localStorage });
    window.dispatchEvent(clearEvent);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });
});


// ── 3. The store-shape census (task 599) ────────────────────────────────────
//
// THE QUESTION: does every store that caches a `localStorage` snapshot and
// writes it back hear its peers? A regex cannot decide "caches"; it can decide
// "reads AND writes" — so that is the population, and the ledger carries the
// argument for every member that doesn't subscribe. Each argument is CHECKED:
//
//   - `read-fresh`     — the file keeps no snapshot: no module-scope `let`, no
//                        React state/ref. Every write is built from a read
//                        made in the same call, so there is no stale base.
//   - `write-once`     — every write stores a string LITERAL (a monotone flag):
//                        a stale window writes the same value a fresh one would.
//   - `subscribed-by`  — the file is the storage half of a store whose cached
//                        half lives in `by`, which imports it and subscribes.
//
// The ledger is exact in both directions: a stale entry fails, and so does an
// entry whose file has since started subscribing.
//
// STATED RESIDUAL: the population is per-FILE. A store whose read goes through
// a generic helper defined in ANOTHER file (no `localStorage.getItem` of its
// own) is invisible here — none exists today; `subscribed-by` is the ledger
// form for the split that does exist (a read-fresh lib + a caching hook).

type StoreLedgerEntry =
  | { kind: "read-fresh"; reason: string }
  | { kind: "write-once"; reason: string }
  | { kind: "subscribed-by"; by: string; reason: string };

const STORE_LEDGER: Record<string, StoreLedgerEntry> = {
  "src/lib/collab.ts": {
    kind: "read-fresh",
    reason: "`loadIdentity`/`saveIdentity` — one whole value, re-read by every caller that needs it.",
  },
  "library/lib/list-columns.ts": {
    kind: "read-fresh",
    reason: "Load/save helpers only; the cached copy lives in view-session-store, which subscribes to these keys.",
  },
  "library/lib/row-viewed-store.ts": {
    kind: "read-fresh",
    reason: "`markViewedNow` re-reads the map and merges ONE key per write — no whole-snapshot write from a stale base.",
  },
  "src/components/InstallPwaPrompt.tsx": {
    kind: "write-once",
    reason: "The dismissed flag only ever becomes \"1\"; a stale window can only write what a fresh one would.",
  },
  "src/lib/style-library.ts": {
    kind: "subscribed-by",
    by: "src/hooks/useStyleLibrary.ts",
    reason: "Read-fresh lib; the hook holds the cached list and re-reads on the storage event.",
  },
  "library/lib/library-store.ts": {
    kind: "subscribed-by",
    by: "library/hooks/useLibraryTabs.ts",
    reason:
      "Panel-tab state is cached (and synced) in useLibraryTabs; the legacy registry key is read fresh per call and only feeds the one-shot disk migration.",
  },
};

const READS_LS = /\blocalStorage\s*\.\s*getItem\s*\(/;
const WRITES_LS = /\blocalStorage\s*\.\s*setItem\s*\(|\bwriteStorageIfChanged\s*\(/;
const SUBSCRIBES = /\b(?:subscribeToStorageKeys?|useStorageKeySync)\s*\(/;

export function isStore(code: string): boolean {
  return READS_LS.test(code) && WRITES_LS.test(code);
}

function shippedSources(): string[] {
  const isSource = /\.(ts|tsx)$/;
  return [...trackedFiles("src", isSource), ...trackedFiles("library", isSource)]
    .map((abs) => path.relative(REPO_ROOT, abs).split(path.sep).join("/"))
    .filter(
      (rel) =>
        !/(^|\/)(__tests__|__fixtures__|node_modules)\//.test(rel) &&
        !/\.test\.tsx?$/.test(rel) &&
        !/\.d\.ts$/.test(rel),
    );
}

const codeOf = (rel: string) =>
  commentsStripped(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

/** Every write call's value argument, as written. */
function writtenValues(code: string): string[] {
  const out: string[] = [];
  const re = /\b(?:localStorage\s*\.\s*setItem|writeStorageIfChanged)\s*\(([^;]*?)\)\s*[;}]/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const args = m[1];
    const comma = args.lastIndexOf(",");
    out.push((comma < 0 ? args : args.slice(comma + 1)).trim());
  }
  return out;
}

/** Why `entry` does NOT hold for `rel`, or null when it does. */
export function ledgerViolation(
  rel: string,
  entry: StoreLedgerEntry,
  read: (rel: string) => string,
): string | null {
  const code = read(rel);
  switch (entry.kind) {
    case "read-fresh":
      if (/^let\s/m.test(code)) return "declares module-scope `let` state";
      if (/\buse(?:State|Ref|Reducer|SyncExternalStore)\s*[<(]/.test(code))
        return "holds React state/refs";
      return null;
    case "write-once": {
      const vals = writtenValues(code);
      if (vals.length === 0) return "no write call could be parsed";
      const bad = vals.find((v) => !/^(["'])[^"']*\1$/.test(v));
      return bad ? `writes a non-literal value (${bad})` : null;
    }
    case "subscribed-by": {
      let by: string;
      try {
        by = read(entry.by);
      } catch {
        return `${entry.by} does not exist`;
      }
      const base = path.basename(rel).replace(/\.tsx?$/, "");
      const importsIt = new RegExp(`from\\s+["'][^"']*/${base}["']`).test(by);
      if (!importsIt) return `${entry.by} does not import ${base}`;
      if (!SUBSCRIBES.test(by)) return `${entry.by} does not subscribe`;
      return null;
    }
  }
}

/** The census: every store that neither subscribes nor is ledgered, plus every
 *  ledger entry that no longer names a non-subscribing store. */
export function storeCensus(
  files: string[],
  read: (rel: string) => string,
  ledger: Record<string, StoreLedgerEntry>,
): { unsubscribed: string[]; staleLedger: string[]; badArguments: string[] } {
  const unsubscribed: string[] = [];
  const nonSubscribing = new Set<string>();
  for (const rel of files) {
    const code = read(rel);
    if (!isStore(code) || SUBSCRIBES.test(code)) continue;
    nonSubscribing.add(rel);
    if (!(rel in ledger)) unsubscribed.push(rel);
  }
  const staleLedger = Object.keys(ledger)
    .filter((rel) => !nonSubscribing.has(rel))
    .sort();
  const badArguments = Object.entries(ledger)
    .filter(([rel]) => nonSubscribing.has(rel))
    .map(([rel, e]) => {
      const why = ledgerViolation(rel, e, read);
      return why ? `${rel} (${e.kind}): ${why}` : null;
    })
    .filter((x): x is string => x !== null);
  return { unsubscribed: unsubscribed.sort(), staleLedger, badArguments };
}

describe("cross-window storage guardrail — store-shape census (task 599)", () => {
  it("every shipped store that reads + writes localStorage subscribes, or is ledgered", () => {
    // An UNSUBSCRIBED file: it caches a snapshot and writes it back, and a
    // peer window's change never reaches it — its next write clobbers the
    // peer. Subscribe via `subscribeToStorageKey` / `useStorageKeySync` (and
    // write through `writeStorageIfChanged` if it persists from an effect).
    // Ledger it only if one of the three checked arguments truly holds.
    const report = storeCensus(shippedSources(), codeOf, STORE_LEDGER);
    expect(report).toEqual({ unsubscribed: [], staleLedger: [], badArguments: [] });
  });

  it("the population is not vacuous", () => {
    const files = shippedSources();
    const stores = files.filter((f) => isStore(codeOf(f)));
    // Fourteen-plus subscribing stores + the ledger; a collapse here means the
    // population query broke, not that the app got simpler.
    expect(stores.length).toBeGreaterThanOrEqual(20);
    expect(stores).toContain("src/hooks/useViewPrefs.ts");
    expect(files).toContain("library/hooks/useNotificationStream.ts");
  });

  // The shapes the four task-599 members had, planted as fixtures.
  const FIXTURES: Record<string, string> = {
    "module-singleton.ts": `
      let _on = false;
      function load() { _on = localStorage.getItem("k") === "1"; }
      function persist() { localStorage.setItem("k", _on ? "1" : "0"); }`,
    "lazy-state.tsx": `
      const [draft, setDraft] = useState(() => localStorage.getItem("d") ?? "");
      useEffect(() => { localStorage.setItem("d", draft); }, [draft]);`,
    "cached-ref.ts": `
      seenRef.current = localStorage.getItem("s");
      try { localStorage.setItem("s", newest); } catch {}`,
    "bus-only.ts": `
      const raw = localStorage.getItem(GLOBAL);
      const off = subscribe(onBusEvent);
      writeStorageIfChanged(GLOBAL, JSON.stringify(slice));`,
    "fixed.ts": `
      const raw = localStorage.getItem(GLOBAL);
      const off = subscribeToStorageKey(GLOBAL, reread);
      writeStorageIfChanged(GLOBAL, JSON.stringify(slice));`,
    "commented.ts": `
      // localStorage.setItem("flag", "1") then reload
      const on = localStorage.getItem("flag") === "1";`,
    "flag-writer.tsx": `
      const [d, setD] = useState(false);
      setD(localStorage.getItem("x") === "1");
      localStorage.setItem("x", "1");`,
    "stateful-lib.ts": `
      let cache = null;
      export const load = () => (cache = localStorage.getItem("y"));
      export const save = (v) => localStorage.setItem("y", v);`,
    "consumer.ts": `
      import { load } from "./other/stateful-lib";
      const off = subscribeToStorageKey("y", load);`,
  };
  const readFixture = (rel: string) => {
    if (!(rel in FIXTURES)) throw new Error(`no fixture ${rel}`);
    // Dedent: the fixtures are indented here, but a module-scope `let` sits at
    // column 0 in a real file.
    return commentsStripped(FIXTURES[rel].replace(/^[ \t]+/gm, ""));
  };

  it("flags each non-subscribing store shape, and only those", () => {
    const r = storeCensus(Object.keys(FIXTURES), readFixture, {});
    expect(r.unsubscribed).toEqual(
      ["bus-only.ts", "cached-ref.ts", "flag-writer.tsx", "lazy-state.tsx", "module-singleton.ts", "stateful-lib.ts"],
    );
  });

  it("checks each ledger argument against the code", () => {
    const r = storeCensus(Object.keys(FIXTURES), readFixture, {
      "module-singleton.ts": { kind: "read-fresh", reason: "a lie" },
      "lazy-state.tsx": { kind: "write-once", reason: "a lie" },
      "flag-writer.tsx": { kind: "write-once", reason: "true" },
      "stateful-lib.ts": { kind: "subscribed-by", by: "consumer.ts", reason: "true" },
      "cached-ref.ts": { kind: "subscribed-by", by: "fixed.ts", reason: "a lie" },
      "bus-only.ts": { kind: "subscribed-by", by: "missing.ts", reason: "a lie" },
      "fixed.ts": { kind: "read-fresh", reason: "stale — it subscribes now" },
    });
    expect(r.unsubscribed).toEqual([]);
    expect(r.staleLedger).toEqual(["fixed.ts"]);
    expect(r.badArguments).toEqual([
      "module-singleton.ts (read-fresh): declares module-scope `let` state",
      "lazy-state.tsx (write-once): writes a non-literal value (draft)",
      "cached-ref.ts (subscribed-by): fixed.ts does not import cached-ref",
      "bus-only.ts (subscribed-by): missing.ts does not exist",
    ]);
  });
});

// ── 4. The debounced-mirror census (task 629) ───────────────────────────────
//
// THE QUESTION sweep 3 cannot ask: a store may subscribe perfectly and still
// lose the user's text, because SUBSCRIBING is only half the contract. A
// `localStorage` mirror that DEFERS its write owes two more guarantees, and
// `BugReportWindow` shipped with neither:
//
//   (a) the deferred write is FLUSHED on teardown, not cancelled — its effect
//       cleanup was `clearTimeout(t)`, so a reload inside the 400 ms window
//       dropped the last sentence typed;
//   (b) the peer re-read is GATED on the buffer being clean — its handler
//       re-read storage unconditionally, and was coupled across two keys, so a
//       keystroke in a second window's unrelated field reverted the prose
//       being composed here.
//
// Both now live in `useMirroredDraft`, which is the same answer the sidecar
// family reached in tasks 392/559/569. So the population is every shipped file
// that HOLDS A TIMER HANDLE and WRITES `localStorage` — a deferred, cancellable
// write — and each member must either consume the door or carry a ledgered
// argument that is CHECKED against its code, exactly like sweep 3's.

/** A timer handle STORED somewhere — i.e. a deferred, cancellable write. */
const HOLDS_TIMER_HANDLE = /=\s*(?:window\s*\.\s*)?setTimeout\s*\(/;
const USES_MIRROR_DOOR = /\buseMirroredDraft\s*\(/;

type MirrorLedgerEntry = { kind: "flushes-and-merges"; reason: string };

const MIRROR_LEDGER: Record<string, MirrorLedgerEntry> = {
  "src/lib/cross-window-storage.ts": {
    kind: "flushes-and-merges",
    reason:
      "The door itself — where the flush edges and the one dirty predicate are stated.",
  },
  "library/lib/view-session-store.ts": {
    kind: "flushes-and-merges",
    reason:
      "A module-global store, not hook state, so it cannot consume the React door — but it answers BOTH halves already and more strongly: its own pagehide + visibilitychange flush, and a three-way merge against `lastPersisted` on the peer path rather than a clean-gated skip.",
  },
};

/** Why `entry` does NOT hold for `rel`, or null when it does. */
export function mirrorLedgerViolation(
  rel: string,
  _entry: MirrorLedgerEntry,
  read: (rel: string) => string,
): string | null {
  const code = read(rel);
  // The door states its edges; a ledgered peer states its own. Either way the
  // three markers must be present in the file that claims them.
  const isDoor = USES_MIRROR_DOOR.test(code) || /export function useMirroredDraft/.test(code);
  if (!/addEventListener\(\s*["']pagehide["']/.test(code))
    return "no `pagehide` flush edge";
  if (!isDoor && !/["']visibilitychange["']|onTabHidden\s*\(/.test(code))
    return "no tab-hidden flush edge";
  if (!isDoor && !/function\s+\w*merge\w*\s*\(/i.test(code))
    return "peer path adopts rather than merges (no merge helper)";
  return null;
}

export function mirrorCensus(
  files: string[],
  read: (rel: string) => string,
  ledger: Record<string, MirrorLedgerEntry>,
): { handRolled: string[]; staleLedger: string[]; badArguments: string[] } {
  const handRolled: string[] = [];
  const deferredWriters = new Set<string>();
  for (const rel of files) {
    const code = read(rel);
    if (!HOLDS_TIMER_HANDLE.test(code) || !WRITES_LS.test(code)) continue;
    if (USES_MIRROR_DOOR.test(code) && !(rel in ledger)) continue; // consumes the door
    deferredWriters.add(rel);
    if (!(rel in ledger)) handRolled.push(rel);
  }
  const staleLedger = Object.keys(ledger)
    .filter((rel) => !deferredWriters.has(rel))
    .sort();
  const badArguments = Object.entries(ledger)
    .filter(([rel]) => deferredWriters.has(rel))
    .map(([rel, e]) => {
      const why = mirrorLedgerViolation(rel, e, read);
      return why ? `${rel} (${e.kind}): ${why}` : null;
    })
    .filter((x): x is string => x !== null);
  return { handRolled: handRolled.sort(), staleLedger, badArguments };
}

describe("cross-window storage guardrail — debounced-mirror census (task 629)", () => {
  it("no shipped file hand-rolls a debounced localStorage mirror", () => {
    // A HAND-ROLLED entry: the file defers a `localStorage` write behind a
    // timer it holds. It owes a flush on teardown and a dirty guard on the
    // peer re-read — both of which `useMirroredDraft` already states. Consume
    // the door; ledger it only if the checked argument truly holds.
    const report = mirrorCensus(shippedSources(), codeOf, MIRROR_LEDGER);
    expect(report).toEqual({ handRolled: [], staleLedger: [], badArguments: [] });
  });

  it("flags the exact pre-fix BugReportWindow shape, and clears the fixed one", () => {
    const FIXTURES: Record<string, string> = {
      // What shipped before task 629: cancel-on-teardown + a coupled,
      // unguarded peer re-read.
      "pre-629.tsx": `
        const [draftText, setDraftText] = useState(() => readLocal(DRAFT_KEY));
        useStorageKeySync([DRAFT_KEY, MACHINE_KEY], () => {
          setDraftText(readLocal(DRAFT_KEY));
        });
        useEffect(() => {
          const t = setTimeout(() => writeStorageIfChanged(DRAFT_KEY, draftText), 400);
          return () => clearTimeout(t);
        }, [draftText]);`,
      // The same component after it consumed the door.
      "post-629.tsx": `
        const [draftText, setDraftText, flushDraft] = useMirroredDraft(DRAFT_KEY);`,
      // A timer that has nothing to do with storage: not the population.
      "unrelated-timer.tsx": `
        const t = setTimeout(() => textareaRef.current?.focus(), 50);`,
      // An UNDEFERRED write is outside the population — nothing to flush.
      "eager-writer.ts": `
        export function save(v) { localStorage.setItem("k", v); }`,
      // A ledgered peer that really does flush and merge.
      "self-flushing.ts": `
        let writeTimer = null;
        function scheduleWrite() { writeTimer = setTimeout(flushNow, 250); }
        function flushNow() { writeStorageIfChanged(KEY, JSON.stringify(session)); }
        function merge3(base, ours, theirs) { return ours; }
        subscribeToStorageKey(KEY, () => { session = merge3(lastPersisted, session, peer); });
        window.addEventListener("pagehide", () => { if (writeTimer) flushNow(); });
        document.addEventListener("visibilitychange", () => { if (document.hidden) flushNow(); });`,
      // …and one that claims the same and does neither.
      "claims-too-much.ts": `
        let writeTimer = null;
        function scheduleWrite() { writeTimer = setTimeout(() => localStorage.setItem(KEY, blob), 250); }
        subscribeToStorageKey(KEY, () => { session = readValidBlob(); });`,
    };
    const read = (rel: string) => {
      if (!(rel in FIXTURES)) throw new Error(`no fixture ${rel}`);
      return commentsStripped(FIXTURES[rel].replace(/^[ \t]+/gm, ""));
    };

    // Unledgered: every deferred writer is flagged — the pre-fix shape, the
    // pretender, and the honest self-flusher alike. The population question is
    // "does this file defer a storage write?", and the ARGUMENT for deferring
    // it safely is the ledger's job, below. The three files that are not
    // deferred writers at all never enter.
    expect(mirrorCensus(Object.keys(FIXTURES), read, {}).handRolled).toEqual([
      "claims-too-much.ts",
      "pre-629.tsx",
      "self-flushing.ts",
    ]);

    // Ledgered: the honest one clears, the pretender's argument is checked and
    // rejected, and a ledger entry naming a file outside the population is stale.
    const r = mirrorCensus(Object.keys(FIXTURES), read, {
      "self-flushing.ts": { kind: "flushes-and-merges", reason: "true" },
      "claims-too-much.ts": { kind: "flushes-and-merges", reason: "a lie" },
      "post-629.tsx": { kind: "flushes-and-merges", reason: "stale — it uses the door" },
    });
    expect(r.handRolled).toEqual(["pre-629.tsx"]);
    expect(r.staleLedger).toEqual(["post-629.tsx"]);
    expect(r.badArguments).toEqual([
      "claims-too-much.ts (flushes-and-merges): no `pagehide` flush edge",
    ]);
  });

  it("the population is not vacuous", () => {
    const deferred = shippedSources().filter(
      (f) => HOLDS_TIMER_HANDLE.test(codeOf(f)) && WRITES_LS.test(codeOf(f)),
    );
    // The door + the one ledgered peer. A collapse here means the population
    // query broke, not that the app stopped deferring storage writes.
    expect(deferred.sort()).toEqual(Object.keys(MIRROR_LEDGER).sort());
  });
});
