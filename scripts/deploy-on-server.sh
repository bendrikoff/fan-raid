#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

cd "$APP_DIR"

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "Docker Compose is not installed."
  echo "Install either the Docker Compose plugin ('docker compose') or legacy docker-compose."
  exit 1
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
