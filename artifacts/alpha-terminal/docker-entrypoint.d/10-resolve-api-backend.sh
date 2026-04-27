#!/bin/sh
set -eu

if [ -z "${API_BACKEND:-}" ]; then
  if [ -n "${API_SERVER_URL:-}" ]; then
    API_BACKEND="${API_SERVER_URL}"
  else
    API_PORT="${API_SERVER_PORT:-8080}"
    API_HOST="${API_SERVER_HOST:-api-server.railway.internal}"
    API_BACKEND="http://${API_HOST}:${API_PORT}"
  fi
fi

export API_BACKEND