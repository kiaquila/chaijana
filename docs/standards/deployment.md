# Deployment

Deployment configuration belongs to this repository; credentials belong to the
hosting platform's environment-scoped secret store. Customer domains, account
identifiers, Worker IDs, private keys, and production tokens are never
committed here.

The `chaijana` Cloudflare Worker builds directly from `kiaquila/chaijana`. That
connection is the deploy contract: `website/wrangler.json`,
`npm run stage:deploy`, and `npm run stage:preview` are project-owned and are
not routed through any other repository. Two repositories must never both be
able to deploy this Worker — see
[`../migration/cloudflare-cutover.md`](../migration/cloudflare-cutover.md) for
the recorded cutover and the rollback path.

Production changes require explicit authorization, green checks for the exact
commit, a recorded target and expected revision, post-deploy verification, and
a rollback point. Pull requests build isolated Cloudflare previews.

Rollback moves traffic to a confirmed known-good Cloudflare Worker version.
Immediately before rollback, query the active deployment again; dated build,
version, and deployment IDs are evidence, not a promise of current state. The
retired `kiaquila/web-design` copy is not a rollback source.
