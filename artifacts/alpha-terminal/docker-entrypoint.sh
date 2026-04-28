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

_api_backend_source="environment"
_used_default_port="false"

if [ -z "${API_BACKEND:-}" ]; then
    _api_backend_source="constructed from API_SERVER_HOST/API_SERVER_PORT"
    _host="${API_SERVER_HOST:-api-server.railway.internal}"
    if [ -z "${API_SERVER_PORT:-}" ]; then
        _port="8080"
        _used_default_port="true"
    else
        _port="${API_SERVER_PORT}"
    fi
    API_BACKEND="http://${_host}:${_port}"
else
    _host_port="${API_BACKEND#*://}"
    _host_port="${_host_port%%/*}"
    _host="${_host_port%%:*}"
    _port="${_host_port##*:}"
    if [ "${_host}" = "${_port}" ]; then
        _port=""
    fi
fi

if [ "${_used_default_port}" = "true" ]; then
    echo "[entrypoint] WARNING: API_BACKEND and API_SERVER_PORT are unset. Falling back to ${API_BACKEND}."
    echo "[entrypoint] WARNING: On Railway, set API_BACKEND to the backend internal URL with its Railway service-reference PORT, or set API_SERVER_PORT to that reference."
else
    echo "[entrypoint] API_BACKEND ${_api_backend_source}: ${API_BACKEND}"
fi

if [ -n "${_host:-}" ] && [ -n "${_port:-}" ]; then
    if nc -z -w 2 "${_host}" "${_port}"; then
        echo "[probe] TCP OK: ${_host}:${_port} is reachable from frontend container"
    else
        echo "[probe] TCP FAIL: ${_host}:${_port} is NOT reachable from frontend container"
    fi
else
    echo "[probe] TCP SKIP: could not parse host and port from API_BACKEND=${API_BACKEND}"
fi

export API_BACKEND

# Render the nginx config template with the resolved value.
envsubst '${API_BACKEND}' \
    < /etc/nginx/templates/default.conf.template \
    > /etc/nginx/conf.d/default.conf

echo "[entrypoint] nginx config written — starting nginx"
exec nginx -g "daemon off;"
