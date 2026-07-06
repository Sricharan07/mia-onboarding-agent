---
target: complete admin and end-user product flows
total_score: 23
p0_count: 1
p1_count: 4
timestamp: 2026-07-06T04-42-06Z
slug: mia-onboarding-agent-product-flows
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Health/checklist states exist, but they overstate readiness: provider status is unverified and workflows are absent while activation says completed. |
| 2 | Match System / Real World | 2 | Admin concepts are real but too raw: UI maps, state captures, selector quality, provider readiness, and runtime logs require developer interpretation. |
| 3 | User Control and Freedom | 2 | Admin can refresh/sign out/revoke/cancel, but end users lack visible ask, mic, stop, retry, and transcript controls. |
| 4 | Consistency and Standards | 3 | Console component language is consistent and operational; SDK prompt UI is separate and less integrated with host apps. |
| 5 | Error Prevention | 2 | Preflight and scoped keys help, but admin keys sit beside browser keys, activation has false confidence, and screen/voice privacy is not end-user-clear. |
| 6 | Recognition Rather Than Recall | 2 | Setup checklist helps, but push-to-talk, workflow creation, semantic index rebuilds, and scan-headless behavior depend on docs/tribal knowledge. |
| 7 | Flexibility and Efficiency | 2 | Powerful backend/API exists, but product workflows need too many clicks and no grouped debug/session views. |
| 8 | Aesthetic and Minimalist Design | 3 | Console is restrained and credible; logs/tables become dense without prioritization. |
| 9 | Error Recovery | 2 | Inline errors exist; voice/runtime failures are hard to reconstruct from raw event tables. |
| 10 | Help and Documentation | 3 | Docs are broad and security-conscious, but the product does not guide enough in-context. |
| **Total** | | **23/40** | **Promising internal beta, not user-facing ready.** |

## Anti-Patterns Verdict

This does not look like throwaway AI UI. The console has a credible dark control-plane vocabulary and the demo CRM is visually polished. The bigger failure is product trust: the interface says ready before the core promise is demonstrably ready, and Mia is not discoverable as an end-user assistant.

Deterministic scan found 4 warnings, all `overused-font` in `backend/console/src/styles.css` for Inter. For this product register, that is mostly a false positive: Inter is acceptable for a dense operational console. The demo CRM and scoped SDK/demo scan returned no detector findings.

## Overall Impression

The product has real infrastructure, but the human journey is still too implicit. An admin sees a dashboard full of green states but cannot tell whether Mia will actually guide users. An end user sees a cursor but no obvious way to talk to Mia, understand what she can see, stop her, or trust her actions.

## What's Working

- The console visual language is coherent: sidebar, sticky topbar, status pills, tables, and panels feel like an operational admin surface.
- Security posture is better than many early projects: scoped SDK keys, origin restrictions, bootstrap admin, encrypted scan passwords, CORS guidance, and production docs are present.
- The SDK has the right primitives: cursor, DOM runtime context, voice, push-to-talk, workflow executor, confirmations, logging, and cleanup lifecycle.

## Priority Issues

**[P0] End users cannot discover or confidently control Mia.**
Why it matters: if the first user experience is just a mysterious cursor or hidden hotkey, the product feels broken or creepy. The user does not know she can ask, whether mic is active, what Mia sees, or how to stop/retry.
Fix: add a visible Mia control surface in the SDK/demo: ask box, mic button, push-to-talk hint, active listening state, transcript, stop/cancel, privacy indicator, and capability examples pulled from current page context.
Suggested command: $impeccable onboard

**[P1] Admin activation says completed before the product promise is complete.**
Why it matters: the screenshot shows activation complete with zero workflows and provider checks only configured/unverified. That teaches admins to trust a false green state.
Fix: split readiness into Configured, Verified, and User-ready. Add required workflow/demo verification steps: at least one published workflow or explicit “Q&A-only mode,” runtime ask test, point/click test, voice test, and log receipt.
Suggested command: $impeccable clarify

**[P1] Logs are not a usable debugging product.**
Why it matters: when voice or cursor action fails, admins need to know what Mia heard, what she said, what target/action was resolved, and why it failed. A raw event table is not enough.
Fix: replace logs-first view with session timelines grouped by SDK session: user transcript, assistant transcript, runtime resolve result, target, action, provider error, latency, and replayable context summary.
Suggested command: $impeccable harden

**[P1] UI mapping and workflow creation still feel developer-operated.**
Why it matters: scan profiles, Playwright headed browser, state names, selectors, and workflow DSL are powerful but not yet operator-friendly.
Fix: create guided “Map app” and “Create workflow” wizards with preflight explanations, success criteria, privacy warnings, browser-location clarity, and review tasks written in human language before exposing raw tables/JSON.
Suggested command: $impeccable shape

**[P1] Runtime capability is oversold relative to actual behavior.**
Why it matters: without published workflows, Mia mainly answers, points, clicks, or focuses visible elements. “Do stuff” expectations will fail unless workflows exist and runtime context has readable labels/selectors.
Fix: make modes explicit: answer-only, point/click, guided workflow, voice. Surface runtime context coverage and missing labels/selectors in the console and SDK diagnostics.
Suggested command: $impeccable harden

## Persona Red Flags

**Admin Ava, first-time self-hosted operator:** She can sign in and see green checks, but does not know whether provider checks actually ran, why workflows are zero, or what to do after API key creation. She will assume the product is ready and then be embarrassed when Mia only talks.

**Support Sam, debugging a customer complaint:** Sam opens Logs and sees `voice_stopped`, `voice_resolution`, and JSON snippets across dozens of rows. There is no single conversation timeline, no target/action summary, and no “why did Mia not point/click?” answer.

**End User Erin, using the host app:** Erin sees a cursor, but no Mia button, no microphone control, no prompt, no transcript, and no visible privacy boundary. If she does not know Control+Space, Mia might as well not exist.

## Minor Observations

- API key creation places `admin` near browser key scopes; this deserves stronger separation and confirmation.
- Existing API keys cannot recover the raw secret, which is correct, but the UI should still offer a config snippet template and rotation path.
- Mobile console works but dense tables need clearer horizontal-scroll affordances and priority summaries.
- The demo CRM has many “Soon” surfaces; as a Mia demo, that distracts from proving the assistant.
- The SDK prompt modal is functional but visually generic and not clearly host-theme-aware.
- Voice gender should be configurable/testable in product UI; provider voice names alone do not communicate what the user will hear.

## Questions to Consider

- Is Mia primarily an onboarding workflow runner, a page-aware Q&A assistant, or a voice-controlled operator? Right now the product implies all three but proves none completely in the first-run demo.
- What exact screen would convince a skeptical admin: “Mia is now ready for my users”? The current checklist does not answer that.
- Should the default SDK cursor be visible before user intent, or should Mia appear only after the user opens the assistant?
