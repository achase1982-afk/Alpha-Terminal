FROM node:22-alpine
RUN npm install -g pnpm@10.33.3
WORKDIR /app
COPY . /app
RUN pnpm install --frozen-lockfile
CMD ["pnpm", "--filter", "@workspace/strategist-worker", "run", "start"]
