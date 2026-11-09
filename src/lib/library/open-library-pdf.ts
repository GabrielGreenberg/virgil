/**
 * Open a library paper's PDF (`papers/<citekey>/<citekey>.pdf`) in a new
 * window, from the bibliography's open view.
 *
 * The window opens SYNCHRONOUSLY, inside the click, and is pointed at the
 * file once it is read — a `window.open` after an `await` has lost the user
 * gesture and a popup blocker eats it. A file that is missing or unreadable
 * closes that window again and says so to the caller, so the user never gets
 * a blank tab. The object URL is revoked once the new window has had ample
 * time to load it; the timer is module-scoped on purpose — it belongs to the
 * opened window, not to the card that opened it, which may close first.
 */

import { getLibraryHandle } from "@library/lib/library-folder";
import { readFile } from "@library/lib/library-storage";

export type OpenPdfResult = "opened" | "missing" | "unreadable" | "blocked";

/** Long enough for the browser's viewer to have read the blob. */
const REVOKE_AFTER_MS = 60_000;

export function libraryPdfPath(citekey: string): string {
  return `papers/${citekey}/${citekey}.pdf`;
}

export async function openLibraryPdf(citekey: string): Promise<OpenPdfResult> {
  const win = window.open("", "_blank");
  if (!win) return "blocked";
  let file: File | undefined;
  try {
    const root = await getLibraryHandle();
    file = root ? await readFile(root, libraryPdfPath(citekey)) : undefined;
  } catch {
    win.close();
    return "unreadable";
  }
  if (!file) {
    win.close();
    return "missing";
  }
  const url = URL.createObjectURL(file);
  win.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  return "opened";
}
