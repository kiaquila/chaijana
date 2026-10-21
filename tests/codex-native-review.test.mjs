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

function runGate({ comments = [comment(receipt)], threads = [], moved = false, dispatch = false, reviews = [], requestAt = requestedAt, requestCommentId = 30 }) {
  const directory = mkdtempSync(join(tmpdir(), "codex-gate-test-"));
  try {
    const marker = comment(createCodexReviewRequestMarkerBody({ headSha: head, requestId: "30-current-head", sourceCommentId: requestCommentId, sourceCommentCreatedAt: requestAt, requestedAt: requestAt }));
    marker.user = { login: "github-actions[bot]" };
    const fixture = { comments: [marker, ...comments], threads, moved, head, reviews };
    const preload = join(directory, "mock.mjs");
    writeFileSync(preload, `const fixture = ${JSON.stringify(fixture)}; let pulls = 0; globalThis.fetch = async (url, options) => {
      let data; const path = new URL(url).pathname;
      if (path === '/graphql') { const cursor = JSON.parse(options.body).variables.cursor; data = { data: { repository: { pullRequest: { reviewThreads: { nodes: cursor ? fixture.threads : [], pageInfo: { hasNextPage: !cursor, endCursor: cursor ? null : 'next' } } } } } }; }
      else if (path.endsWith('/pulls/1')) { pulls++; data = { head: { sha: fixture.moved && pulls >= 4 ? 'a'.repeat(40) : fixture.head } }; }
      else if (path.includes('/issues/1/comments')) data = fixture.comments;
      else if (path.endsWith('/reviews')) data = fixture.reviews;
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
  for (const body of [summary().replace(/^(\| 📝 \*\*Code Review\*\*.*)$/m, "```html\n$1\n````"), summary().replace("Manual request", "Do not merge"), summary().replace("Manual request", "Do not&nbsp;merge"), summary().replace("## Codex Review Summary", "    ## Codex Review Summary"), summary().replace("## Codex Review Summary", "\t## Codex Review Summary"), summary().replace("Manual request", "Do **not** merge"), "<!-- TODO -->\n<!-- codex-review-state:v1 {broken} -->", summary().replace(/^(\| 📝 \*\*Code Review\*\*.*)$/m, "```html\n$1\n```"), "\uFEFF" + summary().replace(/^<!--/, "    <!--"), "\uFEFF" + summary().replace(/^<!--/, "\t<!--"), summary().replaceAll("codex-", "CODEX-"), summary().replaceAll("codex-", "CoDeX-"), summary().replace(/^<!--/gm, "    <!--"), summary().replace(/^<!--/gm, "\t<!--"), summary().replace(/^(<!-- codex-review-state:)/m, "    $1"), summary().replace("state:v1", "state:v2"), summary().replace('"completed"', '"pending"'), summary().replace('"commit_sha":"', '"commit_sha":"f'), summary() + "\nP0: blocker", summary() + "\n**Reviewed commit:** `abcdef0123`", summary().replace('"status":"completed"', '"status":"completed","status":"completed"')]) {
    const invalid = { ...comment(body), id: 1 };
    assert.equal(run([clean, invalid]), "pending", body);
    assert.equal(run([invalid, clean]), "pending", body);
    assert.notEqual(runGate({ comments: [clean, invalid] }).status, 0, body);
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


test("a later completion supersedes an ambiguous same-second receipt edit", () => {
  const edited = { ...comment(receipt.replace(":rocket:", "Swish!")), id: 29, created_at: "2026-10-15T19:00:00Z", updated_at: requestedAt };
  const comments = [edited];
  assert.equal(evaluateCodexReviewEvidence(evidence({ comments })), "pending");
  comments.push(comment(summary()));
  assert.equal(evaluateCodexReviewEvidence(evidence({ comments })), "pass");
  assert.equal(runGate({ comments }).status, 0);
});


test("formal clean reviews supersede only strictly older pending comment evidence", () => {
  const reviews = [{ id: 200, commit_id: head, state: "COMMENTED", user: user, submitted_at: "2026-10-15T22:00:00Z" }];
  for (const body of [summary().replace('"completed"', '"running"'), summary().replace('"code_review":', '"code_review":broken')]) {
    for (const [updated_at, expected] of [["2026-10-15T21:30:00Z", "pass"], ["2026-10-15T22:00:00Z", "pending"], ["2026-10-15T23:00:00Z", "pending"]]) {
      const comments = [{ ...comment(body), updated_at }];
      assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews })), expected);
      assert.equal(runGate({ comments, reviews }).status, expected === "pass" ? 0 : 1);
    }
  }
  const comments = [comment(receipt + "\nExtra line.")];
  assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews })), "pending", "formal proof never hides malformed receipt envelopes");
});


