# Cloudflare cutover and rollback

**Status: connected and serving production from this repository.** Verified on
2026-09-18: `origin/main` was
[`f591e3198c143e3a144fb5fea598dc0861914b92`](https://github.com/kiaquila/chaijana/commit/f591e3198c143e3a144fb5fea598dc0861914b92),
its [`Workers Builds: chaijana` check](https://github.com/kiaquila/chaijana/runs/104553852268)
succeeded, and Cloudflare reported the resulting version as the active version
at 100% traffic. The stable stage also passed the HTTP smoke checks recorded
below. IDs in this document are point-in-time evidence, not substitutes for a
fresh deployment query before an operational change.

## Current verified production state

Observed on 2026-09-18. The build and deployment happened on 2026-09-15; this
later verification tied the GitHub check, Cloudflare deployment state, and live
stage together.

| Fact | Value |
| --- | --- |
| Source repository | `kiaquila/chaijana` |
| Source commit | [`f591e3198c143e3a144fb5fea598dc0861914b92`](https://github.com/kiaquila/chaijana/commit/f591e3198c143e3a144fb5fea598dc0861914b92) |
| Check run | [`Workers Builds: chaijana`](https://github.com/kiaquila/chaijana/runs/104553852268), success at 2026-09-15T20:32:24Z |
| Cloudflare build ID | `a4995eb5-ad3d-4986-8322-ed5fa5824578` |
| Worker version ID | `09adada2-0672-408e-928f-68c838040e98` |
| Cloudflare deployment ID | `838f6244-9b18-4e56-a4cb-3975fdbb89dd` |
| Deployment created | 2026-09-15T20:32:12.956342Z, 100% of traffic |
| Stable stage URL | `https://chaijana.ks-design.workers.dev` |

The 2026-09-18 live smoke returned 200 for `/`, `/en`, `/ru`, `/menu/`,
`/menu/en`, and `/menu/ru`; the three legacy `.html` menu routes returned the
expected 307 redirects; and `/nope-404` returned 404. The site and menu security
headers, font and image responses, and cache policies matched the contract
below.

## Historical state before cutover

Captured on 2026-08-20, before any change in this migration.

| Fact | Value |
| --- | --- |
| Worker name | `chaijana` |
| Stable stage URL | `https://chaijana.ks-design.workers.dev` |
| Connected repository | `kiaquila/web-design` |
| Production branch | `main` |
| Root directory | `chaijana/website` |
| Build watch path | `chaijana/*` |
| Build command | `npm run build` |
| Production deploy command | `npm run stage:deploy` |
| Non-production deploy command | `npm run stage:preview` |
| Deployed source commit | `94dc9a6da3b0bb658b373f7c8f6ed67527acee36` |
| Cloudflare build ID | `1518fbb8-12b1-4be0-a053-920e8c8480ff` |
| Worker version ID | `44297898-122b-4123-b4f5-0504c95a9a4e` |
| Cloudflare deployment ID | `aa7fec48-6b8a-4d40-8cb5-0fe4f54cc570` |
| GitHub deployment ID | `5952489405` (`chaijana / stage`, succeeded 2026-08-17T22:27:46Z) |

The Cloudflare account identifier and the full dashboard build URL are
deliberately not recorded in this repository; they are kept with the migration
evidence outside version control.

**At cutover, the rollback point and the migration target were the same
bytes.** The
`chaijana/` tree of the deployed commit `94dc9a6` is
`bd877c393c899e84f58c38abb56f3591a8074b7a`, which is exactly the root tree of
this repository's migrated `main` (`5a8d596a4fe2c45e9b12a0aeb65888cb1f085d9e`).
Cutting over therefore rebuilds identical source; any output difference is a
build-environment difference, not a content change.

### Response headers before cutover

The full capture is kept with the migration evidence. The contract to preserve:

| Path | Status | `cache-control` | Notes |
| --- | --- | --- | --- |
| `/`, `/en`, `/ru` | 200 | `no-store, must-revalidate` | site CSP: `script-src 'self' 'unsafe-inline'`, `connect-src 'self'` |
| `/menu/` | 200 | `public, max-age=0, must-revalidate` | menu CSP: three `sha256-` script hashes, `connect-src 'none'`, `form-action 'none'` |
| `/menu/en.html`, `/menu/ru.html` | 307 → `/menu/en`, `/menu/ru` | — | extension-less canonical redirect |
| `/menu/assets/fonts/*.woff2` | 200 | `public, max-age=31536000, immutable` | fonts |
| `/images/restaurant/*.webp` | 200 | `public, max-age=0, must-revalidate` | images |
| `/nope-404` | 404 | — | site CSP still applied to the error route |

Every response carries `strict-transport-security: max-age=31536000;
includeSubDomains`, `x-content-type-options: nosniff`, `x-frame-options: DENY`,
`referrer-policy: strict-origin-when-cross-origin`,
`cross-origin-opener-policy: same-origin`, and the `permissions-policy` deny
list. No third-party origin appears in any policy.

## Historical cutover record

### Preview build — confirmed 2026-08-25

The connection was confirmed empirically rather than from the Cloudflare
dashboard, by putting a `website/` change on a pull request and watching for the
check run that only Workers Builds can post.

| Fact | Value |
| --- | --- |
| Observed on | 2026-08-25 |
| Pull request | [`#3`](https://github.com/kiaquila/chaijana/pull/3) |
| Check run | `Workers Builds: chaijana`, app `cloudflare-workers-and-pages`, success |
| Cloudflare build ID | `b0562f9a-df65-478e-9c9c-17e05110c517` |
| Worker version ID | `099bf5de-3583-4e44-8bc0-a5e5a9d6ba82` |
| Preview URL | `https://099bf5de-chaijana.ks-design.workers.dev` |
| Preview alias URL | `https://fix-dependabot-cooldown-and-deploy-state-chaijana.ks-design.workers.dev` |

Preview status codes: `/`, `/en`, `/ru`, `/menu/`, `/menu/en`, `/menu/ru` all
200; `/menu/index.html`, `/menu/en.html`, `/menu/ru.html` all 307; `/nope-404`
404. The rest of the smoke list below is not yet recorded.

### Production build — confirmed 2026-08-26

The first retained production check from this repository succeeded for
[`b73c1cd254893d2c3744b9db71a7ef429e2ec404`](https://github.com/kiaquila/chaijana/commit/b73c1cd254893d2c3744b9db71a7ef429e2ec404).

| Fact | Value |
| --- | --- |
| Observed on | 2026-08-26 |
| Check run | [`Workers Builds: chaijana`](https://github.com/kiaquila/chaijana/runs/98208579079), success |
| Cloudflare build ID | `ba1f34cb-02d2-49eb-b737-926ff5dfb5d1` |
| Worker version ID | `a3bfdefe-d7c8-417d-8e41-f02c44716efd` |
| Cloudflare deployment ID | `547229bc-f203-4043-80a2-0d36fc10ce71` |

Later production builds superseded these IDs. The current verified record is at
the top of this document.

## Historical cutover procedure

This procedure is retained to explain the completed migration. It is not a
current runbook and must not be used to reconnect the old repository.

1. **Freeze.** Announce that no merge lands in either repository during the
   cutover.
2. **Re-record the live state.** Re-run the header capture and confirm the
   deployed commit is still `94dc9a6da3b0bb658b373f7c8f6ed67527acee36`. If it
   moved, update this document before continuing.
3. **Disconnect the old source first.** In Cloudflare → Workers & Pages →
   `chaijana` → Settings → Build, disconnect the `kiaquila/web-design` Git
   connection. Two repositories must never both be able to deploy this Worker.
4. **Connect this repository.** Import `kiaquila/chaijana` and set:

   | Setting | Value |
   | --- | --- |
   | Production branch | `main` |
   | Root directory | `website` |
   | Build command | `npm run build` |
   | Production deploy command | `npm run stage:deploy` |
   | Non-production deploy command | `npm run stage:preview` |
   | Build watch path | `website/*` and `menu/*` |

   The Worker name stays `chaijana`; Cloudflare requires it to match `name` in
   `website/wrangler.json`, which is unchanged.

   **Both watch paths are required.** The website build runs
   `npm run sync:menu`, which builds the sibling `menu/` package and copies its
   HTML, assets, and fonts into `website/public/`. A menu-only change is a
   production content change, so `menu/*` must trigger a build. This is the
   direct successor of the old single `chaijana/*` include path, which covered
   both directories at once.
5. **Verify on a preview first.** Open a no-op pull request, let the preview
   build run, and complete the smoke list below against
   `https://<version>-chaijana.ks-design.workers.dev`. Do not proceed on a
   failed or skipped preview.
6. **Move production.** Merge to `main` and let the production build run.
7. **Verify production.** Repeat the smoke list against
   `https://chaijana.ks-design.workers.dev`, then record the new Cloudflare
   build ID and deployment evidence in this document.

## Rollback

Rollback is now a Cloudflare Worker version operation; it does not change the
Git connection or either repository.

1. **Re-check the active deployment immediately before acting.** From
   `website/`, run
   `npm exec wrangler -- deployments status --name chaijana --json` and record
   the active deployment ID, version ID, traffic percentage, and timestamp.
   Do not assume the IDs at the top of this document are still current.
2. **Choose a known-good earlier version.** As observed on 2026-09-18, the
   version immediately before the active one was
   `932fce7c-e8f6-445b-925a-aa24edccec50`, in deployment
   `0d994079-cf1c-4baa-81b1-83e929038b96` created
   2026-09-10T20:47:30.143509Z. That is dated evidence, not a permanent
   rollback target; confirm it is still the intended known-good version.
3. **Move traffic by version.** In Cloudflare → `chaijana` → Deployments,
   deploy the selected known-good Worker version at 100%. Cloudflare creates a
   new deployment for this action; no repository change is required.
4. **Verify.** Re-run the deployment query, then the smoke list below against
   the stable stage. Confirm the selected version has 100% traffic and the
   response/header contract is intact before ending the incident.

There is no repository-level full rollback through `kiaquila/web-design`:
`chaijana/` was removed from its `main` branch in
[`cfae7bb8236435579992ac265aead7d3b9d63a57`](https://github.com/kiaquila/web-design/commit/cfae7bb8236435579992ac265aead7d3b9d63a57)
on 2026-09-17. The pre-cutover IDs above remain historical evidence only.

## Smoke list after a confirmed cutover

Run all of it, on the preview first and then on production.

**Pages** — `/`, `/en`, `/ru`, `/menu/`, `/menu/en`, `/menu/ru` all return 200
and render the expected locale.

**Assets and policy** — dish and restaurant images load; all eight WOFF2
subsets load from the same origin; the site and menu CSP headers match the
table above, including the three menu script hashes; no request goes to a
third-party origin.

**Locales × viewports** — each of the three locales at the smallest and largest
supported widths, mobile and desktop. Check the longest menu entries for
wrapping and overflow, and the language switch on every page.

**Keyboard** — tab through each page: visible focus on every interactive
element, correct order, no trap, language switch and menu links reachable.

**Console** — no error and no warning in any locale, on mobile and desktop.

**Redirects and errors** — `/menu/index.html`, `/menu/en.html`, and
`/menu/ru.html` still 307 to their extension-less paths; an unknown path still
returns 404 with the site CSP applied.

A desktop screenshot alone is not completion evidence.
