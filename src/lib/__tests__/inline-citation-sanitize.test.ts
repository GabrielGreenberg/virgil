// Pins the backlog #28 security fix for the Citations panel preview sink:
// `sanitizeInlineCitationHtml` is the allowlist that protects the one
// `dangerouslySetInnerHTML` consumer of `formatInlineCitation` output. A
// `.bib` field carrying markup/script must NOT survive as live HTML; only the
// formatter's known-safe <i>/<b> pairs are preserved.

import { describe, it, expect } from "vitest";
import { sanitizeInlineCitationHtml } from "../bib-parser";

describe("sanitizeInlineCitationHtml", () => {
  it("strips a <script> tag injected via a bib field", () => {
    const out = sanitizeInlineCitationHtml(
      'Smith (2020) <script>alert(1)</script>',
    );
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("</script>");
    // The text content is escaped, not executed.
    expect(out).toContain("&lt;script&gt;");
  });

  it("neutralizes an <img onerror> payload", () => {
    const out = sanitizeInlineCitationHtml(
      'A title <img src=x onerror=alert(1)>',
    );
    expect(out).not.toMatch(/<img/i);
    expect(out).toContain("&lt;img");
  });

  it("preserves the formatter's known-safe <i> emphasis", () => {
    const out = sanitizeInlineCitationHtml("<i>On the History</i>");
    expect(out).toBe("<i>On the History</i>");
  });

  it("preserves <b> too", () => {
    expect(sanitizeInlineCitationHtml("<b>x</b>")).toBe("<b>x</b>");
  });

  it("escapes a title that itself contains angle brackets, keeping outer <i>", () => {
    // A `\citetitle` wraps raw title text in <i>; a title like
    // "A <thing>" must not yield a live <thing> tag.
    const out = sanitizeInlineCitationHtml("<i>A <thing></i>");
    expect(out).toContain("<i>");
    expect(out).toContain("</i>");
    expect(out).not.toContain("<thing>");
    expect(out).toContain("&lt;thing&gt;");
  });

  it("escapes a closing-i breakout attempt's stray markup", () => {
    // </i><img …> — the </i> is a known-safe pair (allowed), but the
    // injected <img> must be escaped.
    const out = sanitizeInlineCitationHtml(
      "<i>t</i><img src=x onerror=alert(1)>",
    );
    expect(out).not.toMatch(/<img/i);
    expect(out).toContain("&lt;img");
  });

  it("escapes bare ampersands", () => {
    expect(sanitizeInlineCitationHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });

  it("does not turn an uppercase <I> field tag into live markup", () => {
    // Only lowercase i/b are restored; an uppercase variant stays escaped.
    const out = sanitizeInlineCitationHtml("<I>x</I>");
    expect(out).toBe("&lt;I&gt;x&lt;/I&gt;");
  });
});
