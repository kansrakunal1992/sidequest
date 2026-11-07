# Build from the repository root:  docker build -f apps/api/Dockerfile .
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --no-frozen-lockfile --filter @sidequest/api...
RUN pnpm --filter @sidequest/api build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/apps/api/dist ./dist
USER node
EXPOSE 8080
# The worker service overrides this with: node dist/worker.cjs
CMD ["node", "dist/server.cjs"]
