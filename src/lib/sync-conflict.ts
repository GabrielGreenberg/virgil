/**
 * **The fork half** — noticing what a sync daemon did to `virgil/` (task 363).
 *
 * [sidecar-value.ts](sidecar-value.ts) states the law this module is the second
 * half of: against a writer you cannot serialize with, the only two moves are to
 * shrink the race window and to NOTICE the fork. Shrinking is the write cadence;
 * this is the noticing.
 *
 * When Dropbox (or iCloud / Drive / Syncthing) lands a remote version of a file
 * whose local copy has moved on, it does not merge — it renames one side aside
 * and says nothing to the application. Virgil's model has no idea: the file it
 * owns still parses, the panel still renders, and a `notes (Gabriel's conflicted
 * copy 2026-06-09 5).json` sits in the folder holding a note the user wrote and
 * cannot see. In the folder this task was filed from, four content sidecars had
 * records that exist ONLY in a fork — a note, three archived excerpts, four
 * revision cards, four citations.
 *
 * > **A conflicted sibling of a CONTENT sidecar is unmerged user data.** Virgil
 * > cannot merge it (the two sides are whole-file snapshots taken at unknown
 * > times, and picking a winner is exactly the destructive act the sync service
 * > already declined to make) and it must not stay silent about it. So it
 * > REPORTS: which files, how many, and which of them hold writing.
 *
 * ## Why the vocabulary can be closed, and where it deliberately is not
 *
 * The base names are a CLOSED set — `SIDECAR_VALUE` is total over what Virgil
 * writes into `virgil/` — so a decoration grammar that would be hopelessly
 * ambiguous over arbitrary filenames is safe here: `notes 2.json` can only be a
 * fork of `notes.json`, because nothing in Virgil is called `notes 2`. An exact
 * match against a declared filename short-circuits FIRST, so a real sidecar is
 * never mistaken for a sibling of another one.
 *
 * OneDrive is the one grammar deliberately left out. It decorates with a bare
 * `-<hostname>` suffix, whose shape is indistinguishable from a file the user
 * put there themselves (`notes-old.json`), and unlike the others the decoration
 * is unconstrained, so the closed-base short-circuit buys nothing. Naming a
 * user's own file as unmerged data is a worse error than missing a OneDrive
 * fork, and OneDrive is not where this was reported from. Stated rather than
 * implied: this scanner is not complete over every sync service.
 */

import { SIDECAR_VALUE, sidecarTier, type SidecarTier } from "@/lib/sidecar-value";

/** Which service's grammar matched. Reported so the copy can name the likely
 *  writer rather than saying "something touched your files". */
export type SyncConflictOrigin =
  | "dropbox"
  | "syncthing"
  | "drive"
  | "icloud"
  | "chrome-swap";

export interface SidecarSibling {
  /** The file as it sits on disk. */
  name: string;
  /** The declared sidecar it is a sibling OF. */
  base: string;
  /**
   * `"conflict"` — a whole-file FORK a sync service minted because it could not
   * merge. May hold user data Virgil has never shown.
   * `"swap"` — a Chrome File System Access `.crswap` temp file left behind by an
   * interrupted write. Never user data (it is either a partial copy of what
   * Virgil was writing or a complete one that already landed) — debris, and the
   * honest signal that writes were being interrupted.
   */
  kind: "conflict" | "swap";
  origin: SyncConflictOrigin;
}

/** One base name's siblings, with the base's own tier attached. */
export interface SyncConflictGroup {
  base: string;
  tier: SidecarTier;
  siblings: SidecarSibling[];
}

export interface SyncConflictReport {
  /** Per base, only for bases that HAVE a conflict fork. Sorted: content first
   *  (the half that can be unmerged writing), then by descending count. */
  groups: SyncConflictGroup[];
  /** Chrome `.crswap` debris, flat — it is never user data, so it needs no
   *  grouping, only a count. */
  swapFiles: string[];
  /** Total conflict forks across all bases. */
  total: number;
  /** How many of those are forks of a CONTENT sidecar — the number that means
   *  "this may be your writing". */
  contentTotal: number;
}

