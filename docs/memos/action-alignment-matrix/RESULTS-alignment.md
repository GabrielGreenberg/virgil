# CHIP 8 live matrix — Cross-surface alignment + slash/typed surfaces

**Drivers (validated):**
- **typed:** insert prefix, then deliver the terminator through PM's real pipeline:
  `view.someProp("handleTextInput", f => f(view, caret, caret, "}"))`. `handled===true` ⇒ the
  input rule fired.
- **slash:** added a dev hook `window.__virgilSlashCommands = COMMAND_MAP` (dev-gated, in
  `src/lib/tiptap/commands.ts`, mirrors `__virgil`/`__virgilBusStats`). Drive faithfully via
  `cmd.action(view, "\\name")` — exactly what `executeSelection` (slash-popup.ts) calls after it
  deletes the typed `\name`. (Required a clean `preview_stop`/`preview_start` for the module
  side-effect to land — the turbopack stale-watcher won't HMR a top-level side effect.)
- **grab/lightning:** `dh.dispatch(action, ref)` (validated in the lifecycle phase).

## Citation — typed ⇄ slash ALIGNED ✅

| surface | atom `command` | atom `citationId` | `citations.json` entry |
|---|---|---|---|
| typed `\cite{smith2020}` + `}` | `\cite{smith2020}` | `7ce7` (minted) | `{id:7ce7, command:"\cite{smith2020}", keys:["smith2020"], createdAt}` |
| slash `\cite` | `\cite{}` | `465c` (minted) | `{id:465c, command:"\cite{}", keys:[""], createdAt}` |

**Same atom-attr schema, same sidecar entry schema, same minted-id + card-via-bridge lifecycle.**
The only differences are the input payload (`command`/`keys`), which is correct (slash carries no
key). This confirms the CHIP 4a-ii unification: typed `\cite{key}` and slash `\cite` both land at
`citation.run` → `createCitation`. The historical "typed-cite makes no card" + "atom inserted 3
ways" divergence is **fixed**.

## Slash command surface — broad sweep ✅

| `\command` | result | correct? |
|---|---|---|
| `\section` / `\subsection` / `\chapter` | **converts** the cursor paragraph in place → `heading`, `level` per command, **`numbered:true`**; appends a trailing empty paragraph (affordance, benign) | ✅ SET semantics + numbered (matches settled decision) |
| `\ex` | inserts an `exampleBlock` | ✅ |
| `\tex` | inserts a `texBlock` | ✅ |
| `\footnote` | inserts a footnote atom (atom-only paragraph here) + registers footnote card | ✅ |
| `\cite` | inserts citation atom + card (see alignment table) | ✅ |

## Still owed (alignment tail — next batches)
- **footnote** typed ⇄ slash ⇄ grab/lightning byte-identity (typed `\footnote{}` driver validated separately; compare sidecar shapes).
- **grab/lightning citation + footnote** via `dispatch` — compare atom+sidecar to slash/typed.
- **ref** (`\ref` slash + lightning Cross-ref cell): both call `refRun` → opens the LabelRef create-mode popover; verify the popover opens from both and produces the same `\ref` atom.
- **title/author/date** slash (idempotent find-or-insert; slash-only — no menu twin by design).
- **format marks** (bold/italic/strike/code/lists/quote/text-color): lightning grid + keyboard (StarterKit `Mod-*`); confirm cursor-vs-selection `applySelectionMode` taxonomy.
- **example wrap-vs-insert**: `\ex` on a selection should WRAP; with no selection INSERT.

## Notes
- Dev hook `__virgilSlashCommands` added to `commands.ts` (UNCOMMITTED on main) — keep as test
  infra or revert at the end of CHIP 8. Dev-gated (`NODE_ENV !== "production"`), tree-shakes out of
  the prod static-export build.
