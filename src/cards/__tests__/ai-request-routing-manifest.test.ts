/**
 * The registry → drain manifest pin.
 *
 * `editor/scripts/ai_request_routing.json` is the SSOT the Python drain
 * (`list_requests.py`) reads for the card-flag → `ai-requests.json` wire routing
 * (which kind token + panel each flag-bearing card kind maps to). It is a
 * PROJECTION of `CARD_REGISTRY[kind].aiRequest` — the same routing the TS bridge
 * writes. This test forbids the two from drifting: if a registry edit changes
 * the routing (or adds/removes a flag-bearing kind), the manifest must be
 * regenerated to match, or this fails.
 *
 * Together with `ai-request-routing-contract.test.ts` (registry → bridge write)
 * and the Python `test_unbridged_flag_fallback.py` (manifest → drain rows), this
 * closes the create → inbox → drain contract loop end to end.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { CARD_KINDS } from "@/cards/predicates";

const here = dirname(fileURLToPath(import.meta.url));
// src/cards/__tests__ → repo root → editor/scripts/ai_request_routing.json
const manifestPath = join(here, "../../..", "editor/scripts/ai_request_routing.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  routing: Record<string, { kind: string; linkPanel: string }>;
};

describe("ai_request_routing.json manifest ↔ CARD_REGISTRY", () => {
  it("covers exactly the flag-bearing kinds the registry declares", () => {
    const registryKinds = CARD_KINDS.filter(
      (k) => CARD_REGISTRY[k].aiRequest != null,
    ).sort();
    expect(Object.keys(manifest.routing).sort()).toEqual(registryKinds);
  });

  it("each manifest row is byte-identical to the registry's aiRequest routing", () => {
    for (const [kind, route] of Object.entries(manifest.routing)) {
      expect(route).toEqual(CARD_REGISTRY[kind as keyof typeof CARD_REGISTRY].aiRequest);
    }
  });

  it("no non-flag-bearing kind leaks into the manifest", () => {
    for (const kind of Object.keys(manifest.routing)) {
      expect(CARD_REGISTRY[kind as keyof typeof CARD_REGISTRY].aiRequest).toBeTruthy();
    }
  });
});
