# CHIP 8 — Expected-Delta Matrix (cross-surface verification oracle)

Machine-readable companion: [`cells.json`](cells.json) — the flat Cartesian (action × applicableKind × surface) list the live sweep iterates. Live-sweep harness: [`_harness.js`](_harness.js) (inject via `preview_eval`; acquires `window.__v = {main, dh, cc}`).

**717** applicable cells across **5** categories; **653** carry a known risk (drive-live-first).

`applies` legend: **ok** = enabled & acts; **disabled** = greyed (gate fires); cells with `applies:absent` are not modeled (the surface never targets that kind) and are omitted from `cells.json`.

## Card actions (11)

| Action | Surfaces | Applicable kinds (ok / disabled) | Expected delta summary | Known risk |
|---|---|---|---|---|
| **highlight** | grab, lightning | **ok:** selection, atom-only:inline-math, atom-bearing:citation, paragraph, heading, blockquote, listItem, exampleItem, titleField, displayMath, codeBlock, bulletList, orderedList, figureBlock, texBlock, latexComment, linkedRange<br>**disabled:** selection:cursor-empty | **doc:** linkedAnchor mark added over the range (no block added/removed)<br>**sidecar:** highlights/notes sidecar +1 HighlightCard; anchor linkCard attr stamped on the mark<br>**tex:** \vlid{id}...\vlidend{id} paired markers wrap the highlighted text on round-trip (linkedRange sourceMarker 'vlid')<br>**lifecycle:** card selected + pinned (recentlyAdded) in notes panel, NOT popped as a float (mode omni); focusNewCard drops caret into card | Heading x highlight: must wrap heading LINE only (collectAnnotationRange) - a regression here corrupts \section{} braces and strips every linkedAnchor on reload (the C9/C11 bug). Drive heading x highlight live first. Also verify empty-selection grey-out in cursor mode (lightning mode:'cursor'). |
| **note** | grab, lightning | **ok:** selection, paragraph, heading, blockquote, listItem, exampleItem, titleField, displayMath, codeBlock, figureBlock, bulletList, orderedList, texBlock, latexComment, graphicsBlock, linkedRange | **doc:** for a range source: linkedAnchor mark added; for a block source: no doc change (Mode-A link only)<br>**sidecar:** notes.json +1 UserNote; targetKind recorded (paragraph for selection/linkedRange, the ref kind otherwise)<br>**tex:** range source -> \vlid markers; block source -> no .tex change (anchor lives in sidecar)<br>**lifecycle:** card selected + pinned in notes omni, focusNewCard into card body; not popped (mode omni) | — |
| **footnote** (`\footnote`) | grab, lightning, slash, typed | **ok:** cursor, selection, paragraph, heading, blockquote, listItem, exampleItem, titleField, linkedRange<br>**disabled:** displayMath, codeBlock, bulletList, orderedList, figureBlock, texBlock, latexComment, graphicsBlock, exampleBlock | **doc:** one inline footnote atom inserted (grab/lightning) or already-present (slash/typed, adopted not re-inserted)<br>**sidecar:** footnotes sidecar +1; pristine flag set when body blank; renumberFootnotes() reflows numbers<br>**tex:** \footnote{body} at the caret/passage-end (or \thanks{} when inside a titleField/author)<br>**lifecycle:** card pristine (blank -> click-away-discardable), pinned, selected; slash/typed soft-route never force-opens Footnotes panel; menu mode omni | Pristine alignment: typed \footnote{realtext} must pass pristine:false (footnote.ts:172 computes match[1].trim().length===0) so the click-away discarder doesn't reap a typed body. Drive typed-with-body live to confirm it is NOT reaped. Also: slash/typed adopt path runs renumberFootnotes but skips re-insert - verify no double-insert. |
| **citation** (`\cite`) | grab, lightning, slash, typed | **ok:** cursor, selection, paragraph, heading, blockquote, listItem, exampleItem, linkedRange<br>**disabled:** titleField, displayMath, codeBlock, bulletList, orderedList, figureBlock, texBlock, latexComment, graphicsBlock, exampleBlock | **doc:** one inline citation atom inserted (grab/lightning) or already-present (slash/typed)<br>**sidecar:** citations.json +1 CitationRef {id, command, keys (parsed from command), createdAt, unanchored absent (anchored)}; pristine marked when keys empty<br>**tex:** \cite{} (empty) or \cite{key} (typed full) at the passage-end/caret<br>**lifecycle:** anchored card selected + pinned; slash/typed focus the library-picker input and soft-route only if citations side collapsed/blank | Typed \cite{key} was the CHIP 4a-ii bug fix (previously made NO card). Drive typed full-command live: verify the card renders the parsed keys (command preserved) and is anchored. Verify bare \cite followed by space also registers an anchored card (citation.ts:182). Both must share the citationId of the synchronously-inserted atom. |
| **todo** | grab, lightning | **ok:** selection, paragraph, heading, blockquote, listItem, exampleItem, titleField, displayMath, codeBlock, figureBlock, bulletList, orderedList, texBlock, latexComment, graphicsBlock, linkedRange | **doc:** none (todo is purely a sidecar card with a Mode-A anchor; no mark, no atom)<br>**sidecar:** todos.json +1 TodoItem; textObjectIds link records paragraphId + targetKind<br>**tex:** none (todo anchor lives entirely in the sidecar)<br>**lifecycle:** card selected + pinned in todo omni, focusNewCard into card; not popped (mode omni) | — |
| **suggest-edit** | grab, lightning | **ok:** selection, paragraph, heading, blockquote, listItem, exampleItem, titleField, linkedRange<br>**disabled:** displayMath, codeBlock, bulletList, orderedList, figureBlock, texBlock, latexComment, graphicsBlock, exampleBlock | **doc:** range source -> linkedAnchor mark; block source -> none (Mode-A)<br>**sidecar:** revisions.json +1 RevisionCommentCard; targetKind recorded<br>**tex:** range source -> \vlid markers; block source -> none<br>**lifecycle:** card selected + pinned in revisions omni, focusNewCard; not popped (mode omni) | Low-medium. The label says 'suggest edit' but the gesture produces a comment card - verify the produced card kind is revision-comment (not revision-suggestion). The NON_PROSE_BLOCK drop of suggest-edit (alongside F/C) is easy to get wrong if NON_PROSE_BLOCK_ACTIONS is edited. |
| **cutter** | grab, lightning | **ok:** selection, paragraph, heading, blockquote, listItem, exampleItem, titleField, displayMath, codeBlock, figureBlock, bulletList, orderedList, texBlock, latexComment, graphicsBlock, linkedRange | **doc:** range source -> linkedAnchor mark; block source -> none (Mode-A)<br>**sidecar:** cutter.json +1 CutterCommentCard; targetKind recorded<br>**tex:** range source -> \vlid markers; block source -> none<br>**lifecycle:** card selected + pinned in cutter omni, focusNewCard; not popped (mode omni) | Low. Verify the produced kind is cutter-comment. cutter is in NON_PROSE_BLOCK_ACTIONS (unlike suggest-edit), so it stays enabled on non-prose blocks - confirm the asymmetry with suggest-edit. |
| **report** | grab, lightning | **ok:** selection, paragraph, heading, blockquote, listItem, exampleItem, titleField, displayMath, codeBlock, figureBlock, bulletList, orderedList, texBlock, latexComment, graphicsBlock, linkedRange | **doc:** range source -> linkedAnchor mark; block source -> none (Mode-A)<br>**sidecar:** reports.json +1 ReportRequestCard (kind report-request, not report); targetKind recorded<br>**tex:** range source -> \vlid markers; block source -> none<br>**lifecycle:** card selected + pinned in reports omni, focusNewCard; not popped (mode omni) | Low-medium. Verify the produced kind is report-request (not report). Both report and report-request pin under the same 'reports' RecentlyAddedKind bucket. |
| **duplicate** | grab, lightning | **ok:** selection, paragraph, heading, blockquote, codeBlock, listItem, exampleItem, bulletList, orderedList, displayMath, figureBlock, texBlock, graphicsBlock, latexComment, exampleBlock<br>**disabled:** titleField, linkedRange | **doc:** block(s) added - a duplicate of the outer node range inserted immediately after it (whole section for heading)<br>**sidecar:** for each cloned linkedAnchor/atom in the slice: cardLifecycle.clone forks a new sidecar entry (fresh id); cloned cards' links rewired to the clone<br>**tex:** duplicated block(s) re-serialized with fresh \vlid/\footnote/\cite ids; section duplicate for heading<br>**lifecycle:** no card produced (duplicate is structural); clone selected via NodeSelection/caret; heading x duplicate shows a section-scope confirm first (cancel = silent no-op) | HIGH - drive live first. Atom-only / atom-bearing: cloning a slice carrying footnote/citation/inline-math atoms must mint FRESH atom ids (else duplicate ids corrupt renumber - the atom_drag observer bug class). titleField x duplicate is double-guarded (action-set drop + tr.doc.check); confirm both. linkedRange x duplicate is dropped (id-uniqueness). Heading duplicate must copy the WHOLE section and warn. The pre-dispatch tr.doc.check() is the only thing preventing a doomed transaction. |
| **archive** | grab, lightning | **ok:** selection, atom-only:inline-math, atom-only:citation, atom-only:footnote, paragraph, heading, blockquote, codeBlock, listItem, exampleItem, bulletList, orderedList, displayMath, figureBlock, texBlock, graphicsBlock, latexComment, exampleBlock, linkedRange<br>**disabled:** titleField | **doc:** the outer/cascade-extended range deleted from the doc (block removed; wrapper swallowed if emptied)<br>**sidecar:** archive.json +1 ArchivedSnippet (rich content snapshot + reanchored paragraphId/targetKind); any linkedAnchor/atom sidecars inside the range deleted via cardLifecycle<br>**tex:** the archived block's .tex removed; its content preserved in the archive snippet sidecar (not the .tex)<br>**lifecycle:** snippet selected + pinned in archive omni; LIFECYCLE_DELETE_META suppresses MarginaliaAnchorGuard re-insert; TextObjectOrphanGuard sweeps orphaned Mode-A cards; per-kind confirm gates (cancel = silent no-op) | HIGH - drive live first. Atom-only line archive was a real bug (silently no-op'd, fixed 80170b3): verify $\lambda$-only / citation-only / footnote-only lines DO archive AND surface the destructive confirm. The empty-content bail uses slice content.size, NOT textContent. Cascade (last listItem/exampleItem collapses wrapper) and heading whole-section archive both need live checks. Reanchor: block source walks to previous anchorable; selection source keeps source paragraph. |
| **delete** | grab, lightning | **ok:** selection, atom-only:inline-math, atom-only:citation, atom-only:footnote, paragraph, heading, blockquote, codeBlock, listItem, exampleItem, bulletList, orderedList, displayMath, figureBlock, texBlock, graphicsBlock, latexComment, exampleBlock, linkedRange<br>**disabled:** titleField | **doc:** the outer/cascade-extended range deleted; emptied wrapper removed too<br>**sidecar:** every linkedAnchor/atom sidecar inside the range deleted via cardLifecycle.delete (no orphan sidecar entries left)<br>**tex:** the block's .tex removed entirely (along with nested \footnote/\cite/\vlid markers)<br>**lifecycle:** no card produced; LIFECYCLE_DELETE_META suppresses MarginaliaAnchorGuard re-insert; TextObjectOrphanGuard sweeps orphaned Mode-A cards; per-kind destructive confirm (danger tone) gates - cancel = silent no-op; on no-card path ed.view.focus() restores focus so Cmd-Z reaches the doc (B4) | HIGH - drive live first. Atom-only/atom-bearing: a math/cite/footnote-only line was SILENTLY DELETABLE without a confirm before 63ccace - verify the destructive confirm now surfaces. Cleanup must remove the nested footnote/citation sidecars (no orphans). Cascade on last listItem/exampleItem must swallow the wrapper. Heading delete = whole section, danger tone. Confirm focus restoration (B4) after the confirm dialog closes so Cmd-Z works. titleField delete must be disabled (singleton protection). |

