# DCK Agentic — Deployment

**DCK Agentic** is an internal multi-agent AI portal that automates and augments
organizational workflows across multiple domains:

1. **Web Generator** — Rapid application scaffolding, fullstack prototyping, and landing page generation (Next.js App Router, single-service Docker Compose, shadcn + Tailwind CSS).
2. **Dashboard Generator** — Interactive web analytics dashboards, charting components, and reporting UIs (Canvas Extensions).
3. **Social Media & Trends Research** — Automated market intelligence, trend tracking, and executive sentiment summaries.
4. **Power BI Assistant** — Dimensional modeling (Star Schema), optimized DAX measures, and Power Query (M) transformations.
5. **Data Analytics** — Exploratory data analysis (EDA), visual chart exports, and SQL queries against internal databases (PostgreSQL).

The platform is built on top of the OpenHands Agent Canvas as its autonomous
execution core.

---

## Production topology (VM `agent.dckautoposting.com`)

```
Browser ──HTTPS/443──▶ nginx (host)                 TLS: wildcard *.dckautoposting.com
                        │                                 (Cloudflare DNS-01, auto-renew)
                        ├── /                 ─▶ 127.0.0.1:8010  canvas (ingress)
                        ├── /preview/<app>/   ─▶ 127.0.0.1:<port> webgen app (preview)
                        └── <app>.dckautoposting.com ─▶ 127.0.0.1:<port> webgen app (published)

/opt/dck-agentic/                           docker compose stack
├── docker-compose.yml
├── .env                                    (gitignored, chmod 600)
├── config/   → canvas:/home/openhands/.openhands   portal-auth.json, api-key.txt,
│                                                    secret-key.txt, conversations,
│                                                    bash_events, automation storage
├── workspace/ → canvas:/projects                   webgen/ research/ analytics/ content/
└── pgdata/   → postgres:/var/lib/postgresql/data    dck_agentic + every dck_<app>

network `dck` (compose-managed) ── canvas ── postgres
                                     │
webgen app containers join `dck` (external) ──▶ postgres:5432
host services (redis-shared :6379) ──▶ host.docker.internal:6379
```

Key facts for this VM:

- **Canvas is served at the root path** of `agent.dckautoposting.com` (no
  `/canvas` prefix). The image is built with `VITE_BASE_PATH=/` by the
  `dck-docker.yml` workflow.
- **Ingress is on host port 8010**, not 8000 — port 8000 is already taken by
  another service on this host.
- **Postgres is dedicated to DCK** and internal-only (no published port). It
  holds the automation database (`dck_agentic`) and one database per webgen app
  (`dck_<app>`). Reached as `postgres:5432` on the `dck` network.
- **Redis is not used by the Canvas engine.** Webgen apps that need a cache or
  queue use the existing host `redis-shared` via `host.docker.internal:6379`.
- **TLS is a single wildcard** `*.dckautoposting.com` (plus the apex), issued
  with the Cloudflare DNS-01 challenge so every new app subdomain is already
  covered with no per-app certbot run.

---

## Quick Start

### 1. Build & publish the image (CI)

The image is built by `.github/workflows/dck-docker.yml` and published to GHCR
as `dck-agentic` under the repository owner's namespace
(`ghcr.io/<owner>/dck-agentic`) with `VITE_BASE_PATH=/`. Push to `dev`
(publishes `latest` + `sha-<short>`) or tag `dck-v<version>` for a pinned
release. Set `CANVAS_IMAGE` in `.env` to your owner's path. The VM only
pulls — it never builds.

### 2. First-run bootstrap (one command)

Download and run `scripts/dck-vm-bootstrap.sh` on the VM. It lays out
`/opt/dck-agentic`, fetches the deploy bundle from the GitHub Release, fixes
bind-mount ownership, writes `.env` (generating a Postgres password), and starts
the stack:

```bash
curl -fsSL "https://raw.githubusercontent.com/<owner>/OpenHands/<tag>/scripts/dck-vm-bootstrap.sh" \
  | OWNER=<owner> VERSION=<tag> bash
# e.g. OWNER=dck-ai VERSION=dck-v1.2.3
```

