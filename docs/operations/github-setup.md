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

The gate accepts native formal reviews, legacy no-findings comments, and version 1
receipt comments from `chatgpt-codex-connector[bot]`. A receipt must retain the
explicit no-major-issues sentence and the exact native ten-character head prefix
(or full head). Only observed positive receipt sign-offs are accepted, including
ASCII and typographic apostrophes; unknown or contradictory prose fails closed.
Malformed, duplicate, stale, and impersonated receipts cannot grant success.

Structured summaries also provide independent machine evidence under a closed
version 1 schema. Only the official bot's full-current-head `code_review` with
`status: "completed"` and both finding flags exactly `false` is affirmative.
`security_review` must either be entirely `null` or satisfy the same exact-head
completed/false/false contract. Both objects and their four fields are required;
extra fields, duplicate keys, malformed JSON, unknown markers and versions fail
closed. The summary's update must follow the current trusted request (same-second
ordering uses comment IDs). A newer pending, malformed, wrong-head or negative
summary supersedes old clean state; ambiguous equal-time state fails closed.

This deliberately upgrades structured state from a wakeup-only signal to an
independent machine verdict. It also replaces semantic guessing about arbitrary
receipt suffixes with explicit chronology: every unfamiliar receipt is pending,
including apparently positive or negative prose. A strictly newer affirmative
machine completion independently supersedes that unstructured text. Later or
same-second unfamiliar text requires a fresh machine completion. The legacy
receipt parser itself remains strict; arbitrary prose never supplies approval.


The observed native receipt corpus in `tests/fixtures/native-codex-corpus.json`
covers 19 sign-offs, ten-character and full-head references, and the exact
`View task →` link shape. Unknown closings, extra lines, unknown help text,
foreign task links and mismatched heads cannot approve. A completed native code
lifecycle with null finding flags is not an affirmative verdict: it may accompany
an independently valid immutable receipt only when lifecycle creation precedes
receipt creation, receipt creation does not follow code completion, and that
completion follows the trusted request. Active security, mixed or true flags,
unknown presentation, edited receipts and unpaired lifecycles remain pending.

Strict positive receipt freshness and ordering use creation time; an edit cannot
renew approval or outrank a later pending verdict. Unknown or negative receipt
edits retain their update time so they can invalidate an older clean completion.

A trusted exact-head clean formal review can also supersede strictly older
pending summary evidence. Valid exact-head structured findings survive a repeated request for that head. Earlier valid section-specific clearing proof also remains effective when another section is absent or running, so repeated requests do not resurrect resolved findings; historical proof alone cannot grant the new request approval.
Code findings require newer affirmative code proof; security findings require
newer completed false/false security proof for that head (null is insufficient).
Clearing checks exclude severity only inside the other section’s unique validated completed row; ambiguous global severity remains pending. Typed finding order uses the affected section’s canonical completion time; unrelated summary edits do not renew that finding, while explicit severity or failure presentation uses the update time. Negative facts require a canonical leading summary marker, closed typed state and summary heading, even when visual section rows or clocks are invalid; invalid or ambiguous clocks use the observation time. Trailing presentation, including quoted or fenced examples and extra markers, cannot erase those facts. Whole quoted or fenced envelopes, unknown or duplicate markers inside the leading envelope, malformed schemas and foreign-head state cannot become permanent vetoes. The entire native presentation must match the declared section rows, known triggers, optional native table header and exact known About help text before approval or section-clock authority. The older row-only native layout remains supported. Unknown text, including apparently harmless prose or Markdown examples, stays pending and keeps an explicit typed negative at its observation time. English finding inference is not an authority boundary. Clearing still validates the entire original body. A completed companion may predate this summary, including on an older head, but its completion cannot follow the server observation. A future companion keeps the affected negative at its observation time; a strictly newer canonical own-section clear can still recover.
Explicit structured code/security findings require newer affirmative structured proof; a formal code review cannot clear them.
Its submission time uses the same second buckets;
tied or newer pending comments still block, and malformed receipt envelopes,
native findings and unresolved threads retain their vetoes.

A mutable summary updated in the request’s second remains ambiguous even if its
original comment ID is lower: that ID dates creation, not the edit. Such ties
stay pending; a fresh request or completion in a later second removes ambiguity.

The visible code-review row must report the same head and a valid completion time
strictly after the trusted request. That code completion time, rather than a
summary's `updated_at`, determines affirmative evidence order: a security-only
edit cannot renew an older code verdict or supersede later receipt text. GitHub's
second-precision comment timestamps and subsecond completion rows are compared in
second buckets, with ambiguous ties pending. Headings and reactions never prove
completion. Native P0–P2 findings, unresolved threads and malformed receipt
envelopes remain vetoes, including duplicate verdict/SHA fields, unknown markers,
extra lines and explicit P0–P2 receipt findings. Contradictory visible summary
status invalidates the machine summary itself.

All unresolved review threads block success, including threads on earlier heads.
A new request cannot discard a current-head negative formal review. P0–P2
findings continue to block; formal P3-only reviews retain their existing treatment
once their threads are resolved. Receipt edits do not refresh short-SHA evidence.

Both `created` and `edited` native comment events wake the trusted default-branch
rerun policy, including negative and pending updates. The job serializes events
for a PR, waits for active gates with a finite timeout, checks the live PR head
before requeue, and avoids requeue when a later-started run already evaluated
the event. Request recording uses the persisted marker’s creation time for
coalescing, so a run that finished before marker publication cannot count as
evaluating the new request. The gate checks the head again after fetching evidence so a dispatch
cannot publish success after a concurrent push.

When installing this contract upgrade, proposed scripts are not yet trusted.
The existing default-branch gate still requires its accepted legacy receipt or
native formal review. Request genuine review for the exact PR head and rerun the
existing Actions gate if necessary. A new closing plus structured state cannot
make the old parser accept evidence it does not support. Do not execute proposed
scripts with write permission, fabricate a check, or bypass a failed gate. After
merge, subsequent reviews use the upgraded trusted contract automatically.
