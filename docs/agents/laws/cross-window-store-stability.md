<!-- last-verified: 3a8f4892 2026-09-15 -->
<!-- derives-from: AGENTS.md#laws -->

# Cross-window store stability

> **A store that caches a `localStorage` snapshot at module (or hook) scope MUST re-hydrate on the native `storage` event — through [src/lib/cross-window-storage.ts](../../../src/lib/cross-window-storage.ts) (`subscribeToStorageKey`), never a hand-rolled listener.**

Multi-window is first-class (`openNewVirgilWindow`, keyboard-bound and menu-wired), and the common store shape — hydrate ONCE behind a `loaded` latch, then serialize the WHOLE snapshot on every setter — is silently unsafe without this: window B never learns about A's write, so B's snapshot is permanently stale and B's next write **clobbers A's change from that stale base**. The loss is silent and the two windows disagree until one reloads. This is the "colors/prefs I set in the other window vanished" class (task 111 → task 177).

The listener is centralized because the contract has two guards that are easy to get subtly wrong, and each wrong copy is invisible until it isn't: **foreign keys** must be ignored, and **`key === null` is a `clear()`** that counts only when `storageArea === localStorage` (a peer's `sessionStorage.clear()` fires with a null key too). Pre-177 there were three hand-rolled copies and two were missing the null-key branch entirely. On the event, re-read through the store's OWN parse/validate path (factor it into a `readXFromStorage()` shared with the hydrate) so a peer's blob is filtered exactly like a local one — never a second, drifting copy of the validation rules.

CI: [src/lib/\_\_tests\_\_/cross-window-storage-guardrail.test.ts](../../../src/lib/__tests__/cross-window-storage-guardrail.test.ts) greps `src/` AND `library/` for raw `addEventListener("storage", …)` and asserts the flagged set equals the silo's allowlist — `PERMITTED_RAW_STORAGE_LISTENERS`, whose sole entry is the primitive itself (the library twin is deliberately empty). A store that re-implements the contract fails CI: migrate it, don't list it. Same discipline as the three laws above.

### The absence half: the guard must see a store that uses the door NOT AT ALL (task 599)

The listener grep above sees the door used *wrongly*. It is structurally blind to the failure the law is about — a store that caches a snapshot, writes it back, and subscribes to nothing — so four such stores (the whole global view-prefs blob among them) sat under a green guard. The same file now carries a **store-shape census**: every shipped `src/`/`library/` file whose code (comments stripped) both READS (`localStorage.getItem`) and WRITES (`localStorage.setItem` / `writeStorageIfChanged`) is a store until proven otherwise, and must call `subscribeToStorageKey(s)` / `useStorageKeySync` or sit in `STORE_LEDGER` under one of three **checked** arguments: `read-fresh` (no module-scope `let`, no React state/ref — every write is built from a same-call read), `write-once` (every write stores a string literal), `subscribed-by` (the named file imports this one and subscribes — the read-fresh-lib + caching-hook split). The ledger is exact both ways. Neutered against the pre-599 sources it flags exactly the four members.

