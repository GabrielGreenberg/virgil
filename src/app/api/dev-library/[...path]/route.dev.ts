/**
 * Dev-only API route that serves files from `library-data/` on disk.
 *
 * Mirrors the doc-side route at `src/app/api/dev/[...path]/route.dev.ts`,
 * but for the Library tab. Only active when `NEXT_PUBLIC_DEV_STORAGE=true`.
 * The `.dev.ts` extension keeps it out of the production static export
 * (see `pageExtensions` in `next.config.ts`).
 *
 * Paths (all under /api/dev-library/):
 *   GET  catalog.json                 → library-data/catalog.json
 *   GET  master.bib                   → library-data/master.bib
 *   GET  papers/<key>/main.tex        → library-data/papers/<key>/main.tex
 *   GET  _list/<dir>                  → directory listing (entries[])
 *   PUT  queue/<file>                 → write queue intent
 *   PUT  notifications/inbox.json     → write notifications
 *   DELETE <any path>                 → remove file
 *
 * The library/lib/dev-fsa.ts mock handle wraps these calls.
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "library-data");

function safeJoin(...segments: string[]): string | null {
  const joined = path.join(DATA_DIR, ...segments);
  if (!joined.startsWith(DATA_DIR)) return null;
  return joined;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const segments = (await params).path ?? [];

  // /api/dev-library/_list/<dir>... → directory listing
  if (segments[0] === "_list") {
    const subPath = segments.slice(1);
    const dirPath = safeJoin(...subPath);
    if (!dirPath) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    try {
      const dirents = fs.readdirSync(dirPath, { withFileTypes: true });
      const entries = dirents
        // Skip .gitkeep marker files — they're not part of the library's
        // visible surface.
        .filter((d) => d.name !== ".gitkeep")
        .map((d) => ({
          name: d.name,
          kind: d.isDirectory() ? "directory" : "file",
        }));
      return NextResponse.json({ entries });
    } catch {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  }

  // /api/dev-library/_meta → metadata about the dev library (abs path)
  // Used by the skill-sync engine to populate .virgil/library-path.json
  // in dev-storage mode (FSA handles don't expose abs paths, but in dev
  // the library is always at <repoCwd>/library-data).
  if (segments[0] === "_meta" && segments.length === 1) {
    return NextResponse.json({ libraryRoot: DATA_DIR });
  }

  // /api/dev-library/_exists/<path>... → existence check (200 vs 404)
  if (segments[0] === "_exists") {
    const subPath = segments.slice(1);
    const filePath = safeJoin(...subPath);
    if (!filePath) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    try {
      const s = fs.statSync(filePath);
      return NextResponse.json({ exists: true, kind: s.isDirectory() ? "directory" : "file" });
    } catch {
      return NextResponse.json({ exists: false }, { status: 404 });
    }
  }

  // Plain file read
  const filePath = safeJoin(...segments);
  if (!filePath) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    if (filePath.endsWith(".pdf")) {
      const buf = fs.readFileSync(filePath);
      return new NextResponse(new Uint8Array(buf), {
        headers: { "Content-Type": "application/pdf" },
      });
    }
    const content = fs.readFileSync(filePath, "utf-8");
    if (filePath.endsWith(".json")) {
      // Pass-through (don't reparse — preserves whitespace).
      return new NextResponse(content, {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    return new NextResponse(content, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const segments = (await params).path ?? [];
  const filePath = safeJoin(...segments);
  if (!filePath) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("octet-stream") || contentType.includes("application/pdf")) {
    const buf = Buffer.from(await req.arrayBuffer());
    fs.writeFileSync(filePath, buf);
  } else {
    const body = await req.text();
    fs.writeFileSync(filePath, body, "utf-8");
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const segments = (await params).path ?? [];
  const filePath = safeJoin(...segments);
  if (!filePath) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const s = fs.statSync(filePath);
    if (s.isDirectory()) {
      fs.rmSync(filePath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Already gone — treat as no-op (matches FSA removeEntry semantics).
  }
  return NextResponse.json({ ok: true });
}
