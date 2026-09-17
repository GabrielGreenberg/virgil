"use client";

import { useSyncExternalStore } from "react";

/**
 * Service-worker "update available" signal.
 *
 * Module-scoped store using the `useSyncExternalStore` pattern (same as
 * `useHelperMode`). Producer: `ServiceWorkerRegistration` calls
 * `setUpdateAvailable(reg)` when it detects a waiting SW, and
 * `setActivatedElsewhere(reload)` when another window's update click
 * activated it while this window still held unsaved work (task 610).
 * Consumer: the Virgil bar's update banner reads `useUpdateState()` and calls
 * `applyUpdate()` when the user clicks.
 *
 * `controllerchange` is wired centrally in `ServiceWorkerRegistration`
 * so the reload happens once, regardless of how many consumers there are.
 */

type Listener = () => void;

/**
 * - `none` — nothing to do.
 * - `waiting` — a new worker is installed and waiting; the click posts
 *   `SKIP_WAITING`, which reloads EVERY window.
 * - `activated-elsewhere` — another window already activated it; this page
 *   stayed open because it holds unsaved work. The click reloads THIS window.
 */
export type UpdateState = "none" | "waiting" | "activated-elsewhere";

let waitingRegistration: ServiceWorkerRegistration | null = null;
let deferredReload: (() => void) | null = null;
let selfInitiated = false;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

export function setUpdateAvailable(reg: ServiceWorkerRegistration | null): void {
  if (waitingRegistration === reg) return;
  waitingRegistration = reg;
  notify();
}

/** Another window's update activated the new worker, and this window deferred
 *  its reload. `reload` is what the banner's click runs. */
export function setActivatedElsewhere(reload: () => void): void {
  deferredReload = reload;
  waitingRegistration = null;
  notify();
}

/** Did THIS window post `SKIP_WAITING`? Read once by the `controllerchange`
 *  handler, which reloads unconditionally only for a reload its own user
 *  chose. */
export function consumeSelfInitiatedUpdate(): boolean {
  const v = selfInitiated;
  selfInitiated = false;
  return v;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): UpdateState {
  if (deferredReload) return "activated-elsewhere";
  return waitingRegistration !== null ? "waiting" : "none";
}

function getServerSnapshot(): UpdateState {
  return "none";
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Returns true when there is an update for the banner to offer. */
export function useUpdateAvailable(): boolean {
  return useUpdateState() !== "none";
}

/** Trigger the update. `waiting`: tell the waiting SW to take over — every
 *  window's `controllerchange` then fires (wired in
 *  ServiceWorkerRegistration). `activated-elsewhere`: reload this window.
 *  No-op otherwise. The banner is the only caller, and it asks the reload door
 *  first. */
export function applyUpdate(): void {
  if (deferredReload) {
    const reload = deferredReload;
    deferredReload = null;
    notify();
    reload();
    return;
  }
  const waiting = waitingRegistration?.waiting;
  if (!waiting) return;
  selfInitiated = true;
  waiting.postMessage({ type: "SKIP_WAITING" });
}

/** Test seam. */
export function __resetUpdateStateForTests(): void {
  waitingRegistration = null;
  deferredReload = null;
  selfInitiated = false;
  notify();
}
