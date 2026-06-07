# Mia Employee Onboarding Demo Workflows

## Goal

This demo shows how Mia helps a new employee use the CRM/onboarding app after the SDK is installed. The experience should feel guided, visible, and interactive:

1. The employee hits an issue.
2. Mia pops up with guidance.
3. Mia highlights the exact UI element to click.
4. The employee clicks.
5. The UI visibly changes.
6. Demo data/state updates.
7. Mia confirms the result and moves to the next step.

Use Ashwin Kumar as the demo employee.

```ts
const demoEmployee = {
  name: "Ashwin Kumar",
  email: "itachi@hiringbae.com",
  role: "New Account Executive",
  manager: "Maya Patel",
  department: "Revenue",
};
```

## Core Visible Demo Elements

These should be visible somewhere in the demo UI so viewers can clearly see Mia changing the product state.

| Element | What Changes Visibly |
|---|---|
| Mia Assistant Popup | Opens, changes message, shows next action button |
| Mia Spotlight Highlight | Highlights the next button, card, row, or field to click |
| Onboarding Progress Bar | Moves from one percentage to another |
| Task Status Cards | Status changes: `Not Started`, `In Progress`, `Completed`, `Blocked` |
| Access Request Cards | Status changes: `Missing`, `Pending Approval`, `Approved` |
| Document Rows | Status changes: `Required`, `Uploading`, `Submitted`, `Verified` |
| CRM Lead Row | Lead stage changes: `New`, `Contacted`, `Qualified` |
| Activity Log | New row appears after every Mia-guided action |
| Toast Notification | Shows short confirmation after each completed action |
| Step Timeline | Current step moves forward as the employee follows Mia |

## Five Additional Visual Elements To Add

These are extra visible elements that make the artificial demo easier to understand.

| New Element | Purpose | Example Visual Change |
|---|---|---|
| Mia Action Trail | Shows what Mia just did | Adds `Mia highlighted CRM access request` |
| Field Diff Preview | Shows before/after data | `Status: Missing -> Pending Approval` |
| Guided Cursor Marker | Points at exact click target | Animated pointer moves to button or row |
| Employee Confidence Meter | Shows employee friction going down | `Confused -> Guided -> Completed` |
| Demo Data Inspector | Shows state changes for viewers | JSON/state panel updates after each click |

## Demo State Shape

```ts
type DemoState = {
  onboarding: {
    progress: number;
    currentWorkflow: string | null;
    currentStep: number;
  };
  mia: {
    open: boolean;
    message: string;
    spotlightTarget: string | null;
    activeWorkflow: string | null;
  };
  employee: {
    name: string;
    email: string;
    manager: string;
    confidence: "Confused" | "Guided" | "Completed";
  };
  tasks: Record<string, "not_started" | "in_progress" | "completed" | "blocked">;
  access: Record<string, "missing" | "pending" | "approved">;
  documents: Record<string, "required" | "uploading" | "submitted" | "verified">;
  leads: Record<string, { status: "new" | "contacted" | "qualified"; owner: string }>;
  activityLog: Array<{
    id: string;
    title: string;
    actor: "Mia Assistant" | "Ashwin Kumar";
    timestamp: string;
    type: "mia_action" | "employee_action" | "system_update";
  }>;
};
```

---

# Workflow 1: Employee Is Lost On First Day

## Story Issue

Ashwin opens the app and does not know where to begin. Mia should guide him to the first onboarding task.

| Step | Employee Click | Mia Guidance | Visible UI Update | Demo Data Update |
|---|---|---|---|---|
| 1 | Click `Ask Mia` floating button | Mia opens: `I can guide your first-day onboarding.` | Mia popup appears in bottom-right | `mia.open = true`, `employee.confidence = "Confused"` |
| 2 | Click `Start guided onboarding` | Mia says: `Start with your first required task.` | Spotlight moves to `Onboarding Tasks` card | `mia.spotlightTarget = "onboarding_tasks"` |
| 3 | Click highlighted `Complete profile` task | Mia says: `Open this task and I will walk you through it.` | Task drawer opens | `onboarding.currentStep = 3`, `tasks.complete_profile = "in_progress"` |
| 4 | Click `Start task` | Mia says: `Fill the missing fields first.` | Profile form fields glow briefly | `tasks.complete_profile = "in_progress"` |
| 5 | Click `Save profile info` | Mia says: `Profile saved. You are ready for the next step.` | Task badge changes `In Progress -> Completed` | `tasks.complete_profile = "completed"` |
| 6 | Click `Next step` in Mia | Mia says: `I updated your onboarding progress.` | Progress bar moves `0% -> 20%`; activity log adds row | `onboarding.progress = 20`, `employee.confidence = "Guided"` |

Activity log row:

