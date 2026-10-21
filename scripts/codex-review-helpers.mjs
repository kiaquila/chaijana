const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const CODEX_REVIEW_LOGIN = "chatgpt-codex-connector[bot]";

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function compareNumericIds(left, right) {
  if (!/^\d+$/.test(String(left || "")) || !/^\d+$/.test(String(right || ""))) return 0;
  const leftId = BigInt(left);
  const rightId = BigInt(right);
  return leftId === rightId ? 0 : leftId > rightId ? 1 : -1;
}

export function isStrictlyAfterCodexReviewRequest(value, requestMarker) {
  const valueTime = Date.parse(value || "");
  const requestedAt = Date.parse(
    requestMarker?.sourceCommentCreatedAt ||
    requestMarker?.requestedAt ||
    requestMarker?.commentCreatedAt ||
    ""
  );
  return Number.isFinite(valueTime) && Number.isFinite(requestedAt) && valueTime > requestedAt;
}

export function isTrustedAssociation(value) {
  return TRUSTED_ASSOCIATIONS.has(String(value || "").toUpperCase());
}

export function isCodexReviewCommand(body) {
  return /(?:^|\s)@codex\s+review\b/i.test(String(body || ""));
}

export function isCodexReviewCommandForHead(body, headSha) {
  const requestedHead = String(body || "").match(
    /(?:^|\s)@codex\s+review\s+`?([a-f0-9]{40})`?\b/i
  )?.[1];
  return Boolean(requestedHead) && normalize(requestedHead) === normalize(headSha);
}

export function isTrustedCodexLogin(login) {
  return normalize(login) === CODEX_REVIEW_LOGIN;
}

export function createCodexReviewRequestMarkerBody({
  headSha,
  requestId,
  sourceCommentId,
  sourceCommentCreatedAt,
  requestedAt
}) {
  const recordedAt = requestedAt || new Date().toISOString();
  return [
    `Codex review request recorded for \`${String(headSha || "").slice(0, 10)}\`.`,
    "",
    "<!-- web-design:codex-review-request",
    `CODEX_REVIEW_REQUEST_ID: ${requestId}`,
    `CODEX_REVIEW_SHA: ${headSha}`,
    `CODEX_REVIEW_SOURCE_COMMENT_ID: ${sourceCommentId}`,
    `CODEX_REVIEW_SOURCE_COMMENT_CREATED_AT: ${sourceCommentCreatedAt || recordedAt}`,
    `CODEX_REVIEW_REQUESTED_AT: ${recordedAt}`,
    "-->"
  ].join("\n");
}

export function extractCodexReviewRequestMarker(body) {
  const text = String(body || "");
  if (!text.includes("web-design:codex-review-request")) return null;

  const field = (name) =>
    text.match(new RegExp(`^${name}:\\s*(.+?)\\s*$`, "im"))?.[1]?.trim() || null;
  const requestId = field("CODEX_REVIEW_REQUEST_ID");
  const sha = field("CODEX_REVIEW_SHA");
  const sourceCommentId = field("CODEX_REVIEW_SOURCE_COMMENT_ID");
  const sourceCommentCreatedAt = field("CODEX_REVIEW_SOURCE_COMMENT_CREATED_AT");
  const requestedAt = field("CODEX_REVIEW_REQUESTED_AT");

  if (!requestId || !sha || !sourceCommentId || !requestedAt) return null;
  if (!/^[a-f0-9]{7,40}$/i.test(sha)) return null;

  return {
    requestId,
    sha,
    sourceCommentId,
    sourceCommentCreatedAt,
    requestedAt
  };
}

export function latestCodexReviewRequestMarker(comments = [], headSha) {
  return comments
    .map((comment) => {
      const marker = extractCodexReviewRequestMarker(comment?.body);
      if (!marker) return null;
      return {
        ...marker,
        commentId: String(comment.id || ""),
        commentCreatedAt: comment.created_at || null,
        author: normalize(comment.user?.login)
      };
    })
    .filter((marker) =>
      marker && marker.author === "github-actions[bot]" && marker.sha === headSha
    )
    .sort((left, right) => {
      const byRequestTime = Date.parse(right.sourceCommentCreatedAt || right.requestedAt || "") -
        Date.parse(left.sourceCommentCreatedAt || left.requestedAt || "");
      return byRequestTime || compareNumericIds(right.sourceCommentId, left.sourceCommentId);
    })[0] || null;
}

