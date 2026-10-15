---
name: web-generator
description: Expert Autonomous Full Stack Software Engineer specialized in building production-ready, containerized Next.js fullstack applications (single-service Docker Compose) for DCK Agentic. Use for scaffolding, extending, deploying, rebuilding, or tearing down apps in webgen/.
---

# Web Generator — Next.js Single-Service Standard

Build on top of the built-in `frontend-design` skill for layout, styling, and component quality, and the built-in `docker` skill for containerization. WebGen preview uses the Canvas domain path described in §7. For every piece of user-facing output — UI, layout, copy, and code — also apply the vendored `antislop` skills (see §0). This skill defines the DCK project conventions those skills must follow here.

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
- better-auth and Prisma: scaffold only when the app needs login or a database. When authentication is requested, use Better Auth. Landing pages and static prototypes ship without them.
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
- `.env` may contain non-secret app configuration; commit only `.env.example` with placeholders. Store credentials in the project's Environment UI and never commit real credentials.

## 3. App Runtime Secrets Are Separate From Agent Secrets

The host WebGen control service owns the encrypted, per-project app runtime
secret store. It is deliberately separate from the portal Agent Secret Manager:
app credentials must never be requested through `LookupSecret`, entered into an
agent prompt, copied into workspace files, or exposed to the agent. The user
manages them from that project's **Environment** action in the Web Generator list.

- Manage custom app credentials in the project-scoped Environment UI. For an
  app with `needsDatabase: true` or Better Auth, the host control service
  automatically creates a stable per-project database URL and runtime role on
  the first explicit lifecycle action; Better Auth also gets a stable generated
  `BETTER_AUTH_SECRET`. These generated values are stored only in the encrypted
  host runtime store and injected into that app container. An existing
  user-provided `DATABASE_URL` is preserved and is not replaced or auto-managed.
  Saving or editing a custom value does not deploy or restart; it takes effect
  on the next Deploy preview, Rebuild, Start, Restart, Publish, or Unpublish.
- `.env` may contain only non-secret defaults copied from `.env.example` and
  `APP_BASE_PATH`. Do not write credentials or secret values to `.env`,
  `.env.example`, Compose YAML, source code, build args, Docker build context,
  shell output, logs, prompts, chat, transcripts, telemetry, or Git.
- Keep `env_file: .env` for ordinary app configuration when needed. Do not copy
  secret values into Compose `environment` or `build.args`; the host injects
  runtime secrets only as a protected, temporary `app` service env file.
- `.env.example` contains placeholders only. It is the only environment file
  committed; `.env` and every other `.env.*` file are ignored except
  `.env.example`. Verify the ignored file is not in the Git index.
- Existing `<ENV_NAME>_<PROJECT_SLUG>` entries in Agent Secret Manager may be
  shown as migration candidates by name only. Never look up or copy their value
  yourself. The user must choose **Prepare move** in Environment; ambiguous
  suffixes require explicit confirmation. The user then removes the source in
  Settings → Secrets and chooses **Verify source removal**. The service never
  deletes the Agent Secret entry automatically. Unsuffixed values are not
  auto-migrated.
- If a required runtime value is missing, direct the user to that project's
  Environment action. Never ask them to put it in Agent Secret Manager.

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
{ "name": "<app-name>", "port": 3000, "stack": "nextjs", "needsDatabase": false, "authProvider": "none", "lastStatus": "stopped", "lastCheckedAt": null, "previewPath": null, "subdomain": null }
```

The host WebGen control service owns runtime status and deployment metadata.
The UI reads live container state through that service. During scaffolding,
initialize `lastStatus` to `stopped`, `lastCheckedAt`, `previewPath`, and
`subdomain` to null, and record `needsDatabase` and `authProvider` accurately.
Do not fabricate a running status or an available URL before deployment.

Reserved host ports include `8010` (Canvas), `8011` (existing content service),
`8012` (WebGen internal authentication), `8769` (WebGen control), `8000`/`8080`
(other host services), and `5432`/`3306`/`6379` (infrastructure). Publish app
ports on `127.0.0.1:<port>:3000`; nginx is the public entry point.

## 5. Database Per App

Each app that needs persistence gets its own database on the shared DCK Postgres
cluster, reached as the Compose service `postgres` on network `dck` (never via a
host-published port). The host control service creates the database and a
distinct runtime role on the first explicit lifecycle action. The conventional
database name is `dck_<app-name>`; long names are deterministically shortened to
fit PostgreSQL's 63-byte identifier limit. The generated `DATABASE_URL` uses the
runtime role and is stored only in the encrypted host runtime store.

The app runtime role must be `LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
NOREPLICATION NOBYPASSRLS`; it must not own the database, schema, or tables and
must not be a member of another role. A distinct per-project migration role owns
only that project's database and runs only in the host-controlled migration
container; neither its username/password nor its URL may enter the prompt,
workspace, project Environment API, runtime env file, build context, logs, or Git.
Within the app database, the control service revokes public database/schema and
project-function access, grants the runtime role database `CONNECT` and schema
`USAGE`, then grants only `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on app data
tables and `USAGE`/`SELECT` on their sequences. Migration metadata tables are
excluded. It never grants runtime `CREATE`, ownership, `TRUNCATE`, or execute
privileges on project-defined functions. New tables receive the same narrow
default grants. These ACL changes are scoped to the app database; do not revoke
cluster-wide `PUBLIC CONNECT` from other databases as part of an app lifecycle
action.

