// @vitest-environment jsdom
// Task 889 — the install offer is owned by a bootstrap-armed store, spent on
// ANY prompt, and dropped on `appinstalled`; the empty-state button only reads it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/storage-mode", () => ({ isDevStorage: false }));
vi.mock("@/hooks/useWindowChrome", () => ({
  useWindowChrome: () => ({ displayMode: "browser" }),
}));

import {
  __resetInstallPromptForTests,
  armInstallPromptCapture,
  getInstallPrompt,
} from "@/lib/install-prompt";
import { InstallPwaPrompt } from "@/components/InstallPwaPrompt";

function offer(outcome: "accepted" | "dismissed" = "dismissed") {
  const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: string }>;
  };
  let used = false;
  e.prompt = vi.fn(async () => {
    if (used) throw new DOMException("already prompted", "InvalidStateError");
    used = true;
  });
  e.userChoice = Promise.resolve({ outcome });
  window.dispatchEvent(e);
  return e;
}

const button = () => screen.queryByRole("button", { name: "Install Virgil" });

beforeEach(() => {
  __resetInstallPromptForTests();
  localStorage.clear();
  armInstallPromptCapture();
});
afterEach(() => {
  cleanup();
  __resetInstallPromptForTests();
});

describe("install prompt lifecycle (task 889)", () => {
  it("an offer fired BEFORE the button mounts is shown on mount", () => {
    const e = offer();
    expect(e.defaultPrevented).toBe(true);
    render(<InstallPwaPrompt />);
    expect(button()).not.toBeNull();
  });

  it("a dismissed native dialog spends the offer — no dead button, one prompt() per event", async () => {
    const e = offer("dismissed");
    render(<InstallPwaPrompt />);
    await act(async () => {
      fireEvent.click(button()!);
    });
    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(getInstallPrompt()).toBeNull();
    expect(button()).toBeNull();
  });

  it("a fresh offer after a spent one re-arms the button", async () => {
    offer("dismissed");
    render(<InstallPwaPrompt />);
    await act(async () => {
      fireEvent.click(button()!);
    });
    expect(button()).toBeNull();
    act(() => {
      offer();
    });
    expect(button()).not.toBeNull();
  });

  it("appinstalled (e.g. from the address bar) clears the button", () => {
    offer();
    render(<InstallPwaPrompt />);
    expect(button()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(button()).toBeNull();
  });

  it("× dismissal persists across mounts", () => {
    offer();
    const { unmount } = render(<InstallPwaPrompt />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss install prompt" }));
    expect(button()).toBeNull();
    unmount();
    render(<InstallPwaPrompt />);
    expect(button()).toBeNull();
  });

  it("arming is idempotent — one offer, one listener", () => {
    armInstallPromptCapture();
    armInstallPromptCapture();
    const e = offer();
    expect(getInstallPrompt()).toBe(e);
  });
});
