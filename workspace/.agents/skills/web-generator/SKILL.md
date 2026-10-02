---
name: web-generator
description: Expert Autonomous Full Stack Software Engineer specialized in building production-ready, containerized Next.js fullstack applications (single-service Docker Compose) for DCK Agentic. Use for scaffolding, extending, deploying, rebuilding, or tearing down apps in webgen/.
triggers:
  - web
  - fullstack
  - full stack
  - nextjs
  - next.js
  - landing page
  - app
  - prototype
  - website
  - scaffold
  - deploy
  - rebuild
---

# Web Generator — Next.js Single-Service Standard

Build on top of the built-in `frontend-design` skill for layout, styling, and component quality, and the built-in `docker` skill for containerization. Use the built-in `vercel` skill only when a preview deployment is explicitly requested. This skill defines the DCK project conventions those skills must follow here.

## 1. Project Layout (mandatory)

Scaffold every application inside `webgen/<app-name>/` with this exact structure:

```text
webgen/<app-name>/
├── Dockerfile
├── .dockerignore
├── docker-compose.yml
├── .dck.json
├── .env.example
├── .gitignore                # must ignore .env
├── README.md
├── prisma/schema.prisma      # only when a database is needed
└── src/                      # Next.js App Router (+ components/ui for shadcn)
```

One service named `app` (Next.js `standalone` output). Do not split into `frontend/` + `backend/` directories. Do not add a per-project database container.

## 2. Stack Defaults

- Next.js (App Router + API routes), TypeScript, Tailwind CSS, shadcn, Lucide icons.
- better-auth and Prisma: scaffold only when the app needs login or a database. Landing pages and static prototypes ship without them.
- External shared services only, never per-project containers:
  - `DATABASE_URL=postgresql://<user>:<pass>@host.docker.internal:5432/dck_<app-name>`
  - `REDIS_URL=redis://host.docker.internal:6379` (only when caching/queues are needed)
- The app runs as a Docker container in both environments (dev Canvas on the
  host, prod Canvas in a container), so it always reaches the host PostgreSQL
  through `host.docker.internal`. Every app `docker-compose.yml` MUST therefore
  declare the gateway mapping on the `app` service so that name resolves:

  ```yaml
  services:
    app:
      # ...
      extra_hosts:
        - "host.docker.internal:host-gateway"
  ```

  Without this the container cannot resolve `host.docker.internal` and DB/Redis
  connections fail. Do not use `localhost` in the container's `DATABASE_URL` —
  inside the container `localhost` is the app itself, not the host.
- Secrets live in gitignored `.env`; commit only `.env.example` with placeholders. Never commit real credentials.

## 3. Secrets Are the Source of Truth

The portal Secret Manager (`/settings/secrets`, server-side encrypted) is the
single source of truth for all integration keys and per-app URLs
(`DATABASE_URL_<APP>`, `REDIS_URL`, provider API keys). The app's `.env` file is
a generated artifact derived from those secrets — never the source, never
hand-maintained. This split is the same in dev and prod (the Secret Manager runs
in both):

- Secrets live in the Secret Manager. Every conversation already receives them
  automatically as server-resolved `LookupSecret` values — no manual passing.
- At deploy and rebuild time, read each required secret and write `.env` fresh
  (the container reads env from `.env`). Never append blindly, never print
  values to logs or chat.
- If a required secret is missing, stop and ask the operator to add it in
  `/settings/secrets` rather than inventing a value or committing a real one.
- Name pattern is `[a-zA-Z][a-zA-Z0-9_]{0,63}` (e.g. `DATABASE_URL_SHOP`).
- Rotate in the Secret Manager UI; the next deploy regenerates `.env`.
- `.env.example` carries placeholders only and is the only env file committed;
  `.env` is gitignored.

## 4. Port Allocation

Pick the first free integer starting at 3000 (`3000:3000`, then `3001:3000`, …).
Before scaffolding, gather both recorded and live usage precisely — do not grep
for a loose `"300"` substring:

```bash
# Recorded ports from existing apps (authoritative per-app value):
cat webgen/*/.dck.json 2>/dev/null | grep -oE '"port"[[:space:]]*:[[:space:]]*[0-9]+' | grep -oE '[0-9]+'
# Live published host ports:
docker ps --format '{{.Ports}}' | grep -oE '0\.0\.0\.0:[0-9]+|127\.0\.0\.1:[0-9]+' | grep -oE '[0-9]+$'
```

Choose the lowest free port ≥ 3000 not in either set. Record it in
`webgen/<app-name>/.dck.json`:

```json
{ "name": "<app-name>", "port": 3000, "stack": "nextjs" }
```

Never assign `8000/8002` (canvas) or `5432/3306/6379` (infrastructure).

## 5. Database Per App

Each app that needs persistence gets its own database (`dck_<app-name>`), created with the shared admin role. Run Prisma migrations through the agent before first boot. Use one shared database only when the operator explicitly says so.

## 6. Lifecycle (always via conversation)

```bash
cd webgen/<app-name>
docker compose up -d --build
docker compose ps
docker compose logs -n 50 app
curl -s http://localhost:<port>/
docker compose down
```

Verify every deploy with `ps`, logs, and an endpoint health check. `docker compose down -v` only with explicit operator confirmation. Never run long-lived dev servers or install packages on the host.

## 7. Junk-Free Guarantee

The host VM (especially prod) must stay clean. Source files under `webgen/<app-name>/` are the only host-side footprint allowed:

- `.dockerignore` is mandatory in every app: exclude `node_modules`, `.next`, `.turbo`, `.env`, `*.log`, `.git`, coverage output. Build artifacts stay inside image layers (Next.js `standalone` output), never on the volume.
- No host toolchains, ever: no `npm`, `pip`, `node`, or `prisma` outside containers. Installs, builds, migrations, and one-off scripts all run in throwaway containers (`docker compose run --rm app ...`).
- Temporary files live and die inside containers. Never write scratch files to `/projects` outside the app directory; verify with `git status` that only intended files changed.
- Named containers follow `<app-name>-<service>` so orphans are identifiable.
- Deleting an app means `docker compose down -v --rmi local`: containers, anonymous and named app volumes, and locally built images go away. Shared external Postgres/Redis hold no per-app volumes by design.
- Dangling leftovers are the operator's scheduled prune (`docker image prune -f`, `docker builder prune -f`), not something the agent runs after every task — but the agent must never be their source.

## 8. Deploy and Rebuild as Automations

For repeatable deploys, register the lifecycle above as a custom automation through the portal's built-in automation setup flow (custom automation backed by the built-in `openhands-automation` skill), so rebuilds get schedules and run history in the Automations UI instead of ad-hoc chat commands. The same applies to recurring jobs owned by other modules (daily trend scan, weekly analytics): scheduled custom automations writing dated artifacts into `research/` and `analytics/`.
