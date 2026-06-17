// @vitest-environment jsdom
//
// Pins for the editor-side skill-sync surface (the "make skill sync LOUD +
// recoverable" chip). SkillSyncControls is the top-bar host for the three
// fixes:
//   Fix 1 — a loud, dismissible FAILURE banner with Retry; permission
//           wording (+ "Grant & retry") when the failure is a revoked grant.
//   Fix 2 — a persistent manual "Re-sync skills" button (the one-click
//           version of a hand-sync), shown whenever a paper is open.
//   Fix 3 — a reworded SUCCESS notice that leads with the action: restart
//           the cowork session to pick up the new commands.
//
// Pure presentational — only a type import from useFiles (erased), so no
// storage/editor mocks are needed.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import SkillSyncControls from "../SkillSyncControls";

afterEach(cleanup);

function noop() {}

describe("SkillSyncControls", () => {
  it("Fix 2: shows a Re-sync button only when a paper is open", () => {
    const onResync = vi.fn();
    const { rerender } = render(
      <SkillSyncControls
        hasDoc={false}
        error={null}
        notice={null}
        onResync={onResync}
        onDismissError={noop}
        onDismissNotice={noop}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /re-sync skills/i }),
    ).toBeNull();

    rerender(
      <SkillSyncControls
        hasDoc
        error={null}
        notice={null}
        onResync={onResync}
        onDismissError={noop}
        onDismissNotice={noop}
      />,
    );
    const btn = screen.getByRole("button", { name: /re-sync skills/i });
    fireEvent.click(btn);
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("Fix 1: a non-permission failure renders a loud alert with Retry", () => {
    const onResync = vi.fn();
    const onDismissError = vi.fn();
    render(
      <SkillSyncControls
        hasDoc
        error={{ permission: false, message: "network blew up" }}
        notice={null}
        onResync={onResync}
        onDismissError={onDismissError}
        onDismissNotice={noop}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/skill sync failed/i);

    fireEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    expect(onResync).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: /dismiss skill-sync error/i }),
    );
    expect(onDismissError).toHaveBeenCalledTimes(1);
  });

  it("Fix 1: a NotAllowedError failure is worded as permission + 'Grant & retry'", () => {
    const onResync = vi.fn();
    render(
      <SkillSyncControls
        hasDoc
        error={{ permission: true, message: "lost permission" }}
        notice={null}
        onResync={onResync}
        onDismissError={noop}
        onDismissNotice={noop}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/needs permission/i);
    fireEvent.click(screen.getByRole("button", { name: /grant & retry/i }));
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("Fix 3: the success notice leads with the restart-cowork action", () => {
    const onDismissNotice = vi.fn();
    render(
      <SkillSyncControls
        hasDoc
        error={null}
        notice={{ version: "0.1.49", filesWritten: 12 }}
        onResync={noop}
        onDismissError={noop}
        onDismissNotice={onDismissNotice}
      />,
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/skills updated to v0\.1\.49/i);
    expect(status.textContent).toMatch(
      /restart your claude code cowork session/i,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /dismiss skills-updated notice/i }),
    );
    expect(onDismissNotice).toHaveBeenCalledTimes(1);
  });

  it("renders nothing intrusive when idle with no doc", () => {
    const { container } = render(
      <SkillSyncControls
        hasDoc={false}
        error={null}
        notice={null}
        onResync={noop}
        onDismissError={noop}
        onDismissNotice={noop}
      />,
    );
    expect(container.querySelector("button")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
