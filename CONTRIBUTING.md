# Contributing

Thanks for improving Mia. Contributions should preserve its single-product v1 contract, safety boundary, and ability to start from an empty self-hosted deployment.

## Local Setup

Use Node.js 22 or newer, npm 10 or newer, and PostgreSQL with pgvector.

```bash
npm ci
npm ci --prefix backend/console
npm ci --prefix example/demo-crm+sdk
cp .env.example .env
```

Create a dedicated test database whose name contains `test`; integration tests deliberately refuse to reset any other database.

```bash
createdb mia_test
psql mia_test -c 'CREATE EXTENSION IF NOT EXISTS vector;'
MIA_TEST_DATABASE_URL=postgres://mia:password@127.0.0.1:5432/mia_test npm run verify
```

Docker users can start PostgreSQL and the backend with `docker compose up --build` after setting the required secrets in `.env`.

For focused development:

```bash
npm run dev:backend
npm run dev:console
npm --prefix example/demo-crm+sdk run dev
```

## Engineering Expectations

- Keep changes scoped to the issue or task and preserve established module boundaries.
- Fix root causes; do not add bypasses, fallback mocks presented as production behavior, or silent compatibility paths.
- Add focused tests for behavioral changes and PostgreSQL integration tests for persistence contracts.
- Treat model output as untrusted. Never weaken target validation, schema validation, confirmation, policy, idempotency, or verification to make a scenario pass.
- Keep Gemini responsible for judgment and planning, not authentication, authorization, secret handling, or safety enforcement.
- Do not add deterministic intent classifiers or reintroduce fixed workflow execution.
- Do not commit `.env`, credentials, database volumes, uploads, recordings, build output, or browser profiles.
- Preserve third-party copyright and license files and update `THIRD_PARTY_NOTICES.md` when adding adapted assets or code.
- Update public documentation and `CHANGELOG.md` whenever interfaces, configuration, deployment, or user behavior changes.

## UI Changes

Test every changed console or SDK surface at desktop and mobile widths. Confirm keyboard operation, focus visibility, reduced motion, loading/empty/error states, text containment, and absence of document-level horizontal overflow. Include screenshots or recordings in the pull request.

## Pull Requests

Every pull request should include:

- The user or operator problem being solved.
- The behavioral and security impact.
- Database, configuration, deployment, or public API changes.
- Commands and live scenarios used for validation.
- Screenshots for visible changes.

Before requesting review, run:

```bash
MIA_TEST_DATABASE_URL=postgres://mia:password@127.0.0.1:5432/mia_test npm run verify
npm run audit:all
docker compose config
git diff --check
```

Maintainers should follow [the release process](docs/releasing.md) for versioning, clean-volume deployment checks, SDK packaging, tags, and release notes.
