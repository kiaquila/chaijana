import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  codexStructuredSummaryResult,
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
const comment = (body) => ({ id: 31, body, user, created_at: reviewedAt, updated_at: reviewedAt });
const clear = { commit_sha: head, has_any_findings: false, has_unresolved_findings: false, status: "completed" };
const absent = { commit_sha: null, has_any_findings: null, has_unresolved_findings: null, status: null };
const summary = (code = clear, security = absent) => `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify({ code_review: code, security_review: security })} -->\n\n## Codex Review Summary\n\n| 📝 **Code Review** | ✅ **Completed** | \`2667f79\` | Manual request |\n\n${details}`;
const accept = (body) => isAcceptableCodexSummaryComment(comment(body), head, requestedAt, 30);
const structured = (body) => codexStructuredSummaryResult(comment(body), head, requestedAt, 30);

test("native receipt and legacy retain explicit positive head-bound verdicts", () => {
  for (const body of [legacy, receipt, receipt.replace(":rocket:", "Keep it up!"), legacy.replace(head.slice(0, 10), head)]) assert.equal(accept(body), true);
  for (const body of [
    receipt.replace("2667f79cd7", "0000000000"), receipt.replace("2667f79cd7", head.slice(0, 9)),
    receipt.replace(/\*\*Reviewed commit:.*\n/, ""), receipt.replace("Didn't find any major issues.", "Found issues."),
    receipt.replace("Didn't find any major issues.", "Review in progress."),
    `${receipt}\nP2 unresolved regression`, `${receipt}\n${legacy}`, receipt.replace("v1 -->", "v2 -->"),
    `<!-- codex-review-receipt:v1 -->\n${receipt}`, receipt.replace("<br/>", "<br/>\nP3 note and P1 regression"),
    receipt.replace("<br/>", "<!-- codex-review-state:v1 {} -->"), receipt.replace("<br/>", "Found issues."), "Completed 👍"
  ]) assert.equal(accept(body), false, body);
  assert.equal(isAcceptableCodexSummaryComment({ ...comment(receipt), user: { login: "fake-codex[bot]" } }, head), false);
  assert.equal(isAcceptableCodexSummaryComment(comment(receipt), head, "2026-10-15T21:02:00Z"), false);
  assert.equal(isAcceptableCodexSummaryComment({ ...comment(receipt), created_at: requestedAt, updated_at: reviewedAt }, head, requestedAt, 32), false, "receipt edits do not rebind old short-SHA evidence");
});

test("structured summaries require strict schema, types, full head and clear completed verdict", () => {
  assert.equal(structured(summary()), "pass");
  assert.equal(structured(summary(clear, clear)), "pass");
  assert.equal(structured(summary({ ...clear, has_any_findings: null, has_unresolved_findings: null, status: "running" }).replace("✅ **Completed**", "🔄 **Running**")), "pending");
  assert.equal(structured(summary() + "\nFound issues."), "fail");
  assert.equal(structured(summary().replace("`2667f79`", "`0000000`")), "fail");
  assert.equal(structured(summary().replace("**Completed**", "**In progress**")), "fail");
  for (const code of [
    { ...clear, commit_sha: "a".repeat(40) }, { ...clear, commit_sha: head.slice(0, 10) },
    { ...clear, commit_sha: null }, { ...clear, status: "Completed" },
    { ...clear, has_any_findings: "false" }, { ...clear, has_unresolved_findings: 0 },
    { ...clear, extra: false }, { status: "completed" }
  ]) assert.equal(structured(summary(code)), null, JSON.stringify(code));
  for (const code of [{ ...clear, status: "running" }, { ...clear, status: "in_progress" }, { ...clear, status: "failed" }, { ...clear, has_any_findings: null }]) assert.equal(structured(summary(code)), "pending");
  for (const code of [{ ...clear, has_any_findings: true }, { ...clear, has_unresolved_findings: true }]) assert.equal(structured(summary(code)), "fail");
  assert.equal(structured(summary(clear, { ...clear, has_any_findings: true })), "fail");
  assert.equal(structured(summary(clear, { ...clear, status: "pending" })), "pending");
  assert.equal(structured(summary(clear, { ...clear, commit_sha: "a".repeat(40) })), null);
  for (const body of [
    summary().replace('"code_review":', '"code_review":{},"code_review":'),
    summary().replace('"status":"completed"', '"status":"pending","status":"completed"'),
    summary().replace('"code_review"', '"unknown"'), summary().replace('"code_review":', '"code_review":broken'),
    `${summary()}\n<!-- codex-review-state:v1 {} -->`, `${summary()}\n<!-- codex-pull-request-review-summary -->`,
    `${summary()}\n${legacy}`, "## Codex Review Summary\nCompleted 👍"
  ]) assert.equal(structured(body), null, body);
  assert.equal(codexStructuredSummaryResult({ ...comment(summary()), user: { login: "fake-codex[bot]" } }, head), null);
});

