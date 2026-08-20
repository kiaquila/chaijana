# Cloudflare cutover and rollback

**Status: not executed. Cloudflare is untouched.** The `chaijana` Worker still
builds from `kiaquila/web-design`. This document is the prepared procedure; it
must not be run without explicit, separate authorization from the repository
owner.

## Recorded state before cutover

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
| GitHub deployment ID | `5952489405` (`chaijana / stage`, succeeded 2026-08-17T22:27:46Z) |

The Cloudflare account identifier and the full dashboard build URL are
deliberately not recorded in this repository; they are kept with the migration
evidence outside version control.

**The rollback point and the migration target are the same bytes.** The
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

## Cutover procedure

Do not start until the baseline adoption pull request is merged, `main` here is
green, and the owner has authorized the switch.

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

The previous Cloudflare version stays available for the whole procedure.

- **Fast rollback, no repository change.** In Cloudflare → `chaijana` →
  Deployments, roll back to the deployment built from
  `94dc9a6da3b0bb658b373f7c8f6ed67527acee36`
  (build `1518fbb8-12b1-4be0-a053-920e8c8480ff`). This restores the exact
  bytes that are live today.
- **Full rollback.** Disconnect `kiaquila/chaijana`, reconnect
  `kiaquila/web-design` with the original settings from the table at the top of
  this document, and redeploy `main`. Only do this while
  `kiaquila/web-design#46` is still unmerged and `chaijana/` still exists there.
- **After rollback**, re-run the smoke list and confirm the header contract
  above is intact before ending the freeze.

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
