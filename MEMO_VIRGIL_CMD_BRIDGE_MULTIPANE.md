# Bug: `\ex` (and the whole bridge-routed Virgil-command class) silently no-ops under multi-doc keep-alive

**Status:** `ROOT-CAUSE-FOUND` / `FIX-READY` — diagnosis only, NOT fixed. Bug-catcher session 2026-06-25.
**Confidence:** HIGH on the core mechanism (all 6 steps confirmed against code by an adversarial pass). One MODERATE-confidence dev-only secondary cause (StrictMode).
**Worktree:** none chosen — this is on `main` (`ed8f6b0b`), affects the live multi-doc keep-alive that already shipped to local main. Whoever implements picks the worktree.

---

## Symptom (user report)

> "When I type `\ex` and hit Return it doesn't make a new example. Not sure if this generalizes to other Virgil commands yet."

It generalizes — **precisely** to the commands that route through the editor-actions bridge, and NOT to the pure-ProseMirror ones. See "Generalization map" below. That asymmetric signature is itself strong confirmation of the root cause.

---

## Root cause (one deep architectural fault)

**A module-singleton seam written under a "exactly one editor mounted" invariant that multi-doc keep-alive silently falsified.**

`\ex` routes *only* through the bridge and inserts nothing synchronously:

```ts
// src/lib/tiptap/commands.ts:120-134
{ name: "ex", action: () => {
    getEditorActionsHandle()?.runAction("example", { surface: "slash" });
} }
```

The bridge is a single-slot, last-writer-wins module cell whose own JSDoc asserts the now-false invariant:

```ts
// src/lib/actions/editor-actions-bridge.ts:71  +  docs at :53-56
const handleCell: { current: EditorActionsHandle | null } = { current: null };
// "EXACTLY ONE main editor is mounted at a time, so the cell holds at most one handle."
```

That invariant is violated by **multi-doc keep-alive**, which is **default ON**:

- `DOC_KEEP_ALIVE_CAPACITY = 3` ("1 visible + 2 warm") — [DocKeepAliveLRU.tsx:27](src/components/editor-layout/DocKeepAliveLRU.tsx:27)
- flag defaults ON — [multi-doc-keepalive-flag.ts:31-43](src/lib/multi-doc-keepalive-flag.ts:31)
- up to 3 `<EditorPane>` instances are rendered, one per warm doc — [EditorLayout.tsx:3670-3736](src/components/EditorLayout.tsx:3694) (`renderedKeepAliveEntries.map`)

Each `EditorPane` publishes its handle in an effect that has **no visibility gate** and a cleanup that **blind-nulls the cell**:

```ts
// src/components/EditorPane.tsx:3090-3098
setEditorActionsHandle(handle);
return () => setEditorActionsHandle(null);   // <- unconditional; nulls even another live pane's handle
}, [editor]);                                 // <- deps: editor ONLY, no isVisible / isActive
```

`runAction` resolves the editor from the **publishing pane's own ref**, not the focused/visible one:

```ts
// src/components/EditorPane.tsx:2995
const ed = innerRef.current?.getEditor();    // the editor of the pane that PUBLISHED this handle
```

**The decisive timing (verified):** on a doc switch the keep-alive LRU only reorders the array and flips `isVisible` — the id set is unchanged, so **no pane remounts and no `editor` instance changes**, so the `[editor]`-dep publish effect **does not re-run**. Whoever published last in absolute time keeps the cell ([useKeepAliveLRU.ts:36-49](src/lib/keep-alive/useKeepAliveLRU.ts:36)).

### The two concrete failure modes

1. **Stale handle → example lands in the HIDDEN doc.** Open A (cell=A) → open B, cold-mount publishes (cell=B, visible, works) → **switch back to A** (warm; A's effect doesn't re-run; cell stays = B, now hidden). `\ex` in visible A calls `runAction("example")`, which reads B's `innerRef` editor and inserts the `exampleBlock` into the **hidden** document B. User sees nothing.

2. **Nulled cell → total no-op.** When a warm pane is LRU-evicted (or its tab closes), its cleanup runs `setEditorActionsHandle(null)` unconditionally, clobbering the cell even when a *different* pane is visible. `\ex` then `?.`-short-circuits to nothing until some pane's `editor` identity changes (which a plain switch never triggers).

---

## Why `\ex` specifically, and the generalization map

