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

# Runtime stage — small nginx image. Native build binaries are not carried
# over, so the runtime libc doesn't matter.
FROM nginx:alpine AS runtime

COPY --from=builder /app/artifacts/alpha-terminal/dist/public /usr/share/nginx/html
COPY artifacts/alpha-terminal/nginx.conf.template /etc/nginx/templates/default.conf.template

# Defaults; Railway will override PORT at runtime and you must set API_BACKEND.
ENV PORT=80
ENV API_BACKEND="http://api-server.railway.internal:8080"

EXPOSE 80
