/**
 * The shared POPULATION for every census over `<SystemDialog>` — one walk, read
 * by the cued-default census (task 389) and the variant census (task 515).
 *
 * Two censuses asking different questions of the SAME set is the point: what
 * must not happen is two implementations of "who are the dialog sites", which
 * is how one guard comes to be scanning a set the other no longer is (task 415
 * states the rule for the write-door population, and this is that rule one
 * subsystem over).
 *
 * Enumerated per ELEMENT, not per file: `ManageStylesModal` renders one dialog
 * and hosts three more, so a file-scoped question lets one dialog be excused by
 * a sibling's declaration.
 *
 * Read `commentsStripped`, NOT `codeOnly`: both censuses' needles must match
 * INSIDE a quoted attribute (`variant="draggable"`), and `codeOnly` blanks
 * string literals — the exact trap `_source-scan` documents. Comments still go,
 * which is what each suite's prose canary needs.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { commentsStripped, elementsNamed } from "@/lib/__tests__/_source-scan";

/** `src/` — the walk root. The library silo hosts no dialogs; pinned there. */
export const SRC_ROOT = join(__dirname, "..", "..");

/** The shell itself DEFINES the primitives; it declares nothing. */
export const SHELL = ["components/system-dialog.tsx"];

export function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

export interface DialogSite {
  /** Path relative to `src/`. */
  rel: string;
  /** The `<SystemDialog …>` open tag. */
  tag: string;
  /** Everything between that tag and its close. */
  subtree: string;
}

/** Every production `<SystemDialog>` ELEMENT under `src/`. */
export function dialogElements(): DialogSite[] {
  const out: DialogSite[] = [];
  for (const abs of walk(SRC_ROOT)) {
    const rel = abs.slice(SRC_ROOT.length + 1).replace(/\\/g, "/");
    if (SHELL.includes(rel)) continue;
    const src = commentsStripped(readFileSync(abs, "utf8"));
    for (const hit of elementsNamed(src, "SystemDialog")) {
      out.push({ rel, tag: hit.tag, subtree: hit.subtree ?? "" });
    }
  }
  return out;
}
