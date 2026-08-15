/**
 * **Can this float be captured onto the Stack?** — the DECLARED half of the
 * stack-capture gesture, resolved from a float key alone.
 *
 * The gesture asks this question at two moments: the drag asks it to decide
 * whether to light the StackIcon's illuminated capture ring (and to accept the
 * release), and the receiving host asks it before it spends a doc read building
 * a `Floatable`. Before task 332 only the SECOND site had an answer: the hover
 * gated on `if (cardKey)` and pure geometry, so dragging a Report /
 * Report Request / Example float onto the icon lit the ring exactly as a note
 * does, the release was accepted, `snapshotForStack` returned null — and the
 * float was closed anyway. The gesture advertised a capability the kind does
 * not have and then removed the thing the user was holding.
 *
 * That is the false-affordance family this subsystem has already been drained
 * of twice (`AGENTS.md` → "The affordance half: what the hover OFFERS is what
 * the commit ACCEPTS", and "The feedback half: the DECISION is derived from the
 * EXECUTION"). The rule both earned applies verbatim here: **the affordance and
 * the commit read the SAME table**, and the capability is resolved ONCE at
 * gesture start — never per mousemove — because it is a registry read whose
 * answer cannot change mid-gesture (the same reason `resolveSessionPlacements`
 * runs once per drop session).
 *
 * **Deliberately light.** This module imports the card spine's runtime LEAF
 * (`card-registry.tsx`) and the key grammar, and nothing else — no float bodies,
 * no `@/cards/floats` side-effect registration, no editor. `FloatingPanel` is a
 * low-level shell that half the app mounts, so the *declaration* half must not
 * drag the float body tree in behind it. The EXECUTION half — resolve the
 * `Floatable` and ask it to serialize — lives in `./resolve-floatable`, which is
 * free to be heavy because only the host imports it.
 *
 * @see resolveFloatable / captureFloatToStack — the execution half.
 */
import { parseAnyKey } from "./float-key";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { isCardKind } from "@/cards/predicates";

/**
 * Whether a float with this key can be captured onto the Stack.
 *
 * CARD floats read `CARD_REGISTRY[kind].stackable` — the one declaration the
 * Stack's whole vocabulary is pinned to (`assertStackCoverage()` at boot,
 * `cards/__tests__/stack-coverage.test.ts` for the mechanisms a boot assertion
 * can't reach). It is never re-stated here: `report` / `report-request` /
 * `example` are absent because the registry says so, not because this file
 * lists them.
 *
 * TEXT-OBJECT floats are capture-capable as a family, and that is a derivation
 * rather than a shrug: `snapshotTextObject` is TOTAL over `TextObjectKind`
 * (heading → section, `linkedRange` / sub-objects → text slice, every other
 * top-level node → single block), so there is no kind-shaped refusal to declare.
 * What it CAN answer null for is a source that no longer resolves — a deleted
 * paragraph, an unmappable id — and that is a fact about this moment, not about
 * the kind. Such a failure is caught by the other half of the fix: the host
 * closes the float only on a snapshot that actually landed, so a capture that
 * cannot resolve leaves the user holding their card instead of eating it.
 * Deliberately NOT keyed on `TEXT_OBJECT_REGISTRY[kind].floatBodyComponent`,
 * which is mutable state written by a side-effect registration module — an
 * affordance must not depend on import order.
 *
 * **Stated limit**, since the two branches are not symmetric: this answers the
 * textobject domain without validating the KIND, while the door
 * (`resolveFloatable`) refuses a kind the registry does not know. The gap is
 * reachable only from a prefs blob written by a build that had a kind this one
 * has dropped, and it fails the benign way — a ring that lights over a capture
 * the report then refuses, leaving the float where the user put it. Closing it
 * would mean importing the text-object registry into a module the drag shell
 * takes, which is the weight this file exists to avoid.
 */
export function canCaptureToStack(floatKey: string): boolean {
  const parsed = parseAnyKey(floatKey);
  if (!parsed) return false;
  if (parsed.domain === "textobject") return true;
  return isCardKind(parsed.kind) && CARD_REGISTRY[parsed.kind].stackable;
}
