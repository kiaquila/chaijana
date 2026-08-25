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
   `package.json` is owned for the same reason — it declares the commands CI
   runs — and the guard jobs invoke `node scripts/check-repository.mjs` and
   `node --test tests/*.test.mjs` directly rather than through `npm run`, so a
   rewritten script name cannot turn a required job into a no-op.
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
