"use client";

/**
 * The forest refusal BADGE — Gabriel's explicit spec for this renderer: when
 * the subset grammar meets syntax it does not understand, say so LOUDLY,
 * VISIBLY, and ATTACHED to the text object, naming the construct.
 *
 * Three decisions are recorded here rather than in the markup:
 *
 * - **It is a WARNING, not an alarm.** Amber (`--amber-100` ground /
 *   `--amber-500` edge and icon), never the danger ramp — STYLE_GUIDE's rule is
 *   that RED means an action would destroy content without a net, and nothing
 *   here can destroy anything: the bytes are the model, the render is a pure
 *   derivation, and the source sits right below the badge untouched. A red pill
 *   over an intact document tells the user something untrue.
 * - **It is SPECIFIC.** The message names the first construct the grammar
 *   refused and where it is. A bare "could not render" teaches the user
 *   nothing and gives them nothing to file; `node option \`l sep=2cm\`
 *   (line 2)` tells them exactly which byte to change or which whitelist entry
 *   to ask for.
 * - **It is DERIVED, never persisted.** Nothing about this state reaches the
 *   sidecar or the `.tex`; editing the source re-derives it on the next parse.
 */

import type { ForestRefusal } from "@/lib/forest/grammar";
import { chromeOnly } from "@/lib/view-only-chrome";

export function ForestRefusalBadge({ refusal }: { refusal: ForestRefusal }) {
  return (
    // A statement about Virgil's renderer, never about the paper — so it is
    // chrome-only and the ONE print rule drops it (task 535; it used to be
    // hidden by name in the print block).
    <div className={chromeOnly("forest-refusal-badge")} role="status" contentEditable={false}>
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className="forest-refusal-badge-icon"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span className="forest-refusal-badge-text">
        Tree preview unavailable — {refusal.message}
      </span>
      <span className="forest-refusal-badge-where">line {refusal.line}</span>
    </div>
  );
}

export default ForestRefusalBadge;
