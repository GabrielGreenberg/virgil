<!-- last-verified: 694f789 2026-06-04 -->
<!-- derives-from: docs/architecture/VIRGIL.md#public-type-registry -->
<!-- covers-code: src/lib/types.ts, src/lib/storage-fsa.ts -->

# Sidecar schemas — operational manifest

> **When to load.** Any task that reads or writes a `virgil/*.json` sidecar and
> needs the **exact field shape**. This is the field-level companion to two docs
> that stop one level up: [structure.md](structure.md) says *which* sidecar files
> exist and how a write commits; [cards.md](cards.md) says *which kind* lands in
> each. This doc gives the **JSON schema** of what's inside. The anchor/`links`
> shape is owned by [anchoring.md](anchoring.md) and only referenced here.

Operational cut of [VIRGIL.md → Public-type registry](../architecture/VIRGIL.md#public-type-registry).
The SSOT is [src/lib/types.ts](../../src/lib/types.ts) — **58** exported
interfaces/aliases. Shapes below mirror it field-for-field (it is the authority;
if they ever disagree, the code wins). The full type index — every exported type,
grouped by family — is the [Coverage](#coverage) section at the foot of this doc.

## Conventions across the card schemas (read once)

Most card interfaces share a spine — recognize it once, then the per-kind tables
below carry only what's *distinctive*:

- **`id: string`** — the card's identity. For **atom-linked** cards (`footnote`,
  `citation`) this id is the link itself: it **equals** the `.tex` marker id
  (`\vfid` / `\vcid`) — see [identity.md](identity.md#footnote-and-citation-ids).
  For **anchored** cards it's a v4 entity id with no `.tex` presence.
- **`createdAt: string`** — ISO timestamp.
- **`content: unknown`** — a Tiptap **`JSONContent`** doc (the canonical editable
  body on rich cards). Legacy HTML strings migrate to `JSONContent` on read.
- **`text: string`** — a plain-text **mirror** of `content`, kept in sync on every
  write (present on the comment/suggestion/report kinds, for cheap search/preview).
- **`links: Link[]`** — the anchor(s). Present on every **anchored** card; **absent**
  on atom-linked cards (`FootnoteRef`, `CitationRef`) and on `ExampleRef`. The
  `Link` shape and Mode A/B are [anchoring.md](anchoring.md).
- **`selectedText?: string`** — the Mode-B captured text (undefined for
  paragraph-only / unanchored cards).
- **`aiRequest: boolean`** — the sticky "I want Claude to act on this" flag the
  bridge collapses into a Task ([cards.md → the Task Card](cards.md#the-task-card-ai)).

Every sidecar's root is a thin **`…State`** wrapper around one array (plus the odd
per-doc scalar). The wrapper's array key is the `list-key` the writeback targets
(`PANEL_TO_SIDECAR` in `apply_response.py`).

## The card sidecars

**`notes.json` — `NotesState { cards: NoteCardItem[] }`** (`NoteCardItem = UserNote
| HighlightCard`):

```ts
UserNote      { kind: "note"; id; title; content; createdAt; aiRequest;
                links: Link[]; originalAnchor?: OriginalAnchor }
HighlightCard { kind: "highlight"; id; createdAt; highlightColor: string | null;
                aiRequest; links: Link[];  // exactly one text-range anchor
                originalAnchor?: OriginalAnchor }
```

`originalAnchor` preserves the prior range when a Mode-B card is dropped to Mode A
([anchoring.md](anchoring.md#originalanchor)). `highlightColor` is `null` in v1
(panel-theme default).

**`todos.json` — `TodoState { items: TodoItem[] }`:**

```ts
TodoItem { id; text; notes; done: boolean; aiRequest; createdAt; links: Link[] }
```

**`footnotes.json` — `FootnotesState { footnotes: FootnoteRef[] }`:**

```ts
FootnoteRef { id; content; createdAt }   // exactly three fields; no links/anchor
```

The `id` **is** the anchor — it equals the `\vfid{}` marker. Splice recipe +
create flow: [footnotes.md](footnotes.md). (`OrphanedFootnote { footnoteId;
content; title?; orphanedAt }` is the **runtime** shape the Footnotes panel holds
for a footnote whose `\footnote{}` marker vanished — not persisted to a sidecar;
see [anchoring.md → orphans](anchoring.md#what-invalidates-a-link).)

**`citations.json` — `CitationsState`:**

```ts
CitationsState { citations: CitationRef[]; bibPath; citationStyle; bibPackage }
CitationRef    { id; command; keys: string[]; createdAt; unanchored? }
```

`command` is the full LaTeX cite string; `keys` the extracted citekeys; read
`unanchored` through `isUnanchored(card)`, not directly. `bibPackage` is
`"natbib" | "biblatex"`; `citationStyle` a CSL name. (`CitationInfo { citationId;
command; displayText; pos }` is a **live** in-text descriptor computed at render —
not persisted.)

**`cutter.json` — `CutterState { cards: CutterCard[]; goal?: CutterGoal | null }`**
(`CutterCard = CutterCommentCard | CutterSuggestionCard`):

```ts
CutterCommentCard    { kind: "comment"; id; createdAt; text; content;
                       aiRequest; selectedText?; links: Link[] }
CutterSuggestionCard { kind: "suggestion"; id; createdAt; author: "human"|"ai";
                       original_text; suggested_text; explanation; user_text;
                       instructions; status: "pending"|"accepted"|"rejected";
                       selectedText?; links: Link[] }
CutterGoal           { target: number; initialWords: number; setAt }
```

The **suggestion** shape (the six text fields + `author` + `status`) is shared
verbatim with `RevisionSuggestionCard` below. `user_text` is the human's revised
take (empty until they edit the AI draft); `instructions` is AI-only guidance.
(`CutItemLegacy { id; title; content; createdAt; links }` is the pre-refactor cut
shape, kept only for the `useCutter` migration.)

**`revisions.json` — `RevisionsState { cards: RevisionCard[]; tracker?:
RevisionsTracker | null }`** (`RevisionCard = RevisionCommentCard |
RevisionSuggestionCard`):

```ts
RevisionCommentCard    { kind: "comment"; id; createdAt; text; content;
                         aiRequest; selectedText?; links: Link[] }
RevisionSuggestionCard { kind: "suggestion"; …same fields as CutterSuggestionCard }
RevisionsTracker       { target?: number | null; setAt?: string | null }
```

The Revisions `comment`/`suggestion` records are **structurally identical** to
Cutter's — only the **sidecar file** distinguishes `cutter-comment` from
`comment`, and `cutter-suggestion` from `revision-suggestion`
([cards.md → two taxonomies](cards.md#two-taxonomies-registry-cardkind-vs-the-persisted-discriminator)).
`tracker` replaces Cutter's word-count `goal` with a "revisions accepted" target.

**`reports.json` — `ReportsState { cards: ReportItem[] }`** (`ReportItem =
ReportCard | ReportRequestCard`):

```ts
ReportCard        { kind: "report"; id; createdAt; author: "human"|"ai";
                    title; text; content; selectedText?; links: Link[] }
ReportRequestCard { kind: "report-request"; id; createdAt; text; content;
                    aiRequest; selectedText?; links: Link[] }
```

Kind semantics + lifecycle: [cards.md → the Reports panel](cards.md#the-reports-panel).

**`examples.json` — `ExamplesState { examples: ExampleRef[] }`:**

```ts
ExampleRef { id; tag; label; title; createdAt }   // metadata shadow, no links
```

`ExampleRef` is a **shadow** of an `exampleBlock` whose canonical form is the
`.tex` (`\ex…\xe`); `id` is the `\vexid{}` uuid, `tag`/`label` mirror node attrs,
`title` is a panel-only override that does **not** serialize back.

**`archive.json` — `ArchiveState { snippets: ArchivedSnippet[] }`:**

```ts
ArchivedSnippet { id; title; content; createdAt; links: Link[] }  // links may pin many
```

## The Task store (`ai-requests.json`)

`AiRequestsState { requests: AiRequest[] }` — the parallel store the cowork loop
turns on (the `ai` card kind). **Never hand-edit it**; the writeback owns it
([structure.md](structure.md#the-write-path)).

```ts
AiRequest {
  id; kind: AiRequestKind; text; createdAt;
  status: AiRequestStatus; result?: AiRequestResult; safetyLevel?: 1 | 2 | 3;
  resultId?;                 // pointer to the produced card (≠ result)
  payload?: AiRequestPayload;
  paragraphIds?: string[];   // Mode-A anchor(s) (%!v: markers)
  selectedText?;             // Mode-B selection at filing time
  linkedTo?: AiRequestLink;  // origin card when bridged from a flag
}
AiRequestLink    { panel: "notes"|"todos"|"cutter"|"revisions"|"reports"; cardId }
AiRequestPayload = { kind: "style-merge"; targetStyleId; targetStyleName;
                     targetPreamble; currentPreamble }   // only kind today
```

The three enum types are **owned by the Cowork section** — don't re-enumerate
their members or semantics here:

- **`AiRequestKind`** — the 8 Task kinds; listed in [cards.md → the Task Card](cards.md#the-task-card-ai).
- **`AiRequestStatus`** (lifecycle) and **`AiRequestResult`** (outcome) — members
  + when each is set: [VIRGIL.md → Status and result vocabulary](../architecture/VIRGIL.md#status-and-result-vocabulary).
  Legacy `draft` / `submitted` statuses still parse and read as open.

## The bibliography support files

The `bib` card is backed by the **`.bib` file** (`BibEntry`), with three sidecars
for the panel's extra state:

```ts
BibEntry         { key; type; fields: Record<string,string>; raw }  // .bib entry
// bib-review-requests.json
BibReviewState   { requests: BibReviewRequest[] }
BibReviewRequest { bibKey; type: "fields"|"notes"; requestedAt;
                   status: "pending"|"complete"; requestNotes? }
// annotations.json
AnnotationsState { [bibKey: string]: string }      // bibKey → annotation text
// bib-settings.json
BibSettings      { generalBibPath: string | null;  // @deprecated, read-only
                   entryRequests: BibEntryRequest[] }
BibEntryRequest  { id; description; status: "pending"|"complete"; createdAt;
                   resolvedKey? }
```

`bib-review-requests.json` is a **separate discovery path** (`list_requests.py`
walks it directly) because reviews are per-bibkey, not per-paragraph.

## Infrastructure sidecars (non-card)

The app's per-paper state. A skill **reads** these to orient and **never
hand-edits** the writeback-owned ones ([gardening.md](gardening.md#the-deny-list)).

```ts
// virgil.json — paragraph titles + content fingerprints
VirgilSidecar  { paragraphs: Record<string, ParagraphMeta> }
ParagraphMeta  { title?; fingerprint?; collapsed? }
// editor-state.json
EditorStateData { lastParagraphId: string | null; foldedSections: string[];
                  lastModified; cursorPosition?/*dep*/; selection?/*dep*/ }
// notifications.json
DocNotificationsInbox { items: DocNotification[] }
DocNotification       { kind: "ai-request-complete"|"ai-request-failed";
                        at; summary; requestId? }
```

`collab.json` (the pen / turn-taking sidecar) and `document-settings.json`
(preamble style id) are typed outside `types.ts` — in their defining modules
[src/lib/collab.ts](../../src/lib/collab.ts) and
[src/lib/document-settings.ts](../../src/lib/document-settings.ts); `version.txt`
is a bare counter, not JSON. The pen / turn-taking subsystem is
[VIRGIL.md → The editing lock (the pen)](../architecture/VIRGIL.md#the-editing-lock-the-pen).

## Legacy / dead types

Still in `types.ts` (so they round-trip old sidecars) but **not the live card
path** — don't write them; flagged as pruning candidates:

- **`suggestions.json`** — `SuggestionsState { suggestions: Suggestion[];
  currentIndex; reviewedAt; documentHash }`, `Suggestion { id; explanation;
  original_text; suggested_text; revision; note; status }`. The pre-Revisions
  inline-review path.
- **`comments.json`** — `CommentsState { comments: UserComment[] }`, `UserComment
  { id; selectedText; comment; createdAt; resolved }`. Pre-card inline comments.
- **No live consumer at all** (the dead pre-card review pipeline — safe to prune):
  `SessionState`, `DocumentPayload`, `ReviewRequest`, `ClaudeSuggestion`.

## Coverage

This is the manifest's **type-accounting index** for `src/lib/types.ts` — the
field-level home the [Public-type registry](../architecture/VIRGIL.md#public-type-registry)
forward-points to. All **58** exported types are named below (schema above, or
doc-of-record noted), grouped by family:

- **Card interfaces + their `…State` wrappers** — Notes: `UserNote`,
  `HighlightCard`, `NoteCardItem`, `NotesState`. Todos: `TodoItem`, `TodoState`.
  Footnotes: `FootnoteRef`, `FootnotesState`, `OrphanedFootnote`. Citations:
  `CitationRef`, `CitationsState`, `CitationInfo`. Cutter: `CutterCommentCard`,
  `CutterSuggestionCard`, `CutterCard`, `CutterGoal`, `CutterState`,
  `CutItemLegacy`. Revisions: `RevisionCommentCard`, `RevisionSuggestionCard`,
  `RevisionCard`, `RevisionsTracker`, `RevisionsState`. Reports: `ReportCard`,
  `ReportRequestCard`, `ReportItem`, `ReportsState`. Examples: `ExampleRef`,
  `ExamplesState`. Archive: `ArchivedSnippet`, `ArchiveState`.
- **The Task surface** — `AiRequest`, `AiRequestKind`, `AiRequestStatus`,
  `AiRequestResult`, `AiRequestLink`, `AiRequestPayload`, `AiRequestsState`.
- **Notifications** — `DocNotification`, `DocNotificationsInbox`.
- **Bibliography support** — `BibEntry`, `BibReviewRequest`, `BibReviewState`,
  `BibSettings`, `BibEntryRequest`, `AnnotationsState`.
- **Infrastructure** — `VirgilSidecar`, `ParagraphMeta`, `EditorStateData`.
- **Legacy / dead residue** — `Suggestion`, `SuggestionsState`, `UserComment`,
  `CommentsState`, `SessionState`, `DocumentPayload`, `ReviewRequest`,
  `ClaudeSuggestion`.

Two of the 58 have their **doc-of-record elsewhere**: `OriginalAnchor` (the
Mode-B→A re-anchor record) and the `Link` family are owned by
[anchoring.md](anchoring.md) — their shapes live there, not duplicated above.

## Rules for skills

1. **The wrapper is thin; the card is the payload.** Write `{ "<list-key>": [ …,
   newCard ] }`; never replace the whole file with a bare array.
2. **Mirror `text` to `content`.** On a rich card, set the plain-text `text`
   alongside the `JSONContent` `content` — readers trust the mirror.
3. **Atom-linked cards have no `links`.** Don't add a `links` array to a
   `FootnoteRef` / `CitationRef`; their tie is id equality.
4. **Match the suggestion shape exactly** when drafting a `cutter-`/`revision-
   suggestion` (six text fields + `author` + `status`).
5. **Treat `ai-requests.json` + the infrastructure sidecars as writeback-owned** —
   route every change through `apply_response.py`.
