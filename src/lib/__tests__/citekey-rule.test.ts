// The citekey rule's cite-side door (task 945). `validateCitekey` is the ONE
// statement of which characters a key may hold — read by the Bibliography
// Save door (`validateBibEntryHead`) and now by the citation picker's raw
// commit (`parseRawCitekeys`), which used to interpolate whatever was typed
// straight into `\cite{…}`.
import { describe, it, expect } from "vitest";
import {
  parseRawCitekeys,
  validateBibEntryHead,
  validateCitekey,
} from "@/lib/bib-entry-head";

describe("validateCitekey", () => {
  it.each([
    ["kripke1980"],
    ["Lewis:1986a"],
    ["van-fraassen_1980"],
  ])("accepts %s", (key) => {
    expect(validateCitekey(key)).toEqual({ ok: true });
  });

  it.each([
    ["Kripke naming", "a space"],
    ["a}b", "“}”"],
    ["a{b", "“{”"],
    ["a%b", "“%”"],
    ["a\\b", "“\\”"],
    ["a,b", "“,”"],
  ])("refuses %s, naming %s", (key, shown) => {
    const r = validateCitekey(key);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(`A citation key cannot contain ${shown}.`);
  });

  it("refuses an empty key", () => {
    expect(validateCitekey("   ").ok).toBe(false);
  });

  it("is the same rule the Bibliography head door reads", () => {
    const head = validateBibEntryHead({ key: "a%b", type: "article" }, { entries: [] });
    expect(head).toEqual(validateCitekey("a%b"));
  });
});

describe("parseRawCitekeys", () => {
  it("passes a single legal key through", () => {
    expect(parseRawCitekeys(" kripke1980 ")).toEqual({
      ok: true,
      keys: ["kripke1980"],
      text: "kripke1980",
    });
  });

  it("reads a comma list as several keys, normalized", () => {
    expect(parseRawCitekeys("kripke1980, lewis1986,")).toEqual({
      ok: true,
      keys: ["kripke1980", "lewis1986"],
      text: "kripke1980,lewis1986",
    });
  });

  it("refuses a search phrase — the likely accidental raw commit", () => {
    expect(parseRawCitekeys("Kripke naming and necessity").ok).toBe(false);
  });

  it.each([["a}b"], ["a%b"], ["kripke1980, a b"], [","]])(
    "refuses %s",
    (text) => {
      expect(parseRawCitekeys(text).ok).toBe(false);
    },
  );
});
