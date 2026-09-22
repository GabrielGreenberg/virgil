/**
 * Per-document settings sidecar — `virgil/document-settings.json`.
 *
 * Currently holds only the active document style id. The .tex preamble
 * is the source of truth for what LaTeX actually compiles; this sidecar
 * is the source of truth for what the Style dropdown displays as
 * "currently selected" after a reload.
 *
 * The styleId is a free-form string that resolves against the user's
 * style library (localStorage) via `resolveStyle()` — it can be a seed
 * id like `"classic"` or a user-generated id like `"style_abc12345"`.
 */

import { readSidecar, writeSidecar, type DocWriteHandle } from "@/lib/storage";
import { DEFAULT_STYLE_ID } from "@/lib/document-styles";
import { withSidecarEnvelope } from "@/lib/sidecar-migrate";

export interface DocumentSettings {
  styleId: string;
}

const SIDECAR_FILENAME = "document-settings.json";

const DEFAULT_SETTINGS: DocumentSettings = { styleId: DEFAULT_STYLE_ID };

/**
 * Migrate a raw JSON blob to the current shape. Handles the legacy
 * `style` field (renamed to `styleId` when the library overhaul landed).
 */
function migrateDocumentSettingsShape(raw: unknown): DocumentSettings {
  const s = (raw ?? {}) as Partial<DocumentSettings> & { style?: string };
  const styleId = s.styleId ?? s.style ?? DEFAULT_STYLE_ID;
  return { styleId };
}

/**
 * Task 715 — this file is the CLUSTER'S LIVE MEMBER, not a latent one:
 * `apply_response.py`'s `settingsEdit` op merges ARBITRARY keys into it
 * (`for k, v in sets.items(): state[k] = v`), and the rebuild above returned
 * `{styleId}` alone, so anything a skill set beside the style id was gone on
 * the app's next write. `style` is the one legacy key consumed (it becomes
 * `styleId`); everything else rides through.
 */
export const migrateDocumentSettings = withSidecarEnvelope(
  migrateDocumentSettingsShape,
  ["style"],
);

export async function readDocumentSettings(
  docId: string,
): Promise<DocumentSettings> {
  const raw = await readSidecar<unknown>(docId, SIDECAR_FILENAME, DEFAULT_SETTINGS);
  return migrateDocumentSettings(raw);
}

export async function writeDocumentSettings(
  handle: DocWriteHandle,
  settings: DocumentSettings,
): Promise<void> {
  return writeSidecar(handle, SIDECAR_FILENAME, settings);
}
