/**
 * Bug-report drop: FSA boundary + pure builders.
 *
 * A dev-only "Report a bug" window (see BugReportWindow.tsx) writes each
 * report as NEW files into a once-per-machine user-picked folder — in
 * practice a Dropbox-synced inbox (e.g. Dropbox/Virgil-Inbox) that a
 * scheduled task-catcher heartbeat on the home machine drains into the
 * ~/virgil-tasks pipeline. No server: the sync service is the transport.
 *
 * Write protocol (the reader's contract):
 *  - one NEW folder per report (`buildDropFolderName` — timestamp + machine
 *    slug + random suffix), never a rewrite of an existing file, so a sync
 *    daemon can never mint a "conflicted copy" of a drop;
 *  - screenshots (`shot-N.<ext>`) are written FIRST, `report.md` LAST — the
 *    completion marker. Its frontmatter carries the `screenshots` manifest,
 *    so a reader that sees report.md can verify every file arrived before
 *    consuming the drop (sync services do not guarantee arrival order).
 *
 * Handle persistence follows library-folder.ts: the shared "virgil" IDB
 * store (never a second DB), one key, permission re-requested from a user
 * gesture. This module is deliberately OUTSIDE the storage facade
 * (storage.ts) — the drop folder is not a document and takes no doc locks.
 */

import { get, set, del, createStore } from "idb-keyval";
import { sanitizeFilename } from "@library/lib/queue";
import { writeTextFile, writeBinaryFile } from "@library/lib/library-storage";
import type { PickFolderResult } from "@library/lib/library-folder";

const store = createStore("virgil", "kv");
const HANDLE_KEY = "bugreport-folder-handle";

export async function getBugReportHandle(): Promise<
  FileSystemDirectoryHandle | undefined
> {
  return get<FileSystemDirectoryHandle>(HANDLE_KEY, store);
}

export async function setBugReportHandle(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  await set(HANDLE_KEY, handle, store);
}

export async function clearBugReportHandle(): Promise<void> {
  await del(HANDLE_KEY, store);
}

/** Must be called from inside a user gesture (FSA spec). Same discriminated
 *  result as pickLibraryFolder so the caller can surface a stuck-picker
 *  state instead of silently no-op'ing. No dev-storage branch: the whole
 *  feature is gated off where isDevStorage is true. */
export async function pickBugReportFolder(): Promise<PickFolderResult> {
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker({ mode: "readwrite" });
  } catch (err) {
    const name = (err as DOMException)?.name;
    const message = (err as Error)?.message ?? String(err);
    if (name === "AbortError") return { kind: "cancelled" };
    if (name === "NotAllowedError") {
      return {
        kind: "locked",
        message:
          "The browser file picker is already active (or stuck from a previous attempt). " +
          "Dismiss any open file/save dialog, then try again. If nothing visible is open, fully quit and reopen the app window.",
      };
    }
    return { kind: "error", message };
  }
  await setBugReportHandle(handle);
  return { kind: "ok", handle };
}

// ── Pure builders ───────────────────────────────────────────────────────────

/** Machine label → folder-name-safe slug. The empty-input guard runs
 *  BEFORE sanitizeFilename (whose own fallback is "file", not ours). */
export function machineSlug(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "unknown";
  const slug = sanitizeFilename(trimmed)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return slug || "unknown";
}

/** 4 chars of collision insurance for same-second sends from one machine. */
export function randomSuffix(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/** `2026-08-19-212205Z-imac-x7kq` — UTC, and deliberately NO colons: FSA
 *  (and Windows filesystems under Dropbox) reject them. */
export function buildDropFolderName(
  now: Date,
  machineLabel: string,
  rand: string,
): string {
  const iso = now.toISOString(); // 2026-08-19T21:22:05.123Z
  const stamp = `${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  return `${stamp}-${machineSlug(machineLabel)}-${rand}`;
}

/** Clipboard image MIME → file extension. Anything unknown falls back to
 *  png (macOS screenshots paste as image/png in Chromium). */
export function extFromMime(type: string): string {
  switch (type) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/tiff":
      return "tif";
    default:
      return "png";
  }
}

export interface BugReportMeta {
  /** ISO timestamp of the Send click. */
  sentAt: string;
  machineLabel: string;
  appVersion: string;
  userAgent: string;
  /** Name of the open document, or null from the empty state. */
  docName: string | null;
  /** Manifest, in tray order: ["shot-1.png", …]. */
  screenshots: string[];
}

/**
 * The report.md the heartbeat parses (REMOTE_INBOX.md is the reader).
 * Every frontmatter string is JSON-quoted so a userAgent or doc name
 * carrying `:` or `"` can't break the block; JSON is valid YAML.
 */
export function buildReportMarkdown(meta: BugReportMeta, text: string): string {
  const q = (s: string) => JSON.stringify(s);
  const lines = [
    "---",
    `kind: ${q("virgil-bug-report")}`,
    "version: 1",
    `sentAt: ${q(meta.sentAt)}`,
    `machine: ${q(meta.machineLabel)}`,
    `appVersion: ${q(meta.appVersion)}`,
    `userAgent: ${q(meta.userAgent)}`,
    `doc: ${meta.docName === null ? "null" : q(meta.docName)}`,
    `screenshots: ${JSON.stringify(meta.screenshots)}`,
    "---",
  ];
  return lines.join("\n") + "\n\n" + text + (text.endsWith("\n") ? "" : "\n");
}

export interface BugReportImage {
  blob: Blob;
  ext: string;
}

/**
 * Two-phase write of one report into the drop folder. Screenshots first,
 * report.md LAST — see the module header. The folder is created by the
 * first write's own segment walk (writeTextFile/writeBinaryFile create
 * missing directories).
 */
export async function writeBugReport(
  handle: FileSystemDirectoryHandle,
  args: {
    text: string;
    images: BugReportImage[];
    meta: Omit<BugReportMeta, "screenshots">;
  },
): Promise<{ folderName: string }> {
  const folderName = buildDropFolderName(
    new Date(args.meta.sentAt),
    args.meta.machineLabel,
    randomSuffix(),
  );
  const screenshots = args.images.map((img, i) => `shot-${i + 1}.${img.ext}`);
  for (let i = 0; i < args.images.length; i++) {
    await writeBinaryFile(handle, `${folderName}/${screenshots[i]}`, args.images[i].blob);
  }
  const markdown = buildReportMarkdown({ ...args.meta, screenshots }, args.text);
  await writeTextFile(handle, `${folderName}/report.md`, markdown);
  return { folderName };
}
