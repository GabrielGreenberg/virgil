/**
 * Runtime backend selection for the storage facade.
 *
 * `NEXT_PUBLIC_DEV_STORAGE` enables the dev backend at build time. At
 * runtime we only actually use it when FSA is unavailable — i.e. inside
 * an iframe (Claude Preview) or a browser without `showDirectoryPicker`.
 * The same dev server loaded in a normal tab uses the FSA backend.
 *
 * Lives in its own module so both `storage.ts` and modules used by the
 * backends (e.g. `doc-index.ts`) can import it without cycles.
 */
import { readFlag } from "./feature-flags";
import { hasFsaSupport } from "./fsa-support";

const devStorageAllowed = !!process.env.NEXT_PUBLIC_DEV_STORAGE;

function detectDevStorage(): boolean {
  if (!devStorageAllowed) return false;
  if (typeof window === "undefined") return false;
  // Manual opt-in: useful when the host can't be detected as an iframe
  // (e.g. Claude Preview's headless Chromium loads pages with
  // `window.self === window.top`, which would otherwise force FSA mode
  // even though no real picker can run).
  if (readFlag("virgil:force-dev-storage")) return true;
  const inIframe = window.self !== window.top;
  const fsaAvailable = "showDirectoryPicker" in window;
  return inIframe || !fsaAvailable;
}

export const isDevStorage = detectDevStorage();

/**
 * Can the FSA FILE picker (`showOpenFilePicker`) run from this user gesture,
 * on this session's backend? The one answer to "which backend is this session
 * on" is `isDevStorage` above, so the picker asks it rather than re-deriving it
 * (task 1085 — the picker used to mirror the detection and read
 * `virgil:force-dev-storage` unconditionally, so a production build with the
 * flag left set ran FSA storage behind an `<input>` picker).
 *
 * Beyond the backend choice, one constraint belongs to the picker itself: the
 * FSA picker either swallows the gesture or throws a `SecurityError` inside an
 * iframe (Claude Preview's headless Chromium is the recurring offender), so an
 * iframe is never usable even where FSA storage would be.
 */
export function fsaPickerUsable(): boolean {
  if (!hasFsaSupport()) return false;
  if (isDevStorage) return false;
  return window.self === window.top;
}