test("formal code approval cannot clear explicit structured code or security findings", () => {
  const reviews = [{ id: 200, commit_id: head, state: "COMMENTED", user: user, submitted_at: "2026-10-15T23:00:00Z" }];
  for (const section of ["code_review", "security_review"]) {
    for (const field of ["has_any_findings", "has_unresolved_findings"]) {
      const body = (section === "security_review" ? withSecurityProof(summary()) : summary()).replace(new RegExp('("' + section + '":\\{[^}]*"' + field + '":)(?:false|null)'), '$1true');
      const negative = comment(body);
      const comments = [negative];
      assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews })), "pending", section + field);
      assert.equal(runGate({ comments, reviews }).status, 1);
      const laterReceipt = { ...comment(receipt), created_at: "2026-10-15T22:00:00Z", updated_at: "2026-10-15T22:00:00Z" };
      assert.equal(evaluateCodexReviewEvidence(evidence({ comments: [...comments, laterReceipt] })), "pending", "code receipt cannot revise explicit structured security/code findings");
      comments.push({ ...comment(summary().replace('"completed"', '"running"')), updated_at: "2026-10-15T22:00:00Z" });
      assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews })), "pending", "a later pending summary cannot clear findings either");
      comments.push({ ...comment((section === "security_review" ? withSecurityProof(summary()) : summary()).replaceAll(reviewedAt, "2026-10-15T22:30:00Z")), updated_at: "2026-10-15T22:30:00Z" });
      assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews })), "pass", "newer affirmative structured proof clears the previous finding");
    }
  }
});

function withSecurityProof(body) {
  const match = body.match(/codex-review-state:v1 (\{[^\r\n]*\}) -->/);
  const state = JSON.parse(match[1]);
  state.security_review = { ...state.code_review };
  const row = body.match(/^\| 📝 \*\*Code Review\*\*.*$/m)?.[0];
  return body.replace(match[1], JSON.stringify(state)).replace(row, row + "\n" + row.replace("📝 **Code Review**", "🛡️ **Security Review**"));
}


