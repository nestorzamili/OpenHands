#!/usr/bin/env bash
# DCK Agentic — VM-side deploy, invoked by CI over SSH:
#   bash /opt/dck-agentic/dck-deploy.sh <image-tag>
# Sets CANVAS_IMAGE_TAG, pulls + ups, health-checks the ingress, rolls back on
# failure, and prunes only old dck-agentic images (never other services').
set -euo pipefail
cd /opt/dck-agentic

NEW_TAG="${1:?usage: dck-deploy.sh <image-tag>}"
ENV_FILE=".env"
log() { printf '[dck-deploy] %s\n' "$*"; }

IMAGE_REPO="$(grep -E '^CANVAS_IMAGE=' "$ENV_FILE" | cut -d= -f2-)"
PREV_TAG="$(grep -E '^CANVAS_IMAGE_TAG=' "$ENV_FILE" | cut -d= -f2-)"
log "repo=$IMAGE_REPO current=$PREV_TAG new=$NEW_TAG"

sed -i "s|^CANVAS_IMAGE_TAG=.*|CANVAS_IMAGE_TAG=${NEW_TAG}|" "$ENV_FILE"

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
