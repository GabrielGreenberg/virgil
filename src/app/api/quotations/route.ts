import { NextResponse } from "next/server";
import { readJsonFile, writeJsonFile, getMetaPath } from "@/lib/storage";
import type { QuotationsState } from "@/lib/types";
import { migrateQuotationsState } from "@/lib/migrate-quotations";

const DEFAULT_STATE: QuotationsState = { groups: [] };

function getDocId(request: Request): string | null {
  const url = new URL(request.url);
  return url.searchParams.get("docId");
}

export async function GET(request: Request) {
  try {
    const docId = getDocId(request);
    if (!docId) {
      return NextResponse.json({ error: "docId required" }, { status: 400 });
    }
    const filepath = await getMetaPath(docId, "quotations.json");
    const raw = await readJsonFile<QuotationsState>(filepath, DEFAULT_STATE);
    const state = migrateQuotationsState(raw);
    return NextResponse.json(state);
  } catch (error) {
    console.error("Error loading quotations:", error);
    return NextResponse.json({ error: "Failed to load quotations" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const docId = getDocId(request);
    if (!docId) {
      return NextResponse.json({ error: "docId required" }, { status: 400 });
    }
    const state: QuotationsState = await request.json();
    const filepath = await getMetaPath(docId, "quotations.json");
    await writeJsonFile(filepath, state);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error saving quotations:", error);
    return NextResponse.json({ error: "Failed to save quotations" }, { status: 500 });
  }
}
