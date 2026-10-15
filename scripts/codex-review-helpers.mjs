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
  return /\b(?:found (?:any )?(?:issues|findings)|changes requested|unresolved findings|review (?:pending|in progress|failed))\b/i.test(body);
}

function isCommentAfterRequest(comment, requestedAt, sourceCommentId, allowEdit = false) {
  if (!requestedAt) return true;
  const created = Date.parse(comment?.created_at || "");
  const updated = Date.parse(comment?.updated_at || "");
  const requested = Date.parse(requestedAt);
  if (!Number.isFinite(requested)) return false;
  if (allowEdit && Number.isFinite(updated) && updated > created && updated > requested) return true;
  return Number.isFinite(created) && (created > requested ||
    (created === requested && compareNumericIds(comment?.id, sourceCommentId) > 0));
}

export function codexStructuredSummaryResult(comment, headSha, requestedAt, sourceCommentId) {
  const body = String(comment?.body || "");
  if (!isTrustedCodexLogin(comment?.user?.login) ||
      !/^[a-f0-9]{40}$/.test(String(headSha || "")) ||
      !body.startsWith("<!-- codex-pull-request-review-summary -->")) return null;
  const matches = [...body.matchAll(/<!-- codex-review-state:v1 ([^\n]*?) -->/g)];
  if (matches.length !== 1 ||
      (body.match(/codex-review-state:/g) || []).length !== 1 ||
      (body.match(/codex-pull-request-review-summary/g) || []).length !== 1 ||
      /codex-review-receipt:|^Codex Review:|\*\*Reviewed commit:/m.test(body)) return null;
  let state;
  try { state = JSON.parse(matches[0][1]); } catch { return null; }
  const keysAre = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
  const fields = ["commit_sha", "has_any_findings", "has_unresolved_findings", "status"];
  if (!keysAre(state, ["code_review", "security_review"])) return null;
  // JSON.parse keeps only the last duplicate property; reject duplicates before
  // treating that parsed object as evidence.
  for (const key of ["code_review", "security_review", ...fields]) {
    const count = [...matches[0][1].matchAll(new RegExp(`"${key}"\\s*:`, "g"))].length;
    if (count !== (fields.includes(key) ? 2 : 1)) return null;
  }
  for (const value of Object.values(state)) {
    if (!keysAre(value, fields) ||
        !(value.commit_sha === null || /^[a-f0-9]{40}$/.test(value.commit_sha)) ||
        ![null, true, false].includes(value.has_any_findings) ||
        ![null, true, false].includes(value.has_unresolved_findings) ||
        ![null, "pending", "queued", "in_progress", "completed", "failed", "cancelled"].includes(value.status)) return null;
  }
  // Visible commit references must agree with the machine verdict too.
  const visible = body.replace(matches[0][0], "");
  if ([...visible.matchAll(/`([a-f0-9]{7,40})`/g)].some((match) => !headSha.startsWith(match[1])) ||
      /(?:❌|⚠️|\*\*(?:Failed|In progress|Pending|Cancelled)\*\*)/i.test(visible)) return null;
  const code = state.code_review;
  const security = state.security_review;
  if (code.commit_sha !== headSha) return null;
  if (code.has_any_findings === true || code.has_unresolved_findings === true ||
      containsBlockingCodexSeverity(body) || hasConflictingCodexVerdict(visible)) return "fail";
  const securityAbsent = Object.values(security).every((value) => value === null);
  if (!securityAbsent && security.commit_sha !== headSha) return null;
  if (!securityAbsent && (security.has_any_findings === true || security.has_unresolved_findings === true)) return "fail";
  const clear = (value) => value.status === "completed" &&
    value.has_any_findings === false && value.has_unresolved_findings === false;
  if (!clear(code) || (!securityAbsent && !clear(security))) return "pending";
  return isCommentAfterRequest(comment, requestedAt, sourceCommentId, true) ? "pass" : null;
}

export function isAcceptableCodexSummaryComment(comment, headSha, requestedAt, sourceCommentId) {
  const body = String(comment?.body || "");
  if (!isTrustedCodexLogin(comment?.user?.login) ||
      !/^[a-f0-9]{40}$/.test(String(headSha || "")) ||
      !isCommentAfterRequest(comment, requestedAt, sourceCommentId) ||
      containsBlockingCodexSeverity(body) || hasConflictingCodexVerdict(body)) return false;
  // Preserve the native legacy sentence and optional informational details. The
  // receipt marker is optional, unique, and must precede the verdict.
  const match = body.trim().match(/^(?:<!-- codex-review-receipt:v1 -->\s*)?Codex Review: Didn't find any major issues\.(?: :rocket:| 🚀| Keep it up!)?\s+\*\*Reviewed commit:\*\*\s*`([a-f0-9]{10}|[a-f0-9]{40})`(?:\s*<details>\s*<summary>[^<]*About Codex in GitHub<\/summary>[\s\S]*<\/details>)?$/);
  return Boolean(match) &&
    (match[1] === headSha || match[1] === headSha.slice(0, 10)) &&
    (body.match(/Codex Review:/g) || []).length === 1 &&
    (body.match(/\*\*Reviewed commit:/g) || []).length === 1 &&
    (body.match(/<!--/g) || []).length === (body.startsWith("<!-- codex-review-receipt:v1 -->") ? 1 : 0);
}

export function evaluateCodexReviewEvidence({ comments, reviews, reviewComments, threads, headSha, requestMarker }) {
  // Findings survive a new request marker, including findings on earlier heads.
  if (threads.some((thread) => !thread.isResolved)) return "fail";
  if (latestCodexNativeReviewResult(reviews, reviewComments, headSha) === "fail") return "fail";
  const requestedAt = requestMarker.sourceCommentCreatedAt || requestMarker.requestedAt || requestMarker.commentCreatedAt;
  const structured = comments.map((comment) => codexStructuredSummaryResult(
    comment, headSha, requestedAt, requestMarker.sourceCommentId
  ));
  if (structured.includes("fail")) return "fail";
  if (structured.includes("pending")) return "pending";
  const native = latestCodexNativeReviewResult(reviews.filter((review) =>
    isStrictlyAfterCodexReviewRequest(review.submitted_at, requestMarker)
  ), reviewComments, headSha);
  if (native) return native;
  return structured.includes("pass") || comments.some((comment) => isAcceptableCodexSummaryComment(
    comment, headSha, requestedAt, requestMarker.sourceCommentId
  )) ? "pass" : "pending";
}