The script is idempotent: re-running never clobbers an existing `.env` and only
re-applies ownership + `pull`/`up`. The automation schema migrates
automatically inside the canvas container on startup — no separate step.

Review `/opt/dck-agentic/.env` afterwards (especially `AUTOMATION_BASE_URL` and
`CANVAS_IMAGE`), then re-run `docker compose up -d` if you changed anything.

> The script fixes bind-mount ownership to the canvas UID (10001 by default,
> `CANVAS_UID` to override). Verify with
> `docker run --rm --entrypoint id ghcr.io/<owner>/dck-agentic:latest openhands`.

### 3. Routine updates

```bash
cd /opt/dck-agentic
docker compose pull && docker compose up -d
```

Bump `CANVAS_IMAGE_TAG` in `.env` first to pin a specific release. Migrations
re-apply automatically and are a no-op when the schema is current.

> **Out-of-band migration (rare).** The migration is automatic; to run it
> manually (e.g. with `AGENT_CANVAS_SKIP_DB_MIGRATE=1` set on the container),
> use `scripts/migrate-automation-db.sh` with `CONTAINER=dck-agentic-canvas` and
> `AUTOMATION_DB_URL` set.

### 4. First-run admin

- Open `https://agent.dckautoposting.com/` → the portal redirects to `/setup`.
- Create the **admin** account. The admin can add more users from the portal.

Auth is **mandatory**. `AGENT_CANVAS_PORTAL_AUTH` enables a username/password
login portal (per-user accounts); credentials and sessions persist under
`./config` (`portal-auth.json`). The internal agent-server/automation session
key is auto-generated and persisted (`api-key.txt`) — it is injected into the
HTML but served only to logged-in users, so you never paste it by hand.

### 5. Configure the LLM / agent credentials (from the web)

The engine ships no model credentials. On a container backend there is no host
CLI login to auto-detect, so every credential is entered **from the web UI** and
saved as a server-side encrypted secret (under `./config`, keyed by
`OH_SECRET_KEY`). Nothing is pasted on the VM shell.

**Claude via ACP, using a Pro/Max subscription (no API key, no Claude Code on
the VM).** The DCK image's base (`ghcr.io/openhands/agent-server`) already
pre-installs the ACP CLI wrappers (`@agentclientprotocol/claude-agent-acp`
etc.), and the SDK rewrites the default `npx -y <pkg>` launch to that pinned
in-image binary — so the VM never installs or runs Claude Code itself.
Authentication rides on a single secret, `CLAUDE_CODE_OAUTH_TOKEN`:

1. **Generate the token once, on a machine that already has Claude Code + a
   Pro/Max login** (your laptop — not the VM):
   ```bash
   claude setup-token      # opens a browser, prints a long-lived OAuth token
   ```
   Copy the printed token.
2. **Paste it into the web UI** — either path saves the same global secret:
   - **Onboarding**: pick agent **Claude Code** → the **Set up credentials**
     step (required on a container backend) → fill `CLAUDE_CODE_OAUTH_TOKEN`.
   - **Settings → Secrets** (`/settings/secrets`) → **Add a secret**: Name
     `CLAUDE_CODE_OAUTH_TOKEN` (exact, uppercase — the name *is* the env var the
     agent-server exports into the ACP subprocess), Value = the token.
3. Start a conversation with the Claude Code agent. The agent-server resolves
   the secret and exports it to the ACP subprocess; your subscription session is
   used.

> [!IMPORTANT]
> Do **not** also set `ANTHROPIC_API_KEY` or `ANTHROPIC_BASE_URL` when using the
> OAuth token. The SDK strips both when `CLAUDE_CODE_OAUTH_TOKEN` is present, and
> a stray base URL silently breaks the token's bearer auth. The UI warns on this
> conflict — keep only the OAuth token set.

**Other options (also entirely web-based):**

- **Anthropic API key** instead of a subscription: Settings → LLM → auth type
  *API key* → Anthropic, or save `ANTHROPIC_API_KEY` under Secrets. Most robust
  (no CLI anywhere), but billed per token rather than via a subscription.
- **ChatGPT subscription** (OpenAI): Settings → LLM → auth type *ChatGPT
  subscription* runs a device-code login in the browser — no CLI needed.