export function latestTrustedCodexReviewCommand(comments = [], timeline = [], headSha) {
  return comments
    .filter((comment) =>
      comment?.user?.type !== "Bot" &&
      isTrustedAssociation(comment?.author_association) &&
      isCodexReviewCommandForHead(comment?.body, headSha)
    )
    .sort((left, right) =>
      Date.parse(right.created_at || "") - Date.parse(left.created_at || "")
    )
    .map((comment) => ({
      requestId: `bootstrap-${comment.id}-${String(headSha).slice(0, 12)}`,
      sha: headSha,
      sourceCommentId: String(comment.id || ""),
      sourceCommentCreatedAt: comment.created_at,
      requestedAt: comment.created_at,
      commentCreatedAt: comment.created_at,
      bootstrap: true
    }))[0] || null;
}

export function extractCodexPriority(body) {
  const match = String(body || "").match(/\bP([0-3])\b/i);
  return match ? Number(match[1]) : null;
}

export function containsBlockingCodexSeverity(body) {
  return /\bP[0-2]\b/i.test(String(body || ""));
}

export function classifyCodexNativeReview(review, reviewComments = [], headSha) {
  if (!review || review.commit_id !== headSha) return null;
  if (!isTrustedCodexLogin(review.user?.login)) return null;
  if (containsBlockingCodexSeverity(review.body)) return "fail";
  if (review.state === "CHANGES_REQUESTED") return "fail";

  const commentsForReview = reviewComments.filter((comment) =>
    comment.pull_request_review_id === review.id &&
    isTrustedCodexLogin(comment.user?.login)
  );
  if (commentsForReview.length > 0) {
    const priorities = commentsForReview.map((comment) => extractCodexPriority(comment.body));
    if (priorities.some((priority) => priority === null)) return "fail";
    if (commentsForReview.some((comment) => containsBlockingCodexSeverity(comment.body))) return "fail";
  }

  return review.state === "APPROVED" || review.state === "COMMENTED" ? "pass" : null;
}

export function latestCodexNativeReviewResult(reviews = [], reviewComments = [], headSha) {
  return reviews
    .map((review) => ({
      review,
      result: classifyCodexNativeReview(review, reviewComments, headSha)
    }))
    .filter((entry) => entry.result !== null)
    .sort((left, right) => {
      const bySubmissionTime = Date.parse(right.review.submitted_at || "") -
        Date.parse(left.review.submitted_at || "");
      return bySubmissionTime || compareNumericIds(right.review.id, left.review.id);
    })[0]?.result || null;
}

// Routing is deliberately broader than evidence validation: a negative or pending
// update must wake the gate too, but can never grant a passing verdict.
export function isCodexReviewSignal(body) {
  return /^(?:Codex Review:|<!-- codex-review-receipt:v1 -->|<!-- codex-pull-request-review-summary -->)/i
    .test(String(body || ""));
}

function hasConflictingCodexVerdict(body) {
  return /\b(?:found (?:any )?(?:issues|findings)|changes requested|needs? changes|unresolved findings|review (?:pending|in progress|failed)|issues? remain|not (?:approved|clean)|cannot approve|but|however|except|critical|blocker|regression|bugs?)\b/i.test(body);
}

function isCommentAfterRequest(comment, requestedAt, sourceCommentId) {
  if (!requestedAt) return true;
  const created = Date.parse(comment?.created_at || "");
  const requested = Date.parse(requestedAt);
  if (!Number.isFinite(requested)) return false;
  return Number.isFinite(created) && (created > requested ||
    (created === requested && compareNumericIds(comment?.id, sourceCommentId) > 0));
}

