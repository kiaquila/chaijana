# Source provenance

This repository was extracted from the `chaijana/` directory of the
`kiaquila/web-design` multi-project workspace on 2026-08-20. Nothing was
re-created by hand: the published tree and the project's whole commit history
were carried over by `git filter-repo` and then proved against the source.

## Source identity

| Fact | Value |
| --- | --- |
| Source repository | `kiaquila/web-design` |
| Source commit (published `main`) | `3b99cb3d23328013c28eb73ab8525b13b6992d9e` |
| Source subtree | `chaijana/` |
| Source subtree tree object | `bd877c393c899e84f58c38abb56f3591a8074b7a` |
| Rewritten `main` | `5a8d596a4fe2c45e9b12a0aeb65888cb1f085d9e` |
| Tag `chaijana-iteration-01`, before | `51829d68deb5d89214ee914a665911222d304393` |
| Tag `chaijana-iteration-01`, after | `c9b69060986d8bfa1ab16c9a60c888470b515a1d` |

## How the history was rewritten

In a disposable clone of `kiaquila/web-design`, fetched with
`--single-branch --branch main` so that no unrelated branch could be carried
along:

```bash
git filter-repo --path chaijana/ --path-rename chaijana/:
```

The rename lifts `chaijana/menu` to `menu` and `chaijana/website` to `website`,
which is the only topology change the history rewrite makes.

## Proof taken before any migration edit

All four checks were run on the filtered clone, before the baseline or any
adaptation was committed.

1. **Exact tree.** The root tree of the rewritten `main` is
   `bd877c393c899e84f58c38abb56f3591a8074b7a` — the same tree object the source
   repository published under `chaijana/` at
   `3b99cb3d23328013c28eb73ab8525b13b6992d9e`. The migrated content is
   therefore byte-identical to the source, not merely equivalent.
2. **Commit history.** All 30 project commits that touched `chaijana/` are
   present. The rewritten `main` carries 42 commits in total:

   | Kind | Count | Note |
   | --- | --- | --- |
   | Project commits touching `chaijana/` | 30 | the expected set, complete |
   | Commits that were already empty upstream | 2 | `chore: trigger initial Cloudflare stage build`, `chore: trigger initial Cloudflare preview build` |
   | Merge commits | 10 | original pull-request topology, preserved |

   `git filter-repo` prunes commits that *become* empty through filtering; it
   does not delete commits that were empty in the source. Those two build
   triggers and the merge topology were kept rather than flattened, because the
   task was to preserve the history, not to reshape it.
3. **Rewritten tag.** `chaijana-iteration-01` keeps its name and still marks
   `archive Chaijana iteration 01`, now at
   `c9b69060986d8bfa1ab16c9a60c888470b515a1d`.
4. **Object integrity.** `git fsck --full --strict` reports no problem.

## Deliberately not migrated

- **Old feature branches.** Only `main` and the one tag were pushed. The source
  repository keeps its branches; none was carried over automatically.
- **Other customer projects.** `alex-neon`, `alphacentr`, `ember`, `ks`, and
  `misha` never entered this history. The filter kept a single path.
- **Monorepository-only infrastructure.** `.repo-guard.json`, the multi-project
  `ci.yml`, `docs/stage-hosting.md`, the Cloudflare stage-registration workflow
  and script, and the KS production-deploy workflow describe a workspace that
  no longer exists here; the `web-design` baseline replaces them.
- **Third-party notices for other projects.** `third-party-notices.md` keeps
  only the fonts and vendored software this project actually ships.

## Commit map

`git filter-repo` wrote a full old→new commit map for all 144 rewritten
objects. It is not committed — it describes the migration event, not the
product — and is kept locally at
`~/projects/web-design/.claude/migration/chaijana-2026-08-20/`:

| File | SHA-256 |
| --- | --- |
| `commit-map.txt` | `07fbd172cd2fac2cd9813379952500ad72512f29f8cf20f6a3946e19a8cdf5a4` |
| `ref-map.txt` | `f996bc66706354dfcf0f81401cfe835461ed7b64f2960fc9b951fee246144cff` |

The same map can be reproduced at any time by re-running the command above
against `3b99cb3d23328013c28eb73ab8525b13b6992d9e`; the rewrite is
deterministic.

## Topology adaptation

Only path topology was adapted. No business fact, price, translation, opening
hour, contact detail, or design decision was changed.

- `chaijana/menu` → `menu` and `chaijana/website` → `website` in `README.md`,
  `AGENTS.md`, `CONTENT-AUDIT.md`, `PHOTO-BRIEF.md`,
  `menu/assets/fonts/README.md`, and `website/app/globals.css`.
- Repository-relative links that pointed out of the old project directory now
  point inside this repository.
- `.github/dependabot.yml` watches `/website` instead of `/chaijana/website`.
- The website build still consumes its sibling menu through `../menu`, which
  the rename preserved unchanged.

## Baseline pin — provisional

`.web-design/lock.json` pins
`f042879d8b6d11cc80021bb19cc4aacd645cc621` from the `codex/web-design-template-v2`
branch of `kiaquila/web-design`, at version `0.1.0-dev`.

**This is deliberately a provisional pin.** `kiaquila/web-design` has not yet
published an immutable stable release, because the pull request that turns it
into a template — [`kiaquila/web-design#46`](https://github.com/kiaquila/web-design/pull/46)
— is still a draft and must not be merged until every project has been migrated
and verified. `f042879d` is the exact, reachable commit that pull request
proposes, so it is a real 40-character SHA that
`baseline-source-verification` can download and compare, and the standard
`npm run setup` adoption path accepted it without any workaround.

### Required follow-up

After `kiaquila/web-design#46` is merged and the first immutable stable release
is published, this project must be moved onto that release's full commit SHA in
its own separate pull request:

```bash
npm run sync:web-design -- plan  --source-ref <stable-release-sha> --version <x.y.z>
npm run sync:web-design -- apply --source-ref <stable-release-sha> --version <x.y.z>
```

Until that pull request is merged, this repository is pinned to a prerelease
baseline and `0.1.0-dev` must not be treated as a released version.
