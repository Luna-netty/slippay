# Multi-stage build: pnpm install + Vite build → nginx serve static
FROM node:22-alpine AS builder

# Vite build args — these get inlined into the JS bundle at build time
ARG VITE_SUPABASE_URL=http://localhost:54321
ARG VITE_SUPABASE_ANON_KEY=
ARG VITE_API_BASE=http://localhost:54321/functions/v1/api
ARG VITE_STELLAR_NETWORK=TESTNET
ARG VITE_PLATFORM_ADDRESS=
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_API_BASE=$VITE_API_BASE \
    VITE_STELLAR_NETWORK=$VITE_STELLAR_NETWORK \
    VITE_PLATFORM_ADDRESS=$VITE_PLATFORM_ADDRESS

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
# --ignore-scripts: skip native postinstall (e.g. usb/hid modules pulled
# transitively by some wallet-kit deps but never used in the browser bundle).
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN pnpm --filter @slippay/shared build && pnpm --filter @slippay/web build

# ---- runtime: nginx serving the static SPA bundle
FROM nginx:1.27-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
