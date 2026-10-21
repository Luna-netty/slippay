# Biometric pay (`/pay`)

`/pay` is a payment that a person authorizes with their face or fingerprint, with
no seed phrase, no browser extension, and no wallet-connect step. The whole flow
runs on the device. A relayer pays the network fee but cannot move the user's
money. On-chain, the user's smart-wallet is what authorizes the funds.

This is a real surface. When the relayer is configured with a `PUBLIC` sponsor,
`/pay` settles real money on Stellar mainnet. When configured for testnet, it
moves free testnet funds so the flow can be proven on a device.

Source: `apps/web/src/pages/PayDemo.tsx`, `apps/web/src/lib/passkey.ts`,
`apps/web/src/lib/slippayqr.ts`.

## What the user sees

1. Tap "Create my wallet (Face ID)". A passkey is minted on the device and an
   on-chain wallet is deployed for it.
2. Tap "Pay a charge (QR)" and scan a `slippay:pay` QR.
3. A confirm screen shows the recipient and the amount.
4. Tap to authorize with Face ID / Touch ID. The payment settles and a link to
   the transaction on the block explorer appears.

## What happens under the hood

### 1. Passkey creation (WebAuthn)

`createPasskey()` calls `navigator.credentials.create()` with:

- `pubKeyCredParams: [{ type: "public-key", alg: -7 }]` — ES256, the WebAuthn
  P-256 (secp256r1) curve.
- `authenticatorSelection.authenticatorAttachment: "platform"` — the device's own
  authenticator (Face ID / Touch ID / fingerprint), not a roaming key.
- `userVerification: "required"` — the biometric (or device PIN) must succeed.

The browser returns an attestation. The function reads the public key from the
DER SPKI and keeps the trailing 65 bytes, which is the uncompressed EC point
(`0x04 || X || Y`). It also keeps the credential id. The private key never leaves
the secure element on the device.

Result: a `PasskeyHandle { pubKey (65 bytes), credId }`.

### 2. Smart-wallet deploy via the relayer

The page calls `GET /relayer/info` to learn the sponsor account and the network
(`TESTNET` or `PUBLIC`). It then `POST`s the passkey public key and credential id
to `/relayer/deploy`. The relayer deploys a per-user smart-wallet instance bound
to that passkey and fronts a small initial balance.

The smart-wallet is a Soroban custom account (CAP-46-11 `__check_auth`). Its
authorization logic is what decides whether a transfer is allowed.

Status: the smart-wallet contract is testnet-only today (see
`contracts/smart-wallet/DEPLOYED.md`). The `/pay` page reports whichever network
the relayer is configured for via `/relayer/info`.

### 3. Scanning a `slippay:pay` QR

The QR encodes a payment request in the `slippay:pay` URI scheme (see
[receive-usdc-qr.md](./receive-usdc-qr.md) for the full scheme). `decodeRequest()`
parses `to` (recipient), `amount` (integer stroops, 7-decimal), `asset`
(`USDC` or `XLM`), and an optional `label`. It validates the address shape and
that the amount is an integer before showing the confirm screen.

### 4. The authorization payload is the challenge

This is the part that binds the biometric tap to the exact payment. Rather than
signing a random challenge, the device signs the Soroban authorization preimage
for this specific transfer.

`payViaRelayer()` (in `passkey.ts`) builds a `SorobanAuthorizedInvocation` for
the token's `transfer(from = wallet, to = recipient, amount)`. It wraps that in a
`HashIdPreimage.envelopeTypeSorobanAuthorization` with the network id, a nonce,
and a signature-expiration ledger. It then computes:

```
payload = SHA-256( preimage.toXDR() )
```

That 32-byte `payload` is passed to WebAuthn as the challenge.

### 5. Face / Touch ID assertion

`getAssertion(payload, credId)` calls `navigator.credentials.get()` with
`userVerification: "required"`. The device prompts the biometric and signs.
The assertion returns three blobs the contract needs:

- `authenticatorData`
- `clientDataJSON` (which embeds the base64url-nopad of the challenge)
- `signature` (DER-encoded)

### 6. DER to raw-64, low-S normalized

WebAuthn returns the signature as DER (`SEQUENCE { INTEGER r, INTEGER s }`).
Soroban's `secp256r1_verify` wants a raw 64-byte `r || s`. `derToRaw64()` parses
the two integers, left-pads each to 32 bytes, and normalizes to low-S
(`s > n/2` is replaced by `n - s`, using the secp256r1 group order). The result
is a 64-byte signature the on-chain verifier accepts.

### 7. Build the auth entry and hand it to the relayer

The three assertion blobs are packed into a `("Passkey", { authenticator_data,
client_data_json, signature })` Soroban auth value, attached to a
`SorobanAuthorizationEntry` keyed by the wallet address with the same nonce and
expiration ledger used in the preimage.

The transaction source is the relayer's sponsor account. The page builds,
simulates, and assembles the transaction, then `POST`s the assembled XDR to
`/relayer/submit`. The page never holds the sponsor's key.

### 8. The relayer sponsors gas only

The relayer validates the submitted transaction before signing
(`validateSponsorable`, fail-closed):

- the source must be the sponsor,
- a single operation,
- fee within a cap, and
- either a contract-create whose wasm hash matches the passkey-wallet hash, or a
  SAC transfer whose `from` is a contract address with an amount within the cap.

If it passes, the relayer signs the outer envelope (paying the network fee) and
submits. The relayer cannot redirect funds or change the amount: those are fixed
inside the auth entry the user's face already signed.

### 9. Settlement

The network runs the transfer. The smart-wallet's `__check_auth`:

- reconstructs `SHA-256(authenticator_data || SHA-256(client_data_json))`,
- confirms the challenge inside `client_data_json` matches the Soroban auth
  payload (replay defense), and
- runs `secp256r1_verify` against the passkey public key.

Only if that passes do the funds move. This is the load-bearing point: the
relayer pays gas, but the on-chain `__check_auth` of the user's own wallet is
what authorizes the money. A relayer (or anyone else) cannot move the user's
funds without a fresh biometric assertion over the exact transfer.

## Status and honest limitations

- The smart-wallet contract is testnet-only at present. Mainnet settlement runs
  when the relayer is configured with a `PUBLIC` sponsor; verify the deploy state
  before treating any path as mainnet.
- No third-party audit of the smart-wallet contract. There is a self-run
  adversarial audit harness only.
- `/pay` requires a device with a platform authenticator (Face ID / Touch ID /
  fingerprint) and a modern browser with WebAuthn.