```ts
{
  id: "activity_profile_completed",
  title: "Mia guided Ashwin through profile setup",
  actor: "Mia Assistant",
  timestamp: "Just now",
  type: "mia_action",
}
```

---

# Workflow 2: Employee Cannot Access CRM

## Story Issue

Ashwin clicks CRM but cannot access the tool. Mia should explain the issue and help him submit an access request.

| Step | Employee Click | Mia Guidance | Visible UI Update | Demo Data Update |
|---|---|---|---|---|
| 1 | Click `CRM` in sidebar | Mia detects blocked page | CRM page shows `Access required` banner | `access.crm = "missing"` |
| 2 | Click `Ask Mia for help` on banner | Mia says: `You need CRM access. I can request it for you.` | Mia popup opens with `Request CRM access` button | `mia.activeWorkflow = "crm_access"` |
| 3 | Click `Request CRM access` | Mia says: `I highlighted the access form.` | Access request modal opens | `mia.spotlightTarget = "crm_access_modal"` |
| 4 | Click `Submit request` | Mia says: `Request sent to your manager.` | CRM access card changes `Missing -> Pending Approval` | `access.crm = "pending"` |
| 5 | Click `Notify manager` | Mia says: `I notified Maya Patel.` | Toast: `Manager notified`; activity log row appears | `notifications.manager.crmAccess = true` |
| 6 | Click `Done` | Mia says: `You can continue with training while approval is pending.` | Step timeline advances; progress moves `20% -> 30%` | `onboarding.progress = 30` |

Visible data diff:

```ts
{
  before: { crmAccess: "missing" },
  after: { crmAccess: "pending" },
}
```

---

# Workflow 3: Missing Required Documents

## Story Issue

Ashwin has not uploaded required onboarding documents. Mia should guide him through submitting demo documents.

| Step | Employee Click | Mia Guidance | Visible UI Update | Demo Data Update |
|---|---|---|---|---|
| 1 | Click `Documents` task | Mia says: `Two required documents are missing.` | Documents panel opens with red `Required` badges | `documents.id = "required"`, `documents.tax = "required"` |
| 2 | Click `Upload ID` highlighted by Mia | Mia says: `Use the demo file to simulate upload.` | ID row expands; upload button is highlighted | `mia.spotlightTarget = "upload_id"` |
| 3 | Click `Use demo file` | Mia says: `Uploading ID verification.` | ID row spinner appears | `documents.id = "uploading"` |
| 4 | Click `Confirm upload` | Mia says: `ID submitted for review.` | ID badge changes `Uploading -> Submitted` | `documents.id = "submitted"` |
| 5 | Click `Upload tax form` | Mia says: `Now submit your tax form.` | Tax form row expands | `documents.tax = "uploading"` |
| 6 | Click `Submit tax form` | Mia says: `Documents submitted. HR can review them now.` | Progress moves `30% -> 45%`; activity log updates | `documents.tax = "submitted"`, `onboarding.progress = 45` |

Activity log row:

```ts
{
  id: "activity_docs_submitted",
  title: "Required onboarding documents submitted",
  actor: "Mia Assistant",
  timestamp: "Just now",
  type: "system_update",
}
```

---

# Workflow 4: First CRM Lead Update

## Story Issue

Ashwin does not know how to update his first lead in the CRM. Mia should guide him to a lead row and tell him exactly what to change.

| Step | Employee Click | Mia Guidance | Visible UI Update | Demo Data Update |
|---|---|---|---|---|
| 1 | Click `CRM Leads` | Mia says: `I found your first assigned lead.` | Leads table opens | `onboarding.currentWorkflow = "first_crm_update"` |
| 2 | Click `Show me` in Mia | Mia says: `Click this lead row.` | Spotlight highlights `HiringBae Demo Lead` row | `mia.spotlightTarget = "lead_demo_001"` |
| 3 | Click highlighted lead row | Mia says: `Open the status dropdown.` | Lead detail drawer opens | `selectedLead = "demo_lead_001"` |
| 4 | Click `Status` dropdown | Mia says: `Move the lead from New to Contacted.` | Dropdown opens with stage options | `leadEdit.field = "status"` |
| 5 | Click `Contacted` | Mia says: `Great. Save this update.` | Status pill changes `New -> Contacted` | `leads.demo_lead_001.status = "contacted"` |
| 6 | Click `Save update` | Mia says: `First CRM update completed.` | Activity log adds row; task card changes to completed | `tasks.first_crm_update = "completed"`, `onboarding.progress = 55` |

Visible data diff:

```ts
{
  before: { leadStatus: "new" },
  after: { leadStatus: "contacted" },
}
```

---

# Workflow 5: Employee Needs Manager Help

## Story Issue

Ashwin is stuck and needs to contact his manager. Mia should find the manager and help create a message.

