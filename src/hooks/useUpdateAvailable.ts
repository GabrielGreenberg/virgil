"use client";

import { useSyncExternalStore } from "react";

/**
 * Service-worker "update available" signal.
 *
 * Module-scoped store using the `useSyncExternalStore` pattern (same as
 * `useHelperMode`). Producer: `ServiceWorkerRegistration` calls
 * `setUpdateAvailable(reg)` when it detects a waiting SW. Consumer: the
 * Virgil bar's update banner reads `useUpdateAvailable()` and calls
 * `applyUpdate()` when the user clicks.
 *
 * `controllerchange` is wired centrally in `ServiceWorkerRegistration`
 * so the reload happens once, regardless of how many consumers there are.
 */

type Listener = () => void;

let waitingRegistration: ServiceWorkerRegistration | null = null;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

export function setUpdateAvailable(reg: ServiceWorkerRegistration | null): void {
  if (waitingRegistration === reg) return;
  waitingRegistration = reg;
  notify();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  return waitingRegistration !== null;
}

function getServerSnapshot(): boolean {
  return false;
}

/** Returns true when a new service worker is in "waiting" state. */
export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Trigger the update: tell the waiting SW to take over. The page
 *  reloads automatically once the controller changes (wired in
 *  ServiceWorkerRegistration). No-op if nothing is waiting. */
export function applyUpdate(): void {
  const waiting = waitingRegistration?.waiting;
  if (!waiting) return;
  waiting.postMessage({ type: "SKIP_WAITING" });
}
