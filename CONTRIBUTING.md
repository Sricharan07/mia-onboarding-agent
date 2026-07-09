# Contributing

Thanks for helping improve MIA Onboarding Agent. This project is intended to be useful, secure, and straightforward to self-host, so contributions should keep the same bar.

## Local Setup

Use Node.js 22 or newer and npm 10 or newer. The repository includes `.nvmrc` for compatible Node version managers.

```bash
npm ci
npm ci --prefix backend/console
npm ci --prefix example/demo-crm+sdk
cp .env.example .env
npm run verify
```

For console-only work:

```bash
npm --prefix backend/console install
npm run dev:console
```

For the SDK demo:

```bash
npm --prefix example/demo-crm+sdk install
npm --prefix example/demo-crm+sdk run dev
```

## Development Expectations

- Keep changes scoped to the issue or task.
- Preserve existing behavior unless the change explicitly requires it.
- Add or update tests for behavior changes.
- Do not commit secrets, generated local data, SQLite databases, uploads, or LanceDB indexes.
- Preserve upstream copyright and license files when adapting third-party code or assets, and update `THIRD_PARTY_NOTICES.md`.
- Run `npm run verify` and `npm run audit:all` before opening a pull request.

## Pull Requests

Every pull request should include:

- A short description of the user-visible change.
- Validation performed, including commands run.
- Any migration, deployment, or security impact.
- Screenshots or recordings for UI changes.

## Release Notes

User-facing changes should update `CHANGELOG.md` under `Unreleased`.

Maintainers should follow [the release process](docs/releasing.md) for versioning, packaging, container verification, tags, and publication.
