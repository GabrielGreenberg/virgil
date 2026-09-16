<!-- last-verified: 3a8f4892 2026-09-15 -->
<!-- derives-from: AGENTS.md#laws -->

# The write path: no automatic write may lose content

> **A write the user did not ask for is measured before it lands.** Virgil's
> `.tex` is the user's only copy, and every automatic path to it — the
> load-writeback, the 1500 ms autosave, an anchor-mint flush, a code-pane
> re-parse, the editor's own mount — can persist a model that represents the
> file less completely than the file does. Each of those doors MEASURES what it
> is about to commit against what the document was READ with, and a shortfall is
> a REFUSAL published to one channel that reaches the user and gates the door.

This is the content-loss cluster (task 350 defect D, then 357), and the reason it
needs a section rather than a fix is that every member is **silent and a fixed
point**: the output is well-formed LaTeX, the save succeeds, the reload looks
consistent, and the document is simply shorter than the one the user wrote.
Nothing throws. The parser-side laws above ("what a system does not model, it
CARRIES", and its five siblings) keep a round trip honest; this section is what
happens when one of them is nonetheless wrong.

**Five gates, one channel.** Each asks a different question, in the order a byte
travels:

- **LOAD** ([tex-preservation.ts](../../../src/lib/tex-preservation.ts), `checkTexPreservation`)
  — the load-writeback re-stamps the `.tex` seconds after open. Refuses when the
  re-serialization holds materially fewer content words than the bytes just read:
  a parse that could not represent this file must not overwrite it.
- **MOUNT** ([mount-preservation.ts](../../../src/lib/mount-preservation.ts) over
  [schema-mount.ts](../../../src/lib/tiptap/schema-mount.ts)) — *a model that a gate has
  measured is not yet a document.* `enableContentCheck` is off, so
  `createNodeFromContent` swallows a `nodeFromJSON` throw and returns an **empty
  document**: a model naming one node type this build's schema has not got opens
  the paper BLANK, word-complete on the way past, and the write gate steps aside
  on the user's first keystroke into that blank. Both main-document doors ask,
  and they ask differently on purpose — the load door measures what the editor
  KEPT (that catch has exactly one product, so it is O(1) on the happy path), the
  code-pane door asks BEFORE it commits so nothing lossy ever enters.
- **CODE PANE** ([code-pane-bridge.ts](../../../src/lib/code-pane-bridge.ts)) — 600 ms
  after a code-view keystroke the text is re-parsed into the live document, and
  mid-typing is exactly when unterminated constructs EXIST. Round-trips the parse
  against the delimiters it just extracted and refuses BEFORE `setContent`,
  keeping the last-good model. Surfaces on the pane's own inline error rather
  than the document banner: the model never entered, so the hazard is averted
  rather than pending — and the refusal is a state the user types their way OUT
  of.
- **SERIALIZE** ([`UnserializableNodeError`](../../../src/lib/latex-serializer.ts),
  published by [serialize-refusal.ts](../../../src/lib/serialize-refusal.ts)) — the
  serializer itself. See "The dispatcher half" below.
- **WRITE** ([write-preservation.ts](../../../src/lib/write-preservation.ts)) — 350-D
  exempted the autosave on the sound ground that once the user has edited, the
  model IS their document. That rationale does not cover `writeDocBundle`'s OTHER
  caller: `flushNow` writes the whole bundle on an anchor-UUID MINT, so ONE card
  gesture (grab-handle click, omni open, card drag) on a uuid-less paragraph
  persists immediately with **no typing at all** — and replaces `virgil.json`
  wholesale, carrying sidecar damage no `.tex` gate can see. So a write is
  measured against the bytes the doc was LOADED with until a real user edit lands.

Ten rules the cluster earned:

- **A "real user edit" is an UNDOABLE transaction, not a `docChanged` one.** An
  anchor mint IS doc-changing, so keying the step-aside on that re-opens the very
  hole it closes. The test is `addToHistory !== false` — a POSITIVE test, so a new
  system write cannot count as a user edit by merely not being on a denylist; it
  must opt in by being undoable. Stated limit at the door: that is a convention,
  not an enforced invariant.
- **The baseline is RETAINED at read, never re-read at write.** By write time the
  file may already carry the load-writeback's own re-stamp, so a re-read would
  compare the model against Virgil's own output and measure nothing.
- **The measure asks WHICH words, not how many.** A net count is defeated by
  simultaneous growth: a pass that dropped `\author{Jane Q. Doe}` while adding
  four words elsewhere scored a loss of ZERO. `Σ max(0, before(t) − after(t))` is
  `≥` the net for every input (a strict strengthening — nothing the old rule
  refused is now allowed) and is ORDER-INVARIANT, which is why it is a multiset
  and **not** a contiguous-run check: the serializer legitimately MOVES word runs
  (`\title` hoisted past the package block; a figure's attrs re-emitted in the
  serializer's own order), and a run check false-refuses on every one of those.
  Measured before adopting — over every `.tex` corpus in the repo, two save cycles
  each, the shortfall is 0 in both regions.
- **The regions are measured separately** (body / preamble), because a preamble
  rewrite and a body loss mask each other in one total.
- **A refusal is a fact about the DOCUMENT, not a log line.** Every gate publishes
  to [preservation-notice.ts](../../../src/lib/preservation-notice.ts) — a store, not a
  return value, because the fact is produced on a promise nobody awaits and
  consumed by a topbar pill and by the save path, two readers with no call
  relationship to the producer (the `useSyncExternalStore` shape the DiskWatcher's
  external-change store has).
- **The posture is WRITE-GATING, not read-only.** While a notice stands the 350-D
  step-aside is SUSPENDED — that rationale assumes the model represents the file,
  and a refusal is exactly the evidence that it does not, so without this the gates
  only delay the loss by one gesture. The editor stays EDITABLE: the danger is
  exclusively what reaches disk, the file on disk is intact whatever the user does
  in the editor, and a read-only posture would take away the two things they most
  need (copying text out, reading the source in the code view) on a stronger
  diagnosis than the gate can support.
- **Acknowledgment outranks everything, and cannot silently cost the missing
  bytes.** "Save anyway…" (behind a danger confirm) is the one way out — refusing a
  user who has been told and has decided is the worse failure. The FIRST refusal
  forces an unconditional forensic snapshot of the intact bundle into
  `virgil/.history/`, bypassing the autosave rate limit, so the pre-refusal file
  is on disk before any acknowledged write. Only the armed EDGE snapshots (every
  later write is refused again while the notice stands — the next keystroke's
  autosave, a mint flush, a manual save; a refusal disarms the debounce, so
  there is no 1500 ms retry clock — and merely bumps the count). The dev
  backend keeps
  no history folder, so its armed edge is unused — stated at its sites rather than
  silently absent. There is deliberately NO plain dismiss: dismissing would hide
  the notice while every write stayed refused, which is the silence the surface
  exists to end. And the banner sits BEFORE the `topbarRightCollapsed` gate — a
  data-integrity notice must not be hideable by a layout preference.
- **A refused write returns NORMALLY, so the save path reads the CHANNEL rather
  than the absence of a throw.** It used to set `saveStatus: "saved"` and advance
  `lastSavedRef` for a write that never happened — the second of which also
  suppresses a later legitimate mint-flush of that doc.
- **Every function that writes a document's file is ACCOUNTABLE** — it MEASURES
  the write against what was read, or SNAPSHOTS the bytes it is about to
  overwrite, or states at the site why it needs neither. `writeTex` (the style
  swap) was the one `.tex` writer with neither, carrying the most destructive write
  Virgil makes. No GATE, deliberately — the swap is user-intent and refusing it
  would refuse what the user asked for — but an **unconditional**
  `snapshotPriorBundle`, unconditional because it fires on a discrete gesture and
  never on a timer.
- **The `/editor/*` skills are the THIRD writer and had no net.**
  `apply_response.py`'s `region-replace` rewrites the whole preamble from model
  output. The rule is ported to `_common.py`, held to the TS implementation by a
  shared fixture CORPUS whose `expected` numbers are GENERATED from it — a golden
  file rather than a shared input, because a shared input alone is satisfied by
  both languages drifting the same way, which is what a "port the rule" commit is
  most likely to do. The splice refuses on two grounds and the asymmetry is the
  design: the BODY takes the words rule (this mode preserves body bytes verbatim,
  so a body shortfall can only mean a wrong `endMarker` ate document content),
  while the PREAMBLE is deliberately NOT word-gated (`/editor/style-merge`
  legitimately drops the `\documentclass`, the shim block, the title fields and
  shadowed packages) and gets the structural invariant the mode rests on instead:
  exactly one `\begin{document}` in the result.

### The dispatcher half: a serializer that cannot represent its input REFUSES

The last member, and the one where the gates above were all correct and still
could not help. `serializeNode`'s `default:` arm emitted a node's CHILDREN and
dropped its WRAPPER — and, for a childless node, emitted nothing at all; the
second dispatcher, `serializeInline`, had a trailing `return ""` of the same
shape. Both produce well-formed LaTeX that is simply shorter, and no gate
downstream can see it once the user has typed: **the write gate's step-aside
rests on "after a real user edit the model IS the document", which is exactly
the moment a wrapper-dropping serialize stops being measured against anything.**

> **A serializer that cannot represent its input must not emit LESS** — "less" is
> byte-indistinguishable from a correct shorter document. And the set of node
> types it CAN represent is CHECKED against the real schema, since the serializer
> is TipTap-free by construction and cannot ask.

Five rules it earned:

- **ONE dispatcher.** `serializeInline`'s five non-text arms were byte-identical
  duplicates of `serializeNode`'s, so the sequence walker now delegates and the
  second `return ""` is retired **by construction rather than by repair** — the
  twin rule, one file over. Two arms were added on the way: `figureCaption`
  (consumed contextually by `figureBlock`, declared so the census can see it has an
  ANSWER — the expex family's shape) and `text` (a text node reaching the BLOCK
  walk is a malformed model, but the answer to a structural anomaly is never "lose
  the user's prose"; pre-357 it fell to the default arm and vanished).
- **The refusal is a THROW, not a sentinel.** Every one of `serializeToLatex`'s
  ~ten callers would otherwise have to remember to test a sentinel, and the one
  that forgot would write the sentinel to disk. A throw is refused by default and
  has to be caught on purpose.
- **…so the doors split into two kinds, and both are censused.** The four bundle
  writers (two per backend) CATCH it and publish to the same channel a lossy write
  uses — a throw escaping one of them would be a third inert refusal, since
  nothing awaits the load writeback and `save()` catches, logs and leaves the doc
  dirty, so the user watches an autosave that never lands and is told nothing.
  Every read-only projection of the `.tex` FAILS OPEN and keeps its last good
  text: the pipeline's idle tier, `useLatexSource`, the code-view line probe, the
  example-card LaTeX cache — and the CODE VIEW, which falls back to the intact DISK bytes,
  because "open the code view to see the source" is the banner's own advice and
  that surface must still work on a refused document.
- **The code pane's fail-open was NARROWED, not inherited.** An
  `UnserializableNodeError` IS evidence about the parse — committing that model
  would put the live paper into a state no write could ever leave — so the bridge
  refuses and names the node. Any other throw keeps the original rule (not
  evidence the parse was lossy; refusing on it would block the pane on an
  unrelated defect).
- **This refusal offers no "Save anyway", and that is the honest answer.** The
  other three refusals have a version to save — a shorter document the user may
  knowingly accept. This one does not: the serializer produced no bytes at all, so
  acknowledgment would promise what the commit cannot do and refuse again one
  gesture later. The badge branches on `source` and withholds the row.

**Reachability, stated rather than implied.** `parseLatex` builds for this schema,
so this cannot fire for a document today's editor can hold — and CI keeps it that
way. It is the net for the two cases where the schema and the serializer genuinely
diverge: a node extension registered without a serializer arm (which CI turns into
a build failure rather than a silent drop), and a model reaching the serializer
from outside the schema. The same two cases the mount probe exists for, from the
other end.

### The conflict half: a guard that pauses owes BOTH sides a door

Same path, other direction (task 364). Every gate above answers *may this write
land?* This one answers what happens when the file changed **underneath** the
model: the `DiskWatcher` confirms a genuine byte divergence, the autosave PAUSES
rather than clobbering the external write, and the badge surfaces it. The
detection was honest and the posture was right, and the resolution was
one-sided — the only action offered was **Reload**, which discards the user's
unsaved edits. Their own side had no door at all, and the pill was red for an
event whose commonest cause is a sync service (Gabriel's paper lives in the
Overleaf/Dropbox integration folder, so the "external writer" is a daemon).

> **A conflict has TWO sides — the bytes on disk and the unsaved model — so it
> gets two doors, and a door that discards one side puts that side in the net
> FIRST. Which door was chosen may not change what the net holds: the two doors
> differ only in which side they APPLY.**

That last clause is the whole shape. Archiving per door is how the two come to
disagree about what gets kept, silently, with every behavioural leg green — so
the order is stated ONCE in
[conflict-resolution.ts](../../../src/lib/conflict-resolution.ts) and both doors are
derived from it. The net is [`snapshotConflictSides`](../../../src/lib/storage-fsa.ts):
one `virgil/.history/<ts>/` slot holding the disk bundle under its own names
(the same slot shape `snapshotPriorBundle` writes, so recovering from a conflict
slot is recovering from any other) plus the editor's side as `unsaved-<tex>`,
serialized through the SAME `buildSerializeOpts` door the save path uses — so
the archived copy is the bytes a keep-mine write would actually have produced.

Six rules it earned:

- **The net comes first for BOTH doors, and its receipt is READ.** `null` means
  no copy was taken, and the badge SAYS so rather than repeating a promise it
  could not keep — the false-affordance rule, applied to a claim made after the
  gesture instead of before it. A net that could not be taken does **not** cancel
  the resolution: the user is mid-conflict with a paused autosave, and stranding
  them with no way forward is worse than the risk being guarded.
- **Keep-mine ACKNOWLEDGES before it writes.** `hasUnresolvedChange()` gates
  every save path in `useDocument`, so a write issued while the conflict still
  stands is precisely the write the clobber guard is holding back. Re-baselining
  first also makes the write that follows *expected* to the watcher rather than a
  second external change.
- **The keep-mine write is EXEMPT from the 357 write gate, and the exemption is
  stated as a claim** (`writeDocBundle`'s `userResolvedConflict`). That gate
  exists because an AUTOMATIC write must not lose content, and a conflict
  resolution is the opposite of automatic; refusing it would leave the badge's
  promise unkept with nothing on screen to say so — this cluster's own silence
  failure mode. The unconditional net is what makes the exemption safe.
- **ONE registration, not three.** `registerDocActions(docId, {reload, keepMine,
  archiveSides})` — three registrations is three chances to wire two of them, and
  a `keepMine` that never registered is a button that silently does nothing.
- **The `change` tier is untouched.** With no unsaved edits nothing of the
  user's is at stake, so it keeps its one-click Reload and its `Dismiss`; the
  conflict tier alone grew doors, and `take-disk` reuses that same reload path so
  the two severities cannot come to disagree about what "load the disk version"
  means.
- **The red went away because the net arrived**, not to soften the message —
  STYLE_GUIDE, "RED means an action would destroy content WITHOUT a net". The
  copy also NAMES the likely writer as far as it is knowable: FSA hands out a
  directory handle and no path, so Virgil cannot say *which* app, and the honest
  general answer ("another app or a sync service — Dropbox, Overleaf, a text
  editor") is what stops a user alone at the keyboard reading it as corruption.

CI: [conflict-resolution.test.ts](../../../src/lib/__tests__/conflict-resolution.test.ts)
drives the REAL resolution against recording ports and asserts the SEQUENCE (a
leg that only asserted "the archive was called" passes on an implementation that
archives the outcome); [conflict-net.test.ts](../../../src/lib/__tests__/conflict-net.test.ts)
drives the REAL `snapshotConflictSides` against a fake disk and reads the slot
back, because the ordering legs pass just as happily on a net that copies
NOTHING — the failure a user would discover only after losing a version;
[external-change-badge.test.tsx](../../../src/components/__tests__/external-change-badge.test.tsx)
pins both doors inline and the two REPORTED failure shapes; the multi-doc suite
pins that `resolveConflict` drives only the ACTIVE doc's ports; and
[useDocument.autosave-pause.test.ts](../../../src/hooks/__tests__/useDocument.autosave-pause.test.ts)
drives the REAL registered `keepMine` with the watcher still reporting the
conflict. Measured by neutering each half: archiving after the apply takes 6
legs, dropping `userResolvedConflict` 1, and a net that skips the editor side 3.
Four badge legs were RENEGOTIATED rather than re-scoped — they pinned the
one-sided affordance (danger tone, a destructive confirm, keep-mine buried in the
kebab) as intended behaviour.

**Residuals, stated.** The dev backend takes this ONE net (the affordance
promises it, and the app is previewed there) while keeping no history for
ordinary writes, and its slots are unpruned — the dev API has no directory
listing. The badge shows no diff summary: computing one needs both sides' bytes
at render time, and the pill is not a place to do disk I/O. And the real-Dropbox
eyeball is **owed, not claimed** — this class masks in the dev preview, so the
durable proof here is the unit contracts.

### The memory half: when a write cannot land, memory is the ONLY copy

Same path, and the half every gate above PRESUPPOSES (task 391). The disk-side
laws are complete and they were RIGHT on 2026-08-19: a sync daemon reverted the
paper's `.tex`, the DiskWatcher detected it, the 364 clobber guard PAUSED
autosave rather than overwrite the external edit, and the file on disk stayed
protected. Gabriel then wrote for ~70 minutes with every edit in memory alone
behind a quiet pill, the overnight deploy's service-worker "Update available"
banner appeared, he clicked it, and the page reloaded. Everything since 12:16
was gone.

> **A refusal or a pause makes the editor's memory the only copy of the user's
> work — and every door that DROPS memory (a service-worker reload, a badge
> reload, a tab close, a crash) stays fully armed.** So the state "this document
> holds work that has not reached disk" is published to ONE channel, a durable
> MIRROR is armed from it, and no door that drops memory opens before the work
> is either landed or mirrored.

Four pieces, in the order a byte travels:

- **The channel.** [src/lib/unsaved-work.ts](../../../src/lib/unsaved-work.ts) —
  `dirtySince` / `lastLandedAt` / `reason` per doc. Not
  `saveTimerRef.current !== null`, which is unsound in BOTH directions for this
  question and is exactly what went quiet in the incident: the debounce callback
  nulls its handle BEFORE calling `save`, so a REFUSED write leaves the document
  dirty with the flag already cleared, and a re-armed pause keeps it non-null
  forever, saying "a write is coming" when the truth is "no write can land".
  Cleared by nothing but a write that ACTUALLY LANDED, read off the 357 refusal
  channel rather than from the absence of a throw.
- **The mirror.** [src/lib/emergency-mirror.ts](../../../src/lib/emergency-mirror.ts) — a
  rolling per-doc snapshot of the live model in IndexedDB (the SAME `virgil`/`kv`
  store `doc-index` and `tex-assets` use), on a 5-second wall clock, armed
  whenever the doc is unlanded and either BLOCKED (arm at once — the incident's
  state) or merely AGING past `MIRROR_ARM_AFTER_MS` (a sustained typing burst
  keeps resetting the 1500 ms debounce, so memory is the only copy there too;
  the hazard there is a crash rather than a gate). It stores a MODEL, not
  `.tex` bytes, so a restore goes back through the same mount and preservation
  gates any load does rather than around them.
- **The doors.** [src/lib/reload-door.ts](../../../src/lib/reload-door.ts) — flush every
  doc, RE-READ the channel (a refused write resolves normally, so the flush
  resolving proves nothing), force-mirror what still has not landed, and only
  then report. `prepareForReload` is what the update banner asks before it
  posts `SKIP_WAITING`; `reloadNow` is what the `controllerchange` handler —
  which is armed unconditionally and reachable without the banner at all —
  enters instead of calling `location.reload()` bare.
- **The recovery.** [src/lib/mirror-recovery.ts](../../../src/lib/mirror-recovery.ts) +
  `MirrorRecoveryBadge`. A mirror is cleared by exactly one thing, so a mirror
  that SURVIVES to the next open is by construction work that never reached
  disk. Restore archives BOTH sides into one `virgil/.history/` slot first
  (reversible either way, which is what lets the badge offer a decision with no
  preview surface), writes as `userResolvedConflict`, and reloads — and reports
  whether it landed, so a refused restore leaves the offer standing.

Six rules it earned:

- **A door reads the CHANNEL, never the absence of a throw.** The incident's
  unload flushes all ran and all "succeeded" as refusals. This is the same rule
  the 357 cluster states for `save()`, applied to every consumer downstream of
  it — including `ConflictPorts.keepMine`, which was reporting `applied: true`
  for a write that never happened and clearing the badge over unsaved work.
- **`beforeunload` PROMPTS off the channel.** The mirror makes the loss small;
  the prompt makes it CHOSEN. And the handler no longer disarms the debounce: it
  runs on a leave the user can still CANCEL, and clearing the timer unconditionally
  left a "Stay" with no retry armed until the next keystroke. The duplicate write
  that risks is a no-op — `writeDocBundle`'s byte-equality gate skips it.
- **The arming predicate is pure and shared** (`shouldMirror`), and `force`
  bypasses AGING but never the DIRTY test: a door may not mirror clean work.
- **A failed mirror is a NET failing, never a gate.** A quota error, a
  private-mode block, a closed database — all warn and retry on the next tick.
  Nothing here may disturb editing, and the banner SAYS when no copy was taken
  rather than repeating a promise it could not keep.
- **KEYSTROKE SANCTITY.** `noteUnsavedEdit` runs on the typing path and emits
  only on the clean→dirty EDGE, so a 50-character burst notifies subscribers
  ONCE; the mirror adds no editor subscription at all (one 5-second interval per
  open doc, reference-first equality bail, so a quiet armed tick costs one
  compare); and the AGE surfaces render from a per-minute ticker in the
  component, never from a store write.
- **The pause gets a CLOCK.** A conflict badge that says the same words at
  minute 1 and minute 70 is how a warning becomes furniture, and that was the
  incident's second act. It names the age and, while a mirror is being kept,
  says so.

CI: [emergency-mirror.test.ts](../../../src/lib/__tests__/emergency-mirror.test.ts) (the
channel's edges + the ticker's arm/bail/failure contract),
[reload-door.test.ts](../../../src/lib/__tests__/reload-door.test.ts),
[mirror-recovery.test.ts](../../../src/lib/__tests__/mirror-recovery.test.ts), and
[useDocument.unsaved-mirror.test.ts](../../../src/hooks/__tests__/useDocument.unsaved-mirror.test.ts)
— the WIRING, which is the half no test of the mirror or the door can see,
driving the REAL hook for each blocking reason, the unload prompt, the restore
ORDER, and the conflict net carrying the LIVE unsaved side. **The legs with
teeth are the censuses**: the door was never the part that could misbehave, a
call site that never asks it is, and that is literally what shipped — so no
production file may call `location.reload()` outside the door (`reloadNow`'s
`reload` argument is REQUIRED rather than defaulted precisely so the module
itself is not a speller and the census has exactly one legitimate entry), and
`applyUpdate` has exactly two mentions in `src/`: its declaration and the gated
banner. Measured by neutering each half in turn: the pre-391 `beforeunload`
predicate takes 1 leg, a `save()` that publishes nothing 4, a door that reports
before it flushes 5, a bare reload + ungated banner 2, a restore that writes
before it nets 1, and a restore that ignores its report 1.

**Owed, not claimed:** the live drill. Block saves (a forced conflict), type for
two minutes, hard-reload → the offer restores within seconds of the last tick;
and a real-Dropbox eyeball of the aged pause badge. This class masks in the dev
preview, so the durable proof here is the unit contracts.

#### The population half: a door flushes what is REGISTERED, and one registrant of twenty was

Same door, the half its own docblock claimed (task 559, an audit finding). Step 1
of `prepareForReload` reads *"fire every document's pending debounce"*, and it
fires what `registerPendingFlusher` holds — which was a `Map<docId, Flusher>`,
ONE slot per document, with exactly one caller in the tree: `useDocument`'s
bundle autosave. Every `usePersistentState` instance (one per card sidecar,
~20 per document) and `useEditorUIState` (the view-state coalescer) kept a
private timer and registered nothing, so a note body typed in the 300 ms before
an app-driven reload was outside the door, outside the unsaved-work channel
(which only the bundle path feeds) and outside the mirror (which stores the
TipTap MODEL, where a card body does not live) at once — and `unlanded: []` was
reported about a document about to lose it. The same class as the save-state
census reading only `useDocument.ts`, costing the user's writing instead of a
missing guard; in practice narrowed by the tab-hidden settle edge, which fires
AFTER the report is computed and during an unload with no completion guarantee.

> **Every coalescing writer registers its settle door with the ONE
> pending-flusher registry, under its document — a per-doc MULTI-SET, so
> "flush the document" means every debounce it holds. And the registry runs in
> TWO PHASES: a coalescer that feeds the MODEL is `settle` and completes before
> any disk writer STARTS.**

Four rules it earned:

- **`drainDoc` inherits the fix for free.** It already called
  `flushPendingForDoc` before draining the queue, so a doc switch, a compile and
  a delete now settle every sidecar debounce too — no second mechanism.
- **The channel and the mirror stay MODEL-scoped, deliberately.** A sidecar
  write is landed by step 1 or logged by its own `persist`; putting it on the
  unsaved-work channel would make every 300 ms card edit read as blocked work,
  and the mirror cannot represent it. So `unlanded` keeps its meaning; what the
  door buys is that the sidecar half has been fired and awaited by the time it
  is computed.
- **The phase exists because of ORDER, found by asking what else coalesces.**
  The code pane holds the last 600 ms of typing in CodeMirror and only then
  re-parses it into TipTap; the bundle writer snapshots the live model. Its
  host mounts AFTER `useDocument`, so under a flat start-everything-at-once the
  writer snapshots first and the code edit lands in a model the page is about
  to discard. `CodeEditor` registers the bridge's own `flush()` as `settle`;
  the settle door inherits the pane's parse gates (a lossy parse keeps the
  last-good model). `write` is the default because it is what every
  registrant WAS; a settle registrant makes the stronger claim and states it.
- **A member that cannot be landed is DECLARED, not silently added.**
  `RichTextField`'s 250 ms body debounce is the same shape one step further
  upstream, and its `onChange` arms the sidecar write INSIDE a `setState`
  updater React runs lazily — so a settle flusher there would fire and the
  write phase would still find nothing armed. It needs a synchronous render
  flush around the hand-off, a different mechanism with its own harness;
  stated at the site and pinned by the census as a known non-registrant.

CI: [reload-door.test.ts](../../../src/lib/__tests__/reload-door.test.ts) — the door
awaits a sidecar registered BESIDE the bundle (the leg fails under the one-slot
registry, where the later registration replaced it), the upstream-settle leg
(a writer registered first still snapshots a settled model), the phase-order
pins, and the CENSUS: every production file spelling a write door behind a
`setTimeout(` registers with the registry (write-phase registrants = coalescing
writers, exact set, allowlist EMPTY), the settle registrants are an exact set
with the reason (that population cannot be derived by the write needle), and
`flushAllPendingDocs` has one caller. [code-pane-settle-before-write.test.ts](../../../src/lib/__tests__/code-pane-settle-before-write.test.ts)
drives the REAL bridge over a REAL CodeMirror state — the writer registered
first snapshots the code edit, and the same flush registered as a plain member
does NOT, which is what proves the phase is load-bearing rather than tidy.
[usePersistentState.test.tsx](../../../src/hooks/__tests__/usePersistentState.test.tsx)
and [editor-state-write-cadence.test.ts](../../../src/hooks/__tests__/editor-state-write-cadence.test.ts)
pin that each coalescer registers, is AWAITED, and unregisters on unmount.

**Owed, not claimed:** the preview eyeball — NOT FSA-masked in dev storage:
type in a note, trigger the update banner's reload, reopen; and type in the
code pane, reload within a second, reopen.

#### The evidence half: nothing touches the mirror without POSITIVE EVIDENCE about the model

Same mirror, the half that made the mechanism destroy what it was built to keep
(task 557) — and the case where the rule was stated at the site, in the right
words, and then broken by the line immediately below it.

391's mirror is cleared by exactly one thing, and `save()` says so:
*"THIS is a landed write — the only thing that clears the dirty state and drops
the mirror. **Never inferred from the absence of a throw.**"* It then inferred it
from the absence of a FLAG, which is the same mistake one predicate over. Three
breaches, all silent, all costing the user everything the mirror exists to hold:

- **M1 — the unmount's forced tick mirrored THE DISK COPY over the work.** Two
  sibling cleanups ran in declaration order over one mutable ref: the flush read
  `latestContentRef`, nulled it, and handed the duty to the tick below it
  (*"the forced mirror tick in the sibling cleanup below is what covers this
  document"*) — which then found the ref empty. In production React destroys the
  editor in CHILD cleanup first, so `currentModel()` fell through to its third
  rung, `lastSavedRef`: **by definition the last model that reached disk.** On
  the next open the mirror's hash matched the file, the load path took its
  `clearMirror` + `clearRecoveryOffer` branch, and the user was offered nothing.
  `emergency-mirror` already guards exactly this — `if (!model) return
  "no-model"`, pinned as *"an editor that is gone reports no-model rather than
  mirroring nothing over the work"* — and the third rung made `null` unreachable
  once a paper had saved even once, so the guard could never fire.
- **M2 — the PAUSE branch never populated that ref at all**, returning nineteen
  lines before the assignment. Throughout a conflict or a cowork-pen hold — the
  exact state the mirror exists for — the only copy of the work was the live
  editor.
- **M3 — an ACKNOWLEDGED notice made a later refusal read as LANDED.**
  `recordPreservationRefusal` drops a refusal for a doc the user has already
  answered (deliberately: re-arming the posture behind them would make the
  acknowledgment mean nothing), so `isWriteProtected` stays FALSE while the door
  refuses. `save()`'s only report check was that flag, so a serializer refusal
  after a "Save anyway" advanced `lastSavedRef`, published a landed write, went
  green with a timestamp, stopped `beforeunload` prompting — and DELETED the
  mirror, for a write that never happened.

> **Nothing may write, clear, or replace the emergency mirror without POSITIVE
> EVIDENCE about the model it is acting on.** A mirror WRITE needs evidence the
> model is newer than disk; a mirror CLEAR needs evidence THIS model reached
> disk. Neither may be inferred from a fallback chain, and neither from the
> absence of a flag.

Eight rules it earned:

- **THE REPORT IS THE PERMISSION, and the bundle write was the last door still
  making its caller guess.** `writeDocBundle` returns a `DocWriteReceipt`
  ([storage-types.ts](../../../src/lib/storage-types.ts)) in both backends — the shape
  `WritePdfResult`, `captureFloatToStack`, `deleteSidecarSiblings` and the
  conflict doors already have. It retires M3 by CONSTRUCTION and hardens every
  future refusal source: a new gate cannot be swallowed by an unrelated
  acknowledgment, because the door states its own verdict rather than leaving a
  second predicate to stand in for it.
- **`lastSavedRef` is not a rung.** It is by definition already on disk, so it is
  never an answer to *what is in memory that may not be* — which is the question
  every consumer of `currentModel` asks (the mirror, both conflict ports, the
  manual-save door). Each already handled `null` and must keep doing so: `null`
  is the honest answer, and it is the one that leaves a good mirror alone.
- **ONE capture per unmount, read by both consumers.** Two sibling cleanups with
  an implicit ordering contract over a shared mutable ref cannot both be right
  about which model is leaving memory. The ref is per-mount and dies with the
  component, so nulling it bought nothing and cost everything. Deliberately NOT
  merged into one effect: their dep arrays differ (`[save, …]` vs `[docId]`), and
  a merged cleanup would fire `clearUnsavedWork` on every handle change.
- **The two halves of M1 are independently sufficient, and both ship.** Dropping
  the third rung makes the mirror unable to write the disk copy AT ALL; keeping
  the snapshot makes the forced tick able to write the WORK. Measured: either one
  alone leaves the reported case green, which is why the legs are stated per
  half and the combined neuter is the true pre-557 state.
- **CAPTURE BEFORE REPORTING.** The pause branch takes its snapshot while the
  editor is alive — the one moment that path can answer at all — at the same
  O(doc)-per-1500 ms cost the landing branch pays, off the keystroke path.
- **A mirror DROP names its evidence.** `dropMirror(docId, ticker, reason)` has
  two sanctioned reasons and the caller states which it holds: `landed` (the
  door reported it) and `discarded` (the user chose the disk copy; the conflict
  door archived their side first). Until 557 both callers spelled
  `dropMirrorAfterLandedSave` and one of them was on a path where nothing had
  landed at all, so the name was doing double duty and nothing pinned the
  distinction. The reason has a READER — the census.
- **`read-only` is an ANSWER, not a failure**, and it is given BEFORE the funnel.
  `enqueueDocWrite` short-circuits a `library-paper:` write by resolving
  `undefined as T` — a CAST, so TypeScript cannot catch a receipt-shaped door
  returning it, and its own comment (*"none relies on a meaningful resolved
  value"*) stopped being true the moment one did. `writePdf` already shows the
  house answer, and for the same stated reason: the caller must distinguish
  "intentionally not persisted" from a success. `save()` then reports NEITHER
  landed nor blocked — the channel is armed only by an UNDOABLE user edit, which
  a read-only main text cannot produce, so a blocked report would arm a badge, a
  `beforeunload` prompt and a mirror on a surface whose whole contract is that it
  never saves.
- **The serializer and the write gate are ONE reason** (`preservation`), because
  they are one CHANNEL — both publish through `recordPreservationRefusal`, which
  is the "one refusal channel for every preservation failure" doctrine
  `serialize-refusal.ts` already states.

CI: [useDocument.mirror-receipt.test.ts](../../../src/hooks/__tests__/useDocument.mirror-receipt.test.ts)
drives the REAL hook with a fake backend and a REAL in-memory IndexedDB — the
load path reads the slot back to decide whether to raise an offer, so a stub that
forgot what it stored could not represent the question. **No pre-557 suite could
see any of this**: every one of them hands the hook a fake editor that never
destroys itself, and the defect needs the editor GONE before the parent cleanup
runs, which is what React does in production and what `useDocument.ts` says at
its own unmount site. So these legs destroy the editor on the unmount edge and
then ask what the mirror holds. The leg with teeth is the CENSUS
([mirror-evidence-census.test.ts](../../../src/lib/__tests__/mirror-evidence-census.test.ts))
— the receipt and the model source were never the parts that could misbehave, a
call site that re-derives the verdict is, and every such site type-checks
perfectly; allowlists EMPTY. Measured by neutering each half in turn: the third
rung takes 1 behavioural + 1 census leg, the nulled snapshot 1, both M1 halves
together 4, the pause capture 1, the receipt 2 behavioural + 1 census, a second
module claiming a landed write 1, an evidence-less `dropMirror` 1, a backend
returning bare 1, and the read-only answer moved inside the funnel 1. The two
`library-paper-write-guard` legs that pinned `resolves.toBeUndefined()`, and
`preservation-refusal-posture`'s ordering leg that pinned
`isWriteProtected(handle.docId)`, are RENEGOTIATED in place with the reason at
the site: all three stated the retired mechanism as the contract.

**Owed, not claimed:** a real-FSA eyeball. This class is FSA-masked — pause a
paper (an external change), type, switch papers, come back — so the durable proof
here is the unit contract.

### The honesty half: a gate that stops writing SAYS SO, in one voice

Same path, and the half the incident of 2026-08-19 turned on (task 392).
Gabriel's ask afterwards was *"verify that auto-save is working properly, and
consider adding a save button"* — and the honest answer to the first half is
that it **was** working properly. It was deliberately paused by the 364 clobber
guard, correctly, for seventy minutes, and the user could not tell. Task 391
gave that state a durable second copy; this half gives it a VOICE.

The reason it needed a law rather than a pill is that each silencing path
decided for itself whether to speak, and they had settled on different answers:
the conflict pause spoke through the external-change badge (which sat inside
BOTH the collapse and zen gates, so a layout preference could hide it), a
preservation refusal through its own badge, an FSA throw through
`console.error`, a stale-pipeline drop through `console.warn` — and the
destroyed-editor drops in `debouncedSave` / `flushNow` / `flushAnchorCommit`
through nothing at all. `useDocument` did export a `saveStatus`, and **nothing
in the app read it**: declared, written at six sites, consumed by no pixel — the
task-202 dead-export shape, in the hook whose subject is telling the user what
is happening.

> **Every path that declines to write REPORTS on the ONE channel, and the
> topbar renders the ONE tier ladder derived from it. A gate with no voice is
> the incident; a second vocabulary is how the voices come to disagree.**

[src/lib/save-state.ts](../../../src/lib/save-state.ts) is the vocabulary over task 391's
channel — the four tiers (`clean` / `pending` / `unsaved` / `blocked`), their
thresholds, `isSaveTierProtected`, and `describeBlockReason`, which is the one
table that says what a reason MEANS and **which flow can resolve it**.
[src/lib/save-request.ts](../../../src/lib/save-request.ts) is the manual door.
Seven rules they earned:

- **The report is the CHANNEL, and that is the whole reason the surgical
  version of this feature is wrong.** A Save button wired to `flushPending`
  would have reported success throughout the incident, because a refused write
  resolves normally. `SaveDoor` returns a `SaveAttemptOutcome` read off
  `unsaved-work` AFTER the attempt — the rule `keepMineOverDisk` and the reload
  door already follow, now stated for the user-facing door too.
- **A Save that cannot land ROUTES; it never re-refuses.** A blocked write is
  held by a flow that belongs to another surface (the 364 conflict doors, the
  357 acknowledge dialog), and answering it is a decision only the user can
  make. So the button asks that surface to open itself
  (`requestBlockingFlow`), keyed by `describeBlockReason(...).flow` so the
  button and the opener cannot disagree about which dialog a reason leads to.
  A Save that silently re-refuses is this incident's silence with a button on
  it. The one reason that names no flow is `error` — it has a next attempt
  rather than a dialog, so its button says "Try again".
- **…and it respects the guard it is asking about.** The manual door consults
  `shouldPauseAutosave` and reports `conflict` rather than writing. A Save
  button that walked past the clobber guard would do the one thing every
  automatic path in `useDocument` refuses to do — overwrite the external edit —
  and it would do it on a gesture the user thinks is safe.
- **ONE dirty predicate.** `saveTimerRef.current !== null` was the de-facto
  answer on three flush paths, and task 391 had already recorded why it is
  unsound in both directions: the debounce callback nulls the handle BEFORE
  calling `save`, so a REFUSED write leaves the document dirty with the flag
  already cleared. 391 migrated `beforeunload`; the other three stayed, which
  meant `flushAllPendingDocs` — the reload door's first move — was a **no-op on
  exactly the documents it exists for**. `hasWorkToWrite` is the one predicate
  now, and the census forbids the comparison anywhere else.
- **A tier decides its own hideability, once.** The two reassurance tiers may be
  collapsed away; the two data-integrity tiers may not — the task-357 rule,
  lifted out of one badge's placement into `isSaveTierProtected` so the whole
  ladder inherits it. That is also what forced the external-change badge out of
  both gates, where it had sat since it shipped: the pill for the pause is
  precisely what the save badge's "Resolve…" button routes to, so a collapsed
  toolbar made the way out unreachable. Its now-unused `externalChangeActive`
  lift (state + prop + a whole reporter component) was DELETED rather than left
  written-and-unread.
- **No button in the `pending` tier, and the keyboard door is always open.**
  An affordance whose only effect is to do what is already happening is dead
  chrome, and one that blinks in and out on every typing pause is the fastest
  way to teach someone to stop seeing it. Cmd/Ctrl+S (previously unbound — the
  browser's "Save Page As…", which for a PWA whose document is on the user's
  own disk is exactly the wrong thing) enters the SAME door in every tier,
  because a shortcut costs no pixels and so has no reason to hide.
- **Retiring `saveStatus` is part of the fix, not a tidy-up.** Keeping a second,
  unread status vocabulary beside the channel is how the next surface comes to
  render the wrong one — and the state had a live defect nobody could see: the
  stale-pipeline arm returned without resetting it, so a dropped write left the
  status stuck at `"saving"` forever. WIRE-it or DELETE-it.

**The census is the deliverable, and it is what makes "verify autosave works" a
permanent answer instead of an afternoon's.**
[save-state-census.test.ts](../../../src/lib/__tests__/save-state-census.test.ts)
DISCOVERS the write doors from `useDocument.ts` itself (the declarations that
reach `save(` / `writeDocBundle(` — never a hand list, which could only be
missing the door that drifted) and fails any early return inside one that
neither publishes a reason nor carries an in-place `save-silent-ok: <why>`
marker; the allowlist is EMPTY. Beside it: every `catch` in a door reports, the
retired dead state stays retired, every caller of `requestSaveNow` also spells
`requestBlockingFlow`, only `useDocument` publishes a door, and the two loud
badges render BEFORE the collapse gate. The behavioural halves are
[save-state-view.test.ts](../../../src/lib/__tests__/save-state-view.test.ts) (the
ladder), [useDocument.manual-save.test.ts](../../../src/hooks/__tests__/useDocument.manual-save.test.ts)
(the door against the REAL hook — including the leg that asserts a conflicted
manual save writes NOTHING) and
[save-state-badge.test.tsx](../../../src/components/__tests__/save-state-badge.test.tsx)
(the four tiers, the collapse rule, both click behaviours, and the ticker,
which arms no timer at all while the document is clean and schedules the next
tier BOUNDARY rather than polling). Measured by neutering each half in turn:
restoring one silent gate takes 1 census leg, restoring the debounce-handle
predicate 2, moving the badge inside the collapse gate 1, dropping the manual
door's clobber guard 1, reporting from the absence of a throw 1, collapsing
every tier 1, and re-attempting instead of routing 2.

**Owed, not claimed:** the preview eyeball, and a real-conflict pass. The
conflict tier is FSA-masked (the dev preview's `virgil-data/` has no external
writer), so the durable proof there is the unit contract; the amber tier and the
button are not masked and are worth watching once — type, wait past the warn
threshold, click **Save now**, see the pill go green with a timestamp.

**Residuals, stated.** The `pending` tier says "Saving…" from the fact that a
write is ARMED, not from one being in flight — `writeDocBundle` has no
in-progress channel and inventing one for a label would be a second status
vocabulary, which is what this task deletes. The escalated tier grows inside the
32 px bar rather than becoming a real banner: a taller surface is a layout
decision this task did not take, and the sentence beside the pill is what the
incident actually needed. And the census reads `useDocument.ts` only — a save
path added in another module would be invisible to it, which is honest rather
than complete: every write door lives in that hook today, and the door census's
`registerSaveDoor` leg is what would notice a second one trying to publish.

### The redundancy half: a write of bytes already on disk has zero information and all of the risk

Same path, one question earlier (task 415). Every gate above answers *may this
write land?* This one asks the cheaper question underneath it: **should this
write happen at all?** Gabriel, from a real Dropbox folder: *"the conflicted
copies keep coming at a constant and fast rate."*

Measured over `~/Dropbox/Apps/Overleaf` on 2026-08-21, the report is not
evidence that task 363 failed — the two post-363 days are 10 and 6 forks against
the pre-fix day's 92, roughly the 10x cut 363 predicted. What it is, is the
residue, and its distribution is the finding: of the sixteen post-fix forks
**`virgil.json` is the LOUDEST base at 8** — a file holding paragraph titles,
collapsed state and a per-block 80-character content fingerprint, whose bytes
barely move while you write.

Two sites, one disease. `writeDocBundle`'s byte-equality skip was
**ALL-OR-NOTHING** — it returned only when BOTH outputs matched what this
session last put on disk, so the moment the `.tex` moved by one character the
byte-identical `virgil.json` was rewritten beside it, once per autosave, for the
whole session. And `persistSidecarInLock` had **no equality gate at all**, while
the guard above it (`usePersistentState.update`) bails only on REFERENTIAL
equality — so any hook that rebuilds a structurally-equal array re-writes the
identical bytes. Chrome's FSA has no in-place write mode: `createWritable()`
mints a `<name>.crswap` sibling and renames it over the target, so each of those
is two filesystem events a sync daemon watches.

> **No FSA write of a file whose bytes are already on disk.** The test lives at
> the write FUNNEL — [`writeTrackedText`](../../../src/lib/storage-fsa.ts) /
> `putTrackedText` — so every writer inherits it: the two bundle files, the
> `.tex`, `references.bib`, the figure index, and every `writeSidecar` /
> `mutateSidecar` caller. 363 shrank the race window by CADENCE, which is a
> heuristic; byte-equality is a proof.

Seven rules it earned:

- **The skip STATS, because the ledger is a belief about disk and not disk.**
  The pre-415 gate compared its serialized `.tex` against the ledger fingerprint
  and returned — and the `.tex`/`.bib` fingerprint is never re-baselined on a
  genuine external change: the `DiskWatcher` deliberately KEEPS the stale one
  and flags (that is how the badge stays lit across polls). The sidecar
  fingerprints ARE re-baselined by the `SidecarWatcher` — but only on its ~3 s
  poll, so a window remains. (415 recorded that watcher as "not mounted
  anywhere in production"; that was FALSE, see "The grep half" below.) So a
  hash-only gate can decline to write over an external edit, silently, which is
  the one failure this whole subsystem exists to prevent. A skip is taken only when the file is PROVABLY
  the one we stamped: the content hash matches AND the live `{mtimeMs, size}`
  still match the fingerprint — the DiskWatcher's own cheap-path predicate, read
  off the SAME handle the write would have used, so the gate and the watcher can
  never disagree about whether a file moved. **The task's own premise ("the
  DiskWatcher already invalidates the ledger fingerprint on a genuine
  divergence") is FALSE and is corrected here rather than left standing** — it
  is exactly why the stat is needed.
- **Everything unprovable FAILS OPEN and writes.** No fingerprint (a page reload
  starts with an empty ledger), a stat that throws, any drift. A needless write
  is the pre-415 behaviour; a wrongly-skipped write leaves the user's state
  unpersisted, which is the direction that costs.
- **The stat makes a skip CHEAPER, not dearer.** One metadata read replaces an
  entire `createWritable` + rename + the post-write stat `stampLedger` would
  have done anyway.
- **The funnel owns the STAMP as well as the write**, because "what is on disk"
  and "who may skip writing it" are one fact. A writer that could stamp without
  writing — or write without stamping — is how the gate would come to believe
  something the disk does not say.
- **READS stamp too, which is what makes the gate effective from a session's
  FIRST save.** The ledger's contract has always been *"what Virgil last put on
  **or read from** disk"* (both watchers' PRIME passes stamp exactly this way)
  and only the `.tex` load path was doing it, so every sidecar's first write of
  a session landed however unchanged its bytes. `readTrackedText` takes the
  fingerprint off the `getFile()` the read already does — free, and guaranteed
  to describe the same revision. Inside `mutateSidecar` it is stronger still:
  the read runs in the same critical section as the write, so a mutation
  producing structurally-equal JSON is proven a no-op microseconds later. **That
  closes `usePersistentState`'s referential-equality hole from underneath rather
  than auditing ~20 hooks for structural equality.**
- **A stamp may never change what a READ returns.** The dev twin's first cut
  wrapped the header reads and the fetch in ONE `try`, so a response with no
  `content-length` returned `null` — which for `mutateSidecar` is an EMPTY base,
  i.e. a merge that silently drops everything on disk. Found by the existing
  `mutate-sidecar-primitive` suite, and worth stating as a rule: best-effort
  bookkeeping gets its own `try`, always.
- **The forensic snapshot rides `beforeWrite`.** A `.history/` slot is itself
  sync traffic, and there is nothing forensic about archiving bytes no write is
  about to replace. `onceBeforeWrite` latches it so a bundle takes at most ONE
  snapshot however many of its files move — and which file moves first is now a
  per-file verdict rather than something the caller knows in advance.
- **`userResolvedConflict` FORCES past the gate** (task 364's keep-mine door),
  and `force` is not an optimisation escape hatch: the gate's whole
  justification is that the bytes are already there, so a caller that disagrees
  says why at its own site.

The `lastSidecarHashByDoc` module cache is **retired**, not merely aligned: the
ledger holds the same fact keyed on the relPath the watchers stat, confirmed
against a live stat, where a module Map keyed on the doc was invalidated by
nothing. **This is not a decoupling** — 411's decision 3 stands: the bundle's two
files are still computed together and committed inside ONE serialized critical
section making ONE coherent decision. Declining to rewrite a file with the bytes
it already has is not letting it drift out of the bundle.

**Both backends move together** (the twin rule): the fork risk is a daemon
watching the paper folder, which the dev backend's local `virgil-data/` has
none of, but a write count that differs between backends is a difference someone
eventually debugs in the wrong one.

CI: [per-file-write-gate.test.ts](../../../src/lib/__tests__/per-file-write-gate.test.ts).
**No pre-415 suite could see any of this**: the defect is a RATE and every one of
them (`write-tex-forensic-snapshot`, `mutate-sidecar-primitive`,
`sidecar-bundle`, `conflict-net`, `storage-fsa-load-writeback`) drives ONE write
and asserts its PAYLOAD, which the pre-fix code satisfies perfectly. The shape
here is `editor-state-write-cadence`'s: drive a simulated session and COUNT. Its
fake disk models real `mtime`/`size` — every other FSA fake in the repo reports a
constant `lastModified: 1`, so the confirm-stat would answer for reasons
unrelated to what the legs assert. The leg with teeth is the CENSUS, sharing ONE
`writeSites()` extraction with `tex-write-accountability` (which asks a DIFFERENT
question of the same population, so the two cannot come to disagree about who the
writers are): every RAW primitive call is inside the funnel or carries a
`write-gate-exempt: <reason>`, and `diskAlreadyHas` has exactly one caller per
backend — a second is a partial gate. Measured by neutering each half in turn:
the pre-415 ungated sidecar write takes 4 legs, the all-or-nothing bundle gate 2,
the stat-confirm 1 (the external-write masking leg), read-stamping 1, `force` 1,
and a dropped exemption marker 1 (the census).

**That census was nearly DRAINED by this fix, which is the other half worth
recording.** `tex-write-accountability`'s needle was exactly `writeTextToHandle(`
/ `putText(`, and every real writer moved behind the new door: measured on this
tree with the old needle it fell from eleven sites to TWO — the funnel's own —
and its `.tex`-writer leg to ZERO, while four of its five legs kept passing. So
the needle is renegotiated in place to the FAMILY (raw primitives AND gated
doors), which keeps the population identical to the pre-415 one. **A wrapper
relocates an obligation to its callers; it never absorbs one** — task 331's rule,
arriving at a census instead of a splice site.

**A correction the task itself needs, recorded rather than left to be
rediscovered:** `virgil.json` does NOT hold only titles and collapsed state — it
also holds a per-block first-80-character content FINGERPRINT
(`extractSidecarData`). So an edit inside a block's opening 80 characters really
does move its bytes, and the gate correctly writes there. What is true, and what
the cost leg models, is that essentially all typing in a real paragraph lands
past that window, so the sidecar's bytes hold still through a writing session.

**Residual, and the honest ceiling.** With the doc open on two machines at once
some conflicts are inherent: no write-rate reduction reaches zero, it only
shrinks the window proportionally. And the dev backend's stat is an HTTP HEAD, so
`Last-Modified` has one-second resolution — an external write inside the same
second at the same byte length would not move the confirm there, where FSA's
`File.lastModified` is millisecond-resolution. Nothing watches that folder, so
the exposure is a fixture one.

**Owed, not claimed:** a real-Dropbox eyeball. This class is both FSA-masked and
SYNC-masked — the dev preview's `virgil-data/` is local and nothing watches it —
so the durable proof here is the write-COUNT contract. The check is cheap and
exact: after a few days of ordinary writing, count new `virgil.json` forks, and
the expectation is ZERO rather than fewer, because its bytes genuinely do not
move during a session.
`find ~/Dropbox/Apps/Overleaf -name "*conflicted copy*" | grep -oE 'conflicted copy [0-9-]{10}' | sort | uniq -c | tail`

### The grep half: a census can only see the files its grep can READ

Same path, and the case where the watcher was right, the provider was right,
the prose was wrong, and a DECISION was routed to Gabriel about a mechanism
that had been live for seven weeks (task 432). The 415 worker grepped both
silos for `createSidecarWatcher`, found only its own file and a `vi.mock`, and
filed *"built, tested, and MOUNTED NOWHERE"*. This file then repeated it as a
fact in the section above. Gabriel ruled "MOUNT it."

It was mounted — in `DiskWatcherProvider`, since 2026-06-30. The provider's
file held a raw **NUL BYTE** inside a string literal (`live.join("<NUL>")`, a
composite-key separator typed as the byte rather than the `"\0"` escape), and
one byte below 0x20 makes `grep` classify the whole file as BINARY: every match
becomes `Binary file … matches`, and the zsh `grep` wrapper every worker,
auditor and catcher reaches for suppresses those lines entirely. `git diff`
showed the same files as `Bin`. The repo's OWN censuses — `_source-scan.ts` and
forty guardrail suites — read through Node and were never fooled, which is
exactly why nothing noticed: the instruments that could see the file agreed
with each other, and the one that could not is the one humans use. Four
production files carried the idiom (`disk-watcher.tsx`, `predicates.ts`,
`parse-tex-log.ts`, `cross-window-storage.ts`).

> **A text source file is TEXT to every reader, or a shell census is lying
> about it.** No control byte other than TAB / LF / CR; a NUL separator is
> spelled `"\0"`. And a filing that names an ABSENCE ("mounted nowhere",
> "zero callers") is checked with a second instrument before it becomes a
> decision — a grep's silence is not evidence.

Three rules it earned:

- **The runtime string is identical either way**, so the fix is a four-file
  byte swap with no behavioural change — and a census, because the next
  `join("\0")` typed as a byte is one keystroke away.
- **Every prior suite drove ONE piece.** `sidecar-watcher.test.ts` the poller,
  `usePersistentState.test.tsx` the consumer on a HAND-DISPATCHED event,
  `disk-watcher-multidoc.test.tsx` the provider with the watcher MOCKED OUT —
  so "an external sidecar edit re-hydrates the panel" was pinned by nothing,
  and a filing claiming it could not happen had no leg to contradict it.
- **The decision that was routed is RECORDED as moot, not silently closed.**
  Gabriel's "MOUNT it" ruling described the tree as it already stood; 220's
  "The sidecar half" was true the whole time.

CI: [source-text-hygiene.test.ts](../../../src/__tests__/source-text-hygiene.test.ts)
sweeps every tracked text file (population from `git ls-files`, allowlist
EMPTY) for a control byte, naming the file and line; measured, it fails on any
one of the four pre-432 files. [sidecar-watcher-wiring.test.tsx](../../../src/components/editor-layout/contexts/__tests__/sidecar-watcher-wiring.test.tsx)
drives the REAL provider → REAL `createSidecarWatcher` → REAL
`usePersistentState` over a fake disk with real mtimes: an out-of-band write
re-hydrates on the next poll with no hand-dispatched event, and a removal
empties the panel. Measured by neutering the provider's `start()`: 2 legs fail.

### The other-writer half: the AI is a PEN-HOLDER, and the app honours the pen

Same path, the writer the lock cannot reach (task 489). Gabriel: *"When Virgil
is editing from cowork, can it flip a switch that makes the doc read only (with
some loud indicator to show what is hapenning?). i feel like this might help
with conlifcted copies too — i think they may be creeping in when cowork
edits."*

The mechanism existed and the app could see half of it. `/editor/*` skills have
committed **under the pen** since the apply_response chip shipped —
`_common.commit_under_pen` is acquire → atomic write → release — and that
acquire writes the pen in TWO places: `.virgil/pen-context.json` **always**
(holder `"claude"`, carrying an `expires_at` ≈ +30 s so a crashed skill cannot
wedge the lock), and `virgil/collab.json`'s `pen` **only if that file already
exists** (holder `"Claude"`, `enabled` flipped true for the duration). The app
read only the second, and only while `sidecar.enabled` — i.e. only on a paper
the user had already turned collaborator mode on for. On the ordinary SOLO
paper the skill's pen meant nothing to the UI at all: the user kept typing while
the skill spliced the `.tex`, and the 1500 ms autosave then raced the skill's
write. Two writers, one folder, a sync daemon watching — which is the
conflicted-copy seed the 363/415 cluster narrowed from the Virgil side and could
not close from the cowork side.

> **"Who holds this document's pen right now?" is ONE question with ONE answer,
> resolved by [cowork-pen.ts](../../../src/lib/cowork-pen.ts) from every record that can
> carry it.** The two on-disk records are two RUNGS of one ladder, not two
> facts: the pen-context record (always written, self-expiring) first, the
> collab sidecar's pen second. Every consumer — the read-only gate
> (`canEditMainText`), the autosave pause, the topbar banner, the save-state
> reason — reads the answer there.

Seven rules it earned:

- **No new file, and no skill-side change at all.** The obvious alternative was
  to make `acquire_pen` CREATE `collab.json` on a solo paper, so the one record
  the app already polled would always carry the answer. Declined for the reason
  this whole report is about: that is a file created and then rewritten in the
  user's synced folder on EVERY commit — new write traffic in exactly the folder
  whose write traffic tasks 363 and 415 spent two passes reducing. Reading a
  record the skill already writes unconditionally costs nothing, and it is the
  record that carries the TTL.
- **Fail toward RELEASING.** Every unreadable, unparseable, foreign-holder or
  over-aged record resolves to "no pen held", and a far-future `expires_at`
  (clock skew, a hand-edited file, a future skill with a longer TTL) is CLAMPED
  to the app's own `COWORK_PEN_MAX_AGE_MS`. The asymmetry is the opposite of the
  preservation gate's and is deliberate: a document wedged read-only behind a
  banner nobody can dismiss is worse than a brief window in which the user could
  have typed over a commit, because that commit is atomic and sub-second and the
  disk-side gates (the doc lock, the byte-equality gate, the clobber guard)
  still stand behind it.
- **The AI's staleness window is SHORT, and that is derived rather than
  borrowed.** `COLLAB_TIMINGS.penStaleMs` is 5 minutes because a HUMAN holder
  heartbeats and can be asked to hand over; the AI never heartbeats — its whole
  hold is one atomic commit — so its `lastHeartbeat` is frozen at the acquire
  and a 5-minute window would leave a crashed skill holding the paper for five
  minutes. 60 s: double the skill's own 30 s TTL, so honest clock skew cannot
  release a live pen.
- **ONE pause door, and it returns the REASON.** Pre-489 every call site asked
  `shouldPauseAutosave(watcher)` and hard-coded `noteSaveBlocked(docId,
  "conflict")` on the next line — four copies of one mapping, and the shape in
  which a second pause SOURCE gets a wrong voice on the save-state channel.
  `autosavePauseReason(watcher, docId)` answers `"cowork" | "conflict" | null`
  and the caller quotes it. **`cowork` outranks `conflict` while the pen is
  held**, and the ordering is the honest one rather than a preference: the two
  routinely coincide (a skill's own write IS the kind of external change the
  watcher detects), and while the pen is held the transient, self-clearing
  statement is the truer thing to say — the standing conflict is still there to
  say once it releases.
- **The cowork rung is keyed on `docId`, so it reaches a WARM pane.** The
  watcher is null for every doc but the ACTIVE one (multi-doc keep-alive), so a
  skill committing against a background paper had no way to pause that paper's
  autosave through the conflict rung at all.
- **The banner is a WARNING, not an alarm, and it BREATHES.** Nothing here is
  destructive or even wrong (STYLE_GUIDE → "the destructive / alarm family": a
  merely unexpected state takes the warm family), so it is amber; what makes it
  loud is that it is present, that it names the cause, and that it is the only
  badge in the bar reporting something happening RIGHT NOW rather than something
  that has happened. It sits BEFORE the `topbarRightCollapsed` gate with the
  four data-integrity badges — a notice explaining why the editor stopped
  accepting your typing must not be hideable by a layout preference — and offers
  no dismiss, because a dismiss would hide the explanation while the read-only
  posture stood.
- **Poll latency is STATED rather than engineered around.** The signal rides
  `useCollab`'s existing 5 s clock, so a fast commit can begin and end between
  two polls and the UI never notices. Accepted: the window this closes is not
  the sub-second commit, it is the SESSION — a skill drafts, splices, drafts
  again, and a user typing through it never learns that anything else is holding
  the file.

CI: [cowork-pen.test.ts](../../../src/lib/__tests__/cowork-pen.test.ts) (both rungs, the
ladder, the store's idempotence, the save-state reason, the CENSUS, and the
PARITY leg against `editor/scripts/_common.py` — Python cannot import the TS
vocabulary, so a rename on either side is otherwise silent: the skill keeps
taking a pen the app stops recognising and the document stops going read-only
with nothing failing anywhere), [cowork-pen-wiring.test.tsx](../../../src/hooks/__tests__/cowork-pen-wiring.test.tsx)
(the REAL `useCollab` + REAL `useDocument` over a fake disk — the half no test of
the authority can see) and [cowork-pen-badge.test.tsx](../../../src/components/__tests__/cowork-pen-badge.test.tsx)
(WHICH WORDS reach the user, a render fact). **No pre-489 suite could see any of
this**: there is no `useCollab` suite in the repo at all,
`autosave-pause.test.ts` drove the watcher alone (a boolean with no document in
it, so a per-document pause source is unrepresentable in it), and the save-state
suites sweep `UnsavedBlockReason` — a union `"cowork"` was not a member of. The
leg with teeth is the CENSUS: the ladder was never the part that could
misbehave, a consumer that re-derives "is the AI editing?" from a hand-spelled
holder string is (`pen.holder === "Claude"` type-checks perfectly), and so is a
write door that hard-codes its own pause reason. Allowlists EMPTY. Measured by
neutering each half in turn: the pre-489 collab-only gate takes 3 legs (2
wiring + the census), the hard-coded `"conflict"` mapping 3 (2 wiring + the
census), and a badge moved inside the collapse gate 1.

**Owed, not claimed:** the real end-to-end eyeball — run an `/editor/*` skill
against a real paper with the doc open and watch the banner appear, typing get
refused, the save badge name the reason, and everything release. That is the
FSA-masked class twice over (real File System Access AND a real out-of-process
skill), so the durable proof here is the unit contracts.

**Residual, stated.** The pen is held for the COMMIT, not for the skill's
thinking phase, so a long drafting session shows nothing until the write lands.
Widening that means the skill holding the pen across its whole run — a
skill-side design change with its own crash-recovery question (a 30 s TTL is
right for a sub-second hold and wrong for a five-minute one), routed rather than
made here.

#### The release half: a teardown that needs a capability the transport may not grant

Same pen, the other edge (task 496) — and the case where the app-side posture
was written down (*"fail toward RELEASING"*, `cowork-pen.ts`) and the skill-side
teardown did the opposite: it required a DELETE.

`release_pen` ended every skill commit by removing `.virgil/pen-context.json`,
and it did so through `atomic_write`'s write-set, whose `content is None` arm
was a bare `os.remove`. A cloud (Dropbox) mount refuses `unlink` on a file it
will happily let you REWRITE — the reported machine — and the raise then
cascaded three ways, only the last of which the report could see:

- **The collab restore was ROLLED BACK.** The release's own restore of
  `collab.json` had already committed when the delete threw, so `atomic_write`'s
  rollback rewrote it to the ACQUIRE-time state: `enabled: true`, pen held by
  Claude. Past the app's 60 s pen-context ceiling `canEditMainText` is still
  false, because rung 2 reads `sidecar.enabled` — **the paper is wedged
  read-only**, recoverable only through the 5-minute take-the-pen affordance.
  And the next `acquire_pen` snapshots the poisoned state as its own
  `prior_pen` / `prior_collab_enabled`, so even a later SUCCESSFUL release
  restores a locked collab: sticky across runs.
- **A durable write reported failure.** The exception escaped
  `commit_under_pen`'s unguarded `finally` and was caught only at the CLI top
  (`die` → exit 2), so the result JSON was never printed although the whole
  write-set — `.tex`, sidecars, version bump — was already on disk. The calling
  skill reads that as a failed writeback: **a double-apply retry hazard on a
  write that already landed.**
- **The stale pen file was the CHEAP third.** It self-expires in ≤60 s app-side
  and `acquire_pen` never reads it. That harmless third is what the report saw.

> **A DELETE is the one filesystem capability a transport may not grant, and
> every delete in these two silos is CLEANUP — a `.tmp` sibling, a retired lock,
> a superseded `.done`, a spent temp file. So a refusal is a TIDINESS failure,
> never a correctness one, and no delete may raise out of the operation it
> cleans up for. And a release RELEASES BY REWRITE: a `holder: null` record,
> not an absent file.**

Two halves — `unlink_tolerant` / `rmtree_tolerant`
([_common.py](../../../editor/scripts/_common.py), mirrored in
[_tools.py](../../../library/scripts/_tools.py)), and the released record. Seven rules
they earned:

- **Release by REWRITE is strictly better than delete-then-TTL, not merely
  safer.** `coworkPenFromContext` bails on a non-cowork holder BEFORE any clock
  arithmetic, so a `holder: null` record reads as released **instantly** — where
  a delete leaves the 60 s window in which a released pen still reads as live.
  The safety property comes free with a UX improvement.
- **…and it costs the sync daemon nothing**, which is what made it available at
  all. A delete is already one filesystem event; an ~80-byte rewrite of a
  `.virgil/` file is one too (the write-traffic doctrine, tasks 363/415). This is
  precisely the trade task 489 DECLINED for `collab.json` — fabricating that file
  on a solo paper would have been NEW traffic in the folder whose traffic those
  two passes spent themselves reducing.
- **The two halves are independently sufficient for the reported symptom, and
  both ship anyway.** The rewrite removes the delete, so nothing can throw after
  the collab restore commits; the tolerant unlink swallows a refusal one layer
  down. Keeping only one leaves the other's class live — (1) alone leaves the
  exit-code hazard for every OTHER release-time IO error, and the `finally` wrap
  alone leaves the rollback latch, since the raise fires INSIDE `atomic_write`
  and undoes the restore before any caller can see it.
- **…which is exactly why the wrap needs its OWN leg.** With both halves in
  place the wrap has nothing observable to do, so it is deletable in silence —
  the shape "The tag half" records one subsystem over. The leg makes
  `release_pen` itself raise (`ENOSPC` on the collab restore) and requires the
  commit to return normally with its result printed.
- **The warning goes to STDERR.** Stdout carries the writeback-contract JSON,
  and a warning there would corrupt the very contract this protects.
- **A released record carries NOTHING from the acquire.** Its `prior_*` snapshot
  has just been spent; keeping it would let a later release re-restore a collab
  state the user has since changed. Releasing an already-released record is a
  no-op — no second filesystem event.
- **`_mark_done`'s unlink is tidiness, and saying so is what makes tolerating it
  correct.** The `.done` sibling WRITE is what retires a queue entry
  (`_list_pending` skips a queue file whose same-kind `.done` exists), so a
  refused unlink leaves an inert file behind rather than the infinite re-drain a
  glance at the site suggests. Stated at the site, because the tolerant answer
  is only right given that fact.

**The helper is MIRRORED, not shared, and that is a constraint rather than a
preference:** the two script trees ship as independent skill bundles synced into
a paper folder and a library folder, so neither may import the other. What holds
them together is a byte-identity PARITY leg over a marker-delimited block — the
instrument the preservation measure and the marker census already use for code
they cannot reach.

**Two exemptions, each scoped to the shape it justifies** (task 204's rule) and
each carrying an in-place `unlink-exempt:` marker: `sync_skills.py` is the bundle
BOOTSTRAP and is deliberately import-free — it must not depend on `_common.py`,
which is one of the files it is replacing; and `triage_apply.py`'s source-`.bib`
disposition has a STRONGER policy than the helper's warning, reporting a refusal
to the library's own inbox, which routing it through the helper would downgrade.
The census verifies an exempt site is genuinely hand-tolerant (a `try` whose
`except` does not re-raise), so the marker cannot become a standing licence.

CI: [test_unlink_tolerant.py](../../../editor/scripts/tests/test_unlink_tolerant.py) and
its [library twin](../../../library/scripts/tests/test_unlink_tolerant.py), each wrapped
by a vitest leg so `npm test` has teeth on them (nothing in CI runs the library's
python at all). **No pre-496 suite could see any of this**: every pen fixture in
the repo asserts released-ness as *the file is GONE*, in nine places across six
suites, so a delete that FAILS is unrepresentable in all of them — and four of
those legs were pinning the defect as the contract. They are renegotiated in
place with the reason at the site, onto ONE predicate
([_pen_state.py](../../../editor/scripts/tests/_pen_state.py): absent OR `holder: null`),
which a census then keeps from being re-forked. The leg with teeth is the CENSUS:
the helper was never the part that could misbehave, a delete site that never asks
it is, and it runs perfectly until the day the mount says no — so every raw
delete verb in either silo is inside the helper or carries a marker, allowlist
otherwise EMPTY. Measured by neutering each half in turn: the pre-496 delete
release takes 7 editor legs plus `test_pen_atomic` plus a `cowork-pen` parity
leg, the unguarded `finally` 2 plus a parity leg, the raw `os.remove` in
`atomic_write`'s content-None arm 4, a drifted mirror block 1, a new raw delete
site 1 per silo, and `_mark_done`'s raw unlink 2.

**Owed, not claimed:** a real cowork-session run on the reporting machine — one
skill commit there should exit 0 with a result JSON and no pen warning left
behind. The trigger environment (a cloud workspace's Dropbox mount) cannot be
reproduced locally; the monkeypatched `PermissionError` is the delete-blocked
mount in miniature and is the durable proof.

**Residual, stated.** The pen record now PERSISTS between commits rather than
appearing and vanishing, so a paper folder carries one small `.virgil/`
file it did not before. Inert by construction — the app's ladder reads
`holder: null` as no hold, `acquire_pen` overwrites it unconditionally, and
nothing else reads it.

### The front-end half: one derivation, one voice, one guided surface

Same path, the half the user meets (task 545). Every gate above SAYS SO in one
vocabulary (392), and each still said it from its own pill in its own register:
"Changed on disk · unsaved edits", "Not saving — the file changed on disk",
"Virgil is editing this paper…". Gabriel: *"Right now it just suddenly says
'changed on disk', and it's not clear if you should save, reload, close — or
what?"* — and, on the cowork hold, *"there should be its own front end."*

> **A state that interrupts the document is DERIVED once
> ([document-interruption.ts](../../../src/lib/document-interruption.ts)) — what
> happened, naming the WRITER where the app can; what Virgil is doing about
> it; ONE recommended action phrased as an OUTCOME; the alternatives behind
> it — and rendered by ONE guided surface inside the paper's card
> ([DocumentInterruptionBanner](../../../src/components/DocumentInterruptionBanner.tsx)).
> The doors are untouched; the vocabulary decides only which door to point at
> and what to call it.**

Five rules it earned:

- **The writer is READ OFF THE PEN'S RELEASE TRACE, never guessed.** Task 489's
  own residual: the AI holds the pen for the COMMIT only, so after release
  "the standing conflict is still there to say" — and it said "another app or
  a sync service", which for the AI's own write is untrue and alarming. Task
  496 rewrote the released record as `{ holder: null, released_at }` and the
  app read it as merely "no hold". `coworkPenReleaseFromContext` keeps the
  time, the poller publishes it (`noteCoworkPenRelease`, monotonic per doc;
  a SEEN hold whose record vanishes is estimated at the poll that saw it go),
  and `attributeExternalWriter` answers from the DiskWatcher's `detectedAt`:
  the AI while the pen is held, or for a release within 2 minutes BEFORE the
  detection (the watcher pauses while the tab is hidden) or 30 s AFTER it
  (the 5 s pen poll lags the 3 s watcher). Everything else is `unknown`,
  which fails toward the pre-545 copy rather than toward naming the AI for a
  write it did not make. Stated limit: a daemon writing inside that window is
  misattributed, which is why the provenance log records both times.
- **The COPY branches; the DOORS do not.** `resolveConflict`, the reload path,
  `acknowledge()`, the preservation badge's own danger confirm (reached
  through task 392's `requestBlockingFlow`, so which dialog a reason leads to
  is still decided in `describeBlockReason`), and `requestSaveNow` are the
  same four doors, netted exactly as before. What changes is what the button
  SAYS and which one is accented.
- **"The answer is always my copy" is a REPORT, not a standing order.**
  Nothing auto-resolves. The recommendation follows what each door COSTS: an
  unknown-writer conflict recommends the user's version (the disk side is
  archived first); an AI-attributed conflict recommends the AI's edits while
  the unsaved work is under `UNSAVED_WARN_MS` — a few keystrokes the debounce
  had not landed — and the user's own version once it is real writing; a
  change with nothing unsaved recommends loading it, because it costs nothing.
  Whether an AI-attributed change with NOTHING unsaved should load itself is
  the one fork found and routed rather than decided.
- **The cowork hold has its own identity, and it is LOUD without being red.**
  The `live` tone (warm family, the breathing glyph) plus a VEIL: the band
  stamps `data-doc-interruption` on `.editor-pane-root` from the SAME view it
  renders, and `globals.css` dims the prose to 0.55 (opacity only, composite-
  only) with a `progress` cursor — legible, because the user may keep reading.
  No "collaborator" vocabulary anywhere the hold speaks, pinned by a leg.
- **The pills keep their chrome and lose their private sentences.** The
  external-change and cowork pills read `interruptionPillLabel` and the shared
  `conflictOutcomeNotice`, so a pill, its kebab detail and the band name one
  event with one phrase — the surgical alternative (reword the badges) was the
  "furniture" failure the report already describes.

**Provenance, because member 1 cannot be answered from code.** Two hypotheses
fit the recurring keep-mine prompts: the AI's own `.tex` commit (every skill
write is UNLEDGERED, so the hash confirm always says "genuine external
change" — accept-suggestion, a footnote/citation card, style-merge, and any
`.bib` write all reach the badge; a note/todo/report card touches sidecars
only and does not), or a sync daemon landing DIFFERENT bytes (a same-bytes
re-sync is filtered and re-baselined; the 2026-08-19 revert was this shape).
[interruption-log.ts](../../../src/lib/interruption-log.ts) records each presentation
with its verdict AND the two times it was derived from, at
`window.__interruptionStats()` — the recipe is in the task file.

CI: [document-interruption.test.ts](../../../src/lib/__tests__/document-interruption.test.ts)
(the words per state, the priority ladder, the attribution windows, the
release trace, the pill/band agreement) and
[document-interruption-banner.test.tsx](../../../src/components/__tests__/document-interruption-banner.test.tsx)
(the REAL band over the REAL stores: the veil stamp, which door each button
enters, the alert role, the routed review, the reported net failure). The leg
with teeth is the CENSUS: the band sits under the chrome header and above the
pod, both pills spell `interruptionPillLabel`, the hold's copy never says
"collaborator", the veil is keyed on the stamp, and the band spells no flow
literal of its own. **No pre-545 suite could see the class**: each badge suite
drives ONE channel and asserts its own phrase, and none could ask who WROTE
the bytes, because nothing recorded the pen's release.

**Owed, not claimed:** the real-machine eyeball. Conflict and cowork are the
FSA-masked class twice over (real File System Access AND a real
out-of-process skill): run an `/editor/*` skill that writes the `.tex`
against an open paper, watch the veil and the band appear, and — after
release — the band name Virgil's AI rather than "another app".

### The permit half: a permit granted at one layer and revoked BLIND at another is two policies

Same path, the READ-MOSTLY host (task 556). The Library Reader mounts a paper
as a `library-paper:<citekey>` doc under `READER_CHROME`, whose
`editableCardKinds: ["note"]` exists so a user can annotate while reading —
and the chrome-side permit that whitelist fed (`isSidecarWriteAllowed`, asked
by `usePersistentState` before every disk write) said YES to `notes.json`. One
layer below, BOTH storage backends' write funnels asked a strictly stronger,
blind question — `docId.startsWith("library-paper:")` — and refused EVERY
write for such a doc. So a note written in the Reader looked saved and was
never written: no error, no badge, no console line, gone on the next paper
switch. The permit was dead in production (every write it granted was refused
one layer down), `hasMutatedRef` was stamped for a write that never landed
(the hazard its own comment names), and three files said the Reader persists
nothing while two said notes are the one thing it persists.

> **The set of sidecars a `library-paper:` doc may write is DERIVED — once,
> in [host-writability.ts](../../../src/lib/host-writability.ts) — from the Reader
> chrome's `editableCardKinds` through the card-kind → sidecar map, and the
> storage funnels ask THAT rather than the docId prefix.** Change
> `READER_EDITABLE_CARD_KINDS` and the UI permit and the storage funnel move
> TOGETHER. The `.tex`, the bundle, the bib, the PDF, the figure writers and
> every other sidecar are refused exactly as before: those are the library's
> own artifacts.

Five rules it earned:

- **Hoist the ANSWER, not the React dependency.** The backends cannot import
  the chrome config, so the derivation lives in an import-free leaf (the
  `latex-markers.ts` / `node-attr-sets.ts` placement rule) and
  `chrome-config.ts` READS it — `READER_CHROME.editableCardKinds` IS the leaf's
  constant, never a literal of its own, and `CARD_KIND_SIDECAR` left the
  chrome file for the leaf.
- **The FSA funnel asks over its SUBKEY, so it needs no filename parse of its
  own.** A sidecar write's subkey is spelled through `sidecarWriteSubkey` by
  both doors, the funnel recognises `virgil/<file>` (one segment, no deeper
  path — a figure raster is `virgil/figures-cache/…` and is not a sidecar) and
  answers from the derived set; `"bundle"`, `"pdf"`, the bib and the cleanup
  keys answer `false` by construction.
- **A whitelist makes the host read-mostly at BOTH layers.** The pre-556
  permit answered "always allowed" for a NON-card sidecar under a whitelist
  ("out of scope for this card guard") while the funnel refused them all — the
  same disagreement one file over. The Reader's view state is session-only by
  design and a paper's settings belong to the library, so both layers now say
  NO; the effective behaviour is unchanged and the `hasMutatedRef` stamp is
  honest, since it is never set for a write the layer below would refuse.
- **The docId vocabulary is spelled ONCE.** The prefix lived in both backends
  and both Reader components (`ReaderLRU`'s copy carried a "MUST match" note);
  it is minted and parsed through the leaf now, so the id the Reader mounts and
  the id the funnel gates are one string because there is one speller.
- **The two doors DIFFER on the receipt question and that is preserved.** The
  bundle and the PDF answer `read-only` / `skipped` EXPLICITLY before the
  funnel (task 557's rule — the funnel's `undefined as T` is a lie a receipt
  door cannot afford); the sidecar door still rides the funnel because its
  callers are void.

CI: [reader-writability.test.ts](../../../src/lib/__tests__/reader-writability.test.ts)
drives BOTH real backends against a fake paper folder (a note LANDS in
`virgil/notes.json`; the `.tex`, the bundle, the bib, the PDF and a non-note
sidecar are still refused; a normal doc writes everything), sweeps the
AGREEMENT of the two layers over every sidecar the app knows, and carries the
CENSUS — the derivation was never the part that could misbehave, a second blind
prefix test in front of a sidecar door is, and so is a Reader component minting
the prefix by hand (allowlists EMPTY).
[useNotes-reader-persist.test.tsx](../../../src/hooks/__tests__/useNotes-reader-persist.test.tsx)
is the end-to-end leg: the REAL `useNotes` under the REAL `READER_CHROME`
through the REAL `usePersistentState` and the REAL dev backend. **No pre-556
suite could see this**: `usePersistentState.test.tsx` mocks the storage barrel
(so the permit was the only guard it could see) and every backend suite drives
the funnel with a hand-built handle (so the chrome was the part it could not
see) — the defect lived in the gap between the two. Its harness note is worth
carrying forward: the dev backend's own graph imports the barrel, so
`importActual` inside the barrel mock is a cycle vitest refuses; the mock is a
lazy Proxy with a `has` trap instead. Measured by neutering each way: the
blanket refusal takes 8 legs, a funnel opened wide 8 (the controls). The
`library-paper-write-guard` and `sidecar-write-guard` legs that pinned the
defect as the contract are RENEGOTIATED in place with the reason at the site.

**Owed, not claimed:** a real-FSA eyeball. The Reader needs a mounted library
folder and a real paper (the FSA-masked class), so the durable proof is the
unit contract — open a paper in the Reader, add a note, switch papers, come
back.

### The acknowledgment half: "Save anyway" is a WRITE, and the flag it flips rests on the RECEIPT

Same path, the two doors the 557 sweep did not reach (task 567, an audit
finding). 557's law — *the report is the permission; a write is known to have
landed only by the door's receipt, never by a flag* — was applied to `save`
and left standing at the two places that consumed `save` and still decided on
the NOTICE flag:

- **"Save anyway" was not a save.** The badge's danger confirm promised that
  *saving will write the version you see in the editor over the file on disk*,
  then called `acknowledgePreservationNotice` and nothing else. No write was
  requested, and there was no retry to inherit: a refusal has already disarmed
  the debounce (`debouncedSave` nulls the handle before `save` runs, and `save`
  does not re-arm on a refused receipt — the `storage-fsa` comment claiming
  "the autosave retries every 1500 ms while the notice stands" was stale
  prose, corrected at all three sites). So the pill vanished, the file stayed
  stale until the next keystroke, and the SAVE badge — cleared only by a
  landed write — went on saying *"Not saving … Review…"* over a document whose
  next plain Save (the gate having stepped aside) would silently overwrite the
  file: a door labelled "review" with the effect "overwrite", one gesture
  after a dialog that said the overwrite had happened.
- **`restoreFromMirror` read `isWriteProtected` after `save()`.** `save`
  swallows a THROWN write (a revoked permission, quota, a stale pipeline) into
  `noteSaveBlocked("error")` and returns normally, so the flag was false, the
  restore refetched, and it DELETED the mirror and the recovery offer for a
  write that never landed — the recovered model gone from the badge,
  recoverable only by hand from `virgil/.history/`. The 557 census's flag
  needle was scoped to `save`'s declaration, so this read was invisible to it.

> **`save` RETURNS its receipt, and every door that states a verdict reads
> it.** `SaveReceipt` is the door's own `DocWriteReceipt` plus the one outcome
> the door cannot report because it never returned — the caught throw, handed
> back as `error` beside its channel publish. **And the "Save anyway"
> acknowledgment is a CLAIM the write carries, recorded on the LANDED receipt
> and nowhere else** — `DocWriteOptions.acknowledgePreservation`, the exact
> twin of task 364's `userResolvedConflict`, stepping the write-side words
> gate aside for that ONE write in both backends.

Six rules it earned:

- **Acknowledge-then-write is the wrong ORDER, and the reason is the gate's own
  shape.** `checkWriteAgainstRetained` steps aside on `isPreservationAcknowledged`,
  so the obvious fix (acknowledge, THEN ask the manual door) records the user's
  choice before any write has been attempted — and a write that then cannot
  land (a conflict pause, a throw) leaves the notice hidden behind an
  acknowledgment it never honoured, the pill gone and the save badge carrying a
  state the user has no surface for. Carrying the acknowledgment AS the write's
  claim inverts that: the gate steps aside for the claim, and `save` records
  the acknowledgment only when the receipt says landed. A refused, thrown or
  dropped write leaves the notice STANDING, unacknowledged, its pill up — which
  is the honest state, since the file the user agreed to overwrite has not been
  overwritten.
- **The claim rides the manual-save DOOR, not a private write.** The door is
  what respects the clobber guard: a document can be BOTH refused and
  conflicted, and the 364 pause is decided before the door is asked, so the
  claim never reaches the write and the badge ROUTES to the conflict flow (the
  392 rule) — which must be answered first. `SaveDoor` takes
  `SaveRequestOptions`; `requestSaveNow(docId, opts)` threads it.
- **The serializer gate is NOT stepped aside**, and the byte-equality gate is
  untouched: the claim is about the WORDS gate, whose refusal the user has been
  shown and has answered. A serialize refusal produces no bytes and has nothing
  to save anyway (the badge withholds the row for that source).
- **The option bag is spelled ONCE.** `DocWriteOptions` in `storage-types.ts`
  — both backends and `save` used to declare it inline, three copies of one
  shape, and a third claim is what makes a fourth copy one too many.
- **The manual door's channel read was a proxy that HAPPENED to agree, and it
  goes too.** `saveNowRequested` answered `!hasUnlandedWork` / the channel's
  reason after its await, and on every path today that agrees with the receipt
  (`noteSaveLanded` clears the channel; a throw arms it) — stated rather than
  dressed as a defect. It is replaced because it is the same SHAPE whose two
  siblings did not agree, and a door that states a verdict reads the receipt of
  the write it asked for. The channel survives in that door only on the
  no-model arm, BEFORE any attempt, where there is no receipt to read and the
  channel is the only witness. (Found in passing, routed rather than fixed: a
  keystroke landing DURING an in-flight write is cleared by that write's
  `noteSaveLanded`, so the channel under-reports it for the 1500 ms until the
  debounce lands it — a fact about the channel, not about any door.)
- **The census asks the whole hook, and it asks the flag's WRITER too.**
  `isWriteProtected(` may appear nowhere in `useDocument.ts` (no save caller
  has a reason to read it); the three verdict doors must assign `const receipt
  = await save(` and read `.landed` with no channel proxy after the attempt;
  and `acknowledgePreservationNotice(` has exactly two production sites — the
  store's declaration and `save`'s landed branch, guarded by the claim.

CI: the 567 describes in
[useDocument.mirror-receipt.test.ts](../../../src/hooks/__tests__/useDocument.mirror-receipt.test.ts)
drive the REAL hook against the REAL notice store — a refused document is
WRITTEN by the claim, lands, and only then reads acknowledged with the
save-state tier clean; a claim whose write throws leaves the notice standing;
a plain Save on a refused document is refused again; and a restore whose write
throws (or is refused) returns `false` with the mirror slot and the offer
intact, beside the landed control. **No pre-567 suite could see either
member**: every "Save anyway" leg asserted the PILL went away (which the flag
flip satisfied perfectly), and every restore fixture handed the hook a door
that landed. [useDocument.manual-save.test.ts](../../../src/hooks/__tests__/useDocument.manual-save.test.ts)
pins the claim at the door (it writes, it records nothing on a throw, it never
walks past the clobber guard, an ordinary Save carries none) and the
keystroke-during-write leg; [preservation-notice-badge.test.tsx](../../../src/components/__tests__/preservation-notice-badge.test.tsx)
pins what the gesture HANDS the door and how it routes. The census legs live in
[mirror-evidence-census.test.ts](../../../src/lib/__tests__/mirror-evidence-census.test.ts);
`preservation-refusal-posture`'s "no plain DISMISS" leg is RENEGOTIATED in
place with the reason at the site — it required the badge to spell the very
call that was the defect.

**Residual, stated.** A SERIALIZE refusal arriving on a document whose LOAD
refusal the user has already acknowledged is dropped by
`recordPreservationRefusal` (the user made the call), so the save badge's
"Review…" routes to a pill that renders nothing for an acknowledged notice —
the pre-567 dead end, untouched here because it is a decision about what a
later refusal of a DIFFERENT kind may re-arm. And the retry prose was wrong in
three places, not one: every later write is refused again while a notice
stands (the next keystroke's autosave, a mint flush, a manual save), and a
refusal disarms the debounce, so there is no 1500 ms clock.

**Owed, not claimed:** the real-FSA eyeball. A load refusal needs a lossy
`.tex`, which is the FSA-masked class — acknowledge from the pill, and watch
the save badge clear on that same gesture.

### The stash half: a PAYLOAD is consumed by the write that LANDS it, never by the attempt

Same door, the one obligation 557 and 567 left in a REF (task 568, an audit
finding). The code-pane preamble lives in the bridge closure and never in the
TipTap doc, so when the pane flushes a preamble edit, `pendingDelimitersRef`
is by its own comment *the ONLY durable copy until a write lands* — the bridge
clears its own `pendingPersist` BEFORE calling the persist callback, and keeps
rendering the pane from the edited preamble, so a lost stash is a MASKED loss.
Every save path SPENT it up front: `takeDelimitersOpts` nulled the ref and
handed the payload to `save`, from eight call sites, and `save` never put it
back. A write then refused by the preservation gate, thrown by FSA, or dropped
by a stale pipeline left the ref empty and the payload nowhere; the next
autosave carried no delimiters, `writeDocBundle` re-read the OLD preamble off
disk (its cache is stamped only after both gates, so refused delimiters never
reach it) and wrote it back, and nothing resynced the pane. Old preamble on
disk, new preamble on screen, forever. The live sequence is ordinary: a load
refusal standing, a preamble edit in the pane, refused, acknowledged, one
keystroke.

> **A payload is consumed by the write that LANDS it, never by the attempt** —
> the "report is the permission" law (357/364/557) read on a PAYLOAD instead
> of a flag. `save` composes the `delimiters` option ITSELF from the stash and
> clears it only on `receipt.landed`, for the very object it carried; no
> caller may hand it one (`SaveOpts` omits the key, so a spend at a call site
> is a compile error). ONE writer fills the stash (`saveWithDelimiters`, first
> statement, on every branch), ONE consumer empties it, and the only other
> clears are the two DISK-WINS paths (`refetch`, the tex-delimiters-changed
> listener), where replaying a stale stash would clobber the preamble those
> paths just wrote.

Four rules it earned:

- **Fill FIRST, then decide when to attempt.** Until 568 the unpaused branch
  of `saveWithDelimiters` nulled the stash and handed the payload to `save`,
  so the payload lived only inside a pending write and a refused one took it
  with it. The pause branch had stashed it correctly since task 364 — the
  attempt-time spend was invisible precisely because the one suite that drove
  the stash drove the PAUSE branch, where no attempt is made.
- **Consume by IDENTITY, not by presence.** A fresher payload stashed by a
  later `saveWithDelimiters` while an older write is still in flight must
  survive that older write's landing; a bare `= null` on the landed branch
  would drop it — the same defect one write later.
- **The channel is armed on the GESTURE, and the predicate reads the stash as
  a third rung.** A preamble edit in a ref is exactly the memory-only state
  the unsaved-work channel exists to name (392), so `noteUnsavedEdit` runs
  before any attempt; and `hasWorkToWrite` reads `pendingDelimitersRef` beside
  the debounce handle and the channel, because a landing elsewhere can clear
  the channel under a payload that has not landed (567's stated residual).
- **The surgical form was declined for the reason the class exists.** Re-stash
  in `save`'s refused arm and `catch` saves the same bytes and leaves eight
  call sites spending on the attempt, so the ninth forgets the rule. Retiring
  the spend door is what makes "the stash is the only copy" true by
  construction.

CI: [useDocument.delimiters-stash.test.ts](../../../src/hooks/__tests__/useDocument.delimiters-stash.test.ts)
drives the REAL hook over a fake door that refuses, throws or drops exactly
once and then lands, and asserts what the LANDING write carried — never the
rendered pane, which looked right the whole time. **No pre-568 suite could see
this**: `useDocument.autosave-pause.test.ts` stashes through the pause branch
and its door always lands. The leg with teeth is the CENSUS
([delimiters-stash-census.test.ts](../../../src/lib/__tests__/delimiters-stash-census.test.ts)):
one fill, one identity-guarded consume on the landed side, exactly two
disk-wins clears, `save` composing the option itself, the caller type omitting
the key, and the spend door retired in both silos. Measured by neutering the
consume back to attempt-time: 7 behavioural legs and 2 census legs fail.

**Residual, stated.** The emergency mirror stores only the TipTap model, so a
RELOAD during a standing stash loses the preamble edit — the same class one
door over, and closing it is a mirror-schema change (model + delimiters).

**Owed, not claimed:** the preview eyeball. NOT FSA-masked in dev storage with
a forced refusal: edit the preamble in the code pane while a preservation
notice stands, acknowledge, type one character, read the `.tex`.


### The load half: a reconcile that WRITES a sidecar runs over the sidecar AS LOADED

Same path, the moment BEFORE any gate above can see a write (task 570, an
audit finding) — and the case where the law was written in the primitive's
own docstring and the one caller that most needed it never asked.

`usePersistentState` hydrates a sidecar asynchronously; until the read
resolves, `state` is the EMPTY default, and the `loaded` docstring said so:
*"A load-only reconcile MUST gate on this: firing before the read resolves
would run over an empty card array and then never re-run."* `useCitations.
syncFromEditor` — the mount-time reconcile that re-derives every anchored
`CitationRef` from the editor's atoms — ran from an `EditorPane` effect keyed
on the editor ALONE, through bare `update()`. `update()` stamps
`hasMutatedRef`, and the loader bails on that stamp (correctly: a REAL user
mutation must not be stomped by a late read). Nothing orders the two: the
editor renders as soon as the `.tex` is parsed, while the citations read waits
on `Promise.all` over ~20 sidecar files. Whenever that batch lost the race —
a large `revisions.json`, a cloud placeholder, a small `.tex` — the merge ran
over EMPTY, the loader declined to populate, and 300 ms later `citations.json`
was WRITTEN with every unanchored / archived citation and the user's
`bibPackage` / `citationStyle` / `bibPath` gone. Silent, and won by disk
speed, which is why no fixture in the repo could see it: every one resolves
its read before it syncs.

> **A reconcile whose inputs come from somewhere OTHER than the sidecar it
> writes — the editor's atoms, a doc walk — enters ONE door,
> [`updateWhenLoaded`](../../../src/hooks/usePersistentState.ts): before the read
> resolves the derivation is HELD (latest wins, nothing written, the
> loader-stomp guard NOT stamped) and applied exactly once over the LOADED
> state; after it, the door is `update()`. A read-only consumer gates on
> `loaded`; a WRITING one cannot, because it also has to remember to re-run.**

Five rules it earned:

- **The hook owns the gate, not the caller.** The surgical fix — `if
  (!citationsHook.loaded) return` in the effect — closes the reported case and
  leaves the rule as a caller-side obligation: the effect would then have to
  RE-RUN on `loaded` (so it is keyed on two things, the second easy to
  forget), and the W2c resync policy calls the SAME `syncFromEditor` off the
  structural diff and would carry no gate at all. The `EditorPane` effect
  stays keyed on the editor alone, and the census pins that it carries no
  `.loaded` — a second copy of the rule is how the two copies come to
  disagree.
- **The hold reads a SYNCHRONOUS mirror, not the render flag.** The door may
  be called from an effect in the very commit the read resolved in, before
  React has re-rendered `loaded`; `loadedRef` answers from the read's own
  terminal branch. The apply rides the `loaded` EFFECT, one commit AFTER the
  loader's `setState`, so the derivation's `prev` is the sidecar as loaded.
- **A read that THREW applies to MEMORY only and writes nothing.** The panel
  reflects the editor; an automatic write of the default over a sidecar this
  session could not read would destroy whatever it holds — the write path's
  own law, arriving at its earliest door.
- **The loader-stomp guard is UNTOUCHED.** A genuine `update()` before the
  read still wins over disk, pinned as a control: the bail is right for the
  case it was written for, and the defect was a load-time reconcile pretending
  to be one.
- **Two dead reconciles of the same shape are DELETED, not gated.**
  `useExamples.syncFromEditor` and `useFootnotes.syncFromEditor` had no
  production caller since the 2026-05 keystroke-sanctity work (both panels
  derive their rows from the live editor) and no `loaded` gate of their own —
  one mount effect away from the citations defect, in a hook the door cannot
  reach. WIRE-it-or-DELETE-it (task 202); the two footnote legs that drove the
  dead path are RENEGOTIATED onto the live mirror write
  (`updateFootnoteContent`) with the reason at the site.

CI: [load-time-reconcile-door.test.tsx](../../../src/hooks/__tests__/load-time-reconcile-door.test.tsx)
drives the REAL door and the REAL `useCitations` over a read that is a
DEFERRED promise resolved by hand — the defect is an ORDER, and a
`mockResolvedValue` can only ever resolve first, which is the one shape every
pre-570 fixture has. The census
([load-time-reconcile-census.test.ts](../../../src/hooks/__tests__/load-time-reconcile-census.test.ts))
is the leg with teeth: the door was never the part that could misbehave, the
NEXT editor-derived reconcile written through bare `update()` / `persist()` /
`setState()` is, and it type-checks and renders perfectly — so every
production `syncFromEditor` declaration is an EXACT set whose bodies enter
the door and spell no bare write, the retired pair stays retired, the door
has one implementation, and the mount effect carries no caller gate.
Allowlists EMPTY. Measured by neutering each half in turn: the pre-570 bare
`update` takes the defect leg plus the census (2), a door with no hold 5.

**Owed, not claimed:** a real-FSA eyeball — a paper with a large
`revisions.json` and an archived citation, opened cold, the citation still in
the Archives view afterwards. FSA-masked (a race won by disk speed), so the
durable proof is the deferred-read contract.

**Found, not fixed:** `useExamples` and `useFootnotes` keep bespoke loaders
with NO loader-stomp guard at all — a user mutation before their read
resolves is overwritten by the late read (the opposite direction of this
defect). Pre-existing, not reachable from a load-time reconcile now that the
two are deleted, and closing it is a migration of both hooks onto
`usePersistentState` rather than a gate.

### The tone half: a state has ONE register, and a TIER is not a register

Same front end, the colour (task 571, an audit finding) — and the case where
task 545 decided the answer ONCE, in the vocabulary, and one of the five
registers it closed went on reading a table that was never written down.

`deriveDocumentInterruption` answers `tone` per KIND — `cowork-hold → live`,
`conflict → warning`, `preservation` / `save-error → danger` — and the band
painted it. The save badge read none of that: it painted `--danger-soft` for
`tier === "blocked"` with no branch on the reason, because
`describeBlockReason` carried `short / sentence / flow / action` and no tone,
so the badge had nothing else to ask. For ONE document in ONE state the band
and the cowork pill were amber (`CoworkPenBadge`, `ExternalChangeBadge`'s
conflict tier — task 364 dropped its red precisely because both doors are
netted) while the save pill beside them was red. And during a cowork hold the
badge offered "Try again": `saveNowRequested` answers `cowork` while the pen
is held, `requestBlockingFlow` finds no flow, and the badge re-reports the
hold — a RECORDED decision (task 489) that 545 overrode for the same state
with `recommended: null` ("the honest answer is to wait"), leaving two SSOTs
with the badge reading the older one. The band's own `paletteFor` was a
third copy of the palette, beside five pills each hand-spelling the tokens.

> **A kind has ONE tone and a tone has ONE palette, both stated in an
> import-free leaf every surface can reach
> ([interruption-tone.ts](../../../src/lib/interruption-tone.ts):
> `INTERRUPTION_TONE`, `TONE_PALETTE`, `paletteForTone`).** The vocabulary
> reads the table per kind; `describeBlockReason` gains a `tone` column read
> through the one reason → kind bridge it owns (`interruptionKindForReason`);
> and every surface that presents an interruption paints through
> `paletteForTone`. The tier says how LOUD, the reason says which COLOUR.

Five rules it earned:

- **The leaf is where it is because of the import graph.** `save-state.ts`
  sits BELOW `document-interruption.ts` (which imports `describeAge` and
  `UNSAVED_WARN_MS` from it), so a table only the upper module could reach
  would be re-copied by the lower one — which is exactly the fork this closes.
  The placement rule `latex-markers.ts` and `node-attr-sets.ts` each earned.
- **A pill about ONE kind asks for THAT kind, never for the top view.**
  `ExternalChangeBadge` reads `toneForInterruptionKind("conflict")` rather
  than `view.tone`: the view is the priority ladder's WINNER, and while a
  cowork hold or a refusal outranks the disk change the conflict pill is still
  about the disk change. Reading the winner's tone would paint it red under a
  standing refusal.
- **A surface about a state the leaf does not model names its TONE.**
  `MirrorRecoveryBadge` (a recovery offer, not an `InterruptionKind`) and the
  save badge's unsaved tier read `paletteForTone("warning")` — the register,
  not a token. Warm-family pills about something other than a document write
  (the sync-conflict folder report, a forest refusal) are NOT members and take
  the family from STYLE_GUIDE directly; making them look up a kind they have
  not got would be the wrong unification.
- **A reason with NO way out offers NO button.** `action` is `string | null`;
  the cowork hold's is `null`, and the badge renders nothing there — the
  pending tier's own rule ("a control which can only re-report the state is
  dead chrome"). 489's "Try again" was right for `error`, whose cause may have
  cleared, and wrong for a hold, whose resolution is the pen's own release.
  The escalation sentence still comes out past two minutes.
- **`live` and `warning` share tokens BY DESIGN**, pinned rather than
  tidied away: what separates the cowork hold is the breathing glyph, and
  STYLE_GUIDE reserves that for the ONE pill about something happening right
  now — the save badge does not pulse.

CI: the register legs in
[save-state-badge.test.tsx](../../../src/components/__tests__/save-state-badge.test.tsx)
read the SPECIFIED style (jsdom resolves no CSS vars, so a computed read
cannot tell `--amber-100` from `--danger-soft`) and assert the cowork hold
renders no button, escalated or not; the PARITY legs in
[document-interruption.test.ts](../../../src/lib/__tests__/document-interruption.test.ts)
pin, per reason, that the badge's tone IS the band's tone for the kind that
reason presents as, and that every palette token is a `var()` `globals.css`
defines. **No pre-571 suite asserted the badge's palette at all** — the badge
suite pinned tier attributes, text and button verbs, so a tier-derived colour
was unrepresentable in it. The leg with teeth is the CENSUS in
[save-state-census.test.ts](../../../src/lib/__tests__/save-state-census.test.ts):
the table was never the part that could misbehave, a surface that paints
without asking it is, and it type-checks and renders perfectly — so the
population is DISCOVERED (every production component that imports an
interruption / save-state vocabulary), no member may spell a `var(--danger`
/ `var(--amber` literal (allowlist EMPTY), the painters are an EXACT set with
the one non-painter (`SoftwareUpdateBanner`, sentence only) declared with its
reason, the map and the table each have ONE declaring file, no second
`case "live":` switch exists, and the badge reads `desc.tone`. Its literal
needles read `strip(…, true, true)`, because `codeOnly` blanks the very bytes
they grep for — the trap `_source-scan`'s own header records, and the fix's
own first cut walked into. `save-state-view.test.ts`'s "every reason has a
non-empty action" leg is RENEGOTIATED in place with the reason at the site:
it pinned the dead button as the contract. Measured by neutering each half in
turn: the tier-derived palette (`blocked ? "danger" : "warning"`, still
through the map) takes 2 badge legs + 1 census leg; the restored "Try again"
2 badge legs + 1 view leg — and NO census leg, stated because it is the
shape to remember: the census's `action !== null` needle reads the BADGE,
and this neuter is in the vocabulary, so the behavioural legs are the only
instrument that sees it; a pill re-spelling its tokens 2 census legs; the
band's private `paletteFor` switch restored 3 census legs.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked for the colour
(force a conflict in dev storage, or hold the pen): the band, the conflict
pill and the save pill must be one colour.

### The projection half: what the save READS may not be able to fail the save

> **A door the write path calls to obtain the document must return an EXACT model or nothing — and it must not do work the write did not ask for.** Anything extra it computes is a new way for the save to die, at a call site whose debounce is already disarmed.

Task 592. `getDocProducts(editor)?.ensureFresh().docJson ?? editor.getJSON()` is how all four write doors obtain the model ([useDocument.ts:669,696,750,870](../../../src/hooks/useDocument.ts)), and `ensureFresh()` used to run the doc-products pipeline's **idle** tier inline as well — `assembleLatex` + `computeCategoryCounts`, two whole-doc walks producing `sourceText` and `wordCounts` that no write door reads. Neither is inside `buildSourceText`'s fail-open catch, and the autosave call site has no `try`, so a serializer refusal in a projection the save did not need aborted the write with `saveTimerRef.current` already null: no `save(doc)`, no `noteSaveBlocked`, no mirror arm, no retry, no badge — the user keeps typing into a document that silently stopped saving. `ensureFresh` now refreshes Tier A alone and answers **exact or nothing**: `docJson: null` on a Tier A failure, which is exactly what makes the `?? editor.getJSON()` fallback in every caller reachable rather than decorative. The tier doctrine behind it lives in [keystroke-sanctity.md](keystroke-sanctity.md) → "The tier half".

### The index half: a shared value is edited in ONE transaction, never read … await … write

> **The paper index (and any other IndexedDB value several writers share) changes only through a door whose read and write are ONE readwrite transaction.** A hand-written `readIndex()` … `await` … `write` is a lost update waiting for a second writer — in the same window or another.

Task 601. The index is one IndexedDB value, and nine sites edited it by reading the whole list, awaiting something, and writing the whole list back. The most frequent writer is `touchDocTimestamp`, after every landed save; per-doc write queues never serialize it against an ADD for a different paper. So a background save that read the list before a folder registration wrote it, and wrote after, erased the new paper's row — and from then on `getDocMetaOrThrow` refused every read and write of that paper ("not in index"), and a reload dropped its tab. The same shape silently undid removals and duplicated a row for a double registration.

The door is `mutateIndex(fn)` in [doc-index.ts](../../../src/lib/doc-index.ts), built on idb-keyval `update`: the get and the put run in one readwrite transaction, which IndexedDB serializes against every other readwrite transaction on the store in every tab. `fn` is synchronous and edits the snapshot in place. Async work stays OUTSIDE it: `registerDocInFolder` stores the folder handle BEFORE the transaction (so no reader finds a row without a handle), finds-or-inserts INSIDE it, and on losing a race adopts the winner's row and deletes its own orphan handle. `writeIndex` is deleted, so the compiler is the first census; `readIndex` returns a fresh snapshot (the old shared `EMPTY_INDEX` default was mutated in place by `push`), and editing a snapshot changes nothing on disk. The windows registry (`touchWindow` / `forgetWindow`) takes the same `update` shape. `useMyPapers`'s whole-list `writeMyPapers` is a BLIND write from React state, not a read-modify-write — out of this door's scope, noted rather than fixed.

CI: [doc-index-mutation-door.test.ts](../../../src/lib/__tests__/doc-index-mutation-door.test.ts) — a fake store whose transactions read when they run; interleaved register-vs-access-bump, rename-vs-remove, and double-register legs; the fresh-snapshot leg; and a census (no `writeIndex` anywhere, `INDEX_KEY` written once, through `update`). Neutered against the pre-601 `doc-index.ts` + `storage-fsa.ts`: all six legs fail, the race legs with exactly the production symptoms (row lost, removal undone, two rows). **Owed, not claimed:** a real two-window eyeball (autosave in one, open a folder in the other).

### CI, and the limits stated rather than implied

Suites: [save-state-census](../../../src/lib/__tests__/save-state-census.test.ts),
[save-state-view](../../../src/lib/__tests__/save-state-view.test.ts),
[save-state-badge](../../../src/components/__tests__/save-state-badge.test.tsx),
[useDocument.manual-save](../../../src/hooks/__tests__/useDocument.manual-save.test.ts),
[useDocument.delimiters-stash](../../../src/hooks/__tests__/useDocument.delimiters-stash.test.ts),
[delimiters-stash-census](../../../src/lib/__tests__/delimiters-stash-census.test.ts),
[write-preservation-gate](../../../src/lib/__tests__/write-preservation-gate.test.ts),
[preservation-refusal-posture](../../../src/lib/__tests__/preservation-refusal-posture.test.ts),
[preservation-notice-badge](../../../src/components/__tests__/preservation-notice-badge.test.tsx),
[mount-preservation-gate](../../../src/lib/__tests__/mount-preservation-gate.test.ts),
[code-pane-preservation-gate](../../../src/lib/__tests__/code-pane-preservation-gate.test.ts),
[serializer-node-coverage](../../../src/lib/__tests__/serializer-node-coverage.test.ts),
[tex-write-accountability](../../../src/lib/__tests__/tex-write-accountability.test.ts),
[write-tex-forensic-snapshot](../../../src/lib/__tests__/write-tex-forensic-snapshot.test.ts),
[preservation-measure-parity](../../../src/lib/__tests__/preservation-measure-parity.test.ts),
[preservation-measure-python](../../../src/lib/__tests__/preservation-measure-python.test.ts),
[per-file-write-gate](../../../src/lib/__tests__/per-file-write-gate.test.ts)
+ `editor/scripts/tests/test_preservation_measure.py`.

**The legs with teeth are the censuses, every time** — the gates were never the
part that could misbehave; a WRITER or a DOOR that never asks is, and such a
writer type-checks perfectly and is invisible to every behavioural test of every
gate. `tex-write-accountability`'s needle is the WRITE, not the filename (a
filename census is a hand list wearing a regex's clothes, and `writeTemplateFiles`
writes a `.tex` without ever spelling the word). `serializer-node-coverage`'s
premise leg sweeps the REAL main-editor schema, so a node extension added without
a serializer arm fails the build; its door census requires both backends to catch
the refusal at BOTH bundle-write sites **and to rethrow anything else** — swallowing
an unrelated failure there turns a real bug into a silently skipped save, the
defect's own shape.

Known limits, none of them papered over:

- **The 4-word floor is real.** Deleting `\usepackage{expex}` (2 words) does not
  trip the gate, and a lone `\author{Jane Q. Doe}` still passes. Recorded as a
  PASSING leg that documents the limit rather than a failing one that pretends the
  gate is tighter than it is.
- **A words measure cannot see re-ORDERING or `%`-fusion damage**, and the
  contiguous-run check that would catch one shape of it costs false refusals on
  every legitimate hoist — measured, then declined.
- **The Python half reaches only the skills.** `withDocLock` is a Web Locks
  primitive: it serializes this browser's windows and does not reach the
  out-of-process `/editor/*` scripts at all. What covers that writer is the
  words/structural refusal in `_common.py`, not the lock.
- **The autosave after a real user edit is deliberately UNGATED** (unless a notice
  stands). That is 350-D's decision, not an oversight: refusing to save the user's
  own typing is the worse failure.
- **Owed, not claimed:** a real-FSA eyeball of the banner, the refusal posture, and
  a live style switch leaving a `virgil/.history/` slot behind. This class masks in
  the dev preview (see the FSA-masking note in the memory index), so the durable
  proof here is the unit contracts.
