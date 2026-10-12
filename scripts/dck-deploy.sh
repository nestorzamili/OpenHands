#!/usr/bin/env bash
# DCK Agentic — VM-side deploy, invoked by CI over SSH:
#   bash <staging-dir>/scripts/dck-deploy.sh <image-tag> <staging-dir> [image]
#
# Self-contained and idempotent: first run (no .env) bootstraps the release
# dir and generates .env; later runs refresh deploy files and roll the image.
# Never clones the repo; CI scp's the deploy files to <staging-dir> first.
set -euo pipefail

NEW_TAG="${1:?usage: dck-deploy.sh <image-tag> <staging-dir>}"
STAGING="${2:?usage: dck-deploy.sh <image-tag> <staging-dir>}"
REQUESTED_IMAGE="${3:-${CANVAS_IMAGE:-}}"
TARGET_DIR="${TARGET_DIR:-/opt/dck-agentic}"
CANVAS_UID="${CANVAS_UID:-10001:10001}"
log() { printf '[dck-deploy] %s\n' "$*"; }
die() { printf '[dck-deploy] ERROR: %s\n' "$*" >&2; exit 1; }
if [ -n "$REQUESTED_IMAGE" ] && [[ ! "$REQUESTED_IMAGE" =~ ^ghcr\.io/[a-z0-9._-]+(/[a-z0-9._-]+)*$ ]]; then
  die "image must be an untagged lowercase GHCR image path"
fi
read_env_value() {
  awk -v key="$1" 'index($0, key "=") == 1 { value = substr($0, length(key) + 2); found = 1 } END { if (found) print value }' "$ENV_FILE"
}
write_env_value() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { prefix = key "=" }
    index($0, prefix) == 1 { print prefix value; found = 1; next }
    { print }
    END { if (!found) print prefix value }
  ' "$ENV_FILE" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}
[ -d "$STAGING" ] || die "staging dir $STAGING not found"
command -v docker >/dev/null 2>&1 || die "docker not found"
docker compose version >/dev/null 2>&1 || die "docker compose v2 not available"

mkdir -p "$TARGET_DIR"/{config,workspace,pgdata}

# Refresh deploy files from staging — compose, scripts, skills, env template.
# Never touch .env, config/, pgdata/, or agent-authored projects.
cp "$STAGING/docker-compose.yml"     "$TARGET_DIR/"
cp "$STAGING/.env.production.sample" "$TARGET_DIR/"
mkdir -p "$TARGET_DIR/scripts"
cp "$STAGING/scripts/dck-deploy.sh" "$TARGET_DIR/scripts/"
cp "$STAGING/scripts/migrate-automation-db.sh" "$TARGET_DIR/scripts/"
chmod +x "$TARGET_DIR/scripts/dck-deploy.sh" "$TARGET_DIR/scripts/migrate-automation-db.sh"
mkdir -p "$TARGET_DIR/services/webgen-control"
cp "$STAGING/services/webgen-control/webgen_control.py" "$STAGING/services/webgen-control/requirements.txt" "$STAGING/services/webgen-control/webgen-control.service" "$TARGET_DIR/services/webgen-control/"
rm -rf "$TARGET_DIR/workspace/.agents"
cp -r "$STAGING/workspace/.agents"   "$TARGET_DIR/workspace/.agents"
cp "$STAGING/workspace/AGENTS.md"    "$TARGET_DIR/workspace/AGENTS.md"

ENV_FILE="$TARGET_DIR/.env"
ENV_WAS_PRESENT=0
if [ ! -f "$ENV_FILE" ]; then
  ENV_WAS_PRESENT=0
  log "first run — generating $ENV_FILE"
  cp "$TARGET_DIR/.env.production.sample" "$ENV_FILE"
  PG_PASS="$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)"
  IMG="${REQUESTED_IMAGE:-ghcr.io/${IMAGE_OWNER:?set IMAGE_OWNER or pass an image}/dck-agentic}"
  PREV_IMAGE="$IMG"
  sed -i \
    -e "s|^CANVAS_IMAGE=.*|CANVAS_IMAGE=${IMG}|" \
    -e "s|^CANVAS_IMAGE_TAG=.*|CANVAS_IMAGE_TAG=${NEW_TAG}|" \
    -e "s|^POSTGRES_USER=.*|POSTGRES_USER=dck|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PASS}|" \
    -e "s|^POSTGRES_DB=.*|POSTGRES_DB=dck_agentic|" \
    -e "s|^AUTOMATION_DB_URL=.*|AUTOMATION_DB_URL=postgresql+asyncpg://dck:${PG_PASS}@postgres:5432/dck_agentic|" \
    "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  PREV_TAG="$NEW_TAG"