test("same-head repeated requests retain typed findings until matching newer machine proof", () => {
  const repeatedAt = "2026-10-15T22:00:00Z";

  const reviews = [{ id: 200, commit_id: head, state: "COMMENTED", user: user, submitted_at: "2026-10-15T23:00:00Z" }];
  const answer = { ...comment(receipt), created_at: "2026-10-15T23:00:00Z", updated_at: "2026-10-15T23:00:00Z" };
  for (const section of ["code_review", "security_review"]) {
    for (const field of ["has_any_findings", "has_unresolved_findings"]) {
      const source = section === "security_review" ? withSecurityProof(summary()) : summary();
      const body = source.replace(new RegExp('("' + section + '":\\{[^}]*"' + field + '":)(?:false|null)'), '$1true');
      const encodedNegative = body.match(/codex-review-state:v1 (\{[^\r\n]*\}) -->/)[1];
      for (const formattedBody of [body + "\nOrdinary **Code Review** presentation.", body + "\n> ```html\n> " + body.match(/^\| 📝.*$/m)[0] + "\n> ```", body.replace("## Codex Review Summary", "  ## Codex Review Summary"), body + "\n<!-- codex-review-state:v1 {} -->", body + "\n<!-- codex-unknown -->", body + "\n<!-- CODEX-unknown -->", body + "\n<!-- CoDeX-unknown -->", body + "\n> ```html\n> <!-- codex-review-state:v1 {} -->\n> ```", body + "\n> > ```html\n> > <!-- codex-review-state:v1 {} -->\n> > ```", body + "\n```html\n<!-- codex-review-state:v1 example -->\n```", body + "\n~~~html\n<!-- codex-pull-request-review-summary -->\n~~~", body + "\n    <!-- codex-review-state:v1 example -->", body + "\n\t<!-- codex-pull-request-review-summary -->", body + "\nThe codex-review-state: parser has a defect.", "<!-- TODO -->\n" + body, body.replace(encodedNegative, JSON.stringify(JSON.parse(encodedNegative), null, 2)), body + "\n<!-- TODO -->", body.replace("<!-- codex-review-state:", "<!-- TODO -->\n<!-- codex-review-state:")]) {
        const formatted = comment(formattedBody);
        assert.equal(runGate({ comments: [formatted, answer], reviews, requestAt: repeatedAt, requestCommentId: 100 }).status, 1);
        assert.equal(evaluateCodexReviewEvidence(evidence({ comments: [formatted, answer], reviews, requestMarker: { sourceCommentCreatedAt: repeatedAt, sourceCommentId: 100 } })), "pending", "valid typed historical findings survive JSON whitespace and unrelated HTML comments");
      }
      const comments = [comment(body), answer];
      assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews, requestMarker: { sourceCommentCreatedAt: repeatedAt, sourceCommentId: 100 } })), "pending", section + field);
      assert.equal(runGate({ comments, reviews, requestAt: repeatedAt, requestCommentId: 100 }).status, 1);
      const priorClean = { ...comment(withSecurityProof(summary()).replaceAll(reviewedAt, "2026-10-15T21:30:00Z")), updated_at: "2026-10-15T21:30:00Z" };
      assert.equal(evaluateCodexReviewEvidence(evidence({ comments: [comments[0], priorClean], requestMarker: { sourceCommentCreatedAt: repeatedAt, sourceCommentId: 100 } })), "pending", "historical clean proof alone cannot approve a new request");
      for (const contradiction of ["P1 regression", "Found issues.", "Security Review failed.", "<!-- CODEX-unknown -->", "<!-- CoDeX-unknown -->"]) {
        comments.push({ ...priorClean, body: priorClean.body.replace("## Codex Review Summary", "## Codex Review Summary\n" + contradiction) });
        assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews, requestMarker: { sourceCommentCreatedAt: repeatedAt, sourceCommentId: 100 } })), "pending", "contradictory historical presentation cannot clear findings");
        assert.equal(runGate({ comments, reviews, requestAt: repeatedAt, requestCommentId: 100 }).status, 1);
        comments.pop();
      }
      {
        const ownLabel = section === "code_review" ? "Code Review" : "Security Review";
        const fenced = priorClean.body.split("\n").map((line) => line.includes("**" + ownLabel + "**") ? "```html\n" + line + "\n```" : line).join("\n");
        comments.push({ ...priorClean, body: fenced });
        assert.equal(runGate({ comments, reviews, requestAt: repeatedAt, requestCommentId: 100 }).status, 1, "a fenced completion row cannot clear a finding");
        assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews, requestMarker: { sourceCommentCreatedAt: repeatedAt, sourceCommentId: 100 } })), "pending", "a fenced completion row cannot clear a finding");
        comments.pop();
        const mismatched = priorClean.body.split("\n").map((line) => line.includes("**" + ownLabel + "**") ? line.replace(/`[a-f0-9]{7,40}`/, "`fffffff`") : line).join("\n");
        comments.push({ ...priorClean, body: mismatched });
        assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews, requestMarker: { sourceCommentCreatedAt: repeatedAt, sourceCommentId: 100 } })), "pending", "own-section row SHA must match typed current head");
        assert.equal(runGate({ comments, reviews, requestAt: repeatedAt, requestCommentId: 100 }).status, 1);
        comments.pop();
      }
      comments.push(priorClean);
      assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews, requestMarker: { sourceCommentCreatedAt: repeatedAt, sourceCommentId: 100 } })), "pass", "a repeated request does not resurrect a finding already cleared before it");
      assert.equal(runGate({ comments, reviews, requestAt: repeatedAt, requestCommentId: 100 }).status, 0);
      comments.pop();
      {
        const encoded = priorClean.body.match(/codex-review-state:v1 (\{[^\r\n]*\}) -->/)[1];
        const state = JSON.parse(encoded);
        const other = section === "code_review" ? "security_review" : "code_review";
        state[other].has_any_findings = true;
        const label = other === "code_review" ? "Code Review" : "Security Review";
        const scoped = { ...priorClean, body: priorClean.body.replace(encoded, JSON.stringify(state)).split("\n").map((line) => line.includes("**" + label + "**") ? line.replace("Manual request", "Manual request P1") : line).join("\n") };
        const recoveryState = JSON.parse(encoded);
        recoveryState[section] = { commit_sha: null, has_any_findings: null, has_unresolved_findings: null, status: null };
        const ownLabel = section === "code_review" ? "Code Review" : "Security Review";
        const recovery = { ...priorClean, updated_at: "2026-10-15T21:45:00Z", body: priorClean.body.replace(encoded, JSON.stringify(recoveryState)).split("\n").filter((line) => !line.includes("**" + ownLabel + "**")).join("\n").replaceAll("2026-10-15T21:30:00Z", "2026-10-15T21:45:00Z") };
        comments.push(scoped, recovery);
        assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews, requestMarker: { sourceCommentCreatedAt: repeatedAt, sourceCommentId: 100 } })), "pass", "severity in a validated other-section row does not discard independent clearing");
        assert.equal(runGate({ comments, reviews, requestAt: repeatedAt, requestCommentId: 100 }).status, 0);
        comments.splice(-2);
      }
      for (const status of [null, "running"]) {
        const encoded = priorClean.body.match(/codex-review-state:v1 (\{[^\r\n]*\}) -->/)[1];
        const state = JSON.parse(encoded);
        const other = section === "code_review" ? "security_review" : "code_review";
        state[other] = { commit_sha: status ? state[other].commit_sha : null, has_any_findings: null, has_unresolved_findings: null, status };
        const label = other === "code_review" ? "Code Review" : "Security Review";
        const partial = { ...priorClean, body: priorClean.body.replace(encoded, JSON.stringify(state)).split("\n").filter((line) => !line.includes("**" + label + "**")).join("\n") };
        comments.push(partial);
        assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews, requestMarker: { sourceCommentCreatedAt: repeatedAt, sourceCommentId: 100 } })), "pass", "valid section-specific clearing survives a repeated request");
        assert.equal(runGate({ comments, reviews, requestAt: repeatedAt, requestCommentId: 100 }).status, 0);
        comments.pop();
        if (status === "running") {
          const staleCompletedRow = priorClean.body.split("\n").find((line) => line.includes("**" + label + "**"));
          comments.push({ ...partial, body: partial.body + "\n" + staleCompletedRow });
          assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews, requestMarker: { sourceCommentCreatedAt: repeatedAt, sourceCommentId: 100 } })), "pending", "typed running cannot clear through a stale completed companion row");
          assert.equal(runGate({ comments, reviews, requestAt: repeatedAt, requestCommentId: 100 }).status, 1);
          comments.pop();
          const runningRow = priorClean.body.split("\n").find((line) => line.includes("**" + label + "**")).replace("✅ **Completed** ", "🔄 **Running** since ");
          comments.push({ ...partial, body: partial.body + "\n" + runningRow });
          assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews, requestMarker: { sourceCommentCreatedAt: repeatedAt, sourceCommentId: 100 } })), "pass", "a canonical running companion row preserves independent clearing");
          assert.equal(runGate({ comments, reviews, requestAt: repeatedAt, requestCommentId: 100 }).status, 0);
          comments.pop();
        }
        const malformedOther = { ...partial, body: partial.body + "\n| " + (label === "Code Review" ? "📝" : "🛡️") + " **" + label + "** | ⚠️ Do not merge | `" + head.slice(0, 7) + "` | Manual request |" };
        const firstCellWarning = { ...malformedOther, body: malformedOther.body.replace("| " + (label === "Code Review" ? "📝" : "🛡️") + " **" + label + "**", "| ⚠️ Do not merge " + (label === "Code Review" ? "📝" : "🛡️") + " **" + label + "**") };
        comments.push(firstCellWarning);
        assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews, requestMarker: { sourceCommentCreatedAt: repeatedAt, sourceCommentId: 100 } })), "pending", "a warning before the companion label cannot be ignored");
        assert.equal(runGate({ comments, reviews, requestAt: repeatedAt, requestCommentId: 100 }).status, 1);
        comments.pop();
        comments.push(malformedOther);
        assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews, requestMarker: { sourceCommentCreatedAt: repeatedAt, sourceCommentId: 100 } })), "pending", "a noncanonical companion row cannot be discarded during clearing");
        assert.equal(runGate({ comments, reviews, requestAt: repeatedAt, requestCommentId: 100 }).status, 1);
        comments.pop();
      }
      comments.push({ ...comment(summary().replaceAll(reviewedAt, "2026-10-15T23:30:00Z")), updated_at: "2026-10-15T23:30:00Z" });
      assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews, requestMarker: { sourceCommentCreatedAt: repeatedAt, sourceCommentId: 100 } })), section === "security_review" ? "pending" : "pass", "null security is not security completion");
      if (section === "security_review") {
        for (const transform of [(body) => body.replace(/^\| 🛡️ \*\*Security Review\*\*.*$/m, ""), (body) => body.replace(/(🛡️ \*\*Security Review\*\*.*)/, (row) => row.replaceAll("2026-10-15T23:45:00Z", reviewedAt))]) {
          comments.push({ ...comment(transform(withSecurityProof(summary()).replaceAll(reviewedAt, "2026-10-15T23:45:00Z"))), updated_at: "2026-10-15T23:45:00Z" });
          assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews, requestMarker: { sourceCommentCreatedAt: repeatedAt, sourceCommentId: 100 } })), "pending", "missing or stale security completion cannot clear findings");
        }
      }
      comments.push({ ...comment(withSecurityProof(summary()).replaceAll(reviewedAt, "2026-10-16T00:00:00Z")), updated_at: "2026-10-16T00:00:00Z" });
      assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews, requestMarker: { sourceCommentCreatedAt: repeatedAt, sourceCommentId: 100 } })), "pass");
      assert.equal(runGate({ comments, reviews, requestAt: repeatedAt, requestCommentId: 100 }).status, 0);
      comments[0].updated_at = "2026-10-16T01:00:00Z";
      assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews, requestMarker: { sourceCommentCreatedAt: repeatedAt, sourceCommentId: 100 } })), "pass", "unrelated summary edits cannot renew an older section finding");
      for (const visibleNegative of ["Found P1 issues.", "Security review failed."]) {
        const edited = { ...comments[0], body: comments[0].body + "\n" + visibleNegative };
        assert.equal(runGate({ comments: [edited, ...comments.slice(1)], reviews, requestAt: repeatedAt, requestCommentId: 100 }).status, 1, "new visible negative evidence uses update time");
        const recovery = { ...comment(withSecurityProof(summary()).replaceAll(reviewedAt, "2026-10-16T02:00:00Z")), updated_at: "2026-10-16T02:00:00Z" };
        assert.equal(runGate({ comments: [edited, ...comments.slice(1), recovery], reviews, requestAt: repeatedAt, requestCommentId: 100 }).status, 0, "newer canonical completion clears edited explicit findings");
      }
      if (section === "code_review") {
        const original = comments[0].body;
        const encoded = original.match(/codex-review-state:v1 (\{[^\r\n]*\}) -->/)[1];
        const state = JSON.parse(encoded);
        state.security_review = { commit_sha: head, has_any_findings: null, has_unresolved_findings: null, status: "running" };
        comments[0].body = original.replace(encoded, JSON.stringify(state));
        assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews, requestMarker: { sourceCommentCreatedAt: repeatedAt, sourceCommentId: 100 } })), "pending", "new running security state retains update-time ordering");
        comments[0].body = original;
      }
      assert.equal(runGate({ comments, reviews, requestAt: repeatedAt, requestCommentId: 100 }).status, 0);
    }
  }
});

