---
name: web-generator
description: Expert Autonomous Full Stack Software Engineer specialized in building production-ready, containerized Next.js fullstack applications (single-service Docker Compose) for DCK Agentic. Use for scaffolding, extending, deploying, rebuilding, or tearing down apps in webgen/.
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

Each `webgen/<app-name>/` is also its own **local Git repository**. Initialize Git
at that app root; the parent repository intentionally ignores `webgen/`. The
first local commit includes source, lockfiles, migrations, docs, and `.env.example`
only. Verify `.env` is ignored and absent from the index before committing. Do
not add a remote, push, publish, deploy, or restart an app unless the operator
explicitly asks for that separate action.

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
single source of truth for app credentials. `.env` is a generated runtime
artifact, never the source and never hand-maintained. Apply the same rule in dev
and prod:

- Derive a strict secret suffix from the app slug: uppercase ASCII and replace
  each hyphen with `_` (`catatan-uang` → `CATATAN_UANG`). Reject slugs outside
  `[a-z0-9]+(?:-[a-z0-9]+)*`; do not silently discard or normalize other
  characters. Secret names must match `[a-zA-Z][a-zA-Z0-9_]{0,63}`.
- Keep app secrets isolated by name. Map `DATABASE_URL_<SUFFIX>` to runtime
  `DATABASE_URL`, `BETTER_AUTH_SECRET_<SUFFIX>` to `BETTER_AUTH_SECRET`, and,
  when needed, `REDIS_URL_<SUFFIX>` to `REDIS_URL`. Give other per-app provider
  credentials the same suffix. Reuse an unsuffixed secret only when the
  operator explicitly confirms it is intentionally shared.
- Prefer the conversation's server-resolved `LookupSecret` references or the
  portal's authenticated secret flow. At deploy/rebuild time, resolve each
  required secret and generate `.env` from the mapped names. Use a restrictive
  umask, write atomically, and set mode `600`; never append blindly, print a
  secret, enable shell tracing, or include values in logs/chat.
- If a required value is missing in the portal, stop and ask the operator to
  add it there. Do not recover a value from an old `.env`, invent one, or commit
  a credential.
- `.env.example` contains placeholders only. It is the only environment file
  committed; `.env` and every other `.env.*` file are ignored except
  `.env.example`. Verify the ignored file is not in the Git index.
- Rotate values in the Secret Manager; the next explicitly requested
  materialization/rebuild regenerates `.env`.

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
shared DCK Postgres cluster, created with an admin/migration role. The cluster is the
`postgres` service on the `dck` network (see §2) — not a host-published port:

```bash
# Create the per-app database once (admin role from the deployment .env):
docker compose -f /opt/dck-agentic/docker-compose.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -c 'CREATE DATABASE dck_<app-name>;'
```

Create a distinct per-app **runtime role** for the URL stored as
`DATABASE_URL_<SUFFIX>`. It must be `NOSUPERUSER NOCREATEDB NOCREATEROLE
NOREPLICATION NOBYPASSRLS`, must not own the database/schema/tables, and must
not inherit the admin role. Grant only `CONNECT` on that app database, `USAGE`
on the required schema, and the DML privileges (`SELECT`, `INSERT`, `UPDATE`,
`DELETE`) on the app's data tables; grant sequence privileges only when the
schema uses sequences. Do not grant `CREATE`, ownership, or access to migration
metadata tables. Do not grant broad default privileges; after a schema
migration, grant the runtime role only the privileges needed on newly created
app data tables. Keep migration/admin credentials separate from runtime
credentials; run Prisma migrations with the elevated role in a throwaway
container, then verify the runtime role can log in and cannot create/alter/drop
schema objects. Use one shared database only when the operator explicitly says
so.

## 6. Lifecycle (always via conversation)

Code changes, a local Git commit, and a successful build do not imply deployment.
Do not start, stop, rebuild a running service, reload nginx, or publish unless
the operator explicitly includes that lifecycle action in the request.

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
- Keep app toolchains in containers: do not use host `npm`, `pip`, `node`, or `prisma` for installs, application scripts, migrations, or builds; use throwaway containers (`docker compose run --rm app ...`). For UI/E2E validation only, an already-installed browser automation package may run against localhost when the integrated browser cannot emulate the needed viewport. Do not install host packages or leave generated app artifacts on the host.
- Temporary files live and die inside containers. Never write scratch files to `/projects` outside the app directory; verify with `git status` that only intended files changed.
- Named containers follow `<app-name>-<service>` so orphans are identifiable.
- Deleting an app means `docker compose down -v --rmi local` **plus** removing its nginx files (`/etc/nginx/dck-apps/preview-<app>.conf` and `/etc/nginx/dck-apps/<app>.conf`, then reload) and dropping its database if no longer needed (`DROP DATABASE dck_<app>`). Containers, anonymous and named app volumes, and locally built images go away. The shared DCK Postgres cluster holds no per-app volumes by design.
- Dangling leftovers are the operator's scheduled prune (`docker image prune -f`, `docker builder prune -f`), not something the agent runs after every task — but the agent must never be their source.

## 9. Deploy and Rebuild as Automations

For repeatable deploys, register the lifecycle above as a custom automation through the portal's built-in automation setup flow (custom automation backed by the built-in `openhands-automation` skill), so rebuilds get schedules and run history in the Automations UI instead of ad-hoc chat commands. The same applies to recurring jobs owned by other modules (daily trend scan, weekly analytics): scheduled custom automations writing dated artifacts into `research/` and `analytics/`.

## 10. Isolated Verification and Local Git

- Run every package command from the app directory and inside its container/build
  environment, never against the parent repo's dependency tree. Keep app-local
  `lint`, `typecheck`, `test`, and `build` commands; run them before the initial
  commit. Add a small regression test for each validation or persistence behavior
  changed.
- After scaffolding and local checks pass, initialize the nested Git repository,
  verify `.env` is ignored and untracked, inspect `git status`, then create one
  initial local commit. Confirm `git remote -v` is empty. Never push or add a
  remote unless separately requested.