test("an existing summary can be updated after a new request, with unambiguous edit time", () => {
  const updated = { ...comment(summary()), created_at: "2026-10-15T20:00:00Z" };
  assert.equal(codexStructuredSummaryResult(updated, head, requestedAt, 32), "pass");
  for (const updated_at of [requestedAt, "invalid", "2026-10-15T20:59:00Z"]) assert.equal(codexStructuredSummaryResult({ ...updated, updated_at }, head, requestedAt, 32), null);
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
  assert.equal(evaluateCodexReviewEvidence(evidence({ comments: [comment(receipt), comment(summary({ ...clear, has_any_findings: true }))] })), "fail");
  assert.equal(evaluateCodexReviewEvidence(evidence({ comments: [comment(receipt), comment(summary({ ...clear, status: "pending" }))] })), "pending");
  assert.equal(evaluateCodexReviewEvidence(evidence({ comments: [comment(receipt), comment(summary({ ...clear, status: "running" }))] })), "pending");
  assert.equal(evaluateCodexReviewEvidence(evidence({ comments: [comment(receipt), comment(summary().replace("**Completed**", "**In progress**"))] })), "fail");
});

test("stale non-final summaries cannot veto a later request, but findings survive", () => {
  for (const status of ["pending", "running", "in_progress", "failed", "cancelled"]) {
    const stale = { ...comment(summary({ ...clear, status })), created_at: "2026-10-15T20:00:00Z", updated_at: "2026-10-15T20:01:00Z" };
    assert.equal(codexStructuredSummaryResult(stale, head, requestedAt, 30), null);
    assert.equal(evaluateCodexReviewEvidence(evidence({ comments: [stale, comment(receipt)] })), "pass");
    assert.equal(evaluateCodexReviewEvidence(evidence({ comments: [stale], reviews: [{ id: 1, commit_id: head, user, state: "COMMENTED", submitted_at: reviewedAt }] })), "pass");
    const refreshed = { ...stale, updated_at: reviewedAt };
    assert.equal(evaluateCodexReviewEvidence(evidence({ comments: [refreshed, comment(receipt)] })), "pending");
    const findings = { ...stale, body: summary({ ...clear, status, has_any_findings: true }) };
    assert.equal(evaluateCodexReviewEvidence(evidence({ comments: [findings, comment(receipt)] })), "fail");
  }
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

test("the executed gate validates receipt, edited summary, paginated threads and final head", () => {
  for (const options of [{}, { comments: [{ ...comment(summary()), created_at: "2026-10-15T20:00:00Z" }] },
    { comments: [{ ...comment(summary({ ...clear, status: "running" })), created_at: "2026-10-15T20:00:00Z", updated_at: "2026-10-15T20:01:00Z" }, comment(receipt)] }]) {
    const result = runGate(options);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Codex Review passed/);
  }
  for (const options of [{ threads: [{ isResolved: false }] }, { comments: [comment("Completed 👍")] }, { comments: [comment(receipt.replace("2667f79cd7", "0000000000"))] }, { moved: true, dispatch: true }]) {
    const result = runGate(options);
    assert.equal(result.status, 1, result.stdout);
    assert.doesNotMatch(result.stdout, /Codex Review passed/);
  }
});
