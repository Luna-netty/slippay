# Contributing to slippay

`slippay` is part of the [slippay-labs](https://github.com/slippay-labs) organisation and is
developed in the open. Contributions of every size are welcome.

## Finding work

Open tasks are published as bounty issues on the issue tracker:

**https://github.com/slippay-labs/slippay/issues**

- Each issue title carries its bounty, for example `[Bounty: $60] Add unit tests for ...`.
- If you are new to the codebase, start with issues labelled `good first issue`.
- Comment on the issue before you begin so it can be assigned to you.

## Local bootstrap

This section takes you from a fresh clone to a green workspace test run. It is
the same path that CI executes (see `.github/workflows/test.yml`), so the
documented flow is the tested flow.

### Prerequisites

Install these before running the bootstrap script. Versions match those pinned in
CI (`.github/workflows/test.yml`); keep them in sync when you bump them.

| Tool            | Version                                                              | Used for                          |
| --------------- | -------------------------------------------------------------------- | --------------------------------- |
| Node.js         | 22                                                                   | Workspace build and tests         |
| pnpm            | 9.12                                                                 | Package manager (corepack enforced) |
| Deno            | 2.x                                                                  | API and listener tests            |
| Rust (cargo)    | Stable toolchain                                                     | Contracts                         |
| z3              | 4.x                                                                  | AXL gate                          |
| Docker + Compose| Current stable                                                       | Supabase (local stack)            |

Node 22, pnpm 9.12 and Deno 2.x are the versions pinned in CI. Rust and z3 are only
needed for the contract and AXL gate tiers.

### One-step setup

Run the bootstrap script from the repository root:

```bash
./scripts/bootstrap.sh
```

The script is non-interactive and performs the same steps as CI:

1. Checks the prerequisite tool versions.
2. Copies the developer env files from their templates (see below).
3. Runs `pnpm install --frozen-lockfile`.
4. Builds `@slippay/shared` first, then the web and listener packages (the
   required build order enforced in `.github/workflows/test.yml`).
5. Starts the Supabase stack (`pnpm supabase:start`) and applies migrations
   (`pnpm supabase:reset`).

To run the steps manually:

```bash
pnpm install --frozen-lockfile
pnpm --filter @slippay/shared build
pnpm --filter @slippay/web build
pnpm --filter @slippay/listener build
pnpm supabase:start
pnpm supabase:reset
```

### Environment files

The repo ships templates, not secrets. Copy each template to its working name and
fill in the values from your own Supabase local stack (`pnpm supabase:status`
prints the local keys) or from the credentials provided to you by the team.

| Template               | Working file             | Purpose                                                           |
| ---------------------- | ------------------------ | ----------------------------------------------------------------- |
| `.env.example`         | `.env`                   | Root workspace variables                                          |
| `.env.docker.example`  | `.env.docker`            | Docker Compose stack variables                                    |
| App-level templates    | App-level `.env.local`   | Per-app variables (web, listener, API, contracts)                 |

`.env.local.ci` is tracked because it exists to serve CI, not development. Do not
edit it for local work; put your own values in the working `.env` files instead.

### Test tiers

Run the tiers in this order. The workspace tier must pass before the rest.

```bash
# Workspace (packages and apps)
pnpm test

# API (Deno)
pnpm api:test

# Listener e-to-e (requires Supabase running)
pnpm --filter @slippay/listener test:e2e

# Contracts (Rust)
cargo test --manifest-path contracts/Cargo.toml

# AXL gate (z3)
pnpm policy-checkout:spike
```

### Tiers that run without network or credentials

- Workspace tests (`pnpm test`) run offline and need no external credentials.
- Contract tests (`cargo test`) run offline once dependencies are fetched.
- AXL gate (`pnpm policy-checkout:spike`) runs offline.

API tests and listener e-to-e tests need the local Supabase stack running (`pnpm
supabase:start`). They do not need external credentials beyond the local Supabase
keys.

## Making the change

1. Fork the repository and branch from the default branch.
2. Keep the change scoped to the issue's acceptance criteria.
3. Run the existing test and lint commands before you commit.

## Opening a pull request

- Reference the issue in the description, for example `Closes #12`.
- One issue per pull request.
- Make sure CI passes before requesting review.

## Reporting a bug

Open an issue with steps to reproduce, the expected result and the actual result.

## Security

Please do **not** report security vulnerabilities via public GitHub issues. See [SECURITY.md](SECURITY.md) for our private disclosure channels, SLAs, and incident response procedures.

## Questions

Ask on the issue thread so the discussion stays alongside the task.