# checkout contract

Source: `contracts/checkout/src/lib.rs`.

## Purpose

A single atomic payment that splits on-chain: the merchant receives the net, the
platform receives its fee. The fee recipient and basis points are fixed at deploy
(constructor) and read from storage on every `pay`, so the caller cannot route
around the fee. Either both transfer legs settle or none does. Non-custodial: the
payer authorizes the charge once and both SEP-41 transfers move funds directly;
SlipPay never holds funds.

## Network, address, deploy date

- **Testnet:** `CBO2COBZUTHH4II4JCQRZVO4RKDUIUH4MXZTAWOYVUZIVYI47UIDQCWQ`,
  `fee_bps = 300`, deployed 2026-06-05.
- Proof tx: `e142cd0b…` (paid 10 → merchant +9.7, fee +0.3).
- **Mainnet: pending.** Needs the deployer to fund XLM and a `/pay` wrapper.

The wasm hash is in the source/deploy artifacts under `contracts/checkout/`.

## Entrypoints

### `__constructor(fee_to, fee_bps)`

- Auth: deploy-time, runs once.
- Effect: stores `fee_to` (the fee recipient) and `fee_bps` immutably in instance
  storage. Rejects `BadConfig` if `fee_bps > 10_000`.

### `pay(from, merchant, token, amount) -> fee`

- Auth: `from.require_auth()` — the payer authorizes the whole charge once.
- Effect:
  ```
  fee = amount * fee_bps / 10_000
  net = amount - fee
  transfer(from -> merchant, net)
  transfer(from -> fee_to, fee)   // only if fee > 0
  ```
  Both nested SEP-41 transfers settle atomically (Soroban reverts on any
  failure). `fee_to` and `fee_bps` are read from storage on every call, so the
  merchant cannot route around the fee. Rejects `BadAmount` if `amount <= 0`.
  Emits a `checkout_paid` event with `(merchant, amount, net, fee)`. Returns the
  fee.

### `fee_bps() -> u32` / `fee_to() -> Address`

- Auth: none (read). Return the configured fee basis points and recipient.

## Storage model

Instance storage:

- `DataKey::FeeTo` → `Address` (fee recipient, immutable).
- `DataKey::FeeBps` → `u32` (basis points, immutable, `<= 10_000`).

No per-payment state is stored; each `pay` is stateless beyond reading the fee
config.

## Caps / invariants

- **Canonical Specification:** Implements the fee rules defined in [`docs/fees.md`](../fees.md).
- **Rate Range:** `fee_bps` is fixed at construction and validated `0 <= fee_bps <= 10_000` (basis points, 0% to 100%). Constructor rejects values `> 10_000` with `Error::BadConfig`. No setter exists.
- **Immutable Recipient:** `fee_to` is fixed at construction. No setter exists; the merchant cannot redirect the fee.
- **Rounding Direction:** Truncating integer division (`floor`). Remainder dust from inexact division (`(amount * fee_bps) % 10_000`) is discarded from the fee and retained by the merchant, favouring the merchant by up to 1 base unit (stroop). SlipPay never overcharges.
- **Identity Invariant:** `net + fee == amount` holds identically across all amounts (zero dust lost or created).
- **Zero-Fee / Micro-Payment Behavior:** If `amount * fee_bps < 10_000` (or `fee_bps == 0`), `fee == 0` and `net == amount`. The transfer to `fee_to` is omitted entirely (`if fee > 0`), performing only a single transfer to the merchant.
- **Zero-Net Behavior:** If `fee_bps == 10_000` (100% platform take), `net == 0` and `fee == amount`. The merchant receives a valid 0-amount transfer, and `fee_to` receives the entire amount.
- **Atomicity & Revert Guarantee:** The payer authorizes the charge once via `from.require_auth()`. If either transfer leg fails (e.g., insufficient balance, invalid token), Soroban atomically reverts the entire transaction; funds are never moved partially.
- **Off-Chain Ledger Mapping:** On-chain `amount - fee` directly mirrors the off-chain `orders.usdc_amount - orders.fee_usdc` accounting equation persisted by the API routes.

A note on fee figures: the fee is a configured parameter of the deployed
instance. The API default is 297 bp (2.97%); this testnet checkout contract was
deployed with `fee_bps = 300` (3%). A mainnet checkout deployment should be
constructed with the canonical 297 bp (`DEFAULT_PLATFORM_FEE_BP`) to match the API. See [`contracts/checkout/DEPLOYMENT.md`](../../contracts/checkout/DEPLOYMENT.md).

## Status & honest limitations

- Testnet only. Mainnet deployment is pending (deployer XLM + `/pay` wrapper).
- **No tests yet** for this contract. The behavior above is from source and a
  single proof transaction, not a test suite.
- No third-party audit of this contract.
