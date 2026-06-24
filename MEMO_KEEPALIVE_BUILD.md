# Keep-Alive — BUILD SPEC (unified, deep architecture)

Lead-engineer build spec for the unified keep-alive primitive and its two
consumers (L2 main-doc bounce, L3 Library-reader LRU). Companion to
`MEMO_KEEPALIVE_PLAN.md` (read that for the diagnosis + L1 sidecar-bundle layer;
L1 is independent and not respecified here). This memo is the canonical
code-level contract for **L2 + L3 + the shared primitive**.

The whole design rests on one rule from `AGENTS.md`:

> **A hidden, kept-alive editor must be INERT.** No per-transaction work (it
> receives none — the user isn't typing into it), and — the actual danger — no
> continuous RAF loop, ResizeObserver/IntersectionObserver callback, or
> window-event (`resize`/`scroll`/`mousedown`) follower that runs *regardless of
> transactions*, and nothing that reads `coordsAtPos`/`getBoundingClientRect`
> (both → `0` under `display:none`) and caches the garbage. Typing in the
> VISIBLE editor must stay O(edit-size). `window.__virgilBusStats().emitCount`
> must stay flat while typing — verify in the dev preview.

---

## 1. The reusable keep-alive primitive

New module: **`src/lib/keep-alive/`** (importable from both `@/` and
`@library/` — it has no editor coupling, only React + a tiny LRU). Three files:

```
src/lib/keep-alive/
├── visibility-context.tsx   KeepAliveVisibilityContext + <KeepAliveVisibilityProvider> + useIsVisible()
├── KeepAliveSlot.tsx         <KeepAliveSlot> wrapper (display:none toggle + provider)
└── useKeepAliveLRU.ts        useKeepAliveLRU() access-order tracker + eviction
```

### 1.1 `visibility-context.tsx`

Modeled verbatim on the existing `EditorChromeProvider` pattern
(`src/components/editor-layout/chrome-context.tsx:18-36`). Default `true` so any
consumer mounted OUTSIDE a provider (every existing caller) reads "visible" and
behaves exactly as today — backward-compatible by construction.

```ts
"use client";
import { createContext, useContext, type ReactNode } from "react";

const KeepAliveVisibilityContext = createContext<boolean>(true);

export function KeepAliveVisibilityProvider({
  isVisible,
  children,
}: { isVisible: boolean; children: ReactNode }) {
  return (
    <KeepAliveVisibilityContext.Provider value={isVisible}>
      {children}
    </KeepAliveVisibilityContext.Provider>
  );
}

/** True when this subtree is the active/shown keep-alive slot. Default true
 *  (no provider ⇒ legacy always-visible behavior). */
export function useIsVisible(): boolean {
  return useContext(KeepAliveVisibilityContext);
}
```

> **Why a context AND an `isVisible` prop?** The prop is the load-bearing path:
> EditorPane threads `isVisible` straight into the four measurement consumers
> (§2) as a hook argument / effect-dep so the early-outs are eager and testable.
> The context is the convenience path for *deep* descendants that would
> otherwise prop-drill through 30 layers (mirrors `useEditorChrome`). Both are
> fed from the SAME boolean at the slot. EditorPane sets both: it consumes its
> `isVisible` prop and re-publishes it via `<KeepAliveVisibilityProvider>` so any
> descendant float/popout can call `useIsVisible()` without new plumbing.

### 1.2 `KeepAliveSlot.tsx`

The reusable mount-once + `display:none` wrapper. Encapsulates the two
non-negotiable CSS facts: (a) `display:none` (NOT `visibility:hidden` — see
§2.0) and (b) the flex sizing that lets the visible slot fill the row.

```tsx
"use client";
import { type ReactNode } from "react";
import { KeepAliveVisibilityProvider } from "./visibility-context";

export function KeepAliveSlot({
  isVisible,
  children,
  className = "flex flex-1 min-h-0 overflow-hidden",
}: { isVisible: boolean; children: ReactNode; className?: string }) {
  return (
    <div style={{ display: isVisible ? "flex" : "none" }} className={className}>
      <KeepAliveVisibilityProvider isVisible={isVisible}>
        {children}
      </KeepAliveVisibilityProvider>
    </div>
  );
}
```

`KeepAliveSlot` is dumb on purpose: it does NOT own mounting decisions. WHICH
children are mounted is decided by the parent (L2: a single `currentDocId`
guard; L3: the LRU array). The slot only flips visibility + publishes context.
A child unmounts only when the parent stops rendering it — that is the eviction
signal, and it is what runs `DocPipeline`'s `endDocPipeline` cleanup
(`DocPipeline.tsx:63-70`). Visibility flips cost nothing — no remount.

### 1.3 `useKeepAliveLRU.ts`

Generic access-order tracker. Pure state; no editor knowledge. L3 wraps it; L2
does NOT use it (L2 is N=1 — see §3.4).

```ts
export interface KeepAliveEntry {
  /** Canonical, dedup key. For readers: `library-paper:${citekey}`. */
  id: string;
  isVisible: boolean;
}

/**
 * Access-order keep-alive list. The active id is promoted to the front; the
 * list is sliced to `capacity` (most-recently-active first); the dropped tail
 * unmounts (true React unmount ⇒ pipeline cleanup ⇒ pending-write flush).
 *
 * DEDUP CONTRACT: `id` is the identity. An id already present is MOVED, never
 * duplicated. This is the load-bearing invariant against a same-docId
 * dual-pipeline (assertNotSuperseded). Callers MUST derive `id` canonically.
 */
export function useKeepAliveLRU(
  activeId: string | null,
  capacity: number,
): KeepAliveEntry[];
```

Implementation (sketch):

```ts
const [order, setOrder] = useState<string[]>([]);   // most-recent first
useEffect(() => {
  if (activeId == null) return;
  setOrder((prev) => {
    if (prev[0] === activeId) return prev;            // already front → stable identity
    const without = prev.filter((id) => id !== activeId); // DEDUP: remove any prior copy
    const next = [activeId, ...without].slice(0, capacity); // promote + evict tail
    return next;
  });
}, [activeId, capacity]);

return order.map((id) => ({ id, isVisible: id === activeId }));
```

Key correctness points (all asserted by unit tests, §5.1):
- **Survivor stability.** Re-visiting a kept-alive id returns `prev` unchanged
  for the survivors' relative order, so React keys are stable ⇒ NO remount of
  survivors. Only the promoted id moves and only the evicted tail unmounts.
- **`activeId === null`** (e.g. a non-paper inner tab is active) leaves the list
  intact — hidden readers stay warm; nothing is shown (every entry `isVisible`
  is false). The parent decides whether to render the LRU host at all.
- **Capacity change** re-slices on the next active change; entries beyond the
  new capacity unmount.

### 1.4 Default capacities (module-level consts, tunable)

| Const | Location | Default | Meaning |
|---|---|---|---|
| `READER_LRU_CAPACITY` | `library/components/ReaderLRU.tsx` | `4` | 1 visible + 3 hidden readers |
| (L2 has no capacity) | — | N=1 | exactly one main doc kept alive |

Ship L3 at `2` (1 visible + 1 hidden) if capacity-4 heap profiling is
unfavorable on target hardware (§5.4) — still makes A↔B instant.

---

## 2. Keystroke-sanctity follower-pause list (THE critical section)

**Hidden editor = INERT.** Below is the COMPLETE list of every follower that
runs *regardless of transactions* and therefore must early-out when not visible.
Each guard is an EARLY-OUT — it strictly *reduces* work; it adds zero
keystroke-path cost to the visible editor.

The canonical guard signal is **`!isVisible`** (threaded prop, eager) with a
defensive **`editor.view.dom.offsetHeight === 0`** fallback (the `display:none`
signature — `offsetHeight` is `0` for a `display:none` subtree, and
`coordsAtPos`/`getBoundingClientRect` return `0`/empty rects there). Use BOTH:
the prop makes the early-out eager and unit-testable; the `offsetHeight` check
defends against a RAF that was scheduled *before* the hide flip and fires after.

### 2.0 CSS invariant (root cause of half the failure modes)

The hidden wrapper MUST be `display:none`, NOT `visibility:hidden`:
- `display:none` ⇒ removed from flex flow (no stolen space / pushed-down visible
  pane) AND `offsetHeight === 0` (the guard signal) AND `coordsAtPos → 0`.
- `visibility:hidden` ⇒ still laid out, `offsetHeight` nonzero, observers still
  fire with REAL geometry → defeats every guard below. **Never use it here.**

### 2.1 MUST-GATE followers (continuous / observer / window-driven)

| # | Follower | File:line | Why it runs while hidden | Exact guard |
|---|---|---|---|---|
| F1 | **SelectionActionsMenu** margin-bolt placement | `src/components/SelectionActionsMenu.tsx:73` (computePlacement), RAF wiring `:200-207`, window `resize`/`scroll`/`mousedown`/`mouseup` `:269-279` | window `resize`/scroll listeners + editor `update`/`selectionUpdate` RAF fire regardless; `coordsAtPos(head)` `:88` returns `{0,0,0,0}` → jitters the bolt | At the TOP of `computePlacement` (`:74`, before `coordsAtPos`): `if (!isVisible || !cache.editorEl || cache.editorEl.offsetHeight === 0) return INVISIBLE_PLACEMENT;`. Thread `isVisible` into the effect deps (`:292`) so re-subscription is correct. |
| F2 | **useInTextPositions** card measurement | `src/hooks/useInTextPositions.ts:234` (measure), `coordsAtPos` `:278`, `getBoundingClientRect` `:292`; ResizeObserver `:361`, window `resize` `:355`, bus subs `:344-353` | editorDom ResizeObserver + window resize fire regardless; `measure()` caches `naturalTop=0` for every card when hidden | At TOP of `measure()` (`:234`), extend the existing guard: `if (!editor || !enabled || !isVisible || editor.view.dom.offsetHeight === 0 || items.length === 0) { …existing clear… return; }`. Pass `isVisible` as a new arg and add to the `measure` `useCallback` deps (`:314`) and the layout-effect deps (`:321`). Simplest: callers pass `enabled = baseEnabled && isVisible` (the hook ALREADY bails fully on `!enabled` at `:235` and `:322`) — prefer this, no signature change. |
| F3 | **useMarginaliaRegistry** observers + RAF self-heal | `src/hooks/useMarginaliaRegistry.ts`: `flushRecompute` `:335`, `scheduleObserveRetry` `:534`, `onIntersection` `:548`, `onResize` `:661`, `onWindowResize` `:670` | IntersectionObserver + per-block ResizeObserver + window resize fire on layout, not transactions; `measureBlock` reads `coordsAtPos`/`getBoundingClientRect`; the self-heal RAF reschedules every frame until `pendingObserve` empties | Thread `isVisible` (via prop OR `useIsVisible()` context — this hook is deep, context is cleaner). Guard FOUR entry points: (a) `onIntersection` `:549` — `if (!editor || editor.isDestroyed || !isVisibleRef.current) return;`; (b) `onResize` `:661` — same; (c) `onWindowResize` `:670` — same; (d) `scheduleObserveRetry` `:534` — `if (state.observeRetryRafId || !isVisibleRef.current) return;` AND inside the RAF body before `syncObservedSet`. Also (e) `flushRecompute` `:335` — bail at top. Use an `isVisibleRef` updated by an effect so the long-lived closures see fresh state without re-subscribing. |
| F4 | **EditorLayout breadcrumb** — MAIN pane | `src/components/EditorLayout.tsx:2017` (compute), `coordsAtPos` `:2067`/`:2101`; RAF `:2129`, scroll `:2141`, window resize `:2142`, editor `update` `:2143` | scroll/resize listeners always active; `compute()` walks the doc + `coordsAtPos` per heading/parTitle → all `0` when hidden, caches a stale breadcrumb | At TOP of `compute()` (`:2017`): `if ((scrollEl as HTMLElement).offsetHeight === 0) return;` (the row scroll container is inside the `display:none` wrapper, so its `offsetHeight` is `0`). No `isVisible` prop needed here — EditorLayout owns the wrapper and the `offsetHeight` read is authoritative. |
| F5 | **EditorLayout breadcrumb** — MIRROR pane | `src/components/EditorLayout.tsx:2175` (compute), `coordsAtPos` `:2204`/`:2219`; RAF `:2232`, scroll `:2242`, resize `:2243`, editor `update` `:2245` | same as F4, scoped to the mirror view | Same as F4 at TOP of mirror `compute()` (`:2175`): `if ((scrollEl as HTMLElement).offsetHeight === 0) return;`. |
| F6 | **useEditorViewportCache** refresh | `src/hooks/useEditorViewportCache.ts:166` (refresh), ResizeObserver `:279-282`, window resize `:284` | ResizeObserver on editorEl + scroll-parent + window resize fire regardless; `refresh()` reads `getBoundingClientRect`/`getComputedStyle` → `0×0` rects → cache fills with zeros → `version` bumps → cascades to F1/grab-handle consumers | Extend the existing connectivity guard at TOP of `refresh()` (`:167`): `if (!editorEl.isConnected || editorEl.offsetHeight === 0) return;`. This single guard stops the STALE-CACHE CASCADE (downstream consumers depend on `cache.version`). No `isVisible` prop needed — `offsetHeight` is the authoritative `display:none` signal. **This is the highest-leverage single guard** — it kills the whole stale-geometry propagation class. |
| F7 | **SlashCommandPopup** placement | `src/components/SlashCommandPopup.tsx:51` (update), `coordsAtPos` `:53`; RAF on transaction `:71`, scroll `:76`, resize `:78` | scroll/resize fire while hidden; a RAF may have been scheduled before the hide | At TOP of `update()` (`:51`): `if (editor.view.dom.offsetHeight === 0) return;`. (The popup only renders when `state.open`; this defends the pre-hide RAF.) Component is mounted only while open, so impact is small — include for completeness. |
| F8 | **EditorMirror** RAF-deferred `updateState` | `src/components/EditorMirror.tsx:82-93` (onTr → RAF → `view.updateState`) | `on('transaction')` is transaction-gated, but the mirror also renders the shared state; while `display:none` the `updateState` DOM work is wasted | In `onTr` before scheduling the RAF (`:83`), OR in the RAF body before `updateState` (`:89`): `if (view.dom.offsetHeight === 0) return;`. (Re-show triggers a fresh `updateState` from the canonical view, so skipping while hidden is safe.) Optional polish — low impact, but it removes per-tx DOM churn in the hidden mirror. |
| F9 | **TextObjectGrabHandle** hover/placement | `src/text-objects/TextObjectGrabHandle.tsx:338` (computePlacement), `resolveTextObjectsAtMouse` `:268` (`querySelectorAll('[data-uuid]')` `:278` + `getBoundingClientRect` `:283`) | window `mousemove`/`resize` + editor `update` drive hover resolution; hidden blocks return `0×0` rects → misfires / stale geometry | In `computePlacement` (`:338`) before block-frame geometry: `if (!cache.editorEl || cache.editorEl.offsetHeight === 0) return null;`. The hover cache's `containsHoverZone` (`useEditorViewportCache:237`) already returns false once F6 stops refreshing (zeroed zone), so `resolveTextObjectsAtMouse` self-bails — but add the explicit `offsetHeight` guard for defense. |

### 2.2 NATURALLY-INERT followers (NO gate needed — document why)

These run on transactions or registry-version bumps, both of which are silent on
a hidden editor that isn't being typed into. Listing them so a reviewer doesn't
"helpfully" add a redundant gate (which would only add branches).

| Follower | File:line | Why inert without a gate |
|---|---|---|
| **DocStructureObserver** (the bus emitter) | `src/lib/tiptap/doc-structure/` (first extension) | Fires per-transaction. Hidden editor receives no user keystrokes ⇒ zero transactions ⇒ zero work. Typing in the VISIBLE editor produces only that editor's transactions. |
| **useDocument autosaver** | `src/hooks/useDocument.ts` (`onUpdate`, 1500ms debounce) | No user transactions in the hidden editor. A background autosave from accumulated edits is *intended* (keep-alive must persist unsaved work) — NOT a bug. |
| **useEditorUIState** fold/PDF-stale | `src/hooks/useEditorUIState.ts`, `EditorPane.tsx:819-856` | Transaction-gated (fold-meta/docChanged); per-view. Hidden view fires none. |
| **float-sync** main→float | `src/lib/float-sync.tsx:137-164` | `on('transaction')` docChanged-gated. A hidden float SHOULD stay synced to main edits — that's the feature. Inert otherwise. |
| **Marginalia** marker render | `src/components/Marginalia.tsx:97-152` | Re-renders only on `registry.stats().version` bumps, which come from F3's measurement changes — and F3 is now gated, so a hidden editor's registry never bumps. Plain typing does zero work here regardless. |
| **EditorPane menubar ResizeObserver** | `src/components/EditorPane.tsx:3084-3098` | Watches the menubar CHROME, not editor content. Under `display:none` it won't fire (zero-size). Low risk; an optional `if (editorInstance?.view.dom.offsetHeight === 0) return;` in the callback is acceptable but not required. |

### 2.3 The threading map (where `isVisible` flows)

```
EditorPane (new prop: isVisible?: boolean = true)
  ├─ re-publishes via <KeepAliveVisibilityProvider isVisible={isVisible}>   (for deep descendants)
  ├─ SelectionActionsMenu       ← isVisible prop            (F1)
  ├─ useInTextPositions(...)     ← enabled = enabled && isVisible   (F2, no sig change)
  ├─ useMarginaliaRegistry       ← useIsVisible() context   (F3, deep hook)
  ├─ EditorLayout breadcrumb     ← offsetHeight (owns wrapper)  (F4/F5)
  ├─ useEditorViewportCache      ← offsetHeight (authoritative)  (F6)
  ├─ SlashCommandPopup           ← offsetHeight             (F7)
  ├─ EditorMirror                ← offsetHeight             (F8)
  └─ TextObjectGrabHandle        ← offsetHeight (+ F6 cascade)  (F9)
```

Add `isVisible?: boolean` to `EditorPane`'s props (default `true`) so EVERY
existing caller — the main app's doc branch, and any test mount — is unchanged.

---

## 3. L2 — keep the MAIN doc editor mounted-but-hidden

### 3.1 The invariant that makes L2 cheap

`currentDocId` NEVER changes across a paper↔Library bounce
(`useFiles.ts`: `openPaperTab` `:736-744`, `activatePaperPane` `:762-766`,
`activateLibraryOuterPane` `:808-812` set the pane + the paper/library id and
NEVER call `setCurrentDocId`). So `DocPipeline key={currentDocId}`
(`EditorLayout.tsx:4393`) is stable across the bounce ⇒ the pipeline registry
keeps the SAME `pipelineId` ⇒ the autosave wall is satisfied BY CONSTRUCTION,
with zero pipeline-registry change. The only reason the editor unmounts today is
the mutually-exclusive `activePane` ternary at `:4306-4527`.

### 3.2 EditorLayout restructure (the JSX)

HOIST the doc-editor arm (`:4381-4526`, the `currentDocId ? (...)` branch) OUT of
the ternary into an always-mounted, visibility-toggled `KeepAliveSlot`. The
ternary then selects only the NON-doc panes.

```tsx
{/* ── Always-mounted main doc editor ─────────────────────────────────────
    Same currentDocId across a paper↔Library bounce ⇒ DocPipeline key stable
    ⇒ no remount ⇒ autosave wall satisfied trivially. display:none (NOT
    visibility:hidden) so the hidden editor steals no flex space. */}
{currentDocId && (
  <KeepAliveSlot isVisible={activePane === "doc" && !pdfView}>
    <div data-virgil-row-scroll className="flex flex-1 min-h-0 overflow-x-auto overflow-y-auto">
      <DocPipeline key={currentDocId} docId={currentDocId}>
        <SplitWithCode
          /* …unchanged… */
          left={
            <EditorChromeProvider value={FULL_CHROME}>
              <EditorPane
                /* …unchanged props… */
                isVisible={activePane === "doc" && !pdfView}   /* ← NEW */
              />
            </EditorChromeProvider>
          }
          right={/* …unchanged code-pane… */}
        />
      </DocPipeline>
    </div>
  </KeepAliveSlot>
)}

{/* ── Ternary now selects ONLY the non-doc panes ──────────────────────── */}
{activePane === "paper" && currentPaperCitekey ? (
  <div className="flex flex-1 overflow-hidden bg-[var(--background)]"><PaperOuterView … /></div>
) : activePane === "library-outer" && currentLibraryOuterId === OUTER_LIBRARY_ROOT_ID ? (
  …LibraryTabView…
) : activePane === "library-outer" && currentLibraryOuterId ? (
  …LibraryOuterView…
) : currentDoc && docPermState !== "granted" ? null
  : pdfView && currentDocId ? (
      …PDF iframe…   /* unchanged — see §3.3 */
  ) : activePane === "doc" && currentDocId ? null   /* doc handled by the always-mounted block above */
  : (…empty state…)}
```

Notes:
- The doc arm's wrapper `<div data-virgil-row-scroll …>` MOVES inside the slot
  unchanged (preserve the scroll container — the breadcrumb's `scrollEl` and F4
  `offsetHeight` guard read it).
- `KeepAliveSlot`'s `className` default (`flex flex-1 min-h-0 overflow-hidden`)
  matches the row sizing; keep the inner `data-virgil-row-scroll` div as-is.
- `currentDoc && docPermState !== "granted" ? null` stays in the ternary
  (permission gate must still suppress the editor) — it short-circuits BEFORE
  the empty state. The always-mounted slot is independent; when permission isn't
  granted, `EditorPane` already renders its own gate, so leaving the slot mounted
  is fine (it just renders the same not-granted state, hidden if `activePane` is
  elsewhere). Verify in the perm-gate test (§5.2).

### 3.3 PDF view interaction

First cut: leave the PDF iframe in the ternary (`:4339-4380`). Set the slot's
`isVisible = activePane === "doc" && !pdfView` so the editor goes hidden (not
unmounted) while the PDF is shown for the SAME doc — the editor stays WARM behind
the PDF and re-show is instant. The ternary's `pdfView && currentDocId` arm
renders the iframe; the `activePane === "doc"` arm returns `null` (editor handled
above). Confirm toggling PDF doesn't double-mount the editor (it can't — the slot
is the only editor mount and it's gated off while `pdfView`).

### 3.4 Do NOT LRU the main docs (decision)

L2 is **N=1**: keep the CURRENT `currentDocId` editor alive across the bounce.
Do NOT add an LRU of multiple main docs:
- Main doc-to-doc switches genuinely change `currentDocId`, so the
  `DocPipeline key` SHOULD remount (the autosave wall depends on it; a multi-doc
  main LRU would put N live main editors under N pipelines — the exact
  dual-pipeline surface L3 must carefully guard, but here with full read/WRITE
  editors and the `.tex` autosave path, not read-only readers). Not worth the
  risk for a rare gesture.
- The headline win is the paper↔Library bounce, which is N=1. Ship that.

So L2 does NOT consume `useKeepAliveLRU` — only `KeepAliveSlot` +
`KeepAliveVisibilityProvider`. The LRU primitive is built but first USED by L3.

### 3.5 L2 invariants

- **Autosave wall** — satisfied by the stable `key={currentDocId}` (§3.1). No
  pipeline-registry change. The hidden editor keeps autosaving in the background
  — INTENDED (write in doc → Library → return → no lost/duplicated edits).
- **`usePersistentState` flush-on-docId-change** (`usePersistentState.ts:294-298`)
  must NOT fire across the bounce — `docId` is unchanged, so the cleanup effect's
  dep doesn't change and `flushPending` is not called. Confirm in §5.2.
- **ProseMirror under `display:none`** — view tolerates it (DOM stays in tree).
  Re-show is a pure visibility flip. Regression test: type → hide → show → assert
  content + selection intact (§5.2).
- **Keystroke sanctity** — the hidden editor's `on('update')`/`on('transaction')`
  subscribers are the SAME O(1)-per-tx subscribers `AGENTS.md` permits; they fire
  only on the (nonexistent) hidden transactions. The §2 guards make the
  RAF/observer followers inert. Net visible-editor keystroke cost: unchanged.

---

## 4. L3 — LRU keep-alive of the last N Library readers

### 4.1 The seam

`library/components/TabbedLibraryPanel.tsx:478-487` mounts ONE
`<PaperFileBody citekey={activeLibrary.citekey ?? null} …>`. Changing the active
inner tab changes the citekey → `PaperRender.tsx:332` recomputes
`docId = library-paper:${citekey}` → `DocPipeline key={docId}` (`PaperRender.tsx:370`)
force-remounts the whole `EditorPane`. Replace the single mount with an LRU host.

### 4.2 New files

```
library/components/ReaderLRU.tsx     renders N keep-alive PaperFileBody instances, one visible
```

(`useKeepAliveLRU` already lives in `src/lib/keep-alive/`; ReaderLRU wraps it. No
separate `library/hooks/useReaderLRU.ts` — reuse the generic primitive and derive
the canonical id inline, which keeps the dedup contract in one place.)

```tsx
// library/components/ReaderLRU.tsx
import { useKeepAliveLRU } from "@/lib/keep-alive/useKeepAliveLRU";
import { KeepAliveSlot } from "@/lib/keep-alive/KeepAliveSlot";
import { PaperFileBody } from "./PaperFileBody";

export const READER_LRU_CAPACITY = 4;            // 1 visible + 3 hidden; tune to 2 on low-end
const LIBRARY_PAPER_PREFIX = "library-paper:";   // MUST match PaperRender.tsx:332

export function ReaderLRU({
  activeCitekey, handle, entries, bibByKey, onBibChanged, scope, panel,
}: ReaderLRUProps) {
  // Canonical id derivation — the dedup contract. A citekey maps to exactly
  // one id; the LRU dedups on id, so a given paper is AT MOST once in the list.
  const activeId = activeCitekey ? LIBRARY_PAPER_PREFIX + activeCitekey : null;
  const lru = useKeepAliveLRU(activeId, READER_LRU_CAPACITY);

  return (
    <>
      {lru.map((e) => {
        const citekey = e.id.slice(LIBRARY_PAPER_PREFIX.length);
        return (
          <KeepAliveSlot key={e.id} isVisible={e.isVisible}>
            <PaperFileBody
              handle={handle}
              citekey={citekey}
              entries={entries}
              bibByKey={bibByKey}
              onBibChanged={onBibChanged}
              scope={scope}
              panel={panel}
              isVisible={e.isVisible}        /* ← NEW, threaded to EditorPane */
            />
          </KeepAliveSlot>
        );
      })}
    </>
  );
}
```

At `TabbedLibraryPanel.tsx:478`, replace:

```tsx
{isPaper(activeLibrary) ? (
  <ReaderLRU
    handle={handle}
    activeCitekey={activeLibrary.citekey ?? null}
    entries={entries}
    bibByKey={bibByKey}
    onBibChanged={onBibChanged}
    scope={scope}
    panel={panel}
  />
) : ( …unchanged non-paper branch… )}
```

### 4.3 `isVisible` threading (mirrors L2)

Add `isVisible?: boolean = true` to:
- `library/components/PaperFileBody.tsx` (forwards to `RightDetail`)
- `library/components/RightDetail.tsx` (forwards to `PaperRender`)
- `library/components/PaperRender.tsx` — pass to `<EditorPane isVisible={isVisible} …>`
  at `:382-390` (it already wraps `<EditorChromeProvider value={READER_CHROME}>`;
  add the prop on `EditorPane`).

All default `true` ⇒ existing non-LRU callers unchanged. The reader is read-only,
so there's no autosave thrash — only the §2 measurement guards matter.

### 4.4 Eviction = true unmount = note flush

When the LRU slices past capacity, the evicted id leaves the array → React
unmounts that `KeepAliveSlot`/`PaperFileBody` → its `DocPipeline key={docId}`
cleanup runs `endDocPipeline` (`DocPipeline.tsx:69`) + `PaperRender`'s
`setDocHandle` cleanup deletes the docId from the doc-index. Critically, the
reader's note autosave is a 300ms-debounced `usePersistentState` write; on
unmount the cleanup effect (`usePersistentState.ts:294-298`) calls
`flushPending()` (`:245-253`) SYNCHRONOUSLY, firing any pending note write before
`endDocPipeline`. Confirm this ordering in §5.3 and add a dev warning if an
unflushed change is detected at eviction.

### 4.5 L3 invariants

- **DocId dedup = the dual-pipeline guard.** `useKeepAliveLRU` dedups on `id` and
  ReaderLRU derives `id` canonically (`LIBRARY_PAPER_PREFIX + citekey`, matching
  `PaperRender.tsx:332`). A given paper is at most once in the list ⇒
  `assertNotSuperseded` is never fought. **This is THE load-bearing L3 invariant.**
- **Per-doc note boundary.** `READER_CHROME.editableCardKinds=["note"]`
  (`chrome-config.ts:96-109`); each reader's own `DocPipeline`/`pipelineId` +
  the per-docId write-guard keep a note edit in reader-A out of reader-B's file.
- **Read-only sidecar guard** (`storage-fsa.ts:200`, `storage-dev.ts:228`)
  unchanged — only notes persist.
- **Keystroke sanctity at scale.** N readers each hold a live TipTap + plugins.
  Hidden ones receive no transactions and the §2 guards keep their measurement
  off. Profile the multiplied BASELINE (§5.4) — that's the only new cost.

---

## 5. Test strategy

### 5.1 Primitive unit tests (`src/lib/keep-alive/`)
- `useKeepAliveLRU`: active promotes to front; **dedup** (same id never appears
  twice; re-visiting MOVES, doesn't duplicate); capacity slices the tail;
  survivors keep relative order ⇒ stable keys ⇒ no remount; `activeId=null`
  leaves the list intact with all `isVisible=false`; capacity shrink evicts.
- `KeepAliveSlot`: renders `display:none` when `!isVisible`, `display:flex` when
  visible; `useIsVisible()` reads the provider value (and `true` with no provider).

### 5.2 L2 component + autosave-wall tests
- **No-remount across bounce.** Render EditorLayout with `currentDocId` set; flip
  `activePane` doc→paper→doc; assert `beginDocPipeline` called ONCE, the editor
  `view` reference is stable, a sentinel ref inside EditorPane is not reset.
- **Autosave wall (end-to-end).** Type → flip to Library → return → flip away;
  assert the autosave debounce fired exactly the expected writes and the on-disk
  `.tex`/bundle has the edits (no dupes, no loss). Use `doc-pipeline` registry spies.
- **flush-on-docId-change does NOT fire across the bounce.** Spy `flushPending`;
  assert zero calls when `activePane` flips but `currentDocId` is unchanged
  (`usePersistentState.ts:294`).
- **ProseMirror under hide.** Type → set `isVisible=false` → `true`; assert doc
  content + selection intact.
- **Rapid bounce + StrictMode.** Flip doc↔Library many times fast under
  StrictMode; assert no `StalePipelineError`, no pipeline churn, no leaked RAFs
  (the `pendingEnd` deferred-delete at `doc-pipeline.ts` must not fire).
- **Layout.** Assert the hidden slot is `display:none` and the visible pane fills
  full flex height (jsdom style assertion + a live dev-preview visual check).

### 5.3 L3 component tests
- **LRU eviction.** Switch among 5 papers at capacity 4; assert the 5th evicts the
  1st (its `DocPipeline`/doc-index entry cleaned up); switching BACK to a kept-
  alive paper does NOT re-run `PaperRender`'s `readTextFile`/`parseLatex`.
- **DocId dedup.** Assert the same citekey never lands twice in the LRU.
- **Note isolation + eviction flush.** Edit a note in a HIDDEN reader; switch back;
  assert it persisted to the right paper's sidecar. Edit a note then immediately
  evict; assert `flushPending` fired before `endDocPipeline` (no lost note).

### 5.4 Keystroke-sanctity smoke tests (the §2 contract)
- **`emitCount` flat.** In the dev preview (`doc_devtest`), `window.__virgilBusStats()`
  `emitCount` BEFORE/AFTER typing 100 plain chars in the VISIBLE editor: must be
  EQUAL. (And `window.__marginaliaStats().recomputes` < ~10 for those 100 chars.)
- **"Hidden editor does no coordsAtPos" test.** With a hidden slot (`isVisible=false`):
  spy on `editor.view.coordsAtPos` AND `getBoundingClientRect` on the editor DOM;
  fire window `resize` + scroll + a tick of RAFs; assert ZERO `coordsAtPos` calls
  from F1/F2/F3/F4/F5/F7/F9 and zero cache `version` bumps from F6. This is the
  primary guard-coverage test — one per gated follower.
- **Memory plateau (L3).** Instrument peak heap across an eviction cycle at
  capacity 4; assert it plateaus (no leak) within ~12–16 MB for 4 readers. If
  unfavorable, drop `READER_LRU_CAPACITY` to 2.
- **Live (L3).** Per `library/CLAUDE.md`: `localStorage["virgil:force-dev-storage"]="1"`,
  open `genette1997`/`bringhurst1992` from `library-data/`, switch inner tabs,
  confirm instant switch-back + no cold re-parse.

### 5.5 Global gate (every layer)
`npx tsc --noEmit` = 0, full vitest green, `eslint` 0-new, and the §5.4
`emitCount`-flat smoke in the dev preview.

---

## 6. Adversarial-review targets

Request a focused adversarial review on EACH of these (they are the corruption /
keystroke-regression surfaces):

1. **(L2) Hidden-editor-keeps-autosaving vs. the disk-watcher.** Does a background
   autosave from the hidden-but-live editor race the `DiskWatcher`
   external-change detection (`disk-watcher.ts`)? Confirm Virgil's own write is
   fingerprinted in the `diskLedger` so it isn't mis-flagged as external while the
   editor is hidden.
2. **(L2) flush-on-docId-change across the bounce.** Confirm `usePersistentState.ts:294`
   does NOT fire when `docId` is unchanged across the pane flip (and DOES on a
   real doc switch).
3. **(L2) StrictMode + `pendingEnd` deferred-delete under rapid hide/show.**
   The slot never unmounts across the bounce, so the `DocPipeline.tsx:61-71`
   StrictMode double-invoke path shouldn't be exercised by L2 — confirm.
4. **(L3) The docId-dedup invariant.** The ONE thing between L3 and a same-docId
   dual-pipeline corruption. Audit every path that could put a citekey twice in
   the LRU (alias citekeys, rapid re-activation, capacity-change mid-promote).
5. **(L3) Eviction-time note-flush correctness.** A 300ms-debounced note write in
   flight at the moment of eviction — confirm `flushPending` (`usePersistentState.ts:245`)
   fires synchronously before `endDocPipeline` and the write lands.
6. **(L3) N-editor memory ceiling under rapid tab churn.** Heap plateau at
   capacity 4; no leaked editors/observers/RAFs after eviction.
7. **(§2) Guard completeness.** Walk the §2.1 table against the live editor: with
   a hidden slot, prove ZERO `coordsAtPos`/`getBoundingClientRect`/cache-version
   activity under window resize + scroll + RAF ticks. Re-check §2.2 "naturally
   inert" claims haven't regressed (a new continuous follower added since this memo).

---

## 7. Build order (each independently shippable)

**L1 → L2 → L3**, sequenced so every step is a STOP-HERE-IS-A-WIN.

- **L1** (sidecar-bundle, per `MEMO_KEEPALIVE_PLAN.md` §L1) — no lifecycle change,
  no autosave exposure. Land + measure first. (Out of scope for this memo;
  already specced.)
- **L2** (this memo §1-3) — build the primitive (`src/lib/keep-alive/`), thread
  `isVisible` into EditorPane + the §2 followers, hoist the doc editor out of the
  ternary. **Verify the bounce**: type in doc → Library → back; editor never
  rebuilt; `emitCount` flat; autosave-wall test green. This is the headline win
  AND the first autosave-wall interaction ⇒ adversarial review (§6.1-6.3) is a
  ship gate.
- **L3** (this memo §4) — reuse the EXACT `isVisible` plumbing from L2; add
  `ReaderLRU` + the `useKeepAliveLRU` consumer; replace the single
  `PaperFileBody` mount. Adversarial review (§6.4-6.6) is a ship gate. If heap
  profiling is unfavorable, ship at `READER_LRU_CAPACITY = 2`.

Shared `isVisible` plumbing (EditorPane prop + the §2 guards + the
`KeepAliveVisibilityProvider`) is built ONCE in L2 and reused verbatim in L3 —
do not fork it.
