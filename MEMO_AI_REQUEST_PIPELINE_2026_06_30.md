# AI-request pipeline audit: footnote affordance + inbox culling — 2026-06-30

Bug-catcher session. Two reported bugs, one investigation (the card→inbox→skill
AI-request pipeline). Research only — **no code edited** (checkout live-driven,
HEAD 1b776636 at diagnosis). For the bug-cleaning session.

- **(1)** AI-request isn't working in footnote cards (check other cards too) — `DIAGNOSED`
- **(2)** Not all AI-requests are smoothly culled into the AI-inbox ("it's causing search"). Audit the pipeline — `ROOT-CAUSE-FOUND`

## The pipeline (6 stages, drop points D1-D6)

```
STAGE 1  card footer <AiRequestCheckbox>  (per-card affordance)
STAGE 2  hook setXAiRequest → in-mem state + void bridgeCardAiRequestFlag(...)  (fire-and-forget)
STAGE 3  bridgeCardAiRequestFlag (src/lib/ai-request-bridge.ts)  → read/modify/write ai-requests.json (errors SWALLOWED)
STAGE 4  virgil/ai-requests.json  (the persisted unified queue)
STAGE 5  frontend inbox: useAiRequests.ts → AIWindow.tsx
STAGE 6  skill drain: editor/scripts/list_requests.py  (consumed by /editor/review)
```

