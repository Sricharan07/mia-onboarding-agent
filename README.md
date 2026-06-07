# Mia

## Turn one screen recording into an AI onboarding and support agent.

Mia watches how a task is completed in your product, learns the workflow, and helps every new user complete it through voice or text.

Instead of sending users to documentation or support tickets, Mia appears inside the product, explains what to do, highlights where to click, and guides them step by step.

> Record it once. Let Mia support every user.

![Mia architecture overview](flowcharts/Arch-overview.png)

## What Mia Does

Imagine a new employee opening a CRM for the first time.

They do not know where to request access, upload documents, update a lead, or finish onboarding. Instead of searching through documentation, they ask Mia:

> “Help me request CRM access.”

Mia then:

1. Understands what the employee wants.
2. Opens the correct page.
3. Highlights the next button or field.
4. Explains what information is needed.
5. Waits for confirmation when an action is sensitive.
6. Continues until the task is complete.

The employee can speak naturally or use text throughout the workflow.

## One Video Becomes A Reusable Workflow

Creating support with Mia takes one demonstration:

1. **Record the task**  
   Complete the workflow once while recording your screen.

2. **Upload the video**  
   Mia understands the visible actions and the goal of the workflow.

3. **Match the product UI**  
   Mia connects each action to the real buttons, forms, and pages in your application.

4. **Review and publish**  
   Your team checks the generated steps before users can access them.

5. **Support every user**  
   Mia can now guide customers through the same task inside your product.

```text
One screen recording
        ↓
Mia understands the task
        ↓
Your team reviews the steps
        ↓
The workflow is published
        ↓
Users receive voice or text guidance
```

## See Mia In Action

### Manage Everything From The Mia Console

See application health, mapped UI elements, workflow status, recent jobs, and provider readiness in one place.

![Mia Console overview](<flowcharts/Screenshot 2026-06-07 at 11.20.18 AM.jpg>)

### Turn Recordings Into Reviewed Workflows

Upload a screen recording, follow its processing status, and open the generated workflow for review before publishing it.

![Mia workflow processing jobs](<flowcharts/Screenshot 2026-06-07 at 11.22.06 AM.jpg>)

### Connect Workflows To The Real Product UI

Mia maps the actual buttons, links, fields, and selectors in the product so every guided action points to a visible interface element.

![Mia mapped CRM interface elements](<flowcharts/Screenshot 2026-06-07 at 11.23.55 AM.jpg>)

### Guide Users Inside The Real Product

This is the kind of product users work in every day. Mia lives right here, helping them find the next step without leaving the screen.

![Demo CRM dashboard where Mia helps users](<flowcharts/Screenshot 2026-06-07 at 11.29.21 AM.png>)

## The Customer Experience

Mia is an in-product copilot, not another help center.

- Ask questions using **text or speech**.
- Hear Mia respond with **natural voice output**.
- See an **AI cursor** move to the correct control.
- Get the next button, field, or menu **highlighted on screen**.
- Complete forms with guided prompts.
- Pause, resume, or switch between voice and text.
- Confirm important actions before Mia continues.
- Stay inside the product from question to completion.

## Example Workflows

Mia can help a new employee:

- Request CRM access.
- Submit missing onboarding documents.
- Add and qualify a new lead.
- Complete a security checklist.
- Configure notifications and preferences.
- Find a customer account.
- Update an opportunity stage.
- Invite a teammate.
- Generate a report.
- Complete their first-day onboarding.

Each workflow is made of visible interactions. Every click changes the UI, updates data, opens the next step, or confirms progress so the user always understands what Mia is doing.

## Why Mia

Traditional product support usually stops at instructions.

| Traditional support | Mia |
| --- | --- |
| Sends users to documentation | Guides users inside the product |
| Explains where to click | Highlights and moves to the correct control |
| Repeats the same answers | Reuses a reviewed workflow for every user |
| Separates voice, chat, and onboarding | Combines voice, text, and guided actions |
| Leaves users to finish alone | Stays with the user until completion |

## One Platform, Two Experiences

### Product Teams

Teams use the Mia Console to:

- Map their application UI.
- Upload workflow recordings.
- Review the steps Mia creates.
- Edit instructions and confirmation rules.
- Publish approved workflows.
- Create SDK API keys.
- Monitor usage and workflow activity.

### Product Users

Users see Mia directly inside the application. They ask for help, follow the visual guidance, provide information when requested, and complete the task without leaving the current screen.

![Developer and customer workflow](flowcharts/Screenshot_2026-06-07_at_1.36.08_AM.png)

## Human Reviewed, AI Guided

Mia does not allow a model to freely control the application.

- AI-generated workflows must be reviewed before publication.
- Only published workflows can run in the SDK.
- Sensitive steps require user confirmation.
- Manual-only steps guide the user without clicking for them.
- Every workflow action is recorded.

This keeps the experience helpful without removing control from the product team or the user.

## Technology Behind Mia

Mia brings together four focused parts:

- **Qwen** understands recordings, user requests, speech, and spoken responses.
- **MOSS** finds the most relevant UI elements and approved workflows.
- **LiveKit** powers realtime voice conversations.
- **Mia SDK** shows the assistant, cursor, highlights, and guided actions inside your product.

Together, they let Mia listen, understand, and respond — while only reviewed workflows decide what can actually happen in the product.

![Mia system architecture](flowcharts/Low-level-arch.png)

## Repository

```text
mia-onboarding-agent/
├── backend/console/    # Mia developer console
├── backend/dist/       # Backend build
├── sdk/dist/           # Embeddable Mia SDK build
├── example/demo-crm/   # Interactive CRM demo
└── flowcharts/         # Product architecture
```

## Run The Demo Locally

Start the backend:

```bash
node backend/dist/server.js
```

Start the Mia Console:

```bash
cd backend/console
npm install
npm run dev
```

Start the demo CRM:

```bash
cd example/demo-crm
npm install
npm run dev
```

The console opens on `http://localhost:5173` and the demo CRM opens on `http://localhost:3000/dashboard/default`.

## Vision

Every product should be able to support a new user from their first question to a completed task.

Mia turns the workflows already known by your team into interactive, reusable support that speaks, explains, points, and helps users finish the work.
