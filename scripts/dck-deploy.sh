#!/usr/bin/env bash
# DCK Agentic — VM-side deploy, invoked by CI over SSH:
#   bash <staging-dir>/scripts/dck-deploy.sh <image-tag> <staging-dir>
#
# Self-contained and idempotent: first run (no .env) bootstraps the release
# dir and generates .env; later runs refresh deploy files and roll the image.
# Never clones the repo; CI scp's the deploy files to <staging-dir> first.
set -euo pipefail

NEW_TAG="${1:?usage: dck-deploy.sh <image-tag> <staging-dir>}"
STAGING="${2:?usage: dck-deploy.sh <image-tag> <staging-dir>}"
TARGET_DIR="${TARGET_DIR:-/opt/dck-agentic}"
CANVAS_UID="${CANVAS_UID:-10001:10001}"
log() { printf '[dck-deploy] %s\n' "$*"; }
die() { printf '[dck-deploy] ERROR: %s\n' "$*" >&2; exit 1; }

[ -d "$STAGING" ] || die "staging dir $STAGING not found"
command -v docker >/dev/null 2>&1 || die "docker not found"
docker compose version >/dev/null 2>&1 || die "docker compose v2 not available"

mkdir -p "$TARGET_DIR"/{config,workspace,pgdata}

# Refresh deploy files from staging — compose, scripts, skills, env template.
# Never touch .env, config/, pgdata/, or agent-authored workspace/<project>.
cp "$STAGING/docker-compose.yml"     "$TARGET_DIR/"
cp "$STAGING/.env.production.sample" "$TARGET_DIR/"
mkdir -p "$TARGET_DIR/scripts"
cp "$STAGING/scripts/"*.sh           "$TARGET_DIR/scripts/"
chmod +x "$TARGET_DIR/scripts/"*.sh
rm -rf "$TARGET_DIR/workspace/.agents"
cp -r "$STAGING/workspace/.agents"   "$TARGET_DIR/workspace/.agents"
cp "$STAGING/workspace/AGENTS.md"    "$TARGET_DIR/workspace/AGENTS.md"

ENV_FILE="$TARGET_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  log "first run — generating $ENV_FILE"
  cp "$TARGET_DIR/.env.production.sample" "$ENV_FILE"
  PG_PASS="$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)"
  IMG="${CANVAS_IMAGE:-ghcr.io/${IMAGE_OWNER:?set IMAGE_OWNER or CANVAS_IMAGE}/dck-agentic}"
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
  PREV_TAG="$(grep -E '^CANVAS_IMAGE_TAG=' "$ENV_FILE" | cut -d= -f2-)"
  log "existing deploy — current=$PREV_TAG new=$NEW_TAG"
  sed -i "s|^CANVAS_IMAGE_TAG=.*|CANVAS_IMAGE_TAG=${NEW_TAG}|" "$ENV_FILE"
fi

chown -R "$CANVAS_UID" "$TARGET_DIR/config" "$TARGET_DIR/workspace"

cd "$TARGET_DIR"
IMAGE_REPO="$(grep -E '^CANVAS_IMAGE=' "$ENV_FILE" | cut -d= -f2-)"

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
  sed -i "s|^CANVAS_IMAGE_TAG=.*|CANVAS_IMAGE_TAG=${PREV_TAG}|" "$ENV_FILE"
  docker compose up -d
  exit 1
fi
log "deploy OK: $NEW_TAG"

log "pruning old $IMAGE_REPO images..."
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' \
  | awk -v repo="$IMAGE_REPO" -v keep="${IMAGE_REPO}:${NEW_TAG}" \
      '$1 ~ "^"repo":" && $1 != keep {print $2}' \
  | sort -u | xargs -r docker rmi 2>/dev/null || true
log "done."
