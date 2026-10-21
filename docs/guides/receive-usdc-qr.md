# Receive USDC by QR (`/cobrar`) and verify a payment (`/comprovante`)

Two surfaces, one rail. `/cobrar` produces a QR that asks a payer for USDC.
`/comprovante` reads a settled transaction back from the chain and judges whether
it satisfied an on-chain obligation. Both are no-login, public surfaces.

Source: `apps/web/src/pages/Cobrar.tsx`, `apps/web/src/pages/Comprovante.tsx`,
`apps/web/src/lib/slippayqr.ts`, `apps/web/src/lib/chainVerify.ts`.

## The `slippay:pay` URI scheme

A payment request is encoded as a single URI carried in the QR:

```
slippay:pay?to=<G…|C…>&amount=<stroops>&asset=<USDC|XLM>&label=<optional>
```

- `to` — the recipient (merchant) Stellar address. Either a classic account
  (`G…`) or a contract address (`C…`).
- `amount` — integer **stroops**. Stellar uses a fixed 7-decimal scale, so
  `1 USDC = 10_000_000` stroops and `0.30 USDC = 3_000_000` stroops. The decoder
  rejects anything that is not all digits.
- `asset` — `USDC` or `XLM`. When absent, the payer treats it as the legacy XLM
  default; new charges set `USDC` explicitly.
- `label` — an optional human note shown on the payer's confirm screen.

`encodeRequest()` builds the URI; `decodeRequest()` parses it and validates the
address shape (`^[GC][A-Z2-7]{55}$`) and the integer amount before any payment is
shown.

## `/cobrar` — generate a receive QR

1. The page picks an amount (presets are 0.1 / 0.3 / 0.5 / 1 USDC).
2. It builds a `slippay:pay` URI with `asset = USDC` and renders it as a QR.
3. The payer opens [`/pay`](./biometric-pay.md), scans the QR, sees the amount and
   recipient, and authorizes with their face.

### The demo recipient is a testnet throwaway

Today `/cobrar` does **not** use a real merchant address. On load it generates a
fresh random Stellar keypair with `Keypair.random()` and funds it from the
testnet friendbot, so a testnet payment has somewhere to land. The QR points at
that throwaway testnet account.

This makes `/cobrar` a demo of the receive flow, not a production merchant
endpoint. In production this field would be the merchant's own real receive
address, and the funding step would not exist. Until then, treat `/cobrar` as a
way to see the QR-to-payment loop work end to end on testnet, not as a way to
collect real funds.

## `/comprovante/:txhash` — verify a payment

`/comprovante` answers one question: did this transaction actually pay what was
owed? It reads both sides from the chain and decides. It has two strengths,
selected by what is in the URL.

### Strong path: on-chain obligation

```
/comprovante/<txhash>?sub=<id>&contract=<C…>&net=<public|testnet>
```

Here the page trusts nothing in the URL beyond the identifiers. It reads:

- the **obligation** via a read-only Soroban `get(sub)` simulation on the
  subscription contract, giving `{ merchant, token, amount, status }`
  (`readObligation` in `chainVerify.ts`), and
- the **payment** via the Horizon effects of the transaction, giving
  `{ to, from, amount, asset }` (`readTransfer`, which reads classic and
  Soroban/SAC transfers from the `account_credited` / `*_debited` effect pair).

`judgeObligation()` returns green only if the recorded transfer satisfies the
stored obligation: recipient equals `merchant`, amounts match exactly (compared
as integer stroops), the asset's SAC equals `token`, and the obligation is in a
live state (`Active` or `Paused`). Because the expected amount and recipient come
from the contract, a forged URL cannot turn this green.

### Weak path: URL claim

```
/comprovante/<txhash>?amount=0.30&to=G…&asset=USDC
```

When there is no `?sub=`, the expected amount and recipient come from the URL,
which is forgeable. The page still reads the real transfer from the chain and
confirms the transaction succeeded, but it can only compare against the
URL-stated claim. The verdict is labeled "stated — verify yourself".

### Verdicts

- **green** — the chain attests the transfer satisfies the obligation (strong) or
  matches the URL claim (weak).
- **red** — mismatch. The page shows exactly which field differs (amount,
  recipient, asset, or status), or that the transaction failed.
- **amber** — could not bind. No readable transfer, or no obligation/claim to
  compare against. The page refuses to show a fake green and points to the
  explorer.

### Honest limit, stated in the UI

`/comprovante` proves that **this on-chain obligation was paid**. It does not
prove the recipient address is the right real-world merchant. Mapping an address
to a real-world identity is a separate layer the chain does not provide. The
receipt is not a tax invoice.

## Status and honest limitations

- `/cobrar`'s recipient is a testnet throwaway keypair today. It is a demo
  merchant, not a productionized receive endpoint.
- The strong path depends on the subscription contract. On mainnet the default
  contract is `CBJMQ6ZY…`; `?contract=` overrides it so the same page can verify
  a testnet deployment.
