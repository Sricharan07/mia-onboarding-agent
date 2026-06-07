# Console Changes

This file tracks code changes made while working on the MIA onboarding agent codebase, with the reason for each change and the impact on behavior.

Update this file every time the codebase changes.

## 2026-06-07

### Right-side content centered in console

Files changed:
- [backend/console/src/styles.css](/Users/naveen/Hack/mia-onboarding-agent/backend/console/src/styles.css)

Why this changed:
- Console pages such as Upload workflow were hugging the left edge of the main content area, leaving the right side visually unbalanced.

What changed:
- Centered narrow page content within the right-hand main area by adding auto horizontal margins to the narrow page grid.

Result:
- The main window content is centered in the right-side workspace without changing the sidebar.

Validation:
- Not run after this layout-only tweak.

### UI map scan panel polish

Files changed:
- [backend/console/src/pages/UiMapPages.tsx](/Users/naveen/Hack/mia-onboarding-agent/backend/console/src/pages/UiMapPages.tsx)
- [backend/console/src/styles.css](/Users/naveen/Hack/mia-onboarding-agent/backend/console/src/styles.css)

Why this changed:
- The first callout box and the auth mode dropdown looked too close to default browser controls.
- The scan panel needed a cleaner hierarchy so the guidance text reads like part of the interface, not a pasted note.

What changed:
- Added dedicated scan panel classes for the callout, route textarea, and auth dropdown.
- Styled the callout as a softer highlighted information panel with better spacing and alignment.
- Reworked the auth dropdown into a custom-styled control with a consistent dark-console look and custom caret.
- Increased spacing and alignment inside the scan form so the top section feels intentional.

Result:
- The scan panel should look more polished and less like raw form controls.
- The first information box now reads as a designed UI element instead of a dashed placeholder.

Validation:
- Not run yet after this styling change.

### Workflow job status now follows workflow state

Files changed:
- [backend/src/services/workflows/workflowService.ts](/Users/naveen/Hack/mia-onboarding-agent/backend/src/services/workflows/workflowService.ts)
- [backend/src/db/repositories.ts](/Users/naveen/Hack/mia-onboarding-agent/backend/src/db/repositories.ts)
- [backend/src/routes/workflows.ts](/Users/naveen/Hack/mia-onboarding-agent/backend/src/routes/workflows.ts)

Why this changed:
- Workflow jobs were staying in `needs_review` even after the related workflow had been approved and published.
- The workflow record and the job record were being updated independently, so the console could show stale job status.

What changed:
- When a workflow is approved, published, archived, or edited, the originating workflow job is now synced to the matching status.
- The job listing endpoint now resolves the current workflow status when a workflow is linked to the job.
- The single workflow-job endpoint also returns the live workflow status when available.

Result:
- The console now reflects the workflow lifecycle correctly.
- Published workflows no longer appear stuck in `needs_review` after approval/publish actions.

Validation:
- `npm test`
- `npm run build`