| Step | Employee Click | Mia Guidance | Visible UI Update | Demo Data Update |
|---|---|---|---|---|
| 1 | Click `Ask Mia` | Mia opens assistant popup | Popup shows quick prompts | `mia.open = true` |
| 2 | Click prompt `Who is my manager?` | Mia says: `Your manager is Maya Patel.` | Manager card appears in Mia popup | `mia.activeWorkflow = "manager_help"` |
| 3 | Click `Message manager` | Mia says: `I opened a message draft.` | Mail composer slides in | `mail.draft.type = "manager_help"` |
| 4 | Click `Use Mia template` | Mia says: `I wrote a short help request.` | Message body fills automatically | `mail.draft.bodyGenerated = true` |
| 5 | Click `Send message` | Mia says: `Message sent to Maya.` | Toast: `Message sent`; outbox count increments | `mail.sent.managerHelp = true` |
| 6 | Click `Mark task done` | Mia says: `I marked manager contact complete.` | Task status changes `In Progress -> Completed`; progress moves `55% -> 65%` | `tasks.contact_manager = "completed"`, `onboarding.progress = 65` |

---

# Workflow 6: Employee Needs Laptop And Badge

## Story Issue

Ashwin does not have equipment assigned. Mia should guide him through requesting a laptop and employee badge.

| Step | Employee Click | Mia Guidance | Visible UI Update | Demo Data Update |
|---|---|---|---|---|
| 1 | Click `Equipment` task | Mia says: `Your laptop and badge are not assigned yet.` | Equipment panel opens with `Not Requested` badges | `equipment.laptop = "not_requested"`, `equipment.badge = "not_requested"` |
| 2 | Click `Ask Mia` | Mia says: `I can create both requests.` | Mia popup shows `Create equipment request` | `mia.activeWorkflow = "equipment_request"` |
| 3 | Click `Create equipment request` | Mia says: `Select what you need.` | Checklist appears with `Laptop` and `Badge` checked | `equipment.requestDraft = ["laptop", "badge"]` |
| 4 | Click `Submit request` | Mia says: `Equipment request submitted.` | Equipment cards change `Not Requested -> Pending` | `equipment.laptop = "pending"`, `equipment.badge = "pending"` |
| 5 | Click `Notify IT` | Mia says: `IT has been notified.` | IT notification badge appears | `notifications.it.equipment = true` |
| 6 | Click `Done` | Mia says: `You will see updates here when IT approves.` | Activity log row appears; confidence meter moves `Confused -> Guided` | `employee.confidence = "Guided"` |

Visible data diff:

```ts
{
  before: { laptop: "not_requested", badge: "not_requested" },
  after: { laptop: "pending", badge: "pending" },
}
```

---

# Workflow 7: Employee Must Complete Security Training

## Story Issue

Ashwin has not completed security training. Mia should guide him through starting and passing the demo quiz.

| Step | Employee Click | Mia Guidance | Visible UI Update | Demo Data Update |
|---|---|---|---|---|
| 1 | Click `Security Training` task | Mia says: `This is required before CRM access can be approved.` | Training card opens with `Not Started` badge | `training.security = "not_started"` |
| 2 | Click `Start training` | Mia says: `Complete the short security lesson.` | Lesson progress changes `0/3 -> 1/3` | `training.security = "in_progress"` |
| 3 | Click `Next lesson` | Mia says: `Review phishing guidance.` | Lesson progress changes `1/3 -> 2/3` | `training.securityLesson = 2` |
| 4 | Click `Take quiz` | Mia says: `Answer the demo question.` | Quiz panel opens | `training.quizOpen = true` |
| 5 | Click correct answer `Report suspicious email` | Mia says: `Correct. Security training passed.` | Score card changes `0% -> 100%` | `training.securityScore = 100` |
| 6 | Click `Complete training` | Mia says: `I updated your training status.` | Task changes `In Progress -> Completed`; progress moves `65% -> 75%` | `training.security = "completed"`, `onboarding.progress = 75` |

Activity log row:

```ts
{
  id: "activity_security_completed",
  title: "Security training completed with Mia guidance",
  actor: "Mia Assistant",
  timestamp: "Just now",
  type: "mia_action",
}
```

---

# Workflow 8: Employee Needs To Schedule First Manager 1:1

## Story Issue

Ashwin has not scheduled his first manager meeting. Mia should guide him to choose a time and add it to the onboarding timeline.

