/**
 * Dev-only API route that serves files from `virgil-data/` on disk.
 *
 * Only active when `NEXT_PUBLIC_DEV_STORAGE=true`. In production builds
 * (`output: "export"`), this file is dead code and never ships.
 *
 * Paths:
 *   GET  /api/dev/index.json          → virgil-data/index.json
 *   GET  /api/dev/doc/:id/:file       → virgil-data/<folder>/<file>
 *   GET  /api/dev/doc/:id/virgil/:f   → virgil-data/<folder>/virgil/<f>
 *   PUT  /api/dev/doc/:id/:file       → writes to same
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "virgil-data");

interface DevDocEntry {
  id: string;
  sourcePath: string;
}

/** Map a doc id to its folder on disk by reading the index. */
function resolveDocFolder(docId: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, "index.json"), "utf-8");
    const index = JSON.parse(raw) as { docs: DevDocEntry[] };
    const doc = index.docs.find((d) => d.id === docId);
    if (!doc) return null;

    // Extract folder from sourcePath:
    //   .../virgil-data/doc_10ee80e8/document.tex → doc_10ee80e8
    //   .../virgil-data/c1834474/main.tex         → c1834474
    const dataIdx = doc.sourcePath.indexOf("virgil-data/");
    if (dataIdx === -1) return null;
    const rel = doc.sourcePath.slice(dataIdx + "virgil-data/".length);
    const folder = rel.split("/")[0];
    return folder;
  } catch {
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const segments = (await params).path;

  // /api/dev/index.json
  if (segments.length === 1 && segments[0] === "index.json") {
    try {
      const content = fs.readFileSync(path.join(DATA_DIR, "index.json"), "utf-8");
      return NextResponse.json(JSON.parse(content));
    } catch {
      return NextResponse.json({ docs: [] });
    }
  }

  // /api/dev/doc/:id/... → resolve to virgil-data/<folder>/...
  if (segments[0] === "doc" && segments.length >= 3) {
    const docId = segments[1];
    const folder = resolveDocFolder(docId);
    if (!folder) {
      return NextResponse.json({ error: "doc not found" }, { status: 404 });
    }
    const filePath = path.join(DATA_DIR, folder, ...segments.slice(2));

    // Prevent path traversal
    if (!filePath.startsWith(DATA_DIR)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      // Try to parse as JSON; if it works, return as JSON; otherwise text
      if (filePath.endsWith(".json")) {
        return NextResponse.json(JSON.parse(content));
      }
      return new NextResponse(content, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    } catch {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  }

  return NextResponse.json({ error: "bad path" }, { status: 400 });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const segments = (await params).path;

  // /api/dev/index.json
  if (segments.length === 1 && segments[0] === "index.json") {
    const body = await req.text();
    fs.writeFileSync(path.join(DATA_DIR, "index.json"), body, "utf-8");
    return NextResponse.json({ ok: true });
  }

  // /api/dev/doc/:id/...
  if (segments[0] === "doc" && segments.length >= 3) {
    const docId = segments[1];
    const folder = resolveDocFolder(docId);
    if (!folder) {
      return NextResponse.json({ error: "doc not found" }, { status: 404 });
    }
    const filePath = path.join(DATA_DIR, folder, ...segments.slice(2));

    if (!filePath.startsWith(DATA_DIR)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // Ensure parent dirs exist
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const body = await req.text();
    fs.writeFileSync(filePath, body, "utf-8");
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "bad path" }, { status: 400 });
}
