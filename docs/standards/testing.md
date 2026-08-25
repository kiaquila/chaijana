# Testing

The project's real validation commands are the `check:*` scripts in the root
`package.json`, and CI runs those same scripts. A check must exercise the
implementation; a placeholder command that always passes is not acceptable.

Before merge, run `npm run preflight`: the repository safety check, its own
regression tests, then the menu and website checks including the production
build. For visual products also record manual checks at the smallest and
largest supported viewports, keyboard focus and navigation, reduced-motion
behavior, console/network errors, and the critical conversion or interaction
path. Test deployable output rather than relying only on source inspection.

Size limits belong where the artifact is actually served to a guest. The menu
tests bound the generated menu HTML and stylesheet directly. Do not add an
aggregate byte budget over the `website/` build output: it mixes server and
runtime code with client assets, so its total size is not a page-weight metric.
