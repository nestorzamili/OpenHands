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

Build on top of the built-in `frontend-design` skill for layout, styling, and component quality, and the built-in `docker` skill for containerization. Use the built-in `vercel` skill only when a preview deployment is explicitly requested. For every piece of user-facing output — UI, layout, copy, and code — also apply the vendored `antislop` skills (see §0). This skill defines the DCK project conventions those skills must follow here.

## 0. Anti-Slop Is Mandatory for All UI Output

Generated webgen apps must not read as generic AI output. The `antislop` skill
family lives beside this one in `workspace/.agents/skills/` and is mandatory for
`webgen/` work:

- `antislop` (core) — **always load it** when building or editing a webgen app.
  It owns the rule tiers, the liveliness toolkit, and the Delivery Gate.
- `antislop-ui` — load whenever you build or edit any interface (color, layout,
  components, decoration, motion).
- `antislop-copywriting` — load whenever you write or edit user-facing prose
  (headlines, CTAs, empty states, marketing/product copy).
- `antislop-layoutmobile` — load whenever a layout must reflow across screen
  sizes (grids, overflow, tap targets, navigation).
- `antislop-human` — load for accessibility work (contrast, keyboard, focus,
  states); it ships a contrast checker.
- `antislop-code` — load whenever you write or edit code comments.

Division of labor: `antislop` **filters** out slop; `frontend-design` and any
project `DESIGN.md` **direct** the look. They are different jobs — a sterile
result means the direction was missing, not that the filter failed. Run
anti-slop's Delivery Gate (the PASS/FAIL report) before you report a scaffold or
deploy as done; a failing gate blocks the handoff.

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
├── next.config.js            # basePath toggled for preview vs published (§7)
├── prisma/schema.prisma      # only when a database is needed
└── src/                      # Next.js App Router (+ components/ui for shadcn)
```

One service named `app` (Next.js `standalone` output). Do not split into `frontend/` + `backend/` directories. Do not add a per-project database container.

## 2. Stack Defaults

- Next.js (App Router + API routes), TypeScript, Tailwind CSS, shadcn, Lucide icons.
- better-auth and Prisma: scaffold only when the app needs login or a database. Landing pages and static prototypes ship without them.
- Database and cache connectivity (prod topology — see `docs/DEPLOYMENT.md`):
  - **PostgreSQL** is the dedicated DCK cluster, reached by the compose
    **service name `postgres`** on the shared `dck` network (it is NOT published
    to the host, so `host.docker.internal:5432` does NOT work):
    `DATABASE_URL=postgresql://<user>:<pass>@postgres:5432/dck_<app-name>`
  - **Redis** (only when caching/queues are needed) is the existing host
    `redis-shared`, reached via the host gateway:
    `REDIS_URL=redis://host.docker.internal:6379`
- Every app `docker-compose.yml` MUST therefore (a) join the external `dck`
  network so `postgres` resolves, and (b) declare the host-gateway mapping so
  `host.docker.internal` resolves for Redis:

  ```yaml
  services:
    app:
      # ...
      networks:
        - dck
      extra_hosts:
        - "host.docker.internal:host-gateway"

  networks:
    dck:
      external: true
      name: dck
  ```

  Do not use `localhost` in the container's `DATABASE_URL`/`REDIS_URL` — inside
  the container `localhost` is the app itself, not Postgres or the host.
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
{ "name": "<app-name>", "port": 3000, "stack": "nextjs", "lastStatus": "stopped", "lastCheckedAt": null, "previewPath": null, "subdomain": null }
```

`lastStatus` is the agent-verified container state the portal reads to show an
honest status badge (the browser cannot reach the Docker daemon). Allowed
values: `"running"`, `"stopped"`, `"error"`. `lastCheckedAt` is the ISO-8601
UTC timestamp of the verification (or `null` before the first deploy).
`previewPath` is the `/preview/<app>` route once a preview block is live (or
`null`); `subdomain` is `<app>.dckautoposting.com` once published (or `null`).
Keep all fields in sync with reality on every lifecycle action (§6, §7).

Reserved and never assigned to apps: `8010` (DCK Canvas ingress), `8000`/`8080`
(other host services), `5432`/`3306`/`6379` (infrastructure). Ports are
published on host loopback (`127.0.0.1:<port>:3000`) — nginx is the only public
entry point.

## 5. Database Per App

Each app that needs persistence gets its own database (`dck_<app-name>`) on the
shared DCK Postgres cluster, created with the admin role. The cluster is the
`postgres` service on the `dck` network (see §2) — not a host-published port:

```bash
# Create the per-app database once (admin role from the deployment .env):
docker compose -f /opt/dck-agentic/docker-compose.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -c 'CREATE DATABASE dck_<app-name>;'
```

Run Prisma migrations through the agent (in a throwaway container) before first
boot. Use one shared database only when the operator explicitly says so.

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

**Always update `.dck.json` status after a lifecycle action** so the portal
badge stays honest — the frontend reads this file, it cannot query Docker:

- After a successful `up`/deploy/rebuild where `docker compose ps` shows the
  service up and the health check (`curl -s http://localhost:<port>/`) passes,
  set `"lastStatus": "running"`.
