import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const guard = resolve(import.meta.dirname, "../scripts/check-repository.mjs");

const workflow = `name: Project CI

on:
  pull_request:

permissions:
  contents: read

jobs:
  project-ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
`;

function write(root, path, contents) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function run(root) {
  return spawnSync(process.execPath, [guard, "--root", root], { cwd: root, encoding: "utf8" });
}

// A fixture is a real git repository, because the guard inspects exactly what
// `git ls-files` reports rather than walking the filesystem.
function withFixture(callback) {
  const root = mkdtempSync(join(tmpdir(), "chaijana-guard-"));
  try {
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
    for (const path of [
      ".github/CODEOWNERS",
      ".github/pull_request_template.md",
      ".gitignore",
      "AGENTS.md",
      "README.md"
    ]) {
      write(root, path, `placeholder for ${path}\n`);
    }
    write(root, "package.json", '{ "name": "fixture", "private": true }\n');
    write(root, "scripts/check-repository.mjs", "// placeholder\n");
    write(root, ".github/workflows/ci.yml", workflow);
    callback(root, (path, contents) => write(root, path, contents));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a clean project tree passes", () => {
  withFixture((root) => {
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Repository guard passed/);
  });
});

test("a missing harness file is reported", () => {
  withFixture((root) => {
    rmSync(join(root, "AGENTS.md"));
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Missing harness file: AGENTS\.md/);
  });
});

