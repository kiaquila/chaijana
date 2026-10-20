import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  createCodexReviewRequestMarkerBody,
  evaluateCodexReviewEvidence,
  isAcceptableCodexSummaryComment
} from "../scripts/codex-review-helpers.mjs";
import { rerunCodexReviewForHead, shouldRouteCodexReviewRerunEvent } from "../scripts/codex-review-rerun.mjs";

const head = "2667f79cd7676ff331730cabf661d38dbbcddb0d";
const user = { login: "chatgpt-codex-connector[bot]" };
const requestedAt = "2026-10-15T21:00:00Z";
const reviewedAt = "2026-10-15T21:01:00Z";
const details = '<details> <summary>ℹ️ About Codex in GitHub</summary>\n<br/>\nCodex reacts with 👍 once reviews finish.\n</details>';
const legacy = "Codex Review: Didn't find any major issues. :rocket:\n\n**Reviewed commit:** `2667f79cd7`";
const receipt = `<!-- codex-review-receipt:v1 -->\n\n${legacy}\n\n${details}`;
const observedReceipt = `<!-- codex-review-receipt:v1 -->\n\nCodex Review: Didn't find any major issues. Another round soon, please!\n\n**Reviewed commit:** \`2667f79cd7\`\n\n${details}`;
const observedReceipts = [
  observedReceipt,
  observedReceipt.replace("Another round soon, please!", "Breezy!"),
  observedReceipt.replace("Another round soon, please!", "What shall we delve into next?"),
  observedReceipt.replace("Another round soon, please!", "Can't wait for the next one!")
];
const comment = (body) => ({ id: 31, body, user, created_at: reviewedAt, updated_at: reviewedAt });
const clear = { commit_sha: head, has_any_findings: false, has_unresolved_findings: false, status: "completed" };
const absent = { commit_sha: null, has_any_findings: null, has_unresolved_findings: null, status: null };
const summary = (code = clear, security = absent) => `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify({ code_review: code, security_review: security })} -->\n\n## Codex Review Summary\n\n| 📝 **Code Review** | ✅ **Completed** | \`2667f79\` | Manual request |\n\n${details}`;
const accept = (body) => isAcceptableCodexSummaryComment(comment(body), head, requestedAt, 30);

test("native receipt and legacy retain explicit positive head-bound verdicts", () => {
  for (const body of [legacy, receipt, ...observedReceipts, receipt.replace(":rocket:", "Keep it up!"), receipt.replace(":rocket:", "Chef's kiss."), receipt.replace(":rocket:", "Nice work!"), receipt.replace(":rocket:", "Keep them coming!"), receipt.replace(":rocket:", "Chef’s kiss."), legacy.replace(head.slice(0, 10), head)]) assert.equal(accept(body), true);
  for (const body of [
    receipt.replace("2667f79cd7", "0000000000"), receipt.replace("2667f79cd7", head.slice(0, 9)),
    receipt.replace(/\*\*Reviewed commit:.*\n/, ""), receipt.replace("Didn't find any major issues.", "Found issues."),
    receipt.replace("Didn't find any major issues.", "Review in progress."),
    receipt.replace(":rocket:", "But there is a regression."),
    receipt.replace(":rocket:", "However, review failed."),
    receipt.replace(":rocket:", "Except there is a critical regression."),
    receipt.replace(":rocket:", "Not approved."),
    receipt.replace(":rocket:", "Unrecognized sign-off."),
    receipt.replace(":rocket:", "There are security concerns."),
    receipt.replace(":rocket:", "Some issues need attention."),
    receipt.replace(":rocket:", "A whimsical flourish."),
    receipt.replace(":rocket:", "A".repeat(121)),
    receipt.replace(":rocket:", "Two lines.\nStill clean."),
    observedReceipt.replace("Another round soon, please!", "Another round soon, please! But there is a regression."),
    receipt.replace("<br/>", "<br/> Except there is a critical regression."),
    `${receipt}\nP2 unresolved regression`, `${receipt}\n${legacy}`, receipt.replace("v1 -->", "v2 -->"),
    `<!-- codex-review-receipt:v1 -->\n${receipt}`, receipt.replace("<br/>", "<br/>\nP3 note and P1 regression"),
    receipt.replace("<br/>", "<!-- codex-review-state:v1 {} -->"), receipt.replace("<br/>", "Found issues."), "Completed 👍"
  ]) assert.equal(accept(body), false, body);
  assert.equal(isAcceptableCodexSummaryComment({ ...comment(receipt), user: { login: "fake-codex[bot]" } }, head), false);
  assert.equal(isAcceptableCodexSummaryComment(comment(receipt), head, "2026-10-15T21:02:00Z"), false);
  assert.equal(isAcceptableCodexSummaryComment({ ...comment(receipt), created_at: requestedAt, updated_at: reviewedAt }, head, requestedAt, 32), false, "receipt edits do not rebind old short-SHA evidence");
});

