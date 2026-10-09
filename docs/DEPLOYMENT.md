# DCK Agentic — Deployment

DCK Agentic runs the OpenHands Agent Canvas as an all-in-one container, served
at the root of `https://agent.dckautoposting.com`, deployed to a VM from CI over
SSH. This guide assumes a fresh VM with nothing set up yet.

Facts the setup relies on:

- Canvas is served at the root path (`VITE_BASE_PATH=/`, baked by `dck-docker.yml`).
- The deployment seeds its bundled Agent Server as the **Production** backend on first visit; existing default `Local` entries are renamed while custom labels are preserved.
- Ingress is published on `127.0.0.1:8010` (pick another port if 8010 is taken).
- Postgres is dedicated to DCK, internal-only, reached as `postgres:5432` on the
  `dck` network; it holds `dck_agentic` + one `dck_<app>` per webgen app.
- Redis is not used by the engine; webgen apps use a host Redis via
  `host.docker.internal:6379` when needed.
- Beszel Hub is published only on `127.0.0.1:8090`. Its separate history UI is
  optional and requires the matching nginx route below; Canvas does not link to
  it unless that public route is verified. Beszel collects host trends, while
  `/monitoring` shows current DCK service and Webgen container status.

## 1. Prepare the VM

Install Docker Engine + Compose v2 and nginx. Create the deploy user's SSH
access:

```bash
# Docker: https://docs.docker.com/engine/install/
sudo apt-get install -y nginx
# add your deploy user's public key to its ~/.ssh/authorized_keys
```

The VM needs only Docker, nginx, and the authorized SSH key — no repo checkout,
no gh, no manual bootstrap.

## 2. DNS + TLS (Cloudflare + wildcard cert)

Put `dckautoposting.com` on Cloudflare, then add A records (DNS-only / grey
cloud, so nginx terminates TLS):

- `agent` → VM IP
- `*` → VM IP (wildcard, so new webgen subdomains resolve with no DNS change)

Issue a wildcard cert with the DNS-01 challenge:

```bash
sudo apt-get install -y python3-certbot-dns-cloudflare
sudo install -d -m 700 /root/.secrets
echo "dns_cloudflare_api_token = <token: Zone.DNS:Edit on dckautoposting.com>" \
  | sudo tee /root/.secrets/cloudflare.ini >/dev/null
sudo chmod 600 /root/.secrets/cloudflare.ini

sudo certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  --dns-cloudflare-propagation-seconds 30 \
  -d 'dckautoposting.com' -d '*.dckautoposting.com'
```

Cert lands at `/etc/letsencrypt/live/dckautoposting.com/`, auto-renewed by the
certbot timer.

## 3. Deploy (CI, workflow_dispatch)

Add GitHub repo secrets (Settings → Secrets → Actions):

- `VM_SSH_TARGET` — `user@host:port`, e.g. `dck@203.0.113.10:22`
- `VM_SSH_KEY` — private key whose public key is authorized on the VM

Run `.github/workflows/dck-docker.yml` from the Actions tab (or
`gh workflow run dck-docker.yml`) with the **deploy** input ticked. It builds
`ghcr.io/<owner>/dck-agentic:sha-<short>`, SSHes to the VM, copies the deploy
files, and runs `scripts/dck-deploy.sh <sha>`. The VM never builds or clones.

`dck-deploy.sh` is idempotent:

- First run (no `.env`): creates `/opt/dck-agentic/{config,workspace,pgdata,beszel-data,beszel-agent-data}`,
  generates `.env` (random Postgres and Beszel passwords, image repo + `sha-<short>` tag),
  chowns bind mounts to the canvas UID (10001), `pull` + `up -d`.
- Update: refreshes compose/scripts/skills, sets the new tag, `pull` + `up -d`.
  Never touches `.env`, `config/`, `pgdata/`, `beszel-data/`,
  `beszel-agent-data/`, or agent-authored `workspace/*`.

After `up -d` it health-checks `/alive` (200/302), rolls back to the previous
tag on failure, and prunes only old `dck-agentic` images. The automation schema
migrates automatically on startup.

