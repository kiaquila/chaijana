#!/usr/bin/env node

// Project-owned repository safety check. It has no dependencies and reads only
// what git already tracks, so it runs identically on a clone and on a bare CI
// runner. It answers one question: does the proposed tree carry something that
// must never be committed, or a workflow that hands its token to untrusted code?

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
  if (!existsSync(path)) continue;
  const stat = lstatSync(path);
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
  if (/\bpull_request_target\b/.test(text)) {
    failures.push(`High-risk pull_request_target trigger in ${workflow}`);
  }
  if (!/^permissions:\s*(?:\n|$)/m.test(text)) {
    failures.push(`Workflow must declare top-level permissions: ${workflow}`);
  }
  if (/^permissions:\s*["']?write-all["']?\s*$/m.test(text)) {
    failures.push(`Workflow may not use write-all: ${workflow}`);
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
