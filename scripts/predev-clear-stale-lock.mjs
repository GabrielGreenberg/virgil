#!/usr/bin/env node
// predev preflight — clear a STALE Next dev lock before `next dev` starts.
//
// Next 16 keys its dev lock on the DIST DIR (`${NEXT_DIST_DIR}/dev/lock`), not the
// port. When a dev server dies uncleanly (laptop sleep, kill -9, Turbopack panic)
// the lock file is left behind holding a now-dead pid. The next start reads that
// phantom lock and refuses to boot ("Another next dev server is already running"),
// which reads to the user as "the dev server crashes / won't come back". We have
// direct evidence this lingers on this machine (a 40-day-old lock for a dead pid
// was found under a stale dist dir).
//
// This runs from `predev`, so it fires on every `npm run dev` — including the
// preview servers in .claude/launch.json, which inherit NEXT_DIST_DIR from their
// launch command. It clears the lock ONLY when the recorded pid is dead; a server
// that is genuinely running keeps its lock, so Next still correctly refuses a real
// duplicate start.
//
// Invariant: this preflight must NEVER block the dev server from starting. Any
// error is swallowed and we exit 0.

import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const distDir = process.env.NEXT_DIST_DIR || ".next";
const lockPath = resolve(process.cwd(), distDir, "dev", "lock");

/** Liveness probe: signal 0 doesn't actually signal, it just checks the pid. */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true; // exists and we can signal it
  } catch (err) {
    if (err && err.code === "EPERM") return true; // exists, owned by another user
    return false; // ESRCH (no such process) — and anything else — counts as gone
  }
}

try {
  if (existsSync(lockPath)) {
    let lock;
    try {
      lock = JSON.parse(readFileSync(lockPath, "utf8"));
    } catch {
      rmSync(lockPath, { force: true });
      console.log(`[predev] cleared unreadable dev lock at ${distDir}/dev/lock`);
      process.exit(0);
    }

    const pid = Number(lock?.pid);
    if (!Number.isInteger(pid) || pid <= 0) {
      rmSync(lockPath, { force: true });
      console.log(`[predev] cleared dev lock with no valid pid at ${distDir}/dev/lock`);
    } else if (pidAlive(pid)) {
      console.log(
        `[predev] dev lock for ${distDir} held by live pid ${pid} — leaving it ` +
          `(Next will report if this is a real duplicate)`,
      );
    } else {
      rmSync(lockPath, { force: true });
      console.log(`[predev] cleared stale dev lock for ${distDir} (dead pid ${pid})`);
    }
  }
} catch (err) {
  // A preflight hiccup must not stop the dev server from coming up.
  console.log(`[predev] stale-lock preflight skipped: ${err?.message ?? err}`);
}

process.exit(0);
