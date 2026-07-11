# Design

## Product Character

Mia has two distinct surfaces:

- The administrator console is a quiet operational control plane. It prioritizes scanning, comparison, review, and repeated action over decoration.
- The embedded assistant is compact liquid glass. It should feel native enough to coexist with any host product while remaining clearly identifiable as Mia.

Both surfaces favor confidence over spectacle: clear state, precise copy, visible evidence, predictable controls, and no hidden automation.

## Console

The console uses self-hosted Inter, a neutral work surface, a charcoal navigation rail, green committing actions, blue informational accents, and semantic amber/red states. Headings remain compact. Tables, split workspaces, forms, and status rows carry most of the interface; decorative cards and marketing composition do not.

The fixed information architecture follows the deployment lifecycle:

1. Setup
2. Overview
3. Knowledge
4. Skills
5. Actions & Safety
6. Test Mia
7. Runs
8. Settings

There are no app switchers, environments, invitations, or tenant navigation. The configured product and origin stay visible in the rail so the administrator always knows what production surface is being changed.

## Embedded Assistant

The collapsed launcher shows Mia's identity, readiness, and one status indicator. Opening it morphs into one glass panel anchored to the same edge; the launcher does not remain duplicated underneath.

The expanded panel contains only:

- transcript or concise ready/progress state;
- one text input;
- microphone control;
- send;
- emergency stop;
- contextual approval or missing-input controls when required.

The panel uses a translucent near-black material, fine light borders, restrained teal/violet identity accents, soft blur, and short state-driven motion. It must remain within the viewport at every supported size and never block its own visible cursor or controls.

## Cursor

Mia's cursor is separate from the user's physical pointer. It can move, point, highlight, and show a brief message bubble, but it never pretends to create trusted physical events. Coordinates position the visual; validated semantic targets authorize actions.

The cursor must stay above host content and below Mia's own controls. Navigation, cancellation, reduced motion, and viewport edges must not leave stale highlights or bubbles behind.

## Components

- Use Lucide icons for familiar actions and tooltips or accessible names for icon-only controls.
- Buttons use a maximum 6 to 7 pixel radius. Text commands are reserved for clear actions; familiar utilities use icons.
- Status badges always include text and never communicate by color alone.
- Tables own dense records; split panes own list-detail review; sections remain unframed unless they are a bounded tool.
- Destructive controls use explicit red styling and a separate confirmation boundary.
- Errors remain inline near the failed task. Toasts are supplemental, never the only error channel.
- Empty, loading, partial, failure, and retry states are first-class parts of every asynchronous workflow.

## Typography And Layout

- Letter spacing is always zero.
- Viewport width never controls font size.
- Display-scale type is not used inside tools, tables, panels, or sidebars.
- Fixed-format controls use stable dimensions so labels, status, and loading content cannot shift surrounding layout.
- Mobile pages must have zero document-level horizontal overflow. Dense tables may scroll only inside their own bounded container.
- The sidebar becomes an accessible drawer below 900 pixels; focus, dismissal, and backdrop behavior remain explicit.

## Motion And Accessibility

Motion is state-driven and generally 140 to 220 milliseconds. The assistant may use one slightly longer glass-panel morph, but no ambient animation competes with the task. `prefers-reduced-motion` removes nonessential movement and smooth scrolling.

Target WCAG 2.2 AA. Every operation must be reachable by keyboard, have a visible focus state, expose a meaningful accessible name, preserve logical focus after updates, and announce consequential status changes. Text and controls must remain readable at browser zoom and mobile widths.

## Content Rules

Write from the administrator's or user's point of view, not the implementation's. Name what happened, what is required, and what Mia will or will not do. Confirmation copy names the exact reversible change and target. Do not expose model internals, raw enum names, secret values, internal file paths, or source citations in the end-user assistant.
