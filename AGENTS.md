# AGENTS.md — Chaijaná

Chaijaná is an existing restaurant in Buenos Aires. This repository contains its
website and multilingual menu as separate deliverables within one coherent
experience.

Read this file, `README.md`, and every document under `docs/standards/` before
changing the project. Those standards are project-owned: adapted by hand from
the `kiaquila/web-design` template and maintained here, not synchronised from
anywhere. The rules below tighten them for Chaijaná and may never weaken them.

## Product Identity

- Approved design concept: **Chaijaná Noir**.
- Direction: warm near-black surfaces, restrained gold-leaf accents,
  Playfair Display headings over a Manrope text face, editorial food imagery,
  and subtle Central Asian arabesque references.
- The tone is intimate, premium, and nocturnal. Avoid generic luxury tropes,
  bright SaaS styling, ornamental overload, and visual changes that obscure
  menu readability.

## Sources Of Truth

- `README.md` — deliverables, architecture, and shared design-system contract.
- `CONTENT-AUDIT.md` — provenance, reconciled multilingual content, and client
  confirmations.
- `PHOTO-BRIEF.md` — image gaps, quality constraints, and replacement targets.
- `menu/src/menu-data.ts` — canonical menu content.
- `menu/src/styles.css` — reference design tokens shared manually with the site.

Do not change factual content, prices, translations, hours, contact information,
or claims without updating the audit with a verifiable source or explicit client
confirmation.

## Implementation Rules

- Keep `website/` and `menu/` separately testable. The website may consume the
  generated menu; the standalone menu must not depend on the website runtime.
- Keep the menu usable from a clone without network access or a framework.
- Keep fonts and production imagery local. Do not introduce third-party CDNs,
  trackers, or embeds without explicit approval.
- When changing shared design tokens, update both `menu/src/styles.css` and
  `website/app/globals.css` in the same change and verify their documented
  exception.
- Preserve all three locales: Spanish, English, and Russian.
- The repository harness — `.github/workflows/ci.yml`, `scripts/`, `tests/`,
  and `docs/standards/` — is project-owned and edited directly here. Changing
  it is a normal pull request, and weakening a check needs a stated reason.
- Treat generated menu HTML and CSS as build artifacts derived from the
  canonical menu source; validate generated results, but do not create a second
  hand-edited source of truth.

## Validation

Run from the repository root:

```bash
npm run preflight   # the repository safety check, its tests, then the project checks
```

`npm run check:project` runs exactly what the `project-ci` job runs:

```bash
npm run check --prefix menu
npm ci --prefix website && npm run lint --prefix website && npm test --prefix website
```

`npm run check:repository` runs what the `repository-guard` job runs. The guard
scans every tracked file, including its own tests, so a test fixture that needs
a secret-shaped or personal-path string must assemble it at runtime.

For visual changes, also inspect representative mobile and desktop states in all
three locales, including the longest menu entries and keyboard focus states.
