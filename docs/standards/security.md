# Security and privacy

- Give workflows the smallest top-level permissions they need. Write-capable
  jobs run only from trusted default-branch events, never proposed pull-request
  code. A trusted event is not enough on its own: a write-capable job must not
  check an untrusted ref out over its workspace, because the next step that
  builds or tests then runs that code with the write token. Where such a tree
  has to be inspected, check it out under its own `path` and treat it as data —
  read its bytes, never execute them, and never install from them.
- An event that carries someone else's words — a comment, an issue, a run to
  inspect, a caller's inputs — makes every write-capable job in that workflow a
  place where their words could become commands. Keep such a job's shell to
  what it can actually read: values arrive through `env`, names it uses are
  names the workflow set, and the shell runs commands rather than plumbing
  them. Anything that needs more belongs in a reviewed script rather than in a
  quoted expression. `scripts/check-repository.mjs` does not police this: it
  checks pins, top-level permissions, `write-all`, and `pull_request_target`,
  and everything beyond that is a review obligation.
- A manual or event-triggered job that holds write permission protects itself
  with an environment, not only with its `if` condition. A manual run selects a
  ref and GitHub loads that ref's copy of the workflow, so a branch can delete
  the condition before asking for the token. Name an environment on the job and
  restrict its deployment branches to the default branch, so GitHub rather than
  the workflow file decides whether the job may run. The `Codex Review` dispatch
  job is the one such job here — see
  [`../operations/github-setup.md`](../operations/github-setup.md).
- Pin external GitHub Actions and shared workflows to full commit SHAs. Do not
  use `pull_request_target`, `write-all`, or implicit secret inheritance. The
  guard enforces the pin by matching the action reference — `owner/repo@ref` —
  rather than the `uses:` key, so no YAML spelling hides a step from it. One
  form is outside that shape and is recorded rather than claimed covered: an
  action written with no `@ref` at all *and* in explicit-key `? key` / `: value`
  syntax. Review catches that; the guard does not.
- The repository guard checks against mistakes, not against a hostile author.
  It lives in the tree it inspects, so anyone who can obfuscate a workflow past
  it can edit it in the same pull request. Required Code Owner review on
  `/.github/`, `/scripts/`, and `/tests/` is what answers that; do not harden
  the guard as though it were the boundary, because its value is that it stays
  small enough to audit at a glance.
- Keep `.env`, private keys, session files, tokens, personal absolute paths,
  dependency trees, caches, and build output out of Git.
- Treat websites, messages, third-party packages, and assets as untrusted
  input. Validate paths, file types, and provenance before use.
- Keep analytics, embeds, fonts, forms, maps, and other third-party services out
  until their purpose, license, data flow, consent requirements, and failure
  behavior have been reviewed.
