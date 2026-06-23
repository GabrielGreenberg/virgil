# External-change badge — unified design

**Status:** IMPLEMENTED on `worktree-external-change-badge` (base `origin/main` 225f7f46) — tsc clean, full suite 2603/2603 green (~71 new tests), 0 new lint. NOT yet merged to local main. Live browser/FSA feel-check OWED (worktree preview blocked by no-virgil-data + Next 16 Turbopack-on-symlinked-node_modules; do it on merged main).
**Worktree:** `worktree-external-change-badge`
**Date:** 2026-06-22 (built 2026-06-23)

### As-built file map
- **Engine:** `src/lib/disk-ledger.ts` (fingerprint baseline + cyrb53 hash), `src/lib/disk-watcher.ts` (poller + store + poll/confirm/severity/prime), `src/lib/autosave-pause.ts` (guard predicate).
- **Storage capability:** `statFiles` + `readTextFile` + `getBibFilename` on the facade (`storage.ts`) + both backends (`storage-fsa.ts`, `storage-dev.ts`); dev `HEAD` routes (`api/dev/...`, `api/dev-library/...`); ledger stamps at the write/load sites (load + writes only — never plain reads).
- **React:** `src/components/editor-layout/contexts/disk-watcher.tsx` (`DiskWatcherProvider` + `useDiskWatcher` + `registerUnsavedGetter`/`registerReload`/`reloadFromDisk`), `src/hooks/useExternalChanges.ts`, `useDocument.ts` (dirty-getter + autosave-pause guard + reload registration), `src/components/ExternalChangeBadge.tsx`, mount + divider-gate in `EditorLayout.tsx`.
- **Tests:** `disk-ledger`, `disk-watcher`, `stat-files-fsa`, `stat-files-dev`, `autosave-pause`, `useDocument.autosave-pause`, `external-change-badge`.

---

## 1. The ask, and the deeper class

> "Is there any way I could have an indicator that another user is opening the file in Overleaf?"

There is no third-party presence signal from Overleaf (its presence lives in a private socket.io channel; Dropbox/Git/GitHub sync carry *file content only*, never presence). So the honest, buildable indicator is **not** "someone is viewing in Overleaf" but **"the file changed underneath you"** — which is exactly the moment an Overleaf-via-sync edit lands on disk.

Rather than a one-off badge that stats one `.tex`, this design treats the badge as the surface of a **class of phenomena Virgil currently ignores: Virgil assumes it is the sole writer of a paper's files, but it isn't.** External writers include:

