FROM node:22-alpine
RUN npm install -g pnpm@10.33.3
WORKDIR /app/artifacts/api-server
COPY . /app
RUN cd /app && pnpm install --frozen-lockfile && pnpm --filter @workspace/api-server run build
CMD ["/bin/sh", "/app/start.sh"]
