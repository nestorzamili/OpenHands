#!/usr/bin/env bash
# DCK Agentic — one-command VM first-run bootstrap.
#
# Downloads the deploy bundle artifact produced by the DCK Docker workflow
# (compose, workspace content, .env template, scripts), lays out
# /opt/dck-agentic, fixes bind-mount ownership, writes .env, and starts the
# stack. The container image comes from GHCR. No GitHub Release is used — the
# bundle is a workflow artifact, so this needs the `gh` CLI authenticated
# (gh auth login) or GH_TOKEN set with repo + actions:read scope.
#
# Usage:
#   OWNER=pribadiintan bash dck-vm-bootstrap.sh
#
# Env: OWNER (required), REPO (default dck-agentic), WORKFLOW (default
#      dck-docker.yml), RUN_ID (optional specific run; default latest success),
#      TARGET_DIR (default /opt/dck-agentic), CANVAS_UID (default 10001:10001),
#      POSTGRES_USER/PASSWORD/DB, CANVAS_IMAGE/CANVAS_IMAGE_TAG.
set -euo pipefail

log() { printf '\033[32m[dck-bootstrap]\033[0m %s\n' "$*"; }
err() { printf '\033[31m[dck-bootstrap] ERROR:\033[0m %s\n' "$*" >&2; }
die() { err "$*"; exit 1; }

REPO="${REPO:-dck-agentic}"
WORKFLOW="${WORKFLOW:-dck-docker.yml}"
TARGET_DIR="${TARGET_DIR:-/opt/dck-agentic}"
CANVAS_UID="${CANVAS_UID:-10001:10001}"

[ -n "${OWNER:-}" ] || die "OWNER is required (e.g. OWNER=dck-ai)."
command -v docker >/dev/null 2>&1 || die "docker not found on PATH."
docker compose version >/dev/null 2>&1 || die "docker compose v2 not available."
command -v gh >/dev/null 2>&1 || die "gh (GitHub CLI) not found; needed to fetch the workflow artifact. Install gh and run 'gh auth login' (or set GH_TOKEN)."

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "need root or sudo to write $TARGET_DIR."
  SUDO="sudo"
fi

SLUG="${OWNER}/${REPO}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Resolve the run to pull the artifact from (latest successful by default).
if [ -z "${RUN_ID:-}" ]; then
  log "Resolving latest successful ${WORKFLOW} run on ${SLUG}..."
  RUN_ID="$(gh run list --repo "$SLUG" --workflow "$WORKFLOW" \
    --status success --limit 1 --json databaseId --jq '.[0].databaseId')"
  [ -n "$RUN_ID" ] || die "No successful ${WORKFLOW} run found; set RUN_ID explicitly."
fi
log "Downloading deploy bundle from run ${RUN_ID}..."
# The artifact name is dck-agentic-deploy-<sha>; match by prefix.
gh run download "$RUN_ID" --repo "$SLUG" --pattern 'dck-agentic-deploy-*' --dir "$TMP" \
  || die "Failed to download the deploy bundle artifact from run ${RUN_ID}."

# gh extracts each artifact into its own subdir named after the artifact
# (dck-agentic-deploy-<sha>); find the tarball and derive the short SHA so the
# image tag defaults to the exact build this bundle came from.
BUNDLE_TGZ="$(find "$TMP" -name 'dck-agentic-deploy.tar.gz' | head -1)"
[ -n "$BUNDLE_TGZ" ] || die "Bundle tarball not found in the downloaded artifact."
ARTIFACT_DIR_NAME="$(basename "$(dirname "$BUNDLE_TGZ")")"
BUNDLE_SHA="${ARTIFACT_DIR_NAME#dck-agentic-deploy-}"
SUMS="$(dirname "$BUNDLE_TGZ")/SHA256SUMS.txt"
if [ -f "$SUMS" ]; then
  log "Verifying checksum..."
  ( cd "$(dirname "$BUNDLE_TGZ")" && sha256sum -c SHA256SUMS.txt ) \
    || die "Checksum verification failed."
else
  err "SHA256SUMS.txt not found in artifact; skipping checksum verification."
fi

log "Preparing ${TARGET_DIR} ..."
$SUDO mkdir -p "$TARGET_DIR"/{config,workspace,pgdata}
$SUDO tar -xzf "$BUNDLE_TGZ" -C "$TARGET_DIR"

if [ ! -f "$TARGET_DIR/.env" ]; then
  log "Creating $TARGET_DIR/.env from the template..."
  $SUDO cp "$TARGET_DIR/.env.production.sample" "$TARGET_DIR/.env"
  PG_PASS="${POSTGRES_PASSWORD:-$(openssl rand -base64 32 2>/dev/null | tr -d '/+=' | cut -c1-32)}"
  PG_USER="${POSTGRES_USER:-dck}"
  PG_DB="${POSTGRES_DB:-dck_agentic}"
  IMG="${CANVAS_IMAGE:-ghcr.io/${OWNER}/dck-agentic}"
  # Default the image tag to this bundle's build (sha-<short>), keeping image
  # and deploy files in lockstep. Override with CANVAS_IMAGE_TAG.
  if [ -n "${CANVAS_IMAGE_TAG:-}" ]; then
    TAG="$CANVAS_IMAGE_TAG"
  elif [ -n "$BUNDLE_SHA" ]; then
    TAG="sha-${BUNDLE_SHA}"
  else
    TAG="latest"
  fi
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
