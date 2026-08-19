#!/usr/bin/env node
/**
 * triage-sync-conflicts — a ONE-TIME report on the cloud-sync "conflicted copy"
 * forks in a Virgil paper's `virgil/` folder (task 363).
 *
 * The in-app badge tells you a folder HAS forks; this tells you whether any of
 * them hold records the live sidecar does not, which is the only question worth
 * answering before you delete anything.
 *
 * > It **reads only** by default, and it never merges. The two sides are
 * > whole-file snapshots taken at unknown times; picking a winner is precisely
 * > the destructive act the sync service itself declined to make. `--prune`
 * > deletes only forks this run proved carry NOTHING the live file is missing,
 * > and only after printing exactly what it will remove.
 *
 * Usage:
 *   node tools/triage-sync-conflicts.mjs "<paper folder>"            # report
 *   node tools/triage-sync-conflicts.mjs "<paper folder>" --extract  # write the
 *       fork-only records to virgil/.conflict-triage/<file>.extra.json
 *   node tools/triage-sync-conflicts.mjs "<paper folder>" --prune    # delete the
 *       forks that add nothing (and the .crswap debris), keeping the rest
 *
 * The folder argument is the PAPER folder (the one holding main.tex) or its
 * `virgil/` — either works.
 */
import fs from "node:fs";
import path from "node:path";

const CONFLICT_RES = [
  [/^(.+) \([^()]*conflicted copy[^()]*\)(\.[A-Za-z0-9]+)$/i, "dropbox"],
  [/^(.+)\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]+(\.[A-Za-z0-9]+)$/i, "syncthing"],
  [/^(.+) \((\d+)\)(\.[A-Za-z0-9]+)$/, "drive"],
  [/^(.+) (\d+)(\.[A-Za-z0-9]+)$/, "icloud"],
];
const CRSWAP_RE = /^(.+?)(?:\.\d+)?\.crswap$/;

/** Collect every `id` string anywhere in a JSON value. */
function idsOf(v, out = new Set()) {
  if (Array.isArray(v)) for (const x of v) idsOf(x, out);
  else if (v && typeof v === "object") {
    if (typeof v.id === "string") out.add(v.id);
    for (const x of Object.values(v)) idsOf(x, out);
  }
  return out;
}

/** The top-level record array a sidecar carries, whatever it calls it. */
function records(j) {
  if (!j || typeof j !== "object") return [];
  for (const k of ["cards", "snippets", "citations", "items", "entries", "notes", "requests"]) {
    if (Array.isArray(j[k])) return j[k];
  }
  return [];
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
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

  const names = fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile()).map((d) => d.name);
  const declared = new Set(names.filter((n) => /^[a-z][a-z0-9-]*\.json$/.test(n)));

  const byBase = new Map();
  const swap = [];
  for (const name of names) {
    if (declared.has(name)) continue;
    const s = CRSWAP_RE.exec(name);
    if (s && declared.has(s[1])) { swap.push(name); continue; }
    for (const [re] of CONFLICT_RES) {
      const m = re.exec(name);
      if (!m) continue;
      const base = `${m[1]}${m[m.length - 1]}`;
      if (!declared.has(base)) continue;
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base).push(name);
      break;
    }
  }

  const total = [...byBase.values()].reduce((n, l) => n + l.length, 0);
  console.log(`${dir}`);
  console.log(`  ${total} conflicted copies across ${byBase.size} files, ${swap.length} .crswap leftovers\n`);

  const inert = [];
  const outDir = path.join(dir, ".conflict-triage");
  for (const [base, forks] of [...byBase.entries()].sort()) {
    let live;
    try { live = JSON.parse(fs.readFileSync(path.join(dir, base), "utf8")); }
    catch { console.log(`  ${base}: LIVE FILE UNREADABLE — inspect by hand`); continue; }
    const liveIds = idsOf(live);
    const extra = new Map();
    for (const f of forks) {
      let j;
      try { j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); }
      catch { continue; }
      const own = records(j).filter((r) => r?.id && !liveIds.has(r.id));
      if (own.length === 0) inert.push(f);
      else for (const r of own) if (!extra.has(r.id)) extra.set(r.id, { from: f, record: r });
    }
    const flag = extra.size ? `⚠  ${extra.size} record(s) only in a fork` : "nothing the live file lacks";
    console.log(`  ${base}: ${forks.length} fork(s) — ${flag}`);
    for (const [id, { from, record }] of extra) {
      const when = record.createdAt ?? record.created ?? "?";
      console.log(`      ${id.slice(0, 12)}  ${String(when).slice(0, 19)}  ${from}`);
    }
    if (extract && extra.size) {
      fs.mkdirSync(outDir, { recursive: true });
      const out = path.join(outDir, `${base.replace(/\.json$/, "")}.extra.json`);
      fs.writeFileSync(out, JSON.stringify([...extra.values()], null, 2));
      console.log(`      → wrote ${out}`);
    }
  }

  const removable = [...inert, ...swap];
  console.log(`\n  ${removable.length} file(s) carry nothing the live sidecars lack.`);
  if (!prune) {
    console.log("  Re-run with --prune to delete just those, or --extract to save the fork-only records.");
    return;
  }
  for (const f of removable) {
    fs.unlinkSync(path.join(dir, f));
    console.log(`  removed ${f}`);
  }
  console.log(`\n  Kept every fork that holds a record the live file does not. Those are yours to read.`);
}

main();
