# WebGen Control Service

A root-run, host-side internal HTTP service for the DCK WebGen lifecycle. It uses Python stdlib HTTP/subprocess/urllib, pinned `cryptography` for in-memory AES-GCM seed storage and deterministic per-project Ed25519 signing, and pinned PyYAML to reject unsafe source Compose features before invoking Docker. It must be reached through the authenticated parent Canvas proxy; it has no CORS support and binds only to the private Docker host gateway (`WEBGEN_BIND_HOST`, default `172.17.0.1`), never a public interface.

## Run and test

```sh
python3 -m venv .venv-webgen
.venv-webgen/bin/pip install -r services/webgen-control/requirements.txt
sudo .venv-webgen/bin/python -m unittest discover -s services/webgen-control/tests -v
```

Run these tests from the repository root on an isolated Linux test host with nginx installed. Production uses the systemd unit installed by `scripts/dck-deploy.sh`; see [deployment](DEPLOYMENT.md) and the [production action plan](webgen-production-migration.md).

Environment: `WEBGEN_WORKSPACE_ROOT` (default `/opt/dck-agentic/workspace`), `WEBGEN_NGINX_DIR` (default `/etc/nginx/dck-apps`), `WEBGEN_CANVAS_AUTH_URL` (`http://127.0.0.1:8012/api/workspaces`), `WEBGEN_CONTROL_KEY` (default `/opt/dck-agentic/config/webgen-control.key`, created atomically mode 0600), `WEBGEN_BIND_HOST`, and `WEBGEN_CONTROL_PORT` (default `8769`). The deploy script discovers the bridge gateway rather than relying on the service default. `WEBGEN_POSTGRES_USER` comes from deployment `POSTGRES_USER`; database maintenance connects to `postgres`.

Every API request requires `X-Session-API-Key`, validated through the read-only internal proxy on loopback 8012. That proxy forwards only GET workspace/secret requests to the API-key-protected Agent Server. Public Canvas ingress remains portal-cookie protected. Lifecycle actions pass that same key server-to-server to the existing Secret Manager APIs; secret values are never sent to the browser, included in logs, or returned in status payloads. `/healthz` is intentionally unauthenticated and reveals only `{status:ok}`.

The app-local owner endpoint contract accepts the signed JSON object described by the WebGen skill and returns 2xx, or 409 for an already-created owner. The service signs the exact ordered UTF-8 JSON array `[version, project_slug, conversation_id, issued_at, expires_at, nonce, email, username, password]`, preserving password Unicode and whitespace. Seeds are AES-GCM encrypted in process memory, expire within 15 minutes, and are retained until delivery succeeds (including an idempotent 409); authorization lasts at most five minutes. No seed is written to metadata, `.env`, logs, or prompts.

The verification key is derived deterministically per slug from the persistent master key using HKDF-SHA256, so it remains stable across restarts while different projects receive different keys. Owner health and delivery use the deterministic `<slug>-app` container's private IP on external Docker network `dck`, port 3000, and the active basePath (`/preview/<slug>/api/dck/owner-seed` in preview). Missing or expired seeds return HTTP 410 so the UI can collect fresh credentials. Source YAML and rendered Compose JSON are validated against the single-app policy before Docker commands run; host mounts, named volumes, and privileged configuration are rejected. Metadata uses `authProvider` and `needsDatabase`. Builds are serialized; status polling is limited to Compose-managed projects. The service returns the Agent Server-visible workspace path (`/projects/webgen/<slug>`), not the host filesystem path.

`deploy`, `rebuild`, `start`, and `restart` materialize project-suffixed Secret Manager values and non-secret `.env.example` defaults into an atomic, mode-`0600` `.env`. Unpublished apps use `APP_BASE_PATH=/preview/<slug>` and `preview-<slug>.conf` inside the Canvas server. Published apps retain their active domain. Only `publish` accepts a subdomain: it rebuilds with an empty basePath and replaces the preview route with `published-<slug>.conf` at nginx HTTP scope, using the wildcard certificate paths in [DEPLOYMENT.md](DEPLOYMENT.md). `unpublish` rebuilds for preview and removes the published route. There is one active mode, without a second container or preview domain.

Next.js receives `APP_BASE_PATH` during the image build. Preview nginx locations preserve the entire URI, including the prefix, assets, and query parameters. Readiness polls for up to `WEBGEN_READINESS_TIMEOUT` seconds (default 120, maximum 300); Canvas proxy/client lifecycle timeouts are 45 minutes. Failed publication attempts restore saved routes, environment, metadata, and rebuild the previous mode when needed; failed recovery is reported explicitly. The systemd sandbox permits nginx log writes required by `nginx -t`.

**Delete is destructive:** projects requiring a database preflight PostgreSQL before removing routes or containers. Cleanup runs the fixed Compose-down operation, drops `dck_<slug>` through maintenance database `postgres` using the configured PostgreSQL user, then removes project files and routes. Explicitly database-free projects skip PostgreSQL. Confirmation is a UI responsibility. Canvas never receives or mounts `/var/run/docker.sock`.
