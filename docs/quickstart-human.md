# Quickstart — the human "dollar account" path

This is the task-oriented path for a person who wants to hold and move USDC on
Stellar without running a node, an exchange account, or a seed phrase. SlipPay is
non-custodial: your wallet signs funds directly to the other party. SlipPay never
holds your funds and never has signing authority over them.

Three tasks:

1. [Receive USDC with a QR](#1-receive-usdc-via-a-qr-at-cobrar)
2. [Verify a payment landed](#2-verify-a-payment-at-comprovante)
3. [Pay with biometrics](#3-pay-with-biometrics-at-pay)

## 1. Receive USDC via a QR (at `/cobrar`)

Open `/cobrar` on the web app. It generates a `slippay:pay` QR encoding the
recipient address and (optionally) an amount. Share the QR; the payer scans it
and pays. The funds land in the recipient address directly on chain.

Status seam: the `/cobrar` recipient is currently a throwaway testnet keypair, so
this surface is a working demo of the receive flow, not a productionized merchant
account. The underlying rail (a direct USDC transfer to your address) is real.

## 2. Verify a payment at `/comprovante`

Open `/comprovante/:txhash` to check that a payment actually settled. This reads
the chain directly (Horizon effects and, for subscriptions, the on-chain
subscription state) and judges the payment against the obligation.

There are two paths, and the page labels which one you are on:

- Strong path (`?sub=`): trusts nothing in the URL. It reads the on-chain
  subscription record and compares the settled transfer against it.
- Weak path (`?amount=&to=`): compares against values supplied in the URL, which
  are forgeable. Use this only as a convenience, not as proof.

Prefer the strong path when you need real assurance.

## 3. Pay with biometrics at `/pay`

`/pay` lets you authorize a payment with Face ID / Touch ID instead of a seed
phrase. The flow:

1. A passkey is created on your device (platform authenticator, P-256 / ES256).
2. A smart-wallet account is deployed on chain, bound to that passkey's public
   key.
3. You scan a `slippay:pay` QR. The app builds the on-chain transfer and uses the
   transfer's authorization hash as the WebAuthn challenge.
4. You approve with your biometric. The device signs; a relayer sponsors the gas
   only and submits the transaction.

The relayer pays the network fee but cannot move your funds. Funds move only
because the on-chain account check accepts your passkey signature.

Status seam: the biometric `/pay` flow is real. On Stellar mainnet (`PUBLIC`)
this moves real money. The smart-wallet contract that backs it is currently
deployed on testnet only; the mainnet path uses the live subscription/transfer
contracts.

## Related guides

- Merchant onboarding: [`docs/MERCHANT_ONBOARDING.md`](./MERCHANT_ONBOARDING.md)
- Recurring billing: [`docs/guides/recurring-billing.md`](./guides/recurring-billing.md)
- General quickstart (API + integration): [`docs/quickstart.md`](./quickstart.md)