test("historical malformed and foreign-head state cannot become persistent finding vetoes", () => {
  const repeatedAt = "2026-10-15T22:00:00Z";

  const reviews = [{ id: 200, commit_id: head, state: "COMMENTED", user: user, submitted_at: "2026-10-15T23:00:00Z" }];
  const answer = { ...comment(receipt), created_at: "2026-10-15T23:00:00Z", updated_at: "2026-10-15T23:00:00Z" };
  const negative = summary().replace('"has_any_findings":false', '"has_any_findings":true');
  const securityNegative = withSecurityProof(summary()).replace(/("security_review":\{[^}]*"has_any_findings":)false/, "$1true");
  for (const body of [securityNegative.replace(/^\| 🛡️ \*\*Security Review\*\*.*$/m, ""), securityNegative.replace(/(🛡️ \*\*Security Review\*\*.*datetime=")[^"]+/, "$1invalid")]) {
    assert.equal(runGate({ comments: [comment(body), answer], reviews, requestAt: repeatedAt, requestCommentId: 100 }).status, 1, "typed negative retains authority with an invalid visual clock");
  }
  for (const body of ["\uFEFF" + negative.replace(/^<!--/, "    <!--"), "\uFEFF" + negative.replace(/^<!--/, "\t<!--"), negative.replace(/^<!--/gm, "    <!--"), negative.replace(/^<!--/gm, "\t<!--"), negative.replace(/^(<!-- codex-review-state:)/m, "    $1"), "```json\n" + negative + "\n```", negative.split("\n").map((line) => "> " + line).join("\n"), negative.replace('state:v1', 'state:v2'), negative.replace('"code_review":', '"code_review":broken'), negative.replace('"code_review":', '"code_review":{},"code_review":'), negative.replace("## Codex Review Summary", "<!-- codex-unknown -->\n## Codex Review Summary"), negative.replace("## Codex Review Summary", "<!-- CODEX-unknown -->\n## Codex Review Summary"), negative.replace("## Codex Review Summary", "<!-- CoDeX-unknown -->\n## Codex Review Summary"), negative.replaceAll(head, "f".repeat(40)).replaceAll(head.slice(0, 7), "f".repeat(7))]) {
    const comments = [comment(body), answer];
    assert.equal(evaluateCodexReviewEvidence(evidence({ comments, reviews, requestMarker: { sourceCommentCreatedAt: repeatedAt, sourceCommentId: 100 } })), "pass", body);
    assert.equal(runGate({ comments, reviews, requestAt: repeatedAt, requestCommentId: 100 }).status, 0);
  }
});

test("unrecognized case-variant receipts remain pending evidence", () => {
  for (const body of [receipt.toUpperCase(), receipt.replaceAll("Codex", "cOdEx").replaceAll("codex-", "CoDeX-")]) {
    const value = { ...comment(body), created_at: "2026-10-15T21:02:00Z", updated_at: "2026-10-15T21:02:00Z" };
    assert.equal(isAcceptableCodexSummaryComment(value, head, requestedAt, 30), false);
    assert.equal(evaluateCodexReviewEvidence(evidence({ comments: [comment(receipt), value] })), "pending");
    assert.equal(runGate({ comments: [comment(receipt), value] }).status, 1);
  }
});
