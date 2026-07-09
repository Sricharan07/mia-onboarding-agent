# Mia Demo CRM

This sample Next.js CRM hosts the Mia browser SDK and provides stable pages, controls, and API-backed state for testing text requests, voice, pointing, confirmations, and reviewed workflow actions.

## Run Locally

Start the Mia backend from the repository root, then configure and start the demo:

```bash
cp example/demo-crm+sdk/.env.example example/demo-crm+sdk/.env.local
npm run dev:backend
npm --prefix example/demo-crm+sdk run dev
```

Before runtime requests can succeed, create an app and server integration key in the Mia Console. Put the app ID and integration key in `.env.local`, and set `MIA_DEMO_ORIGIN` to the exact browser origin serving the demo. The integration key stays in the Next.js server route; the browser receives only short-lived runtime tokens.

This demo intentionally mints tokens for one fixed, low-privilege identity and disables runtime DOM text redaction because every record is sample data. It is not an authentication example. A real host backend must derive the runtime-token user ID from its verified server session, authorize access to Mia, and keep runtime text redaction enabled unless its data handling has been reviewed.

Open `http://localhost:3000/dashboard/default`.

## Upstream Attribution

The dashboard foundation is adapted from [Studio Admin](https://github.com/arhamkhnz/next-shadcn-admin-dashboard) by Mohammed Arham Khan and is used under the MIT License included in this directory. Mia-specific CRM state, runtime-token exchange, stable selectors, and SDK integration were added for this repository.
