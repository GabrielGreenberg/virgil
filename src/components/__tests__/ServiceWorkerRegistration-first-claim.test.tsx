// @vitest-environment jsdom
/**
 * Task 1633 — the first install's `clients.claim()` is a TAKEOVER, not an
 * update. A page that mounted with no controller (the page that installed the
 * worker) gets its first controllerchange from that claim: it must not reload,
 * and it must now report its build to the worker it can finally reach. Every
 * later controllerchange is a real update and still goes through the reload
 * door exactly as before (tasks 391/610).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

const reloadNow = vi.fn<(reload: () => void) => Promise<void>>(async () => {});
const reloadIfClean = vi.fn<(reload: () => void) => Promise<boolean>>(async () => true);
vi.mock("@/lib/reload-door", () => ({
  installReloadReadinessResponder: () => () => {},
  reloadNow: (r: () => void) => reloadNow(r),
  reloadIfClean: (r: () => void) => reloadIfClean(r),
}));
const consumeSelfInitiatedUpdate = vi.fn(() => false);
vi.mock("@/hooks/useUpdateAvailable", () => ({
  consumeSelfInitiatedUpdate: () => consumeSelfInitiatedUpdate(),
  setActivatedElsewhere: vi.fn(),
  setUpdateAvailable: vi.fn(),
}));
vi.mock("@/lib/install-prompt", () => ({ armInstallPromptCapture: () => {} }));

import ServiceWorkerRegistration from "../ServiceWorkerRegistration";

type Worker = { postMessage: ReturnType<typeof vi.fn> };

function installFakeContainer(initialController: Worker | null) {
  const target = new EventTarget();
  const container = {
    controller: initialController as Worker | null,
    register: vi.fn(async () => ({
      active: null,
      waiting: null,
      installing: null,
      addEventListener: () => {},
      update: async () => {},
    })),
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  };
  Object.defineProperty(navigator, "serviceWorker", { value: container, configurable: true });
  const changeController = async (next: Worker) => {
    container.controller = next;
    await act(async () => {
      target.dispatchEvent(new Event("controllerchange"));
    });
  };
  return { container, changeController };
}

function bootScript() {
  const s = document.createElement("script");
  s.src = "https://example.test/virgil/_next/static/chunks/app-abc.js";
  document.head.appendChild(s);
}

describe("task 1633 — the first install's claim does not reload", () => {
  beforeEach(() => {
    reloadNow.mockClear();
    reloadIfClean.mockClear();
    consumeSelfInitiatedUpdate.mockReset().mockReturnValue(false);
    document.head.innerHTML = "";
    bootScript();
  });
  afterEach(() => cleanup());

  it("a page mounted without a controller takes the first controllerchange without reloading, and reports its build", async () => {
    const { changeController } = installFakeContainer(null);
    await act(async () => {
      render(<ServiceWorkerRegistration />);
    });
    const worker: Worker = { postMessage: vi.fn() };
    await changeController(worker);
    expect(reloadNow).not.toHaveBeenCalled();
    expect(reloadIfClean).not.toHaveBeenCalled();
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "VIRGIL_CLIENT_BUILD",
      scripts: ["https://example.test/virgil/_next/static/chunks/app-abc.js"],
    });

    // The NEXT controllerchange is a real update: it goes through the door.
    await changeController({ postMessage: vi.fn() });
    expect(reloadIfClean).toHaveBeenCalledTimes(1);
  });

  it("a page mounted WITH a controller treats its first controllerchange as an update, as before", async () => {
    const { changeController } = installFakeContainer({ postMessage: vi.fn() });
    await act(async () => {
      render(<ServiceWorkerRegistration />);
    });
    consumeSelfInitiatedUpdate.mockReturnValue(true);
    await changeController({ postMessage: vi.fn() });
    expect(reloadNow).toHaveBeenCalledTimes(1);
    expect(reloadIfClean).not.toHaveBeenCalled();
  });
});
