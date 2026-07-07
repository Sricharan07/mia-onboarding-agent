# Design

## System

Mia Console is a restrained product UI for a self-hosted control plane: a light, chroma-neutral work surface with a deep green-black sidebar rail that carries the brand. Compact panels, tabbed settings, status pills, dense tables, and direct action buttons. Visual treatment supports scanning, comparison, and operational confidence — the tool disappears into the task.

The end-user SDK surfaces (assistant panel, prompt modal) are theme-aware (light/dark via `prefers-color-scheme`) and use their own cobalt accent (`--mia-accent`), distinct from the console's green, so Mia reads as part of the host product rather than the console.

## Typography

Inter (self-hosted) with system sans fallback. Fixed rem-scale product headings, no display typography in labels, buttons, tables, or settings. Tables use `tabular-nums`. The SDK panel uses the system font stack of the host page.

## Color

Console tokens are OKLCH. Structure is neutral (chroma ≈ 0); identity and action are instrument green (hue ~152):

- `--primary` oklch(0.42 0.075 152) for committing actions, progress fills, and the avatar; `--primary-hover` is a darker step of the same hue.
- `--sidebar` oklch(0.225 0.018 160) dark rail with light text (`--sidebar-foreground`), muted secondary text (`--sidebar-muted`), and a green brand tile (`--sidebar-primary`).
- Semantic state colors are unchanged: green = configured/passed/active, yellow = warning/needs review/unverified, red = failed/blocked/destructive, gray = inactive/empty/informational.
- No gradients, no decorative accents. Color communicates state or hierarchy only.

## Motion

State-driven only, 140–200 ms ease-out: button/nav/input transitions, toast slide-in, panel pop-in and listening pulse in the SDK panel. Every animation has a `prefers-reduced-motion: reduce` fallback. No page-load choreography.

## Layout

The console shell uses the dark sidebar rail plus a sticky topbar. On small screens the sidebar is a drawer. Navigation is three groups, eight items: Console (Overview, Settings), Build (UI map, Workflows), Operate (Test Mia, Runtime logs, Usage, API keys). Detail routes (UI map page, workflow review, upload) highlight their parent nav item and carry a back button.

Settings tabs: Backend, App, Scan profile (auth only — routes live in UI map), Privacy, Admins, Danger.

Use cards/panels only for bounded tool surfaces. Avoid nested cards. Tables are acceptable for logs, keys, users, sessions, workflows, and UI-map records; table headers stick inside scrolling frames.

## Components

- Primary buttons (green) are for the next committing action.
- Secondary buttons are for navigation, refresh, copy, and non-committing actions.
- Danger actions require confirmation and use red semantic styling.
- Status pills must always include text, not color alone, and always human-readable labels (`humanizeStatus` / `humanizeEventType` in `utils/format.ts`) — never raw enums.
- Segmented tabs use a sunken track with a raised active segment.
- Inline alerts are persistent for configuration and validation issues.
- Toasts (dark, top-right) are only supplemental feedback and must not be the only place critical failures appear.
- Error copy goes through `errorMessage()` (console) / `friendlyErrorText()` (SDK): plain language first, technical detail second.

## Flow Rules

- Overview owns activation progress and next-step guidance.
- Settings owns configuration, secrets, privacy, and admin management.
- UI map owns route selection (single source of truth), preflight, backend scan, interactive scan, and map review with selector-fix-group triage.
- Workflows owns the whole lifecycle on one page: upload entry, processing/failed jobs, drafts, and published flows; Workflow review is its detail page for safety reports, approval, publishing, and step edits.
- API Keys owns key creation and the two-step SDK handoff (install, then initialize).

## Privacy

UI scan screens must remind operators that visible UI text and selectors are captured. Scan passwords must not be exposed after save, and per-app scan passwords require encrypted storage. The end-user panel states its capture boundary in plain language ("Mia can see this page" / "Page text hidden from Mia").
