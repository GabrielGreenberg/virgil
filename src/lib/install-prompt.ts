/**
 * The ONE owner of the browser's install offer (`beforeinstallprompt`) — task 889.
 *
 * Chrome fires `beforeinstallprompt` once per page load, shortly after load.
 * The "Install Virgil" button lives only in the empty state, so it cannot own
 * the event: a session that opens a paper at load and closes it later would
 * never hear it. This store is armed at app bootstrap (by
 * `ServiceWorkerRegistration`, which the root layout always mounts), holds the
 * deferred event, and lets any later mount read it.
 *
 * The event is SINGLE-USE: a second `prompt()` on it rejects. So
 * `promptInstall()` drops it from the store BEFORE prompting, whatever the
 * outcome — the button disappears rather than surviving as a dead control. The
 * browser may re-offer later (a new `beforeinstallprompt`), which re-arms it.
 * `appinstalled` (install from the button OR the address bar) also drops it.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let captureInstalled = false;
const listeners = new Set<() => void>();

function set(next: BeforeInstallPromptEvent | null) {
  if (next === deferred) return;
  deferred = next;
  for (const l of listeners) l();
}

function onBeforeInstallPrompt(e: Event) {
  // Suppress the browser's mini-infobar; Virgil offers its own button.
  e.preventDefault();
  set(e as BeforeInstallPromptEvent);
}

function onAppInstalled() {
  set(null);
}

/** Start listening for the install offer. Idempotent; call as early as
 *  possible (module eval of an always-mounted component). */
export function armInstallPromptCapture(): void {
  if (captureInstalled || typeof window === "undefined") return;
  captureInstalled = true;
  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", onAppInstalled);
}

export function getInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferred;
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Show the native install dialog. Spends the held event first (it is
 *  single-use), so no outcome leaves a button that cannot prompt again.
 *  Resolves to the user's choice, or null if there was nothing to prompt with
 *  or the browser refused. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | null> {
  const evt = deferred;
  if (!evt) return null;
  set(null);
  try {
    await evt.prompt();
    const choice = await evt.userChoice;
    return choice.outcome;
  } catch {
    return null;
  }
}

/** Test-only: detach and forget everything. */
export function __resetInstallPromptForTests(): void {
  if (captureInstalled && typeof window !== "undefined") {
    window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.removeEventListener("appinstalled", onAppInstalled);
  }
  captureInstalled = false;
  deferred = null;
  listeners.clear();
}
