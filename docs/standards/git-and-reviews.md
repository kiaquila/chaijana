# Git and reviews

Use a focused branch and pull request. Required checks must be green for the
current head; resolve review threads and do not rely on stale approval after a
material change.

Harness changes are normal pull requests, reviewed like product changes. A
change that removes or weakens a check must say in the commit what protection
is being given up and why it is acceptable here. Merges and deployment remain
human decisions.

Ideas adapted from the `kiaquila/web-design` template arrive the same way: read
that repository, decide what helps Chaijaná, and write the change here. Nothing
is pinned to a release and nothing is synchronised automatically, so a pull
request never carries a bulk upstream diff.
