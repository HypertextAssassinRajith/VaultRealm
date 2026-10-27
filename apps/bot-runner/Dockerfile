# ── Build stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/bot-runner/package.json ./apps/bot-runner/

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --filter @vaultrealm/bot-runner...

COPY apps/bot-runner ./apps/bot-runner
RUN pnpm --filter @vaultrealm/bot-runner build

# ── Production stage ────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/bot-runner/package.json ./apps/bot-runner/

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --prod --filter @vaultrealm/bot-runner...

COPY --from=build /app/apps/bot-runner/dist ./apps/bot-runner/dist

USER node

CMD ["node", "apps/bot-runner/dist/index.js"]
