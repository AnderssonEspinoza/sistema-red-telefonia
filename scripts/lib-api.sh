#!/usr/bin/env bash

api_init() {
  ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  cd "$ROOT_DIR"

  set -a
  source .env
  set +a

  API_URL="http://localhost:${BACKEND_PORT}"
  API_TOKEN=""

  if [[ "${AUTH_ENABLED:-true}" != "false" ]]; then
    API_TOKEN="$(
      curl -fsS -X POST "${API_URL}/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"${AUTH_USERNAME}\",\"password\":\"${AUTH_PASSWORD}\"}" |
        node -e 'let input=""; process.stdin.on("data", c => input += c); process.stdin.on("end", () => console.log(JSON.parse(input).token || ""));'
    )"
  fi
}

api_request() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local args=(-fsS -X "$method" "${API_URL}${path}")

  if [[ -n "$API_TOKEN" ]]; then
    args+=(-H "Authorization: Bearer ${API_TOKEN}")
  fi

  if [[ -n "$data" ]]; then
    args+=(-H "Content-Type: application/json" -d "$data")
  fi

  curl "${args[@]}"
}

json_pick() {
  local script="$1"
  node -e "
    let input = '';
    process.stdin.on('data', (chunk) => input += chunk);
    process.stdin.on('end', () => {
      const data = JSON.parse(input);
      ${script}
    });
  "
}
