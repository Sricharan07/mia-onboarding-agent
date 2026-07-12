# Security Model

Mia is self-hosted. The operator controls network placement, PostgreSQL, uploads, the console, provider credentials, host integration keys, retention, and access to diagnostics.

## Trust Boundaries

### Administrator console

The console is a privileged operational surface. It can configure provider/scanner secrets, product origin, integration keys, knowledge, action policy, skills, transcripts, and retention. Protect it with TLS, a strong unique administrator password, and organization-appropriate network or identity controls.

### Host backend

The host backend is trusted to authenticate its own user, authorize Mia access, hold one `mia_key_...` integration key, and exchange it for a runtime token bound to that verified user and exact product origin. It must not accept a browser-provided user ID as authoritative.

### Browser SDK

The SDK runs in an untrusted browser. It receives only a short-lived `mia_rt_...` token, semantic directives, and provider ephemeral voice credential. It cannot access administrator, integration, Gemini, or scanner credentials.

### Product content and model output

Page text, documents, visual context, action output, and retrieved knowledge are untrusted data. They are marked as data in model prompts and cannot grant permissions. Gemini output is also untrusted and must pass structural parsing, target allowlisting, action policy, schema validation, confirmation, limits, and receipt verification.

### Scanner

The Playwright scanner is a privileged browser process that may use a dedicated product account. It receives decrypted scan credentials only for the active scan and indexes redacted semantic output, not a reusable browser-control channel.

## Credentials

Protect:

- PostgreSQL password and connection URL;
- `MIA_SECRET_ENCRYPTION_KEY`;
- `SETUP_TOKEN` while configured;
- `GEMINI_API_KEY`;
- administrator password and active session tokens;
- host integration keys and runtime tokens;
- UI scanner username/password;
- agent resume tokens while active.

Administrator passwords use scrypt with a unique salt. Administrator sessions, integration keys, runtime tokens, and resume tokens are stored as one-way hashes. A password change updates the hash and revokes every other administrator session in one database transaction. Gemini and scanner secrets stored through the console are encrypted with authenticated encryption derived from `MIA_SECRET_ENCRYPTION_KEY`.

The application does not encrypt all PostgreSQL rows or uploaded files. Use encrypted disks, encrypted backups, access-controlled object/block storage, and TLS to an external database as required by the deployment's data classification.

Treat backups as production secrets even when they contain only hashes or encrypted fields. Release CI restores its disposable backup in-run, uploads only non-sensitive checksum and restore-result evidence, and destroys the dump before the runner exits.

## First-Run Setup

An empty production database requires a setup token of at least 32 characters. Setup creates the singleton product and administrator transactionally and closes permanently after success. There are no default credentials.

Custom deployments may remove the setup token after setup. The stock Compose configuration keeps requiring a high-entropy value so accidentally recreated empty volumes cannot expose an unprotected setup path.

## Runtime Tokens

A runtime token is:

- hashed at rest;
- bound to one host `userId`;
- bound to the configured exact product origin;
- limited to explicit capabilities;
- limited by expiry and maximum use count;
- revocable through its parent integration key or product-origin change.

The SDK sends the runtime bearer token plus the browser `Origin`/`Referer`. CORS is enforced separately and is not treated as authentication.

Only a trusted host server may call `POST /api/v1/runtime/tokens` with `x-mia-key`. Never put an integration key in JavaScript, HTML, a mobile bundle, source map, public environment variable, or browser storage.

## Agent Authorization

Gemini may select only:

- current live observation node IDs;
- reviewed UI-map element IDs supplied in context;
- same-origin routes present in live or reviewed product context;
- currently registered host-action names.

The backend never accepts model-created CSS as authority, arbitrary JavaScript, arbitrary URLs, unknown action names, or extra host-action arguments. JSON Schema validates host-action input before the SDK executor receives it.

Read/guidance actions can proceed without approval. Reversible writes require a short-lived confirmation bound to the exact session, revision, action batch, target, arguments, and opaque binding. Text, UI, and voice approval use the same backend resolution. Stale, expired, denied, altered, reused, or mismatched confirmations fail closed.

Every action has an idempotency key. The SDK reports a structured receipt and new observation; the backend records each issued attempt while permitting only one completed receipt for an idempotency key. Equivalent completed actions are replayed as no-ops. Mia re-observes after barriers and requires a final model judgment for both answers and action completion, grounded in validated state and bounded product evidence.

