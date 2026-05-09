---
description: Drain pending style-merge AI requests from a Virgil document — intelligently merges the user's local preamble customizations onto the target style and rewrites the .tex.
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
   `<docPath>/document-settings.json`. List the `.tex` files in
   `<docPath>/` — there should be exactly one; that's the doc's main
   tex file (note: the Virgil app stores the filename inside its index;
   without that hint, pick the unique `.tex` at the top level of the
   folder).

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

5. **Compose merged preamble.** Start from `payload.targetPreamble`.
   Splice your selections in at sensible insertion points:

   - Extra `\usepackage` lines: after the last `\usepackage` line in
     the target preamble.
   - Custom macros: after the package block, before the
     `\providecommand{\vfid}` block (or before `\begin{document}` if
     no Virgil markers in target).
   - `\setlength` / `\setcounter`: same region as macros.
   - Font-config: same region.

   Preserve original whitespace where reasonable. The merged blob
   must end with `\begin{document}\n\n` exactly — same shape as the
   target preamble.

6. **Validate.** The merged preamble must:
   - Contain exactly one `\begin{document}`.
   - Not contain `\end{document}`.
   - Be syntactically plausible LaTeX (matched braces, no truncated
     commands).

   If validation fails, **do not write the .tex.** Mark the request
   `status: "complete"` with a `resultId` describing the failure, and
   move on. (Failure path: emit a `notes` field on the request, keep
   the .tex untouched.)

7. **Rewrite the .tex.** Read the current bytes. Find the
   `\begin{document}` and `\end{document}` markers. Replace
   `[start..\begin{document}]` (inclusive of the marker plus its
   trailing two `\n`s) with the merged preamble. Body and postamble
   bytes are preserved verbatim.

8. **Update sidecars.**
   - `<docPath>/document-settings.json` — set
     `{ "styleId": "<payload.targetStyleId>" }`.
   - `<docPath>/virgil/ai-requests.json` — flip the request's
     `status` to `"complete"`. Don't delete it; the frontend uses the
     `complete` status to clear the "merging…" label.

9. **Print a summary** for each request: counts of carried-over
   packages / macros / settings, and a one-line diff of the resulting
   preamble's package list vs. the target's.

## Safety

- Never merge if `payload.currentPreamble` is empty (sentinel for "no
  drift detected" — the request shouldn't have been filed in that
  case). Mark the request `complete` and skip.
- Never write the .tex if the body extraction returns an empty body —
  that's a corrupted source file. Skip and mark complete.
- This skill is doc-local. Don't touch anything outside `<docPath>/`.

## Examples

```
/style-merge virgil-data/doc_devtest
/style-merge ~/Documents/papers/lattice-trees
```