// A Dropbox fork: `notes (Gabriel Greenberg's conflicted copy 2026-08-18).json`,
// `… 2026-08-18 5).json`, and the older un-attributed `(conflicted copy …)`.
// Deliberately loose inside the parens — the owner name is arbitrary user text
// and the date format has changed across Dropbox versions; what identifies the
// grammar is the literal phrase.
const DROPBOX_RE = /^(.+) \([^()]*conflicted copy[^()]*\)(\.[A-Za-z0-9]+)$/i;
// Syncthing: `notes.sync-conflict-20260818-120000-ABCDEFG.json`.
const SYNCTHING_RE = /^(.+)\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]+(\.[A-Za-z0-9]+)$/i;
// Google Drive / macOS duplication: `notes (1).json`.
const DRIVE_RE = /^(.+) \((\d+)\)(\.[A-Za-z0-9]+)$/;
// iCloud Drive: `notes 2.json`.
const ICLOUD_RE = /^(.+) (\d+)(\.[A-Za-z0-9]+)$/;
// Chrome FSA write debris: `notes.json.3.crswap`, `notes.json.crswap`.
const CRSWAP_RE = /^(.+?)(?:\.\d+)?\.crswap$/;

function isDeclared(filename: string): boolean {
  return Object.prototype.hasOwnProperty.call(SIDECAR_VALUE, filename);
}

/**
 * Classify one directory entry of `virgil/`.
 *
 * Returns `null` for a declared sidecar, for `.history/`, and for anything whose
 * decoration does not match a known grammar or whose base is not a file Virgil
 * writes — the fail-CLOSED direction, so a file the user parked in the folder is
 * never reported back to them as their own lost writing.
 */
export function classifySidecarSibling(name: string): SidecarSibling | null {
  // A real sidecar is never a sibling. First, so no decoration grammar can
  // reinterpret a declared name (`bib-settings.json` as `bib` + a suffix).
  if (isDeclared(name)) return null;

  const swap = CRSWAP_RE.exec(name);
  if (swap) {
    const base = swap[1]!;
    return isDeclared(base)
      ? { name, base, kind: "swap", origin: "chrome-swap" }
      : null;
  }

  const grammars: [RegExp, SyncConflictOrigin][] = [
    [DROPBOX_RE, "dropbox"],
    [SYNCTHING_RE, "syncthing"],
    [DRIVE_RE, "drive"],
    [ICLOUD_RE, "icloud"],
  ];
  for (const [re, origin] of grammars) {
    const m = re.exec(name);
    if (!m) continue;
    // The stem is capture 1 and the extension is always the LAST capture.
    const base = `${m[1]}${m[m.length - 1]}`;
    if (!isDeclared(base)) continue;
    return { name, base, kind: "conflict", origin };
  }
  return null;
}

/**
 * Fold a `virgil/` directory listing into a report. Pure — the caller supplies
 * the names, so this is testable without a filesystem and works identically
 * over both storage backends.
 */
export function scanSidecarSiblings(names: readonly string[]): SyncConflictReport {
  const byBase = new Map<string, SidecarSibling[]>();
  const swapFiles: string[] = [];
  for (const name of names) {
    const s = classifySidecarSibling(name);
    if (!s) continue;
    if (s.kind === "swap") {
      swapFiles.push(name);
      continue;
    }
    const list = byBase.get(s.base);
    if (list) list.push(s);
    else byBase.set(s.base, [s]);
  }
  const groups: SyncConflictGroup[] = [...byBase.entries()]
    .map(([base, siblings]) => ({ base, tier: sidecarTier(base), siblings }))
    .sort((a, b) => {
      // Content first — that is the half that can be unmerged writing.
      if (a.tier !== b.tier) return a.tier === "content" ? -1 : 1;
      if (a.siblings.length !== b.siblings.length)
        return b.siblings.length - a.siblings.length;
      return a.base.localeCompare(b.base);
    });
  const total = groups.reduce((n, g) => n + g.siblings.length, 0);
  const contentTotal = groups
    .filter((g) => g.tier === "content")
    .reduce((n, g) => n + g.siblings.length, 0);
  return { groups, swapFiles, total, contentTotal };
}

/** True when there is anything at all worth telling the user about. */
export function hasSyncConflicts(r: SyncConflictReport): boolean {
  return r.total > 0;
}
