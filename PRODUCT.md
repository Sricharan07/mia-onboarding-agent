# Product

## Purpose

Mia gives an existing web product an intelligent in-app helper that can answer questions, guide users through unfamiliar UI, and complete approved reversible work. The product team self-hosts the backend and console; end users interact with Mia inside the product through the browser SDK.

## v1 Deployment Shape

- One product and one exact production origin.
- One administrator.
- One Gemini provider architecture.
- One persisted agent shared by text and voice.
- One session's memory only; no cross-session personal memory.
- Embedded SDK only; no extension, arbitrary websites, tabs, operating-system control, or physical pointer control.

This narrow shape is deliberate. It removes tenancy and compatibility complexity from the safety-sensitive path.

## Users

### Product administrator

The administrator configures Gemini, product origin, redaction, documentation, scan access, runtime keys, host-action policy, skills, transcripts, and retention. They validate the real SDK through Q&A, pointing, navigation, confirmed mutation, and voice scenarios, then diagnose runs from evidence rather than opaque logs.

### Product user

The product user asks naturally by text or voice. Mia answers when an answer is enough, points when orientation is enough, navigates when the destination is clear, asks for missing input when needed, and requests an exact confirmation before a reversible change. The user can interrupt, decline, stop, or close Mia at any time.

### Host-product engineer

The engineer installs the framework-neutral ESM SDK, creates a trusted server token exchange, registers reviewed host actions and context providers, defines privacy boundaries, and supplies optional semantic or visual context for custom-rendered surfaces.

## Product Principles

- **Reason first, constrain always.** Gemini chooses the useful response; deterministic code enforces identity, policy, targets, schemas, confirmation, limits, idempotency, and verification.
- **Live UI is truth.** UI maps and skills help reasoning, but the current semantic observation determines what exists now.
- **Do the least risky useful thing.** Answer or point when action is unnecessary. Ask before reversible change. Block irreversible operations.
- **One conversation across modalities.** Voice and text share goal, context, policies, receipts, and completion judgment.
- **Evidence over confidence.** Mia claims completion only after verified UI state or a structured host receipt.
- **Privacy before context.** Secrets and private regions are removed before provider or diagnostic boundaries.
- **Operational clarity.** The console always shows the next setup task, effective safety policy, and enough run evidence to explain behavior.

## Success Criteria

Mia is successful when a new operator can start an empty deployment, configure one product without external assistance, install the package without repository coupling, and repeatedly pass these live scenarios:

- grounded product Q&A;
- visible pointing to the correct control;
- approved same-origin navigation;
- confirmed draft creation or reversible edit;
- equivalent text and voice behavior;
- reload recovery and emergency stop;
- safe refusal of protected operations.

## Non-Goals For v1

- Multi-product or multi-tenant administration.
- Cross-session personalization or autonomous background work.
- Arbitrary JavaScript, arbitrary selectors, cross-origin browsing, or OS automation.
- Automatic file, credential, payment, CAPTCHA, WebAuthn, delete, send, publish, approve, pay, external communication, or irreversible submit operations.
- Deterministic intent classifiers or fixed workflow script execution.
