FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/listener/package.json ./apps/listener/
# --ignore-scripts: skip native postinstall (e.g. usb/hid modules pulled
# transitively by some deps but never used at runtime).
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY apps/listener ./apps/listener
RUN pnpm --filter @slippay/shared build && pnpm --filter @slippay/listener build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/apps/listener/dist ./apps/listener/dist
COPY --from=builder /app/apps/listener/package.json ./apps/listener/
WORKDIR /app/apps/listener
USER node
CMD ["node", "dist/main.js"]