- **Overleaf → Dropbox / Git bridge / GitHub** sync (the headline case)
- `vim` / CLI / any other editor
- **git** operations: `pull`, `checkout`, branch switch, `rebase`
- Dropbox / Drive **conflict copies**
- A **sibling Virgil window** on the same machine (writes coordinate via `withDocLock`, but each window's view of disk is independent)
- An **active collaborator** in collab mode — already handled by the presence sidecar; this is the *active* counterpart

The unified frame: **"disk-truth awareness."** A single subsystem that always knows whether the on-disk bytes of every file Virgil owns still match what Virgil last wrote or read, and surfaces drift. This is the **passive** sibling of collaborator **presence** (the active "who's here" signal). Together they form one coherent "external influence on this paper" model — unified at the presentation layer (see §7).

---

## 2. Architecture overview

Seven components, four of them new, three of them seams into existing code.

```
                       ┌─────────────────────────────────────────────┐
   Virgil writes ──────▶  enqueueDocWrite / writeTextToHandle         │  (existing chokepoint)
   (.tex/.bib/sidecar)  │     └─ on close: re-stat → stampDiskLedger  │  ← NEW stamp
                       └─────────────────────────────────────────────┘
   readDocBundle  ──────▶  on load + load-writeback completion ─────────  stampDiskLedger   ← NEW stamp
                                          │
                                          ▼
                            ┌───────────────────────────┐
                            │   diskLedger (module map)  │   docId → relPath → {mtimeMs,size,hash}
                            │   = "expected on-disk"     │   ← NEW (the false-positive killer)
                            └───────────────────────────┘
                                          ▲ compare
   wall-clock poll  ────────▶  DiskWatcher service  ──── statFiles(docId, paths)  ──▶ storage facade
   (2–4s, visibility-      │     confirm-by-hash on suspicion          │              ├─ FSA: getFile()
    + focus-gated)         │     severity = change | conflict          │              └─ dev: stat route
                           └───────────────┬───────────────────────────┘            ← NEW capability
                                           ▼
                            ┌───────────────────────────┐
                            │  ExternalChangeStore       │  subscribe()/getSnapshot()  ← NEW
                            └───────────────┬───────────┘
                                           ▼
        ┌──────────────────────────────────────────────────────┐
        │  <ExternalChangeBadge>  (topbar status cluster)        │  ← NEW
        │   • clean change  → amber pill  "Changed on disk · Reload"
        │   • conflict      → danger pill "Disk changed + unsaved edits · Review"
        │   actions (MenuProvider, body-portaled): Reload / Dismiss / [Diff — future]
        └──────────────────────────────────────────────────────┘
```

### Data flow in one paragraph
Every Virgil write already funnels through `enqueueDocWrite` (`storage-fsa.ts:185`). After the write closes, we **re-stat the file and stamp `diskLedger[docId][relPath] = {mtimeMs, size, hash}`** — the authoritative "this is what we put there." The load path (`readDocBundle`) and its fire-and-forget UUID **load-writeback** (`writeReStampedTexOnLoad`) stamp the ledger on completion too, so the baseline reflects post-load reality. A per-doc **`DiskWatcher`** polls `statFiles()` every few seconds (paused when the tab is hidden; fires immediately on tab-focus — the moment the user returns from Overleaf). When a file's live `{mtime,size}` differs from the ledger, the watcher does **one confirming read + hash compare** (kills the residual false positives: a `touch`, or the load-writeback bumping mtime with identical bytes). A confirmed mismatch publishes an `ExternalChangeEvent` to the **`ExternalChangeStore`**, which the **badge** renders. The badge's severity depends on the **`saveTimerRef.current !== null`** dirty flag from `useDocument` (clean change vs. true conflict). The action is always **explicit and user-driven** (reuse `refetch()` to reload; never auto-merge).

---

## 3. The false-positive problem and its solution (the lynchpin)

A naive "poll mtime, compare to load-time mtime" approach produces constant false positives in Virgil because **Virgil writes its own files all the time**:

1. **Load-writeback**: `readDocBundle` mints UUIDs and writes the re-stamped `.tex` + `virgil.json` back on every load (FSA `storage-fsa.ts:357-364`, dev `storage-dev.ts:272-277`). The `.tex` mtime changes seconds after load — *before the user touches anything*.
2. **Autosave**: every 1500ms of editing writes the bundle.
3. **Sidecar writes**: card edits write `virgil/*.json` constantly.

**Solution — the `diskLedger` (write-ledger):** a module-level `Map<docId, Map<relPath, Fingerprint>>` recording the **expected on-disk fingerprint** of every file Virgil owns. It is stamped at exactly the two places where Virgil establishes ground truth:

- **After every write** — re-stat *after* `writable.close()` so the recorded `mtimeMs` is the OS's real post-write value, not a guess. One stamp site at the `enqueueDocWrite` chokepoint covers `.tex`, `.bib`, bundle, and all sidecars.
- **After every load** (and after the load-writeback settles) — so the post-UUID-stamp state is the baseline.

`Fingerprint = { mtimeMs: number; size: number; hash?: string }`. The cheap `{mtimeMs,size}` is the poll trigger; `hash` (a fast content hash, computed only when we already have the bytes in hand — on write we have them, on confirm we read them) is the tiebreaker. The watcher only flags a change when the **content hash** differs from the ledger, so:

- A `touch` (mtime bumps, bytes identical) → **no badge**.
- The load-writeback (mtime bumps, bytes == what we wrote) → **no badge**.
- A genuine external edit (bytes differ) → **badge**.

This single mechanism is what makes the feature trustworthy. It is also why the design is *not* a surgical patch — the ledger is reusable infrastructure (figure-cache invalidation already wants this; cross-window write coordination can ride it later).

**As-built refinement (stamp discipline).** Implementation hardened the rule to: **the ledger is stamped ONLY by *load* (`readDocBundle` + the `writeReStampedTexOnLoad` load-writeback) and *writes* (`writeTex`/`writeDocBundle`/`writeBib`) — never by a plain content read.** `readTex`/`readBib` are pure readers. This is essential because the watcher itself reads files to confirm-by-hash; if a plain read re-baselined the ledger, the watcher's own confirm read would clear the very change it just surfaced (a genuine edit would flag, then silently un-flag one poll later — *flicker*). Two consequences: (1) the watcher confirms via a dedicated non-stamping `readTextFile(docId, relPath)` of the **exact** path it stat'd (no name re-resolution mid-poll); (2) the `.bib` baseline is no longer set by `readBib` — instead the watcher's **prime pass** (its first poll after `start()`) baselines every present watched file to current disk bytes *without flagging*, which both seeds the `.bib` baseline and deterministically absorbs the load-writeback race (no false flash on doc open, regardless of writeback timing).

---

## 4. Detection vs. conflict — the severity model

A flat "changed on disk" badge under-serves the dangerous case. We split on the **canonical dirty flag** `saveTimerRef.current !== null` (the SSOT for "there are unsaved in-editor edits", `useDocument.ts:117-121`), exposed to the watcher via a tiny `hasUnsavedEdits()` getter:

| Disk changed? | Local unsaved edits? | State | Badge |
|---|---|---|---|
| no | — | clean | (no badge) |
| **yes** | **no** | **external change** | amber · *"Changed on disk · Reload"* |
| **yes** | **yes** | **conflict** | danger · *"Disk changed + you have unsaved edits · Review"* |

**Autosave-clobber guard (the deep safety move).** When an *unresolved* external change exists, the autosaver must not silently overwrite the disk — that would destroy the external edit with no trace. So while a pending unresolved change exists, the **background debounced autosave is paused** (a guard in the save path checks the watcher's `hasUnresolvedChange()`), and the badge is the required resolution surface.

**As-built scope (terminal-flush carve-out).** The pause covers the *background* save paths only — the debounced autosave, `flushNow`, and `flushAnchorCommit`. The **terminal flushes still run**, to preserve the user's in-editor work: `pagehide`, `beforeunload`, the unmount cleanup, **and the doc-switch barrier (`flushPending` via `drainDoc`)**. So if the user closes the tab *or switches documents* while a conflict is unresolved, their in-editor version is written (equivalent to choosing **Keep mine**); the external edit is overwritten. The "both directions" protection therefore applies to the common *editing* case (background autosave never silently clobbers Overleaf), with the terminal events resolving in the user's favor by design. (This is the real product call from Open Decisions: *pause-until-resolved*.)

---

## 5. Reconcile actions — safe by construction

The reconcile-semantics research is decisive: **auto-merging external `.tex` is unsafe.** `assignUuids` runs unconditionally on parse and re-mints paragraph UUIDs; `recoverOrphanedUuids` (fingerprint re-matching) is **disabled** because it causes UUID collisions on duplicated text. A re-parse therefore **silently orphans card anchors** — and because the card keeps `links.length > 0`, `isUnanchored` reports `false`, *masking* the orphan until the user tries to interact with the card. So every action is explicit:

- **Reload from disk** (primary). Reuses the existing, proven `refetch()` in `useDocument` (`readDocBundle → setContent → update lastSavedRef`). No new merge engine. Cost: discards in-editor unsaved edits — offered cleanly when there are none; gated behind a confirm when there are (conflict state).
- **Dismiss / keep mine.** Acknowledge the change: re-baseline the ledger to the *current disk fingerprint* (so the badge clears) and let the next autosave proceed — Virgil's version wins, overwriting the external edit, by explicit user choice.
- **Diff / 3-way (future).** The watcher holds both the disk bytes and the in-editor doc, so a side-by-side is a natural later extension. Out of scope for v1.

---

## 6. Keystroke sanctity — satisfied by construction

The `DiskWatcher` is a **wall-clock poller, not an editor subscriber**. It never adds an `editor.on('update' | 'transaction')` handler, so it does **zero** per-keystroke work — `window.__virgilBusStats().emitCount` stays flat while typing. Its only editor touch is reading the O(1) `hasUnsavedEdits()` ref at poll time. Modeled on the existing 2000ms `setInterval` poller at `EditorLayout.tsx:1795`. Visibility-gated like `drag-ghost.ts:120` (pause on `document.visibilityState === 'hidden'`; immediate poll on `visibilitychange → visible` and window `focus`). It needs **no** entry in the AGENTS.md "permitted `editor.on(...)` subscribers" list because it is not one; it will be documented as a permitted wall-clock service.

---

## 7. UI — the badge and the status cluster

**Mount:** the topbar status-indicator flex container at `EditorLayout.tsx:4001-4032`, immediately beside `CollabStatusPill` (line 4031). The divider gate at `EditorLayout.tsx:4040` must be widened to include the new state (else the divider vanishes when only the badge is active).

**Form:** reuse the `CollabStatusPill` badge-variant pill (`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] border border-edge-subtle`), the secondary-action button pattern, and the kebab/menu pattern. Tones: `--amber-*` for a clean change, `--danger-soft` / `--danger` for a conflict (tokens confirmed to exist in `globals.css`). Icon: 16px stroke-only lucide (`RefreshCw` / `FileWarning`), per topbar icon spec. `data-hint` for the tooltip. The action menu uses `MenuProvider` + `useMenuItem` (keyboard nav) and **must be body-portaled at `z-2000`** — the sticky topbar is a `z-30` stacking context that traps `position:absolute` dropdowns.

**Unification with presence (presentation-layer, not data-layer).** The deepest *correct* unification is to render the passive disk signal and the active collaborator presence as one **"paper status" cluster** sharing vocabulary — *not* to inject a synthetic "external writer" entry into `collab.json`. Reasons the data-layer merge is the wrong depth:

- External-change detection must be **always-on**, but the collab poll loop **stops when `collab.enabled === false`** (it's pointless for a solo Overleaf-syncing user). Coupling an always-on feature to a sometimes-on subsystem is fragile.
- Writing a synthetic entry into `collab.json` is a *disk write* that other participants read — meaningless for a solo user and noise for collaborators.

So: **detection is an independent, always-on subsystem; presentation may share a cluster with `CollabStatusPill`.** v1 ships an adjacent badge in the same cluster with shared styling; folding the two pills into a single composed cluster is a clean follow-up.

---

## 8. New storage capability — `statFiles`

Add to the storage facade (`storage.ts`) and both backends:

```ts
type FileStat = { mtimeMs: number; size: number };
statFiles(docId: string, relPaths: string[]): Promise<Record<string, FileStat | null>>; // null = absent
```

- **FSA** (`storage-fsa.ts`): `dirHandle.getFileHandle(path)` → `getFile()` → `{ lastModified, size }`. Identical to the figure-source fingerprint already built at `storage-fsa.ts:766`. `getFile()` does not take the write lock, so it is safe to call concurrently with writes (it returns a stable snapshot). On `NotAllowedError` (permission lost) → return a sentinel that pauses the watcher (defer to `DocPermissionGate`).
- **Dev** (`storage-dev.ts` + `route.dev.ts`): the GET handler already returns `Last-Modified` + `Content-Length` (`route.dev.ts:146-147`). Add a lightweight **`HEAD`** (or `?stat=1`) branch so the poll does not download the whole `.tex` body each tick; parse the two headers into `{ mtimeMs, size }`.

The watcher talks **only** to this facade — never to FSA/dev directly — so both modes stay in lockstep and library-paper (read-only) docs work unchanged.

---

## 9. Watched set

v1: **main `.tex` + resolved `.bib`** (the user-facing content; the Overleaf case). The set is resolved per-doc and re-resolved when the `.tex` changes (an external edit can change `\bibliography{}` → `resolveBibFilename` may now point at a different `.bib`). The `virgil/*.json` sidecars are Virgil-owned and largely self-healing on `.tex` round-trip, so they are **lower priority** and excluded from v1 (the abstraction accepts them trivially when wanted). The watch-set is an interface (`getWatchedFiles(docId): Promise<string[]>`) designed to scale to the **whole paper folder** (catching `\input` children + figures) via `readPaperFolder` minus `virgil/` — see Open Decisions.

---

## 10. Edge cases

- **External delete** (git checkout to a branch lacking the file): `statFiles` → `null`. Badge "removed on disk"; never auto-write (would recreate it); offer reload (shows `DEFAULT_LATEX`) or keep-mine.
- **FSA permission lost mid-session**: `getFile` throws `NotAllowedError` → watcher pauses, no false badge; `DocPermissionGate` already owns re-grant.
- **Bib-filename shift**: re-run `resolveBibFilename` on any detected `.tex` change so we watch the correct `.bib`.
- **Dev UUID-writeback**: handled by ledger-stamp-on-writeback-completion + confirm-by-hash (identical bytes → no badge).
- **Library papers** (`library-paper:` prefix): read-only; no write-ledger needed; baseline = load fingerprint. Watching still surfaces a re-index. Works unchanged.
- **mtime granularity** (dev `Last-Modified` ~1s; FSA precise): size + content-hash confirm covers same-second / same-size edits.

---

## 11. Phasing (reviewable chips)

**Phase 0 — foundations**
- **Chip 1**: `FileStat` + `statFiles()` in facade + FSA + dev (+ dev `HEAD`/`?stat=1`). Reuse figure fingerprint. Unit tests both backends.
- **Chip 2**: `disk-ledger.ts` (per-doc fingerprint map) + stamp at the `enqueueDocWrite` write chokepoint (re-stat after close) and at `readDocBundle` / `writeReStampedTexOnLoad` completion. Tests: a Virgil write makes the next `statFiles` match the ledger (zero false positive); load-writeback does not flag.

**Phase 1 — detection**
- **Chip 3**: `disk-watcher.ts` — service + `ExternalChangeStore` (`useSyncExternalStore`-compatible), poll loop, visibility + focus gating, confirm-by-hash, watched-set resolution, bib re-resolve, delete handling. Tests with a fake backend: external drift flags, Virgil write no-ops, hash-confirm suppresses touch, delete surfaces.
- **Chip 4**: thread `hasUnsavedEdits()` from `useDocument`; severity (change vs. conflict); autosave-clobber guard (pause save while unresolved).

**Phase 2 — UI + reconcile**
- **Chip 5**: `<ExternalChangeBadge>` + mount in the status cluster + divider-gate update; `MenuProvider` action menu, body-portaled; `useExternalChanges(docId)` hook; `<DiskWatcher>` mounted under `<DocPipeline>`.
- **Chip 6**: actions — Reload → `refetch()` + re-baseline + clear; Dismiss → re-baseline + clear; conflict reload behind a confirm.

**Phase 3 — polish + docs**
- **Chip 7**: STYLE_GUIDE badge note, AGENTS.md poller doc, ui-chrome.md status-cluster note, glossary term. Live-preview verify on `doc_devtest`: simulate an external write to the `.tex` on disk, confirm the badge appears, reload works, and `emitCount` stays flat while typing.

---

## 12. Open decisions (for Gabriel)

1. **Watch scope v1** — `.tex` + `.bib` only (headline Overleaf case, cheapest), or the **whole paper folder** (also catches `\input` children + figures) from the start?
2. **Conflict autosave behavior** — when there's an unresolved external change *and* local unsaved edits: **pause autosave until resolved** (safest, recommended), or keep autosaving (Virgil silently wins, external edit lost) with only a warning?
3. **Pill unification depth** — ship an **adjacent badge** in the shared cluster now and fold the two pills together later (lower risk), or **compose CollabStatusPill + the badge into one "paper status" cluster** in this pass (deeper, more churn)?

---

## 13. Future extensions (designed-for, not built)

- **Cross-window dedupe** via `BroadcastChannel`: share write fingerprints across same-origin Virgil windows so a sibling window's save doesn't read as "external."
- **Diff / 3-way reconcile** UI (the watcher already holds both sides).
- **Whole-folder recursive watch** + per-file badges in a panel.
- **The Overleaf-tab bridge** (true presence): a userscript that writes a heartbeat into the shared sidecar — the *active* counterpart, rendered in the very same status cluster this badge introduces.
