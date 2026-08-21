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
3.3.18 so installs and the repository OSV scan exclude
[GHSA-2v37-7h3g-55p8](https://github.com/advisories/GHSA-2v37-7h3g-55p8)
without a package override.

The temporary customer stage is served by the `chaijana` Cloudflare Worker at
`https://chaijana.ks-design.workers.dev`. **That Worker still builds from
`kiaquila/web-design`.** Until the cutover in
[`docs/migration/cloudflare-cutover.md`](./docs/migration/cloudflare-cutover.md)
is explicitly authorized and executed, merging to `main` here deploys nothing,
and pull requests in this repository get no Cloudflare preview. The deploy
contract itself — `wrangler.json`, `npm run stage:deploy`, and
`npm run stage:preview` — is already in place and unchanged.

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

## Repository baseline

Repository policy, workflows, and the shared standards under `docs/standards/`
come from the `kiaquila/web-design` baseline. `.web-design/lock.json` pins the
exact upstream commit, `.web-design/managed-files.json` lists the files the
baseline owns, and `.web-design/project.json` records this project's profile,
deployment shape, and real check commands. Managed files are updated only
through `npm run sync:web-design`, never by hand; see
[`docs/operations/updates.md`](./docs/operations/updates.md).

The pin is currently the provisional `0.1.0-dev` baseline. How it got here, and
what still has to happen, is recorded in
[`docs/migration/source-provenance.md`](./docs/migration/source-provenance.md).

```bash
npm run preflight       # repository policy, managed-file drift, baseline tests
npm run project:check   # the menu and website checks from .web-design/project.json
```

## Working documents

- [`CONTENT-AUDIT.md`](./CONTENT-AUDIT.md) — line-by-line comparison against the
  live site and the three menu PDFs: what was restored, what was deliberately
  unified, and what still needs the restaurant's confirmation.
- [`PHOTO-BRIEF.md`](./PHOTO-BRIEF.md) — which images to reshoot or regenerate,
  in what format and at what priority.

The repository history preserves each design iteration. Tag `chaijana-iteration-01`
marks the first mixed site/menu prototype before the website and menu were split.