- **Codex / Gemini ACP**: analogous to Claude — paste `CODEX_AUTH_JSON` /
  `GOOGLE_APPLICATION_CREDENTIALS_JSON` (+ project/location) under Secrets.

> [!NOTE]
> The ACP wrappers are pre-installed in the image, so an ACP conversation does
> not need the VM to reach the npm registry at runtime. If you ever switch to a
> base image that lacks them, the default `npx -y <pkg>` launch would require
> outbound npm access from the container.

### Managing the service

```bash
cd /opt/dck-agentic
docker compose logs -f           # status and logs
docker compose restart           # restart
docker compose down              # stop (data persists on the bind mounts)
# Upgrade: bump CANVAS_IMAGE_TAG in .env, then:
docker compose pull && docker compose up -d
```

Reset the whole portal by deleting `config/portal-auth.json` and restarting
(the next visit returns to first-run `/setup`).

---

## TLS — wildcard `*.dckautoposting.com` via Cloudflare DNS-01

The VM already runs nginx + certbot for other sites (HTTP-01). For DCK we add a
single **wildcard** certificate so every new app subdomain is covered without a
per-app certbot run. Let's Encrypt requires the DNS-01 challenge for wildcards,
and the domain's registrar nameservers (`dns-parking.com`) have no API — so the
zone is moved to **Cloudflare** first.

### a. Move the zone to Cloudflare (do this carefully — apex serves live sites)

1. Add `dckautoposting.com` to Cloudflare. Let it import existing records, then
   **verify every current record** (apex A, any subdomains in use) is present.
2. Set the records that nginx terminates TLS for to **DNS-only (grey cloud)** so
   Cloudflare does not proxy/alter TLS — nginx + Let's Encrypt stay in charge.
3. Add:
   - `agent` → `72.60.211.159` (A, DNS-only)
   - `*`     → `72.60.211.159` (A, DNS-only) — wildcard so new app subdomains
     resolve with no DNS change at publish time.
4. Only after records are verified, change the nameservers at the registrar to
   the Cloudflare pair. This is reversible but mis-steps can briefly break the
   apex site — confirm propagation before and after.

### b. Issue the wildcard certificate

```bash
# Install the Cloudflare DNS plugin matching your certbot install.
# (snap) sudo snap set certbot trust-plugin-with-root=ok && \
#        sudo snap install certbot-dns-cloudflare
# (pip)  sudo pip install certbot-dns-cloudflare

sudo install -d -m 700 /root/.secrets
sudo tee /root/.secrets/cloudflare.ini >/dev/null <<'INI'
dns_cloudflare_api_token = <scoped-token: Zone.DNS:Edit on dckautoposting.com>
INI
sudo chmod 600 /root/.secrets/cloudflare.ini

sudo certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  -d 'dckautoposting.com' -d '*.dckautoposting.com'

sudo certbot renew --dry-run     # confirm unattended auto-renew works
```

The cert lands at `/etc/letsencrypt/live/dckautoposting.com/` and the existing
certbot systemd timer renews it. Every `*.dckautoposting.com` host nginx serves
now has TLS with no further certbot calls.

---

## nginx — Canvas at root + preview path

Canvas is reached at the root of `agent.dckautoposting.com`; webgen app previews
are reached under `/preview/<app>/` on the same server block. Per-app server
blocks (published subdomains) live in a dedicated include dir so the agent can
add them without touching any other site's config.

Create `/etc/nginx/sites-available/agent.dckautoposting.com`:

```nginx
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name agent.dckautoposting.com;

    ssl_certificate     /etc/letsencrypt/live/dckautoposting.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dckautoposting.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 50M;   # automation tarball uploads

    # Webgen previews — one file per app, written by the agent. The
    # /preview/<app>/ prefix is more specific than / so it wins over the
    # Canvas root route below.
    include /etc/nginx/dck-apps/preview-*.conf;

    # Canvas (ingress on 8010). Must forward X-Forwarded-Proto so the portal
    # session cookie is marked Secure, and X-Forwarded-For for login throttling.
    location / {
        proxy_pass http://127.0.0.1:8010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # WebSocket / SSE for live agent events.
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name agent.dckautoposting.com;
    return 301 https://$host$request_uri;
}
```

