#!/usr/bin/env node

// Project-owned repository safety check. It has no dependencies and reads only
// what git already tracks, so it runs identically on a clone and on a bare CI
// runner. It answers one question: does the proposed tree carry something that
// must never be committed, or a workflow that hands its token to untrusted code?
//
// What it is: a check against mistakes — a build directory committed by
// accident, a key pasted into a file, an action pinned to a tag.
//
// What it is not: a boundary against a hostile author. This file lives in the
// same tree it inspects, so anyone who can obfuscate a workflow past it can
// also edit it in the same pull request. That threat is answered by required
// Code Owner review on `/.github/`, `/scripts/`, and `/tests/`, not here — see
// docs/operations/github-setup.md. Reading it as a security boundary would
// invite endless hardening of a file whose value is that it stays small enough
// to audit at a glance.

import { basename, join, resolve, sep } from "node:path";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const rootIndex = process.argv.indexOf("--root");
const root = rootIndex === -1
  ? resolve(import.meta.dirname, "..")
  : resolve(process.argv[rootIndex + 1]);
const failures = [];

for (const path of [
  ".github/CODEOWNERS",
  ".github/pull_request_template.md",
  ".github/workflows/ci.yml",
  ".gitignore",
  "AGENTS.md",
  "README.md",
  "package.json",
  "scripts/check-repository.mjs"
]) {
  if (!existsSync(join(root, path))) failures.push(`Missing harness file: ${path}`);
}

const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  cwd: root,
  encoding: "utf8"
});
if (listed.status !== 0) throw new Error(listed.stderr.trim() || "git ls-files failed");
const files = listed.stdout.split("\0").filter(Boolean);

// `build/` is deliberately absent: `website/build/` holds the hand-written Vite
// plugin source, not build output. Everything below is generated or installed.
const forbiddenSegments = new Set([
  ".next",
  ".vinext",
  ".wrangler",
  "coverage",
  "dist",
  "node_modules"
]);
const forbiddenNames = [/^\.DS_Store$/, /^\.env(?:\..+)?$/, /\.(?:key|p12|pfx|pem|session)$/i];
const secrets = [
  ["private key", /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{20,}/],
  ["OpenAI-style API key", /sk-[A-Za-z0-9_-]{32,}/],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{20,}/],
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["Telegram bot token", /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/]
];
const personalPaths = [/\/Users\/[A-Za-z0-9._-]+\//, /\/home\/[A-Za-z0-9._-]+\//, /[A-Za-z]:\\Users\\/];

for (const file of files) {
  const normalized = file.split(sep).join("/");
  const name = basename(normalized);
  if (normalized.split("/").some((part) => forbiddenSegments.has(part))) {
    failures.push(`Generated or dependency directory is tracked: ${normalized}`);
  }
  if (forbiddenNames.some((pattern) => pattern.test(name)) && name !== ".env.example") {
    failures.push(`Sensitive or local-only file is tracked: ${normalized}`);
  }
  const path = join(root, file);
  // `lstatSync` runs before any existence test on purpose: `existsSync` follows
  // the link, so a symlink whose target is missing reads as absent and would
  // skip the rejection below. A path that is genuinely gone — listed by git but
  // deleted in the working tree — throws here and is skipped.
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    continue;
  }
  if (stat.isSymbolicLink()) {
    failures.push(`Symbolic links are not allowed: ${normalized}`);
    continue;
  }
  if (!stat.isFile() || stat.size > 2_000_000) continue;
  const buffer = readFileSync(path);
  if (buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0)) continue;
  const text = buffer.toString("utf8");
  for (const [label, pattern] of secrets) {
    if (pattern.test(text)) failures.push(`Possible ${label} in ${normalized}`);
  }
  if (personalPaths.some((pattern) => pattern.test(text))) {
    failures.push(`Personal absolute path in ${normalized}`);
  }
}

