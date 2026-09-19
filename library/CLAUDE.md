# Library subsystem

The agent guide for `library/` (the Virgil Library: catalog, multi-tab libraries, skill cowork,
Python pipeline) is [AGENTS.md](AGENTS.md) in this folder. It is NOT auto-loaded — read it on
demand when working on Library code.

This file is deliberately a short pointer (not an `@AGENTS.md` import, and not a copy): Claude Code
nested-loads a `CLAUDE.md` whenever a session reads any file under its folder, so a copy of the
full guide here costs every such session ~25k tokens. Budget pinned by
`src/__tests__/agents-md-budget.test.ts`.
