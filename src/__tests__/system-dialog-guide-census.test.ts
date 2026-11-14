import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SYSTEM-DIALOG GUIDE HONESTY — the Modals prose names the dialog API its types
 * actually have (task 2026-11-13-1613).
 *
 * The guide condemns "a spec that describes nothing", and its Modals section
 * was one: `useSystemDialog()` was documented as exposing `alert` / `confirm` /
 * `prompt` when `SystemDialogApi` has never had a `prompt`, and
 * `<SystemDialogButton>` was documented as mapping a `accent` variant that task
 * 1258 removed. Nothing failed — an agent reading the guide would simply have
 * called a method that does not exist.
 *
 * Narrow on purpose (not a general doc linter): two sentences, two types.
 *
 *   1. The backticked members in the "**Imperative dialogs.**" paragraph's
 *      "exposes … —" list equal the members of `SystemDialogApi`.
 *   2. The slash-separated variant list in the `<SystemDialogButton>` sentence
 *      equals the members of `SystemDialogButtonVariant`.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const GUIDE = read("src/STYLE_GUIDE.md");
const HOST = read("src/components/system-dialog-host.tsx");
const DIALOG = read("src/components/system-dialog.tsx");

const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

/** Method names declared in `export interface SystemDialogApi { … }`. */
function apiMembers(): string[] {
  const body = HOST.match(/export interface SystemDialogApi\s*\{([^}]*)\}/)?.[1];
  expect(body, "SystemDialogApi interface not found").toBeTruthy();
  return sorted([...body!.matchAll(/^\s*(\w+)\s*[(<:?]/gm)].map((m) => m[1]));
}

/** String-literal members of `SystemDialogButtonVariant`. */
function buttonVariants(): string[] {
  const decl = DIALOG.match(
    /export type SystemDialogButtonVariant\s*=([\s\S]*?);/,
  )?.[1];
  expect(decl, "SystemDialogButtonVariant not found").toBeTruthy();
  return sorted([...decl!.matchAll(/"(\w+)"/g)].map((m) => m[1]));
}

describe("system-dialog guide census (task 1613)", () => {
  it("the Imperative-dialogs paragraph names exactly SystemDialogApi's members", () => {
    const para = GUIDE.match(/\*\*Imperative dialogs\.\*\*([\s\S]*?)\n\n/)?.[1];
    expect(para, "Imperative dialogs paragraph not found").toBeTruthy();
    const list = para!.match(/exposes\s+([\s\S]*?)\s+—/)?.[1];
    expect(list, "no `exposes … —` list in the paragraph").toBeTruthy();
    const named = sorted([...list!.matchAll(/`(\w+)`/g)].map((m) => m[1]));
    expect(named).toEqual(apiMembers());
  });

  it("the SystemDialogButton sentence lists exactly SystemDialogButtonVariant", () => {
    const sentence = GUIDE.match(
      /`<SystemDialogButton>`[^`]*`([a-z/]+)`/,
    )?.[1];
    expect(sentence, "SystemDialogButton variant list not found").toBeTruthy();
    expect(sorted(sentence!.split("/"))).toEqual(buttonVariants());
  });
});
