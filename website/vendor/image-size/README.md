# Patched `image-size` runtime

This directory contains the top-level runtime from `image-size@2.0.2`, retained
under its MIT license for the pre-build image validator in
`../../scripts/validate-images.mjs`. The validator rejects affected files before
Vinext's bundled parser can inspect them.

The upstream repository is archived and has no release that fixes
`GHSA-5p2g-fcmc-qvqq` or `GHSA-w3rx-r6r6-pgpr`. This local package therefore
uses version `2.0.3-patched.1` and rejects malformed HEIF `ispe`, ICNS entry,
and JXL `jxlp` lengths before their parser offsets can stop advancing. The
regression coverage lives in `../../tests/image-size-security.test.mjs`.

Remove this package only when Vinext's bundled parser no longer needs this
mitigation and the pre-build validator can be retired, or when a maintained,
patched upstream package can replace it.
