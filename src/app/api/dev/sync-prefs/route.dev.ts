/**
 * Dev-only endpoint that mirrors the OWNER's localStorage prefs to disk.
 *
 * Sister to the personal-prefs promotion pipeline. The client (see
 * `src/lib/dev-prefs-mirror.ts`, mounted from EditorLayout) POSTs the
 * registry's prefs blobs (`src/lib/dev-prefs-registry.json`) — but only from a
 * browser profile opted in via `virgil:prefs-mirror-source`, and stamped with
 * that profile's source id. The ownership + per-blob merge rule lives in
 * `src/lib/dev-prefs-snapshot.ts` (task 1487): the first source claims the
 * file, any other source is refused (409), and a blob absent from a POST is
 * kept. `tools/sync-defaults.sh` (whose header states the schedule) then runs
 * `tools/promote-defaults.mjs` to fold the snapshot into the shipped
 * `*.defaults.json`.
 *
 * Active only when `NEXT_PUBLIC_DEV_STORAGE=true` (the `.dev.ts`
 * extension is only picked up by next.config.ts under that flag).
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { applySnapshotPost } from "@/lib/dev-prefs-snapshot";

const SNAPSHOT_PATH = path.join(process.cwd(), "tools", "personal-snapshot.json");

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  let existing: unknown = null;
  if (fs.existsSync(SNAPSHOT_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf-8"));
    } catch {
      // Never overwrite a file we cannot read — it may be the owner's.
      return NextResponse.json(
        { error: "tools/personal-snapshot.json is unreadable; fix or delete it" },
        { status: 409 },
      );
    }
  }
  const result = applySnapshotPost(existing, body, new Date().toISOString());
  if (result.kind === "refused") {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(result.next, null, 2) + "\n", "utf-8");
  return new NextResponse(null, { status: 204 });
}
