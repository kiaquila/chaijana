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

// A link to a missing target is the case an existence check skips: `existsSync`
// follows the link and reports the path as absent, so the rejection above never
// runs unless the guard stats the link itself first.
test("a symbolic link to a missing target is rejected", () => {
  withFixture((root) => {
    symlinkSync("no-such-target.md", join(root, "BROKEN.md"));
    const result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Symbolic links are not allowed: BROKEN\.md/);
  });
});

// Every spelling below is the same step. The guard matches the action
// reference rather than the key, so the YAML syntax that introduced it does
// not matter — which is the property these cases exist to hold.
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
    '      - { "uses": "actions/checkout@v4" }',
    "      - ? uses\n        : actions/checkout@v4",
    "      - uses: actions/checkout@main",
    "      - uses: google/osv-scanner-action/osv-scanner-action@v2.5.0"
  ]) {
    withFixture((root, add) => {
      add(".github/workflows/ci.yml", workflow.replace(/^      - uses:.*$/m, step));
      const result = run(root);
      assert.equal(result.status, 1, `${step} should be rejected`);
      assert.match(result.stderr, /not pinned to a full SHA/);
    });
  }
});

test("an action with no ref at all is rejected", () => {
  for (const step of [
    "      - uses: actions/checkout",
    '      - { "uses": "actions/checkout" }'
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
    `      - { "uses": "${pin}" }`,
    `      - ? uses\n        : ${pin}`
  ]) {
    withFixture((root, add) => {
      add(".github/workflows/ci.yml", workflow.replace(/^      - uses:.*$/m, step));
      const result = run(root);
      assert.equal(result.status, 0, `${step}\n${result.stderr}`);
    });
  }
});

test("a local or docker action needs no SHA", () => {
  for (const step of [
    "      - uses: ./.github/actions/local",
    "      - uses: docker://ghcr.io/owner/image@sha256:abc123"
  ]) {
    withFixture((root, add) => {
      add(".github/workflows/ci.yml", workflow.replace(/^      - uses:.*$/m, step));
      const result = run(root);
      assert.equal(result.status, 0, `${step}\n${result.stderr}`);
    });
  }
});

// Erasing the Docker exemption must not erase what shares its line. In flow
// style a second step sits after the image on the same line, and it still has
// to be pinned.
test("a step beside a docker action on one line is still checked", () => {
  withFixture((root, add) => {
    add(
      ".github/workflows/ci.yml",
      workflow.replace(
        /^    steps:\n      - uses:.*$/m,
        '    steps: [{"uses":"docker://alpine"},{"uses":"actions/checkout@v4"}]'
      )
    );
    const result = run(root);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /Action is not pinned to a full SHA/);
  });
});

// The other failure direction: a valid workflow must not be rejected because a
// scalar happens to contain the word "uses:" or an npm-style specifier.
test("prose and package specs in scalars do not fail a valid workflow", () => {
  for (const step of [
    '      - run: echo "This uses: no action"',
    "      - run: npm i -g pnpm@9",
    "      - run: npx @scope/pkg@1.2.3 --help",
    "      # This job uses: the pinned checkout above, nothing else."
  ]) {
    withFixture((root, add) => {
      add(".github/workflows/ci.yml", `${workflow}${step}\n`);
      const result = run(root);
      assert.equal(result.status, 0, `${step}\n${result.stderr}`);
    });
  }
});

test("an escaped quoted scalar in a workflow is rejected", () => {
  for (const step of [
    '      - uses: "actions/checkout\\u0040v4"',
    '      - uses: "actions/checkout\\x40v4"',
    '      - { "uses": "actions/checkout\\u00403d3c42e5aac5ba805825da76410c181273ba90b1" }'
  ]) {
    withFixture((root, add) => {
      add(".github/workflows/ci.yml", workflow.replace(/^      - uses:.*$/m, step));
      const result = run(root);
      assert.equal(result.status, 1, `${step} should be rejected`);
      assert.match(result.stderr, /Escaped quoted scalar/);
    });
  }
});

// A backslash inside `run: |` is shell, not a YAML escape, and must not fail.
// Both legal indicator orders have to be recognized, or a valid body is read
// as an escaped scalar.
test("a backslash in a block scalar is left alone", () => {
  for (const header of ["|", "|-", "|+", "|2", "|2-", "|-2", ">", ">-"]) {
    withFixture((root, add) => {
      add(".github/workflows/ci.yml", `${workflow}      - run: ${header}\n          grep -E "a\\\\.b" file\n          echo "done"\n`);
      const result = run(root);
      assert.equal(result.status, 0, `run: ${header}\n${result.stderr}`);
    });
  }
});

// In `run: grep -E "a\\.b" file` the YAML value is a plain scalar and the
// quotes belong to the shell, so an inline command must stay usable.
test("shell quoting in an inline command is not read as a YAML scalar", () => {
  for (const step of [
    '      - run: grep -E "a\\\\.b" file',
    '      - run: echo "line\\\\nbreak"',
    '      - name: Step with "a\\\\d" in its name\n        run: true'
  ]) {
    withFixture((root, add) => {
      add(".github/workflows/ci.yml", `${workflow}${step}\n`);
      const result = run(root);
      assert.equal(result.status, 0, `${step}\n${result.stderr}`);
    });
  }
});

test("a quoted backslash inside a comment is not read as a scalar", () => {
  withFixture((root, add) => {
    add(".github/workflows/ci.yml", `${workflow}      # grep uses the pattern "a\\\\.b" here\n`);
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

// A job may override the workflow's permissions, so write-all has to be
// refused wherever it is declared.
test("job-level write-all is rejected", () => {
  for (const declaration of [
    "    permissions: write-all",
    '    permissions: "write-all"',
    "        permissions: write-all"
  ]) {
    withFixture((root, add) => {
      add(".github/workflows/ci.yml", workflow.replace(
        /^  project-ci:$/m,
        `  project-ci:\n${declaration}`
      ));
      const result = run(root);
      assert.equal(result.status, 1, `${declaration} should be rejected`);
      assert.match(result.stderr, /may not use write-all/);
    });
  }
});

test("a scalar top-level permissions declaration is accepted", () => {
  withFixture((root, add) => {
    add(".github/workflows/ci.yml", workflow.replace(
      "permissions:\n  contents: read",
      "permissions: read-all"
    ));
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

// A declaration ends where its comment begins, in both directions: an
// annotated write-all is still write-all, and a comment mentioning a trigger
// is not that trigger.
test("an annotated write-all is still rejected", () => {
  for (const declaration of [
    "permissions: write-all # temporary",
    "permissions: write-all   # TODO revert before merge",
    '    permissions: "write-all" # job override'
  ]) {
    withFixture((root, add) => {
      add(".github/workflows/ci.yml", workflow.replace("permissions:\n  contents: read", declaration));
      const result = run(root);
      assert.equal(result.status, 1, `${declaration} should be rejected`);
      assert.match(result.stderr, /may not use write-all/);
    });
  }
});

test("a comment mentioning pull_request_target is not that trigger", () => {
  withFixture((root, add) => {
    add(".github/workflows/ci.yml", workflow.replace(
      "on:",
      "# Deliberately not pull_request_target: it would run with a write token.\non:"
    ));
    const result = run(root);
    assert.equal(result.status, 0, result.stderr);
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
