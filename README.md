# Chaijaná — Chaijaná Noir

**Chaijaná Noir** is the approved redesign concept for Chaijaná: an intimate,
nocturnal expression of the restaurant's Central Asian identity, built around
warm near-black surfaces, restrained gold-leaf detail, editorial food imagery,
and Playfair Display typography over a Manrope text face. The concept name and
direction apply to both deliverables in this repository.

This repository keeps the two Chaijaná deliverables separate while publishing
them as one experience:

- `website/` — the complete multilingual restaurant website and deployable app;
- `menu/` — the standalone, no-framework ES/EN/RU menu and its canonical data.

The website build synchronizes the generated menu into its public output. Edit
menu content only in `menu/src/menu-data.ts`, run `npm run check` in `menu/`,
then run `npm test` in `website/` before publishing.

`website/vendor/image-size/` is a deliberately versioned dependency: it vendors
the `image-size` 2.0.2 runtime with local guards against malformed HEIF, ICNS,
and JXL input while upstream has no fixed release. Its provenance, license, and
removal condition are documented in that directory and in
[`third-party-notices.md`](./third-party-notices.md).

The website lockfile resolves the PostCSS-transitive `nanoid` dependency at
3.3.20 so installs and the repository OSV scan exclude
[GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8)
without a package override.

The temporary customer stage is served by the `chaijana` Cloudflare Worker at
`https://chaijana.ks-design.workers.dev`. **That Worker builds from this
repository.** A pull request touching `website/` or `menu/` gets a Cloudflare
preview, and a merge to `main` gets a production build; both post a
`Workers Builds: chaijana` check run on the head commit. The cutover record and
dated production evidence are in
[`docs/migration/cloudflare-cutover.md`](./docs/migration/cloudflare-cutover.md).
Rollback is a Cloudflare Worker version operation: re-check the active
deployment immediately before selecting a known-good earlier version. The old
`kiaquila/web-design` repository is not a rollback source because its
`chaijana/` tree has been removed. The deploy contract itself —
`wrangler.json`, `npm run stage:deploy`, and `npm run stage:preview` — is
unchanged throughout.

Both share one design system — **Chaijaná Noir**: warm near-black ground, a
gold-leaf accent ramp, self-hosted Playfair Display for display and Manrope for
text, and inline SVG arabesque ornaments.

**The two stylesheets are synchronised by hand, on purpose.** `menu/` must open
straight from a clone with no build step and no network, so it cannot import
tokens from the website package. `menu/src/styles.css` is the reference
implementation: every `:root` token in `website/app/globals.css` must match it
byte for byte, with one documented exception (`--shell`, wider on the site).
Changing a token means changing both files in the same commit. To check:

```sh
node -e 'const r=p=>{const s=require("fs").readFileSync(p,"utf8"),b=s.slice(s.indexOf(":root {"));return Object.fromEntries([...b.slice(0,b.indexOf("}")).matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map(m=>[m[1],m[2].trim()]))};const a=r("menu/src/styles.css"),b=r("website/app/globals.css");const d=Object.keys(a).filter(k=>k in b&&a[k]!==b[k]&&k!=="--shell");console.log(d.length?"drifted: "+d:"tokens in sync")'
```

The eight WOFF2 subsets live once, in `menu/assets/fonts/`, beside
`OFL-PlayfairDisplay.txt` and `OFL-Manrope.txt`. `website/scripts/sync-menu.mjs`
copies them into the git-ignored `website/public/fonts/` at build time.

## Project harness

This repository owns its own checks. There is no upstream control plane: no
release pin, no lockfile of managed files, no manifest, and no automated sync
workflow. The layout of the harness borrows ideas from the `template/` directory
of `kiaquila/web-design` — one CI workflow, a dependency-free repository safety
check, and project checks declared in one place — but it was copied by hand,
adapted to this project, and is maintained here. `kiaquila/web-design` is a
reference to read, not a dependency to track. Bringing over a later idea means
reading that repository, deciding whether the idea helps Chaijaná, and writing
the change here in a normal pull request.

`.github/workflows/ci.yml` is the only CI workflow. It runs three jobs:

| Job | What it does |
| --- | --- |
| `project-ci` | The real menu and website checks — build, lint, and tests |
| `repository-guard` | `scripts/check-repository.mjs` plus its own regression tests |
| `osv-scan` | OSV dependency advisories across the repository |

`Codex Review` runs alongside them as the AI review gate, and
`Workers Builds: chaijana` is posted by Cloudflare.

`scripts/check-repository.mjs` is the repository safety check. It has no
dependencies and reads only what `git ls-files` reports, so a clone and a bare
CI runner behave identically. It rejects tracked build output, dependency
trees, `.env` files, private keys, secret-shaped strings, personal absolute
paths, and symlinks, and it holds every workflow to a full-SHA action pin,
declared top-level permissions, no `write-all`, and no `pull_request_target`.

There is no aggregate size budget over the built site. `website/` is a
Vinext/Next application whose build output mixes server and runtime code with
client assets, so a total-bytes number over that directory measures the wrong
thing. The size limits that matter are the ones `menu/tests/menu.test.mjs`
already enforces on the artifacts a guest actually downloads: each generated
menu HTML file stays under 200 KB and the menu stylesheet under 40 KB.

```bash
npm run preflight         # repository safety check, harness tests, menu and website checks
npm run check:project     # just the menu and website checks
npm run check:repository  # just the repository safety check
```

## Working documents

- [`CONTENT-AUDIT.md`](./CONTENT-AUDIT.md) — line-by-line comparison against the
  live site and the three menu PDFs: what was restored, what was deliberately
  unified, and what still needs the restaurant's confirmation.
- [`PHOTO-BRIEF.md`](./PHOTO-BRIEF.md) — which images to reshoot or regenerate,
  in what format and at what priority.

The repository history preserves each design iteration. Tag `chaijana-iteration-01`
marks the first mixed site/menu prototype before the website and menu were split.
