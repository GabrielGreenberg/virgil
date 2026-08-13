/**
 * **Bib-completeness for the Stack — the seam's own contract (task 235).**
 *
 * The Stack is cross-document, `references.bib` is per-doc and bib annotations
 * live in a per-doc `annotations.json` sidecar, so whatever a payload's `\cite`
 * atoms point at must travel WITH the payload. Before 235 only the CARD family
 * did: `snapshotCard`'s citation/bibliography arms resolved bib sidecars through
 * a `CardSnapshotCtx`, and the three CONTENT helpers took no ctx at all — so a
 * `\cite` riding a text slice / paragraph / heading section arrived in doc B as
 * a dangling reference with the source's note silently gone.
 *
 * This suite pins the unified seam. The two task-069 contracts it inherits (a
 * bibliography card's annotation; a citation card's per-key annotations) are
 * re-expressed here at the ADD door rather than in the snapshot helper — they
 * used to live in `snapshot-bib-annotation.test.ts`, which this file replaces,
 * because the helper is a pure serializer again.
 *
 * The END-TO-END half — a real snapshot of citation-bearing CONTENT pulled into
 * a destination doc through the real drop spec — is
 * `components/drop-mode/__tests__/stack-content-bib-carry.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  applyBibCarry,
  buildBibCarry,
  collectCiteKeys,
  normalizeStackItemBib,
  withBibCarry,
  type StackBibCtx,
} from "../bib-carry";
import type { StackItem, StackPayload } from "../types";
import type { BibEntry } from "@/lib/types";

function bibEntry(key: string, uid = `uid-${key}`): BibEntry {
  return {
    uid,
    key,
    type: "article",
    fields: { title: `On ${key}`, author: "Smith" },
    raw: `@article{${key}}`,
  };
}

const SMITH = bibEntry("smith2020");
const JONES = bibEntry("jones1990");

/** A source doc holding both entries; only smith2020 has a bib-review note. */
const SOURCE_DOC: StackBibCtx = {
  getBibEntry: (k) => ({ smith2020: SMITH, jones1990: JONES })[k],
  getAnnotation: (k) => (k === "smith2020" ? "<p>Smith note.</p>" : ""),
};

/** A citation ATOM node, as it sits inside serialized payload content. */
function citeAtom(command: string) {
  return { type: "citation", attrs: { citationId: "c1", command } };
}

function textPayload(content: unknown): StackPayload {
  return {
    kind: "text",
    slice: { content, openStart: 0, openEnd: 0 },
  } as unknown as StackPayload;
}

function itemWith(payload: StackPayload, bib?: StackItem["bib"]): StackItem {
  return {
    id: "item-1",
    capturedAt: "2026-07-26T00:00:00.000Z",
    source: { docId: "docA" },
    payload,
    ...(bib ? { bib } : {}),
  };
}

describe("collectCiteKeys — the keys are DERIVED from the content", () => {
  it("reads a cite atom's command wherever it sits in a TEXT slice", () => {
    const keys = collectCiteKeys(
      textPayload([
        {
          type: "paragraph",
          content: [{ type: "text", text: "see " }, citeAtom("\\citep{smith2020}")],
        },
      ]),
    );
    expect(keys).toEqual(["smith2020"]);
  });

  it("reads a multi-key command as every key it names", () => {
    const keys = collectCiteKeys(
      textPayload([citeAtom("\\citep{smith2020,jones1990}")]),
    );
    expect(keys).toEqual(["smith2020", "jones1990"]);
  });

  it("reaches a cite nested in a FOOTNOTE BODY (attrs.content — where a schema walk would not go)", () => {
    // The headline nested case from the task's scope question: select text
    // spanning a footnote whose body cites something. A footnote keeps its body
    // in `attrs.content`, which `doc.descendants()` never enters — the plain
    // JSON walk reaches it because `attrs` is just another object value.
    const keys = collectCiteKeys(
      textPayload([
        {
          type: "paragraph",
          content: [
            {
              type: "footnote",
              attrs: {
                footnoteId: "f1",
                content: {
                  type: "doc",
                  content: [
                    { type: "paragraph", content: [citeAtom("\\cite{jones1990}")] },
                  ],
                },
              },
            },
          ],
        },
      ]),
    );
    expect(keys).toEqual(["jones1990"]);
  });

  it("reaches a cite inside a CARD BODY, and adds what a bibliographic card DECLARES", () => {
    // A note card whose body cites something: contained (walk) — no declaration.
    const noteKeys = collectCiteKeys({
      kind: "card",
      card: {
        cardKind: "note",
        data: {
          id: "n1",
          content: { type: "doc", content: [citeAtom("\\cite{jones1990}")] },
        },
      },
    } as unknown as StackPayload);
    expect(noteKeys).toEqual(["jones1990"]);

    // A citation card declares its own keys; a bibliography card its entry key.
    expect(
      collectCiteKeys({
        kind: "card",
        card: {
          cardKind: "citation",
          data: { id: "c1", command: "\\citep{smith2020}", keys: ["smith2020"] },
        },
      } as unknown as StackPayload),
    ).toEqual(["smith2020"]);
    expect(
      collectCiteKeys({
        kind: "card",
        card: { cardKind: "bibliography", data: SMITH },
      } as unknown as StackPayload),
    ).toEqual(["smith2020"]);
  });

  it("dedupes, and answers [] for a payload that cites nothing", () => {
    expect(
      collectCiteKeys(
        textPayload([
          citeAtom("\\cite{smith2020}"),
          citeAtom("\\citep{smith2020}"),
        ]),
      ),
    ).toEqual(["smith2020"]);
    expect(
      collectCiteKeys(textPayload([{ type: "paragraph", content: [{ type: "text", text: "plain" }] }])),
    ).toEqual([]);
  });

  it("survives a hostile/corrupt blob: a cyclic-depth payload terminates", () => {
    // The envelope is only shallowly validated, so a deeply nested blob must not
    // blow the stack. 300 levels is well past the walker's cap.
    let deep: unknown = citeAtom("\\cite{smith2020}");
    for (let i = 0; i < 300; i++) deep = { type: "wrap", content: [deep] };
    expect(() => collectCiteKeys(textPayload([deep]))).not.toThrow();
  });
});

