# WebGen Control Service

A root-run, host-side internal HTTP service for the DCK WebGen lifecycle. It uses Python stdlib HTTP/subprocess/urllib, pinned `cryptography` for in-memory AES-GCM seed storage and deterministic per-project Ed25519 signing, and pinned PyYAML to reject unsafe source Compose features before invoking Docker. It must be reached through the authenticated parent Canvas proxy; it has no CORS support and binds only to the private Docker host gateway (`WEBGEN_BIND_HOST`, default `172.17.0.1`), never a public interface.

## Run and test

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python3 -m unittest discover -s tests -v
WEBGEN_WORKSPACE_ROOT=/opt/dck-agentic/workspace python3 webgen_control.py
```

Environment: `WEBGEN_WORKSPACE_ROOT` (default `/opt/dck-agentic/workspace`), `WEBGEN_NGINX_DIR` (default `/etc/nginx/dck-apps`), `WEBGEN_CANVAS_AUTH_URL` (default `http://127.0.0.1:8010/api/workspaces`), `WEBGEN_CONTROL_KEY` (default `/opt/dck-agentic/config/webgen-control.key`, created atomically mode 0600), `WEBGEN_BIND_HOST`, and `WEBGEN_CONTROL_PORT` (default `8769`). Every API request requires `X-Session-API-Key`, validated only against the fixed Canvas auth endpoint. Lifecycle actions pass that same key server-to-server to the existing Secret Manager APIs; secret values are never sent to the browser, included in logs, or returned in status payloads. `/healthz` is intentionally unauthenticated and reveals only `{status:ok}`.

The app-local owner endpoint contract accepts the signed JSON object described by the WebGen skill and returns 2xx, or 409 for an already-created owner. The service signs the exact ordered UTF-8 JSON array `[version, project_slug, conversation_id, issued_at, expires_at, nonce, email, username, password]`, preserving password Unicode and whitespace. Seeds are AES-GCM encrypted in process memory, expire within 15 minutes, and are retained until delivery succeeds (including an idempotent 409); authorization lasts at most five minutes. No seed is written to metadata, `.env`, logs, or prompts.

The verification key is derived deterministically per slug from the persistent master key using HKDF-SHA256, so it remains stable across restarts while different projects receive different keys. Owner health and delivery use the deterministic `<slug>-app` container's private IP on external Docker network `dck`, port 3000; published host-port metadata is never used for owner provisioning. Source YAML and rendered Compose JSON are validated against the single-app policy before Docker commands run. Builds are serialized; status polling is limited to Compose-managed projects. The service returns the Agent Server-visible workspace path (`/projects/webgen/<slug>`), not the host filesystem path.

`deploy` and `rebuild` materialize only `<SECRET_NAME>_<PROJECT_SLUG>` values from Secret Manager into an atomic, mode-`0600` `.env`, then create/update `preview-<slug>.conf` for the agent-host preview include. `publish` rebuilds with `APP_BASE_PATH=` and installs a `published-<slug>.conf` TLS server block using the wildcard certificate paths from `docs/DEPLOYMENT.md`; the HTTP vhost redirects to HTTPS. `unpublish` rebuilds with `APP_BASE_PATH=/preview/<slug>`, removes the published block, and recreates the preview route. Nginx validation/reload failures restore the prior env, metadata, runtime, and route files as far as the Docker build allows.

**Delete is destructive:** it removes the public route first, runs the fixed Compose-down operation, drops `dck_<slug>` from the fixed `dck-agentic-postgres` container, then removes the project files and both route files. Confirmation is a UI responsibility and is not exposed by this API. Canvas never receives or mounts `/var/run/docker.sock`.
