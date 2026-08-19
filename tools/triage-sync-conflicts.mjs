#!/usr/bin/env node
/**
 * triage-sync-conflicts — a report on the cloud-sync "conflicted copy" forks in
 * a Virgil paper's `virgil/` folder (task 363).
 *
 * The in-app badge tells you a folder HAS forks; this tells you which of them
 * hold something the live sidecar does not, which is the only question worth
 * answering before deleting anything.
 *
 * > **An "inert" verdict is POSITIVE evidence, and a shape this tool does not
 * > understand is not evidence.** It never merges — the two sides are whole-file
 * > snapshots taken at unknown times, and picking a winner is precisely the
 * > destructive act the sync service itself declined to make. `--prune` deletes
 * > only what a run PROVED carries nothing: a fork whose parsed JSON is
 * > structurally identical to the live file, a fork of a file the app declares
 * > VIEW state (recomputable by definition), and the browser's own `.crswap`
 * > debris. Everything else is reported and kept.
 *
 * The first version of this tool got that backwards, and the mistake is worth
 * recording because it is the shape this whole task is about. It decided
 * "inert" by asking whether the fork held a RECORD ID the live file lacked,
 * reading the records out of a hand list of seven container keys. Both halves
 * fail OPEN in the destructive direction: eight of the twenty declared sidecars
 * use a key that list does not know (or are not arrays at all), so their forks
 * were never inspected and were deleted while the report said they carried
 * nothing; and an id-membership test cannot see the COMMONEST conflict shape of
 * all — the same record edited on two machines, same id, different body.
 *
 * Usage:
 *   node tools/triage-sync-conflicts.mjs "<paper folder>"            # report
 *   node tools/triage-sync-conflicts.mjs "<paper folder>" --extract  # copy every
 *       fork that DIFFERS into virgil/.conflict-triage/ for reading
 *   node tools/triage-sync-conflicts.mjs "<paper folder>" --prune    # delete only
 *       the forks this run proved carry nothing
 *
 * The folder argument is the PAPER folder (the one holding main.tex) or its
 * `virgil/` — either works.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIDECAR_VALUE_TS = path.join(HERE, "..", "src", "lib", "sidecar-value.ts");

/**
 * The declared vocabulary, READ FROM the app's SSOT rather than guessed from the
 * folder's contents. That direction is the whole safety argument: `sync-conflict.ts`
 * can afford loose decoration grammars ("`notes 2.json` is a fork of
 * `notes.json`") only because the base names are a CLOSED set. A tool that
 * called any lowercase `.json` in the folder a declared base would apply the
 * loose grammar to the user's own files — on the side that deletes.
 *
 * A regex over the TS source, because this is a `.mjs` script with no build
 * step. The extraction is pinned in CI against the real table
 * (`sidecar-value-ssot.test.ts`), so a drift fails the build rather than
 * silently narrowing the tool.
 */
function readSidecarValue() {
  const src = fs.readFileSync(SIDECAR_VALUE_TS, "utf8");
  const out = new Map();
  for (const m of src.matchAll(
    /"([a-z][a-z0-9-]*\.json)":\s*\{\s*tier:\s*"(view|content)"/g,
  )) {
    out.set(m[1], m[2]);
  }
  if (out.size === 0) {
    throw new Error(`could not read the sidecar vocabulary from ${SIDECAR_VALUE_TS}`);
  }
  return out;
}

/**
 * The decoration grammars. Byte-identical to `src/lib/sync-conflict.ts` — a
 * second speller of a vocabulary two layers must agree on, which CI pins
 * (the same suite compares these sources against the module's).
 */
const CONFLICT_RES = [
  [/^(.+) \([^()]*conflicted copy[^()]*\)(\.[A-Za-z0-9]+)$/i, "dropbox"],
  [/^(.+)\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]+(\.[A-Za-z0-9]+)$/i, "syncthing"],
  [/^(.+) \((\d+)\)(\.[A-Za-z0-9]+)$/, "drive"],
  [/^(.+) (\d+)(\.[A-Za-z0-9]+)$/, "icloud"],
];
const CRSWAP_RE = /^(.+?)(?:\.\d+)?\.crswap$/;

/** Order-insensitive structural equality. Object key order is not meaning, and
 *  a JSON round-trip can reorder it. */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

/** A best-effort HINT about what a fork adds: top-level records (whatever the
 *  container is called) whose `id` the live file does not have. Informational
 *  ONLY — it decides nothing, because a shape it cannot read and a body edit
 *  under an unchanged id are both invisible to it. */
