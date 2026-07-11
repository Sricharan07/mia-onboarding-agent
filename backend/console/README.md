# Mia v1 Console

The production operations console for one Mia product. It uses only the v1 backend APIs and contains eight workflows: Setup, Overview, Knowledge, Skills, Actions & Safety, Test Mia, Runs, and Settings.

## Development

Start PostgreSQL and the backend, then run:

```bash
npm run dev
```

`VITE_MIA_BACKEND_URL` defaults to the current browser origin. The checked-in local example points Vite at `http://localhost:4000`.

## Production

`npm run build` writes `dist/`. The Mia backend serves that directory at `/` while keeping v1 APIs under `/api/v1`.

First run requires the deployment's `SETUP_TOKEN`. The console creates one administrator and one product; it has no default credentials, app switching, invitations, or environments.