## Prohibited Operations

v1 blocks delete, permanent removal, send, publish, approve, payment, purchase, checkout, transfer/wire, public posting, external communication/email, refund, subscription cancellation, and irreversible submission semantics before execution. The policy applies to DOM actions and host actions regardless of model choice.

Passwords, authentication codes, payment fields, file pickers, CAPTCHA, WebAuthn, and other protected browser operations are manual. Sensitive target values are never issued to an actor.

Host applications should still label risky controls with blocked/manual UI-map policy and must not expose a broadly privileged reversible host action that can indirectly perform a prohibited operation.

## Observation And Redaction

The SDK observes accessibility semantics, visible product text, state, value, focus, selection, and geometry. It traverses open shadow roots and same-origin frames; browser origin rules protect cross-origin frames.

Before network or telemetry boundaries it removes:

- password and recognized secret/payment inputs;
- token-, credential-, card-, and authentication-like values;
- administrator and host-configured `privacy.redactedSelectors` regions;
- Mia's own panel and cursor;
- URL query and page title unless explicitly enabled;
- values matched by configured sensitive patterns.

`transformObservation` and `transformVisualContext` are final host-controlled privacy boundaries. Do not use them to add untrusted secrets back into context.

Visual context is off unless the host supplies `visualContextProvider`. The agent requests it only when semantic context is insufficient. The host decides whether to return a redacted description or image; there is no automatic screen-share request.

## Knowledge And Prompt Injection

Documentation URLs must be HTTPS and belong to administrator-approved origins. The crawler enforces DNS/redirect/resource SSRF policy, page/size limits, and content-type extraction. UI scans enforce the configured product origin and resource allowlist.

Retrieved documents, mapped text, skills, and page content are wrapped as evidence, never instructions with authority. Skills require administrator review and publication. Host-action manifests require independent review and are returned to review whenever their schema/description/risk hash changes.

## Scanner Network Controls

Production scanning blocks loopback, link-local, private, reserved, multicast, and metadata-service targets by default, including redirects and subresources. Public origins are resolved before launch and Chromium is pinned to those validated addresses for the entire scan, preventing DNS rebinding after preflight. `UI_SCAN_ALLOW_PRIVATE_NETWORKS=true` is an explicit deployment-level exception for trusted internal products.

Use a dedicated account with the smallest permissions required. Configure redaction selectors before the first scan. Do not scan broad production administrator sessions or pages containing secrets that cannot be reliably redacted.

## Diagnostics And Retention

Runs may contain transcript text, model assessments, retrieved source references, semantic target labels, approvals, receipt messages/evidence, timing, and token counts. Full transcripts default to 30 days and can be changed to redacted or disabled.

Recognized passwords, tokens, payment data, and configured sensitive values are always redacted. Internal file paths and raw secret records should not be exposed by public APIs. Access to Runs is administrator-only.

The retention sweep removes expired diagnostic records. Backups can retain deleted data longer; align backup retention and destruction with product policy.

## Availability And Abuse Controls

- Request, runtime, setup/login, provider, upload, node-count, context-size, action-batch, scan-route, and file-size limits are enforced.
- A session stops after 24 model steps, three consecutive failed/unverified attempts, or three repeated loop signatures.
- Emergency stop aborts model work, queued actions, speech, navigation animation, and pending interaction in the SDK, then cancels the backend session.
- Production supports one backend replica because rate limits and worker ownership are process-local.

Place additional edge throttling, request-size enforcement, authentication, and denial-of-service protection in front of an internet-facing deployment.

## Rotation And Incident Response

- **Integration key exposed:** revoke it in Settings, create a replacement, and update the host backend. Existing runtime tokens minted from product credentials should be treated as exposed until expiry; changing product origin revokes them immediately but is not a routine rotation mechanism.
- **Gemini key exposed:** rotate it at the provider, update environment/console storage, and review provider usage.
- **Administrator session exposed:** change the password from a trusted active session to revoke every other session, then review Runs and configuration changes.
- **Encryption key exposed:** rotate all encrypted provider/scanner credentials and plan a controlled data-key migration; simply changing the environment key makes stored ciphertext unreadable.
- **PostgreSQL/uploads exposed:** preserve evidence, isolate the deployment, rotate credentials, assess transcript/knowledge scope, restore from a known-good backup if needed, and follow applicable notification requirements.

Report product vulnerabilities privately through [the security policy](../SECURITY.md).
