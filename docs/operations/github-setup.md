# GitHub repository setup

The workflows are in this repository; repository settings still require an
owner with GitHub administration access.

1. Keep `main` as the default branch and enable automatic head-branch deletion.
2. Configure the Codex repository application, then request a review for the
   current full pull-request head SHA with a `@codex review <sha>` comment.
3. Restrict the `codex-review-dispatch` environment's deployment branches to
   the default branch. The dispatch job in
   `.github/workflows/codex-review.yml` holds `checks: write`, and its `if`
   condition cannot enforce itself: a manual run selects a ref and GitHub loads
   that ref's copy of the workflow, so a branch could delete the condition and
   mint a passing `Codex Review` check. GitHub creates the environment on the
   job's first run; creating it is not the control — opening it and restricting
   its branches is.
4. When the repository plan supports it, protect `main` with pull requests,
   required Code Owner review, conversation resolution, no force pushes, no
   branch deletion, and stale approval dismissal. Required Code Owner review is
   what `.github/CODEOWNERS` is for: the repository guard runs from the proposed
   pull-request tree, so without it a pull request could weaken its own check.
   It owns `*` rather than a list of paths, because enumerating them has no
   stopping point — a workflow calls scripts, scripts are named by manifests,
   manifests dispatch build and test files, and at every step an unowned file
   could turn a required check into a no-op. The guard jobs additionally invoke
   `node scripts/check-repository.mjs` and `node --test tests/*.test.mjs`
   directly rather than through `npm run`, so a rewritten script name cannot do
   it either.

   **With a single owner, required Code Owner review cannot be satisfied**: a
   code owner's approval does not count on their own pull request, so enabling
   it here would block every pull request rather than gate it. Enable it when
   there is a second reviewer; until then the manual completion contract at the
   end of this document is the control, and it should be recorded as such
   rather than described as enforced.
5. Require these check names once each has run at least once:
   `project-ci`, `repository-guard`, `osv-scan`, `Codex Review`, and
   `Workers Builds: chaijana`. Do not register a required check before it has
   run.
6. Enable dependency alerts, secret scanning, and push protection. Dependabot
   is configured in `.github/dependabot.yml`, with per-ecosystem cooldowns —
   `github-actions` accepts only `default-days`, while `npm` also takes the
   `semver-*-days` keys.
7. Keep deployment secrets in Cloudflare's environment-scoped store. Nothing in
   this repository needs a GitHub Actions secret: every workflow runs on
   `github.token`.

Some repository plans do not expose branch protection or rulesets and may return
`403` from their APIs. Record the missing control instead of claiming it is
active. `main` is currently unprotected and no ruleset exists.

While enforced protection is unavailable, the owner applies the completion
contract manually before every merge: record the exact full head SHA; confirm
every contractual check is successful on that same head; confirm every P0–P2
review finding is resolved; then observe a quiet period and fetch the pull
request again. Immediately before merging, recheck that the head SHA is
unchanged, the same checks are still green, and no unresolved P0–P2 thread or
newer blocking review has appeared. This is a mandatory fallback, not a claim
that the branch is technically protected.

## Native review evidence and requeue

The gate accepts native formal reviews, legacy no-findings comments, version 1
receipt comments, and version 1 structured review summaries from
`chatgpt-codex-connector[bot]`. A receipt must retain the explicit no-major-issues
sentence and the exact native ten-character head prefix (or full head). Only
observed positive receipt sign-offs are accepted; unknown or contradictory prose
fails closed, while a valid full-head structured summary can independently
prove completion. A
structured summary must contain exactly one state marker with the complete
schema, the current full commit SHA, `completed` status, and explicit `false`
findings flags. An absent security review has all four fields set to `null`;
an active security review must also complete cleanly for the same head.
Malformed, duplicate, contradictory, pending, stale, and impersonated evidence
cannot grant success. Reactions and a visible `Completed` label are not evidence.

A structured summary may predate the request: its `updated_at` must then be
strictly later than both creation and the request. Receipt edits do not refresh
short-SHA evidence. Non-final structured activity must also follow the latest
request or a later edit; an abandoned pending/failed/cancelled summary cannot
veto newer qualifying evidence. Explicit findings still survive a new request.
All unresolved review threads block success, including
threads on earlier heads. A new request cannot discard a current-head negative
formal review. P0–P2 findings continue to block; formal P3-only reviews retain
their existing treatment once their threads are resolved.

Both `created` and `edited` native comment events wake the trusted default-branch
rerun policy, including negative and pending updates. The job serializes events
for a PR, waits for active gates with a finite timeout, checks the live PR head
before requeue, and avoids requeue when a later-started run already evaluated
the event. The gate checks the head again after fetching evidence so a dispatch
cannot publish success after a concurrent push.

When installing this routing update, the proposed scripts are not yet trusted.
After a real native receipt or formal review arrives for the exact PR head,
rerun its existing `pull_request` Codex Review workflow through the normal
Actions rerun API/CLI if the old comment filter did not wake it. That workflow
still executes the default-branch gate, whose parser already accepts native
receipt prefixes. This preserves the trust boundary and produces a genuine
review-backed result for the installation PR; it does not execute proposed
scripts with write permission, fabricate a check, or require changing settings.
After merge, comment events use the updated default-branch routing automatically.
