# Release Process

Mia is pre-1.0. Releases must be reproducible from a clean `main` branch and must not bypass review, CI, packaging, or migration checks.

## Prepare

1. Confirm `main` is clean and synchronized with the remote.
2. Move the relevant `CHANGELOG.md` entries from `Unreleased` into a dated version section.
3. Update the root and SDK package versions together.
4. Review database migrations, deployment notes, security impact, and SDK API compatibility.
5. Run the complete verification command:

```bash
npm ci
npm ci --prefix backend/console
npm ci --prefix example/demo-crm+sdk
npm run verify
npm run audit:all
docker build -t mia-onboarding-agent:release .
```

## Verify The Container

Run the image with production-valid origins and secrets, then verify `/api/v1/health`, the bundled console at `/`, and graceful shutdown. Production secrets must be unique, stable where required, and at least 32 characters.

## Publish The SDK

The `@mia/onboarding-agent` package is not yet published. Publishing requires npm access to the `@mia` scope.

```bash
npm run pack:sdk
npm publish -w sdk --access public
```

The package dry run must contain only `dist`, `README.md`, `LICENSE`, and package metadata. Never publish from a dirty worktree or with a browser-facing reusable API key in examples.

## Tag And Announce

After all release artifacts are available:

1. Create an annotated `vX.Y.Z` tag on the verified commit.
2. Push the commit and tag.
3. Create a GitHub release from the matching changelog section.
4. Include migration, configuration, security, and rollback notes.
5. Re-run the deployment health and readiness checks against the released image.