- **D1 (bug 1):** `OrphanedFootnoteCard` + `UnanchoredFootnoteCard` ([FootnotePanel.tsx:209-238](src/panels/Footnotes/FootnotePanel.tsx#L209)) are **never passed `onSetAiRequest`/`onSetFootnoteAiRequest`** (only the anchored `FootnoteCard` at :186-206 is). FootnoteCard's footer gate `onSetAiRequest && !compressed` ([FootnoteCard.tsx:130](src/panels/Footnotes/FootnoteCard.tsx#L130)) therefore fails → **no checkbox** for orphan/unanchored footnotes.
- **D2 (bug 1, secondary):** orphan/unanchored footnotes have no `\footnote` atom, so `resolveFootnoteAnchor` ([EditorPane.tsx ~:1446](src/components/EditorPane.tsx#L1446), keyed on `fn.pos`) returns `{}` → a bridged request with **empty `paragraphIds`** (unactionable; the drain can't anchor it).
- **D3 (bug 2, DOMINANT):** `useAiRequests.ts` reads `ai-requests.json` **once per `docId`** (`useEffect` keyed on docId, ~:33-46) — **no disk-watcher, no bridge callback**. The bridge (Stage 3) writes the file behind the hook's back, so a freshly-toggled request **does not appear in the AIWindow until reload/remount**. This is the primary "not smoothly culled" symptom.
- **D4 (bug 2):** `list_requests.py` `PANEL_FILES` has **no `highlights` entry** (`notes.json` is walked only as kind `note`, :131) → a highlight whose bridge write failed is silently dropped (no fallback).
- **D5 (bug 2):** cutter/revisions `PANEL_FILES` hardcode emitted `kind='suggestion'` (:133-134) but the filter at :181 accepts only `kind=='comment'` → mislabels comment requests and makes the fallback path unreachable for them.
- **D6:** `report` AI-requests aren't in `PANEL_FILES`; `ReportCard` renders no checkbox — **by design** (`report` = human content; `report-request` is the flag-bearing kind, and it works). Not a bug, noted for completeness.

**Bridge + registry are sound.** All 7 declared flag-bearing kinds (note, highlight, footnote, todo, cutter-comment, revision-comment, report-request) call `bridgeCardAiRequestFlag` in their hooks; routing is registry-declared (`CARD_REGISTRY[kind].aiRequest`, pinned by `ai-request-routing-contract.test.ts`). The losses are **read-side** (frontend never re-reads; skill fallback coverage is uneven), not in the bridge.

## Bug 1 — footnote AI affordance — `DIAGNOSED`

**Root cause:** works only for **anchored** footnotes; the orphan/unanchored card variants never receive the toggle callback (D1), and even if they did, D2 would file an unactionable empty-`paragraphIds` request. Other kinds render their checkbox correctly — this is footnote-orphan-specific, not a global affordance failure. (Affordance confirmed present: HighlightCard:162, CutterCommentCard:164, RevisionCommentCard:123, plus note/todo/report-request. ReportCard has none — by design, D6.)

**Deep fix:** make the affordance a property of **"has a resolvable anchor,"** not "is a footnote." Hoist the checkbox render behind a single `canAiRequest` predicate (`kind === anchored` AND resolver yields non-empty `paragraphIds`) applied uniformly across every footnote surface (docked / omni / float), so unanchored footnotes **intentionally** don't show a misleading affordance the drain can't route. Product decision needed: **hide** for unanchored (recommended) vs. **enable + tolerate empty paragraphIds** end-to-end.

**Surgical:** if enabling — pass `onSetAiRequest={onSetFootnoteAiRequest ? (v) => onSetFootnoteAiRequest(it.data.footnoteId, v) : undefined}` to Orphaned (:209-222) + Unanchored (:228-238) cards AND guard the drain to tolerate empty `paragraphIds` ([list_requests.py](editor/scripts/list_requests.py) already documents the degraded case ~:143). If hiding (recommended) — add an explicit `canAiRequest` gate at FootnoteCard.tsx:130 so the affordance is *intentionally* suppressed for non-anchored kinds.

## Bug 2 — inbox culling + "search" — `ROOT-CAUSE-FOUND`

**Two independent defects under one report:**
- **(A) Inbox staleness (D3)** — the dominant, user-visible one. `useAiRequests.ts` reads once per docId, no re-sync; bridge writes are invisible to the live inbox.
- **(B) Drain-fallback inconsistency (D4/D5)** in `list_requests.py` — no highlights fallback; cutter/revisions `kind` mismatch.

**"It's causing search" explained:** because the inbox never re-syncs with bridge writes (D3), any consumer that needs a current inbox (the AIWindow list, and code that scans/matches requests against live cards) is working on data it can't trust, forcing **repeated re-scans / polling to reconcile in-memory state with what the bridge wrote to disk** — the UI can never settle because nothing tells it the file changed. That reconciliation churn is the "search" the user perceives. Event-driven re-read removes the need to re-scan at all.

**Deep fix — one canonical inbox, consistent readers:**
1. **Frontend:** give `useAiRequests` external-change awareness like other doc state — subscribe to the `DiskWatcher`/disk-ledger ([src/lib/disk-watcher.ts](src/lib/disk-watcher.ts), [disk-ledger.ts](src/lib/disk-ledger.ts)) and re-read `ai-requests.json` on external writes, **or** have `bridgeCardAiRequestFlag` publish an in-process event the hook consumes. Bridge write and inbox state then can't diverge (kills D3).
2. **Skill drain:** make `PANEL_FILES` a faithful projection of `CARD_REGISTRY[kind].aiRequest` routing — one entry per flag-bearing kind, each emitting the **correct** kind token: add a highlights fallback (`notes.json` filtered to `type=='highlight'`), fix cutter/revisions to emit `kind='comment'` matching the :181 filter (kills D4/D5).

**Surgical:** (A) add a re-read trigger in `useAiRequests.ts` (DiskWatcher subscription or bridge event → re-run readSidecar → setState). (B) in `list_requests.py`: change cutter/revisions tuples :133-134 `suggestion`→`comment`; add a `highlights` PANEL_FILES row (`notes.json`, filtered by `type=='highlight'`); fix the :180 comment. (C) optionally un-swallow bridge write errors ([ai-request-bridge.ts:140-143](src/lib/ai-request-bridge.ts#L140)) so a failed persist is at least visible in dev.

## Cross-cutting fix (retires the whole bug-2 class + bug-1's secondary drop)

Make `ai-requests.json` the **single canonical inbox** that both the UI and the skills read, and **derive every projection of it from ONE routing manifest.** Today there are three independent readers: frontend `useAiRequests` (stale, D3), the skill's `ai-requests.json` reader, and the skill's `PANEL_FILES` fallback (uneven, D4/D5).
1. **Generate `PANEL_FILES` from the same `CARD_REGISTRY[kind].aiRequest` routing the bridge uses** (already pinned by `ai-request-routing-contract.test.ts`), so the Python drain and the TS bridge can't disagree about kinds or fallback coverage → kills D4/D5/D6-drift at the source.
2. **Make the frontend inbox event-driven off the same file** (DiskWatcher / bridge event) → kills D3.
This also subsumes bug 1's secondary drop: once the drain faithfully mirrors the registry and tolerates empty `paragraphIds`, an orphan-footnote request either surfaces correctly or is intentionally excluded by the shared `canAiRequest` predicate — no silent loss.

## Live-verify (REAL FSA paper — masks in the dev preview per [[anchor_persistence_dev_masks_fsa]])
- **Bug 1:** open a paper with (a) anchored, (b) orphaned, (c) unanchored footnotes; confirm the checkbox appears only where intended, and toggling an anchored one writes an `ai-requests.json` entry with **non-empty** `paragraphIds` (inspect the file).
- **Bug 2-A:** toggle a note/highlight/todo AI-request ON → it appears in the AIWindow **without reload**; OFF → disappears live.
- **Bug 2-B:** flag a highlight + cutter-comment + revision-comment, run `python3 editor/scripts/list_requests.py <docPath>` → all three emit rows with the **correct** kind (`highlight` / `comment`); a highlight survives even when its `ai-requests.json` entry is absent (simulate bridge-write failure by deleting the linked entry). Run `/editor/review` → each drained request marked complete (not left pending to reappear).

**Sequencing:** land the cross-cutting inbox/registry unification first (fixes bug 2 + bug 1's drop), then the bug-1 affordance decision (hide vs enable), then bug 3 ([MEMO_CARD_TITLE_PREF_2026_06_30.md](MEMO_CARD_TITLE_PREF_2026_06_30.md), independent).