## Heading + title (7)

| Action | Surfaces | Applicable kinds (ok / disabled) | Expected delta summary | Known risk |
|---|---|---|---|---|
| **heading-chapter** (`chapter`) | slash, lightning | **ok:** selection, atom-only:inline-math, paragraph, heading, blockquote, codeBlock, titleField<br>**disabled:** displayMath, texBlock, figureBlock, graphicsBlock, latexComment | **doc:** One block setBlockType'd to heading{level:1, numbered:true}; existing uuid preserved; no block count change.<br>**sidecar:** None - pure-PM, no sidecar.<br>**tex:** On serialize: the line becomes \chapter{<content>}; section auto-numbering recomputed by the heading-extension appendTransaction (editor-extensions.ts:1560).<br>**lifecycle:** No card produced. No float, no pin/pristine. | REAL multi-surface divergence OUTSIDE the registry: the Heading extension is configure({levels:[0..6]}), and that comment states levels drive BOTH 'input rules and keyboard shortcuts'. So StarterKit's Mod-Alt-1 and the markdown '# ' input rule are LIVE and call TipTap's toggleHeading/setHeading - a TOGGLE path that the alignment effort deliberately replaced with always-SET. A user pressing Mod-Alt-1 on an existing level-1 heading will toggle it back to paragraph - diverging from slash/dropdown SET. Drive this live: Mod-Alt-1 twice toggles, vs \chapter twice stays a heading. Also confirm '# ' input rule numbered:true consistency. |
| **heading-section** (`section`) | slash, lightning | **ok:** selection, paragraph, heading<br>**disabled:** displayMath, texBlock, figureBlock, graphicsBlock, latexComment | **doc:** One block setBlockType'd to heading{level:2, numbered:true}; existing uuid preserved; no block count change.<br>**sidecar:** None - pure-PM, no sidecar.<br>**tex:** On serialize: the line becomes \section{<content>}; section auto-numbering recomputed by the heading-extension appendTransaction (editor-extensions.ts:1560).<br>**lifecycle:** No card produced. No float, no pin/pristine. | Same keyboard/input-rule TOGGLE divergence as heading-chapter (Mod-Alt-2 / a markdown rule toggle vs the registry SET). The dropdown's prior behavior toggled; CHIP 5a unified on SET. Drive live: dropdown 'Section' on an existing section must STAY a section (no revert); 'Body' (setParagraph) is the ONLY way out. |
| **heading-subsection** (`subsection`) | slash, lightning | **ok:** selection, paragraph, heading<br>**disabled:** displayMath, texBlock, figureBlock, graphicsBlock | **doc:** One block setBlockType'd to heading{level:3, numbered:true}; existing uuid preserved; no block count change.<br>**sidecar:** None - pure-PM, no sidecar.<br>**tex:** On serialize: the line becomes \subsection{<content>}; section auto-numbering recomputed by the heading-extension appendTransaction (editor-extensions.ts:1560).<br>**lifecycle:** No card produced. No float, no pin/pristine. | Same keyboard-toggle (Mod-Alt-3) / input-rule divergence as the other heading rows. Lower priority to drive than chapter/section (less common), but the same root: levels[] enables StarterKit shortcuts that toggle. |
| **heading-subsubsection** (`subsubsection`) | slash, lightning | **ok:** selection, paragraph, heading<br>**disabled:** displayMath, texBlock, figureBlock, graphicsBlock | **doc:** One block setBlockType'd to heading{level:4, numbered:true}; existing uuid preserved; no block count change.<br>**sidecar:** None - pure-PM, no sidecar.<br>**tex:** On serialize: the line becomes \subsubsection{<content>}; section auto-numbering recomputed by the heading-extension appendTransaction (editor-extensions.ts:1560).<br>**lifecycle:** No card produced. No float, no pin/pristine. | Same keyboard-toggle (Mod-Alt-4) / input-rule divergence. NOTE the dropdown also lists out-of-registry levels 0 (Part), 5 (Paragraph heading), 6 (Subparagraph heading) which fall to a DIRECT setNode fallback - also SET+numbered but NOT through a registry row, so no slash twin and no coverage row. If a future chip adds \part etc., verify the fallback stays SET-consistent. |
| **title** (`title`) | slash | **ok:** selection, cursor, paragraph, titleField<br>**disabled:** displayMath, texBlock, figureBlock | **doc:** If absent: +1 titleField node at the doc top (order index 0). If present: ZERO doc mutation (caret move only).<br>**sidecar:** None - pure-PM, no card sidecar.<br>**tex:** If absent: +\title{} line on serialize. If present: no .tex change.<br>**lifecycle:** No card, no float. The titleField renders as an in-doc lozenge, not a panel card. | Drive live FIRST: the IDEMPOTENT branch is divergence-prone. (1) Run \title twice - second must be a no-op caret-move, NOT a duplicate node. (2) Run \title when a titleField exists but is NOT at index 0 - find scans ALL children so it should dedupe; confirm. (3) Canonical-order insert walks childOrder; verify a \title inserted when only \date exists lands BEFORE \date (title order 0 < date order 2). |
| **author** (`author`) | slash | **ok:** cursor, selection, titleField<br>**disabled:** displayMath, texBlock, figureBlock | **doc:** If absent: +1 titleField{field:'author'} at order index 1 (after any \title, before any \date / non-title). If present: zero doc mutation (caret move only).<br>**sidecar:** None.<br>**tex:** If absent: +\author{} on serialize. If present: no change.<br>**lifecycle:** No card, no float - in-doc lozenge. | Ordering insert is the risk: with both \title and \date present, \author must land at index 1 (between them). Verify live. Also verify idempotent no-op on a second \author. |
| **date** (`date`) | slash | **ok:** cursor, selection, titleField<br>**disabled:** displayMath, texBlock, figureBlock | **doc:** If absent: +1 titleField{field:'date', isToday:true, content=pretty-printed today} at order index 2. If present: zero doc mutation (caret move only).<br>**sidecar:** None.<br>**tex:** If absent: +\date{\today} on serialize (because isToday:true, NOT the expanded literal). If present: no change.<br>**lifecycle:** No card, no float - in-doc lozenge showing the pretty date. | Drive live FIRST - date carries the most behavior. (1) Verify INSERT pre-fills today's pretty date AND serializes to \date{\today} (NOT \date{June 14, 2026}). (2) Verify FIND-EXISTING does NOT overwrite a user-edited date with today. (3) Verify canonical ordering: \date lands LAST among title fields (index 2); with \maketitle present it goes BEFORE \maketitle (order:99 for non-titles). This \maketitle-ordering is the subtlest case. |

## Block inserts (6)

