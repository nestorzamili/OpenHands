# DCK Agentic — Deployment

DCK Agentic runs the OpenHands Agent Canvas as an all-in-one container, served
at the root of `https://agent.dckautoposting.com`, deployed to a VM from CI over
SSH. This guide describes the current deployment architecture and fresh setup.
For the existing VM and the next release, follow the ordered
[production action plan](webgen-production-migration.md).

Facts the setup relies on:

- Canvas is served at the root path (`VITE_BASE_PATH=/`, baked by `dck-docker.yml`).
- The deployment seeds its bundled Agent Server as the **Production** backend on first visit; existing default `Local` entries are renamed while custom labels are preserved.
- Ingress is published on `127.0.0.1:8010`.
- The read-only WebGen internal proxy is published on `127.0.0.1:8012` and
  validates API keys upstream. Port `8011` belongs to the existing content app.
- Preview uses `/preview/<slug>` on the Canvas domain. Only explicit Publish
  uses an app subdomain; the two modes do not run concurrently.
- Postgres is dedicated to DCK, internal-only, reached as `postgres:5432` on the
  `dck` network; it holds `dck_agentic` + one `dck_<app>` per webgen app.
- Redis is not used by the engine; webgen apps use a host Redis via
  `host.docker.internal:6379` when needed.

## 1. Prepare the VM

Install Docker Engine + Compose v2 and nginx. Create the deploy user's SSH
access:

```bash
# Docker: https://docs.docker.com/engine/install/
sudo apt-get install -y nginx python3-venv
# add the public key for VM_SSH_TARGET to ~/.ssh/authorized_keys
```

The account used by `VM_SSH_TARGET` must be able to stage files under `/tmp`;
the deployment process, directly or through sudo, must be able to write
`/opt/dck-agentic`, run Docker Compose, install a Python 3 virtual environment,
manage the `webgen-control` systemd unit, and write `/etc/nginx/dck-apps` when
projects are published. Use root for
`VM_SSH_TARGET`, or configure non-interactive `sudo -n` for the staged deploy
script. The VM needs no repository checkout or GitHub CLI.

## 2. DNS + TLS (Cloudflare + wildcard cert)

Put `dckautoposting.com` on Cloudflare, then add A records (DNS-only / grey
cloud, so nginx terminates TLS):

- `agent` → VM IP
- `*` → VM IP when enabling Publish (preview paths need only the Canvas domain)

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

Run `.github/workflows/dck-docker.yml` manually from the Actions tab with branch
`dev` and `action: build and deploy`. The default action is `build only`, which
publishes the image without changing the VM. The workflow image is
`ghcr.io/<repository-owner>/dck-agentic`; there is no image override input.
It passes that image path and the selected commit's `sha-<short>` tag into the
VM's `.env`.

```bash
gh workflow run dck-docker.yml --ref dev -f action="build and deploy"
```

For the image pull, the workflow streams its `GITHUB_TOKEN` to the VM over SSH.
The remote wrapper uses `docker login --password-stdin` with a temporary
`DOCKER_CONFIG`, then removes that login configuration on exit; no GHCR token is
left in the VM's normal Docker config. Ensure the GHCR package grants this
repository's workflow token access. The VM never builds or clones.

The workflow does not change or verify the VM's Nginx, DNS, Cloudflare API
token, Certbot, or TLS configuration. Keep the existing host configuration and
confirm that Nginx already proxies the application to `127.0.0.1:8010` with the
headers and WebSocket settings below, and that the existing Cloudflare DNS/TLS
renewal setup remains valid.

`dck-deploy.sh` is idempotent:

- First run (no `.env`): creates `/opt/dck-agentic/{config,workspace,pgdata}`,
  generates `.env` (random Postgres password, image repo + `sha-<short>` tag),
  records the private Docker bridge gateway, installs and health-checks the
  typed WebGen host service, then `pull` + `up -d`.
- Update: refreshes Compose/scripts and the host service, updates image and
  gateway values in `.env`, and runs `pull` + `up -d`. It preserves existing
  credentials, PostgreSQL data, and project source. Managed-skill hashes control
  which bundled files may be updated; user edits are retained with incoming
  candidates under `config/skill-update-candidates`. It writes the skill
  manifest and host-service configuration, and does not recursively `chown`
  application project directories.

