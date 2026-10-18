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

- `fee_bps` is fixed at construction and validated `<= 10_000`. No setter exists.
- `fee_to` is fixed at construction. No setter exists. The merchant cannot
  redirect the fee.
- `amount > 0` required.
- Atomicity: net-to-merchant and fee-to-platform settle together or not at all.

A note on fee figures: the fee is a configured parameter of the deployed
instance. The API default is 297 bp (2.97%); this testnet checkout contract was
deployed with `fee_bps = 300` (3%). A mainnet checkout deployment should be
constructed with the canonical 297 bp to match the API.

## Status & honest limitations

- Testnet only. Mainnet deployment is pending (deployer XLM + `/pay` wrapper).
- **No tests yet** for this contract. The behavior above is from source and a
  single proof transaction, not a test suite.
- No third-party audit of this contract.