// Locating the `uses:` key by pattern is a losing game, and three rounds of
// review proved it: block style, flow mappings, quoted keys, and explicit
// `? key` / `: value` pairs all spell the same step, so a key scanner either
// misses a spelling — silently passing an unpinned action — or reads the word
// "uses:" inside a quoted shell command and fails a valid workflow.
//
// The value has a shape the key does not. An action reference is
// `owner/repo[/path]@ref`, and that shape survives every YAML spelling, while
// prose such as `run: echo "this uses: no action"` never has it. So every
// action-shaped reference anywhere in a workflow must be pinned, whatever
// syntax introduced it.
//
// `uses:` exempts Docker images, so those are removed before the scan rather
// than left to the lookbehind: a registry host is dotted, and a scan that can
// start mid-hostname reads `ghcr.io/owner/image@sha256` out of a valid
// reference. The lookbehind then drops what remains — a scoped npm spec
// (`@scope/pkg@1.2.3`) and any match starting inside a longer path or hostname.
// A false positive here fails loudly and is fixed by pinning the reference or
// rewording the line; that is the direction this check is allowed to err in.
// A double-quoted YAML scalar can spell any character as an escape, so
// `uses: "actions/checkout@v4"` is the pinned-looking text of an unpinned
// step. Decoding escapes would mean parsing YAML; refusing them costs nothing,
// because no workflow here has ever needed one. Block scalars are exempt: a
// backslash inside `run: |` is shell, not a YAML escape.
function quotedEscapes(text) {
  const found = [];
  let blockIndent = null;
  for (const line of text.split("\n")) {
    const indent = line.length - line.trimStart().length;
    if (blockIndent !== null) {
      if (line.trim() === "" || indent > blockIndent) continue;
      blockIndent = null;
    }
    // A block scalar header carries an optional chomp indicator and an optional
    // explicit indent, in either legal order: `|`, `|-`, `|2`, `|2-`, `|-2`.
    const code = stripComment(line);
    if (/:\s*[|>](?:[-+]\d?|\d[-+]?)?\s*$/.test(code)) {
      blockIndent = indent;
      continue;
    }
    // Only a quote in value position opens a YAML double-quoted scalar. In
    // `run: grep -E "a\.b" file` the value is a plain scalar and the quotes
    // belong to the shell, so matching every quoted substring would reject an
    // ordinary inline command. A comment is not a scalar either, which is why
    // this runs on the comment-stripped line.
    for (const [, , scalar] of code.matchAll(/(^|[:\-{,[])[ \t]*"((?:[^"\\\n]|\\.)*)"/g)) {
      if (scalar.includes("\\")) found.push(scalar);
    }
  }
  return found;
}

// YAML comments may contain a quoted string, and prose is not a step. Quote
// tracking is what tells a real comment `#` from a `#` inside a value.
function stripComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "#" && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index);
    }
  }
  return line;
}

const dockerReference = /docker:\/\/\S+/g;
const actionReference = /(?<![@\w/.-])([A-Za-z0-9][\w.-]*(?:\/[\w.-]+)+)@([\w.-]+)/g;

// The shape above cannot see `uses: owner/repo` with no `@` at all, which is
// also unpinned. That form is rare enough to catch with a key scan, kept
// deliberately narrow: it reports only when the value is itself `owner/repo`
// shaped, so prose in a scalar cannot trip it. An unpinned `owner/repo` written
// in explicit-key syntax is the one gap left, and it is recorded rather than
// claimed closed.
const usesKey = /(?<![\w-])(["']?)uses\1[ \t]*:[ \t]*(["']?)([^\s,}\]"'#]+)\2/g;
const unversionedAction = /^[A-Za-z0-9][\w.-]*(?:\/[\w.-]+)+$/;

for (const workflow of files.filter((file) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file))) {
  const text = readFileSync(join(root, workflow), "utf8");
  // These three read declarations, which end where a comment begins. Matching
  // raw text would both miss `permissions: write-all # temporary` and fail a
  // workflow whose comment merely mentions pull_request_target.
  const declarations = text.split("\n").map(stripComment).join("\n");
  if (/\bpull_request_target\b/.test(declarations)) {
    failures.push(`High-risk pull_request_target trigger in ${workflow}`);
  }
  if (!/^permissions:[ \t]*(?:\n|\S)/m.test(declarations)) {
    failures.push(`Workflow must declare top-level permissions: ${workflow}`);
  }
  // Indentation is allowed here on purpose: a job may override the workflow's
  // permissions, so `write-all` has to be refused wherever it is declared, not
  // only at the top level.
  if (/^[ \t]*permissions:[ \t]*["']?write-all["']?[ \t]*$/m.test(declarations)) {
    failures.push(`Workflow may not use write-all: ${workflow}`);
  }

  for (const scalar of quotedEscapes(text)) {
    failures.push(`Escaped quoted scalar in ${workflow}: "${scalar}"`);
  }

  const scannable = text.replace(dockerReference, "");
  for (const [, action, ref] of scannable.matchAll(actionReference)) {
    if (!/^[a-f0-9]{40}$/.test(ref)) {
      failures.push(`Action is not pinned to a full SHA in ${workflow}: ${action}@${ref}`);
    }
  }
  for (const [, , , value] of text.matchAll(usesKey)) {
    if (unversionedAction.test(value)) {
      failures.push(`Action is not pinned to a full SHA in ${workflow}: ${value}`);
    }
  }
}

if (failures.length) {
  console.error([...new Set(failures)].map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`Repository guard passed (${files.length} paths).`);
