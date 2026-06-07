# Security and Safety Specification

## 1. Core Safety Principle

The runtime agent must not be allowed to freely operate the UI.

It can only execute reviewed and published workflow steps.

```text
Qwen output is not executable.
Runtime LLM output is not executable.
Only reviewed workflow DSL is executable.
```

## 2. Execution Policy

Each executable step must have an execution policy:

```text
auto
requires_confirmation
manual_only
blocked
```

## 3. Policy Meaning

## 3.1 auto

The SDK can perform the action automatically.

Allowed examples:

1. Navigate to safe route.
2. Focus input.
3. Click New Customer.
4. Fill approved form field.
5. Highlight an element.

## 3.2 requires_confirmation

The SDK must ask user before acting.

Examples:

1. Save customer.
2. Send invite.
3. Submit report.
4. Export data.
5. Change settings.

## 3.3 manual_only

The SDK can guide but not perform the action.

Examples:

1. Password entry.
2. Payment form entry.
3. Sensitive personal data.
4. Admin-only operation where user must click.

## 3.4 blocked

The SDK must not execute.

Examples:

1. Delete customer without confirmation.
2. Change permissions without review.
3. Reveal or copy password.
4. Bypass authorization.
5. Arbitrary DOM action not in workflow.

## 4. Human Review

Human review is mandatory before publishing.

Reviewer must approve:

1. Workflow name.
2. Trigger phrases.
3. Steps.
4. Selectors.
5. Prompts.
6. Execution policies.

## 5. Runtime Restrictions

SDK must not:

1. Click arbitrary selectors from the runtime model.
2. Execute unreviewed Qwen output.
3. Fill values into fields not listed in workflow.
4. Skip confirmation for `requires_confirmation`.
5. Execute `blocked` steps.
6. Continue after missing critical element.
7. Perform cross-origin actions.
8. Access hidden secrets.
9. Bypass app permissions.

## 6. Backend Restrictions

Backend must:

1. Return only published workflows to SDK.
2. Validate workflow before publish.
3. Store step policies.
4. Log workflow execution events.
5. Reject invalid runtime session updates.
6. Avoid sending raw secrets to SDK.
7. Keep model provider API keys server-side.

## 7. Console Restrictions

Console must:

1. Show generated workflows as drafts.
2. Clearly display selector quality.
3. Clearly display execution policies.
4. Warn about weak selectors.
5. Prevent publishing invalid workflows.
6. Show unmatched elements before approval.

## 8. Voice Safety

Voice commands can be misheard.

Therefore:

1. Transcripts should be visible to the user where possible.
2. Sensitive actions need confirmation.
3. Cancel/pause should be supported.
4. Runtime LLM confidence should be used for low-confidence fallback.

## 9. User Input Safety

For `ask_user` steps:

1. Store values only in runtime session.
2. Do not log sensitive fields by default.
3. Mark password fields as `manual_only`.
4. Do not speak sensitive values back to the user.
5. Do not send sensitive values to Qwen.

## 10. Sensitive Field Handling

Fields with these types should default to `manual_only`:

```text
password
credit_card
api_key
secret
token
ssn
bank_account
```

For the example app, password login can be guided, but the user should type manually.

## 11. Logs

Logs should include:

1. Workflow id.
2. Step id.
3. Event type.
4. Success/failure.
5. Error message.

Logs should not include:

1. Passwords.
2. API keys.
3. Tokens.
4. Secret values.
5. Sensitive user input.

## 12. Model Output Safety

Qwen and runtime LLM outputs must be validated.

Invalid model output should not crash the backend.

Required:

1. Try/catch around parsing.
2. Zod validation.
3. Store raw output for debugging.
4. Return safe error to console.
5. Never send invalid workflow to SDK.

## 13. Authorization for MVP

For local MVP, use local scoped API keys for SDK/runtime-sensitive backend routes.

Keys:

1. Are created from the console.
2. Are stored only as hashes in SQLite.
3. Are shown in raw form only once on creation.
4. Can be revoked.
5. Can be sent with `Authorization: Bearer` or `x-api-key`.

Protected routes include:

1. Runtime intent resolution.
2. Runtime workflow sessions.
3. LiveKit token generation.
4. TTS generation.
5. Execution log ingestion.

Local console read routes remain usable without a key during MVP development. If a key is supplied, the backend validates the key and enforces the matching read scope.

Supported scopes:

```text
apps:read
ui-map:read
workflows:read
runtime:write
logs:write
logs:read
admin
```

But structure should allow later:

1. Tenant IDs.
2. User roles.
3. Workflow permissions.
4. Per-step authorization.
5. Audit logs.

## 14. UI Mapping Auth Safety

Authenticated UI ingestion uses a dedicated demo/test account through backend Playwright.

Rules:

1. Credentials live only in `.env`.
2. Credentials must not be sent in console request bodies.
3. Credentials must not be logged.
4. Use a demo/test account, not a real user account.
5. MFA, SSO, and CAPTCHA are not automated in MVP.
6. Interactive mapping is local-dev only unless a secure remote browser/VNC setup is added.
7. The crawler must not blindly click arbitrary buttons to discover hidden UI.
8. Hidden dropdowns, popovers, and modals should be captured through manual headed-browser state capture.
9. Captured elements should include state metadata so reviewers know where an element came from.

## 15. Safety Acceptance Criteria

MVP passes if:

1. SDK never executes unpublished workflow.
2. SDK never executes blocked step.
3. SDK asks before `requires_confirmation`.
4. Console blocks invalid publish.
5. Weak selector warning is visible.
6. Model output is validated.
7. Sensitive fields are not logged.
8. Runtime LLM cannot invent a click.
