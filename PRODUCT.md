# Product

## Register

product

## Users

Mia is for product and engineering teams that want to add an AI onboarding and in-app assistance cursor to an existing web application. The primary operator is a self-hosted admin who configures one or more customer apps, scans their UI, reviews generated workflows, creates scoped SDK keys, and verifies the SDK inside the customer app.

## Product Purpose

Mia provides a browser SDK and self-hosted backend/console that lets a host product guide users through onboarding flows, answer questions about the current screen, and run approved workflow steps safely. Success means a customer can install the SDK, map their own web app, publish reviewed workflows, and observe runtime behavior without relying on hosted Mia infrastructure.

## Brand Personality

Practical, trustworthy, and precise. The interface should feel like an operational control plane for a safety-sensitive SDK, not a marketing demo or CRM dashboard.

## Anti-references

Avoid CRM-specific defaults, mock dashboards, decorative AI assistant pages, mystery setup tokens, raw JSON-first review, and flows that require reading repository docs before the console becomes usable.

## Design Principles

- Guide activation from inside the console: first-run users should always see the next setup step.
- Treat scans and workflows as safety-sensitive operations: show preflight, privacy, selector quality, and review blockers before execution or publishing.
- Keep self-hosted operations explicit: surface env names, secret storage status, provider readiness, and admin/session controls.
- Make SDK handoff concrete: generated keys should immediately produce installable initialization code.
- Prefer dense, predictable product UI over decorative surfaces.

## Accessibility & Inclusion

Target WCAG 2.1 AA for the console. All status changes must be textual, keyboard-accessible, and announced when they affect task progress. Motion must be state-driven and disabled or simplified for reduced-motion users.