test("created and edited routing agrees with the actual workflow filter", () => {
  const workflow = readFileSync(new URL("../.github/workflows/codex-review-rerun.yml", import.meta.url), "utf8");
  assert.match(workflow, /types: \[created, edited\]/);
  const prefixes = [...workflow.matchAll(/startsWith\(github.event.comment.body, '([^']+)'\)/g)].map((match) => match[1]);
  assert.deepEqual(prefixes, ["Codex Review:", "<!-- codex-review-receipt:v1 -->", "<!-- codex-pull-request-review-summary -->"]);
  assert.match(workflow, /github.event.comment.user.login == 'chatgpt-codex-connector\[bot\]'/);
  assert.match(workflow, /ref: \$\{\{ github.event.repository.default_branch \}\}/);
  assert.match(workflow, /node scripts\/codex-review-rerun.mjs/);
  assert.match(workflow, /cancel-in-progress: false/);
  for (const action of ["created", "edited"]) {
    for (const body of [legacy, receipt, summary(), summary({ ...clear, status: "pending" })]) {
      const event = { action, issue: { pull_request: {} }, comment: comment(body) };
      assert.equal(shouldRouteCodexReviewRerunEvent(event), true);
      assert.equal(prefixes.some((prefix) => body.startsWith(prefix)), true);
      assert.equal(shouldRouteCodexReviewRerunEvent({ ...event, comment: { ...event.comment, user: { login: "github-actions[bot]" } } }), false);
      assert.equal(shouldRouteCodexReviewRerunEvent({ ...event, issue: {} }), false);
    }
  }
  assert.equal(shouldRouteCodexReviewRerunEvent({ action: "deleted", issue: { pull_request: {} }, comment: comment(receipt) }), false);
  assert.equal(shouldRouteCodexReviewRerunEvent({ action: "submitted", review: { user } }), true);
  assert.equal(shouldRouteCodexReviewRerunEvent({ issue: { pull_request: {} }, comment: comment("👍 Completed") }), false);
});

const evidence = (overrides = {}) => ({ comments: [comment(receipt)], reviews: [], reviewComments: [], threads: [], headSha: head, requestMarker: { sourceCommentCreatedAt: requestedAt, sourceCommentId: 30 }, ...overrides });
test("a new request never clears findings or unresolved threads", () => {
  assert.equal(evaluateCodexReviewEvidence(evidence()), "pass");
  assert.equal(evaluateCodexReviewEvidence(evidence({
    reviews: [{ id: 1, commit_id: head, state: "COMMENTED", user, submitted_at: reviewedAt }],
    reviewComments: [{ pull_request_review_id: 1, user, body: "P3 note followed by P1 regression" }]
  })), "fail");
  assert.equal(evaluateCodexReviewEvidence(evidence({ threads: [{ isResolved: false }] })), "fail");
  assert.equal(evaluateCodexReviewEvidence(evidence({ threads: [{ isResolved: true }] })), "pass");
  assert.equal(evaluateCodexReviewEvidence(evidence({ reviews: [{ id: 1, commit_id: head, state: "CHANGES_REQUESTED", user, submitted_at: "2026-10-15T20:59:00Z" }] })), "fail");

});

test("structured summaries only wake the gate and never supply a verdict", () => {
  for (const body of [
    summary(), summary({ ...clear, status: "running" }),
    summary({ ...clear, has_any_findings: true, has_unresolved_findings: true }),
    summary({ ...clear, status: "failed" }), summary({ ...clear, status: "cancelled" }),
    summary({ ...clear, commit_sha: "a".repeat(40) }), summary({ ...clear, commit_sha: null }),
    summary({ ...clear, has_any_findings: "false" }), summary({ status: "completed" }),
    summary().replace('"code_review":', '"code_review":{},"code_review":'),
    summary().replace('"code_review":', '"code_review":broken'),
    `${summary()}\n<!-- codex-review-state:v1 {} -->`,
    summary().replace("`2667f79`", "`0000000`"), "## Codex Review Summary\nCompleted 👍"
  ]) {
    assert.equal(evaluateCodexReviewEvidence(evidence({ comments: [comment(body)] })), "pending", body);
    assert.equal(evaluateCodexReviewEvidence(evidence({ comments: [{ ...comment(body), created_at: "2026-10-15T20:00:00Z", updated_at: reviewedAt }] })), "pending", "edits cannot turn a summary into approval");
  }
  const receiptAndSummary = evidence({ comments: [comment(receipt), comment(summary())] });
  assert.equal(evaluateCodexReviewEvidence(receiptAndSummary), "pass");
  assert.equal(evaluateCodexReviewEvidence({ ...receiptAndSummary, threads: [{ isResolved: false }] }), "fail");
  assert.equal(evaluateCodexReviewEvidence({ ...receiptAndSummary, reviews: [{ id: 1, commit_id: head, user, state: "CHANGES_REQUESTED", submitted_at: reviewedAt }] }), "fail");
  assert.equal(evaluateCodexReviewEvidence(evidence({ comments: [comment(summary())],
    reviews: [{ id: 1, commit_id: head, user, state: "COMMENTED", submitted_at: reviewedAt }],
    reviewComments: [{ pull_request_review_id: 1, user, body: "P3 advisory" }],
    threads: [{ isResolved: true }]
  })), "pass", "resolved P3 formal reviews retain their previous treatment");
});

test("requeue checks the live head after waiting and coalesces already evaluated updates", async () => {
  const run = { id: 42, event: "pull_request", head_sha: head, status: "completed", created_at: requestedAt, run_started_at: reviewedAt };
  for (const scenario of ["completed", "active", "stale", "duplicate", "absent"]) {
    let reads = 0;
    const writes = [];
    const result = await rerunCodexReviewForHead({ token: "token", repository: "owner/repo", headSha: head, prNumber: 1,
      evidenceUpdatedAt: scenario === "duplicate" ? requestedAt : "2026-10-15T21:02:00Z",
      sleep: async () => {}, request: async (_token, _repository, path, options = {}) => {
        if (options.method === "POST") { writes.push(path); return; }
        if (path.endsWith("/pulls/1")) return { state: "open", head: { sha: scenario === "stale" ? "a".repeat(40) : head } };
        reads += 1;
        return { workflow_runs: scenario === "absent" ? [] : [{ ...run, status: reads === 1 && ["active", "stale"].includes(scenario) ? "in_progress" : "completed" }] };
      } });
    assert.equal(result.action, ({ stale: "stale", duplicate: "already_evaluated", absent: "not_found" })[scenario] || "rerun");
    assert.equal(writes.length, ["completed", "active"].includes(scenario) ? 1 : 0);
    if (["active", "stale"].includes(scenario)) assert.equal(reads, 2);
  }
});

function runGate({ comments = [comment(receipt)], threads = [], moved = false, dispatch = false }) {
  const directory = mkdtempSync(join(tmpdir(), "codex-gate-test-"));
  try {
    const marker = comment(createCodexReviewRequestMarkerBody({ headSha: head, requestId: "30-current-head", sourceCommentId: 30, sourceCommentCreatedAt: requestedAt, requestedAt }));
    marker.user = { login: "github-actions[bot]" };
    const fixture = { comments: [marker, ...comments], threads, moved, head };
    const preload = join(directory, "mock.mjs");
    writeFileSync(preload, `const fixture = ${JSON.stringify(fixture)}; let pulls = 0; globalThis.fetch = async (url, options) => {
      let data; const path = new URL(url).pathname;
      if (path === '/graphql') { const cursor = JSON.parse(options.body).variables.cursor; data = { data: { repository: { pullRequest: { reviewThreads: { nodes: cursor ? fixture.threads : [], pageInfo: { hasNextPage: !cursor, endCursor: cursor ? null : 'next' } } } } } }; }
      else if (path.endsWith('/pulls/1')) { pulls++; data = { head: { sha: fixture.moved && pulls >= 4 ? 'a'.repeat(40) : fixture.head } }; }
      else if (path.includes('/issues/1/comments')) data = fixture.comments;
      else data = [];
      return { ok: true, json: async () => data };
    };`);
    return spawnSync(process.execPath, ["--import", preload, resolve(import.meta.dirname, "../scripts/codex-review-gate.mjs")], { encoding: "utf8", env: { ...process.env, GITHUB_TOKEN: "test-token", GITHUB_REPOSITORY: "owner/repo", CODEX_REVIEW_PR_NUMBER: "1", CODEX_REVIEW_HEAD_SHA: head, CODEX_REVIEW_WAIT_MS: "1", CODEX_REVIEW_POLL_MS: "1", CODEX_REVIEW_DEBOUNCE_MS: "0", CODEX_REVIEW_REQUIRE_HEAD_MATCH: String(dispatch), GITHUB_STEP_SUMMARY: "" } });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("the executed gate validates receipt evidence, paginated threads and final head", () => {
  for (const options of [{}, ...observedReceipts.map((body) => ({ comments: [comment(body)] })), { comments: [{ ...comment(summary()), created_at: "2026-10-15T20:00:00Z" }, comment(receipt)] },
    { comments: [{ ...comment(summary({ ...clear, status: "running" })), created_at: "2026-10-15T20:00:00Z", updated_at: "2026-10-15T20:01:00Z" }, comment(receipt)] },
    { comments: [comment(summary({ ...clear, status: "failed" })), { ...comment(receipt), created_at: "2026-10-15T21:02:00Z", updated_at: "2026-10-15T21:02:00Z" }] }]) {
    const result = runGate(options);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Codex Review passed/);
  }
  for (const options of [{ comments: [comment(summary())] }, { threads: [{ isResolved: false }] }, { comments: [comment("Completed 👍")] }, { comments: [comment(receipt.replace("2667f79cd7", "0000000000"))] }, { moved: true, dispatch: true }]) {
    const result = runGate(options);
    assert.equal(result.status, 1, result.stdout);
    assert.doesNotMatch(result.stdout, /Codex Review passed/);
  }
});

test("the executed request script coalesces only runs started after marker publication", () => {
  for (const startedAfterMarker of [false, true]) {
    const directory = mkdtempSync(join(tmpdir(), "codex-request-test-"));
    try {
      const eventPath = join(directory, "event.json");
      const outputPath = join(directory, "writes.json");
      const preload = join(directory, "mock.mjs");
      writeFileSync(eventPath, JSON.stringify({ issue: { number: 1, pull_request: {} }, comment: {
        id: 30, body: `@codex review ${head}`, user: { login: "owner", type: "User" },
        author_association: "OWNER", created_at: requestedAt
      } }));
      const markerCreatedAt = "2026-10-15T21:02:00Z";
      const startedAt = startedAfterMarker ? "2026-10-15T21:03:00Z" : reviewedAt;
      writeFileSync(preload, `import { writeFileSync } from 'node:fs';
        const writes = []; globalThis.fetch = async (url, options = {}) => {
          const path = new URL(url).pathname; let data;
          if (options.method === 'POST') {
            writes.push({ path, body: options.body && JSON.parse(options.body) });
            writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify(writes));
            data = path.endsWith('/comments') ? { created_at: ${JSON.stringify(markerCreatedAt)} } : null;
          } else if (path.endsWith('/pulls/1')) data = { state: 'open', head: { sha: ${JSON.stringify(head)} } };
          else data = { workflow_runs: [{ id: 42, event: 'pull_request', head_sha: ${JSON.stringify(head)}, status: 'completed', conclusion: 'success', created_at: ${JSON.stringify(requestedAt)}, run_started_at: ${JSON.stringify(startedAt)} }] };
          return { ok: true, text: async () => data === null ? '' : JSON.stringify(data) };
        };`);
      const result = spawnSync(process.execPath, ["--import", preload, resolve(import.meta.dirname, "../scripts/codex-review-request.mjs")], {
        encoding: "utf8", env: { ...process.env, GITHUB_TOKEN: "test-token", GITHUB_REPOSITORY: "owner/repo", GITHUB_EVENT_PATH: eventPath }
      });
      assert.equal(result.status, 0, result.stderr);
      const writes = JSON.parse(readFileSync(outputPath, "utf8"));
      assert.equal(writes[0].path, "/repos/owner/repo/issues/1/comments");
      assert.match(writes[0].body.body, /CODEX_REVIEW_SOURCE_COMMENT_CREATED_AT: 2026-10-15T21:00:00Z/);
      assert.equal(writes.filter((write) => write.path.endsWith('/rerun')).length, startedAfterMarker ? 0 : 1);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});
