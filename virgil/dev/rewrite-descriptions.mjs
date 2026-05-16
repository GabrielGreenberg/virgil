#!/usr/bin/env node
// Propose naturalistic `description:` rewrites for every skill in
// editor/skills/*.md and library/skills/*.md. Emits a unified diff to
// stdout for hand review; never writes directly to the skill files.
//
// Per the plan in /Users/gabriel/.claude/plans/okay-this-is-a-quizzical-rocket.md
// (Pass 1 — mechanical first draft), this script is meant to be run
// once after a description-style change is needed, the diff hand-reviewed,
// and selected hunks applied with `git apply --include`.
//
// Requires @anthropic-ai/sdk and ANTHROPIC_API_KEY in the env. Not a
// dependency of the main app — install on demand:
//
//   npm install --no-save @anthropic-ai/sdk
//   ANTHROPIC_API_KEY=sk-… node virgil/dev/rewrite-descriptions.mjs > /tmp/descriptions.diff
//   # review, then:
//   git apply --include='editor/skills/*' /tmp/descriptions.diff
//
// Each rewrite leads with the user-facing verb-and-object phrase, lists
// 2-4 naturalistic trigger examples inline, names anti-triggers when
// relevant, and ends with the args. The goal is for Claude's skill-
// matching to fire correctly on phrasings a non-technical user would
// actually use.

import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

const NAMESPACES = [
  { name: "editor", dir: join(repoRoot, "editor", "skills") },
  { name: "library", dir: join(repoRoot, "library", "skills") },
];

const SYSTEM_PROMPT = `You are rewriting the YAML \`description:\` frontmatter
of Virgil skill files so a non-technical user's naturalistic phrasing
will trigger the right skill. Virgil is a browser-based LaTeX editor.
Users address the app as "Virgil" and the catalog as "the Library."

Rules for the rewritten description:

1. Lead with what the user wants done, in their words ("Add a footnote
   to a paragraph", "Look up a citation", "Tidy my bibliography").
2. List 2-4 representative trigger phrases inline, in quotes
   (e.g. "Virgil, add a footnote here", "draft me a footnote").
3. If there's a common phrasing this skill should NOT trigger on,
   call it out ("Does NOT trigger for ...").
4. Name the args at the end.
5. Keep it under 6 lines. Be specific — vague descriptions match too
   widely and cause false triggers.

Output ONLY the new description: value (a single string, possibly
multi-line using YAML's | block scalar). No commentary, no diff
markers, no surrounding YAML.`;

async function callClaude(skill, body) {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();
  const userPrompt = `Skill: ${skill.namespace}:${skill.name}

Current frontmatter description:
---
${skill.currentDescription}
---

First 40 lines of skill body for context:
${body.split("\n").slice(0, 40).join("\n")}

Rewrite the description per the rules.`;
  const resp = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });
  return resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  const fmRaw = m[1];
  const body = m[2];
  const descMatch = fmRaw.match(/^description:\s*([\s\S]*?)(?=\n\w+:|$)/m);
  return {
    raw: text,
    fmRaw,
    body,
    currentDescription: descMatch ? descMatch[1].trim() : "",
  };
}

function applyNewDescription(parsed, newDescription) {
  const isBlock = newDescription.includes("\n");
  const formatted = isBlock
    ? `description: |\n  ${newDescription.split("\n").join("\n  ")}`
    : `description: ${newDescription}`;
  const newFm = parsed.fmRaw.replace(/^description:[\s\S]*?(?=\n\w+:|$)/m, formatted);
  return `---\n${newFm}\n---\n${parsed.body}`;
}

function unifiedDiff(oldText, newText, path) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const out = [`--- a/${path}`, `+++ b/${path}`];
  let i = 0, j = 0;
  while (i < oldLines.length || j < newLines.length) {
    while (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++; j++;
    }
    if (i >= oldLines.length && j >= newLines.length) break;
    const oldStart = i, newStart = j;
    while (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) i++;
    while (j < newLines.length && (i >= oldLines.length || oldLines[i] !== newLines[j])) j++;
    out.push(`@@ -${oldStart + 1},${i - oldStart} +${newStart + 1},${j - newStart} @@`);
    for (let k = oldStart; k < i; k++) out.push(`-${oldLines[k]}`);
    for (let k = newStart; k < j; k++) out.push(`+${newLines[k]}`);
  }
  return out.join("\n") + "\n";
}

async function main() {
  const skills = [];
  for (const ns of NAMESPACES) {
    const entries = await readdir(ns.dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".md") || e.name.startsWith("_")) continue;
      const path = join(ns.dir, e.name);
      const text = await readFile(path, "utf8");
      const parsed = parseFrontmatter(text);
      if (!parsed) continue;
      skills.push({
        namespace: ns.name,
        name: e.name.replace(/\.md$/, ""),
        path,
        relPath: relative(repoRoot, path),
        text,
        parsed,
      });
    }
  }

  process.stderr.write(`Rewriting ${skills.length} skill descriptions…\n`);
  let diffOut = "";
  for (const skill of skills) {
    process.stderr.write(`  ${skill.namespace}:${skill.name}… `);
    try {
      const newDesc = await callClaude(skill, skill.parsed.body);
      const newText = applyNewDescription(skill.parsed, newDesc);
      if (newText !== skill.text) {
        diffOut += unifiedDiff(skill.text, newText, skill.relPath);
      }
      process.stderr.write("ok\n");
    } catch (err) {
      process.stderr.write(`FAILED: ${err.message}\n`);
    }
  }
  process.stdout.write(diffOut);
}

main().catch((err) => {
  console.error("[rewrite-descriptions] failed:", err);
  process.exit(1);
});
