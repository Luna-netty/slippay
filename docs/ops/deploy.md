# Deploy — how SlipPay is actually deployed

> This supersedes `docs/deploy-secrets.md`. The Vercel + GitHub Actions
> description in that older document is inaccurate and does not match how the
> system is deployed today.

Both `app.slippay.cc` and `api.slippay.cc` run on a single VPS, behind nginx,
with the processes managed by PM2. There is no Vercel, no GitHub Actions
pipeline, and no git-on-server hook in the deploy path.

## Topology

- One VPS.
- nginx terminates TLS and routes `app.slippay.cc` and `api.slippay.cc`.
- PM2 supervises the running processes (the API; any background workers).
- The web app is served as static files from the server's `apps/web/dist`.

## Web deploy

The web app is built on the laptop and the build output is copied to the server.

1. Build locally:

   ```sh
   # from apps/web
   npm run build
   ```

   The build is configured for mainnet (`VITE_STELLAR_NETWORK=PUBLIC`). The
   `VITE_*` values are public configuration, not secrets.

2. Rsync the build output to the server:

   ```sh
   rsync -av --delete apps/web/dist/ <user>@<vps>:<path>/apps/web/dist/
   ```

That is the entire web deploy. nginx serves the new `dist/` immediately.

## Contracts deploy

Contracts are compiled to wasm and deployed to the network via the project's
deploy scripts (not through the web or API deploy path).

1. Build the contract to wasm (the Soroban build for the relevant
   `contracts/<name>`).
2. Deploy the wasm with the corresponding script in `scripts/`.

State the network seam when deploying: the subscription/transfer contracts are on
mainnet (`PUBLIC`); smart-wallet and checkout are on testnet; the attestation
gate is proven on testnet and not yet on mainnet.

## API and workers

The API and any background workers (for example the off-chain autocharge
scheduler) run under PM2 on the same VPS. Restart them through PM2 after deploying
new code.

## Why this doc exists

The previous `docs/deploy-secrets.md` describes a Vercel + GitHub Actions flow
that was never the real mechanism. Use this document for deploys. The old one is
kept only for historical reference.
