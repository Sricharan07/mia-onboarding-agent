# HTTP API

All API routes live under `/api/v1`. The console and trusted integrations use API credentials; the browser SDK uses short-lived runtime tokens.

## Authentication

Pass either:

```http
Authorization: Bearer mia_...
```

or:

```http
x-api-key: mia_...
```

Console admin sessions are also accepted for admin routes through the console login flow.

SDK routes use `Authorization: Bearer mia_rt_...`. A trusted host backend mints this token with `POST /api/v1/runtime/tokens`; reusable API keys must never enter browser code.

## Scopes

- `admin`: full administrative access.
- `apps:read`: list/read accessible apps.
- `ui-map:read`: read UI map versions, pages, and elements.
- `workflows:read`: read workflow jobs and workflows.
- `runtime:tokens:create`: mint and revoke runtime tokens from a trusted app backend.
- `logs:read`: read execution logs and usage metrics.

Non-admin keys must be bound to one app and at least one allowed browser origin.

Runtime token capabilities are `runtime:resolve`, `runtime:workflow`, `logs:write`, `voice:live`, `voice:tts`, and `voice:livekit`.

## System

- `GET /api/v1/health`: lightweight process health.
- `GET /api/v1/system/readiness`: admin-only database, config, provider, secret-storage, and local storage readiness.

## Console Auth

- `GET /api/v1/console/auth/status`
- `POST /api/v1/console/auth/setup`
- `POST /api/v1/console/auth/login`
- `POST /api/v1/console/auth/logout`
- `GET /api/v1/console/users`
- `POST /api/v1/console/users`
- `PATCH /api/v1/console/users/:userId/password`
- `POST /api/v1/console/users/:userId/disable`
- `GET /api/v1/console/sessions`
- `POST /api/v1/console/sessions/:sessionId/revoke`

`setup` requires `x-bootstrap-admin-token` and creates the first console admin only.

## Apps And API Keys

- `GET /api/v1/apps`
- `POST /api/v1/apps`
- `POST /api/v1/apps/:appId/archive`
- `GET /api/v1/api-keys`
- `POST /api/v1/api-keys`
- `DELETE /api/v1/api-keys/:keyId`
- `POST /api/v1/runtime/tokens`
- `DELETE /api/v1/runtime/tokens/:tokenId`
- `GET /api/v1/apps/:appId/data-export`
- `DELETE /api/v1/apps/:appId/user-data/:userId`
- `POST /api/v1/apps/:appId/data-retention/purge`

App records include base URL and optional UI scan profile settings. API key creation returns the raw key once; store it immediately.

## UI Map

- `POST /api/v1/apps/:appId/ui-map/preflight`
- `POST /api/v1/apps/:appId/ui-map/discover-routes`
- `POST /api/v1/apps/:appId/ui-map/scan`
- `GET /api/v1/apps/:appId/ui-map/versions`
- `GET /api/v1/ui-map/:uiMapVersionId/pages`
- `GET /api/v1/pages/:pageId/elements`
- `PATCH /api/v1/apps/:appId/ui-map/elements/:elementRowId`
- `GET /api/v1/ui-map/interactive-sessions`
- `POST /api/v1/apps/:appId/ui-map/interactive-sessions`
- `GET /api/v1/ui-map/interactive-sessions/:sessionId`
- `POST /api/v1/ui-map/interactive-sessions/:sessionId/goto`
- `POST /api/v1/ui-map/interactive-sessions/:sessionId/capture-state`
- `POST /api/v1/ui-map/interactive-sessions/:sessionId/finish`
- `POST /api/v1/ui-map/interactive-sessions/:sessionId/cancel`

Automated scans accept explicit routes and optional auth mode. Preflight checks every selected route, login selectors, privacy selectors, and target reachability before scan start.

`discover-routes` opens the selected seed routes in the scanner browser, follows safe same-origin links, filters obvious destructive/logout/binary routes, and returns the merged route list plus per-seed crawl results. Manual auth is intentionally handled by interactive mapping instead.

UI map version records include scan progress fields for console polling and external operators: `routes`, `routeCount`, `pageCount`, `failedPageCount`, `elementCount`, `strongSelectorCount`, `mediumSelectorCount`, and `weakSelectorCount`.

Completing a new UI map invalidates approvals for workflows bound to an older map. UI elements expose ordered structured locators for standard CSS, role/name, label, and exact text; Playwright-only pseudo-selectors are never sent to the browser SDK. The workflow review report blocks missing routes, unresolved actions, low target-match confidence, stale fingerprints, locator changes, selector warnings, non-unique selectors, type/route changes, and dangerous automatic actions.

## Workflows

- `POST /api/v1/apps/:appId/workflow-videos`
- `GET /api/v1/apps/:appId/workflow-jobs`
- `GET /api/v1/workflow-jobs/:jobId`
- `POST /api/v1/workflow-jobs/:jobId/process`
- `GET /api/v1/apps/:appId/workflows`
- `GET /api/v1/workflows/:workflowId`
- `GET /api/v1/workflows/:workflowId/review-report`
- `PATCH /api/v1/workflows/:workflowId`
- `POST /api/v1/workflows/:workflowId/approve`
- `POST /api/v1/workflows/:workflowId/publish`
- `POST /api/v1/workflows/:workflowId/archive`
- `POST /api/v1/workflows/:workflowId/steps`
- `PATCH /api/v1/workflows/:workflowId/steps/:stepId`
- `DELETE /api/v1/workflows/:workflowId/steps/:stepId`
- `POST /api/v1/workflows/:workflowId/steps/reorder`

Workflow video uploads must be MP4, MOV, WebM, MKV, or MPEG and must match the claimed container type.

## Runtime, Voice, Logs, And Metrics

- `POST /api/v1/runtime/resolve`
- `POST /api/v1/runtime/workflow-sessions`
- `PATCH /api/v1/runtime/workflow-sessions/:runtimeSessionId`
- `POST /api/v1/gemini/live-token`
- `POST /api/v1/logs/execution`
- `GET /api/v1/logs`
- `GET /api/v1/metrics/usage`
- `GET /api/v1/metrics/usage/timeseries`
- `POST /api/v1/apps/:appId/semantic-index/rebuild`

Runtime and log write routes are intended for app-bound SDK keys. Metrics and log reads are intended for console operators or server-side integrations.
