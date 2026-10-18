## pixpay WYSIWYS gate — 2026-06-24

status: DONE — commit 770b567
gate wiring: inline decode-before-signTx (not signHash); StellarWalletsKit only exposes signTransaction(xdr), so signHash path not used. Flow: isValidStellarAddress(receiver) → amount assert vs quote → buildUsdcPaymentTx → decodeTx(xdr) → assertPaymentMatches → ConfirmTxModal (user explicit confirm) → signTx(xdr) → submitSignedTx.
txguard.ts: added isValidStellarAddress(addr) using StrKey.isValidEd25519PublicKey.
tsc: 0 errors | vitest: 50/50 pass | vite build: success (chunk-size warning only, no errors).
