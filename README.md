# WhatsApp Next.js API (Baileys + Prisma)

A small Next.js app that exposes a REST API (and a simple dashboard UI) for managing multiple WhatsApp “sessions” using the Baileys library. Sessions are persisted in SQLite via Prisma (including Baileys auth creds/keys), so the server can restart without losing pairing.

## What you get

- Multi-session WhatsApp connection manager (keyed by `sessionId`)
- Pairing endpoint that returns a QR (or “connected” if already paired)
- Server-Sent Events stream for status/QR/log updates
- Send text messages via HTTP
- List all sessions stored in the DB
- List all WhatsApp groups for a session
- Optional “repair” endpoint to force a clean resync by removing app-state keys
- Built-in dashboard at `/dashboard`

## Requirements

- Node.js 20+
- A writable SQLite path (local file or mounted volume)

## How sessions work

- A `sessionId` is just a string you choose (e.g. `"steven"`, `"tenant-a"`, `"user@example.com"`).
- The server keeps one in-memory Baileys socket per `sessionId`, and persists auth data in SQLite so it can reconnect after restarts.
- Typical flow:
  1) `POST /api/session/pair` → get `qr`
  2) Scan QR in WhatsApp → Linked devices
  3) Subscribe to `GET /api/session/:sessionId/events` to see status/logs
  4) Call `POST /api/session/send` to send messages

## Quick start (local dev)

1) Install dependencies:

```bash
npm install
```

2) Create a local env file and point SQLite to a project file:

Create `.env.local`:

```bash
DATABASE_URL="file:./data/dev.db"
WA_DEVICE_LABEL="Local WA"
```

3) Create the DB folder + apply migrations:

```bash
mkdir -p data
npm run db:deploy
```

4) Run the app:

```bash
npm run dev
```

Open `http://localhost:3000/dashboard`.

## Database + `DATABASE_URL`

This project uses SQLite.

- Use a relative path for local dev: `DATABASE_URL="file:./data/dev.db"`
- Use an absolute container path for Docker: `DATABASE_URL="file:/data/dev.db"`

If you see `Error code 14: Unable to open the database file`, it usually means the directory does not exist or is not writable. For local dev, create the folder (`mkdir -p data`). For Docker, ensure the `/data` volume is mounted and writable (see below).

## API

All API routes run with `runtime = "nodejs"` and expect a long-lived server process (not serverless).

### Pair a session (get QR / connect)

`POST /api/session/pair`

Body:

```json
{ "sessionId": "my-session", "timeoutMs": 25000 }
```

Response:

- `{ success: true, status: "connected" }` if already connected
- `{ success: true, status: "qr", qr: "..." }` if QR needs scanning
- `{ success: true, status: "timeout" }` if nothing happens in time

### Session events (SSE)

`GET /api/session/:sessionId/events`

Streams events like:

- `{ type: "status", data: { status } }`
- `{ type: "qr", data: "..." }`
- `{ type: "log", data: { level, message } }`

### Send a text message

`POST /api/session/send`

Provide the session id via header or body:

- Header: `X-Session-Id: my-session`
- Body: `{ "sessionId": "my-session", "recipient": "...", "message": "..." }`

Example:

```bash
curl -X POST 'http://localhost:3000/api/session/send' \
  -H 'Content-Type: application/json' \
  -H 'X-Session-Id: my-session' \
  -d '{"recipient":"15551234567","message":"hello"}'
```

Error codes:

- `409` + `code=PAIRING_REQUIRED` (scan QR first)
- `503` + `code=TIMEOUT` (session not connected yet)

### Send (session-scoped URL)

`POST /api/session/:sessionId/send`

Body:

```json
{ "recipient": "15551234567", "message": "hello" }
```

### List sessions

`GET /api/session/list`

Returns DB-backed sessions, with in-memory status/QR overlays when available.

### Start a session (without waiting for QR)

`POST /api/session/start`

Body:

```json
{ "sessionId": "my-session" }
```

### Delete a session (logout)

`POST /api/session/logout`

Provide `sessionId` via `X-Session-Id` header or JSON body. This stops the socket and deletes the session rows (logs + auth creds/keys via cascade).

### Repair/resync a session

`POST /api/session/repair`

Deletes “app-state” keys for the session and restarts the socket to force a clean resync.

