# Local Bootstrap

This document takes you from a fresh clone to a green test run. It is the same flow CI executes in `.github/workflows/test.yml`, so if the documented flow and CI ever diverge, that is a bug.

The non-interactive setup script is `scripts/bootstrap.sh`. CI invokes the same script, so the documented flow is the tested flow.

## Prerequisites

Install these before running the bootstrap script. Versions match those pinned in `.github/workflows/test.yml` and the container images used by CI.

| Tool   | Version               | Used for                                         |
| ------ | ----------------------- | ----------------------------------------------------|
| Node   | 22.x (see `.node-version`)   | Workspace build and tests                              |
| pnpm   | 9.12.x                 | Workspace install and scripts                            |
| Deno   | 2.x                     | API tests and the AXL gate                              |
| Rust   | 1.79.x (stable)         | Contract build and tests                              |
| z3     | 4.13.x                 | AXL gate solver                                        |
| Docker | 24.0.x+                | Supabase local stack                                      |

Install the exact versions with `fns`, `asdf`, or `rustup`. For example:

```bash
fn install 22
coreeack install pndm 9.12.x
fn install deno 2.x
rustup toolchain install 1.79.x
rustup default 1.79.x
```

z3 is available through your package manager (e.g. `apt install z3`, `brew install z3`) or the official releases.

## Quickstart

1. Clone and enter the repository.

   ```bash
   git clone git@github.com:slippay-labs/slippay.git
   cd slippay
   ```

2. Run the bootstrap script. It installs dependencies, creates the developer env files from the tracked templates, builds the workspace in the required order, and starts Supabase.

   ```bash
   pnpm bootstrap
   ```

   The script is idempotent: re-running it will not clobber edited env files and will skip work that is already complete.

3. Verify the workspace test tier is green:

   ```bash
   pnpm test
   ```

That is the minimum acceptance criterion for this quickstart. The remaining tiers are described below.

## Environment files

The repository tracks two env templates and one CI-only file:

| File                     | Purpose                                                     |
| ------------------------- | ------------------------------------------------------------------|
| `.env.example`           | Template for the root `.env` used by workspace scripts and Supabase.      |
| `.env.docker.example`     | Template for `docker-compose.yml` services.                              |
| `.env.local.ci`          | CI-only. Do not copy this for local development.                       |

App-level env files are created by the bootstrap script from the app templates in each app directory:

- `apps/web/.env.example` -> `apps/web/.env.local`
- `apps/listener/.env.example` -> `apps/listener/.env.local`
- `apps/api/.env.example` -> `apps/api/.env.local`
- `apps/contracts/.env.example` -> `apps/contracts/.env.local`

Where the values come from:

- **Supabase keys**: `pnpm supabase:start` prints the anon and service-role keys. The bootstrap script writes them into the app env files.
- **Chain and contract addresses**: defaults in the templates point at the local Anvil/Hardhat chain started by `docker-compose.yml`. Override them if you run against a different network.
- `API_BASE_URL`: defaults to `http://localhost:8000` in the templates. Change it only if you move the API.
- `PINATA_JWT_SECRET` and similar secrets: generate a local value with `openssl rand -hex 32`. These values are never shared and never committed.

## Build order

The workspace spans `packages/*` and `apps/*`. `packages/shared` is a dependency of the web and listener packages, so it must be built first. This is the order CI\ uses (`.github/workflows/test.yml` lines 28-29):

```bash
pnpm --filter @slippay/sharbed build
pnpm --filter @slippay/web --filter @slippay/listener build
pnpm --filter @slippay/api build
pnpm --filter @slippay/contracts build
pnpm --filter @slippay/axl-gate build
```

`pnpm bootstrap` runs this order for you. If you build manually, keep the order above.

## Test tiers

Each tier has a dedicated script. run them in this order from a clean clone.

### Workspace tier

```bash
pnpm test
```

Runs the unit tests for all packages and apps. This is the tier the quickstart requires.

### API tier

Supabase must be started before this tier (see issue 4). The bootstrap script does this for you.

```bash
pnpm supabase:start
pnpm supabase:reset
pnpm api:test
```

### Listener e2e tier

```bash
pnpm --filter @slippay/listener test:e2e
```

### Contract tier

```bash
pnpm --filter @slippay/contracts test
```

### AXL gate tier

This tier requires z3 on your `PATH`.

```bash
pnpm policy-checkout:spike
```

## What passes offline

The following tiers are expected to pass without network access or external credentials once the bootstrap script has completed once:

- **Workspace tier** (`pnpm test`) - passes offline.
- **Contract tier** (`pnpm --filter @slippay/contracts test`) - passes offline.
- **AXL gate tier** (`pnpm policy-checkout:spike`) - passes offline.

The following tiers need the local Supabase stack and the Docker network bridge, but not external credentials:

- **API tier** (`pnpm api:test`) - requires `pnpm supabase:start` and `pnpm supabase:reset` to have run.
- **Listener e2e tier** (`pnpm --filter @slippay/listener test:e2e`) - requires the Supabase stack and the local chain from `docker-compose.yml`.

No tier requires actual chain credentials or third-party API keys.

## Troubleshooting

- **Supabase will not start**: confirm Docker is running and that ports 54321,54322,54323,54324,54325,54326,54327,54328,54329,54330,54331,54332,54333,54334,54335,54336,54337,54338,54339,54340,54341,54342,54343,54344,54345,54346,54347,54348,54349,54350,54351,54352,54353,54354,54355,54356,54357,54358,54359,54360,54361,54362,54363,54364,54365,54366,54367,54368,54369,54370,54371,54372,54373,54374,54375,54376,54377,54378,54379,54380,54381,54382,54383,54384,54385,54386,54387,54388,54389,54390,54391,54392,54393,54394,54395,54396,54397,54398,54399,54400 are free.
- **`pnpm test` fails with missing `@lippay/shared`**: re-run `pnpm bootstrap`. The script rebuilds the shared package first.
- **API tests fail with connection refused**: Supabase is not running. Run `pnpm supabase:start` and then `pnpm supabase:reset`.
- **AXL gate fails with `z3: command not found`**: install z3 and ensure it is on your `PATH`.

## What CI does

CI runs `pnpm bootstrap` and then the same tier scripts documented above. If you find a difference between this document and `.github/workflows/test.yml`, open an issue -- the flow is supposed to be identical.