export function isAcceptableCodexSummaryComment(comment, headSha, requestedAt, sourceCommentId) {
  const body = String(comment?.body || "");
  if (!isTrustedCodexLogin(comment?.user?.login) ||
      !/^[a-f0-9]{40}$/.test(String(headSha || "")) ||
      !isCommentAfterRequest(comment, requestedAt, sourceCommentId) ||
      containsBlockingCodexSeverity(body) || hasConflictingCodexVerdict(body)) return false;
  // Codex uses a small set of presentation-only sign-offs after the stable
  // clean verdict. Keep that set explicit; the receipt marker is optional,
  // unique, and must precede the verdict.
  const match = body.trim().match(/^(?:<!-- codex-review-receipt:v1 -->\s*)?Codex Review: Didn't find any major issues\.(?: :rocket:| 🚀| :\+1:| Keep it up!| Chef['’]s kiss\.| Keep them coming!| Nice work!| Another round soon, please!| Breezy!| What shall we delve into next\?| Can't wait for the next one!| You're on a roll\.| You’re on a roll\.| Already looking forward to the next diff\.)?\s+\*\*Reviewed commit:\*\*\s*`([a-f0-9]{10}|[a-f0-9]{40})`(?:\s*<details>\s*<summary>[^<]*About Codex in GitHub<\/summary>[\s\S]*<\/details>)?$/);
  return Boolean(match) &&
    (match[1] === headSha || match[1] === headSha.slice(0, 10)) &&
    (body.match(/Codex Review:/g) || []).length === 1 &&
    (body.match(/\*\*Reviewed commit:/g) || []).length === 1 &&
    (body.match(/<!--/g) || []).length === (body.startsWith("<!-- codex-review-receipt:v1 -->") ? 1 : 0);
}

function codeReviewCompletedAt(body, headSha, section = "code_review") {
  if (section === "security_review") body = body.replaceAll("📝 **Code Review**", "ignored-code-row").replaceAll("🛡️ **Security Review**", "📝 **Code Review**");
  const rows = [...body.matchAll(/^\| 📝 \*\*Code Review\*\* \| ✅ \*\*Completed\*\* <relative-time datetime="([^"]+)">([^<]+)<\/relative-time> \| `([a-f0-9]{7,40})` \| [^|\r\n]+ \|$/gm)];
  if (rows.length !== 1 || (body.match(/\*\*Code Review\*\*/g) || []).length !== 1) return NaN;
  const [, timestamp, visibleTime, sha] = rows[0];
  if (timestamp !== visibleTime || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(timestamp) || !headSha.startsWith(sha)) return NaN;
  const completed = Date.parse(timestamp);
  return Number.isFinite(completed) && new Date(completed).toISOString().slice(0, 19) === timestamp.slice(0, 19) ? completed : NaN;
}

/** Affirmative machine evidence has a closed schema and the full current SHA.
 * Prose, reactions and the visible Completed heading never grant approval. */