test("website/build stays allowed because it holds plugin source, not output", () => {
  withFixture((root, add) => {
    add("website/build/sites-vite-plugin.ts", "export default {};\n");
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("generated and dependency directories are rejected", () => {
  for (const path of [
    "website/.next/build-manifest.json",
    "website/.vinext/output.js",
    "website/.wrangler/state.json",
    "menu/dist/index.html",
    "coverage/lcov.info",
    "website/node_modules/left-pad/index.js"
  ]) {
    withFixture((root, add) => {
      add(path, "generated\n");
      const result = run(root);
      assert.equal(result.status, 1, `${path} should be rejected`);
      assert.match(result.stderr, /Generated or dependency directory is tracked/);
    });
  }
});

test("local-only and credential files are rejected", () => {
  for (const path of [".env", "menu/.env.local", "deploy.pem", "website/service.key"]) {
    withFixture((root, add) => {
      add(path, "local only\n");
      const result = run(root);
      assert.equal(result.status, 1, `${path} should be rejected`);
      assert.match(result.stderr, /Sensitive or local-only file is tracked/);
    });
  }
});

test(".env.example stays allowed", () => {
  withFixture((root, add) => {
    add(".env.example", "EXAMPLE=1\n");
    assert.equal(run(root).status, 0);
  });
});

test("secret-shaped content is rejected", () => {
  withFixture((root, add) => {
    // Assembled at runtime so this fixture is not itself a secret-shaped
    // literal that the guard would flag when it scans its own test file.
    const token = ["gh", "p_", "0123456789abcdefghijklmnopqrstuvwx"].join("");
    add("website/config.ts", `export const token = "${token}";\n`);
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Possible GitHub token/);
  });
});

test("every secret detector is wired up", () => {
  // Each fixture is assembled at runtime for the same reason as above.
  const cases = [
    ["private key", ["-----BEGIN ", "RSA ", "PRIVATE ", "KEY-----"].join("")],
    ["OpenAI-style API key", ["sk", "-", "a".repeat(40)].join("")],
    ["Slack token", ["xox", "b-", "1234567890-abcdefghijklmnopqrst"].join("")],
    ["AWS access key", ["AKIA", "ABCDEFGHIJKLMNOP"].join("")],
    ["Telegram bot token", ["123456789", ":", "A".repeat(35)].join("")]
  ];
  for (const [label, value] of cases) {
    withFixture((root, add) => {
      add("website/config.ts", `export const value = "${value}";\n`);
      const result = run(root);
      assert.equal(result.status, 1, `${label} should be rejected`);
      assert.match(result.stderr, new RegExp(`Possible ${label.replace(/[-]/g, "\\$&")}`));
    });
  }
});

test("a personal absolute path is rejected", () => {
  withFixture((root, add) => {
    const personal = ["", "Users", "someone", "projects", "chaijana"].join("/");
    add("menu/notes.md", `Built from ${personal} today.\n`);
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Personal absolute path/);
  });
});

test("symbolic links are rejected", () => {
  withFixture((root) => {
    symlinkSync("README.md", join(root, "LINK.md"));
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Symbolic links are not allowed/);
  });
});

// Enumerating step spellings is how the first two attempts leaked, so this
// covers the shapes that broke them plus the quoting variants around them.
test("an unpinned action is rejected in every step spelling", () => {
  for (const step of [
    "      - uses: actions/checkout@v4",
    "      - uses: 'actions/checkout@v4'",
    '      - uses: "actions/checkout@v4"',
    "      - { uses: actions/checkout@v4 }",
    "      - {uses: actions/checkout@v4, with: {ref: main}}",
    "      - { with: { ref: main }, uses: actions/checkout@v4 }",
    '      - { "uses": actions/checkout@v4 }',
    "      - { 'uses' : actions/checkout@v4 }",
    '      - { "uses": "actions/checkout@v4" }'
  ]) {
    withFixture((root, add) => {
      add(".github/workflows/ci.yml", workflow.replace(/^      - uses:.*$/m, step));
      const result = run(root);
      assert.equal(result.status, 1, `${step} should be rejected`);
      assert.match(result.stderr, /not pinned to a full SHA/);
    });
  }
});

test("a pinned action passes in the same spellings", () => {
  const pin = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
  for (const step of [
    `      - uses: ${pin}`,
    `      - { uses: ${pin} }`,
    `      - { "uses": "${pin}" }`
  ]) {
    withFixture((root, add) => {
      add(".github/workflows/ci.yml", workflow.replace(/^      - uses:.*$/m, step));
      const result = run(root);
      assert.equal(result.status, 0, `${step}\n${result.stderr}`);
    });
  }
});

test("a uses: value the guard cannot read is rejected rather than skipped", () => {
  for (const [step, pattern] of [
    ["      - uses:", /Unreadable uses: value/],
    ["      - uses: *checkout", /Unsupported uses: value/],
    ["      - { uses: &anchor }", /Unsupported uses: value/]
  ]) {
    withFixture((root, add) => {
      add(".github/workflows/ci.yml", workflow.replace(/^      - uses:.*$/m, step));
      const result = run(root);
      assert.equal(result.status, 1, `${step} should be rejected`);
      assert.match(result.stderr, pattern);
    });
  }
});

test("prose in a comment is not read as a step", () => {
  withFixture((root, add) => {
    add(".github/workflows/ci.yml", workflow.replace(
      /^      - uses:/m,
      "      # This job uses: the pinned checkout below, nothing else.\n      - uses:"
    ));
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("a key merely ending in uses is not treated as a step", () => {
  withFixture((root, add) => {
    add(".github/workflows/ci.yml", `${workflow}        env:\n          reuses: actions/checkout@v4\n`);
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test("a workflow without top-level permissions is rejected", () => {
  withFixture((root, add) => {
    add(".github/workflows/ci.yml", workflow.replace("permissions:\n  contents: read\n\n", ""));
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must declare top-level permissions/);
  });
});

test("write-all and pull_request_target are rejected", () => {
  withFixture((root, add) => {
    add(".github/workflows/ci.yml", workflow
      .replace("permissions:\n  contents: read", "permissions: write-all")
      .replace("  pull_request:", "  pull_request_target:"));
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /may not use write-all/);
    assert.match(result.stderr, /High-risk pull_request_target trigger/);
  });
});
