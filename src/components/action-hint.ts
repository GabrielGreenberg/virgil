import { iconHint } from "@/components/Hint";
import { keysFromKeybinding } from "@/components/Kbd";
import type { ActionSpec } from "@/lib/actions/action-registry";

/**
 * The hint of a control that RUNS a registry row (task 1352) — its NAME is the
 * row's `label`, its advertised chord the row's `keybinding` (rendered by
 * `<Kbd>`, platform-aware, never part of the accessible name — task 985), and
 * when it is greyed with a known reason, the reason after the name ("Bold —
 * Not available in this field"), also announced as the accessible DESCRIPTION
 * (task 968). The ⚡ grid's cells and the card-body format toolbar both read
 * it, so a control and its twin cannot be called two things.
 */
export function actionHint(
  spec: Pick<ActionSpec, "label" | "keybinding">,
  why: string | null,
) {
  return {
    ...iconHint({
      label: spec.label,
      hint: why ? `${spec.label} — ${why}` : undefined,
      keys: spec.keybinding ? keysFromKeybinding(spec.keybinding) : undefined,
    }),
    "aria-description": why ?? undefined,
  };
}
