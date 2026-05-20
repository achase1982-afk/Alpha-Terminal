#!/bin/sh
set -e

# Resolve API_BACKEND at container startup so envsubst always receives a
# fully-formed URL — no Railway reference syntax like ${{service.VAR}}.
#
# Priority:
#   1. API_BACKEND is already set (Railway resolved it before container start).
#   2. API_SERVER_URL (full base URL, no trailing slash).
#   3. API_SERVER_HOST + API_SERVER_PORT, falling back to *.railway.internal:8080.
#
# On Railway, the backend listens on whatever port Railway hands it via PORT
# (typically a random 5xxx port). The frontend container has no way to know
# that port unless it's passed in explicitly via API_BACKEND or
# API_SERVER_PORT — preferably as a Railway service reference resolved at
# deploy time. Falling back to 8080 will silently break /api/* in production
# because nothing is listening on that port. We therefore print a *loud*
# warning so the failure mode is obvious in the deploy logs.

DEFAULT_PORT="8080"
USED_DEFAULT_PORT="0"

if [ -n "${API_BACKEND}" ]; then
    echo "[entrypoint] API_BACKEND already set: ${API_BACKEND}"
elif [ -n "${API_SERVER_URL}" ]; then
    API_BACKEND="${API_SERVER_URL}"
    echo "[entrypoint] API_BACKEND from API_SERVER_URL: ${API_BACKEND}"
else
    _host="${API_SERVER_HOST:-api-server.railway.internal}"
    if [ -z "${API_SERVER_PORT}" ]; then
        _port="${DEFAULT_PORT}"
        USED_DEFAULT_PORT="1"
    else
        _port="${API_SERVER_PORT}"
    fi
    API_BACKEND="http://${_host}:${_port}"
    echo "[entrypoint] API_BACKEND not set — constructed from host/port: ${API_BACKEND}"
fi

export API_BACKEND

# Nginx resolves a static proxy_pass hostname once at startup. Railway private
# service IPs can change across backend redeploys, so pass nginx the container
# resolver and use a variable proxy_pass in nginx.conf.template.
DNS_RESOLVER_RAW="$(awk '/^nameserver / { print $2; exit }' /etc/resolv.conf)"
if [ -z "${DNS_RESOLVER_RAW}" ]; then
    DNS_RESOLVER_RAW="127.0.0.11"
fi

case "${DNS_RESOLVER_RAW}" in
    *:*) DNS_RESOLVER="[${DNS_RESOLVER_RAW}]" ;;
    *)   DNS_RESOLVER="${DNS_RESOLVER_RAW}" ;;
esac

export DNS_RESOLVER
echo "[entrypoint] Using DNS resolver for API proxy: ${DNS_RESOLVER}"

# Extract host and port from the resolved API_BACKEND so we can probe it.
# API_BACKEND is expected to be of the form http://host[:port][/path].
_probe_target="${API_BACKEND#*://}"
_probe_target="${_probe_target%%/*}"
_probe_host="${_probe_target%%:*}"
case "${_probe_target}" in
    *:*) _probe_port="${_probe_target##*:}" ;;
    *)   _probe_port="80" ;;
esac

if [ "${USED_DEFAULT_PORT}" = "1" ]; then
    cat >&2 <<'WARN'
================================================================================
[entrypoint] WARNING: falling back to default API backend port 8080.

  Railway assigns the backend service a *random* PORT at deploy time
  (typically 5xxx), so 8080 is almost certainly wrong. Every /api/* request
  from the frontend will hang or 502 because nothing is listening on 8080.

  Fix (alpha-terminal → Variables, use your backend service name from the canvas):

    API_SERVER_PORT=${{<backend-service>.PORT}}
    — or —
    API_BACKEND=http://${{<backend-service>.RAILWAY_PRIVATE_DOMAIN}}:${{<backend-service>.PORT}}
    — or (public URL, no port needed) —
    API_BACKEND=https://${{<backend-service>.RAILWAY_PUBLIC_DOMAIN}}

  Easiest alternative: on the BACKEND service only, set PORT=8080 and redeploy
  both services (frontend defaults to port 8080 on *.railway.internal).
================================================================================
WARN
fi

# Non-blocking TCP probe — bounded by a short timeout so a slow / unreachable
# backend can never delay nginx startup. Failures here are diagnostic, not
# fatal: nginx still starts, and the probe output above tells the operator
# whether the resolved API_BACKEND is actually reachable from this container.
echo "[probe] testing TCP connectivity to ${_probe_host}:${_probe_port} ..."
probe_result=""
if command -v nc >/dev/null 2>&1; then
    if nc -z -w 2 "${_probe_host}" "${_probe_port}" >/dev/null 2>&1; then
        probe_result="ok"
    else
        probe_result="fail"
    fi
elif command -v wget >/dev/null 2>&1; then
    # wget is present in nginx:alpine via BusyBox; --spider does a connect-only
    # check. We don't care about the HTTP response, only whether the TCP
    # handshake succeeded.
    if wget --spider --timeout=2 --tries=1 -q "http://${_probe_host}:${_probe_port}/" 2>/dev/null; then
        probe_result="ok"
    else
        # wget exits non-zero on any HTTP error too; distinguish "connection
        # refused / timed out" from "got an HTTP response" by checking whether
        # the host is at least DNS-resolvable. If it is, treat the probe as
        # inconclusive rather than a hard fail.
        if getent hosts "${_probe_host}" >/dev/null 2>&1; then
            probe_result="inconclusive"
        else
            probe_result="fail"
        fi
    fi
else
    probe_result="skipped"
fi

# When still on the default 8080 guess, try a short /api/healthz sweep before nginx starts.
if [ "${probe_result}" = "fail" ] && [ "${USED_DEFAULT_PORT}" = "1" ]; then
    echo "[probe] default port unreachable — scanning common backend ports for /api/healthz ..."
    for try_port in ${API_PORT_FALLBACK_LIST:-8080 3000 5000 8000 8081}; do
        if wget -q -O /dev/null --timeout=2 --tries=1 \
            "http://${_probe_host}:${try_port}/api/healthz" 2>/dev/null; then
            API_BACKEND="http://${_probe_host}:${try_port}"
            _probe_port="${try_port}"
            USED_DEFAULT_PORT="0"
            probe_result="ok"
            echo "[probe] discovered backend at ${API_BACKEND} (GET /api/healthz)"
            break
        fi
    done
fi

case "${probe_result}" in
    ok)
        echo "[probe] TCP OK: ${_probe_host}:${_probe_port} is reachable from frontend container"
        ;;
    fail)
        echo "[probe] TCP FAIL: ${_probe_host}:${_probe_port} is NOT reachable from frontend container"
        echo "[probe] /api/* requests will hang, 502, or show empty UI until API_BACKEND is correct"
        ;;
    inconclusive)
        echo "[probe] TCP INCONCLUSIVE: ${_probe_host} resolved but TCP check via wget could not confirm connectivity"
        ;;
    skipped)
        echo "[probe] SKIPPED: neither nc nor wget is available in this image"
        ;;
esac

# Render the nginx config template with the resolved value.
envsubst '${API_BACKEND} ${DNS_RESOLVER}' \
    < /etc/nginx/templates/default.conf.template \
    > /etc/nginx/conf.d/default.conf

echo "[entrypoint] nginx config written — starting nginx"
exec nginx -g "daemon off;"
