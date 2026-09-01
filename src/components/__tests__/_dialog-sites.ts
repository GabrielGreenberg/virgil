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

/* ── The BUTTON population ─────────────────────────────────────────── */

export interface DialogButtonSite {
  /** Path relative to `src/`. */
  rel: string;
  /** The `<SystemDialogButton …>` open tag, attributes and all. */
  tag: string;
}

/**
 * Every production `<SystemDialogButton>` ELEMENT under `src/`.
 *
 * A SECOND population rather than a filter over `dialogElements()`, and the
 * reason is exactness in both directions. Scanning dialog SUBTREES would
 * double-count a button inside a nested `<SystemDialog>` (`ManageStylesModal`
 * hosts three), and it would MISS a danger button rendered by a helper that
 * composes no dialog frame of its own. Enumerated ONCE here, so "who the dialog
 * buttons are" has a single answer for every census that asks about them —
 * the same rule the dialog population states about itself.
 */
export function dialogButtonElements(): DialogButtonSite[] {
  const out: DialogButtonSite[] = [];
  for (const abs of walk(SRC_ROOT)) {
    const rel = abs.slice(SRC_ROOT.length + 1).replace(/\\/g, "/");
    if (SHELL.includes(rel)) continue;
    const src = commentsStripped(readFileSync(abs, "utf8"));
    for (const hit of elementsNamed(src, "SystemDialogButton")) {
      out.push({ rel, tag: hit.tag });
    }
  }
  return out;
}

/**
 * The `variant` attribute's value as written — `{ literal }` for
 * `variant="danger"`, `{ expr }` for `variant={…}`, `null` when the attribute
 * is absent (the button then takes the shell's `"secondary"` default).
 *
 * The expression is read by BALANCING braces rather than by `[^}]*`: an
 * expression legitimately carries nested braces (`variant={f({ a: 1 })}`), and
 * a regex that truncates at the first `}` fails OPEN — it would stop seeing the
 * word it was looking for. Task 470 records the same trap one census over.
 */
export function variantAttr(
  tag: string,
): { literal: string } | { expr: string } | null {
  const m = /\bvariant=/.exec(tag);
  if (!m) return null;
  const i = m.index + m[0].length;
  if (tag[i] === '"') {
    const close = tag.indexOf('"', i + 1);
    return close < 0 ? null : { literal: tag.slice(i + 1, close) };
  }
  if (tag[i] !== "{") return null;
  let depth = 0;
  for (let j = i; j < tag.length; j++) {
    if (tag[j] === "{") depth++;
    else if (tag[j] === "}") {
      depth--;
      if (depth === 0) return { expr: tag.slice(i + 1, j) };
    }
  }
  return null;
}

/**
 * Can this button render as DESTRUCTIVE?
 *
 * Fails CLOSED, and that direction is the whole point: a literal
 * `variant="danger"` obviously can, and **any EXPRESSION is assumed to** —
 * because after task 528 the two derived sites read
 * `confirmActionVariant(tone)`, whose result a source census cannot evaluate.
 * The only proof a button is safe is a LITERAL that is not `"danger"` (or no
 * variant at all, which is the `"secondary"` default). So a new derived variant
 * is in scope by existing, which is what keeps this from going quietly blind.
 */
export function canRenderDanger(tag: string): boolean {
  const v = variantAttr(tag);
  if (!v) return false;
  return "expr" in v ? true : v.literal === "danger";
}

/**
 * Does this button carry a BARE `autoFocus` — an UNCONDITIONAL cue?
 *
 * `autoFocus` marks the cued default (task 389), so a bare one on a button that
 * can render destructive is the task-386 trap. A DERIVED
 * `autoFocus={cued === "confirm"}` is not bare; neither is an absent one.
 * `autoFocus={true}` is spelled out but unconditional, so it counts.
 */
export function hasBareAutoFocus(tag: string): boolean {
  if (/\bautoFocus=\{true\}/.test(tag)) return true;
  return /\bautoFocus\b(?!\s*=)/.test(tag);
}
