/**
 * Dev-only endpoint that mirrors the user's localStorage prefs to disk.
 *
 * Sister to the personal-prefs promotion pipeline. The client (see
 * `src/lib/dev-prefs-mirror.ts`, mounted from EditorLayout) POSTs the
 * three prefs blobs whenever they change; we write them verbatim to
 * `tools/personal-snapshot.json`. A separate launchd job then runs
 * `tools/promote-defaults.mjs` every 48h to fold the snapshot into the
 * shipped defaults under `*.defaults.json`.
 *
 * Active only when `NEXT_PUBLIC_DEV_STORAGE=true` (the `.dev.ts`
 * extension is only picked up by next.config.ts under that flag).
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const SNAPSHOT_PATH = path.join(process.cwd(), "tools", "personal-snapshot.json");

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "expected object body" }, { status: 400 });
  }
  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(body, null, 2) + "\n", "utf-8");
  return new NextResponse(null, { status: 204 });
}