Both Enter paths converge on the same `cmd.action` → bridge call, so the trigger path is irrelevant:
- typed `\ex` + Return → [latex-command.ts:135-165](src/lib/tiptap/latex-command.ts:135) `handleKeyDown` → `cmd.action(view, ...)`
- slash popup + Return → [slash-popup.ts:49-59](src/lib/tiptap/slash-popup.ts:49) `executeSelection` → `cmd.action(view, ...)`

| Command | Path | Behavior under the bug |
|---|---|---|
| `\ex` | bridge-only ([commands.ts:120](src/lib/tiptap/commands.ts:120)) | **FULL FAIL** — nothing, or example into hidden doc |
| `\ref` | bridge-only ([commands.ts:104](src/lib/tiptap/commands.ts:104)) | **FULL FAIL** — twin of `\ex` |
| `\cite` | atom synchronous on live `view`, **card/popover via bridge** ([commands.ts:136](src/lib/tiptap/commands.ts:136)) | **HALF FAIL** — atom appears in correct doc; create-popover/card mis-routes or no-ops |
| `\footnote` | atom synchronous on live `view`, **card via bridge** ([commands.ts:153](src/lib/tiptap/commands.ts:153)) | **HALF FAIL** — footnote marker appears; panel card mis-routes or no-ops |
| `\section` `\chapter` `\subsection` `\subsubsection` | pure-PM `runViewOnlyAction(view)` ([commands.ts:100-103](src/lib/tiptap/commands.ts:100)) | **UNAFFECTED** (uses the plugin's own `view`) |
| `\tex` `\title` `\author` `\date` | pure-PM `runViewOnlyAction(view)` ([commands.ts:93-95](src/lib/tiptap/commands.ts:93), [:201](src/lib/tiptap/commands.ts:201)) | **UNAFFECTED** |

This is a clean, testable prediction: ask the user whether `\section`/`\tex` still work (they should) while `\ex`/`\ref` don't, and whether `\footnote`/`\cite` produce a marker but no card.

---

## Repro condition

- **Production / FSA (the user's case):** requires **≥2 authored docs open at once** (flag default ON, capacity 3). Bites after switching *back* to a warm doc (stale handle) or after a warm doc is LRU-evicted (nulled cell). A single open doc in production does NOT trigger it.
- **Quick prod confirmation:** open one doc, `\ex` works → open a second doc, `\ex` works there → switch back to the first → `\ex` fails (example silently created in the second doc / nothing). Opt-out test: set `localStorage['virgil:multi-doc-keepalive'] = '0'`, reload, repro should vanish (capacity 1).
- **Dev (`npm run dev`):** can also bite with a **single doc** via React StrictMode double-mount nulling the cell — see Secondary cause below (MODERATE confidence, dev-only). Note: a stale localhost HTTP cache can mask a fresh build — see `pwa_localhost_stale_http_cache` memory if dev-repro is flaky.

---

## Secondary cause (independent, dev-only, MODERATE confidence)

**React StrictMode double-mount nulls the cell even with one doc.** The publish effect's cleanup ([EditorPane.tsx:3091](src/components/EditorPane.tsx:3091)) blind-nulls on the StrictMode unmount; on the remount the effect early-returns at [EditorPane.tsx:2978](src/components/EditorPane.tsx:2978) (`if (!editor) return`) because the new instance's `editor` state re-inits to null and the reused TipTap instance does not re-fire `onEditorReady` (deps unchanged at [Editor.tsx:749-751](src/components/Editor.tsx:749)). End state: cell = null with one live visible editor → `\ex` no-ops. Production has no StrictMode, so this cannot explain the FSA report, but it can make a single-doc `npm run dev` reproduce. Confidence is MODERATE because the outcome rides TipTap's internal `scheduleDestroy` timing, not confirmed by execution. **The compare-and-clear fix below closes this path too.**

---

## Recommended fix — DEEP, unified (matches the central design principle)

**The architecture already has the right resolver; the bridge just never adopted it.** `src/lib/active-editor-probe.ts` → `pickProbeEditor(editors)` resolves "which editor among several mounted" with `focused → visible → single → null` precedence — built for *exactly* this multi-pane reality, but only the dev probes use it. The bridge is the duplicated, broken second copy of the same concept (last-writer-wins instead of active-resolution). Unify them.

### Primary (most correct): registry keyed by editor view + exact lookup

1. Replace the single `handleCell` with a **registry** — a `Map<EditorView, EditorActionsHandle>` (or keyed by the pane's docId/`innerRef`).
2. `EditorPane` registers/unregisters **its own** entry (keyed by its view) — so a pane unmounting only removes its own key, never clobbering another live pane. This alone kills failure mode 2 and the StrictMode null-out.
3. The PM consumers **already hold the live `view`** they fired in (`cmd.action(view, ...)` passes it; the typed input rules in [citation.ts](src/lib/tiptap/citation.ts) / [footnote.ts](src/lib/tiptap/footnote.ts) have it too). Add `getEditorActionsHandleFor(view)` and have the four [commands.ts](src/lib/tiptap/commands.ts) sites + the typed rules look up the handle for **their own view** — exact, no heuristic. This kills failure mode 1 (the example always lands in the doc the user typed into).
4. For any contextless React-land caller without a view (e.g. [EditorLayout.tsx:2633](src/components/EditorLayout.tsx:2633) `getEditorActionsHandle()?.runAction("citation")`), keep an arg-less `getEditorActionsHandle()` that resolves the **active** handle via the same `pickProbeEditor` precedence (focused → visible → single). This collapses the two "which editor is active" notions into ONE resolver.

### Minimum-viable (if a full registry is out of scope this pass)

- **Compare-and-clear** at [EditorPane.tsx:3091](src/components/EditorPane.tsx:3091): `return () => { if (handleCellOwnedByThisHandle) setEditorActionsHandle(null); }` (only clear if the cell still holds *this* pane's handle). Closes failure mode 2 + the StrictMode path.
- **Visibility-gated publish:** only the visible/active pane publishes (gate the effect on the pane's `isVisible`/`isActive`, re-publishing on the visibility flip). Closes failure mode 1.

The minimum-viable pair is small, but the registry is the deeper, durable fix and is the one that *retires the duplicated active-editor concept* — recommend it unless time-boxed.

**Trap to avoid:** do NOT "fix" this by making `\ex`/`\ref` insert synchronously like `\footnote`. That papers over only two of the four affected commands and leaves the card-routing half of `\cite`/`\footnote` (and the contextless `EditorLayout` citation call) still mis-routing to the wrong pane. The fault is the seam, not the command.

---

## Test gap (whoever implements should close it)

No existing test could have caught this. `editor-actions-bridge.test.ts` and `example-cross-surface.test.ts` always set up **exactly one** handle ([example-cross-surface.test.ts:160](src/lib/actions/__tests__/example-cross-surface.test.ts:160); [editor-actions-bridge.test.ts:206,248,263,301](src/lib/actions/__tests__/editor-actions-bridge.test.ts:206)), and their test handles close over a single `editor` directly instead of reading `innerRef.current?.getEditor()` — so they structurally cannot reproduce stale-handle / wrong-pane targeting. Add a **multi-handle clobber test**: publish handle A, publish handle B, simulate a switch back to A, assert `\ex` reaches the *visible* pane's editor; and a test that an unmounting pane does not null another live pane's handle.

---

## Evidence index (file:line)

- `\ex` bridge-only: [commands.ts:120-134](src/lib/tiptap/commands.ts:120)
- single-slot cell + false invariant: [editor-actions-bridge.ts:71](src/lib/actions/editor-actions-bridge.ts:71), [:53-56](src/lib/actions/editor-actions-bridge.ts:53)
- keep-alive capacity 3 / flag default ON: [DocKeepAliveLRU.tsx:27](src/components/editor-layout/DocKeepAliveLRU.tsx:27), [multi-doc-keepalive-flag.ts:31](src/lib/multi-doc-keepalive-flag.ts:31)
- N EditorPanes rendered: [EditorLayout.tsx:3694](src/components/EditorLayout.tsx:3694)
- ungated publish + blind-null cleanup: [EditorPane.tsx:3090-3098](src/components/EditorPane.tsx:3090)
- runAction reads publishing pane's editor: [EditorPane.tsx:2995](src/components/EditorPane.tsx:2995)
- switch doesn't re-run the effect: [useKeepAliveLRU.ts:36-49](src/lib/keep-alive/useKeepAliveLRU.ts:36)
- the resolver to reuse: [active-editor-probe.ts:18-29](src/lib/active-editor-probe.ts:18)
- both Enter paths: [latex-command.ts:135](src/lib/tiptap/latex-command.ts:135), [slash-popup.ts:49](src/lib/tiptap/slash-popup.ts:49)
- bridge plumbing predates keep-alive (latent assumption): commit `e296890d` ("CHIP 4a-i: PM→React bridge plumbing")
