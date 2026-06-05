---
description: |
  Apply the user's preamble customizations to a Virgil document's
  current style. Triggers on: "merge my style", "apply my preamble
  customizations", "do the style merge", "rebase my preamble onto the
  new style", or when there's a pending `kind: style-merge` request in
  the paper's AI-request inbox. Intelligently merges the user's local
  LaTeX preamble tweaks onto the target style and rewrites the .tex.
  Does NOT trigger for general formatting changes ("make headers
  bigger") — those need a manual preamble edit by the user first.
  Args: <docPath>.
---

# /editor/style-merge

Process every pending `kind: "style-merge"` request in a Virgil
document's `virgil/ai-requests.json` sidecar. For each request, diff
the user's current preamble against the target style's registered
preamble, splice their customizations onto the target, rewrite the
`.tex`, flip the per-doc `document-settings.json` to the new styleId,
and mark the request `status: "complete"`.

## Args

- `<docPath>` — absolute or `virgil-data/`-relative path to the
  document folder. The folder contains the `.tex` file and the
  `virgil/` sidecar dir. Examples:
  - `virgil-data/doc_devtest`
  - `/Users/gabriel/Documents/papers/my-paper`

If `<docPath>` is omitted, ask the user which doc.

## What you process

A request qualifies if **all** of the following are true:

- `kind == "style-merge"`
- `status == "submitted"`
- `payload.kind == "style-merge"` and the four payload fields
  (`targetStyleId`, `targetStyleName`, `targetPreamble`,
  `currentPreamble`) are present.

Skip everything else.

## Procedure

1. **Load.** Read `<docPath>/virgil/ai-requests.json`. Read
   `<docPath>/virgil/document-settings.json` (the per-doc
   `DocumentSettings` = `{ styleId }` — note it lives under `virgil/`,
   *not* the doc root). List the `.tex` files in `<docPath>/` — there
   should be exactly one; that's the doc's main tex file (note: the
   Virgil app stores the filename inside its index; without that hint,
   pick the unique `.tex` at the top level of the folder).

2. **Find candidates.** Filter `requests[]` to qualifying entries.
   If none, print "No pending style-merge requests" and exit.

3. **For each request, surface what you're about to do:**

   ```
   ════════════════════════════════════════════════════════════
   STYLE MERGE · <doc folder name>
   Target style: <payload.targetStyleName>  (id: <payload.targetStyleId>)
   ────────────────────────────────────────────────────────────
   <user note from request.text>
   ════════════════════════════════════════════════════════════
   ```

4. **Diff.** Compare `payload.currentPreamble` against
   `payload.targetPreamble`. Identify items present only in current
   that should be carried forward to the merge:

   - `\usepackage{...}` lines (preserve options).
   - `\newcommand`, `\providecommand`, `\renewcommand`,
     `\DeclareRobustCommand` macros.
   - `\setlength{\param}{...}` and `\setcounter{name}{...}` settings.
   - Font-config preamble lines: `\setmainfont`, `\setsansfont`,
     `\setmonofont`, `\linespread{...}`, `\geometry{...}` (if not in
     target).
   - User-defined macros that depend on packages also being merged in.

   **Don't carry over:**

   - `\providecommand{\vfid}` / `\vcid` / `\vexid` — auto-injected by
     the Virgil serializer; redundant.
   - `\title`, `\author`, `\date` — these are stripped from the
     preamble at parse time and re-injected from the doc tree at
     serialize time. Adding them here causes duplicate emission.
   - `\documentclass{...}` from current, since the target style
     already declares one (and the user picked the new style
     deliberately — let it own the document class).
   - **Bib-system shadow.** If current has `\usepackage{natbib}` and
     target has `\usepackage{biblatex}` (or vice versa): drop the
     current bib package and its companions —
     `\bibliographystyle{...}`, `\setcitestyle{...}` for natbib;
     `\addbibresource{...}` for biblatex. The body's
     `\bibliography{...}` (natbib) and `\printbibliography`
     (biblatex) are mutually exclusive — the merge preserves body
     bytes verbatim, so a bib-system swap produces a non-compiling
     .tex until the user manually swaps these body markers. **Flag
     this loudly in the per-request summary** so the user knows a
     manual body fix is required.
   - **Other shadowed packages.** If current and target both load
     packages that conflict (e.g. `cite` shadowed by `natbib`), drop
     the current one.

5. **Compose merged preamble.** Start from `payload.targetPreamble`.
   Splice your selections in at sensible insertion points:

   - **Extra `\usepackage` lines.** Find the last package-block line
     in the target — that is, the last `\usepackage{...}` line *plus*
     any immediately-following same-package setup directives
     (`\addbibresource{...}`, `\geometry{...}`, `\hypersetup{...}`).
     Insert carried-forward `\usepackage` lines on the next line
     **after** that whole block. E.g., if the target ends its package
     block with:
     ```
     \usepackage{biblatex}
     \addbibresource{references.bib}
     ```
     carried lines `\usepackage{microtype}` go *after* the
     `\addbibresource` line — not between.
   - **Custom macros.** After the package block, before the
     `\providecommand{\vfid}` block (or before `\begin{document}` if
     no Virgil markers in target). Separate from the Virgil-marker
     comment block by a blank line so the marker block stays a single
     visually-coherent unit.
   - **`\setlength` / `\setcounter`**: same region as macros.
   - **Font-config**: same region.

   Preserve original whitespace where reasonable. The merged blob
   must end with `\begin{document}\n\n` exactly — same shape as the
   target preamble.

6. **Validate.** The merged preamble must:
   - Contain exactly one `\begin{document}`.
   - Not contain `\end{document}`.
   - Be syntactically plausible LaTeX (matched braces, no truncated
     commands).

   The validation is yours (composition); the atomic *write* is the
   contract's. If validation fails, **do not write the .tex** — take the
   failure path through the contract (two-field: status `failed`, result
   `impossible`; no `.tex` / settings write happens):
   ```bash
   python3 editor/scripts/apply_response.py <docPath> complete-only <requestId> --result impossible --note "Style merge validation failed: <reason>; .tex left untouched."
   ```
   and move on to the next request.

7. **Apply — one atomic, pen-protected commit.** The preamble rewrite,
   the style-id flip, and the request completion all ride a single
   `apply_response.py` op. **No hand-edits** — `apply_response.py` is the
   only writeback path (the old pen-less `.tex` / `document-settings.json`
   / `ai-requests.json` edits are gone).
   - `texEdit` `region-replace` rewrites the preamble: it replaces
     `[start..\begin{document}]` (the marker plus its trailing newlines)
     with your merged blob. Because the blob ends with
     `\begin{document}\n\n`, the marker is re-supplied and the body +
     postamble bytes are preserved verbatim (`endMarker` defaults to
     `\begin{document}`).
   - `settingsEdit` flips `virgil/document-settings.json` to
     `{ "styleId": "<payload.targetStyleId>" }`.
   - Completing the request flips its `status` → `complete`, result
     `auto-applied`. (Don't delete it; the frontend clears its
     "merging…" banner on any terminal status.)

   The merged preamble has braces + backslashes, so write the op to a
   file and pass it with `@` (`mkdir -p` the `.virgil/` dir first — a fresh
   paper folder may not have it yet):
   ```bash
   mkdir -p "<docPath>/.virgil"
   cat > "<docPath>/.virgil/style-merge-op.json" <<'JSON'
   { "requestId": "<requestId>",
     "texEdit": { "mode": "region-replace",
                  "replacement": "<merged preamble, ending in \\begin{document}\\n\\n>" },
     "settingsEdit": { "set": { "styleId": "<payload.targetStyleId>" } },
     "summary": "Style merge: <payload.targetStyleName> (carried <N> pkgs, <M> macros)" }
   JSON
   python3 editor/scripts/apply_response.py <docPath> complete-only "@<docPath>/.virgil/style-merge-op.json" --result auto-applied
   ```
   (`replacement` is the merged blob from step 5, as a JSON string —
   escape `\` as `\\`, newlines as `\n`. The contract finds the `.tex`
   itself.)

8. **Print a summary** for each request: counts of carried-over
   packages / macros / settings, and a one-line diff of the resulting
   preamble's package list vs. the target's.

## Safety

- Never merge if `payload.currentPreamble` is empty (sentinel for "no
  drift detected" — the request shouldn't have been filed in that
  case). Complete + skip through the contract (a benign no-op — no
  writes; omit `--result` so the status is `complete`, not `failed`):
  ```bash
  python3 editor/scripts/apply_response.py <docPath> complete-only <requestId> --note "No preamble drift detected; nothing to merge."
  ```
- Never write the .tex if the body extraction returns an empty body —
  that's a corrupted source file. Take the failure path:
  `complete-only <requestId> --result impossible --note "Empty body; source looks corrupted; .tex left untouched."`.
- This skill is doc-local. Don't touch anything outside `<docPath>/`.
  Every write goes through `apply_response.py` — no Edit-tool edits of
  the `.tex`, `document-settings.json`, or `ai-requests.json`.

## Examples

```
/style-merge virgil-data/doc_devtest
/style-merge ~/Documents/papers/lattice-trees
```