## 4. nginx

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

    client_max_body_size 50M;

    include /etc/nginx/dck-apps/preview-*.conf;

    location / {
        proxy_pass http://127.0.0.1:8010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # Beszel has its own login. Strip /beszel before forwarding and preserve
    # WebSocket support for the UI and agent connections.
    location = /beszel {
        return 301 /beszel/;
    }

    location ^~ /beszel/ {
        proxy_read_timeout 360s;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        rewrite ^/beszel/(.*)$ /$1 break;
        proxy_pass http://127.0.0.1:8090;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name agent.dckautoposting.com;
    return 301 https://$host$request_uri;
}
```

```bash
sudo install -d /etc/nginx/dck-apps
sudo ln -sf /etc/nginx/sites-available/agent.dckautoposting.com \
            /etc/nginx/sites-enabled/agent.dckautoposting.com
sudo nginx -t && sudo systemctl reload nginx
```

`502 Bad Gateway` means the stack on `127.0.0.1:8010` is down — check
`docker compose ps` / `logs`. Webgen publish/preview blocks are written by the
agent under `/etc/nginx/dck-apps/` — see
`workspace/.agents/skills/web-generator/SKILL.md`.

## 5. First-run admin

Open `https://agent.dckautoposting.com/` → create the admin at `/setup`. Auth is
mandatory (username/password portal); accounts and sessions persist under
`./config`.

Beszel uses a separate login and persistent data directory. On a fresh deploy,
the deploy script generates a strong first-user password and stores it with
`BESZEL_ADMIN_EMAIL` in the mode-600 `/opt/dck-agentic/.env`. The Hub uses these
credentials to create its initial user, then the initializer signs in, fetches
the Hub's public SSH key, enables or reuses a permanent universal token, and
stores them in `beszel-agent-data/public-key` and
`beszel-agent-data/universal-token`. The host agent reads them through
`KEY_FILE` and `TOKEN_FILE`. It is part of the default Compose stack, so
`docker compose up -d` starts the Hub, initializer, and agent without a profile
or manual token step.

```bash
cd /opt/dck-agentic
docker compose up -d
```

When the optional nginx `/beszel/` route is installed and verified, open
`https://agent.dckautoposting.com/beszel/` and use the generated email and
password in `.env` to manage Beszel. Otherwise the Hub stays private on the host
loopback and the Canvas UI intentionally shows no broken link. The deployment
script persists the Hub credentials and copies the generated token into both `.env` and
`beszel-agent-data/universal-token`; the public key remains in
`beszel-agent-data/public-key`. Subsequent Compose runs and agent restarts reuse
both persisted values. The initializer contacts the Hub again only if one is
missing or an explicit override is supplied.

The agent uses host networking for accurate host network-interface metrics and
connects to the Hub over WebSocket at the configured loopback port (8090 by
default). SSH mode is disabled, so it does not expose Beszel's default inbound
agent port. The Beszel agent has no Docker socket. Canvas itself uses the host
Docker socket for current container monitoring and Webgen lifecycle operations;
the socket grants root-equivalent Docker API access even though the browser
monitoring endpoint is GET-only. Canvas therefore runs without `privileged`
mode, uses only the socket's supplemental group, and must remain behind portal
authentication with access limited to trusted users.

The agent does not mount the host root filesystem. This avoids giving a
monitoring container broad read access to host files; if its root-disk chart
does not match the VM's actual system filesystem, configure an explicit
`FILESYSTEM`/disk mount only for the specific volume that should be monitored.

## 6. LLM / agent credentials (from the web)

No model credentials ship in the image — enter them in the UI; they are stored
server-side encrypted under `./config`.

**Claude via ACP (Pro/Max subscription, no Claude Code on the VM):** the image
pre-installs the ACP wrappers, so you only supply a token.

1. On a machine with Claude Code + a Pro/Max login: `claude setup-token` → copy
   the token.
2. In the UI: onboarding **Set up credentials**, or Settings → Secrets → add
   `CLAUDE_CODE_OAUTH_TOKEN` = the token.
3. Start a Claude Code conversation.

> Do **not** also set `ANTHROPIC_API_KEY` or `ANTHROPIC_BASE_URL` with the OAuth
> token — the SDK strips them and a stray base URL breaks the bearer auth.

Other paths (all web-based): Anthropic API key (`ANTHROPIC_API_KEY`), ChatGPT
subscription (Settings → LLM → device login), Codex/Gemini ACP
(`CODEX_AUTH_JSON` / `GOOGLE_APPLICATION_CREDENTIALS_JSON`).

## Managing the service

```bash
cd /opt/dck-agentic
docker compose logs -f
docker compose restart
docker compose down          # data persists on the bind mounts
```

Reset the portal: delete `config/portal-auth.json` and restart.

> Out-of-band DB migration (rare; automatic otherwise): run
> `scripts/migrate-automation-db.sh` with `CONTAINER=dck-agentic-canvas` and
> `AUTOMATION_DB_URL` set.

## Backup & restore

All durable state is under `/opt/dck-agentic/`:

```bash
cd /opt/dck-agentic
docker compose exec -T postgres pg_dumpall -U dck > backup-$(date +%F)-pg.sql
sudo tar czf backup-$(date +%F)-files.tgz config workspace beszel-data beszel-agent-data
```

Restore DB: `cat backup-*.sql | docker compose exec -T postgres psql -U dck`.
Restore files: stop the stack, extract over `config/`, `workspace/`,
`beszel-data/`, and `beszel-agent-data/`, re-chown Canvas-owned directories to
10001, then start. Move VMs by copying `/opt/dck-agentic/` (with `pgdata/` while
stopped) and re-pointing DNS.

## Security notes

- `canvas` runs `privileged` with the Docker socket mounted (so the agent can
  deploy webgen apps) — effective host-root for anyone who can drive the agent.
  The portal login is the control; keep ingress on loopback behind the TLS proxy.
- The agent writes nginx blocks only under `/etc/nginx/dck-apps/` + reloads;
  grant it only that narrow sudo.

## Development

`npm run dev` on the host reads the repo `.env`; point `AUTOMATION_DB_URL` at a
reachable Postgres (`localhost:5432`) or use `npm run dev:mock` for UI-only work.
It runs behind the login portal — create the admin at `/setup` on first run.