export function isAffirmativeCodexReviewState(comment, headSha, requestedAt, requestCommentId) {
  if (!isTrustedCodexLogin(comment?.user?.login) || !/^[a-f0-9]{40}$/.test(headSha)) return false;
  const body = String(comment?.body || "").trim();
  const match = body.match(/^<!-- codex-pull-request-review-summary -->\s*<!-- codex-review-state:v1 (\{[^\r\n]*\}) -->/);
  if (!match || (body.match(/<!--/g) || []).length !== 2 ||
      (body.match(/codex-review-state:/g) || []).length !== 1 ||
      (body.match(/codex-pull-request-review-summary/g) || []).length !== 1 ||
      /Codex Review:|\*\*Reviewed commit:|\bP[0-2]\b/i.test(body)) return false;
  const presentation = body.slice(match[0].length).replace(/\s*<details>\s*<summary>ℹ️ About Codex in GitHub<\/summary>[\s\S]*<\/details>\s*$/, "");
  if (!/^\s*## Codex Review Summary\b/.test(presentation) ||
      /<details>|<summary>|\b(?:found|unresolved|issues?|findings?|failed|failure|running|pending|cancelled|incomplete|in.progress|not.completed|changes.requested|security.concerns?)\b/i.test(presentation)) return false;
  if ([...presentation.matchAll(/\b[a-f0-9]{7,40}\b/gi)].some(([sha]) => !headSha.startsWith(sha))) return false;
  const observed = Date.parse(comment.updated_at || comment.created_at || "");
  const requested = Date.parse(requestedAt || "");
  const completed = codeReviewCompletedAt(body, headSha);
  if (!Number.isFinite(completed) || Math.floor(completed / 1000) <= Math.floor(requested / 1000) || completed >= observed + 1000 ||
      !Number.isFinite(observed) || !Number.isFinite(requested) ||
      !(observed > requested || (observed === requested && compareNumericIds(comment.id, requestCommentId) > 0))) return false;
  try {
    const state = JSON.parse(match[1]);
    const keys = Object.keys(state);
    if (keys.length !== 2 || !keys.includes("code_review") || !keys.includes("security_review")) return false;
    // Count decoded property names as well: JSON.parse alone accepts duplicate
    // keys, including keys escaped with Unicode sequences.
    const names = [...match[1].matchAll(/("(?:\\.|[^"\\])*")\s*:/g)].map((entry) => JSON.parse(entry[1]));
    const expected = { code_review: 1, security_review: 1, commit_sha: 2, has_any_findings: 2, has_unresolved_findings: 2, status: 2 };
    if (names.length !== 10 || Object.entries(expected).some(([key, count]) => names.filter((name) => name === key).length !== count)) return false;
    const closed = (value) => value && !Array.isArray(value) && Object.keys(value).length === 4 &&
      ["commit_sha", "has_any_findings", "has_unresolved_findings", "status"].every((key) => Object.hasOwn(value, key));
    const complete = (value) => closed(value) && value.commit_sha === headSha && value.status === "completed" &&
      value.has_any_findings === false && value.has_unresolved_findings === false;
    const absent = (value) => closed(value) && Object.values(value).every((entry) => entry === null);
    return complete(state.code_review) && (absent(state.security_review) || complete(state.security_review));
  } catch { return false; }
}

// Historical findings must be well-formed typed state for this exact head;
// stale malformed/foreign-head summaries are not persistent vetoes.
function typedCodexReviewState(comment) {
  const body = String(comment.body || "").trim();
  const match = body.match(/<!-- codex-review-state:v1 (\{[\s\S]*?\}) -->/);
  const protocol = [...body.matchAll(/<!--([\s\S]*?)-->/g)].filter((entry) => /^codex[-:]/.test(entry[1].trim()));
  if (!match || protocol.length !== 2 ||
      (body.match(/<!-- codex-pull-request-review-summary -->/g) || []).length !== 1 ||
      (body.match(/codex-review-state:/g) || []).length !== 1 ||
      !/^## Codex Review Summary\b/m.test(body) ||
      /Codex Review:|\*\*Reviewed commit:/.test(body)) return null;
  try {
    const state = JSON.parse(match[1]);
    const names = [...match[1].matchAll(/("(?:\\.|[^"\\])*")\s*:/g)].map((entry) => JSON.parse(entry[1]));
    const expected = { code_review: 1, security_review: 1, commit_sha: 2, has_any_findings: 2, has_unresolved_findings: 2, status: 2 };
    if (names.length !== 10 || Object.entries(expected).some(([key, count]) => names.filter((name) => name === key).length !== count) ||
        Object.keys(state).length !== 2) return null;
    const valid = (value) => value && !Array.isArray(value) && Object.keys(value).length === 4 &&
      ["commit_sha", "has_any_findings", "has_unresolved_findings", "status"].every((key) => Object.hasOwn(value, key)) &&
      (Object.values(value).every((entry) => entry === null) ||
        (/^[a-f0-9]{40}$/.test(value.commit_sha) &&
          ((value.status === "completed" && typeof value.has_any_findings === "boolean" && typeof value.has_unresolved_findings === "boolean") ||
           (value.status === "running" && value.has_any_findings === null && value.has_unresolved_findings === null))));
    if (!valid(state.code_review) || !valid(state.security_review)) return null;
    for (const section of ["code_review", "security_review"]) {
      if (state[section].status !== "completed") continue;
      const completed = codeReviewCompletedAt(body, state[section].commit_sha, section);
      const observed = Date.parse(comment.updated_at || comment.created_at || "");
      if (!Number.isFinite(completed) || !Number.isFinite(observed) || completed >= observed + 1000) return null;
    }
    return state;
  } catch { return null; }
}

// Validate a section's clearing proof with the same presentation checks as
// approval, while allowing an independently pending/absent other section.
function isSectionClearingState(comment, section, headSha) {
  const state = typedCodexReviewState(comment);
  const body = String(comment.body || "");
  if (!state) return false;
  const encodedMatch = body.match(/codex-review-state:v1 (\{[^\r\n]*\}) -->/);
  if (!encodedMatch) return false;
  const encoded = encodedMatch[1];
  const absent = { commit_sha: null, has_any_findings: null, has_unresolved_findings: null, status: null };
  const other = section === "code_review" ? "Security Review" : "Code Review";
  const otherSection = section === "code_review" ? "security_review" : "code_review";
  const otherPrefix = "| " + (other === "Code Review" ? "📝" : "🛡️") + " **" + other + "** | ";
  // Only a unique validated completed counterpart row scopes its severity.
  // Global prose and unvalidated rows remain ambiguous vetoes.
  const severityBody = state[otherSection].status === "completed"
    ? body.split("\n").filter((line) => !line.startsWith(otherPrefix)).join("\n") : body;
  if (/\bP[0-2]\b/i.test(severityBody)) return false;
  let normalized = body.replace(encoded, JSON.stringify({ code_review: state[section], security_review: absent }))
    .split("\n").filter((line) => !line.startsWith("| " + (other === "Code Review" ? "📝" : "🛡️") + " **" + other + "** | ")).join("\n");
  if (section === "security_review") normalized = normalized.replaceAll("🛡️ **Security Review**", "📝 **Code Review**");
  return isAffirmativeCodexReviewState({ ...comment, body: normalized }, headSha, "1970-01-01T00:00:00Z", 0);
}

function findingCompletedAt(comment, section, headSha) {
  const completed = codeReviewCompletedAt(String(comment.body || ""), headSha, section);
  const observed = Date.parse(comment.updated_at || comment.created_at || "");
  return Number.isFinite(completed) && completed <= observed + 999 ? completed : observed;
}

function latestCodexCommentResult(comments, headSha, requestedAt, requestCommentId, nativeCompletedAt = NaN) {
  const signals = comments.filter((comment) => isTrustedCodexLogin(comment?.user?.login));
  const summaries = signals.filter((comment) => /codex-pull-request-review-summary|codex-review-state:/.test(String(comment.body || "")) &&
    Date.parse(comment.updated_at || comment.created_at || "") >= Date.parse(requestedAt || ""));
  summaries.sort((a, b) => (Date.parse(b.updated_at || b.created_at || "") || 0) -
    (Date.parse(a.updated_at || a.created_at || "") || 0) || compareNumericIds(b.id, a.id));
  const receiptObservedAt = (comment) => Date.parse(isAcceptableCodexSummaryComment(comment, headSha)
    ? comment.created_at || "" : comment.updated_at || comment.created_at || "");
  const receipts = signals.filter((comment) => /Codex Review:|codex-review-receipt:/.test(String(comment.body || "")) &&
    (isAcceptableCodexSummaryComment(comment, headSha)
      ? isAcceptableCodexSummaryComment(comment, headSha, requestedAt, requestCommentId)
      : receiptObservedAt(comment) >= Date.parse(requestedAt || "")));
  const isReceiptCandidate = (comment) => {
    const body = String(comment.body || "");
    const match = body.match(/(Codex Review: Didn't find any major issues\.)([^\r\n]*)/);
    if (!match || (match[2] && !match[2].startsWith(" ")) || match[2].length > 121 ||
        (body.match(/Codex Review:/g) || []).length !== 1 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>{}\[\]`*=\\/|]/u.test(match[2]) ||
        /\b[a-f0-9]{7,40}\b/i.test(match[2]) || containsBlockingCodexSeverity(body)) return false;
    return isAcceptableCodexSummaryComment({ ...comment, body: body.replace(match[0], match[1]) }, headSha);
  };
  // Unknown closings remain pending evidence. Only a strictly newer complete
  // machine summary supersedes one; a later receipt needs a fresh summary.
  // Malformed envelopes and explicit P0-P2 findings remain unconditional vetoes.
  if (receipts.some((comment) => !isAcceptableCodexSummaryComment(comment, headSha, requestedAt, requestCommentId) && !isReceiptCandidate(comment))) return "pending";
  const candidates = [...summaries, ...receipts];
  const observed = (comment) => {
    const state = typedCodexReviewState(comment);
    const findings = ["code_review", "security_review"].filter((section) => state?.[section]?.commit_sha === headSha &&
      (state[section].has_any_findings === true || state[section].has_unresolved_findings === true));
    if (findings.length && ![state.code_review, state.security_review].some((value) => value.status === "running")) return Math.max(...findings.map((section) => findingCompletedAt(comment, section, headSha)));
    return summaries.includes(comment) &&
    isAffirmativeCodexReviewState(comment, headSha, requestedAt, requestCommentId)
    ? codeReviewCompletedAt(String(comment.body || ""), headSha)
    : summaries.includes(comment) ? Date.parse(comment.updated_at || comment.created_at || "") : receiptObservedAt(comment);
  };
  // Positive receipt edits never renew approval. Unknown or negative edits
  // retain their update time so they can invalidate an older completion.
  // GitHub comment timestamps have second precision while completion rows
  // include microseconds. Compare second buckets so uncertainty stays pending.
  const bucket = (comment) => Math.floor(observed(comment) / 1000);
  const latestTime = Math.max(...candidates.map(bucket));
  // A strictly newer formal clean review is independent affirmative evidence.
  // Same-second ambiguity and newer pending comments still prevent approval.
  const sections = ["code_review", "security_review"];
  // Historical clean proof only resolves historical findings; it cannot grant
  // current-request approval, which still uses candidates above.
  const cleanSummaries = signals.filter((comment) => typedCodexReviewState(comment));
  const lastAffirmativeTime = (section) => Math.max(...cleanSummaries.filter((comment) => {
    const value = typedCodexReviewState(comment)?.[section];
    return value?.commit_sha === headSha && value.status === "completed" &&
      value.has_any_findings === false && value.has_unresolved_findings === false &&
      isSectionClearingState(comment, section, headSha);
  }).map((comment) => {
    const completed = codeReviewCompletedAt(String(comment.body || ""), headSha, section);
    const observed = Date.parse(comment.updated_at || comment.created_at || "");
    return Number.isFinite(completed) && completed <= observed + 999 ? Math.floor(completed / 1000) : -Infinity;
  }));
  const historical = signals.filter((comment) => {
    const state = typedCodexReviewState(comment);
    return sections.some((section) => state?.[section]?.commit_sha === headSha &&
      (state[section].has_any_findings === true || state[section].has_unresolved_findings === true));
  });
  const findingSignals = [...new Set([...summaries, ...historical])];
  const unclearedFindings = findingSignals.some((comment) => {
    const state = typedCodexReviewState(comment);
    const observedBucket = Math.floor(Date.parse(comment.updated_at || comment.created_at || "") / 1000);
    if (state) return sections.some((section) => state[section].commit_sha === headSha &&
      (state[section].has_any_findings === true || state[section].has_unresolved_findings === true) &&
      Math.floor(findingCompletedAt(comment, section, headSha) / 1000) >= lastAffirmativeTime(section));
    // Malformed current-request negative evidence retains its existing veto.
    return summaries.includes(comment) && observedBucket >= Math.max(...summaries.filter((entry) => isAffirmativeCodexReviewState(entry, headSha, requestedAt, requestCommentId)).map(bucket)) &&
      [...String(comment.body || "").matchAll(/("(?:\\.|[^"\\])*")\s*:\s*(true|false|null)/g)].some((entry) => {
        if (entry[2] !== "true") return false;
        try { return ["has_any_findings", "has_unresolved_findings"].includes(JSON.parse(entry[1])); }
        catch { return true; }
      });
  });
  // Code-only formal approval cannot revise an explicit code/security finding.
  // Only a newer affirmative structured state clears that independent signal.
  if (unclearedFindings) return "pending";
  if (!candidates.length) return null;
  if (Math.floor(nativeCompletedAt / 1000) > latestTime) return "pass";
  const latest = candidates.filter((comment) => bucket(comment) === latestTime);
  return latest.every((comment) => summaries.includes(comment)
    ? isAffirmativeCodexReviewState(comment, headSha, requestedAt, requestCommentId)
    : isAcceptableCodexSummaryComment(comment, headSha, requestedAt, requestCommentId)) ? "pass" : "pending";
}

export function evaluateCodexReviewEvidence({ comments, reviews, reviewComments, threads, headSha, requestMarker }) {
  // Findings survive a new request marker, including findings on earlier heads.
  if (threads.some((thread) => !thread.isResolved)) return "fail";
  if (latestCodexNativeReviewResult(reviews, reviewComments, headSha) === "fail") return "fail";
  const native = latestCodexNativeReviewResult(reviews.filter((review) =>
    isStrictlyAfterCodexReviewRequest(review.submitted_at, requestMarker)
  ), reviewComments, headSha);
  if (native === "fail") return native;
  const nativeCompletedAt = native === "pass" ? Math.max(...reviews.filter((review) =>
    isStrictlyAfterCodexReviewRequest(review.submitted_at, requestMarker) &&
    classifyCodexNativeReview(review, reviewComments, headSha) === "pass"
  ).map((review) => Date.parse(review.submitted_at || ""))) : NaN;
  const commentResult = latestCodexCommentResult(comments, headSha,
    requestMarker.sourceCommentCreatedAt || requestMarker.requestedAt || requestMarker.commentCreatedAt,
    requestMarker.sourceCommentId, nativeCompletedAt);
  return commentResult === "pending" ? "pending" : native || commentResult || "pending";
}
