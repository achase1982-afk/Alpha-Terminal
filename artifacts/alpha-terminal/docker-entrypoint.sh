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

# Nginx only re-resolves variable proxy_pass targets when a resolver is
# configured. Use the container resolver so Railway private DNS can follow
# backend redeploys instead of pinning a stale internal IP.
DNS_RESOLVER="$(awk '/^nameserver / { print $2; exit }' /etc/resolv.conf)"
if [ -z "${DNS_RESOLVER}" ]; then
    DNS_RESOLVER="127.0.0.11"
fi
export DNS_RESOLVER

# Render the nginx config template with the resolved value.
envsubst '${API_BACKEND} ${DNS_RESOLVER}' \
    < /etc/nginx/templates/default.conf.template \
    > /etc/nginx/conf.d/default.conf

echo "[entrypoint] nginx config written — starting nginx"
exec nginx -g "daemon off;"