After `up -d`, an active UFW receives a rule limited to the `dck` bridge interface
and IPv4 subnet, the private host gateway, and TCP port `8769`. The script does
not enable UFW or expose that port on public interfaces. It checks both `/alive`
(200/302) and WebGen `/healthz` **from inside Canvas**, rolls back to the previous
tag on failure, and prunes old images from the selected image repository. This
automatic recovery covers the Canvas image only, not the copied Compose,
host-service files, or database schema. Back up the whole release before the
cutover; rollback must restore a coherent release. The automation schema
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

For Publish, create `/etc/nginx/conf.d/dck-webgen.conf` with the following
HTTP-scope include. Include it exactly once; do not also add it to the site file.

```nginx
include /etc/nginx/dck-apps/published-*.conf;
```

Run `nginx -t` and reload after adding it. A Canvas `502 Bad Gateway` requires
checking the stack on `127.0.0.1:8010` via `docker compose ps` / `logs`; a preview
502 requires checking that app's runtime. WebGen route blocks are written by
the host control service under `/etc/nginx/dck-apps/` — see
[WebGen control](webgen-control.md).
The preview include belongs inside the agent server because it contains
`location` blocks; the published include must remain at `http` scope because it
contains standalone TLS/redirect `server` blocks. Existing VMs need this include
added to their host nginx site manually; `dck-deploy.sh` does not rewrite host
nginx site files. Publishing also requires the wildcard DNS record and
certificate from §2.

## 5. First-run admin

Open `https://agent.dckautoposting.com/` → create the admin at `/setup`. Auth is
mandatory (username/password portal); accounts and sessions persist under
`./config`.

```bash
cd /opt/dck-agentic
docker compose up -d
```

WebGen lifecycle uses a root-run host service bound only to Docker's private
bridge gateway on port `8769`. Canvas reaches it through the authenticated
same-origin proxy; the proxy adds the existing session API key, which the host
service validates through `http://127.0.0.1:8012/api/workspaces`. The service
accepts only typed lifecycle operations, validates Compose policy, serializes
image builds, and retrieves only `<SECRET_NAME>_<PROJECT_SLUG>` values from
Secret Manager into a mode-`0600` project `.env`. The Canvas container never
receives or mounts `/var/run/docker.sock`; do not expose port `8769` publicly.

If WebGen shows `Unknown` while host-side checks pass, check the container path:
`docker compose exec -T canvas python -c 'import urllib.request; print(urllib.request.urlopen("http://webgen-control.internal:8769/healthz", timeout=5).status)'`.
On hosts using a firewall other than UFW, configure the equivalent private
bridge input rule. Confirm the authenticated portal's `/api/webgen/projects`
returns 200 and the WebGen table shows the verified runtime status.

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

Canvas durable state is under `/opt/dck-agentic/`. Agent Profile choices for DCK
modules are server-side user settings (Local Agent Server `misc_settings`),
while module definitions remain in the workspace `.dck/modules.json`; the
`config` and `workspace` backup below covers both. Separately back up host
nginx/TLS configuration and application external storage; those are outside
these directories. During the existing VM cutover, back up upload volumes too.

```bash
cd /opt/dck-agentic
umask 077
docker compose exec -T postgres sh -c 'pg_dumpall -U "$POSTGRES_USER"' > backup-$(date +%F)-pg.sql
sudo tar czf backup-$(date +%F)-files.tgz .env docker-compose.yml config workspace services scripts webgen-control.env
```

Restore one selected SQL backup through `docker compose exec -T postgres sh -c
'psql -U "$POSTGRES_USER" -d postgres'`; do not concatenate multiple backups.
Restore files: stop the stack, extract over `config/` and `workspace/`,
re-chown Canvas-owned directories to 10001, then start. Move VMs by copying
`/opt/dck-agentic/` (with `pgdata/` while stopped) and re-pointing DNS.

## Security notes

- `canvas` runs without `privileged` mode and without the Docker socket. WebGen
  lifecycle operations go through the authenticated host control service on
  the private bridge described above; keep that service private and portal
  login mandatory behind the TLS proxy.
- The systemd host control service owns generated nginx blocks and reloads.
  Its sandbox grants writable access to the project/config directories,
  `/etc/nginx/dck-apps`, and `/var/log/nginx` for validation. The agent has no
  nginx sudo access. Keep port `8012` on loopback.

## Development

`npm run dev` on the host reads the repo `.env`; point `AUTOMATION_DB_URL` at a
reachable Postgres (`localhost:5432`) or use `npm run dev:mock` for UI-only work.
It runs behind the login portal — create the admin at `/setup` on first run.
