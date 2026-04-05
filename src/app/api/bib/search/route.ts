import { NextResponse } from "next/server";
import fs from "fs/promises";
import { parseBibFile } from "@/lib/bib-parser";
import type { BibEntry } from "@/lib/types";

// Module-level cache to avoid re-parsing large .bib files on every request
const cache = new Map<string, { entries: BibEntry[]; mtime: number }>();

async function getCachedEntries(bibPath: string): Promise<BibEntry[]> {
  const stat = await fs.stat(bibPath);
  const mtime = stat.mtimeMs;
  const cached = cache.get(bibPath);
  if (cached && cached.mtime === mtime) return cached.entries;

  const text = await fs.readFile(bibPath, "utf-8");
  const entries = parseBibFile(text);
  cache.set(bibPath, { entries, mtime });
  return entries;
}

/**
 * POST /api/bib/search
 * Search a general bibliography file by key, author, title, or year.
 * Body: { generalBibPath: string, query: string, limit?: number }
 */
export async function POST(request: Request) {
  try {
    const { generalBibPath, query, limit = 20 } = await request.json();
    if (!generalBibPath) {
      return NextResponse.json({ error: "generalBibPath required" }, { status: 400 });
    }

    // Validate path exists
    try {
      await fs.access(generalBibPath);
    } catch {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const entries = await getCachedEntries(generalBibPath);

    if (!query || !query.trim()) {
      return NextResponse.json({ results: entries.slice(0, limit) });
    }

    const q = query.toLowerCase().trim();
    const results: BibEntry[] = [];
    for (const entry of entries) {
      if (results.length >= limit) break;
      const searchable = [
        entry.key,
        entry.fields.author || "",
        entry.fields.title || "",
        entry.fields.year || "",
      ].join(" ").toLowerCase();
      if (searchable.includes(q)) {
        results.push(entry);
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Error searching bib:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
