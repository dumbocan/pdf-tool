#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f .env ]]; then
  touch .env
fi

if [[ -z "${AUTH_TOKEN:-}" ]] && ! grep -q '^AUTH_TOKEN=.' .env; then
  token="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
  printf '\nAUTH_TOKEN=%s\n' "$token" >> .env
fi

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

port="${PORT:-3000}"
for attempt in {1..30}; do
  if curl --fail --silent "http://localhost:${port}/healthz" >/dev/null; then
    exit 0
  fi
  sleep 1
done

printf '%s\n' "pdf-tool health check failed" >&2
exit 1
