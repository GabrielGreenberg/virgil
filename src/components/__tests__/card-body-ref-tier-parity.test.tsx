// @vitest-environment jsdom
//
// Task 2026-11-12-1584 — a card body's `\ref` reads the SAME number in every
// presence tier. Pre-fix the citation/`\ref` display refresh had three copies:
// T1 static (`renderBorrowedHtml`) ADOPTED "??" over a good stored number, the
// T2 read-only twin (`BorrowedMainText`) never refreshed `\ref` at all, and T3
// (`RichTextField`) refused "??" — so one card's number flipped as it crossed
// the near-zone boundary. All three now read `refreshAtomDisplay`
// (`@/lib/borrowed-render`). Drives the REAL tier components under one
// CitationDisplayProvider and compares the rendered ref text.
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { render, waitFor, cleanup } from "@testing-library/react";
import { StaticBorrowedText } from "@/components/StaticBorrowedText";
import { BorrowedMainText } from "@/components/BorrowedMainText";
import RichTextField from "@/components/RichTextField";
import { CitationDisplayProvider } from "@/components/editor-layout/contexts/citation-display";

afterEach(cleanup);

const BODY = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "See " },
        { type: "labelRef", attrs: { label: "sec:x", refCommand: "ref", displayText: "2" } },
      ],
    },
  ],
};

const ctx = (answer: string | null) => ({
  getCitationDisplayText: (command: string) => command,
  onCitationCreated: () => ({ id: "x", displayText: "" }),
  getRefDisplayText: () => answer,
});

const REF = '[data-type="label-ref"]';

async function refText(ui: React.ReactElement, answer: string | null): Promise<string> {
  const { container } = render(<CitationDisplayProvider value={ctx(answer)}>{ui}</CitationDisplayProvider>);
  let text = "";
  await waitFor(() => {
    const el = container.querySelector(REF) ?? null;
    expect(el).not.toBeNull();
    text = el!.textContent ?? "";
    expect(text).not.toBe("");
  });
  cleanup();
  return text;
}

const TIERS: [string, () => React.ReactElement][] = [
  ["T1 static", () => <StaticBorrowedText value={BODY} />],
  ["T2 read-only", () => <BorrowedMainText value={BODY} instanceKey="t2" />],
  ["T3 editable", () => <RichTextField value={BODY} instanceKey="t3" onChange={() => {}} />],
];

describe("card-body \\ref display — one answer across the presence tiers", () => {
  for (const [answer, expected] of [
    ["5", "5"], // the doc renumbered since capture — every tier shows today's number
    ["??", "2"], // MAIN can't place the label — every tier keeps the stored number
    [null, "2"], // no main editor yet — likewise
  ] as const) {
    it(`resolver answers ${JSON.stringify(answer)} → every tier shows "${expected}"`, async () => {
      const shown: Record<string, string> = {};
      for (const [name, ui] of TIERS) shown[name] = await refText(ui(), answer);
      expect(shown).toEqual(Object.fromEntries(TIERS.map(([n]) => [n, expected])));
    });
  }
});
