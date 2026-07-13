#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
DEPLOY_COMPOSE_VERSION="${DEPLOY_COMPOSE_VERSION:-v2.29.7}"
HOME_DIR="${HOME:-/tmp}"

cd "$APP_DIR"

find_compose() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
    return 0
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
    return 0
  fi

  local compose_bin="${DOCKER_CONFIG:-$HOME_DIR/.docker}/cli-plugins/docker-compose"
  if [ -x "$compose_bin" ] && "$compose_bin" version >/dev/null 2>&1; then
    COMPOSE=("$compose_bin")
    return 0
  fi

  return 1
}

install_compose() {
  local os arch compose_arch compose_dir compose_bin url
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$arch" in
    x86_64 | amd64) compose_arch="x86_64" ;;
    aarch64 | arm64) compose_arch="aarch64" ;;
    *)
      echo "Unsupported CPU architecture for automatic Docker Compose install: $arch"
      return 1
      ;;
  esac

  compose_dir="${DOCKER_CONFIG:-$HOME_DIR/.docker}/cli-plugins"
  compose_bin="$compose_dir/docker-compose"
  url="https://github.com/docker/compose/releases/download/${DEPLOY_COMPOSE_VERSION}/docker-compose-${os}-${compose_arch}"

  echo "Docker Compose is not installed. Installing ${DEPLOY_COMPOSE_VERSION} to ${compose_bin}..."
  mkdir -p "$compose_dir"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$compose_bin"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$compose_bin" "$url"
  else
    echo "Cannot install Docker Compose automatically: curl or wget is required."
    return 1
  fi

  chmod +x "$compose_bin"
}

if ! find_compose; then
  install_compose
  find_compose || {
    echo "Docker Compose is not installed and automatic installation failed."
    echo "Install either the Docker Compose plugin ('docker compose') or legacy docker-compose."
    exit 1
  }
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Missing $COMPOSE_FILE in $APP_DIR"
  exit 1
fi

if [ ! -f ".env" ]; then
  echo "Missing .env in $APP_DIR"
  echo "Create it from .env.example and fill production secrets before deploying."
  exit 1
fi

"${COMPOSE[@]}" -f "$COMPOSE_FILE" config --quiet
"${COMPOSE[@]}" -f "$COMPOSE_FILE" build
"${COMPOSE[@]}" -f "$COMPOSE_FILE" up -d --remove-orphans
"${COMPOSE[@]}" -f "$COMPOSE_FILE" ps
docker image prune -f
