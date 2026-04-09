/**
 * File System Access API feature detection.
 *
 * Virgil's storage layer is built on the FSA spec
 * (https://wicg.github.io/file-system-access/), which is currently a
 * Chromium-only API. We feature-detect rather than UA-sniff so that any
 * future engine that ships the spec works without changes.
 */

export function hasFsaSupport(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof window.showDirectoryPicker === "function" &&
    typeof window.showOpenFilePicker === "function" &&
    typeof FileSystemDirectoryHandle !== "undefined" &&
    typeof FileSystemFileHandle !== "undefined"
  );
}
