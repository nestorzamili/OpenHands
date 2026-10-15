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
WEBGEN_STATE_DIR="${WEBGEN_STATE_DIR:-/var/lib/dck-webgen-control}"
WEBGEN_KEY="$WEBGEN_STATE_DIR/webgen-control.key"
LEGACY_WEBGEN_KEY="$TARGET_DIR/config/webgen-control.key"
install -d -o root -g root -m 0700 "$WEBGEN_STATE_DIR"
if [ -L "$WEBGEN_KEY" ] || [ -L "$LEGACY_WEBGEN_KEY" ]; then
  die "WebGen master key must not be a symlink"
fi
if [ -e "$WEBGEN_KEY" ]; then
  [ -f "$WEBGEN_KEY" ] && [ "$(stat -c '%s' "$WEBGEN_KEY")" = "32" ] || die "invalid WebGen master key"
  chown root:root "$WEBGEN_KEY"
  chmod 600 "$WEBGEN_KEY"
  if [ -e "$LEGACY_WEBGEN_KEY" ]; then
    cmp -s "$WEBGEN_KEY" "$LEGACY_WEBGEN_KEY" || die "conflicting legacy WebGen key; resolve manually before deployment"
    rm -f "$LEGACY_WEBGEN_KEY"
  fi
elif [ -e "$LEGACY_WEBGEN_KEY" ]; then
  [ -f "$LEGACY_WEBGEN_KEY" ] && [ "$(stat -c '%s' "$LEGACY_WEBGEN_KEY")" = "32" ] || die "invalid legacy WebGen master key"
  KEY_TMP="$(mktemp "$WEBGEN_KEY.XXXXXX")"
  install -o root -g root -m 0600 "$LEGACY_WEBGEN_KEY" "$KEY_TMP"
  cmp -s "$KEY_TMP" "$LEGACY_WEBGEN_KEY" || { rm -f "$KEY_TMP"; die "legacy WebGen key migration verification failed"; }
  mv "$KEY_TMP" "$WEBGEN_KEY"
  rm -f "$LEGACY_WEBGEN_KEY"
fi

# Refresh deploy files from staging — compose, scripts, skills, env template.
# Never touch .env, config/, pgdata/, or agent-authored projects.
cp "$STAGING/docker-compose.yml"     "$TARGET_DIR/"
cp "$STAGING/.env.production.sample" "$TARGET_DIR/"
mkdir -p "$TARGET_DIR/scripts"
cp "$STAGING/scripts/dck-deploy.sh" "$TARGET_DIR/scripts/"
chmod +x "$TARGET_DIR/scripts/dck-deploy.sh"
mkdir -p "$TARGET_DIR/services/webgen-control"
cp "$STAGING/services/webgen-control/webgen_control.py" "$STAGING/services/webgen-control/webgen_migrations.py" "$STAGING/services/webgen-control/requirements.txt" "$STAGING/services/webgen-control/webgen-control.service" "$TARGET_DIR/services/webgen-control/"
cp "$STAGING/scripts/sync-managed-skills.py" "$TARGET_DIR/scripts/"
python3 "$TARGET_DIR/scripts/sync-managed-skills.py" \
  "$STAGING/workspace/.agents" "$TARGET_DIR/workspace/.agents" \
  "$TARGET_DIR/config/managed-skills.json" "$TARGET_DIR/config/skill-update-candidates"
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
if [ -e "$LEGACY_WEBGEN_KEY" ]; then die "WebGen master key must not remain in Canvas config"; fi
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
"$WEBGEN_VENV/bin/python" -m py_compile "$TARGET_DIR/services/webgen-control/webgen_migrations.py"
install -d -m 0755 /etc/nginx/dck-apps /var/log/nginx
install -m 0644 "$TARGET_DIR/services/webgen-control/webgen-control.service" /etc/systemd/system/webgen-control.service
printf 'WEBGEN_BIND_HOST=%s\n' "$WEBGEN_GATEWAY" > "$TARGET_DIR/webgen-control.env.tmp"
PG_USER="$(read_env_value POSTGRES_USER)"
[[ "$PG_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]] || die "invalid POSTGRES_USER"
printf 'WEBGEN_POSTGRES_USER=%s\n' "$PG_USER" >> "$TARGET_DIR/webgen-control.env.tmp"
PG_CONTAINER="$(awk '$0 == "  postgres:" { in_pg=1; next } in_pg && $0 ~ /^  [^ ]/ { exit } in_pg && $1 == "container_name:" { print $2; exit }' "$TARGET_DIR/docker-compose.yml")"
[[ "$PG_CONTAINER" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$ ]] || die "cannot determine the Postgres container name from docker-compose.yml"
printf 'WEBGEN_POSTGRES_CONTAINER=%s\n' "$PG_CONTAINER" >> "$TARGET_DIR/webgen-control.env.tmp"
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
[ -f "$WEBGEN_KEY" ] && [ ! -L "$WEBGEN_KEY" ] || die "WebGen master key was not created securely"
[ "$(stat -c '%a:%u' "$WEBGEN_KEY")" = "600:0" ] || die "WebGen master key permissions are not root-only"

cd "$TARGET_DIR"

log "pull + up..."
docker compose pull canvas
docker compose up -d

# Canvas reaches the host through the dck bridge, which an active UFW input
# policy otherwise blocks even when the host-side health check succeeds.
if command -v ufw >/dev/null 2>&1 && LC_ALL=C ufw status | grep -q '^Status: active'; then
  DCK_NETWORK_ID="$(docker network inspect dck --format '{{.Id}}')"
  DCK_BRIDGE="$(docker network inspect dck --format '{{with index .Options "com.docker.network.bridge.name"}}{{.}}{{end}}')"
  DCK_SUBNET="$(docker network inspect dck --format '{{range .IPAM.Config}}{{println .Subnet}}{{end}}' | awk '/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\/[0-9]+$/ { print; exit }')"
  [[ "$DCK_NETWORK_ID" =~ ^[a-f0-9]{12,64}$ ]] || die "invalid dck network ID"
  DCK_BRIDGE="${DCK_BRIDGE:-br-${DCK_NETWORK_ID:0:12}}"
  [[ "$DCK_BRIDGE" =~ ^[a-zA-Z0-9_.:-]{1,15}$ ]] || die "invalid dck bridge interface"
  [[ "$DCK_SUBNET" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]] || die "cannot determine dck IPv4 subnet"
  ufw allow in on "$DCK_BRIDGE" from "$DCK_SUBNET" to "$WEBGEN_GATEWAY" port 8769 proto tcp comment 'DCK Canvas to WebGen control'
fi

code=000
ok=0
webgen_ok=0
for _ in $(seq 1 40); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8010/alive 2>/dev/null || echo 000)"
  case "$code" in
    200|302)
      if docker compose exec -T canvas python -c 'import urllib.request; r = urllib.request.urlopen("http://webgen-control.internal:8769/healthz", timeout=5); raise SystemExit(0 if r.status == 200 else 1)' >/dev/null 2>&1; then
        webgen_ok=1
        ok=1
        break
      fi
      ;;
  esac
  sleep 3
done

if [ "$ok" != "1" ]; then
  log "HEALTH CHECK FAILED (canvas=$code, container-to-WebGen=$webgen_ok) — rolling back to $PREV_TAG"
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
