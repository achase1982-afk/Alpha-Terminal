FROM node:22-alpine
RUN npm install -g pnpm@10.26.1
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter api-server build
CMD node artifacts/api-server/dist/index.js