For a service-managed database, explicit Deploy/Rebuild/Start/Restart/Publish/
Unpublish may apply standard PostgreSQL Prisma migrations before building or
starting the app. Each migration is checksum-tracked and runs in a transaction
using the separate migration role in a short-lived, read-only, non-root psql
container attached only to network `dck`; the password is mounted via a
mode-0600 temporary file outside the workspace and removed afterward. The
runner accepts ordinary schema DDL only and rejects psql directives, arbitrary
function calls, procedural SQL, grants/ownership changes, transaction control,
and edits to the migration ledger. Unsupported migrations fail closed. Never
run migrations with the app runtime role or bake credentials into the project.
Existing databases without matching encrypted migration metadata and custom
user-provided `DATABASE_URL` values are not adopted or migrated; stop for
operator review rather than weakening ownership checks. Existing custom URLs
are preserved; do not silently replace them or provision a second database.

## 6. Lifecycle through the WebGen controls

Scaffolding and code changes do not deploy. The operator uses **Deploy preview**
for the first preview deployment; that action disappears once a preview or
published deployment exists. **Rebuild** remains available for existing
deployments, while **Start** is shown for stopped deployments. Publish is hidden
for already-published projects; Unpublish is shown instead. The remaining typed
actions are Restart, Stop, Publish, Unpublish, and Delete. The host control service runs Docker, validates readiness, owns nginx
routes, and writes deployment metadata. Canvas does not mount the Docker
socket. Do not ask for that socket or write host nginx configuration from chat.

Deploy preview serves an unpublished project at the Canvas origin under
`/preview/<app>`. Rebuild/Start/Restart retain an existing publication.
Only Publish accepts a subdomain. Unpublish explicitly rebuilds the app for
its preview path and removes the service-managed published route. One app has
one active deployment mode and one canonical link.

Use the live runtime status for verification. Never infer successful deployment
from a source commit or build alone. Compose contains one app service, no host
mounts or named volumes, and no privileged settings. Store persistent uploads
in application-owned external storage and database records; container files
are ephemeral. Use only `authProvider` and `needsDatabase` in `.dck.json`.

## 6a. Better Auth First-Owner Seed (mandatory when auth is Better Auth)

The New Project dialog collects the first owner's email, optional username, and
password separately from the agent prompt. The host WebGen control service keeps that seed
encrypted for 15 minutes and delivers it once only after an explicit Deploy or
Rebuild action. Treat the public verification key in the scaffold/deploy message
as public; it is not a credential.

- Store `"authProvider": "better-auth"` in `.dck.json`. Give the sole Compose
  service the deterministic `container_name: <app-name>-app`, expose app port
  `3000` inside the container, and join the shared external `dck` network. The
  host control service reaches the container on that network, including the
  active `/preview/<app>` basePath before `/api/dck/owner-seed` in preview mode.
- Configure Better Auth with email/password sign-up disabled
  (`emailAndPassword.disableSignUp: true`), `minPasswordLength: 15`, and a
  `maxPasswordLength` of at least `512` (use `1024` to accept the full Unicode
  limit below). Keep public sign-up disabled on every environment. Use the
  Better Auth `admin()` plugin for the server `createUser` API and the username
  plugin when accepting an optional username; apply its schema migration.
- Implement a server-only `GET /api/dck/owner-seed` health response with only
  `{version: 1, project_slug, verification_key, state}`. Set `state` to
  `awaiting_owner` or `owner_exists`; return the exact public key embedded in
  the app. Never return user data or credentials from this endpoint.
- Implement `POST /api/dck/owner-seed` as a server-only bootstrap handler. It
  must accept only the signed payload and verify its Ed25519 signature against
  that public key, protocol version, exact app slug, issue/expiry timestamps
  (maximum 120 seconds), and every signed field before touching Better Auth.
  Canonicalize the signature input as the ordered JSON array
  `[version, project_slug, conversation_id, issued_at, expires_at, nonce,
  email, username, password]`, serialized as UTF-8 JSON without ASCII escaping
  or whitespace. Reject invalid signatures, wrong projects, expired payloads,
  malformed email, passwords under 15 or over 1024 UTF-16 code units, and
  malformed Unicode. Preserve password whitespace and Unicode exactly; never
  trim or truncate it.
