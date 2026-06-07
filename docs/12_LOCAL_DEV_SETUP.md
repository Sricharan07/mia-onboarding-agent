# Local Development Setup

## 1. Scope

The MVP is local-first.

No AWS or cloud infrastructure is required.

Local setup includes:

```text
Example app frontend
Console frontend
Local backend
Local database
Local file storage
Moss semantic index or mock Moss
LiveKit dev setup or mock LiveKit
TrueFoundry model gateway or mock gateway
Qwen model API or mock Qwen
TTS provider or mock TTS
Frontend SDK
```

## 2. Prerequisites

Recommended:

```text
Node.js 20+
pnpm
Playwright browsers
SQLite
```

Install Playwright browsers:

```bash
pnpm exec playwright install
```

## 3. Environment Variables

Create `.env` from `.env.example`.

```text
NODE_ENV=development

BACKEND_PORT=4000
CONSOLE_PORT=3001
EXAMPLE_APP_PORT=3000

DATABASE_URL=file:./data/sqlite/local.db
LOCAL_UPLOAD_DIR=./data/uploads
LOCAL_TTS_DIR=./data/tts

APP_ID=app_example_app
APP_BASE_URL=http://localhost:3000

TRUEFOUNDRY_API_KEY=
TRUEFOUNDRY_BASE_URL=

QWEN_API_KEY=
QWEN_MODEL=
QWEN_VOICE_MODEL=

MOSS_API_KEY=
MOSS_BASE_URL=

LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=

STT_PROVIDER=mock
TTS_PROVIDER=mock
SEMANTIC_SEARCH_PROVIDER=mock
VIDEO_UNDERSTANDING_PROVIDER=mock
```

## 4. Recommended Scripts

Root `package.json` scripts:

```json
{
  "scripts": {
    "dev": "turbo run dev",
    "dev:backend": "pnpm --filter backend dev",
    "dev:console": "pnpm --filter console dev",
    "dev:example": "pnpm --filter example-app dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "db:migrate": "pnpm --filter backend db:migrate",
    "map:example": "pnpm --filter mapper scan --app example-app",
    "seed": "pnpm --filter backend seed"
  }
}
```

## 5. Local Startup

```bash
pnpm install
pnpm db:migrate
pnpm seed
pnpm dev
```

Open:

```text
Example app: http://localhost:3000
Console:  http://localhost:3001
Backend:  http://localhost:4000/api/v1/health
```

## 6. Local Data Folders

Use:

```text
data/
  sqlite/
    local.db
  uploads/
    workflow videos
  tts/
    generated audio files
```

These can be gitignored.

## 7. Provider Modes

Every external provider should support mock mode.

```text
VIDEO_UNDERSTANDING_PROVIDER=mock|qwen
SEMANTIC_SEARCH_PROVIDER=mock|moss
TTS_PROVIDER=mock|qwen_voice
STT_PROVIDER=mock|provider_name
VOICE_TRANSPORT_PROVIDER=mock|livekit
MODEL_GATEWAY_PROVIDER=mock|truefoundry
```

## 8. Mock Mode Behavior

## 8.1 Mock Qwen

If uploaded filename contains:

```text
customer
```

Return Create Customer timeline.

If filename contains:

```text
invite
```

Return Invite Teammate timeline.

Otherwise return generic empty timeline.

## 8.2 Mock Moss

Use in-memory or local DB search.

Search strategy:

1. Lowercase query.
2. Tokenize.
3. Score records by token overlap.
4. Apply filters.
5. Return top matches.

## 8.3 Mock TTS

Return static audio file or generate placeholder.

If generating audio is too much, return:

```json
{
  "audioUrl": "/local-files/tts/mock.wav",
  "mimeType": "audio/wav"
}
```

Also return text so UI can show response.

## 8.4 Mock LiveKit

Return mock token and allow text fallback.

## 9. Example Data Seed

Seed app:

```json
{
  "id": "app_example_app",
  "name": "Example App",
  "slug": "example-app",
  "baseUrl": "http://localhost:3000"
}
```

Seed routes:

```text
/login
/dashboard
/customers
/customers/new
/settings/team
/reports
```

## 10. Local Example Flow

1. Run all apps.
2. Open console.
3. Trigger UI map scan.
4. Upload Create Customer workflow video.
5. Process workflow.
6. Review generated workflow.
7. Publish workflow.
8. Open the example app.
9. Ask assistant: “Help me create a new customer.”
10. Complete workflow.

## 11. Troubleshooting

### Backend cannot connect to DB

Check:

```text
DATABASE_URL
data/sqlite directory exists
migrations ran
```

### Mapper cannot scan routes

Check:

```text
Example app is running
APP_BASE_URL is correct
routes exist
Playwright installed
```

### SDK cannot resolve workflow

Check:

```text
workflow is published
workflow is indexed in Moss/mock Moss
backend URL is correct
appId matches
```

### Cursor cannot find element

Check:

```text
selector exists in DOM
workflow target selector is correct
fallback selectors are valid browser selectors
element is visible
route navigation completed
```

### TTS does not play

Check:

```text
browser autoplay restrictions
audioUrl is reachable
TTS endpoint returns correct MIME type
user interacted with page first
```

## 12. Gitignore

Recommended:

```text
node_modules/
dist/
.env
data/sqlite/*.db
data/uploads/
data/tts/
.playwright/
```
