#!/bin/sh
set -e

# Resolve API_BACKEND at container startup so envsubst always receives a
# fully-formed URL — no Railway reference syntax like ${{service.VAR}}.
#
# Priority:
#   1. API_BACKEND is already set (Railway resolved it before container start,
#      or the user set it explicitly as a plain URL).
#   2. Construct it from API_SERVER_HOST + API_SERVER_PORT, falling back to
#      the Railway internal hostname and port 8080.

if [ -z "${API_BACKEND}" ]; then
    _host="${API_SERVER_HOST:-api-server.railway.internal}"
    _port="${API_SERVER_PORT:-8080}"
    API_BACKEND="http://${_host}:${_port}"
    echo "[entrypoint] API_BACKEND not set — constructed from host/port: ${API_BACKEND}"
else
    echo "[entrypoint] Using API_BACKEND from environment: ${API_BACKEND}"
fi

export API_BACKEND

# Render the nginx config template with the resolved value.
envsubst '${API_BACKEND}' \
    < /etc/nginx/templates/default.conf.template \
    > /etc/nginx/conf.d/default.conf

echo "[entrypoint] nginx config written — starting nginx"
exec nginx -g "daemon off;"
