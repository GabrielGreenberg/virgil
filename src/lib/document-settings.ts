/**
 * Per-document settings sidecar — `virgil/document-settings.json`.
 *
 * Currently holds only the active document style id. The .tex preamble
 * is the source of truth for what LaTeX actually compiles; this sidecar
 * is the source of truth for what the Style dropdown displays as
 * "currently selected" after a reload.
 */

import { readSidecar, writeSidecar } from "@/lib/storage";
import { DEFAULT_STYLE_ID, type DocumentStyleId } from "@/lib/document-styles";

export interface DocumentSettings {
  style: DocumentStyleId;
}

const SIDECAR_FILENAME = "document-settings.json";

const DEFAULT_SETTINGS: DocumentSettings = { style: DEFAULT_STYLE_ID };

export async function readDocumentSettings(
  docId: string,
): Promise<DocumentSettings> {
  return readSidecar<DocumentSettings>(docId, SIDECAR_FILENAME, DEFAULT_SETTINGS);
}

export async function writeDocumentSettings(
  docId: string,
  settings: DocumentSettings,
): Promise<void> {
  return writeSidecar(docId, SIDECAR_FILENAME, settings);
}