### List WhatsApp groups for a session

`GET /api/session/:sessionId/groups?waitMs=20000`

Returns an array like:

```json
[
  { "id": "123@g.us", "subject": "My Group", "size": 42, "announce": false, "restrict": false }
]
```

## Webhooks (Integration with external platforms)

This app can synchronize messages with an external platform (e.g., a CRM or admin panel) via webhooks.

### Configuration

Set these environment variables to enable webhooks:

```bash
OUTBOUND_WEBHOOK_URL=http://your-platform.com
OUTBOUND_WEBHOOK_KEY=your-api-key
INBOUND_WEBHOOK_KEY=your-api-key  # Optional, currently unused
```

### How it works

1. **Outbound messages** (sent via WhatsApp): Automatically forwarded to `{OUTBOUND_WEBHOOK_URL}/api/webhooks/whatsapp-outbound`
2. **Inbound messages** (received via WhatsApp): Automatically forwarded to `{OUTBOUND_WEBHOOK_URL}/api/webhooks/whatsapp-inbound`

### Message Format

**Outbound (sent messages):**
```json
{
  "to": "+237655006289",
  "body": "Message text",
  "timestamp": 1722596430,
  "messageId": "msg_123456",
  "status": "sent"
}
```

**Inbound (received messages):**
```json
{
  "from": "+237655006289",
  "body": "Reply text",
  "timestamp": 1722596450,
  "id": "msg_789"
}
```

Headers: `X-API-Key: {OUTBOUND_WEBHOOK_KEY}`

## Docker (recommended for production-ish runs)

This repo ships a Dockerfile that builds a Next.js standalone server and runs Prisma migrations on startup via `scripts/entrypoint.sh`.

### Using `docker-compose.yml`

`docker-compose.yml` expects:

- `IMAGE_TAG` (tag of `ghcr.io/nkeneng/whatsapp-nextjs-api`)
- `DATA_VOLUME` (host path mounted to `/data` in the container)

Example `.env` for Docker Compose:

```bash
IMAGE_TAG=latest
DATA_VOLUME=./data
```

Start:

```bash
mkdir -p data
docker compose up -d
```

The container uses `DATABASE_URL="file:/data/dev.db"` by default.

### Build and run locally

```bash
docker build -t whatsapp-api .
mkdir -p data
docker run --rm -p 3000:3000 -v "$PWD/data:/data" -e DATABASE_URL="file:/data/dev.db" whatsapp-api
```

## Environment variables

- `DATABASE_URL` (required): SQLite connection string, e.g. `file:./data/dev.db` or `file:/data/dev.db`
- `WA_DEVICE_LABEL` (optional): device name shown in WhatsApp “Linked devices”
- `PRISMA_LOG_QUERY=1` (optional): enable Prisma query logging
- `WS_NO_BUFFER_UTIL=1` / `WS_NO_UTF_8_VALIDATE=1` (optional): helps avoid native ws module issues in some bundled environments

## Notes & safety

- Baileys is an unofficial WhatsApp Web API. Use at your own risk; accounts can be rate-limited or banned.
- Treat the DB as sensitive: it contains session secrets (auth creds/keys). Don’t expose the API publicly without authentication and network controls.
- This app keeps active sockets in memory. Run it as a long-lived Node process (Docker/container/VM), not as a stateless serverless function.

## Troubleshooting

### “Unable to open the database file” (SQLite / Prisma error code 14)

- Local dev: use `DATABASE_URL="file:./data/dev.db"` and run `mkdir -p data`
- Docker: make sure a host directory is mounted to `/data` and is writable (`DATA_VOLUME=./data`)

### “Database not migrated”

Run:

```bash
npm run db:deploy
```

### “Session not paired” / `PAIRING_REQUIRED`

Call `POST /api/session/pair` and scan the QR in WhatsApp → Linked devices.

## Project layout (where to look)

- `src/lib/wa/manager.ts`: socket lifecycle, session status/QR, send messages, list groups
- `src/lib/wa/dbAuth.ts`: DB-backed Baileys auth (creds + keys)
- `src/app/api/session/*`: HTTP API routes (App Router)
- `prisma/schema.prisma`: DB schema (SQLite)
- `scripts/entrypoint.sh`: Docker entrypoint that runs Prisma migrations
