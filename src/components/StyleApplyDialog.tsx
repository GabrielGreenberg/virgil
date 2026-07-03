"use client";

/**
 * StyleApplyDialog — confirmation shown when switching to a different
 * style would discard or transform the user's local preamble edits.
 *
 * Skipped when the doc's current preamble byte-matches the registered
 * preamble of the style being switched away from (no-diff fast path —
 * see DocStyleDropdown for the gate).
 *
 * Two outcomes:
 *  - Hard update  → caller invokes useDocumentStyle.setStyle(target).
 *  - AI-managed   → caller files an AiRequest of kind "style-merge"
 *                   via useAiRequests.addStyleMergeRequest. The .tex is
 *                   left untouched until the agent runs the skill.
 */

import SystemDialog, {
  SystemDialogBody,
  SystemDialogButton,
  SystemDialogFooter,
  SystemDialogHeader,
} from "./system-dialog";
import { SHIM_COMMAND_NAMES } from "@/lib/latex-requirements";

// The Virgil `\v*id` marker shims — auto-injected by the serializer, not
// meaningful "user customizations." Derived from the requirements registry
// so a new shim never re-surfaces here as a phantom custom macro.
const SHIM_MACROS = new Set(SHIM_COMMAND_NAMES.map((n) => `\\${n}`));

interface StyleApplyDialogProps {
  /** Display name of the style being switched TO. */
  targetStyleName: string;
  /** Doc's current preamble bytes (everything before \begin{document}). */
  currentPreamble: string;
  /** The target style's registered preamble bytes. */
  targetPreamble: string;
  onHard: () => void;
  onAi: () => void;
  onCancel: () => void;
}

interface DiffSummary {
  extraPackages: string[];
  extraMacros: string[];
  extraSetters: string[];
}

const PACKAGE_RE = /\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g;
const MACRO_RE = /\\(?:newcommand|providecommand|renewcommand|DeclareRobustCommand)\*?\s*\{?\\?([A-Za-z@]+)\}?/g;
const SETTER_RE = /\\(?:setlength|setcounter)\{([^}]+)\}\{[^}]*\}/g;

function uniqueSorted(xs: string[]): string[] {
  return [...new Set(xs)].sort();
}

function extractPackages(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PACKAGE_RE)) {
    for (const name of m[1].split(",").map((s) => s.trim())) {
      if (name) out.push(name);
    }
  }
  return uniqueSorted(out);
}

function extractMacros(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(MACRO_RE)) out.push(`\\${m[1]}`);
  return uniqueSorted(out);
}

function extractSetters(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(SETTER_RE)) out.push(m[1]);
  return uniqueSorted(out);
}

function diffPreambles(current: string, target: string): DiffSummary {
  const curPkgs = new Set(extractPackages(current));
  const tgtPkgs = new Set(extractPackages(target));
  const curMacros = new Set(extractMacros(current));
  const tgtMacros = new Set(extractMacros(target));
  const curSetters = new Set(extractSetters(current));
  const tgtSetters = new Set(extractSetters(target));

  return {
    extraPackages: [...curPkgs].filter((p) => !tgtPkgs.has(p)).sort(),
    extraMacros: [...curMacros]
      .filter((m) => !tgtMacros.has(m))
      .filter((m) => !SHIM_MACROS.has(m))
      .sort(),
    extraSetters: [...curSetters].filter((s) => !tgtSetters.has(s)).sort(),
  };
}

export default function StyleApplyDialog({
  targetStyleName,
  currentPreamble,
  targetPreamble,
  onHard,
  onAi,
  onCancel,
}: StyleApplyDialogProps) {
  const diff = diffPreambles(currentPreamble, targetPreamble);
  const hasExtras =
    diff.extraPackages.length > 0 ||
    diff.extraMacros.length > 0 ||
    diff.extraSetters.length > 0;

  return (
    <SystemDialog open onClose={onCancel} size="lg">
      <SystemDialogHeader
        title={`Switch to "${targetStyleName}"`}
        subtitle="Your current preamble has edits that aren't in the target style."
      />
      <SystemDialogBody>
        {hasExtras ? (
          <div className="text-xs text-ink-body leading-relaxed space-y-2">
            <p>The following exist only in your current preamble:</p>
            {diff.extraPackages.length > 0 && (
              <p>
                <span className="font-medium">
                  {diff.extraPackages.length}
                </span>
                {" "}
                extra package{diff.extraPackages.length === 1 ? "" : "s"}:{" "}
                <code className="font-mono text-[11px] text-ink-subtle">
                  {diff.extraPackages.slice(0, 6).join(", ")}
                  {diff.extraPackages.length > 6
                    ? `, +${diff.extraPackages.length - 6} more`
                    : ""}
                </code>
              </p>
            )}
            {diff.extraMacros.length > 0 && (
              <p>
                <span className="font-medium">{diff.extraMacros.length}</span>{" "}
                custom macro{diff.extraMacros.length === 1 ? "" : "s"}:{" "}
                <code className="font-mono text-[11px] text-ink-subtle">
                  {diff.extraMacros.slice(0, 6).join(", ")}
                  {diff.extraMacros.length > 6
                    ? `, +${diff.extraMacros.length - 6} more`
                    : ""}
                </code>
              </p>
            )}
            {diff.extraSetters.length > 0 && (
              <p>
                <span className="font-medium">
                  {diff.extraSetters.length}
                </span>{" "}
                length / counter setting
                {diff.extraSetters.length === 1 ? "" : "s"}:{" "}
                <code className="font-mono text-[11px] text-ink-subtle">
                  {diff.extraSetters.slice(0, 6).join(", ")}
                </code>
              </p>
            )}
            <p className="pt-1">
              <strong>Hard update</strong> discards everything above and
              replaces your preamble wholesale.{" "}
              <strong>AI-managed update</strong> files a request for an
              agent to merge your customizations onto the new style.
            </p>
          </div>
        ) : (
          <p className="text-xs text-ink-body">
            Your current preamble differs from the registered version of
            this style. Hard update will replace it; AI-managed update
            will request a smart merge.
          </p>
        )}
      </SystemDialogBody>
      <SystemDialogFooter>
        <SystemDialogButton variant="secondary" onClick={onCancel}>
          Cancel
        </SystemDialogButton>
        <SystemDialogButton variant="danger" onClick={onHard}>
          Hard update
        </SystemDialogButton>
        <SystemDialogButton variant="primary" onClick={onAi} autoFocus>
          AI-managed update
        </SystemDialogButton>
      </SystemDialogFooter>
    </SystemDialog>
  );
}
