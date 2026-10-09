#!/usr/bin/env bash
# Remote-only wrapper. The caller streams the short-lived workflow GITHUB_TOKEN
# on stdin; no registry credential is passed in argv or persisted on the VM.
set -euo pipefail

NEW_TAG="${1:?usage: dck-deploy-remote.sh <image-tag> <image> <ghcr-user> <staging-dir>}"
IMAGE_REPO="${2:?usage: dck-deploy-remote.sh <image-tag> <image> <ghcr-user> <staging-dir>}"
GHCR_USERNAME="${3:?usage: dck-deploy-remote.sh <image-tag> <image> <ghcr-user> <staging-dir>}"
STAGING="${4:?usage: dck-deploy-remote.sh <image-tag> <image> <ghcr-user> <staging-dir>}"
die() { printf '[dck-deploy-remote] ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$NEW_TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || die "invalid image tag"
[[ "$IMAGE_REPO" =~ ^ghcr\.io/[a-z0-9._-]+(/[a-z0-9._-]+)*$ ]] || die "image must be an untagged lowercase GHCR image path"
[[ -d "$STAGING" ]] || die "staging dir $STAGING not found"
[[ -f "$STAGING/scripts/dck-deploy.sh" ]] || die "staged deploy script not found"

GHCR_TOKEN=""
IFS= read -r GHCR_TOKEN || true
[[ -n "$GHCR_TOKEN" ]] || die "missing workflow registry token on stdin"

DOCKER_CONFIG="$(mktemp -d /tmp/dck-ghcr.XXXXXX)"
chmod 700 "$DOCKER_CONFIG"
export DOCKER_CONFIG
cleanup() {
  docker logout ghcr.io >/dev/null 2>&1 || true
  rm -rf -- "$DOCKER_CONFIG"
}
trap cleanup EXIT

printf '%s\n' "$GHCR_TOKEN" | docker login ghcr.io --username "$GHCR_USERNAME" --password-stdin >/dev/null
unset GHCR_TOKEN

if [[ "$EUID" -eq 0 ]]; then
  bash "$STAGING/scripts/dck-deploy.sh" "$NEW_TAG" "$STAGING" "$IMAGE_REPO"
else
  command -v sudo >/dev/null 2>&1 || die "configure root SSH or passwordless sudo for the staged deploy script"
  sudo -n env "DOCKER_CONFIG=$DOCKER_CONFIG" \
    bash "$STAGING/scripts/dck-deploy.sh" "$NEW_TAG" "$STAGING" "$IMAGE_REPO"
fi