describe("buildBibCarry — resolve against the SOURCE doc", () => {
  it("carries every resolvable entry plus the annotations that exist", () => {
    const carry = buildBibCarry(
      textPayload([citeAtom("\\citep{smith2020,jones1990}")]),
      SOURCE_DOC,
    );
    expect(carry?.entries.map((e) => e.key)).toEqual(["smith2020", "jones1990"]);
    expect(carry?.annotations).toEqual({ smith2020: "<p>Smith note.</p>" });
    // The un-annotated key is absent, not an empty string.
    expect("jones1990" in (carry?.annotations ?? {})).toBe(false);
  });

  it("is undefined when the payload cites nothing (persists byte-identically)", () => {
    expect(buildBibCarry(textPayload([{ type: "paragraph" }]), SOURCE_DOC)).toBeUndefined();
  });

  it("is undefined when nothing referenced resolves in the source doc", () => {
    const empty: StackBibCtx = { getBibEntry: () => undefined, getAnnotation: () => "" };
    expect(buildBibCarry(textPayload([citeAtom("\\cite{ghost}")]), empty)).toBeUndefined();
  });

  it("carries an annotation for a key whose ENTRY does not resolve", () => {
    // The source was already dangling there; dropping the user's note on top of
    // that would lose the one artifact the destination could still use.
    const noEntries: StackBibCtx = {
      getBibEntry: () => undefined,
      getAnnotation: (k) => (k === "smith2020" ? "<p>Note.</p>" : ""),
    };
    const carry = buildBibCarry(textPayload([citeAtom("\\cite{smith2020}")]), noEntries);
    expect(carry?.entries).toEqual([]);
    expect(carry?.annotations).toEqual({ smith2020: "<p>Note.</p>" });
  });

  // ── The two task-069 contracts, re-expressed at the ADD door ──────────
  it("069: a BIBLIOGRAPHY card carries its own entry's annotation", () => {
    const carry = buildBibCarry(
      { kind: "card", card: { cardKind: "bibliography", data: SMITH } } as unknown as StackPayload,
      SOURCE_DOC,
    );
    expect(carry?.entries.map((e) => e.key)).toEqual(["smith2020"]);
    expect(carry?.annotations).toEqual({ smith2020: "<p>Smith note.</p>" });
  });

  it("069: a CITATION card carries a per-key annotation map for its referenced entries", () => {
    const carry = buildBibCarry(
      {
        kind: "card",
        card: {
          cardKind: "citation",
          data: {
            id: "cit-1",
            command: "\\citep{smith2020,jones1990}",
            keys: ["smith2020", "jones1990"],
          },
        },
      } as unknown as StackPayload,
      SOURCE_DOC,
    );
    expect(carry?.entries.map((e) => e.key)).toEqual(["smith2020", "jones1990"]);
    expect(carry?.annotations).toEqual({ smith2020: "<p>Smith note.</p>" });
  });
});