else
  ENV_WAS_PRESENT=1
  PREV_TAG="$(grep -E '^CANVAS_IMAGE_TAG=' "$ENV_FILE" | cut -d= -f2-)"
  PREV_IMAGE="$(read_env_value CANVAS_IMAGE)"
  log "existing deploy — current=$PREV_TAG new=$NEW_TAG"
  if [ -n "$REQUESTED_IMAGE" ]; then
    write_env_value CANVAS_IMAGE "$REQUESTED_IMAGE"
  fi
fi

WEBGEN_GATEWAY="$(docker network inspect bridge --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null | head -n1)"
[[ "$WEBGEN_GATEWAY" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || die "cannot determine Docker's private bridge gateway"
write_env_value WEBGEN_CONTROL_HOST_IP "$WEBGEN_GATEWAY"

chmod 600 "$ENV_FILE"

if [ "$ENV_WAS_PRESENT" = "1" ]; then
  write_env_value CANVAS_IMAGE_TAG "$NEW_TAG"
fi

# Do not recursively chown workspace: it can contain large agent-authored apps
# and Docker build contexts. Only persistent Canvas config and shipped skills
# are managed here; project folders are created by Canvas with the right owner.
chown -R "$CANVAS_UID" "$TARGET_DIR/config"
chown "$CANVAS_UID" "$TARGET_DIR/workspace" "$TARGET_DIR/workspace/AGENTS.md"
chown -R "$CANVAS_UID" "$TARGET_DIR/workspace/.agents"
mkdir -p "$TARGET_DIR/workspace/webgen"
chown "$CANVAS_UID" "$TARGET_DIR/workspace/webgen"

WEBGEN_VENV="$TARGET_DIR/webgen-control-venv"
if [ ! -x "$WEBGEN_VENV/bin/python" ]; then
  python3 -m venv "$WEBGEN_VENV" || die "python3-venv is required to install the WebGen control service"
fi
REQ_HASH="$(sha256sum "$TARGET_DIR/services/webgen-control/requirements.txt" | awk '{print $1}')"
OLD_REQ_HASH="$(cat "$WEBGEN_VENV/.requirements.sha256" 2>/dev/null || true)"
if [ "$REQ_HASH" != "$OLD_REQ_HASH" ]; then
  "$WEBGEN_VENV/bin/pip" install --disable-pip-version-check --no-input -r "$TARGET_DIR/services/webgen-control/requirements.txt"
  printf '%s\n' "$REQ_HASH" > "$WEBGEN_VENV/.requirements.sha256.tmp"
  chmod 600 "$WEBGEN_VENV/.requirements.sha256.tmp"
  mv "$WEBGEN_VENV/.requirements.sha256.tmp" "$WEBGEN_VENV/.requirements.sha256"
fi
"$WEBGEN_VENV/bin/python" -m py_compile "$TARGET_DIR/services/webgen-control/webgen_control.py"
install -d -m 0755 /etc/nginx/dck-apps
install -m 0644 "$TARGET_DIR/services/webgen-control/webgen-control.service" /etc/systemd/system/webgen-control.service
printf 'WEBGEN_BIND_HOST=%s\n' "$WEBGEN_GATEWAY" > "$TARGET_DIR/webgen-control.env.tmp"
chmod 600 "$TARGET_DIR/webgen-control.env.tmp"
mv "$TARGET_DIR/webgen-control.env.tmp" "$TARGET_DIR/webgen-control.env"
systemctl daemon-reload
systemctl enable webgen-control.service
systemctl restart webgen-control.service
service_ok=0
for _ in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://${WEBGEN_GATEWAY}:8769/healthz" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then service_ok=1; break; fi
  sleep 1
done
[ "$service_ok" = "1" ] || die "WebGen control service health check failed; Canvas deployment was not started"

cd "$TARGET_DIR"

log "pull + up..."
docker compose pull canvas
docker compose up -d

code=000
ok=0
for _ in $(seq 1 40); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8010/alive 2>/dev/null || echo 000)"
  case "$code" in 200|302) ok=1; break;; esac
  sleep 3
done

if [ "$ok" != "1" ]; then
  log "HEALTH CHECK FAILED (last=$code) — rolling back to $PREV_TAG"
  write_env_value CANVAS_IMAGE_TAG "$PREV_TAG"
  if [ -n "$PREV_IMAGE" ]; then
    write_env_value CANVAS_IMAGE "$PREV_IMAGE"
  fi
  docker compose up -d
  exit 1
fi
log "deploy OK: $NEW_TAG"

IMAGE_REPO="$(read_env_value CANVAS_IMAGE)"
log "pruning old $IMAGE_REPO images..."
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' \
  | awk -v repo="$IMAGE_REPO" -v keep="${IMAGE_REPO}:${NEW_TAG}" \
      '$1 ~ "^"repo":" && $1 != keep {print $2}' \
  | sort -u | xargs -r docker rmi 2>/dev/null || true
log "done."
