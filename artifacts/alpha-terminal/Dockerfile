# Build stage — Debian (glibc) so existing lockfile native binaries (rollup,
# lightningcss, @tailwindcss/oxide) work out of the box.
FROM node:22-slim AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@10.26.1

WORKDIR /app
COPY . .

# vite.config.ts requires PORT and BASE_PATH at build time. PORT is only used
# for the dev/preview servers (not for the production static build), so a
# placeholder is fine. BASE_PATH must be "/" for a standalone deploy.
ENV PORT=3000
ENV BASE_PATH=/
ENV NODE_ENV=production

# Clerk publishable key is baked into the bundle at build time via Vite's
# `define` plugin. Railway passes service-level env vars as build args.
ARG CLERK_PUBLISHABLE_KEY=""
ENV CLERK_PUBLISHABLE_KEY=${CLERK_PUBLISHABLE_KEY}

RUN pnpm install --frozen-lockfile \
    && pnpm --filter @workspace/alpha-terminal run build

# Sanity check — fail the build (and therefore the Railway deploy) if Vite
# didn't actually produce a working dist. Without this, an empty dist would
# silently produce an image that serves nginx 404s for every route.
RUN echo "=== build output ===" \
    && ls -la /app/artifacts/alpha-terminal/dist/public \
    && test -s /app/artifacts/alpha-terminal/dist/public/index.html \
    && test -d /app/artifacts/alpha-terminal/dist/public/assets \
    && echo "=== build output OK ==="

# Runtime stage — small nginx image. Native build binaries are not carried
# over, so the runtime libc doesn't matter.
FROM nginx:alpine AS runtime

COPY --from=builder /app/artifacts/alpha-terminal/dist/public /usr/share/nginx/html
COPY artifacts/alpha-terminal/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY artifacts/alpha-terminal/docker-entrypoint.d/10-resolve-api-backend.sh /docker-entrypoint.d/10-resolve-api-backend.sh

# Sanity check at image-build time so a broken COPY (e.g. wrong source path)
# fails the build instead of producing an empty nginx image.
RUN test -s /usr/share/nginx/html/index.html \
    && test -d /usr/share/nginx/html/assets \
    && echo "runtime image populated OK"

EXPOSE 80
