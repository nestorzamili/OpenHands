# DCK Agentic — Deployment

**DCK Agentic** is an internal multi-agent AI portal that automates and augments
organizational workflows across multiple domains:

1. **Web Generator** — Rapid application scaffolding, fullstack prototyping, and landing page generation (Next.js App Router, single-service Docker Compose, shadcn + Tailwind CSS).
2. **Dashboard Generator** — Interactive web analytics dashboards, charting components, and reporting UIs (Canvas Extensions).
3. **Social Media & Trends Research** — Automated market intelligence, trend tracking, and executive sentiment summaries.
4. **Power BI Assistant** — Dimensional modeling (Star Schema), optimized DAX measures, and Power Query (M) transformations.
5. **Data Analytics** — Exploratory data analysis (EDA), visual chart exports, and SQL queries against internal databases (PostgreSQL).

The platform is built on top of the OpenHands Agent Canvas as its autonomous
execution core. Deployment artifacts now live at the repo root (compose,
`workspace/`, migration script) — DCK is blended into the project, not a
separate subtree.

---

## Layout

```
.
├── docker-compose.yml           # DCK Agentic container definition (root)
├── .env                         # AUTOMATION_DB_URL etc. (gitignored)
├── config/                      # Runtime state, created on first run (gitignored)
├── scripts/migrate-automation-db.sh   # One-shot PostgreSQL schema migration
└── workspace/                   # Mounted to /projects; tracked DCK content
    ├── .agents/skills/          # Standard OpenHands skills directory
    │   ├── web-generator/       # Next.js single-service scaffolding rules
    │   ├── dashboard-generator/ # Canvas Extension dashboard rules
    │   ├── power-bi/            # DAX & Star Schema optimization guide
    │   ├── social-research/     # Trend research wrapper (research-brief/news-digest)
    │   └── data-analytics/      # PostgreSQL querying & visualization standards
    ├── webgen/                  # Next.js apps, one Docker Compose stack each
    ├── dashboards/              # Canvas Extension dashboard packages
    ├── research/                # Market intelligence and social research reports
    ├── powerbi/                 # DAX measures, M scripts, and model schemas
    ├── analytics/               # Data analytics scripts, queries, and charts
    └── AGENTS.md                # Universal repository instructions for all agents
```

---

## Quick Start

The DCK Agentic engine (`dck-agentic:dev`) runs on the server. It is
PostgreSQL-only: create the automation database once, then set its URL in the
root `.env` before starting the stack.

Build the image (from the repo root):

```bash
npm run build:docker   # or: docker build -t dck-agentic:dev -f docker/Dockerfile .
```

Create the automation database once and migrate its schema (the automation
backend does not auto-migrate PostgreSQL, only SQLite; the migration is
idempotent and re-runnable):

```bash
docker exec postgres psql -U nestor -d samunudb -c "CREATE DATABASE dck_agentic;"
./scripts/migrate-automation-db.sh
```

`AUTOMATION_DB_URL` is read from the root `.env` (gitignored). The host is the
postgres service name on the shared external `proxy` network:

```
AUTOMATION_DB_URL=postgresql+asyncpg://nestor:<pass>@postgres:5432/dck_agentic
```

Start the stack from the repo root:

```bash
docker compose up -d
```

- **Portal**: http://localhost:8000/canvas — shows the login screen.
- **Skills Management**: http://localhost:8000/canvas/skills
- **First run**: open the portal and create the admin account at `/setup`. The
  admin can then add more users from the portal.

Auth is **mandatory**. `AGENT_CANVAS_PORTAL_AUTH` enables a username/password
login portal (per-user accounts); credentials and sessions are persisted under
the `./config` volume (`portal-auth.json`). The internal agent-server/automation
session key is auto-generated and persisted (`api-key.txt`) — it is injected
into the HTML but served only to logged-in users, so you never paste it by hand.

> **Internet-facing requires HTTPS.** The session cookie travels from the
> browser, so you MUST put a TLS-terminating reverse proxy (Caddy/Traefik/Nginx)
> in front and never expose plain HTTP. The proxy must forward
> `X-Forwarded-Proto` (so the cookie is marked `Secure`) and `X-Forwarded-For`
> (so per-IP login throttling works). The container listens on `::`; terminate
> HTTPS at the proxy and forward to port 8000.

Add or remove users from the portal (admin → create user). Reset the whole
portal by deleting `portal-auth.json` from the `./config` volume and restarting
(the next visit returns to first-run `/setup`).

### Managing the Service

From the repo root:

```bash
docker compose logs -f     # status and logs
docker compose restart     # restart
docker compose down         # stop
```

---

## Development vs Deployment

- **Deployment** (above) uses `docker compose` from the root and reads
  `AUTOMATION_DB_URL` from `.env` with host `postgres:5432` (the service name on
  the `proxy` network, resolvable inside the container).
- **Development** uses `npm run dev`. It also reads the root `.env`, but runs on
  the host, where `postgres:5432` does not resolve by default. For local dev,
  either run against `localhost:5432` (override `AUTOMATION_DB_URL` in the shell)
  or add a `postgres` → `127.0.0.1` entry to `/etc/hosts`. For pure UI work,
  `npm run dev:mock` needs no database.
- **Mandatory auth in dev**: `npm run dev` runs behind the login portal
  (`--portal`), mirroring prod — on first run create the admin at `/setup`; the
  store persists under the state dir so you log in once. Use `npm run dev:public`
  for the API-key entry screen (needs `LOCAL_BACKEND_API_KEY`), `npm run
  dev:insecure` for the no-login quick mode (never for anything exposed), or
  `npm run dev:mock` for pure UI work.

---

## Database Connectivity

The container sets `host.docker.internal:host-gateway` and joins the external
`proxy` network, so agents reach the host PostgreSQL instance via the service
name `postgres:5432` (preferred) or `host.docker.internal:5432`.
