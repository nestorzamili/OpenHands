#!/usr/bin/env bash
# DCK Agentic — one-command VM first-run bootstrap.
#
# Usage:
#   OWNER=dck-ai VERSION=dck-v1.2.3 bash dck-vm-bootstrap.sh
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/<tag>/scripts/dck-vm-bootstrap.sh | OWNER=... VERSION=... bash
#
# Env: OWNER (required), REPO (default OpenHands), VERSION (default latest
#      release), TARGET_DIR (default /opt/dck-agentic), CANVAS_UID (default
#      10001:10001), POSTGRES_USER/PASSWORD/DB, CANVAS_IMAGE/CANVAS_IMAGE_TAG.
set -euo pipefail

log() { printf '\033[32m[dck-bootstrap]\033[0m %s\n' "$*"; }
err() { printf '\033[31m[dck-bootstrap] ERROR:\033[0m %s\n' "$*" >&2; }
die() { err "$*"; exit 1; }

REPO="${REPO:-OpenHands}"
TARGET_DIR="${TARGET_DIR:-/opt/dck-agentic}"
CANVAS_UID="${CANVAS_UID:-10001:10001}"

[ -n "${OWNER:-}" ] || die "OWNER is required (e.g. OWNER=dck-ai)."
command -v docker >/dev/null 2>&1 || die "docker not found on PATH."
docker compose version >/dev/null 2>&1 || die "docker compose v2 not available."
command -v curl >/dev/null 2>&1 || die "curl not found on PATH."

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "need root or sudo to write $TARGET_DIR."
  SUDO="sudo"
fi

API_BASE="https://api.github.com/repos/${OWNER}/${REPO}"
DL_BASE="https://github.com/${OWNER}/${REPO}/releases"

if [ -z "${VERSION:-}" ]; then
  log "Resolving latest release of ${OWNER}/${REPO}..."
  VERSION="$(curl -fsSL "${API_BASE}/releases/latest" \
    | grep -oE '"tag_name"[[:space:]]*:[[:space:]]*"[^"]+"' \
    | head -1 | sed -E 's/.*"([^"]+)"$/\1/')"
  [ -n "$VERSION" ] || die "Could not resolve latest release tag; set VERSION explicitly."
fi
log "Installing deploy bundle ${VERSION}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BUNDLE="dck-agentic-deploy-${VERSION}.tar.gz"
log "Downloading ${BUNDLE}..."
curl -fsSL -o "$TMP/$BUNDLE" "${DL_BASE}/download/${VERSION}/${BUNDLE}" \
  || die "Failed to download ${BUNDLE} from the ${VERSION} release."

if curl -fsSL -o "$TMP/SHA256SUMS.txt" "${DL_BASE}/download/${VERSION}/SHA256SUMS.txt" 2>/dev/null; then
  log "Verifying checksum..."
  ( cd "$TMP" && grep " ${BUNDLE}\$" SHA256SUMS.txt | sha256sum -c - ) \
    || die "Checksum verification failed for ${BUNDLE}."
else
  err "SHA256SUMS.txt not found in release; skipping checksum verification."
fi

log "Preparing ${TARGET_DIR} ..."
$SUDO mkdir -p "$TARGET_DIR"/{config,workspace,pgdata}
$SUDO tar -xzf "$TMP/$BUNDLE" -C "$TARGET_DIR"

if [ ! -f "$TARGET_DIR/.env" ]; then
  log "Creating $TARGET_DIR/.env from the template..."
  $SUDO cp "$TARGET_DIR/.env.production.sample" "$TARGET_DIR/.env"
  PG_PASS="${POSTGRES_PASSWORD:-$(openssl rand -base64 32 2>/dev/null | tr -d '/+=' | cut -c1-32)}"
  PG_USER="${POSTGRES_USER:-dck}"
  PG_DB="${POSTGRES_DB:-dck_agentic}"
  IMG="${CANVAS_IMAGE:-ghcr.io/${OWNER}/dck-agentic}"
  TAG="${CANVAS_IMAGE_TAG:-${VERSION#dck-v}}"
  $SUDO sed -i \
    -e "s|^CANVAS_IMAGE=.*|CANVAS_IMAGE=${IMG}|" \
    -e "s|^CANVAS_IMAGE_TAG=.*|CANVAS_IMAGE_TAG=${TAG}|" \
    -e "s|^POSTGRES_USER=.*|POSTGRES_USER=${PG_USER}|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PASS}|" \
    -e "s|^POSTGRES_DB=.*|POSTGRES_DB=${PG_DB}|" \
    -e "s|^AUTOMATION_DB_URL=.*|AUTOMATION_DB_URL=postgresql+asyncpg://${PG_USER}:${PG_PASS}@postgres:5432/${PG_DB}|" \
    "$TARGET_DIR/.env"
  $SUDO chmod 600 "$TARGET_DIR/.env"
  log "Wrote .env (image ${IMG}:${TAG}). Review AUTOMATION_BASE_URL before going live."
else
  log ".env already exists — leaving it untouched."
fi

log "Setting bind-mount ownership to ${CANVAS_UID} ..."
$SUDO chown -R "$CANVAS_UID" "$TARGET_DIR/config" "$TARGET_DIR/workspace"

log "Pulling images and starting the stack..."
( cd "$TARGET_DIR" && $SUDO docker compose pull && $SUDO docker compose up -d )

log "Done. Open your site and create the admin at /setup."
log "Logs: (cd $TARGET_DIR && docker compose logs -f)"
