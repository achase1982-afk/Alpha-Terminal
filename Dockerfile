FROM node:22-alpine
RUN npm install -g pnpm@10.26.1
WORKDIR /app/artifacts/api-server
COPY . /app
RUN cd /app && pnpm install --frozen-lockfile && pnpm --filter @workspace/api-server run build
CMD ["node", "--enable-source-maps", "--max-http-header-size=65536", "dist/index.mjs"]