- After `docker compose down` (stop), set `"lastStatus": "stopped"`.
- If the container exits non-zero, the health check fails, or the build breaks,
  set `"lastStatus": "error"`.
- Always set `"lastCheckedAt"` to the current ISO-8601 UTC timestamp at the same
  time (e.g. `"2026-01-15T09:30:00Z"`). Do not touch `name`/`port`/`stack` when
  updating status.

## 7. Preview and Publish (subdomain lifecycle)

Every webgen app goes through two public stages, both fronted by the host nginx
on the DCK domain. The agent only ever writes nginx config under the dedicated
include dir `/etc/nginx/dck-apps/` (one file per app) and reloads nginx — it
must never edit `agent.dckautoposting.com` itself or any other site's config.

TLS needs no per-app work: the wildcard `*.dckautoposting.com` certificate and
the wildcard `*` A record already cover every app subdomain (see
`docs/DEPLOYMENT.md`).

### 7a. Preview under `/preview/<app>/`

Preview an app on the Canvas origin before giving it a subdomain. The app is
served under the path prefix `/preview/<app>/`, so Next.js must build with a
matching `basePath` or every asset and route 404s:

```js
// next.config.js — basePath is driven by an env var so the SAME image works
// in preview (prefixed) and published (root) modes.
const basePath = process.env.APP_BASE_PATH || "";
module.exports = { output: "standalone", basePath, assetPrefix: basePath || undefined };
```

Set `APP_BASE_PATH=/preview/<app>` in the app's `.env` for the preview deploy.
Write `/etc/nginx/dck-apps/preview-<app>.conf`:

```nginx
# Included inside the agent.dckautoposting.com server block. The /preview/<app>/
# prefix is more specific than Canvas's `location /`, so it wins.
location /preview/<app>/ {
    proxy_pass http://127.0.0.1:<port>/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -I https://agent.dckautoposting.com/preview/<app>/   # expect 200
```

Record `"previewPath": "/preview/<app>"` in `.dck.json`.

### 7b. Publish to `<app>.dckautoposting.com`

When the operator approves, rebuild the app with an empty `basePath`
(`APP_BASE_PATH=` unset → served at root) and write a dedicated server block
`/etc/nginx/dck-apps/<app>.conf`:

```nginx
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name <app>.dckautoposting.com;

    # Reuse the wildcard cert — no certbot run needed.
    ssl_certificate     /etc/letsencrypt/live/dckautoposting.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dckautoposting.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://127.0.0.1:<port>/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name <app>.dckautoposting.com;
    return 301 https://$host$request_uri;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -I https://<app>.dckautoposting.com/     # expect 200
```

Record `"subdomain": "<app>.dckautoposting.com"` in `.dck.json`. The wildcard
`*` A record already resolves the host; add an explicit `<app>` A record in
Cloudflare only if you later proxy it (orange cloud) separately.

Deleting an app also removes its `/etc/nginx/dck-apps/preview-<app>.conf` and
`/etc/nginx/dck-apps/<app>.conf`, followed by an nginx reload.

## 8. Junk-Free Guarantee

The host VM (especially prod) must stay clean. Source files under `webgen/<app-name>/` are the only host-side footprint allowed:

- `.dockerignore` is mandatory in every app: exclude `node_modules`, `.next`, `.turbo`, `.env`, `*.log`, `.git`, coverage output. Build artifacts stay inside image layers (Next.js `standalone` output), never on the volume.
- No host toolchains, ever: no `npm`, `pip`, `node`, or `prisma` outside containers. Installs, builds, migrations, and one-off scripts all run in throwaway containers (`docker compose run --rm app ...`).
- Temporary files live and die inside containers. Never write scratch files to `/projects` outside the app directory; verify with `git status` that only intended files changed.
- Named containers follow `<app-name>-<service>` so orphans are identifiable.
- Deleting an app means `docker compose down -v --rmi local` **plus** removing its nginx files (`/etc/nginx/dck-apps/preview-<app>.conf` and `/etc/nginx/dck-apps/<app>.conf`, then reload) and dropping its database if no longer needed (`DROP DATABASE dck_<app>`). Containers, anonymous and named app volumes, and locally built images go away. The shared DCK Postgres cluster holds no per-app volumes by design.
- Dangling leftovers are the operator's scheduled prune (`docker image prune -f`, `docker builder prune -f`), not something the agent runs after every task — but the agent must never be their source.

## 9. Deploy and Rebuild as Automations

For repeatable deploys, register the lifecycle above as a custom automation through the portal's built-in automation setup flow (custom automation backed by the built-in `openhands-automation` skill), so rebuilds get schedules and run history in the Automations UI instead of ad-hoc chat commands. The same applies to recurring jobs owned by other modules (daily trend scan, weekly analytics): scheduled custom automations writing dated artifacts into `research/` and `analytics/`.