function newRecordHint(live, fork) {
  const liveIds = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if (typeof v.id === "string") liveIds.add(v.id);
      Object.values(v).forEach(walk);
    }
  };
  walk(live);
  const arrays = fork && typeof fork === "object" && !Array.isArray(fork)
    ? Object.values(fork).filter(Array.isArray)
    : Array.isArray(fork) ? [fork] : [];
  const out = [];
  for (const arr of arrays) {
    for (const r of arr) {
      if (r && typeof r === "object" && typeof r.id === "string" && !liveIds.has(r.id)) {
        out.push(r);
      }
    }
  }
  return out;
}

function main() {
  const arg = process.argv[2];
  if (!arg || arg.startsWith("--")) {
    console.error("usage: triage-sync-conflicts.mjs <paper folder> [--extract] [--prune]");
    process.exit(2);
  }
  const extract = process.argv.includes("--extract");
  const prune = process.argv.includes("--prune");
  const root = path.resolve(arg);
  const dir = path.basename(root) === "virgil" ? root : path.join(root, "virgil");
  if (!fs.existsSync(dir)) {
    console.error(`no virgil/ folder at ${dir}`);
    process.exit(1);
  }

  const tiers = readSidecarValue();
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name);

  const byBase = new Map();
  const swap = [];
  for (const name of names) {
    if (tiers.has(name)) continue; // a declared sidecar is never a sibling
    const s = CRSWAP_RE.exec(name);
    if (s && tiers.has(s[1])) {
      swap.push(name);
      continue;
    }
    for (const [re] of CONFLICT_RES) {
      const m = re.exec(name);
      if (!m) continue;
      const base = `${m[1]}${m[m.length - 1]}`;
      if (!tiers.has(base)) continue;
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base).push(name);
      break;
    }
  }

  const total = [...byBase.values()].reduce((n, l) => n + l.length, 0);
  console.log(dir);
  console.log(
    `  ${total} conflicted copies across ${byBase.size} files, ${swap.length} .crswap leftovers\n`,
  );

  const prunable = [...swap]; // browser debris — never user data
  const differs = [];
  const outDir = path.join(dir, ".conflict-triage");

  for (const [base, forks] of [...byBase.entries()].sort()) {
    const tier = tiers.get(base);
    let live;
    let liveReadable = true;
    try {
      live = JSON.parse(fs.readFileSync(path.join(dir, base), "utf8"));
    } catch {
      liveReadable = false;
    }
    const same = [];
    const diff = [];
    for (const f of forks) {
      if (tier === "view") {
        // Declared recomputable by the app itself — nothing here is writing, so
        // there is no comparison to make and no evidence to withhold.
        same.push(f);
        continue;
      }
      if (!liveReadable) {
        diff.push([f, "live file unreadable — cannot compare"]);
        continue;
      }
      let j;
      try {
        j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      } catch {
        diff.push([f, "fork unreadable — inspect by hand"]);
        continue;
      }
      if (deepEqual(j, live)) {
        same.push(f);
        continue;
      }
      const hint = newRecordHint(live, j);
      diff.push([
        f,
        hint.length
          ? `differs — ${hint.length} record(s) the live file does not have: ` +
            hint
              .map((r) => `${String(r.id).slice(0, 12)} (${String(r.createdAt ?? r.created ?? "?").slice(0, 19)})`)
              .join(", ")
          : "differs — same records, different content",
      ]);
    }
    prunable.push(...same);
    differs.push(...diff.map(([f]) => f));

    const label =
      tier === "view"
        ? `${forks.length} fork(s) — VIEW state, nothing to lose`
        : `${forks.length} fork(s) — ${same.length} identical, ${diff.length} differ`;
    console.log(`  ${base}: ${label}`);
    for (const [f, why] of diff) console.log(`      ${f}\n        ${why}`);

    if (extract && diff.length) {
      fs.mkdirSync(outDir, { recursive: true });
      for (const [f] of diff) {
        fs.copyFileSync(path.join(dir, f), path.join(outDir, f));
      }
      console.log(`      → copied ${diff.length} differing fork(s) to ${outDir}`);
    }
  }

  console.log(
    `\n  ${prunable.length} file(s) PROVED to carry nothing (identical to the live file, ` +
      `view-tier, or browser debris).\n  ${differs.length} file(s) DIFFER and are kept — read them, they may hold your writing.`,
  );
  if (!prune) {
    console.log("  Re-run with --prune to delete just the proved-inert ones, or --extract to copy the differing ones out.");
    return;
  }
  for (const f of prunable) {
    fs.unlinkSync(path.join(dir, f));
  }
  console.log(`  removed ${prunable.length} file(s); kept every fork that differs.`);
}

main();
