# Project structure

Each repository owns exactly one product or business. Product code, evidence,
design decisions, assets, deployment configuration, and project instructions
stay together; other customer projects are never copied in as examples.

The root `AGENTS.md` contains the project's instructions and the root
`package.json` records its executable checks. `docs/standards/` is
project-owned, like everything else here. Product documentation may use any
clear project-local structure.

Dependency directories, caches, generated builds, local tooling state, private
exports, and deployment credentials are not versioned unless a project document
explicitly identifies a generated artifact as a deliverable and explains why.
