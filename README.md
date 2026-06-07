# MIA Onboarding Agent

Local-first AI onboarding agent foundation for SaaS products.

## What Exists Now

- `docs/` is the source of truth.
- `example/demo-crm/` is preserved for later and is not implemented in this pass.
- `backend/` contains the TypeScript backend foundation, SQLite persistence, API routes, UI mapper, workflow processing, and real provider adapters.
- `sdk/` contains the browser SDK foundation for runtime context, LiveKit connection, AI cursor, highlighting, and workflow execution.

## Local Setup

```bash
npm install
cp .env.example .env
npm run build
npm run dev:backend
```

The backend listens on `http://localhost:4000` by default.

Provider credentials are required for provider-backed routes. Missing credentials fail with explicit config errors instead of falling back to mocks.

## Useful Commands

```bash
npm run build
npm run test
npm run dev:backend
```