| Action | Surfaces | Applicable kinds (ok / disabled) | Expected delta summary | Known risk |
|---|---|---|---|---|
| **example** (`ex`) | slash, lightning | **ok:** selection, cursor, paragraph, heading<br>**disabled:** displayMath, texBlock, graphicsBlock, latexComment, selection:collab-readonly | **doc:** One exampleBlock added (kind:'single', attrs uuid + tag/label/exnoOverride:null/suppressSpace:false/number:0), content = [paragraph] (seeded inline on wrap, empty on insert). On wrap the selected range is deleted first. buildExampleNode is the SSOT.<br>**sidecar:** None - exampleBlock is a pure in-doc node. The only out-of-doc effect is the transient Examples-panel selectedExampleId state (slash surface).<br>**tex:** \ex <inline content>\vexid{<uuid>}\n (serializeExampleBlock). Empty insert -> \ex with empty body. Requires \providecommand{\vexid}[1]{}.<br>**lifecycle:** No card produced. Caret parked in new block's first paragraph. Slash: selectedExampleId set to new uuid (soft panel-select, no force-open). | Drive the WRAP-on-atom-only-selection case live FIRST: when the selection holds ONLY an inline atom (citation/$\lambda$/\ref) and no text, extractInlineFromSlice returns it via hasUsable=true and WRAPS it - unlike texRun/mathRun which BAIL on an atom-only selection. example's atom-only behavior INTENTIONALLY diverges from tex/math: example MOVES the atom into the item paragraph. Verify the atom survives the deleteSelection->insert round-trip (the observer multi-step move-bug class). Also: the lightning grid uses a SEPARATE hand-rolled ctx builder (wrapSelectionInExample, ActionsMenuPanel:274) that calls exampleRun directly - verify it stays in sync with the bridge ctx. |
| **tex** (`tex`) | slash, lightning | **ok:** selection, cursor, paragraph<br>**disabled:** displayMath, texBlock, graphicsBlock, latexComment, selection:collab-readonly | **doc:** One texBlock added (attrs: uuid via the single collision-free scan, code = seedCode \| ''). On a text-bearing selection the range is deleted first.<br>**sidecar:** None - texBlock is a pure in-doc node, no JSON sidecar.<br>**tex:** %!vtex:begin <uuid>\n<escaped code>\n%!vtex:end <uuid>\n\n (serializeTexBlock; raw passthrough between sentinels). \vtex sentinels are comments, no command needed.<br>**lifecycle:** No card produced. Caret left at the inserted block. No panel hop on either surface. | Drive the lightning tex cell live FIRST: it is wired as onClick={() => insertTexBlock(editor)} (ActionsMenuPanel:569), NOT runGridAction('tex') - it bypasses the unified grid ctx (no canEdit thread). insertTexBlock builds a minimal ctx WITHOUT canEdit, so texRun's isCollabReadOnly returns false - the collab read-only gate is effectively INERT on the grid tex cell. In a collab read-only session the grid tex cell would attempt the insert (relying on readOnlyEnforcer to reject) where slash explicitly no-ops at view.editable. Verify the grid tex cell is greyed/blocked under collab read-only. Also verify the atom-only-selection data-loss guard on BOTH surfaces. |
| **figure** | lightning | **ok:** selection, cursor, paragraph<br>**disabled:** displayMath, texBlock, graphicsBlock, latexComment, selection:collab-readonly | **doc:** One figureBlock added via smartInsertBlock (deleteSelection if non-empty, then replaceSelectionWith), content=[figureCaption]. uuid minted collision-free. Position relocated post-dispatch by uuid for the popover anchor.<br>**sidecar:** None - figureBlock is a pure in-doc node (attrs + figureCaption sub-node), no JSON sidecar.<br>**tex:** \begin{figure}...\centering \includegraphics[width=0.6\textwidth]{} \caption{} (label \label{fig:} when present)...\end{figure}. The fresh stub has an EMPTY image path until the user fills the popover.<br>**lifecycle:** No card produced. The source popover opens (one rAF later) for the user to fill the \includegraphics path/label. | Drive the rAF-deferred popover live FIRST in the backgrounded preview - rAF is paused when backgrounded, so the popover-open + relocateBlock(uuid) lookup inside the rAF may never fire under test; shim rAF->setTimeout. Also verify the REPLACE-selection policy on a non-empty selection: smartInsertBlock deletes the selected range and drops the figure in its place - confirm this is the intended (documented) behavior vs surprising data loss. |
| **graphics** | lightning | **ok:** selection, cursor, paragraph<br>**disabled:** displayMath, texBlock, graphicsBlock, latexComment, selection:collab-readonly | **doc:** One graphicsBlock added via smartInsertBlock, no content. uuid minted collision-free. Position relocated post-dispatch by uuid for the popover anchor.<br>**sidecar:** None - graphicsBlock is a pure in-doc node (attrs-only), no JSON sidecar.<br>**tex:** Verbatim \includegraphics[width=0.5\textwidth]{} (standalone, serializeGraphicsBlock emits attrs.command verbatim; \vxid{<uuid>} marker). Empty path until the user fills the popover.<br>**lifecycle:** No card produced. Source popover opens (one rAF later) seeded with attrs.command. | Same rAF-pause caveat as figure (shim rAF->setTimeout in the backgrounded preview). Note the self-kind 'disabled' (graphicsBlock x graphics) is correct-by-design but is the kind of cell to spot-check it isn't accidentally 'absent'/missing in the grid. REPLACE-on-selection: confirm a non-empty selection is intentionally consumed. |
| **inline-math** | lightning | **ok:** selection, cursor, paragraph<br>**disabled:** displayMath, texBlock, graphicsBlock, latexComment, selection:collab-readonly | **doc:** One inlineMath inline atom inserted (attrs:{latex}, NO uuid). On a text-bearing selection the range is deleted first.<br>**sidecar:** None - inlineMath is a pure in-doc inline atom, no JSON sidecar.<br>**tex:** $<latex>$ inline. Empty selection -> $x$.<br>**lifecycle:** No card produced. Caret after the inserted inline atom (insertContent default). | Drive the atom-only-selection data-loss guard live FIRST (mathRun:1889): selecting a lone citation/\ref/$math$ and hitting inline-math must BAIL, NOT replace the atom with $x$. Same guard texRun has and example INTENTIONALLY lacks - confirm the divergence is correct. Lower priority: 'inline-math' is mislabeled category:'block' though it yields an inline atom; note it for the oracle's category-consistency check. |
| **display-math** | lightning | **ok:** selection, cursor, paragraph<br>**disabled:** displayMath, texBlock, graphicsBlock, latexComment, selection:collab-readonly | **doc:** One displayMath block atom inserted (attrs:{latex}; uuid absent/lazy - hydrated by ensureAnchorUuid on first interaction). On a text-bearing selection the range is deleted first. displayMath is a block atom - PM lifts the insert out of an inline container automatically.<br>**sidecar:** None - displayMath is a pure in-doc block atom, no JSON sidecar.<br>**tex:** \[\n<latex>\n\]<anchor>\n\n (serializer line 386; the %!v anchor appended only when the equation carries a uuid - absent until lazy-hydrated). Empty selection -> \[\n\int f(x)\,dx\n\].<br>**lifecycle:** No card produced. uuid hydrated lazily (ensureAnchorUuid) on first interaction, NOT at insert. | Drive the lazy-uuid behavior live FIRST: displayMath is NOT pre-minted a uuid (unlike tex/figure/graphics/example), so a freshly inserted display equation serializes WITHOUT a %!v anchor until ensureAnchorUuid runs on first interaction. Verify the round-trip is stable (insert->serialize->reparse) for an un-interacted equation, and that a card anchored to it later isn't orphaned by the late uuid. Also verify the atom-only-selection data-loss guard (same as inline-math). |

## Atom ref (1)

| Action | Surfaces | Applicable kinds (ok / disabled) | Expected delta summary | Known risk |
|---|---|---|---|---|
| **ref** (`\ref`) | slash, lightning | **ok:** selection, cursor, paragraph, heading, bulletList, orderedList, blockquote, codeBlock, titleField, figureBlock, exampleBlock, listItem, exampleItem, linkedRange, atom-only:ref, atom-bearing:ref<br>**disabled:** displayMath, texBlock, latexComment, graphicsBlock, collab-read-only | **doc:** refRun ALONE produces NO docDelta (no atom inserted; the cross-surface test asserts labelRefs===0 after the action). The atom lands only on a SUBSEQUENT user pick: handleInsertRef does insertContent({type:'labelRef', attrs:{label, displayText, refCommand, targetKind}}). refCommand defaults to 'ref'.<br>**sidecar:** NONE. Unlike citation/footnote, \ref has NO card and NO sidecar - the labelRef atom is self-contained in the .tex and the popover is the only creator. No panelRouting, no cardCreation touched.<br>**tex:** On user pick: \ref{<label>} (or \getref{...}/\getfullref{...} when refCommand is getref/getfullref). The labelRef node carries {label, displayText, refCommand, targetKind}; only label + refCommand are load-bearing for the serializer. refRun itself emits NO texDelta.<br>**lifecycle:** NO card lifecycle - \ref mints no float, no pinned/pristine card (card-LESS by design, atom-registry.ts:63 idAttr:null). The only transient state is the LabelRef popover open/close. | DRIVE LIVE FIRST - three concerns: (1) The caret-rect computation is HAND-ROLLED in TWO places (EditorPane.tsx:2233 and ActionsMenuPanel.tsx:253) rather than centralized - they currently match byte-for-byte, but this is exactly the divergence class CHIP 8 hunts; a future edit to one will silently drift the popover anchor. Diff the two DOMRect expressions live and confirm both popovers anchor at the identical screen position. (2) figureBlock isAtomBlock:false vs the REF_ACTION_ROW jsdoc claiming figure -> 'disabled' - confirm whether ref is ever reachable on a figureBlock and whether the doc should be corrected. (3) The lightning cell is gated by THREE canEdit checks while slash relies on only the refRun early-return - verify a collab read-only doc greys the grid cell AND no-ops the slash command, with no popover ever appearing. |

## Format marks