**A bus is not the floor.** `useViewPrefs` keeps its `global-pref-changed` BroadcastChannel fan-out (it carries the changed key, which the ephemeral Reader's margin filter needs) but now ALSO subscribes to `GLOBAL_STORAGE_KEY`: `bus.ts` silently no-ops where BroadcastChannel is absent, and hiding the "New window" command there does not stop a user opening a second tab. The storage event needs no feature support. Where both fire, the second re-read is an idempotent merge; a peer sync never writes (only `update` arms `pendingPersist`), and both whole-blob writes go through `writeStorageIfChanged`.

Stated residual: the population is per-FILE — a store whose read goes through a generic helper in another file would be invisible (none exists today). Legs: [cross-window-store-sync-wave3.test.tsx](../../../src/lib/__tests__/cross-window-store-sync-wave3.test.tsx) (M1 by `storage` alone with the bus stubbed dead + anti-ping-pong + idempotent persist; M2; M4) and the "cross-window draft" leg of [BugReportWindow.test.tsx](../../../src/components/__tests__/BugReportWindow.test.tsx). A real two-tab eyeball is owed. (The task also said this file's CI line pointed at the wrong directory; checked — it already names `src/lib/__tests__/`, which is correct.)

Two companions in the same module serve the **hook-state** variant of the shape (state in `useState`, not a module global): `useStorageKeySync(keys, onPeerChange)` puts the listener in an effect, and `writeStorageIfChanged(key, value)` makes a write idempotent. The second is load-bearing wherever a store persists from a *state-watching effect* rather than from its setters: there the peer sync IS a write, so two windows ping-pong forever. Skipping the unchanged write kills the echo on its first bounce. Prefer persisting from the setters; use `writeStorageIfChanged` when the persist-effect shape is already load-bearing (`useLibraryTabs`, `view-session-store`).

Riding it: `panel-theme.ts`, `panel-typography.ts`, `outline-prefs-store.ts`, `useStack`, `useStyleLibrary`, and — since task 179, which drained the census — `usePreferences`, `useZenMode`, `pref-links`, `useWordCountConfig`, `useLibraryTabs`, `library/lib/view-session-store`, the `ActionsMenuPanel` palette; since task 599, `useViewPrefs`, `useHelperMode`, `BugReportWindow`'s draft and `useNotificationStream`'s seen-at mark. Ledgered (see "The absence half" below): the read-fresh helpers (`collab`, `row-viewed-store`, `list-columns`), the split stores whose caching half subscribes (`style-library` → `useStyleLibrary`, `library-store` → `useLibraryTabs`), and `InstallPwaPrompt` (a monotonic `"1"` flag). *Retired by 599:* the earlier claims that `useViewPrefs` was "cross-window-safe by other means" (its BroadcastChannel bus is a no-op where the API is absent) and that `useHelperMode` could stay unmigrated.

`view-session-store` is the one member the plain re-read doesn't fit: its write is debounced 250 ms, so a peer event routinely arrives while a local change is still only in memory. Adopting the peer blob would drop it; ignoring the peer keeps the clobbering base. So it does a **three-way merge** — base = `lastPersisted` (the snapshot last known to be ON DISK, advanced only on a write that actually landed), ours = the live session, theirs = the peer's blob; per node, whichever side changed it wins, recursing into objects, ours winning a genuine leaf conflict. The pending timer then flushes the merged blob so the peer converges too. **Diff against a base, don't track dirty paths**: a path list is only as fine-grained as the bookkeeping remembers to be, and nearly all of this store lives under one key (`scopes[""]`, the singleton scope), so a `scopes.<id>` granularity would swap that whole subtree and still drop a peer's edit to a different panel inside it. A peer blob that this code cannot parse (corrupt, or a future `schemaVersion`) is ignored rather than adopted — at init an unreadable blob resolves to an empty session, which is right; mid-session it would wipe the user's live view.

### The sidecar half: two writers means ONE serialized read-modify-merge authority

Same law, other medium (task 220) — and the one where the two writers were each internally correct and disagreed only about what the *other* had just done.

`localStorage` stores get the `storage` event; a `virgil/*.json` sidecar has no such thing, and it has a THIRD writer the section above doesn't contemplate: the `/editor/*` skills, which read-modify-write the file straight on disk while the paper is open. `ai-requests.json` had all three. Its two in-app writers had structurally incompatible persistence MODELS:

- **`useAiRequests`** persisted its **whole in-memory snapshot**, derived from React `prev` with no read-merge, and never published — so it overwrote anything written since its own last read, and nothing else learned that it had written;
- **`bridgeCardAiRequestFlag`** read-modify-wrote and did publish, but its `readSidecar` ran **outside** the serialized write critical section — only `writeSidecar`'s callback is funnelled through `enqueueWrite` + `withDocLock` — so a write landing between its read and its own write was merged away from a base that no longer existed.

Neither is a type error, neither throws, and no suite could see either, because every one of them exercised a single writer at a time.

> **A file with more than one writer has ONE authority, and every mutation is a pure function of the list as it is ON DISK, computed INSIDE the serialized write critical section, published on success.** Nothing persists a whole snapshot it computed earlier from state it merely hopes is current — and the reader re-hydrates from the disk-side external-change signal, because an in-process bus is not a cross-window one.

Three pieces, at three altitudes:

- **The primitive.** [`mutateSidecar(h, filename, default, mutate)`](../../../src/lib/storage-fsa.ts) — the read runs inside the same `enqueueDocWrite` task as the write, in BOTH backends. The read is deliberately `readSidecar` (a direct disk read) and never `readSidecarIfExists`: a cached bundle snapshot is exactly the stale base this exists to eliminate. `null` from the mutator means nothing to change — no write, no ledger stamp, and the call resolves `null`, so a caller can tell a declined mutation from a landed one. The same commit put dev's `writeSidecar` on the per-file queue: it PUT straight through, so two writers for one sidecar raced there in a way they never could under FSA, and the new door would have had nothing to serialize against.
- **The authority.** [src/lib/ai-requests-store.ts](../../../src/lib/ai-requests-store.ts) — `mutateAiRequests` / `readAiRequests`, the only place the filename is spelled. Every writer enters here and every landed write publishes. The filename constant is module-**private**, and that is load-bearing rather than tidy: this task's first cut exported it, and an importable name is a name a writer can address the file with — `mutateSidecar(handle, AI_REQUESTS_FILE, …)` spells no literal, calls neither censused function, and bypasses the authority (so it never publishes, which is the whole drop-D3 half of the original defect) while every leg of the census stays green. The census asks *who spells the filename*; the law is *who WRITES the file*, and those coincide only while the name cannot travel. The one reader outside the module needs the QUESTION, not the name, so it gets `isAiRequestsFile(filename)` — publish whole operations, never the pieces (task 273's rule, one medium over).
- **The reader.** `useAiRequests` subscribes to the `SidecarWatcher`'s `virgil-sidecar-changed` event for this file — the same channel `usePersistentState` rides, with the same dirty-guard shape (defer while a mutation is in flight, re-check after the await). This is what makes a PEER WINDOW's write converge rather than merely not-clobber: the disk ledger is per-window module state, so a peer's bytes are unledgered here and the watcher reads them as a genuine external change.

Two rules the fix earned, both about the mutator boundary:

- **The mutator is PURE, because it runs TWICE.** Once optimistically against React state (so the UI never waits on a disk round-trip) and once authoritatively against the on-disk list. So ids and timestamps are minted OUTSIDE it — the bridge builds its candidate row before the call — and a mutator that read the clock or minted an id would produce two different answers for one user gesture.
- **A stale edit DECLINES rather than resurrects.** `updateRequestText`/`deleteRequest`/`relinkRequests` return `null` when the row is no longer on disk, so an edit racing a peer's delete writes nothing instead of re-creating the row from the local snapshot. The pre-fix snapshot persist did exactly that.

**What the lock does NOT cover, stated.** The third writer is out of process: `withDocLock` is a Web Locks primitive, so it serializes this browser's windows and reaches the `/editor/*` python scripts not at all. Nothing here claims otherwise. What covers that writer is the other half of the design — every in-app mutation merges over the freshly-read on-disk list, so a skill's row is never computed away from a stale base, and the watcher re-hydrate converges the live inbox onto what the skill wrote. A guard that overstates its reach is the failure mode this whole section is about, so the census records the same limit rather than implying its two TypeScript roots are the whole story.

CI: [ai-requests-authority.test.ts](../../../src/lib/__tests__/ai-requests-authority.test.ts) **and** [mutate-sidecar-primitive.test.ts](../../../src/lib/__tests__/mutate-sidecar-primitive.test.ts). The second exists because of a gap the first cannot close by construction, and the gap is the exact shape this file keeps re-learning: every task-220 suite `vi.mock`s `@/lib/storage` and hand-writes a `mutateSidecar` that puts the read inside the queue, so what they prove is that the STORE and the two WRITERS are correct *given* a correct primitive — never that either shipped primitive **is** correct. The defining property of the whole fix had zero coverage: hoisting `const current = await readSidecar(…)` above the `enqueueDocWrite(` call in both backends reinstates the pre-220 bridge defect one layer down, and all 6180 tests stayed green (measured, not assumed — the three mocking suites pass through it, 41 green). The primitive suite drives the REAL exports against a fake disk in both backends, and asserts in two shapes: a CONTENT leg (two overlapping mutations both land) and an ORDERING leg (no read starts between another mutation's read and its write), because a content assertion can be satisfied by luck on a fast enough fake. Its post-write disk-ledger **stat** is deliberately excluded from the ordering invariant — it happens after the write and reads no content, so counting it would indict a correct implementation. Four legs fail on the reinstated hoist.

Two kinds of leg in the first suite, and both were needed. The CONCURRENCY legs run two writers over a deliberately slow, genuinely serialized backend, since a base read outside the critical section is invisible to any single-writer test; all four fail on the pre-220 writers, each with the lost-update content (`['card-B']` where both cards were toggled, `[]` where a peer's row should survive). The CENSUS is the leg with teeth — the authority was never the part that could misbehave, a call site that never asks it is — so no production file outside the store and the bundle vocabulary may spell the filename, neither in-app writer may name `readSidecar`/`writeSidecar` at all, and **nothing outside the authority may call `mutateSidecar` at all** (the filename grep cannot see a writer holding the name by another route, so the second leg closes the category the private constant closes the realistic route to). Its one exemption is `card-registry.tsx`'s dev-only error message, keyed by a fragment of the PROSE rather than by the file (task 204's rule: a file-scoped exemption would also excuse a real write added there later). The stripper self-check runs on a synthetic FIXTURE, not on that exemption: proving "literals survive the stripper" from the one production line the allowlist exists to DRAIN is circular — drain it and the proof evaporates while the leg keeps passing vacuously, since zero post-strip lines would contain the needle at all. A canary must not stand on the defect.

One harness detail worth carrying forward, because the suite's first draft got it wrong: these setters schedule their persist from inside a `setState` **updater**, which React invokes lazily at the next render — so `await act(async () => { setter(); await sleep(20) })` waits *before* the updater has run, and the write is still unscheduled when the assertion reads the disk. Every leg then "fails on the pre-fix code" for a timing reason rather than a content one, which is an unfalsifiable defect leg wearing a passing one's clothes. Call the setter in a SYNC `act` to force the flush, then drain the I/O in an async one.

#### The in-flight half: a dirty predicate that reads the TIMER is blind to the write it just armed

Same law, the sidecar hook's OWN guard (task 569, an audit finding) — and the
case where task 392's rule was written for `useDocument`, enforced there by a
census, and carried as an unexamined twin one hook over. `usePersistentState`
re-reads a sidecar off disk on the watcher's `virgil-sidecar-changed` event
ONLY when the instance is clean, and "clean" was `pendingTimerRef.current ===
null` — at both guard sites. But `persist`, `flushPending` and the debounce
callback all null that handle BEFORE `await writeSidecar`, so for the whole
in-flight window (the per-file queue, the cross-window doc lock, the FSA
`createWritable` + rename) the guard answered CLEAN. An external change to the
same file polled inside it passed both reads: disk (the external bytes) was
`setState`d over the local edit in memory, our write then landed the LOCAL
payload, and the next `update()` wrote memory back over the local edit.
Silent; reachability ≈ in-flight ms / 3 000 per external change while the
user edits that sidecar. **No pre-569 suite could see it**: the hook's own
suite pins the mid-debounce deferral with a 5 s timer that never fires, and
the watcher-wiring suite's fake write resolved synchronously, so its in-flight
window was zero microtasks wide.

> **ONE dirty predicate per coalescing writer — `hasPendingWrite()` = a write
> is ARMED ∨ a write is IN FLIGHT — read by every guard site, never the timer
> handle.** The in-flight half is a counter moved synchronously before the
> `await` (the same turn the caller nulled the handle, so there is no
> interleaving point) and released in `finally`, so a refusal or a throw lets
> go exactly as a landing does. The null-handle comparison lives in exactly
> two declarations — the predicate and the one timer-cancel door — and the
> census says so.

Three rules it earned:

- **A refused write is not an owed write.** A `persist` the layer below
  refuses (read-only chrome, no pipeline handle) returns before the counter
  moves, exactly as it returns before stamping `hasMutatedRef` — so in a
  read-mostly host disk stays the truth and an external change still
  re-hydrates. Stated at the site: memory there holds an edit disk will never
  see, and that is the host's design.
- **A deferral is LOCAL WINS, and the prose said otherwise for a year.** The
  guard's comment promised the watcher would "re-check once the write has
  flushed". It cannot: the watcher re-baselines its ledger to the external
  bytes BEFORE it emits and has no way to know a listener declined, and our
  landed whole-snapshot write re-baselines it again to OURS, so the next poll
  is a cheap mtime/size match. The external bytes are overwritten — the
  220/558 two-writers class every sidecar that is not `ai-requests.json` or
  the bib still carries, recorded for its own design pass (per-kind merge
  semantics). `useAiRequests` already knew this and REPLAYS a deferred re-read
  once its mutations drain; that is right there because it MERGES, and wrong
  here: a replay after a landed snapshot reads back our own bytes, and after a
  refused one adopts disk over unlanded memory — the stomp the guard exists to
  prevent, one turn later. Verified with a leg through the REAL watcher, as
  the filing asked, and the leg pins the opposite of what the filing assumed.
- **The fake write has to STAMP.** The wiring suite's `writeSidecar` now lands
  bytes with a fresh mtime AND re-baselines the disk ledger the way
  `writeTrackedText` does; a fake that skipped the stamp would re-emit on the
  next poll and pass the deferral legs for the wrong reason.

CI: [usePersistentState-inflight-dirty-guard.test.tsx](../../../src/hooks/__tests__/usePersistentState-inflight-dirty-guard.test.tsx)
holds the write open on a controlled promise and lands the event inside it —
the debounced path, the `debounceMs: 0` direct path, and the second guard
read (a write that STARTS while the re-read is in flight) — with the two
release controls (a settled write, a thrown write) and the decided
refused-write case. Its CENSUS pins the two owners of the null-handle
comparison by `enclosingDeclaration`, both listener asks, the counter around
the await, and the retired prose.
[sidecar-watcher-wiring.test.tsx](../../../src/components/editor-layout/contexts/__tests__/sidecar-watcher-wiring.test.tsx)
drives the REAL watcher over the fake disk for the mid-debounce and in-flight
deferrals (disk holds the LOCAL bytes afterwards, no later poll re-reads) and
a later external write still re-hydrating. Measured by neutering each half in
turn — see the task's progress log.

**Owed, not claimed:** a real external writer (a skill or a peer window) is
the FSA-masked class, so the durable proof is the unit contract.

#### The bib half: the one multi-writer file that never received its door

Same law, the file with the MOST writers (task 558) — and the case where the
rule above was stated, its door was built, every `virgil/*.json` file took it,
and `references.bib` kept the pre-220 shape for a year with the whole suite
green.

`writeBib` wrapped only the WRITE. Every in-app mutation was a read-modify-write
whose READ ran outside the lock: `addEntriesToProjectBib` did `readBib` → parse
→ append → `writeBib`; the Bibliography panel's five mutators persisted a whole
`serializeBibFile(next)` derived from React state seeded ONCE per doc and
refreshed only by an in-app `window` event that `project-bib.ts` alone
dispatched. The write queue serialized the two WRITES, so the loser's
whole-file snapshot landed last and won — task 220's lost update, one file
over. Three members: **M1** two in-app writers racing off different bases (a
Library drop while a bib card's Save is in flight) drop the earlier entry;
**M2** an `/editor/*` skill's entry (`find-citation`, `sync-bib-to-library`,
`answer-bib-review` write the file straight on disk) is destroyed by the user's
next in-app bib edit, and every `\cite{key}` naming it then compiles to an
undefined reference with no other local copy of an entry the skill fetched;
**M3** two Virgil windows on one paper, where window B's base never learns
about A's addition at all.

> **`mutateBib` is the `.bib`'s ONE write door in both backends — the bib twin
> of `mutateSidecar`, base read INSIDE the same queued, doc-locked critical
> section as the write — and the whole-snapshot `writeBib` is RETIRED, so a bib
> write that did not read its base under the lock is unrepresentable rather
> than merely discouraged.** [`project-bib.ts`](../../../src/lib/project-bib.ts) is the
> ONE authority above it: the door is TEXT-shaped (the backends are
> citation-js-free), so the parse/serialize pair and the post-write PUBLISH
> live there, and every writer — the Library drop and remove, and all five of
> `useCitations`'s mutators — enters `mutateProjectBib` with a PURE
> `BibEntry[] → BibEntry[] | null` mutator.

Six rules it earned:

- **The hook applies the mutator TWICE and keeps no snapshot.** Once to its
  view (so the UI never waits on disk) and once, through the authority, to the
  file as read under the lock — whose published result the hook's own listener
  adopts, so the view CONVERGES on what actually landed (a merge over entries a
  skill or a peer window added since the hook last read). `bibRaw` is set from
  the publish only; `serializeBibFile` is no longer imported by the hook, and
  that is the census's leg.
- **A uid is minted ONCE, outside the mutator.** The mutator runs twice, and a
  uid minted inside it would differ per run — the identity spine (annotations,
  the rename cascade) would briefly anchor to an id the file never held. Only a
  collision with a uid that is on disk but not yet in the view re-mints, inside,
  against the disk set, and the publish converges the view on that answer.
- **An edit of an entry a peer already removed DECLINES** (`null`), never
  resurrects it — the ai-requests rule. And `addEntriesToProjectBib` mints
  against the uids ON DISK, so a drop's fresh id cannot collide with one a peer
  landed since this window last read the file.
- **The in-lock base read is deliberately NON-stamping**, unlike
  `mutateSidecar`'s `readTrackedText`. The `.tex`/`.bib` ledger fingerprint is
  the external-change watcher's baseline and is KEPT stale across a genuine
  external change so the badge stays lit (task 415); stamping it on a mutation
  that then declines would silently absorb an edit the watcher had not yet
  surfaced. The write half stamps, which is the only stamp a landed write needs.
- **The out-of-process writer is covered for free**, by the same argument
  task 220 makes for the skills: no Web Lock reaches python, and none is
  claimed — but merging over the file as it is on disk means a skill's entry is
  never computed away from a stale base, because there is no base but the disk.
- **`bibFilenameFromTex` is spelled once in the dev backend** — the name
  resolver, the reader and the retired write door used to carry three
  byte-identical copies of the `\bibliography{}` match — and the dev door
  finally takes the per-file queue (`bib/<name>`, so `flushPrefix` drains it);
  the retired dev `writeBib` PUT straight through with no queue at all, the
  pre-220 sidecar shape one file over.

CI: [bib-mutate-door.test.ts](../../../src/lib/__tests__/bib-mutate-door.test.ts)
drives the REAL doors in BOTH backends over a journalled fake disk — the
`mutate-sidecar-primitive` shape, which is the MODEL and stays green beside
it: the CONTENT leg, the ORDERING leg (no base read starts while another
mutation's read→write pair is open — the forensic copy reads via
`arrayBuffer()` and is deliberately not a journalled read), the behind-the-back
write surviving the next mutation, the declined `null` with no write and no
history slot, and the non-stamping base read pinned against an external edit.
[bib-authority.test.tsx](../../../src/lib/__tests__/bib-authority.test.tsx) drives the
REAL hook and the REAL `project-bib` writers over a slow serialized door:
M1 (a drop racing a Save; two hook mutations in one tick), M2 (a skill's entry
survives the hook's next edit AND the view converges on it), the no-resurrect
rule, the once-minted uid, and the CENSUS — `writeBib` retired in both silos,
`mutateBib` spelled only by its definitions, the barrel and the authority,
`serializeBibFile(` called by no production file but the two parsers and the
authority, the event dispatched by the authority alone, and the hook's four
routed mutators as an EXACT count. **No pre-558 suite could see any of this**:
every one of them exercised a single writer at a time and asserted the hook's
in-memory state, where a stale snapshot is indistinguishable from a merge.
Measured by neutering each half in turn: hoisting the base read outside the
lock takes 2 legs per backend, the hook mutating over its stale view 5, and an
authority that publishes nothing 3. The four legs that drove `writeBib`
(`per-file-write-gate`, `reader-writability` ×2, `stat-files-fsa`) are
RENEGOTIATED in place with the reason at the site.

**Residual, stated.** M3's DURABILITY half is closed (window B's next mutation
merges over A's addition, because it reads the disk); its VISIBILITY half is
not — the publish is `window.dispatchEvent`, so B's panel learns of A's entry
only through the DiskWatcher badge and a reload, exactly as it does for a
`.tex` edit. A bib-only external change could re-hydrate the panel silently
(nothing in the bib state is unsaved work), but that renegotiates what the
external-change badge means for the `.tex`/`.bib` pair and is a product call.

**Owed, not claimed:** a real-FSA eyeball, since the skill half is the
FSA-masked class — run `/editor/find-citation` against an open paper, then
edit a bib card, then read `references.bib` and see both entries.

#### The daemon half: against a writer you cannot serialize with, write LESS and NOTICE the fork

Same file, one writer further out (task 363) — and the case where the authority
above was correct, the lock was correct, and the third writer it names as out of
reach turned out not to be the only one.

`withDocLock` serializes this browser's windows; the merge covers the
out-of-process `/editor/*` skills. A paper folder inside Dropbox / iCloud /
OneDrive / Google Drive / Syncthing has a FOURTH writer, and it is the one
nothing in the model contemplates: a sync daemon that cannot be locked against,
cannot be detected, and does not merge. When it lands a remote version of a file
whose local copy has moved on it renames one side aside as a "conflicted copy"
and says nothing to the application.

Measured in Gabriel's `Dropbox/Apps/Overleaf/Coherence Intro/virgil/`
(2026-08-18): **197 conflicted copies plus 19 leftover `.crswap` files**, and the
distribution is the finding. 134 of the 197 are on the three files that **no list
in the codebase named** — `editor-state.json` 102, `virgil.json` 27,
`collab.json` 5 — against `notes` 36, `revisions` 20, `citations` 4, `archive` 2,
`todos` 1. `ALL_SIDECAR_FILENAMES` meant "the files a doc MOUNT reads", not "the
files Virgil WRITES", and the three loudest writers were in neither list. The
loudest of all is a file whose entire contents are a scroll offset, a caret
paragraph uuid and a list of folded uuids: `useEditorUIState`'s two 400 ms
numbers debounced the TRIGGERS (a scroll settle, a caret settle) and coalesced
the WRITE not at all, so each scroll pause, each caret move into a new paragraph
and every fold toggle was a full-file rewrite — a hundred-odd per reading
session, each one a `createWritable()` swap file plus a rename, watched by a
daemon.

> **Against a writer you cannot serialize with there are exactly two moves:
> shrink the race window, and notice the fork.** Both are derived from what the
> file is WORTH, declared once. A **VIEW**-state sidecar coalesces hard, because
> losing the last few seconds of it costs nothing. A **CONTENT** sidecar keeps
> its prompt cadence, because losing it costs the user's writing — and a
> conflicted sibling of a content file is unmerged user data, which is the half
> that must never be silent.

[src/lib/sidecar-value.ts](../../../src/lib/sidecar-value.ts) is the declaration —
`tier` plus `mount`, total over what Virgil writes into `virgil/`, an import-free
leaf (the placement rule `latex-markers.ts` and `node-attr-sets.ts` earned: a
facet the layer that needs it cannot import will be re-copied). Seven rules it
earned:

- **Every column has a reader, and one of them retired a second list.** `tier` is
  read by `sidecarWriteDebounceMs` (the cadence) and by the conflict report (a
  fork of a content file is unmerged writing; a fork of a view file is debris);
  `mount` DERIVES `ALL_SIDECAR_FILENAMES`, so "which files does a mount read"
  can no longer drift from "which files does Virgil write". They were two
  hand-kept arrays, and the drift was not hypothetical — it is the whole reason
  the three storm files were invisible.
- **The default FAILS CLOSED to content.** An undeclared file gets the prompt
  cadence and the loud report, never the lossy ones. A wrongly-content file costs
  some extra writes; a wrongly-view file costs the user's writing, and that
  asymmetry is the entire justification for the direction.
- **Coalescing is only honest if it settles at the boundary that matters.** Every
  coalescing writer flushes on doc switch, unmount, AND the tab going hidden
  ([tab-hidden.ts](../../../src/lib/tab-hidden.ts) — ONE shared `visibilitychange`
  listener, because ~20 `usePersistentState` instances per doc × up to four kept
  alive would otherwise install ~80 identical listeners). Hidden, not `pagehide`:
  that is the last edge at which an async FSA write still reliably completes, so
  a writer that waited for `pagehide` would be trading a coalesced write for a
  lost one.
- **The 300 ms content cadence is byte-unchanged**, and a suite asserts it per
  file. A fix for a write STORM that quietly slowed the user's writing to disk
  would be a worse bug than the one it closed.
- **Virgil does not merge or delete a fork.** The two sides are whole-file
  snapshots taken at unknown times; picking a winner is precisely the destructive
  act the sync service itself declined to make. So the app REPORTS — which files
  forked, and which of them hold writing — and the surface is a WARNING about the
  folder, never an alarm about the document (the file Virgil owns is intact and
  its own writes are correct, so nothing here may gate a write).
- **…and the notice is dismissible, which is a consequence rather than a
  softening.** The reporting folder holds four months of accumulated forks that
  can only be cleaned in Finder, so a non-dismissible banner would be permanent,
  and a permanent banner is how a real signal becomes furniture.
- **The detection grammar can be generous because the base vocabulary is
  CLOSED.** `notes 2.json` can only be a fork of `notes.json`, because nothing in
  Virgil is called `notes 2`; an exact match against a declared filename
  short-circuits first, so no decoration grammar can reinterpret a real sidecar
  (`bib-settings.json` as `bib` + a suffix). OneDrive is the one service
  deliberately left OUT: its `-<hostname>` decoration is unconstrained and
  indistinguishable from a file the user parked there, and naming a user's own
  file as their lost writing is a worse error than missing a fork. Stated rather
  than implied — this scanner is not complete over every sync service.

**A detection half is worth what it is WIRED to, and the first wiring was
almost nothing.** The scan was hung off `activateDoc`, which reads like the
doc-open door and is not: the paths that actually open an already-indexed paper —
`openFile` (the Recents list), `createFile`, and the session-restore effect that
reopens last session's tabs — all set `currentDocId` directly and never reach it.
So the whole surface fired for a first-ever open through the folder PICKER and
never again, which is the silence it exists to end. It is keyed on `currentDocId`
now, the one chokepoint every path funnels through; re-scanning on a warm tab
switch is a feature rather than a cost, because a daemon mints forks while the
app is open. Which in turn is why **the dismissal is keyed on the report's
SIGNATURE, not on the docId** — what the user dismissed is a folder STATE ("I
have seen these forks"), and Virgil is a PWA that stays open for days, so a
doc-keyed dismissal would silence a fork of `notes.json` minted at 4pm because
the 9am report was acknowledged.

**The skill-bundle sync had the same wiring defect, and the lesson is now a
rule (task 602): work that happens BECAUSE a paper became current is keyed on
`currentDocId`, never on an open door.** `useFiles`' post-claim sequence is ONE
helper, `admitDoc` (drain outgoing → register → tab + current → recents), used by
`openFile`, `activateDoc` and `createFile`; the skill sync and the sync-conflict
watcher are effects on `currentDocId`, so the session-restore effect — which sets
the current doc without passing through any door — gets them too. The auto-sync
never prompts: an ungranted folder is skipped UNMARKED and the permission gate's
`noteDocAccessGranted` re-runs it (the one way the current doc becomes writable
without `currentDocId` changing). The mirror event, "an open doc leaves this
window", is ONE helper too, `retireOpenDoc` (close, forget, peer handoff): the
active doc's successor is its neighbour, never `null` while tabs remain. Pinned
by [useFiles-skill-sync-door.test.tsx](../../../src/hooks/__tests__/useFiles-skill-sync-door.test.tsx).

**The DiskWatcher/ledger interaction was already right and had never been named.**
A daemon produces two shapes and the ledger has to tell them apart: a RE-WRITE of
bytes Virgil itself just wrote (same content, new mtime/inode — the ping-pong
seed) and a genuine LAND of a differing remote version. The existing mtime/size
drift → confirm-by-content-hash algorithm answers both correctly; what was
missing was a leg saying so, which is
[sync-race-back.test.ts](../../../src/lib/__tests__/sync-race-back.test.ts). The other
half of "no ping-pong" is that the app's reaction to an emit is a READ —
`usePersistentState`'s handler calls `setState`, never `persist`, and defers
entirely while a local write is pending.

**What the forks actually cost — and the first answer was an OVER-CLAIM.**
[tools/triage-sync-conflicts.mjs](../../../tools/triage-sync-conflicts.mjs) reports
per-file whether a fork holds anything the live sidecar does not. Its first
version decided that by asking whether the fork carried a record ID the live file
lacked, reading records out of a hand list of seven container keys, and it
reported **189 of 204 forks carry nothing**. Both halves of that test fail OPEN
in the destructive direction, and the adversarial pass on this task found both:
eight of the twenty declared sidecars use a key that list does not know (or are
not arrays at all — `annotations.json` is a bare citekey→prose map), so their
forks were never inspected and `--prune` deleted them while the report said they
carried nothing; and an ID-membership test cannot see the COMMONEST conflict
shape there is — the same record edited on two machines, same id, different body.

> **An "inert" verdict is POSITIVE evidence, and a shape the tool does not
> understand is not evidence.** A fork is prunable only where a run PROVED it
> carries nothing: its parsed JSON is structurally equal to the live file, or its
> base is a VIEW-tier sidecar (recomputable by the app's own declaration), or it
> is the browser's `.crswap` debris. Everything else is reported and KEPT. The
> id-diff survives as a labelled hint, deciding nothing.

Re-measured under that rule, the honest number on the reporting folder is **127
proved inert and 96 that DIFFER** — 42 `notes`, 27 `virgil`, 20 `revisions`, 4
`citations`, 2 `archive`, 1 `todos`, most of them "same records, different
content". The divergence is much wider than the first pass claimed, which is
exactly why the tool now keeps them.

Two more rules the same pass earned, both about a copy that could not import its
SSOT: the tool READS the sidecar vocabulary out of `sidecar-value.ts` rather than
treating any lowercase `.json` in the folder as a declared base — the loose
decoration grammars are safe only because the base set is CLOSED, and applying
them to an open set on the side that DELETES inverts the whole argument — and CI
pins both the extraction and the fact that the tool's regexes are a subset of the
module's, since a `.mjs` script has no build step and must restate them.

CI: [sidecar-value-ssot.test.ts](../../../src/lib/__tests__/sidecar-value-ssot.test.ts)
(totality over what production spells, the derivation, the byte-unchanged content
cadence, and the CENSUS — no sidecar writer may spell its own debounce literal,
which is exactly how a 400 ms *settle* came to mean a 400 ms *disk write*). That
census's own first draft is the cautionary half: it named two files by hand and
matched only the DEFAULT form (`debounceMs = 300`), so it was blind to the
CALL-SITE form (`debounceMs: 150`) that `useFocusMode` was live-passing for a
declared VIEW file — a leg that cannot see the one violation in the tree it ships
with is a habit, not a guard. Membership is DISCOVERED now (every file that calls
`usePersistentState`/`writeSidecar`, generics included — the needle that missed
`usePersistentState<StoredBand>(` dropped the offending file straight out of the
population), scoped to WRITERS rather than to every `debounceMs` in the tree
(`useLatexLint` and `useLatexSource` share the word and answer a different
question), and the allowlist is EMPTY.
**And its TOTALITY leg was VACUOUS from the day it shipped (task 560).** Its
needle is a quoted filename (`"notes.json"`) and it read `codeOnly`, which
BLANKS every string literal — so `seen` was EMPTY on every tree, "undeclared"
was `[]` by construction, and the census had certified "total over every file
Virgil writes" without ever examining a name. The exemption list beside it
excused `library-overlay.json` as "a Library-silo file, outside any paper's
`virgil/`" — false against the code (`useLibraryOverlay` wrote it through the
ordinary `writeSidecar` door into the paper's `virgil/`) and irrelevant, since
nothing was checked. The trap is the one `_source-scan`'s own header states and
tasks 389/552 each walked into: *a census whose needle IS a quoted class wants
`commentsStripped`; one whose needle is a symbol wants `codeOnly`.* Both live in
this ONE file — the debounce census's symbol needle keeps `codeOnly`, the
filename census reads `commentsStripped` (measured: 25 names, 21 declared, 4
exempted), and a CAN-SEE canary requires the scan to find `notes.json` and
`manifest.json` so the leg can never go vacuous again. The exemption list gains
the leg every allowlist in this file owes — an entry excusing a name production
no longer spells is STALE and fails — plus a disjointness pin against
`SIDECAR_VALUE`. The consumer-less hook and its orphaned `LibraryOverlay` type
are DELETED (WIRE-it-or-DELETE-it), so the false exemption goes with them for
the right reason. Measured by neutering: `codeOnly` back takes 2 legs, the
restored exemption 1.
[sync-conflict.test.ts](../../../src/lib/__tests__/sync-conflict.test.ts) (the grammars,
over REAL fork names copied out of the reporting folder — a hand-invented fixture
would only prove the regex matches its author's idea of Dropbox), the race-back
suite above, and
[editor-state-write-cadence.test.ts](../../../src/hooks/__tests__/editor-state-write-cadence.test.ts),
whose shape is the point: **no pre-363 suite could see this**, because every one
of them asserts a SINGLE write's payload, which the pre-fix code satisfied
perfectly. The defect is a RATE, so the leg is a COUNT over a simulated reading
session — twelve scroll settles cost ONE write. Measured by neutering the
coalescer: all five cadence legs fail on the pre-fix immediate write.

**Owed, not claimed:** a real-Dropbox eyeball. This class masks everywhere but a
genuinely synced folder — the dev preview's `virgil-data/` is local and nothing
watches it — so the durable proof here is the unit contracts plus the triage
tool's measured run against the reporting folder.

#### The address half: per-MACHINE state does not live in the synced folder

Same folder, the lever the two halves above could not reach (task 417). 363
shrank the write RATE by cadence and 415 by byte-equality, and both left the
premise standing: `editor-state.json` — where THIS window is scrolled to, which
paragraph THIS caret was in, which sections THIS user folded — lived in a folder
whose whole job is to be identical on every machine. Two machines legitimately
DISAGREE about that file, so every sync of it is a conflict the daemon has to
mint, and no cadence reaches zero. It was the loudest fork base in the measured
folder (102 of 197) and holds nothing a second machine wants.

> **A sidecar declares WHERE it lives — `store: "disk" | "local"` on
> `sidecar-value.ts` — and the four sidecar doors in BOTH storage backends
> (`readSidecar` / `readSidecarIfExists` / `writeSidecar` / `mutateSidecar`)
> route on that declaration.** A `"local"` file lives in this browser's
> IndexedDB ([local-sidecar.ts](../../../src/lib/local-sidecar.ts), the same `virgil`/`kv`
> store the emergency mirror uses) and never reaches the paper folder: no swap
> file, no ledger stamp, nothing for a daemon to see. The hook that owns it does
> not know where its bytes went — which is the point, since no writer anywhere
> can then put a local-store file on disk.

Five rules it earned:

- **The VIEW tier is necessary but not sufficient.** `focus.json` is view state
  Gabriel wants waiting on the other machine (a focus band is an authoring
  choice), and `collab.json` is collaborator mode's cross-machine TRANSPORT — a
  partner's tab polls it THROUGH the synced folder, and it is written only while
  collab is enabled. Both stay `"disk"`, stated at the row. The task's resolved
  decision named `collab.json` for local storage; moving it would silently
  delete the feature it carries, so that half is routed back as a question
  rather than shipped.
- **The migration is ONE-TIME and read-only on the folder.** A local miss asks
  the backend's direct disk reader once, copies what it finds in, and the next
  read is local. The disk original is NOT deleted — a delete is itself sync
  traffic (415's rule), the badge's cleanup already drains a view-tier fork, the
  stale file is inert (nothing reads it after the first open, nothing writes it
  again), and it is the seed a second machine migrates from.
- **The name stays in the table**, so the conflict scanner still recognises the
  `editor-state (conflicted copy …).json` debris a folder already holds and the
  cleanup plan still sanctions it. A relocation must not orphan the mess its
  predecessor left.
- **The forensic `.history/` slot and the conflict net stop copying it.** A
  per-machine scroll offset is not evidence of anything, and post-417 it is not
  on disk to copy — the conflict-net leg that pinned the copy is renegotiated in
  place with the reason at the site.
- **`readDocBundle` stops reading it.** Both backends read `editor-state.json`
  into a `bundle.editorState` that NO caller consumed — a disk read per open,
  feeding a dead field (the task-202 shape). Deleted along with the unused
  `DocumentPayload` type.

CI: [local-sidecar-store.test.ts](../../../src/lib/__tests__/local-sidecar-store.test.ts)
drives the REAL FSA doors over a fake disk with a write journal — the complement
every pre-417 sidecar suite lacks, since each of them asserts what a write PUT on
disk and a routing that silently kept the file on disk would pass all of them —
plus the migration, the scanner, and the CENSUS: both backends must route all
four doors, neither may spell a local-store filename in code, and the owning
hook may not reach IndexedDB itself. Measured by neutering each half in turn:
reverting the declaration takes 5 legs, dropping one backend's write route 3.

**Decisions 1 and 3 of the task did NOT land, and the reason is checked rather
than assumed.** Dropbox has no `.dropboxignore`: per its current help pages the
ONLY ignore mechanism is a per-file extended attribute (`com.dropbox.ignored`),
which a browser under the File System Access API cannot set, and the only
name-based rule it honours is the `~$` / `.~` temp-file prefix. So an ignore
file Virgil could write does not exist, and excluding `.history/` from sync has
no mechanism either — the one candidate (renaming it `.~history/`) is an
unverified reading of a rule documented for files. Both are routed back.

**Residual, stated.** With the doc open on two machines at once some conflicts
are inherent; write-rate reduction shrinks the window and never reaches zero.
This half removes one file from the race entirely rather than shrinking it.

**Owed, not claimed:** a real-Dropbox eyeball. FSA-masked AND sync-masked, so
the durable proof is the unit contract; the cheap real check is that no new
`editor-state (conflicted copy …)` appears in the reporting folder after this
ships, ever.

#### The cleanup half: what may be deleted is what a DECLARATION already proves

Same folder, the affordance the daemon half deliberately withheld (task 411).
363 shipped detection and stopped at a stated boundary — *Virgil does not merge
or delete a fork; it REPORTS* — which was the right answer to the question it
could answer, and left a folder that keeps filling with nothing the user can do
about it from inside the app. Measured after 363 shipped: the fork rate fell
roughly 10x (92 forks on the pre-fix day against 10 and 6 after) and the
population kept growing.

> **A delete is offered only where a DECLARATION already proves the bytes carry
> nothing — never where a computation says so.** Two shapes qualify: a fork of a
> **VIEW-tier** sidecar (`sidecar-value.ts` declares it recomputable) and a
> **`.crswap`** leftover (`sync-conflict.ts` declares it browser debris).
> Everything else is REPORTED and KEPT, a content fork above all — *an inert
> verdict is POSITIVE evidence, and a shape the tool does not understand is not
> evidence*, which is the rule 363's own adversarial pass earned and which this
> half inherits rather than re-derives.

[sync-conflict-cleanup.ts](../../../src/lib/sync-conflict-cleanup.ts) is the plan;
`deleteSidecarSiblings` in both backends is the door. Six rules it earned:

- **The DOOR decides, not the caller.** It re-lists `virgil/` INSIDE the write
  critical section and re-derives the sanctioned set through
  `planSidecarCleanup`; the caller's `names` are a FILTER (so nothing is deleted
  that the user was not shown) and never an instruction (so no call site can
  name a content fork into the set). That is the half no type can see —
  `deleteSidecarSiblings(h, notice.groups.flatMap(…))` compiles, runs, and
  deletes the user's unmerged writing.
- **The in-app rule is DECLARATIONS-only, and the offline tool's is not — on
  purpose.** `tools/triage-sync-conflicts.mjs` also prunes a CONTENT fork whose
  parsed JSON matches the live file, and it is entitled to: it runs with the app
  closed, on an operator's decision. In-app the same `deepEqual` would be a
  verdict the user cannot see, and a second copy of the inert test is the third
  speller this file keeps having to retire. CI pins the containment in the one
  direction that matters — anything the app deletes, the tool would too.
- **The net is the PROOF.** No `virgil/.history/` archive, deliberately: a slot
  is itself sync traffic in the folder whose whole problem is sync traffic (task
  415's rule), and archiving bytes that provably carry nothing keeps the file
  count while claiming to reduce it. What the user gets is the check they can
  make — the confirm NAMES every file, and names how many it is leaving alone.
- **Two counts, deliberately different numbers.** The PILL says how many forks
  the folder holds (the report); the cleanup row says how many are proved inert
  (the offer). Conflating them would make one of the two lie, and only a RENDER
  leg can see which number reached the user.
- **It takes the DOC LOCK, and that is about `.crswap` rather than about the
  forks.** A fork is a name Virgil never writes, so it races nothing — but a
  `.crswap` is Chrome's own in-flight write buffer for a file Virgil DOES write,
  and deleting one mid-write breaks that write. `enqueueDocWrite` wraps the task
  in the doc-wide, cross-window `withDocLock`, so a `.crswap` still present while
  we hold it is by construction not one of ours in flight. That is also why the
  fresh listing must be read inside the lock rather than handed in.
- **THE REPORT IS THE PERMISSION.** The receipt has three buckets
  (`deleted` / `refused` / `failed`) and a requested name already gone is in
  none of them — nothing deleted, nothing kept. The affordance reads it rather
  than inferring success from the absence of a throw (tasks 357/364/392), and
  the runner re-scans afterwards so the notice converges by itself.

**Two decisions recorded at their sites rather than re-litigated.** There is
still **no in-app compare** for a divergent fork: a real one needs a reader for
arbitrary sidecar shapes AND an adopt path through each panel's own hook — a
feature with its own design pass, not a badge affordance (`--extract` remains the
answer). And **`virgil.json` is not decoupled from the bundle write** to quiet it
down: that would break the "one bundle, one write" coherence the load-writeback
rests on, which is load-bearing for the whole content-loss cluster. Its entry in
the SSOT also gains the correction the post-415 measurement forced — it holds a
per-block 80-character content FINGERPRINT alongside titles and collapsed state,
so a fork of it is not automatically inert, which is exactly why it is `content`.

CI: [sync-conflict-cleanup.test.ts](../../../src/lib/__tests__/sync-conflict-cleanup.test.ts)
sweeps the PLAN over the REAL `SIDECAR_VALUE` (so a sidecar declared later is
covered by declaration alone, with counters proving the sweep crossed BOTH
tiers), drives the REAL door in BOTH backends against a fake disk, and carries
the CENSUS — the plan was never the part that could misbehave, a call site that
decides for itself is, so every backend door must spell `planSidecarCleanup` over
its OWN fresh listing, nothing outside the one runner may call the door, and the
badge may name no file itself. The count legs live in
[sync-conflict-badge.test.tsx](../../../src/components/__tests__/sync-conflict-badge.test.tsx),
because which NUMBER reached the user is a render fact. Measured by neutering
each half in turn: a door that trusts its argument takes 2 legs per backend, the
tier gate 7, and a second door-caller the census.

**Owed, not claimed:** a real-Dropbox eyeball of the affordance end to end. This
class is both FSA-masked and SYNC-masked, so the durable proof is the unit
contracts; the cheap real check is to run the badge's cleanup on the reporting
folder and then `tools/triage-sync-conflicts.mjs` over it — the tool's
"PROVED to carry nothing" count should have dropped by exactly what the badge
said it deleted, and its "DIFFER and are kept" count should not have moved at
all.

#### The return half: a notice derived from disk state re-reads it when the user COMES BACK

Same pill, the trigger it never had (task 542, Gabriel's own report with a
screenshot: "6 conflicted copies · 6 with content" over a folder he had already
cleaned in Finder). The scan had exactly ONE trigger — `useFiles`'s effect on
`currentDocId` — and its own comment called a warm tab switch "a feature". True,
and no help with one paper open: the pill's own copy sends the user to Finder
for a content fork, Finder is by construction used while this tab is not in
front, and nothing ever re-enumerated the folder afterwards, so the notice
reported ghosts until a reload.

> **A standing notice derived from disk state the app does not own re-reads
> that state on the edge that observes out-of-band change: the user RETURNING
> to the tab.** The edge is published ONCE — `onTabReturn` in
> [tab-hidden.ts](../../../src/lib/tab-hidden.ts), the mirror of task 363's settle edge
> in the same module, one `visibilitychange` + one window `focus` listener for
> every subscriber of either edge — and the scan takes it through ONE door,
> `watchSyncConflicts(docId)` (open + return, standing down with the doc).

Four rules it earned:

- **Both events, coalesced.** `visibilitychange → visible` covers a tab switch
  and an un-minimize; window `focus` covers the ordinary macOS case, where a
  partly covered PWA window stays `visible` the whole time the user is in
  Finder beside it. A real tab switch fires both back to back, so a return is
  ONE delivery per `RETURN_COALESCE_MS` — a subscriber pays one listing per
  genuine return, never one per event.
- **Edges, never a poll.** The write-traffic doctrine (363/415) wants fewer
  folder touches; a listing is read-only, but a timer would touch the folder
  every few seconds for a fact that changes only while the user is elsewhere —
  which is exactly what the return edge observes. Three triggers, all edges:
  open, return, post-cleanup. Plus the badge's manual "Check the folder again"
  row, the zero-latency door for a user who is already back.
- **Dismissal semantics untouched by construction.** The notice is
  signature-keyed, so a re-scan of an unchanged folder cannot re-raise a
  dismissed report, while a folder that changed under the dismissal (one fork
  gone, one still there) is judged on its new signature — pinned in both
  directions rather than assumed.
- **The hook returns the watcher's unsubscribe**, so the doc-switch/unmount
  edge tears the return subscription down with the doc; a fire-and-forget
  `void watch…` leaks one subscriber per document ever opened.

**Residual, stated.** Ten production sites still hand-roll their own
`window.addEventListener("focus", …)` refresh — the DiskWatcher, the
SidecarWatcher, and eight Library hooks/stores — each correct, each a private
copy of the edge this module now publishes. They were not migrated here: the
two watchers pair focus with a per-instance poll lifecycle, and the Library
sites are a different silo. They are the same class one step out and the
natural next sweep.

CI: [tab-return.test.ts](../../../src/lib/__tests__/tab-return.test.ts) (the edge
contract: both carriers, coalescing, silent subscribe, one listener per event,
isolation) and
[sync-conflict-rescan.test.ts](../../../src/lib/__tests__/sync-conflict-rescan.test.ts)
(the DEFECT leg — forks reported, files removed on the fake disk, the user
returns, the notice clears — both carriers, both dismissal directions,
stand-down, and the CENSUS: the hook enters the watcher and returns its
unsubscribe, the bare scan's production callers are an exact set, the watcher
takes the shared edge and installs no listener of its own). The badge's manual
row is pinned in `sync-conflict-badge.test.tsx`. Measured by neutering the
return subscription in `watchSyncConflicts`: 6 legs fail (5 behavioural, plus the census that asks for the shared edge). **No pre-542 suite
could see this**: every scan leg calls `scanSyncConflicts` by hand, so a
trigger that never fires is unrepresentable in all of them.

**Owed, not claimed:** the preview eyeball. Reproducible in dev storage — seed
`notes (conflicted copy 2026-09-02).json` into
`virgil-data/doc_devtest/virgil/`, open the doc, delete the file, click away
and back — and a real-Dropbox eyeball for the sync-masked half.
