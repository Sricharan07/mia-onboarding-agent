# Mia Demo CRM

This Next.js product demonstrates the actual Mia v1 SDK contract: short-lived token exchange, live semantic observation, visible cursor, text/voice sessions, guarded DOM actions, reviewed host actions, idempotent receipts, reload recovery, and emergency stop.

## Configure Mia

Start the Mia backend and finish first-run setup with product origin `http://localhost:3000`. In the console:

1. Configure Gemini.
2. Create a runtime integration key in Settings.
3. Add `PRODUCT_GUIDE.md` as product knowledge.
4. Scan `/dashboard/crm` and the linked dashboard routes.
5. Open the demo once so Mia detects its host actions.
6. Review and publish `create_draft_opportunity` and `update_opportunity` under Actions & Safety.

## Run

```bash
cp example/demo-crm+sdk/.env.example example/demo-crm+sdk/.env.local
# Put the one-time console integration key in MIA_INTEGRATION_KEY.
npm --prefix example/demo-crm+sdk run dev
```

Open [http://localhost:3000/dashboard/crm](http://localhost:3000/dashboard/crm).

The relevant environment variables are:

- `NEXT_PUBLIC_MIA_BACKEND_URL`: browser-visible Mia API origin.
- `MIA_BACKEND_URL`: trusted server-side Mia API origin.
- `MIA_DEMO_ORIGIN`: exact browser origin allowed to request runtime tokens.
- `MIA_INTEGRATION_KEY`: server-only integration key from the console.
- `MIA_DEMO_USER_ID`: fixed low-privilege demo identity.
- `NEXT_PUBLIC_MIA_ENABLE_VOICE`: set `false` to hide voice during non-secure testing.

The runtime-token route rejects missing or mismatched browser origins and never returns the integration key. A real product must derive `userId` from its authenticated server session rather than using the demo's fixed identity.

## What To Test

- Ask: `What does lead-to-deal rate mean?`
- Point: `Point to the Stage filter.`
- Navigate: `Take me to Finance.`
- Create: `Create a draft opportunity for Avery Labs worth $25,000.`
- Edit: `Change the Avery Labs draft stage to Discovery.`
- Voice: start voice or hold `Control+Space` and repeat the same scenarios.
- Stop: start a request and press the square stop button before it completes.
- Reload: navigate with Mia, reload, and continue the same session.
- Safety: ask Mia to delete, send, publish, approve, or pay and confirm it refuses without issuing an action.

Draft creation and edits require exact approval. The host actions call real demo API routes, use Mia's idempotency key, publish durable state back to the page, and return structured evidence. No action sends or publishes anything.

## SDK Package Acceptance

Repository development links the demo to the SDK workspace. The root `verify:package-install` gate packs `@mia/onboarding-agent`, copies this demo to an isolated temporary directory, installs only the tarball, and runs a production build. That proves the package does not rely on SDK source files or monorepo resolution.

## Upstream Attribution

The dashboard foundation is adapted from [Studio Admin](https://github.com/arhamkhnz/next-shadcn-admin-dashboard) by Mohammed Arham Khan under the MIT License preserved in this directory. Mia-specific CRM state, product context, host actions, token exchange, stable semantics, and SDK integration are original to this repository.