| Action | Surfaces | Applicable kinds (ok / disabled) | Expected delta summary | Known risk |
|---|---|---|---|---|
| **bold** | lightning | **ok:** selection, paragraph, heading, listItem, blockquote, exampleItem, atom-only:inline-math, atom-bearing:citation, titleField | **doc:** strong mark added/removed on the selected inline range (or stored-mark toggled, no doc change, at a caret). No block added/removed/converted.<br>**sidecar:** none - backbone tiptap-chain, no sidecar.<br>**tex:** selection serialized to \textbf{...} (or unwrapped) on the next .tex sync via code-pane-bridge; no atom marker, no %!v marker.<br>**lifecycle:** no card produced. | Keyboard-surface omission: Mod-b is live at runtime but surfaces.keyboard is FALSE (coverage assertion at registry:2875-2884 forbids surfaces.keyboard on format rows - keybindings are owned by StarterKit). Verify the keystroke path and the grid path stay behaviorally identical AND that collab read-only blocks BOTH (grid via run() guard, keyboard via readOnlyEnforcer). A held Mod-b while a partner holds the pen is the belt-and-suspenders case the run() guard comment at registry:2135-2138 calls out. |
| **italic** | lightning | **ok:** selection, paragraph, heading, listItem, blockquote, exampleItem, atom-only:inline-math, atom-bearing:citation, titleField | **doc:** italic mark added/removed on the selected inline range (or stored-mark toggled, no doc change, at a caret). No block added/removed/converted.<br>**sidecar:** none - backbone tiptap-chain, no sidecar.<br>**tex:** selection serialized to \textit{...} (or unwrapped) on the next .tex sync via code-pane-bridge; no atom marker, no %!v marker.<br>**lifecycle:** no card produced. | Keyboard-surface omission: Mod-i is live at runtime but surfaces.keyboard is FALSE (coverage assertion at registry:2875-2884 forbids surfaces.keyboard on format rows - keybindings are owned by StarterKit). Verify the keystroke path and the grid path stay behaviorally identical AND that collab read-only blocks BOTH (grid via run() guard, keyboard via readOnlyEnforcer). Lower-risk than the lifecycle actions; drive once to confirm grid==keystroke parity and the collab gate on both. |
| **strike** | lightning | **ok:** selection, paragraph, heading, listItem, blockquote, exampleItem, atom-only:inline-math, atom-bearing:citation, titleField | **doc:** strike mark added/removed on the selected inline range (or stored-mark toggled, no doc change, at a caret). No block added/removed/converted.<br>**sidecar:** none - backbone tiptap-chain, no sidecar.<br>**tex:** selection serialized to \sout{...} (or unwrapped) on the next .tex sync via code-pane-bridge; no atom marker, no %!v marker.<br>**lifecycle:** no card produced. | Keyboard-surface omission: Mod-Shift-s is live at runtime but surfaces.keyboard is FALSE (coverage assertion at registry:2875-2884 forbids surfaces.keyboard on format rows - keybindings are owned by StarterKit). Verify the keystroke path and the grid path stay behaviorally identical AND that collab read-only blocks BOTH (grid via run() guard, keyboard via readOnlyEnforcer). Strike has NO grid keybinding hint in the cell title (ActionsMenuPanel:432, no shortcut shown), unlike Bold/Italic - minor UI inconsistency, not a behavioral bug. |
| **code** | lightning | **ok:** selection, paragraph, heading, listItem, blockquote, exampleItem, atom-only:inline-math, atom-bearing:citation, titleField, codeBlock | **doc:** code mark added/removed on the selected inline range (or stored-mark toggled, no doc change, at a caret). No block added/removed/converted.<br>**sidecar:** none - backbone tiptap-chain, no sidecar.<br>**tex:** selection serialized to \texttt{...} (or unwrapped) on the next .tex sync via code-pane-bridge; no atom marker, no %!v marker.<br>**lifecycle:** no card produced. | Keyboard-surface omission: Mod-e is live at runtime but surfaces.keyboard is FALSE (coverage assertion at registry:2875-2884 forbids surfaces.keyboard on format rows - keybindings are owned by StarterKit). Verify the keystroke path and the grid path stay behaviorally identical AND that collab read-only blocks BOTH (grid via run() guard, keyboard via readOnlyEnforcer). NAMING TRAP - id 'code' is the inline code MARK, easily confused with the codeBlock text-object kind. Drive live to confirm the grid cell toggles the inline mark and never wraps a codeBlock, and that Mod-e does the same. Note the codeBlock kind below is applies:'ok' for this row because the INLINE mark toggles inside a code block (a near-no-op), distinct from the codeBlock NODE. |
| **bullet-list** | lightning | **ok:** paragraph, selection, bulletList, orderedList, listItem, heading, blockquote, titleField<br>**absent:** displayMath, figureBlock, graphicsBlock, texBlock, latexComment | **doc:** current block(s) wrapped into a bulletList (listItem children) - or, on an existing bulletList, lifted back to paragraphs. Structural node change (wrap/lift), not a mark.<br>**sidecar:** none - backbone tiptap-chain, no sidecar.<br>**tex:** selection's blocks serialized into \begin{itemize}...\item...\end{itemize} (or unwrapped) on the next .tex sync; no marker.<br>**lifecycle:** no card produced. | RECONSTRUCTED-TAIL (the bullet-list/ordered-list/blockquote rows were truncated in the source oracle JSON - reconstructed from the shared formatToggleRow shape; verify field-by-field against action-registry.ts before relying on the doc). Concern: applies() is unconditionally 'ok' for heading/titleField but toggleBulletList may be a structural no-op there - the applies()-vs-effect divergence (an enabled cell that does nothing). Drive a bulletList-toggle on a heading and on a titleField live to see whether the cell should be greyed. Also: the markdown input rule ('- '/'1. ') is a SECOND live surface not in the registry - confirm it produces the same structure as the grid. |
| **ordered-list** | lightning | **ok:** paragraph, selection, bulletList, orderedList, listItem, heading, blockquote, titleField<br>**absent:** displayMath, figureBlock, graphicsBlock, texBlock, latexComment | **doc:** current block(s) wrapped into a orderedList (listItem children) - or, on an existing orderedList, lifted back to paragraphs. Structural node change (wrap/lift), not a mark.<br>**sidecar:** none - backbone tiptap-chain, no sidecar.<br>**tex:** selection's blocks serialized into \begin{enumerate}...\item...\end{enumerate} (or unwrapped) on the next .tex sync; no marker.<br>**lifecycle:** no card produced. | RECONSTRUCTED-TAIL (the bullet-list/ordered-list/blockquote rows were truncated in the source oracle JSON - reconstructed from the shared formatToggleRow shape; verify field-by-field against action-registry.ts before relying on the doc). Concern: applies() is unconditionally 'ok' for heading/titleField but toggleOrderedList may be a structural no-op there - the applies()-vs-effect divergence (an enabled cell that does nothing). Drive a orderedList-toggle on a heading and on a titleField live to see whether the cell should be greyed. Also: the markdown input rule ('- '/'1. ') is a SECOND live surface not in the registry - confirm it produces the same structure as the grid. |
| **blockquote** | lightning | **ok:** paragraph, selection, blockquote, heading, listItem, titleField<br>**absent:** displayMath, figureBlock, graphicsBlock, texBlock, latexComment | **doc:** current block(s) wrapped into a blockquote - or, on an existing blockquote, lifted back to paragraphs. Structural node change, not a mark.<br>**sidecar:** none - backbone tiptap-chain, no sidecar.<br>**tex:** selection's blocks serialized into \begin{quote}...\end{quote} (or unwrapped) on the next .tex sync; no marker.<br>**lifecycle:** no card produced. | RECONSTRUCTED-TAIL (the blockquote row was truncated in the source oracle JSON - reconstructed from the shared formatToggleRow shape; verify field-by-field against action-registry.ts before relying on the doc). Concern: applies() is unconditionally 'ok' for heading/titleField but toggleBlockquote may be a structural no-op there - the applies()-vs-effect divergence. Drive a blockquote-toggle on a heading and on a titleField live. Also: the '> ' markdown input rule is a SECOND live surface not in the registry - confirm parity with the grid. |
| **text-color** | lightning | **ok:** selection, paragraph, heading, listItem, blockquote, exampleItem, titleField<br>**absent:** displayMath, figureBlock, graphicsBlock, texBlock, latexComment | **doc:** On user pick: a textStyle/color mark added/removed on the selected inline range (or stored-mark at a caret). run() ALONE opens the popover, no docDelta until the pick.<br>**sidecar:** none - backbone tiptap-chain, no sidecar.<br>**tex:** selection wrapped in the project's color macro (e.g. \textcolor{...}{...}) on the next .tex sync; no marker.<br>**lifecycle:** no card produced. Transient color-popover open/close state only. | RECONSTRUCTED-TAIL (the text-color row was beyond the truncation point in the source oracle JSON - reconstructed from the figure/graphics popover-routed pattern + the runGridAction color seam; verify the exact run()/seam name and tex macro against action-registry.ts + the color popover before relying on the doc). Concern: like ref/figure, the popover-open is RAF/event-driven - drive live in the backgrounded preview (shim rAF->setTimeout) and confirm the color mark round-trips through .tex. |

## Drive-live-first priority list

Every cell carrying a known risk, HIGH-risk first. These are the cells where a code-read ✓ is NOT a ✓ — drive the real surface in the live app before trusting the predicted delta.

