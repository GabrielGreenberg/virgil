// The ON-DISK LAYOUT of a Virgil-managed folder's skill mirror — the ONE
// spelling of "a bundle file goes HERE on disk", read by every layer that
// writes one.
//
// Two kinds of writer exist and they cannot import each other's world:
//
//   • the APP's per-folder sync (`library/lib/skill-sync.ts`), which fetches
//     `public/skill-bundle/**` over HTTP and writes through an FSA handle;
//   • the BUILD scripts (`*/build/build-*-bundle.mjs`,
//     `scripts/sync-local-mirrors.mjs`), plain node with `fs`.
//
// So this file is an IMPORT-FREE LEAF — no `fs`, no FSA, no `@/…` alias, no
// framework — for the same reason `src/lib/latex-markers.ts` and
// `src/lib/node-attr-sets.ts` are: a facet the layer that needs it cannot
// import will be re-copied, every time. It was, three times: each of the three
// sub-builders hand-spelled `join(repoRoot, ".claude", "commands", <silo>)`
// while `diskPathFor` owned the same fact one directory over.
//
// The bundle uses `claude-commands/` (no leading dot) because some static
// hosts skip hidden directories under `public/`; the disk rewrite below
// restores the canonical `.claude/commands/...` location.

/** Claude Code's per-folder config directory. */
export const CLAUDE_DIR = ".claude";
/** Virgil's per-folder state directory. */
export const VIRGIL_DIR = ".virgil";

/** Where a subsystem's slash-command markdowns live in a managed folder. */
export function commandsDirFor(subsystem) {
  return `${CLAUDE_DIR}/commands/${subsystem}`;
}

/** Where a subsystem's helper scripts live in a managed folder. */
export function scriptsDirFor(subsystem) {
  return `${VIRGIL_DIR}/scripts/${subsystem}`;
}

/** A path piece that stays where it is put: non-empty, slash-separated
 *  segments, none of them empty / `.` / `..`, and no backslash or NUL. The
 *  CONTAINMENT half of the layout (task 1309): a manifest entry and an
 *  on-disk stamp entry are DATA — the stamp lives in a cloud-synced folder
 *  agents also write — so `scripts/../../x` must resolve to nothing rather
 *  than to a path outside `.claude/` / `.virgil/scripts/`. The FSA writer was
 *  contained for free (`getDirectoryHandle("..")` throws); the `fs` writers
 *  and the Python twin were not, so the rule lives here, in the one spelling.
 *
 *  @param {string} piece
 *  @returns {boolean}
 */
function isContained(piece) {
  if (typeof piece !== "string" || piece === "") return false;
  if (piece.includes("\\") || piece.includes("\0")) return false;
  return piece.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

/** Map `<subsystem>/<bundle-relative path>` to its on-disk destination.
 *  Returns undefined for paths whose subsystem/shape we don't recognise, and
 *  for any whose subsystem or remainder is not CONTAINED (see `isContained`)
 *  — the caller skips them (defence against a malformed manifest or stamp).
 *
 *  TWIN: `editor/scripts/sync_skills.py` `disk_path_for` is the import-free
 *  Python bootstrap's copy of these rules; `skill-bundle-layout-twin.test.ts`
 *  runs both over one case list and pins their prefix vocabularies equal.
 *
 *  @param {string} subsystem  "library" | "editor" | "virgil" | "manifest"
 *  @param {string} bundlePath bundle-relative path within that subsystem
 *  @returns {string | undefined} folder-relative disk path
 */
export function diskPathFor(subsystem, bundlePath) {
  if (!isContained(subsystem) || subsystem.includes("/")) return undefined;
  // The workspace CLAUDE.md only ships from the library subsystem.
  if (subsystem === "library" && bundlePath === "CLAUDE.md") {
    return `${CLAUDE_DIR}/CLAUDE.md`;
  }
  // The operational manifest is Virgil-global: it lands in one shared
  // `.claude/virgil/`, not under a per-subsystem segment.
  if (subsystem === "manifest") {
    if (!isContained(bundlePath)) return undefined;
    return `${CLAUDE_DIR}/virgil/${bundlePath}`;
  }
  if (bundlePath.startsWith("claude-commands/")) {
    const rest = bundlePath.slice("claude-commands/".length);
    if (!isContained(rest)) return undefined;
    return `${commandsDirFor(subsystem)}/${rest}`;
  }
  if (bundlePath.startsWith("scripts/")) {
    const rest = bundlePath.slice("scripts/".length);
    if (!isContained(rest)) return undefined;
    return `${scriptsDirFor(subsystem)}/${rest}`;
  }
  return undefined;
}
