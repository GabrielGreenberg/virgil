import type { EditorView } from "@tiptap/pm/view";
import { markPendingCitationCreate } from "./citation";

export interface VirgilCommand {
  /** The command name without backslash (e.g. "section") */
  name: string;
  /** Action to run. The typed text has already been deleted from the doc. */
  action: (view: EditorView, cmdText: string) => void;
}

export const VIRGIL_COMMANDS: VirgilCommand[] = [
  {
    name: "chapter",
    action: (view) => {
      const { state } = view;
      const heading = state.schema.nodes.heading;
      if (heading) {
        const tr = state.tr.setBlockType(state.selection.from, state.selection.to, heading, { level: 1, numbered: true });
        view.dispatch(tr);
      }
    },
  },
  {
    name: "section",
    action: (view) => {
      const { state } = view;
      const heading = state.schema.nodes.heading;
      if (heading) {
        const tr = state.tr.setBlockType(state.selection.from, state.selection.to, heading, { level: 2, numbered: true });
        view.dispatch(tr);
      }
    },
  },
  {
    name: "subsection",
    action: (view) => {
      const { state } = view;
      const heading = state.schema.nodes.heading;
      if (heading) {
        const tr = state.tr.setBlockType(state.selection.from, state.selection.to, heading, { level: 3, numbered: true });
        view.dispatch(tr);
      }
    },
  },
  {
    name: "subsubsection",
    action: (view) => {
      const { state } = view;
      const heading = state.schema.nodes.heading;
      if (heading) {
        const tr = state.tr.setBlockType(state.selection.from, state.selection.to, heading, { level: 4, numbered: true });
        view.dispatch(tr);
      }
    },
  },
  {
    name: "ref",
    action: () => {
      window.dispatchEvent(new CustomEvent("virgil-ref-create"));
    },
  },
  {
    name: "ex",
    action: () => {
      window.dispatchEvent(new CustomEvent("virgil-ex-create"));
    },
  },
  {
    name: "cite",
    action: () => {
      markPendingCitationCreate("\\cite");
      window.dispatchEvent(
        new CustomEvent("virgil-citation-create", { detail: { partial: "\\cite" } }),
      );
    },
  },
  {
    name: "footnote",
    action: () => {
      window.dispatchEvent(new CustomEvent("virgil-footnote-input"));
    },
  },
];

/** Fast lookup by command name (without backslash). */
export const COMMAND_MAP = new Map(VIRGIL_COMMANDS.map((c) => [c.name, c]));

/** Names of all native Virgil commands (without the leading backslash). */
export const VIRGIL_COMMAND_NAMES: readonly string[] = VIRGIL_COMMANDS.map((c) => c.name);
