#!/usr/bin/env bash
set -euo pipefail

# pdf-tool deploy helper.
#
# Rollback path (documented contract): to disable the LLM route, unset
# MINIMAX_API_KEY in .env and redeploy (docker compose up -d --build).
# POST /extract-with-llm then returns 503 "LLM service is not configured"
# while POST /extract keeps working. Alternatively, redeploy the previous
# image. /extract never depends on the LLM route.
#
# deploy.sh generates and stores a random AUTH_TOKEN in the ignored local
# .env only when AUTH_TOKEN is absent; it never prints the token.

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
