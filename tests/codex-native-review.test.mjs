import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  createCodexReviewRequestMarkerBody,
  evaluateCodexReviewEvidence,
  isAffirmativeCodexReviewState,
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
  observedReceipt.replace("Another round soon, please!", "Can't wait for the next one!"),
  observedReceipt.replace("Another round soon, please!", ":+1:"),
  observedReceipt.replace("Another round soon, please!", "You're on a roll."),
  observedReceipt.replace("Another round soon, please!", "You’re on a roll."),
  observedReceipt.replace("Another round soon, please!", "Already looking forward to the next diff.")
];
const comment = (body) => ({ id: 31, body, user, created_at: reviewedAt, updated_at: reviewedAt });
const clear = { commit_sha: head, has_any_findings: false, has_unresolved_findings: false, status: "completed" };
const absent = { commit_sha: null, has_any_findings: null, has_unresolved_findings: null, status: null };
const summary = (code = clear, security = absent) => `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify({ code_review: code, security_review: security })} -->\n\n## Codex Review Summary\n\n| 📝 **Code Review** | ✅ **Completed** <relative-time datetime="${reviewedAt}">${reviewedAt}</relative-time> | \`2667f79\` | Manual request |\n\n${details}`;
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

test("structured state requires an exact closed affirmative schema", () => {
  for (const body of [
    summary({ ...clear, status: "running" }),
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

  }
  assert.equal(evaluateCodexReviewEvidence(evidence({ comments: [comment(summary())] })), "pass");
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
    { comments: [comment(summary()), comment(receipt)] }]) {
    const result = runGate(options);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Codex Review passed/);
  }
  for (const options of [{ comments: [comment(summary({ ...clear, status: "running" }))] }, { comments: [comment(summary({ ...clear, status: "failed" })), comment(receipt)] }, { threads: [{ isResolved: false }] }, { comments: [comment("Completed 👍")] }, { comments: [comment(receipt.replace("2667f79cd7", "0000000000"))] }, { moved: true, dispatch: true }]) {
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

// Independent machine completion permits any neutral closing without teaching
// the legacy receipt parser new phrases. The receipt itself remains strict.
test("only newer structured proof supersedes an unfamiliar closing", () => {
  const run = (answers) => evaluateCodexReviewEvidence(evidence({ comments: answers }));
  const state = comment(summary());
  for (const suffix of ["Swish!", "Chef's kiss.", "Chef’s kiss.", "No worries!", "A whimsical flourish.", "Sunshine and confetti! 🎉"]) {
    const answer = comment(receipt.replace(":rocket:", suffix));
    assert.equal(run([answer]), (["Chef's kiss.", "Chef’s kiss."].includes(suffix) ? "pass" : "pending"));
    for (const newerState of [true, false]) {
      const later = { ...(newerState ? { ...state, body: state.body.replaceAll(reviewedAt, "2026-10-15T22:00:00Z") } : answer), id: 99, created_at: "2026-10-15T22:00:00Z", updated_at: "2026-10-15T22:00:00Z" };
      const answers = newerState ? [answer, later] : [state, later];
      assert.equal(run(answers), newerState ? "pass" : (["Chef's kiss.", "Chef’s kiss."].includes(suffix) ? "pass" : "pending"), suffix);
      assert.equal(runGate({ comments: answers }).status, newerState || ["Chef's kiss.", "Chef’s kiss."].includes(suffix) ? 0 : 1, suffix);
    }
  }
  for (const suffix of ["Swish! <!-- unknown -->", "Swish!\nExtra line.", "P0 finding", "P1 finding", "P2 finding"]) {
    assert.equal(run([state, comment(receipt.replace(":rocket:", suffix))]), "pending", suffix);
  }
  for (const bad of [summary().replace('"completed"', '"running"'), summary().replace('"has_any_findings":false', '"has_any_findings":true'), summary().replace('"code_review":', '"code_review":{},"code_review":'), summary().replace('"status":"completed"', '"extra":false,"status":"completed"'), summary().replace('"status":"completed"', '"status":true'), summary().replace('"status":null', '"status":"running"'), summary().replace('"commit_sha":null', '"commit_sha":"' + "f".repeat(40) + '"'), summary().replace('"code_review":', '"code_review":broken'), summary() + "\n<!-- codex-review-state:v1 {} -->"]) {
    const newer = { ...comment(bad), id: 100, updated_at: "2026-10-15T22:00:00Z" };
    assert.equal(run([state, newer]), "pending", bad);
    assert.equal(runGate({ comments: [state, newer] }).status, 1);
  }
  assert.equal(run([{ ...state, updated_at: "2026-10-15T19:00:00Z" }]), "pending");
  assert.equal(run([{ ...state, user: { login: "fake-codex[bot]" } }]), "pending");
});

test("latest malformed, negative or ambiguous summary supersedes clean state", () => {
  const run = (comments) => evaluateCodexReviewEvidence(evidence({ comments }));
  const clean = comment(summary());
  for (const body of [summary().replace("state:v1", "state:v2"), summary().replace('"completed"', '"pending"'), summary().replace('"commit_sha":"', '"commit_sha":"f'), summary() + "\nP0: blocker", summary() + "\n**Reviewed commit:** `abcdef0123`", summary().replace('"status":"completed"', '"status":"completed","status":"completed"')]) {
    const invalid = { ...comment(body), id: 1 };
    assert.equal(run([clean, invalid]), "pending", body);
    assert.equal(run([invalid, clean]), "pending", body);
    assert.equal(run([clean, { ...invalid, updated_at: "2026-10-15T22:00:00Z" }]), "pending", body);
  }
});

test("visible contradictions and latest pending state veto positive formal review", () => {
  const reviews = [{ id: 1, commit_id: head, state: "COMMENTED", user: user, submitted_at: reviewedAt }];
  const run = (comments) => evaluateCodexReviewEvidence(evidence({ comments, reviews }));
  for (const body of [summary().replace("## Codex Review Summary", "## Unknown Summary"), summary().replace("## Codex Review Summary", "## Codex Review Summary\nFound unresolved issues."), summary().replace("## Codex Review Summary", "## Codex Review Summary\nSecurity Review failed."), summary().replace("## Codex Review Summary", "## Codex Review Summary\nCode Review running."), summary().replace('"completed"', '"running"'), summary().replace('"status":null', '"status":"running"')]) {
    assert.equal(run([comment(body)]), "pending", body);
  }
});

test("affirmative machine state never hides native P0-P2 findings", () => {
  for (const priority of [0, 1, 2]) {
    const reviews = [{ id: 1, commit_id: head, state: "COMMENTED", user: user, submitted_at: reviewedAt, body: `P${priority}: actionable finding` }];
    assert.equal(evaluateCodexReviewEvidence(evidence({ comments: [comment(summary())], reviews })), "fail");
  }
});

test("machine chronology does not interpret arbitrary prose as neutral", () => {
  const run = (comments) => evaluateCodexReviewEvidence(evidence({ comments }));
  for (const suffix of ["Broken; avoid merging!", "Do not merge.", "A vulnerability remains.", "Needs work.", "No worries!"]) {
    const answer = comment(receipt.replace(":rocket:", suffix));
    const newer = { ...comment(summary().replaceAll(reviewedAt, "2026-10-15T22:00:00Z")), id: 99, updated_at: "2026-10-15T22:00:00Z" };
    assert.equal(run([answer]), "pending", suffix);
    assert.equal(run([answer, newer]), "pass", suffix);
    assert.equal(run([comment(summary()), { ...answer, created_at: "2026-10-15T22:00:00Z", updated_at: "2026-10-15T22:00:00Z" }]), "pending", suffix);
    assert.equal(run([comment(summary()), answer]), "pending", suffix);
  }
});

test("security-only edits cannot renew code completion or supersede later receipts", () => {
  const run = (comments) => evaluateCodexReviewEvidence(evidence({ comments }));
  const state = comment(summary());
  const unknown = { ...comment(receipt.replace(":rocket:", "Swish!")), created_at: "2026-10-15T21:30:00Z", updated_at: "2026-10-15T21:30:00Z" };
  const securityOnly = { ...state, updated_at: "2026-10-15T22:00:00Z" };
  assert.equal(run([unknown, securityOnly]), "pending");
  const staleCode = { ...securityOnly, body: state.body.replaceAll(reviewedAt, "2026-10-15T19:00:00Z") };
  assert.equal(run([staleCode]), "pending");
  // Real native rows carry subsecond timestamps but GitHub's updated_at is
  // truncated to seconds. Same-second unknown prose still wins conservatively.
  const fractional = { ...state, body: state.body.replaceAll(reviewedAt, reviewedAt.replace("Z", ".070069Z")) };
  assert.equal(run([fractional]), "pass");
  assert.equal(run([fractional, comment(receipt.replace(":rocket:", "Swish!"))]), "pending");
  const future = { ...state, body: state.body.replaceAll(reviewedAt, "2026-10-15T23:00:00Z") };
  assert.equal(run([future]), "pending");
});

test("same-second request/completion ambiguity and impossible dates fail closed", () => {
  const run = (comments) => evaluateCodexReviewEvidence(evidence({ comments }));
  const ambiguous = { ...comment(summary().replaceAll(reviewedAt, requestedAt.replace("Z", ".070069Z"))), updated_at: requestedAt };
  assert.equal(run([ambiguous]), "pending");
  const impossible = { ...comment(summary().replaceAll(reviewedAt, "2026-02-30T21:00:00Z")), updated_at: "2026-10-15T22:00:00Z" };
  assert.equal(isAffirmativeCodexReviewState(impossible, head, "2026-02-28T20:00:00Z", 10), false);
});


test("receipt edits cannot outrank newer pending or negative summaries", () => {
  const edited = { ...comment(receipt), updated_at: "2026-10-15T23:00:00Z" };
  for (const status of ["running", "failed"]) {
    const pending = { ...comment(summary().replace('"completed"', JSON.stringify(status))), updated_at: "2026-10-15T22:00:00Z" };
    const comments = [edited, pending];
    assert.equal(evaluateCodexReviewEvidence(evidence({ comments })), "pending");
    assert.equal(runGate({ comments }).status, 1);
  }
  const old = { ...edited, created_at: "2026-10-15T19:00:00Z" };
  const comments = [old, comment(summary())];
  assert.equal(evaluateCodexReviewEvidence(evidence({ comments })), "pass", "editing a pre-request receipt does not rebind it");
});


test("editing unknown receipt text invalidates an older clean completion", () => {
  const state = { ...comment(summary().replaceAll(reviewedAt, "2026-10-15T22:00:00Z")), updated_at: "2026-10-15T22:00:00Z" };
  const answer = comment(receipt.replace(":rocket:", "Broken; avoid merging!"));
  assert.equal(evaluateCodexReviewEvidence(evidence({ comments: [answer, state] })), "pass");
  for (const created_at of [answer.created_at, "2026-10-15T19:00:00Z"]) {
    const comments = [state, { ...answer, created_at, updated_at: "2026-10-15T23:00:00Z" }];
    assert.equal(evaluateCodexReviewEvidence(evidence({ comments })), "pending");
    assert.equal(runGate({ comments }).status, 1);
  }
});


test("same-second receipts preceding the request cannot veto a fresh answer", () => {
  const previous = { ...comment(receipt), id: 29, created_at: requestedAt };
  const comments = [previous, comment(receipt)];
  assert.equal(evaluateCodexReviewEvidence(evidence({ comments })), "pass");
  assert.equal(runGate({ comments }).status, 0);
  const current = { ...previous, id: 31 };
  assert.equal(evaluateCodexReviewEvidence(evidence({ comments: [current] })), "pass", "later numeric ID proves same-second freshness");
});


test("a fresh completion supersedes an eligible pre-request receipt edit", () => {
  const edited = { ...comment(receipt.replace(":rocket:", "Swish!")), created_at: "2026-10-15T19:00:00Z", updated_at: "2026-10-15T21:30:00Z" };
  const state = { ...comment(summary().replaceAll(reviewedAt, "2026-10-15T22:00:00Z")), updated_at: "2026-10-15T22:00:00Z" };
  const comments = [edited, state];
  assert.equal(evaluateCodexReviewEvidence(evidence({ comments })), "pass");
  assert.equal(runGate({ comments }).status, 0);
  edited.updated_at = "2026-10-15T23:00:00Z";
  assert.equal(evaluateCodexReviewEvidence(evidence({ comments })), "pending");
  assert.equal(runGate({ comments }).status, 1);
});


test("a mutable summary edit tied with the request stays pending despite its old ID", () => {
  const updated = { ...comment(summary().replace('"completed"', '"running"')), id: 29, created_at: "2026-10-15T19:00:00Z", updated_at: requestedAt };
  const answer = { ...comment(receipt), id: 31, created_at: requestedAt, updated_at: requestedAt };
  const comments = [updated, answer];
  assert.equal(evaluateCodexReviewEvidence(evidence({ comments })), "pending", "the lower ID dates creation, not the edit within this second");
  assert.equal(runGate({ comments }).status, 1);
});
