# Design

## System

Mia Console is a restrained product UI for a self-hosted control plane. It uses a dark neutral interface, compact panels, tabbed settings, status pills, dense tables, and direct action buttons. Visual treatment should support scanning, comparison, and operational confidence.

## Typography

Use the existing Inter/system sans stack. Keep product headings compact and fixed-size. Avoid display typography in labels, buttons, tables, and settings.

## Color

Use neutral surfaces for structure and semantic colors for state:

- Green: configured, passed, active, completed.
- Yellow: warning, needs review, manual action, unverified.
- Red: failed, blocked, revoked, destructive.
- Gray: inactive, empty, loading, informational.

Do not add decorative gradients or one-off accent colors. Color must communicate state or hierarchy.

## Layout

The console shell uses sidebar navigation plus a sticky topbar. On small screens the sidebar is a drawer. Settings are split into focused tabs: Backend, App, Scan profile, Privacy, Admins, and Danger.

Use cards/panels only for bounded tool surfaces. Avoid nested cards. Tables are acceptable for logs, keys, users, sessions, workflows, and UI-map records.

## Components

- Primary buttons are for the next committing action.
- Secondary buttons are for navigation, refresh, copy, and non-committing actions.
- Danger actions require confirmation and use red semantic styling.
- Status pills must always include text, not color alone.
- Inline alerts are persistent for configuration and validation issues.
- Toasts are only supplemental feedback and must not be the only place critical failures appear.

## Flow Rules

- Overview owns activation progress and next-step guidance.
- Settings owns configuration, secrets, privacy, and admin management.
- UI Mapping owns preflight, backend scan, interactive scan, and UI map review.
- Workflow Review owns safety reports, approval, publishing, and step edits.
- API Keys owns key creation and SDK handoff code.

## Privacy

UI scan screens must remind operators that visible UI text and selectors are captured. Scan passwords must not be exposed after save, and per-app scan passwords require encrypted storage.