describe("withBibCarry / applyBibCarry — the two doors", () => {
  it("attaches purely: the input item is untouched", () => {
    const item = itemWith(textPayload([citeAtom("\\cite{smith2020}")]));
    const carried = withBibCarry(item, SOURCE_DOC);
    expect(carried).not.toBe(item);
    expect(item.bib).toBeUndefined();
    expect(carried.bib?.entries.map((e) => e.key)).toEqual(["smith2020"]);
  });

  it("returns the SAME item when there is nothing to carry", () => {
    const item = itemWith(textPayload([{ type: "paragraph" }]));
    expect(withBibCarry(item, SOURCE_DOC)).toBe(item);
  });

  it("discharges entries before annotations, and skips empty notes", () => {
    const calls: string[] = [];
    applyBibCarry(
      { entries: [SMITH, JONES], annotations: { smith2020: "<p>n</p>", jones1990: "" } },
      {
        upsertBibEntry: (e) => calls.push(`upsert:${e.key}`),
        getAnnotation: () => "",
        setAnnotation: (k) => calls.push(`annotate:${k}`),
      },
    );
    expect(calls).toEqual(["upsert:smith2020", "upsert:jones1990", "annotate:smith2020"]);
  });

  it("ONE conflict rule for both halves: what the destination has, it KEEPS", () => {
    // `upsertBibEntry` is insert-if-absent by its own contract, so the
    // destination keeps its own `BibEntry` for a key it already knows — and an
    // overwriting note would then describe the entry that was DISCARDED, on a
    // work that may merely share the citekey. A carry fills empty slots.
    const calls: string[] = [];
    applyBibCarry(
      { entries: [SMITH], annotations: { smith2020: "<p>Doc A's note.</p>" } },
      {
        upsertBibEntry: (e) => calls.push(`upsert:${e.key}`),
        getAnnotation: (k) => (k === "smith2020" ? "<p>Doc B's own note.</p>" : ""),
        setAnnotation: (k, html) => calls.push(`annotate:${k}=${html}`),
      },
    );
    expect(calls).toEqual(["upsert:smith2020"]);
  });

  it("a same-doc pull writes NOTHING at all (idempotent in both halves)", () => {
    // `usePersistentState.update` bails only on referential equality, so a
    // re-write of a byte-identical note would still schedule a sidecar persist.
    const writes: string[] = [];
    applyBibCarry(
      { entries: [SMITH], annotations: { smith2020: "<p>Smith note.</p>" } },
      {
        upsertBibEntry: () => {},
        getAnnotation: () => "<p>Smith note.</p>",
        setAnnotation: (k) => writes.push(k),
      },
    );
    expect(writes).toEqual([]);
  });

  it("an absent carry writes nothing", () => {
    const calls: string[] = [];
    applyBibCarry(undefined, {
      upsertBibEntry: (e) => calls.push(e.key),
      getAnnotation: () => "",
      setAnnotation: (k) => calls.push(k),
    });
    expect(calls).toEqual([]);
  });
});

describe("normalizeStackItemBib — the pre-235 envelope lifts onto the carrier", () => {
  it("lifts a citation card's bibEntries + bibAnnotations", () => {
    const legacy = itemWith({
      kind: "card",
      card: {
        cardKind: "citation",
        data: { id: "cit-1", command: "\\citep{smith2020}", keys: ["smith2020"] },
        bibEntries: [SMITH],
        bibAnnotations: { smith2020: "<p>Smith note.</p>" },
      },
    } as unknown as StackPayload);

    const out = normalizeStackItemBib(legacy);
    expect(out.bib?.entries.map((e) => e.key)).toEqual(["smith2020"]);
    expect(out.bib?.annotations).toEqual({ smith2020: "<p>Smith note.</p>" });
  });

  it("lifts a bibliography card's bare `annotation`, keyed by its own entry", () => {
    const legacy = itemWith({
      kind: "card",
      card: { cardKind: "bibliography", data: SMITH, annotation: "<p>Key source.</p>" },
    } as unknown as StackPayload);

    expect(normalizeStackItemBib(legacy).bib?.annotations).toEqual({
      smith2020: "<p>Key source.</p>",
    });
  });

  it("passes through an item written by THIS build, and one with nothing to lift", () => {
    const carried = itemWith(textPayload([citeAtom("\\cite{smith2020}")]), {
      entries: [SMITH],
      annotations: {},
    });
    expect(normalizeStackItemBib(carried)).toBe(carried);

    const plain = itemWith(textPayload([{ type: "paragraph" }]));
    expect(normalizeStackItemBib(plain)).toBe(plain);
  });

  it("ignores a malformed legacy blob rather than carrying junk", () => {
    const junk = itemWith({
      kind: "card",
      card: {
        cardKind: "citation",
        data: { id: "cit-1", command: "\\cite{x}", keys: ["x"] },
        bibEntries: "not-an-array",
        bibAnnotations: { x: 42 },
      },
    } as unknown as StackPayload);
    expect(normalizeStackItemBib(junk).bib).toBeUndefined();
  });
});