| Step | Employee Click | Mia Guidance | Visible UI Update | Demo Data Update |
|---|---|---|---|---|
| 1 | Click `Schedule manager 1:1` task | Mia says: `Maya has three open times this week.` | Calendar panel opens with suggested slots | `calendar.suggestionsVisible = true` |
| 2 | Click `Ask Mia to pick best time` | Mia says: `I recommend Tuesday at 10:00 AM.` | Recommended slot gets highlighted | `calendar.recommendedSlot = "tuesday_10"` |
| 3 | Click highlighted `Tuesday 10:00 AM` | Mia says: `This time works. Confirm it.` | Slot changes to selected state | `calendar.selectedSlot = "tuesday_10"` |
| 4 | Click `Confirm meeting` | Mia says: `Meeting scheduled.` | Calendar event appears | `calendar.managerOneOnOne = "scheduled"` |
| 5 | Click `Add agenda` | Mia says: `I added starter agenda items.` | Agenda list fills with 3 bullets | `calendar.agendaGenerated = true` |
| 6 | Click `Mark scheduled` | Mia says: `Your manager 1:1 task is complete.` | Task badge changes to `Completed`; progress moves `75% -> 82%` | `tasks.manager_one_on_one = "completed"`, `onboarding.progress = 82` |

---

# Workflow 9: Employee Has A Blocked Payroll Setup

## Story Issue

Ashwin started payroll setup but missed bank information. Mia should identify the missing field and guide him to fix it.

| Step | Employee Click | Mia Guidance | Visible UI Update | Demo Data Update |
|---|---|---|---|---|
| 1 | Click `Payroll Setup` task | Mia says: `Payroll is blocked because bank details are missing.` | Payroll card shows red `Blocked` badge | `tasks.payroll_setup = "blocked"` |
| 2 | Click `Fix with Mia` | Mia says: `Click the bank details section.` | Spotlight highlights `Bank details` accordion | `mia.spotlightTarget = "bank_details"` |
| 3 | Click `Bank details` | Mia says: `Use demo bank data to continue.` | Bank form expands | `payroll.bankFormOpen = true` |
| 4 | Click `Use demo bank data` | Mia says: `I filled the required demo fields.` | Form fields populate | `payroll.bankFieldsComplete = true` |
| 5 | Click `Save payroll info` | Mia says: `Payroll setup is no longer blocked.` | Payroll badge changes `Blocked -> Submitted` | `tasks.payroll_setup = "in_progress"`, `payroll.status = "submitted"` |
| 6 | Click `Continue onboarding` | Mia says: `Payroll has been sent for review.` | Progress moves `82% -> 88%`; activity log row appears | `onboarding.progress = 88` |

Visible data diff:

```ts
{
  before: { payrollStatus: "blocked" },
  after: { payrollStatus: "submitted" },
}
```

---

# Workflow 10: Employee Completes Final Readiness Review

## Story Issue

Ashwin has completed most steps and needs final readiness review. Mia should summarize open items and help finish the last one.

| Step | Employee Click | Mia Guidance | Visible UI Update | Demo Data Update |
|---|---|---|---|---|
| 1 | Click `Readiness Review` | Mia says: `You have one final item before review.` | Review panel opens with checklist | `review.open = true` |
| 2 | Click `Show remaining item` | Mia says: `Acknowledge the sales playbook.` | Spotlight highlights `Sales Playbook` row | `mia.spotlightTarget = "sales_playbook"` |
| 3 | Click `Sales Playbook` | Mia says: `Read and acknowledge this guide.` | Playbook drawer opens | `playbook.open = true` |
| 4 | Click `Acknowledge` | Mia says: `Acknowledgement recorded.` | Row changes `Pending -> Acknowledged` | `playbook.acknowledged = true` |
| 5 | Click `Request review` | Mia says: `I sent your onboarding for final review.` | Review status changes `Not Ready -> Ready for Review` | `review.status = "ready"` |
| 6 | Click `Finish guided demo` | Mia says: `Onboarding workflow complete.` | Progress moves `88% -> 100%`; success banner appears | `onboarding.progress = 100`, `employee.confidence = "Completed"` |

Activity log row:

```ts
{
  id: "activity_ready_for_review",
  title: "Ashwin is ready for onboarding review",
  actor: "Mia Assistant",
  timestamp: "Just now",
  type: "system_update",
}
```

---

# Recommended Demo Screen Layout

## Left Sidebar

- Dashboard
- Onboarding
- CRM Leads
- Documents
- Training
- Payroll
- Equipment
- Mail

## Main Content

- Current onboarding workflow card
- Progress bar
- Task cards
- Data table or form for the current workflow
- Activity log

## Right Side Or Floating Layer

- Mia assistant popup
- Current instruction
- `Next` or action button
- Highlight target label
- Data diff preview

## Viewer-Facing Demo Panel

This is optional but useful for a hackathon/demo. It shows the fake state changing in real time.

```ts
{
  activeWorkflow: "crm_access",
  currentStep: 4,
  changedField: "access.crm",
  before: "missing",
  after: "pending",
}
```

# Implementation Rule

For every Mia-guided step:

1. Update one visible UI element.
2. Update one data/state value.
3. Add one activity log entry for completed actions.
4. Move Mia spotlight to the next target.
5. Keep the change obvious enough that a viewer can understand it without explanation.