| # | Action | Surfaces | Category | Risk |
|---|---|---|---|---|
| 1 | **archive** | grab, lightning | Card actions (11) | HIGH - drive live first. Atom-only line archive was a real bug (silently no-op'd, fixed 80170b3): verify $\lambda$-only / citation-only / footnote-only lines DO archive AND surface the destructive confirm. The empty-content bail uses slice content.size, NOT textContent. Cascade (last listItem/exampleItem collapses wrapper) and heading whole-section archive both need live checks. Reanchor: block source walks to previous anchorable; selection source keeps source paragraph. |
| 2 | **delete** | grab, lightning | Card actions (11) | HIGH - drive live first. Atom-only/atom-bearing: a math/cite/footnote-only line was SILENTLY DELETABLE without a confirm before 63ccace - verify the destructive confirm now surfaces. Cleanup must remove the nested footnote/citation sidecars (no orphans). Cascade on last listItem/exampleItem must swallow the wrapper. Heading delete = whole section, danger tone. Confirm focus restoration (B4) after the confirm dialog closes so Cmd-Z works. titleField delete must be disabled (singleton protection). |
| 3 | **duplicate** | grab, lightning | Card actions (11) | HIGH - drive live first. Atom-only / atom-bearing: cloning a slice carrying footnote/citation/inline-math atoms must mint FRESH atom ids (else duplicate ids corrupt renumber - the atom_drag observer bug class). titleField x duplicate is double-guarded (action-set drop + tr.doc.check); confirm both. linkedRange x duplicate is dropped (id-uniqueness). Heading duplicate must copy the WHOLE section and warn. The pre-dispatch tr.doc.check() is the only thing preventing a doomed transaction. |
| 4 | **date** | slash | Heading + title (7) | Drive live FIRST - date carries the most behavior. (1) Verify INSERT pre-fills today's pretty date AND serializes to \date{\today} (NOT \date{June 14, 2026}). (2) Verify FIND-EXISTING does NOT overwrite a user-edited date with today. (3) Verify canonical ordering: \date lands LAST among title fields (index 2); with \maketitle present it goes BEFORE \maketitle (order:99 for non-titles). This \maketitle-ordering is the subtlest case. |
| 5 | **title** | slash | Heading + title (7) | Drive live FIRST: the IDEMPOTENT branch is divergence-prone. (1) Run \title twice - second must be a no-op caret-move, NOT a duplicate node. (2) Run \title when a titleField exists but is NOT at index 0 - find scans ALL children so it should dedupe; confirm. (3) Canonical-order insert walks childOrder; verify a \title inserted when only \date exists lands BEFORE \date (title order 0 < date order 2). |
| 6 | **display-math** | lightning | Block inserts (6) | Drive the lazy-uuid behavior live FIRST: displayMath is NOT pre-minted a uuid (unlike tex/figure/graphics/example), so a freshly inserted display equation serializes WITHOUT a %!v anchor until ensureAnchorUuid runs on first interaction. Verify the round-trip is stable (insert->serialize->reparse) for an un-interacted equation, and that a card anchored to it later isn't orphaned by the late uuid. Also verify the atom-only-selection data-loss guard (same as inline-math). |
| 7 | **example** | slash, lightning | Block inserts (6) | Drive the WRAP-on-atom-only-selection case live FIRST: when the selection holds ONLY an inline atom (citation/$\lambda$/\ref) and no text, extractInlineFromSlice returns it via hasUsable=true and WRAPS it - unlike texRun/mathRun which BAIL on an atom-only selection. example's atom-only behavior INTENTIONALLY diverges from tex/math: example MOVES the atom into the item paragraph. Verify the atom survives the deleteSelection->insert round-trip (the observer multi-step move-bug class). Also: the lightning grid uses a SEPARATE hand-rolled ctx builder (wrapSelectionInExample, ActionsMenuPanel:274) that calls exampleRun directly - verify it stays in sync with the bridge ctx. |
| 8 | **figure** | lightning | Block inserts (6) | Drive the rAF-deferred popover live FIRST in the backgrounded preview - rAF is paused when backgrounded, so the popover-open + relocateBlock(uuid) lookup inside the rAF may never fire under test; shim rAF->setTimeout. Also verify the REPLACE-selection policy on a non-empty selection: smartInsertBlock deletes the selected range and drops the figure in its place - confirm this is the intended (documented) behavior vs surprising data loss. |
| 9 | **inline-math** | lightning | Block inserts (6) | Drive the atom-only-selection data-loss guard live FIRST (mathRun:1889): selecting a lone citation/\ref/$math$ and hitting inline-math must BAIL, NOT replace the atom with $x$. Same guard texRun has and example INTENTIONALLY lacks - confirm the divergence is correct. Lower priority: 'inline-math' is mislabeled category:'block' though it yields an inline atom; note it for the oracle's category-consistency check. |
| 10 | **tex** | slash, lightning | Block inserts (6) | Drive the lightning tex cell live FIRST: it is wired as onClick={() => insertTexBlock(editor)} (ActionsMenuPanel:569), NOT runGridAction('tex') - it bypasses the unified grid ctx (no canEdit thread). insertTexBlock builds a minimal ctx WITHOUT canEdit, so texRun's isCollabReadOnly returns false - the collab read-only gate is effectively INERT on the grid tex cell. In a collab read-only session the grid tex cell would attempt the insert (relying on readOnlyEnforcer to reject) where slash explicitly no-ops at view.editable. Verify the grid tex cell is greyed/blocked under collab read-only. Also verify the atom-only-selection data-loss guard on BOTH surfaces. |
| 11 | **ref** | slash, lightning | Atom ref (1) | DRIVE LIVE FIRST - three concerns: (1) The caret-rect computation is HAND-ROLLED in TWO places (EditorPane.tsx:2233 and ActionsMenuPanel.tsx:253) rather than centralized - they currently match byte-for-byte, but this is exactly the divergence class CHIP 8 hunts; a future edit to one will silently drift the popover anchor. Diff the two DOMRect expressions live and confirm both popovers anchor at the identical screen position. (2) figureBlock isAtomBlock:false vs the REF_ACTION_ROW jsdoc claiming figure -> 'disabled' - confirm whether ref is ever reachable on a figureBlock and whether the doc should be corrected. (3) The lightning cell is gated by THREE canEdit checks while slash relies on only the refRun early-return - verify a collab read-only doc greys the grid cell AND no-ops the slash command, with no popover ever appearing. |
| 12 | **citation** | grab, lightning, slash, typed | Card actions (11) | Typed \cite{key} was the CHIP 4a-ii bug fix (previously made NO card). Drive typed full-command live: verify the card renders the parsed keys (command preserved) and is anchored. Verify bare \cite followed by space also registers an anchored card (citation.ts:182). Both must share the citationId of the synchronously-inserted atom. |
| 13 | **cutter** | grab, lightning | Card actions (11) | Low. Verify the produced kind is cutter-comment. cutter is in NON_PROSE_BLOCK_ACTIONS (unlike suggest-edit), so it stays enabled on non-prose blocks - confirm the asymmetry with suggest-edit. |
| 14 | **footnote** | grab, lightning, slash, typed | Card actions (11) | Pristine alignment: typed \footnote{realtext} must pass pristine:false (footnote.ts:172 computes match[1].trim().length===0) so the click-away discarder doesn't reap a typed body. Drive typed-with-body live to confirm it is NOT reaped. Also: slash/typed adopt path runs renumberFootnotes but skips re-insert - verify no double-insert. |
| 15 | **highlight** | grab, lightning | Card actions (11) | Heading x highlight: must wrap heading LINE only (collectAnnotationRange) - a regression here corrupts \section{} braces and strips every linkedAnchor on reload (the C9/C11 bug). Drive heading x highlight live first. Also verify empty-selection grey-out in cursor mode (lightning mode:'cursor'). |
| 16 | **report** | grab, lightning | Card actions (11) | Low-medium. Verify the produced kind is report-request (not report). Both report and report-request pin under the same 'reports' RecentlyAddedKind bucket. |
| 17 | **suggest-edit** | grab, lightning | Card actions (11) | Low-medium. The label says 'suggest edit' but the gesture produces a comment card - verify the produced card kind is revision-comment (not revision-suggestion). The NON_PROSE_BLOCK drop of suggest-edit (alongside F/C) is easy to get wrong if NON_PROSE_BLOCK_ACTIONS is edited. |
| 18 | **author** | slash | Heading + title (7) | Ordering insert is the risk: with both \title and \date present, \author must land at index 1 (between them). Verify live. Also verify idempotent no-op on a second \author. |
| 19 | **heading-chapter** | slash, lightning | Heading + title (7) | REAL multi-surface divergence OUTSIDE the registry: the Heading extension is configure({levels:[0..6]}), and that comment states levels drive BOTH 'input rules and keyboard shortcuts'. So StarterKit's Mod-Alt-1 and the markdown '# ' input rule are LIVE and call TipTap's toggleHeading/setHeading - a TOGGLE path that the alignment effort deliberately replaced with always-SET. A user pressing Mod-Alt-1 on an existing level-1 heading will toggle it back to paragraph - diverging from slash/dropdown SET. Drive this live: Mod-Alt-1 twice toggles, vs \chapter twice stays a heading. Also confirm '# ' input rule numbered:true consistency. |
| 20 | **heading-section** | slash, lightning | Heading + title (7) | Same keyboard/input-rule TOGGLE divergence as heading-chapter (Mod-Alt-2 / a markdown rule toggle vs the registry SET). The dropdown's prior behavior toggled; CHIP 5a unified on SET. Drive live: dropdown 'Section' on an existing section must STAY a section (no revert); 'Body' (setParagraph) is the ONLY way out. |
| 21 | **heading-subsection** | slash, lightning | Heading + title (7) | Same keyboard-toggle (Mod-Alt-3) / input-rule divergence as the other heading rows. Lower priority to drive than chapter/section (less common), but the same root: levels[] enables StarterKit shortcuts that toggle. |
| 22 | **heading-subsubsection** | slash, lightning | Heading + title (7) | Same keyboard-toggle (Mod-Alt-4) / input-rule divergence. NOTE the dropdown also lists out-of-registry levels 0 (Part), 5 (Paragraph heading), 6 (Subparagraph heading) which fall to a DIRECT setNode fallback - also SET+numbered but NOT through a registry row, so no slash twin and no coverage row. If a future chip adds \part etc., verify the fallback stays SET-consistent. |
| 23 | **graphics** | lightning | Block inserts (6) | Same rAF-pause caveat as figure (shim rAF->setTimeout in the backgrounded preview). Note the self-kind 'disabled' (graphicsBlock x graphics) is correct-by-design but is the kind of cell to spot-check it isn't accidentally 'absent'/missing in the grid. REPLACE-on-selection: confirm a non-empty selection is intentionally consumed. |
| 24 | **blockquote** | lightning | Format marks | RECONSTRUCTED-TAIL (the blockquote row was truncated in the source oracle JSON - reconstructed from the shared formatToggleRow shape; verify field-by-field against action-registry.ts before relying on the doc). Concern: applies() is unconditionally 'ok' for heading/titleField but toggleBlockquote may be a structural no-op there - the applies()-vs-effect divergence. Drive a blockquote-toggle on a heading and on a titleField live. Also: the '> ' markdown input rule is a SECOND live surface not in the registry - confirm parity with the grid. |
| 25 | **bold** | lightning | Format marks | Keyboard-surface omission: Mod-b is live at runtime but surfaces.keyboard is FALSE (coverage assertion at registry:2875-2884 forbids surfaces.keyboard on format rows - keybindings are owned by StarterKit). Verify the keystroke path and the grid path stay behaviorally identical AND that collab read-only blocks BOTH (grid via run() guard, keyboard via readOnlyEnforcer). A held Mod-b while a partner holds the pen is the belt-and-suspenders case the run() guard comment at registry:2135-2138 calls out. |
| 26 | **bullet-list** | lightning | Format marks | RECONSTRUCTED-TAIL (the bullet-list/ordered-list/blockquote rows were truncated in the source oracle JSON - reconstructed from the shared formatToggleRow shape; verify field-by-field against action-registry.ts before relying on the doc). Concern: applies() is unconditionally 'ok' for heading/titleField but toggleBulletList may be a structural no-op there - the applies()-vs-effect divergence (an enabled cell that does nothing). Drive a bulletList-toggle on a heading and on a titleField live to see whether the cell should be greyed. Also: the markdown input rule ('- '/'1. ') is a SECOND live surface not in the registry - confirm it produces the same structure as the grid. |
| 27 | **code** | lightning | Format marks | Keyboard-surface omission: Mod-e is live at runtime but surfaces.keyboard is FALSE (coverage assertion at registry:2875-2884 forbids surfaces.keyboard on format rows - keybindings are owned by StarterKit). Verify the keystroke path and the grid path stay behaviorally identical AND that collab read-only blocks BOTH (grid via run() guard, keyboard via readOnlyEnforcer). NAMING TRAP - id 'code' is the inline code MARK, easily confused with the codeBlock text-object kind. Drive live to confirm the grid cell toggles the inline mark and never wraps a codeBlock, and that Mod-e does the same. Note the codeBlock kind below is applies:'ok' for this row because the INLINE mark toggles inside a code block (a near-no-op), distinct from the codeBlock NODE. |
| 28 | **italic** | lightning | Format marks | Keyboard-surface omission: Mod-i is live at runtime but surfaces.keyboard is FALSE (coverage assertion at registry:2875-2884 forbids surfaces.keyboard on format rows - keybindings are owned by StarterKit). Verify the keystroke path and the grid path stay behaviorally identical AND that collab read-only blocks BOTH (grid via run() guard, keyboard via readOnlyEnforcer). Lower-risk than the lifecycle actions; drive once to confirm grid==keystroke parity and the collab gate on both. |
| 29 | **ordered-list** | lightning | Format marks | RECONSTRUCTED-TAIL (the bullet-list/ordered-list/blockquote rows were truncated in the source oracle JSON - reconstructed from the shared formatToggleRow shape; verify field-by-field against action-registry.ts before relying on the doc). Concern: applies() is unconditionally 'ok' for heading/titleField but toggleOrderedList may be a structural no-op there - the applies()-vs-effect divergence (an enabled cell that does nothing). Drive a orderedList-toggle on a heading and on a titleField live to see whether the cell should be greyed. Also: the markdown input rule ('- '/'1. ') is a SECOND live surface not in the registry - confirm it produces the same structure as the grid. |
| 30 | **strike** | lightning | Format marks | Keyboard-surface omission: Mod-Shift-s is live at runtime but surfaces.keyboard is FALSE (coverage assertion at registry:2875-2884 forbids surfaces.keyboard on format rows - keybindings are owned by StarterKit). Verify the keystroke path and the grid path stay behaviorally identical AND that collab read-only blocks BOTH (grid via run() guard, keyboard via readOnlyEnforcer). Strike has NO grid keybinding hint in the cell title (ActionsMenuPanel:432, no shortcut shown), unlike Bold/Italic - minor UI inconsistency, not a behavioral bug. |
| 31 | **text-color** | lightning | Format marks | RECONSTRUCTED-TAIL (the text-color row was beyond the truncation point in the source oracle JSON - reconstructed from the figure/graphics popover-routed pattern + the runGridAction color seam; verify the exact run()/seam name and tex macro against action-registry.ts + the color popover before relying on the doc). Concern: like ref/figure, the popover-open is RAF/event-driven - drive live in the backgrounded preview (shim rAF->setTimeout) and confirm the color mark round-trips through .tex. |

## Cross-surface identity invariants

The byte-identity claims the sweep must refute per action (where >1 surface exists) or the internal invariant (single-surface).

- **highlight** (grab, lightning): grab and lightning both route to dragHandleMenu.dispatch('highlight', ref) - NOT row.run() - so they are byte-identical by construction (same dispatch case). The registry run() (cardRun->ctx.dispatch) is the declarative twin only.
- **note** (grab, lightning): grab and lightning both dispatch('note', ref) directly - byte-identical. Mode-A vs Mode-B anchor branch hinges on ref.kind (selection/linkedRange -> range anchor; block -> paragraph anchor).
- **footnote** (grab, lightning, slash, typed): All four surfaces must land the SAME footnote atom (footnoteId, number:0 pre-renumber, empty content) AND the SAME pristine+pinned+selected card lifecycle. Slash/typed adopt (no double-insert); menu inserts. Card footnoteId === atom footnoteId on every surface. CHIP 4b aligned slash/typed to the menu.
- **citation** (grab, lightning, slash, typed): Atom attrs {citationId, command, displayText:''} must be byte-identical across surfaces. CitationRef sidecar shape identical (id===citationId; keys parsed from command). Difference: typed \cite{key} carries the FULL command (renders keys) while menu/slash carry empty \cite{}.
- **todo** (grab, lightning): grab and lightning both dispatch('todo', ref) directly - byte-identical. Todo is anchor-by-paragraph-uuid only (no linkedAnchor even for selection refs - note the case does NOT call createAnchor).
- **suggest-edit** (grab, lightning): grab and lightning both dispatch('suggest-edit', ref) directly - byte-identical. The action id 'suggest-edit' maps to a revision-COMMENT card (not revision-suggestion); the suggestion-with-rewrite is a separate responder-skill output.
- **cutter** (grab, lightning): grab and lightning both dispatch('cutter', ref) directly - byte-identical. Produces a cutter-COMMENT (not cutter-suggestion).
- **report** (grab, lightning): grab and lightning both dispatch('report', ref) directly - byte-identical. The id 'report' produces a report-REQUEST card (the quick gesture files the ask; an AI authors the actual Report later).
- **duplicate** (grab, lightning): grab and lightning both dispatch('duplicate', ref) directly - byte-identical. The whole duplicate flow (fail-loud B1: stale ref/empty slice/schema reject -> notify+abort) lives in ONE dispatch case.
- **archive** (grab, lightning): grab and lightning both dispatch('archive', ref) directly - byte-identical. The destructive-confirm resolution (resolveDestructiveConfirm -> per-kind meta.confirmDestructive, or confirmSelectionDestructive for selection refs) is shared in ONE place.
- **delete** (grab, lightning): grab and lightning both dispatch('delete', ref) directly - byte-identical. Shares the destructive-confirm resolution + cascade + cleanup with archive (delete is archive minus the snapshot+snippet).
- **heading-chapter** (slash, lightning): slash (chapter) and lightning (BlockTypeDropdown level 1 via applyHeadingFromDropdown->spec.run) MUST produce a byte-identical setBlockType to heading{level:1, numbered:true} on selection.from..to. Both build a {kind:'cursor', pos:selection.head} ref and invoke the SAME headingRun. canEdit: slash reads view.editable, lightning reads editor.isEditable - same flag.
- **heading-section** (slash, lightning): slash \section and lightning BlockTypeDropdown level 2 route through the SAME headingRun(2); identical setBlockType{level:2, numbered:true} tx, identical serialized \section{}.
- **heading-subsection** (slash, lightning): slash \subsection and lightning dropdown level 3 -> same headingRun(3); identical tx + \subsection{} output.
- **heading-subsubsection** (slash, lightning): slash \subsubsection and lightning dropdown level 4 -> same headingRun(4); identical tx + \subsubsection{} output.
- **title** (slash): SLASH-ONLY - no cross-surface byte-match required. The invariant is INTERNAL idempotency: a second \title must NOT create a second titleField. Minted attrs (field:'title', rawPrefix:null, isToday:false, fresh uuid) must match what the .tex parser produces on reload.
- **author** (slash): Slash-only - no cross-surface match required. Invariant: idempotency (no duplicate author field) + canonical ordering (author between title and date). Minted attrs round-trip identically to a parsed \author.
- **date** (slash): Slash-only. Invariant: idempotency + the \today special-case must round-trip: an inserted date (isToday:true, pretty content) serializes to \date{\today}, and re-parsing \date{\today} must reproduce isToday:true + the same pretty rendering. Canonical order index 2.
- **example** (slash, lightning): Both surfaces route through the ONE exampleRun: same exampleBlock node, same firstParagraph seeding, same uuid-collision scan, same caret-park, same .tex round-trip. The ONLY intentional difference: slash threads panelRouting.selectExample (soft panel-select); the lightning grid omits panelRouting entirely - by design.
- **tex** (slash, lightning): Both surfaces route through texRun: same seedCode harvest, same ONE uuid-collision scan, same deleteSelection->replaceSelectionWith, same data-loss guard, same %!vtex sentinel round-trip. Slash via runViewOnlyAction (CursorRef ctx); lightning via insertTexBlock's hand-rolled SelectionRef ctx - both feed the SAME texRun which reads ctx.view.state.selection directly.
- **figure** (lightning): Single-surface (lightning only) today - no cross-surface byte-identity to enforce. But figureRun IS the SSOT the standalone insertFigureBlock helper and any future FILE-DROP path delegate to (DA-2): all figure-insert paths must produce the byte-identical smartInsertBlock result.
- **graphics** (lightning): Single-surface (lightning only) today. graphicsRun is the SSOT the standalone insertGraphicsBlock helper and any future FILE-DROP path delegate to (DA-2): all must produce the byte-identical smartInsertBlock result.
- **inline-math** (lightning): Single-surface (lightning only). No cross-surface identity to enforce today. (mathRun preserves the former grid wrapSelectionInMath semantics verbatim - a temporal/refactor identity, not multi-surface.)
- **display-math** (lightning): Single-surface (lightning only). No cross-surface identity to enforce today.
- **ref** (slash, lightning): Slash (\ref) and lightning (Cross-ref cell) MUST be byte-identical because both route through the SINGLE refRun -> ctx.openRefPopover(). The two seam suppliers - EditorPane.tsx:2233 (slash) and ActionsMenuPanel.tsx:253 (lightning) - hand-roll the SAME caret-rect computation (selection.from -> coordsAtPos -> new DOMRect -> dispatch 'virgil-ref-create-popover'). The marker-clicks.ts:360 listener consumes that ONE event for BOTH surfaces. The resulting labelRef atom is identical attrs/shape regardless of surface. Verified by ref-title-cross-surface.test.ts.
- **bold** (lightning): Registry exposes ONLY the lightning surface; the live keyboard binding Mod-b (StarterKit) is NOT modeled on the ActionSpec. The two live paths (grid cell run() and the Mod-b keystroke) both bottom out in toggleBold so they produce a byte-identical strong mark / identical \textbf{...} serialization - but ONLY the grid path goes through the registry's collab guard; the keystroke is gated separately by the readOnlyEnforcer plugin filterTransaction (editor-extensions.ts:1839).
- **italic** (lightning): Registry exposes ONLY the lightning surface; the live keyboard binding Mod-i (StarterKit) is NOT modeled on the ActionSpec. The two live paths (grid cell run() and the Mod-i keystroke) both bottom out in toggleItalic so they produce a byte-identical italic mark / identical \textit{...} serialization - but ONLY the grid path goes through the registry's collab guard; the keystroke is gated separately by the readOnlyEnforcer plugin filterTransaction (editor-extensions.ts:1839).
- **strike** (lightning): Registry exposes ONLY the lightning surface; the live keyboard binding Mod-Shift-s (StarterKit) is NOT modeled on the ActionSpec. The two live paths (grid cell run() and the Mod-Shift-s keystroke) both bottom out in toggleStrike so they produce a byte-identical strike mark / identical \sout{...} serialization - but ONLY the grid path goes through the registry's collab guard; the keystroke is gated separately by the readOnlyEnforcer plugin filterTransaction (editor-extensions.ts:1839).
- **code** (lightning): Registry exposes ONLY the lightning surface; the live keyboard binding Mod-e (StarterKit) is NOT modeled on the ActionSpec. The two live paths (grid cell run() and the Mod-e keystroke) both bottom out in toggleCode so they produce a byte-identical code mark / identical \texttt{...} serialization - but ONLY the grid path goes through the registry's collab guard; the keystroke is gated separately by the readOnlyEnforcer plugin filterTransaction (editor-extensions.ts:1839).
- **bullet-list** (lightning): Registry exposes ONLY the lightning surface; StarterKit also binds the live keyboard shortcut and markdown input rules ('- '/'1. ') which call the SAME toggleBulletList - NOT modeled on the ActionSpec. Grid run() and the keystroke/input-rule both bottom out in toggleBulletList; identical structural result. Only the grid path goes through the registry collab guard; the keystroke/input-rule is gated by readOnlyEnforcer.
- **ordered-list** (lightning): Registry exposes ONLY the lightning surface; StarterKit also binds the live keyboard shortcut and markdown input rules ('- '/'1. ') which call the SAME toggleOrderedList - NOT modeled on the ActionSpec. Grid run() and the keystroke/input-rule both bottom out in toggleOrderedList; identical structural result. Only the grid path goes through the registry collab guard; the keystroke/input-rule is gated by readOnlyEnforcer.
- **blockquote** (lightning): Registry exposes ONLY the lightning surface; StarterKit also binds the live keyboard shortcut and a markdown input rule ('> ') which call the SAME toggleBlockquote - NOT modeled on the ActionSpec. Grid run() and the keystroke/input-rule both bottom out in toggleBlockquote; identical structural result. Only the grid path goes through the registry collab guard.
- **text-color** (lightning): Single-surface (lightning only) today - no cross-surface byte-identity to enforce. The popover seam (ctx.openColorPopover) is the single creator; any future surface must route through the SAME seam.

---

# Appendix — Surface-driver recipes (`preview_eval`)

Faithfully triggering Virgil's 5 action surfaces from `preview_eval`. "Faithful" means each recipe drives the **real surface code path** (the actual dispatcher / plugin / input rule / keymap), not a shortcut that bypasses the wiring under test.

## Preconditions / handles

These recipes assume the live debug handle is wired on `window.__v` (see [`_harness.js`](_harness.js); inject it via `preview_eval` after every reload):

- `window.__v.main` — the main-pane TipTap `Editor` instance (`editor.view`, `editor.state`, `editor.commands`, `editor.chain()`).
- `window.__v.dh` — the shared **grab + lightning** dispatcher object: `{ dispatch(action, ref) }` (the `dispatch` returned by `useDragHandleActions` in `drag-handle-actions.ts`, the SAME function `ActionsMenuPanel` and `DragHandleMenu` call).
- `window.__v.cc` — `cardCreation` (the `CardCreationApi`); rarely needed directly — prefer `dh.dispatch` so you exercise the dispatcher.

If `window.__v` is not present, reach the editor via the documented fiber walk (`preview_editor_internals_access` memo) and obtain `dh`/`cc` from the same `EditorPane` fiber that holds them. On a read-only/collab doc, every surface refuses (the uniform CHIP-7b `canEdit`/`view.editable` gate) — apply edits with `tr.setMeta('ignoreReadOnly', true)` only if you explicitly want to bypass that gate for a non-action probe.

Important: **a real surface always plants/uses a selection.** Before any range-based recipe, set the editor selection so the surface "sees" the passage. The dispatcher does this for you from the `ref`, but slash/typed/keyboard read the live selection.

---

## Surface 1 — GRAB (drag-handle menu → `dh.dispatch`)

### What the real wiring is
The grab handle opens `DragHandleMenu` (`src/components/DragHandleMenu.tsx`). Each menu item is a `<button>` whose `onClick` (line ~219) calls `onSelect(row.id as DragHandleAction)`. `onSelect` is wired to `useDragHandleActions().dispatch` (i.e. `dh.dispatch`). So **per-cell behavior IS `dh.dispatch(actionId, ref)`** — the menu only resolves which `row.id` and constructs the `ref`.

`dispatch(action, ref)` lives in `drag-handle-actions.ts`. It (1) resolves the ref to a `{from,to}`/NodeSelection via `resolveRefRange`, (2) **plants the editor selection** over it, (3) calls the matching `cardCreation.createX(...)` / lifecycle path with `mode:"omni"`, (4) routes the panel.

### Action IDs (the `DragHandleAction` union)
`"footnote" | "citation" | "note" | "highlight" | "todo" | "suggest-edit" | "cutter" | "report" | "duplicate" | "archive" | "delete"`.

### Ref shapes (from `drag-handle-actions.ts` `DragHandleRef = TextObjectRef | SelectionRef`)
- **Block ref** (paragraph, heading, listItem, atom blocks, …): `{ kind: <TextObjectKind>, id: <uuid> }`. `kind` is the PM node name (`"paragraph"`, `"heading"`, `"listItem"`, `"texBlock"`, …); `id` is the node's `uuid` attr. For `"heading"`, annotation actions (note/footnote/…) act on the heading LINE, lifecycle actions (duplicate/archive/delete) on the whole SECTION (`actionClass` split).
- **Selection (range) ref**: `{ kind: "selection", from: <pos>, to: <pos>, paragraphId: <uuid> }`. This is gesture-input, not a TextObject.
- **Linked-range ref**: `{ kind: "linkedRange", id: <anchorId> }`. NOTE: the field is **`id`**, not `anchorId` — `TextObjectRef` is `{kind, id}` and for `linkedRange` the `id` holds the `linkedAnchor.anchorId` (see `types.ts:77` and `findLinkedRangeBounds(doc, ref.id, …)`). The grab menu never opens for this kind in practice, but `dispatch` handles it.

### Faithful eval recipes

Block ref — note on a paragraph (grab the paragraph's real uuid first):
```js
const ed = window.__v.main;
let pid = null;
ed.state.doc.descendants(n => { if (!pid && n.type.name === "paragraph" && n.attrs.uuid) pid = n.attrs.uuid; return !pid; });
window.__v.dh.dispatch("note", { kind: "paragraph", id: pid });
```

Selection (range) ref — highlight a live range (set `from/to` to a real text span):
```js
const ed = window.__v.main;
const from = 1, to = 10;                       // a real text range
let pid = null;
const $f = ed.state.doc.resolve(from);
for (let d = $f.depth; d >= 0; d--) { const n = $f.node(d); if (n.attrs && n.attrs.uuid) { pid = n.attrs.uuid; break; } }
window.__v.dh.dispatch("highlight", { kind: "selection", from, to, paragraphId: pid });
```

Linked-range ref (mark already present in the doc):
```js
window.__v.dh.dispatch("note", { kind: "linkedRange", id: "<existing-anchorId>" });
```

### To prove the MENU calls dispatch (wiring, not just the cell)
Spy on `dh.dispatch` before opening the menu, then drive the real menu button:
```js
const real = window.__v.dh.dispatch.bind(window.__v.dh);
window.__v.dh.dispatch = (...a) => { window.__lastDispatch = a; return real(...a); };
// now open the grab handle gesture and click "Note"; then read window.__lastDispatch
```
For **per-cell behavior** verification, calling `dh.dispatch(id, ref)` directly is the canonical shared path — that is exactly what the menu's onClick reduces to.

---

## Surface 2 — LIGHTNING (`ActionsMenuPanel` → `dh.dispatch` for cards; registry `run()` for formatting)

### What the real wiring is (`src/components/ActionsMenuPanel.tsx`)
TWO families:

1. **Card actions** (Footnote/Note/Highlight/Todo/…): `runAction(action)` (line 169) builds the `ref` and calls `dragHandleMenu.dispatch(action, ref)` — **the same `dh.dispatch`** as grab. The `ref`:
   - `mode === "cursor"` → `{ kind: "paragraph", id: paragraphUuid }`
   - `mode === "selection"` → `{ kind: "selection", paragraphId: paragraphUuid, from: range.from, to: range.to }`
   So lightning card cells are byte-identical to grab — **drive them via `dh.dispatch` with those exact ref shapes.**

2. **Formatting cells** (bold/italic/strike/code, lists, blockquote, math, figure/graphics, text-color, `\ref`, `\ex`): `runGridAction(id, payload?)` (line 202) builds a view-only `ActionContext` off the live selection (`surface:"lightning"`, `canEdit`, the `openFigurePopover`/`openColorPopover`/`openRefPopover` seams) and calls `VIRGIL_ACTION_REGISTRY[id].run(ctx)` directly. These do NOT go through `dispatch`.

### Faithful eval recipes

Lightning CARD cell (cursor mode):
```js
const ed = window.__v.main;
let pid = null;
const $h = ed.state.selection.$head;
for (let d = $h.depth; d >= 0; d--) { const n = $h.node(d); if (n.attrs && n.attrs.uuid) { pid = n.attrs.uuid; break; } }
window.__v.dh.dispatch("footnote", { kind: "paragraph", id: pid });
```

Lightning CARD cell (selection mode) — same as grab's selection ref:
```js
window.__v.dh.dispatch("note", { kind: "selection", from, to, paragraphId: pid });
```

Lightning FORMATTING cell — replicate `runGridAction`: focus, build the `surface:"lightning"` ctx, invoke the registry row's `run()`:
```js
// requires access to VIRGIL_ACTION_REGISTRY; if exposed on __v, e.g. window.__v.reg
const ed = window.__v.main;
ed.chain().focus().run();
const ctx = {
  editor: ed, view: ed.view,
  ref: { kind: "selection", from: ed.state.selection.from, to: ed.state.selection.to, paragraphId: "" },
  surface: "lightning", canEdit: true,
  openFigurePopover: () => {}, openColorPopover: () => {}, openRefPopover: () => {},
};
window.__v.reg["bold"].run(ctx);   // toggles bold via editor.chain().focus().toggleBold().run()
```
If `VIRGIL_ACTION_REGISTRY` isn't on `__v`, the bold/italic/etc. format rows are pure `editor.chain().focus().toggleX().run()` — so `ed.chain().focus().toggleBold().run()` reproduces the cell's effect (but skips the registry collab guard — see the keyboard surface for the distinction).

To assert the MENU→dispatch edge for card cells, spy on `dh.dispatch` as in the grab section and click a real lightning cell.

---

## Surface 3 — SLASH (`slash-popup.ts` `executeSelection` → `commands.ts`)

### What the real wiring is
`SlashPopupExtension` (`src/lib/tiptap/slash-popup.ts`):
- `handleTextInput` fires when the user types `"\"` at a "fresh position" → opens the popup (sets meta state; the `\` IS inserted into the doc, `return false`).
- Subsequent letters re-sync the query via `reSync`.
- **Enter / Tab** in `handleKeyDown` calls `executeSelection(view, cur)` (line 49): `delete(slashPos, cursor)` (removes the typed `\name`), sets the popup CLOSED meta, dispatches, then `cmd.action(view, "\\" + name)` where `cmd = COMMAND_MAP.get(name)` from `commands.ts`.

`VIRGIL_COMMANDS` (`commands.ts`) routes each command:
- **Pure-PM** (`\chapter/\section/\subsection/\subsubsection`, `\tex`, `\title/\author/\date`) → `runViewOnlyAction(id, view)` → builds a `surface:"slash"` `ActionContext` and calls `VIRGIL_ACTION_REGISTRY[id].run(ctx)` directly (no bridge).
- **Bridge-routed** (`\ref`, `\ex`, `\cite`, `\footnote`) → `getEditorActionsHandle()?.runAction(id, { surface:"slash", payload })`. For `\cite`/`\footnote` the atom is inserted **synchronously** in `commands.ts` first, then the CARD registration rides the bridge.

### Faithful eval recipes

The cleanest faithful recipe that exercises `commands.ts` (the slash command's `run()` destination) — drive the command's `action` exactly as `executeSelection` does after it deletes the `\name`:
```js
const ed = window.__v.main;
const view = ed.view;
const cmd = window.__v.commands?.COMMAND_MAP?.get("section"); // if exposed
cmd.action(view, "\\section");   // → runViewOnlyAction("heading-section", view)
```

If `COMMAND_MAP` is not exposed on `__v`, exercise the **full popup wiring** by simulating the typed sequence so the plugin's own `handleTextInput`/`handleKeyDown` run:
```js
const view = window.__v.main.view;
const from = view.state.selection.from;
view.dispatch(view.state.tr.insertText("\\section", from));
view.dispatch(view.state.tr.setMeta("slashPopup", {
  open: true, slashPos: from, query: "section", selectedIndex: 0,
  filtered: ["section"]   // must be a non-empty filtered list incl. the target
}));
view.dom.focus();
view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
```
This runs the REAL `executeSelection` → `cmd.action` → `runViewOnlyAction`/bridge. Verify by reading `main.state.doc` (heading converted) or, for `\cite`/`\footnote`, the inserted atom + sidecar card after autosave.

For `\cite`/`\footnote` via slash, the atom-insert is synchronous in `commands.ts` and the card rides `runAction(..., {surface:"slash"})` → bridge → registry `citation.run`/`footnote.run`.

---

## Surface 4 — TYPED (input rules in `citation.ts` / `footnote.ts`)

### What the real wiring is
A ProseMirror `handleTextInput` prop on each node's extension. It matches the text-before-cursor against a shared regex, inserts the atom synchronously, then registers the card via `getEditorActionsHandle()?.runAction(id, {surface:"typed", payload})`.

**Citation** (`citation.ts`, `citationInput` plugin): acts on terminators `"}"`, `" "`, or `"\n"`.
- `\cite{key}` + the typed **`}`** → matches `CITE_RE_FULL` → inserts atom with the full `command`, registers card.
- `\cite` + a typed **space**/newline → the "bare" branch (`CITE_RE_BARE`) → inserts an empty `\cite{}` atom, registers card.

**Footnote** (`footnote.ts`, `footnoteInput` plugin): only acts on terminator **`}`**. `\footnote{...}` + the typed `}` → matches `FOOTNOTE_RE_FULL = /\\footnote\{([^}]*)\}$/` → inserts footnote atom (body = the captured group), renumbers, registers card with `payload:{footnoteId, pristine}` (pristine only when the body is empty).

Critical: `handleTextInput(view, from, to, text)` receives the **terminator char as `text`**, NOT yet in the doc. Put the *prefix* in the doc and deliver the terminator as the `text` argument.

### Faithful eval recipes

Deliver the terminator through PM's real input pipeline via `view.someProp("handleTextInput", …)`:

```js
const ed = window.__v.main, view = ed.view;
const start = ed.state.selection.from;
view.dispatch(view.state.tr.insertText("\\cite{smith2020", start));
const caret = ed.state.selection.from;
const handled = view.someProp("handleTextInput", f => f(view, caret, caret, "}"));
// handled === true → input rule fired, inserted the citation atom,
// and called runAction("citation", {surface:"typed", payload:{citationId, command}})
```

Footnote (terminator `}`):
```js
const ed = window.__v.main, view = ed.view;
const start = ed.state.selection.from;
view.dispatch(view.state.tr.insertText("\\footnote{my note", start));
const caret = ed.state.selection.from;
view.someProp("handleTextInput", f => f(view, caret, caret, "}"));
```

Bare citation (terminator space):
```js
const ed = window.__v.main, view = ed.view;
const start = ed.state.selection.from;
view.dispatch(view.state.tr.insertText("\\cite", start));
const caret = ed.state.selection.from;
view.someProp("handleTextInput", f => f(view, caret, caret, " "));
```

`view.someProp("handleTextInput", fn)` walks every plugin's `handleTextInput` (slash popup's, citation's, footnote's) in order and stops at the first that returns true — **exactly** how ProseMirror dispatches the event, the faithful entrypoint. These reach `run()` via the bridge. Note the collab gate: `handleTextInput` returns `false` early if `!view.editable`.

---

## Surface 5 — KEYBOARD (StarterKit / mark keybindings)

### What the real wiring is
Marks ship their own keymaps via `addKeyboardShortcuts`. E.g. `@tiptap/extension-bold/dist/index.js:65`: `"Mod-b": () => this.editor.commands.toggleBold()`, `"Mod-i"` (Italic), `"Mod-Shift-s"`/`"Mod-e"` etc. These are **plain TipTap commands on the editor** — they do NOT go through `VIRGIL_ACTION_REGISTRY`, `dh.dispatch`, or the bridge. The keyboard mark surface is the raw editor command, while the lightning formatting cell wraps the **same** `toggleBold()` inside a registry `run()` (`backbone:"tiptap-chain"`).

### Faithful eval recipes

Most faithful — dispatch a keydown the editor's keymap handles, via `someProp("handleKeyDown")`:
```js
const ed = window.__v.main, view = ed.view;
ed.commands.setTextSelection({ from, to });    // select the text to bold
view.dom.focus();
const evt = new KeyboardEvent("keydown", { key: "b", code: "KeyB", metaKey: true, bubbles: true, cancelable: true });
const handled = view.someProp("handleKeyDown", f => f(view, evt));
// handled === true → the Bold extension's "Mod-b" binding ran toggleBold()
```
(Use `ctrlKey:true` instead of `metaKey` on non-mac keymaps; TipTap's `Mod` maps to Cmd on mac, Ctrl elsewhere — match the platform the preview reports.)

Equivalent (the command the binding maps to), if you only need the effect:
```js
window.__v.main.commands.toggleBold();   // exactly what "Mod-b" invokes
```

### Distinguishing keyboard from a registry `run()`
- **Keyboard mark binding**: `editor.commands.toggleBold()` directly. No `ActionContext`, no `surface`, no `canEdit` gate beyond the editor's own editability, no bridge, no registry lookup.
- **Lightning/registry format `run()`**: `VIRGIL_ACTION_REGISTRY["bold"].run(ctx)` with `surface:"lightning"`, `canEdit`, the popover seams. It ALSO ends in `editor.chain().focus().toggleBold().run()`, so the **doc effect is identical** — the difference is whether the registry/`ActionContext` machinery ran. To assert the keyboard path, spy on the registry row's `run` and confirm it was NOT called; to assert the registry path, spy and confirm it WAS.

---

## Observing results

### A. In-memory (immediate, synchronous)
The doc mutation is visible on `window.__v.main.state.doc` the instant the transaction dispatches — no wait needed:
```js
window.__v.main.state.doc.toJSON();                      // full doc JSON
window.__v.main.getJSON();                               // same, via TipTap
let fns = 0; window.__v.main.state.doc.descendants(n => { if (n.type.name === "footnote") fns++; });
```
Atoms (footnote/citation), heading conversions, mark toggles, inserted blocks all appear here immediately. Fastest, most reliable assertion for atom/marker/structure changes; avoids the autosave + dev-doc-refresh complications.

### B. Sidecar JSON on disk (after the ~1500 ms autosave)
Card registrations (note/todo/citation card/footnote card/highlight/cutter/report/suggestion/archive) land in `virgil-data/doc_devtest/virgil/*.json` only after the `useDocument.ts` autosaver's **1500 ms** debounce settles. Files per kind (in `virgil-data/doc_devtest/virgil/`): `footnotes.json`, `citations.json`, `notes.json` (+ highlights), `todos.json`, `cutter.json`, `reports.json`, `revisions.json`, `suggestions.json`, `archive.json`, `annotations.json`, `examples.json`, `ai-requests.json`, …

Wait at least ~1600 ms after the action. Prefer a Monitor/until-loop polling the file over a fixed `sleep`. Caveat: a dev-doc refresh (`rm -rf … && cp -R samples/annotation-history …`) resets these; don't run it mid-verification.

### C. `document.tex` markers (after autosave + serialize)
The `.tex` round-trip serializes atoms via `latex-serializer.ts`: footnote → `\footnote{<body>}`; citation → the node's `command` attr verbatim (`\cite{key}` / `\cite{}`); headings → `\section{…}` etc. Read `virgil-data/doc_devtest/document.tex` after the autosave/serialize cycle. In-memory (A) is preferred for atom assertions since it skips the serialize timing.

### D. Keystroke-sanctity / bus probe
`window.__virgilBusStats()`: `emitCount` stays flat on plain typing; `version` advances on docChanged. Use to confirm a recipe produced a structural event (or didn't).

---

## Async ConfirmDialog handling (archive / delete / heading-duplicate)

`dispatch("archive", …)` / `dispatch("delete", …)` are **async**. When the resolved ref carries content, `resolveDestructiveConfirm` returns a descriptor and `dispatch` does `const proceed = await confirm({...})` — `confirm` renders a `ConfirmDialog` on a **later React tick** and resolves only when the user clicks Confirm/Cancel. The destructive mutation runs **after** that await resolves.

1. **The dialog renders in a separate frame.** `dh.dispatch("delete", ref)` will NOT mutate the doc synchronously — it awaits the user. Click the dialog's Confirm button in a **separate `preview_eval` call** (after the dialog has mounted), by its label (`confirmLabel`, e.g. "Delete passage" / "Archive passage" / "Duplicate section"):
   ```js
   // SECOND eval, after dispatch — the dialog is now in the DOM:
   const btn = [...document.querySelectorAll("button")]
     .find(b => /Delete|Archive|Duplicate section/i.test(b.textContent || ""));
   btn?.click();   // resolves the confirm() promise → dispatch proceeds with the delete
   ```
2. **When NO confirm is shown:** if `resolveDestructiveConfirm` returns `null` (empty selection, nothing at stake, or the kind opts out), `dispatch` proceeds synchronously — no dialog, no second eval needed.
3. **Duplicate-on-heading** also confirms (`confirmHeadingLifecycle`, label "Duplicate section") — same two-eval pattern.
4. To **bypass** the dialog entirely for a non-interactive test, pre-stub `confirm`/`notify` in the deps — but that is NOT faithful; prefer the two-eval click so you exercise the real ConfirmDialog path.

After a delete routed through the dialog, `dispatch` re-focuses the editor (`ed.view.focus()`) so Cmd-Z reaches the doc (B4) — observable as the editor regaining selection.

---

## Quick reference table

| Surface | Faithful entrypoint | Reaches `run()` via | Refs / args |
|---|---|---|---|
| 1. Grab | `dh.dispatch(actionId, ref)` | dispatcher (cardCreation/lifecycle directly) | `{kind:<TOKind>,id}` \| `{kind:"selection",from,to,paragraphId}` \| `{kind:"linkedRange",id:<anchorId>}` |
| 2. Lightning | cards: `dh.dispatch(actionId, ref)`; format: `reg[id].run(ctx)` (`surface:"lightning"`) | dispatcher (cards) / registry direct (format) | cursor `{kind:"paragraph",id}` or `{kind:"selection",…}` |
| 3. Slash | drive popup `handleTextInput("\")`+letters+Enter keydown → `executeSelection` → `cmd.action` | `runViewOnlyAction` (pure-PM) or bridge `runAction(id,{surface:"slash"})` | command name (`section`, `cite`, `footnote`, …) |
| 4. Typed | `view.someProp("handleTextInput", f => f(view, caret, caret, terminator))` after inserting prefix | bridge `runAction(id,{surface:"typed",payload})` | `\cite{key}`+`}`, `\cite`+`" "`, `\footnote{..}`+`}` |
| 5. Keyboard | `view.someProp("handleKeyDown", f => f(view, kbEvent))` (Mod-b/Mod-i) | raw `editor.commands.toggleBold()` — NOT registry/bridge | KeyboardEvent with `metaKey`/`ctrlKey` |

**Key discrepancy flagged:** the linkedRange ref field is **`id`** (holding the `anchorId`), not a literal `anchorId` key — confirmed against `types.ts` `TextObjectRef = {kind, id}` and `findLinkedRangeBounds(doc, ref.id, …)` in `drag-handle-actions.ts`.
