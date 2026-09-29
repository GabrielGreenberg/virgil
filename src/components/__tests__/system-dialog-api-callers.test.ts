/**
 * Task 834 — **every method of the imperative dialog API has a production caller.**
 *
 * `useSystemDialog().prompt` sat published for months with nothing calling it
 * — and it was the one host dialog that hand-rolled its body focus in a mount
 * effect, the pattern the shell's `initialFocus` door forbids. Dead code that
 * models the forbidden shape is what the next author copies. "A registry earns
 * its name by being read": this census reads `SystemDialogApi`'s members off the
 * source and requires each one to be CALLED somewhere outside tests and
 * comments, so a door can no longer outlive its last caller unnoticed.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { commentsStripped } from "@/lib/__tests__/_source-scan";
import { productionFiles } from "./_dialog-sites";

const HOST = "components/system-dialog-host.tsx";

function apiMethods(): string[] {
  const host = readFileSync(
    productionFiles().find((f) => f.rel === HOST)!.abs,
    "utf8",
  );
  const body = /export interface SystemDialogApi \{([\s\S]*?)\n\}/.exec(host)?.[1];
  if (!body) throw new Error("SystemDialogApi not found in the host");
  return [...body.matchAll(/^\s*(\w+)\(/gm)].map((m) => m[1]);
}

describe("SystemDialogApi: no published door without a caller (task 834)", () => {
  const methods = apiMethods();
  const sources = productionFiles()
    .filter((f) => f.rel !== HOST && /\.tsx?$/.test(f.rel))
    .map((f) => commentsStripped(readFileSync(f.abs, "utf8")));

  it("reads the API off the source (it is not scanning nothing)", () => {
    expect(methods).toEqual(expect.arrayContaining(["alert", "confirm"]));
  });

  it.each(apiMethods())("`%s` is called in production code", (method) => {
    // The receiver is the hook's result, which call sites name `dialog`,
    // `systemDialog`, … — requiring "dialog" in it keeps `window.confirm`
    // from standing in for a real caller.
    const call = new RegExp(`\\b\\w*[Dd]ialog\\w*\\??\\.${method}\\(`);
    expect(sources.some((src) => call.test(src))).toBe(true);
  });
});