Create the app include dir, enable the site, test, reload:

```bash
sudo install -d -o root -g root /etc/nginx/dck-apps
sudo ln -sf /etc/nginx/sites-available/agent.dckautoposting.com \
            /etc/nginx/sites-enabled/agent.dckautoposting.com
sudo nginx -t && sudo systemctl reload nginx
```

Verify:

```bash
curl -I https://agent.dckautoposting.com/     # 200/302 → portal login
curl -I http://agent.dckautoposting.com/      # 301 → https
```

A `502 Bad Gateway` means the stack on `127.0.0.1:8010` is down — check
`docker compose ps` / `logs`.

### Published app subdomains

When the agent publishes a webgen app, it writes
`/etc/nginx/dck-apps/<app>.conf` (a `server { server_name <app>.dckautoposting.com; ... }`
block reusing the wildcard cert), then reloads nginx. No certbot call is needed
because the wildcard already covers `<app>.dckautoposting.com`, and the wildcard
`*` A record already resolves it. See
`workspace/.agents/skills/web-generator/SKILL.md` for the exact convention.

---

## Database connectivity

- **Canvas engine → automation DB**: `AUTOMATION_DB_URL` points at
  `postgres:5432/dck_agentic` (service name on the `dck` network).
- **Webgen apps → their DB**: each app container joins the `dck` network
  (`external: true, name: dck`) and connects to `postgres:5432/dck_<app>`. The
  agent creates `dck_<app>` once with the admin role. Postgres is **not**
  published to the host, so apps use the service name, not `host.docker.internal`.
- **Webgen apps → Redis**: the engine needs no Redis. Apps that need caching or
  queues use the existing host `redis-shared` via
  `REDIS_URL=redis://host.docker.internal:6379` (requires
  `extra_hosts: host.docker.internal:host-gateway` on the app service).

---

## Backup & restore

All durable state is under `/opt/dck-agentic/`:

```bash
cd /opt/dck-agentic

# Databases (automation + every webgen app) in one shot:
docker compose exec -T postgres pg_dumpall -U dck > backup-$(date +%F)-pg.sql

# Config + workspace (portal accounts, conversations, generated code):
sudo tar czf backup-$(date +%F)-files.tgz config workspace

# Restore DB into a fresh cluster:
#   cat backup-YYYY-MM-DD-pg.sql | docker compose exec -T postgres psql -U dck
# Restore files: stop the stack, extract the tarball over config/ + workspace/,
# fix ownership (see Quick Start step 2), start again.
```

Moving to a new VM = copy `/opt/dck-agentic/` wholesale (including `pgdata/`
while stopped) + re-point DNS. The wildcard cert and nginx config are the only
host-level pieces to recreate.

---

## Security notes

- The `canvas` container runs `privileged: true` with the Docker socket mounted
  so the agent can run `docker compose` to deploy webgen apps. This grants
  effective host-root to anyone who can drive the agent — the portal login is
  the control that stops that. Keep the ingress published on loopback only and
  always front it with the TLS reverse proxy; never expose plain HTTP.
- The agent writes nginx server blocks only under `/etc/nginx/dck-apps/` and
  reloads nginx; it must not edit other sites' config. Grant it the narrow sudo
  needed for that dir + `nginx -t && systemctl reload nginx`, nothing broader.
- The session cookie travels from the browser, so nginx must forward
  `X-Forwarded-Proto` (cookie `Secure`) and `X-Forwarded-For` (login throttling).

---

## Development vs deployment

- **Deployment** (above): `docker compose` from `/opt/dck-agentic`, image pulled
  from ghcr, `AUTOMATION_DB_URL` host = `postgres:5432`.
- **Development**: `npm run dev` on the host. It reads the repo `.env`, but on
  the host `postgres:5432` does not resolve — point `AUTOMATION_DB_URL` at a
  reachable Postgres (`localhost:5432`) or use `npm run dev:mock` for pure UI
  work. `npm run dev` runs behind the login portal (`--portal`); create the
  admin at `/setup` on first run.