- Enforce one-time use and first-owner uniqueness with a durable unique nonce
  record and a singleton bootstrap/owner lock in the app's existing auth
  database. Serialize concurrent requests, reject a replay, and if an owner
  already exists return `409` without creating another. Do not add a credential
  store or put the seed in Prisma/Better Auth tables.
- Create the owner only by calling Better Auth's server API, e.g.
  `auth.api.createUser({ body: { email, name, password, role: "admin", ... } })`
  from this verified server handler, without forwarding browser headers or a
  client session. Include the optional username through Better Auth's username
  plugin. Never insert directly into Better Auth tables. Keep the public admin
  management routes session-protected; only the verified server handler may
  bootstrap the first owner.
- Return `{ok: true}` only after creation succeeds. Return `409` for an owner
  that already exists; the DCK server treats that as an idempotent completion.
  Do not log request bodies, passwords, signatures, or user identifiers. Never
  place the seed in prompts, chat/transcripts, model context, source, `.env`,
  `.env.example`, `.dck.json`, analytics, or the persistent Secret Manager.
- Do not create the owner on app start, health checks, source generation, or
  ordinary conversation messages. If a capability expires or the first-owner
  delivery fails, let the next explicit Deploy/Rebuild request collect a fresh
  seed. Exercise invalid signatures, public sign-up rejection, concurrent
  bootstrap, duplicate owner, nonce replay, Unicode/whitespace, and expiry
  using dummy credentials only.

## 7. Preview and explicit publication

Preview uses the existing Canvas origin, for example
`https://agent.dckautoposting.com/preview/its`. Never create a preview subdomain,
DNS record, extra server block, or second app container for this route.

Configure Next.js with `basePath`:

```js
const basePath = process.env.APP_BASE_PATH || "";
module.exports = { output: "standalone", basePath };
```

`APP_BASE_PATH=/preview/<app>` must be available during `next build`. Next.js
inlines basePath into the client bundle, so changing modes requires a rebuild.
Do not add `assetPrefix` just to host under a subpath. Next Link/router paths
respect basePath; explicitly prefix raw fetch URLs and public image URLs where
required. Scope app cookies and storage keys to the app to avoid collisions on
the shared origin. Same-origin preview is intended for trusted application
code; a URL path is not a browser security boundary.

The host service generates an exact location for `/preview/<app>` and a prefix
location for `/preview/<app>/`, both forwarding the full URI without removing
the prefix. Let Next.js apply its own trailing-slash convention. Verify the
page, nested routes, assets, and owner endpoint under the same prefix.

The service owns `/etc/nginx/dck-apps/preview-<app>.conf` and includes it inside
the existing Canvas server. Preview needs no additional certificate or DNS.

Only an explicit Publish action selects `<label>.dckautoposting.com`, rebuilds
with an empty basePath, and replaces the preview route with
`published-<app>.conf` at nginx HTTP scope. It sets `subdomain` and clears
`previewPath`. The wildcard certificate and DNS are used only for this mode.
Unpublish performs the inverse transition; it does not maintain a redundant
second deployment. Keep existing publication unchanged unless the operator
explicitly chooses Unpublish.

References: [Next.js basePath](https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath)
and [trailingSlash](https://nextjs.org/docs/app/api-reference/config/next-config-js/trailingSlash).

## 8. Junk-Free Guarantee

The host VM (especially prod) must stay clean. Source files under `webgen/<app-name>/` are the only host-side footprint allowed:

- `.dockerignore` is mandatory in every app: exclude `node_modules`, `.next`, `.turbo`, `.env`, `*.log`, `.git`, coverage output. Build artifacts stay inside image layers (Next.js `standalone` output), never on the volume.
- Keep app toolchains in containers: do not use host `npm`, `pip`, `node`, or `prisma` for installs, application scripts, migrations, or builds; use throwaway containers (`docker compose run --rm app ...`). For UI/E2E validation only, an already-installed browser automation package may run against localhost when the integrated browser cannot emulate the needed viewport. Do not install host packages or leave generated app artifacts on the host.
- Temporary files live and die inside containers. Never write scratch files to `/projects` outside the app directory; verify with `git status` that only intended files changed.
- Named containers follow `<app-name>-<service>` so orphans are identifiable.
- Delete is an explicit host-service action. Back up application data before removal; never run ad-hoc volume deletion or remove unrelated nginx sites from an agent conversation.
- Dangling leftovers are the operator's scheduled prune (`docker image prune -f`, `docker builder prune -f`), not something the agent runs after every task — but the agent must never be their source.

## 9. Automations

Use custom automations for explicitly requested recurring application tasks.
Do not schedule Docker/nginx lifecycle shell commands as a workaround for the
host control service. Deployment and publication remain explicit typed
operations with their own authorization and readiness checks.

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
