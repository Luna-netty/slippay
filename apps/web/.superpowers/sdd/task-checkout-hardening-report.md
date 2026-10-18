# checkout-hardening report

**status:** complete
**commit:** 3c0577d on feat/comex-treasury-phase1
**date:** 2026-06-24

## fixes applied

- FIX 1 (WYSIWYS): Stellar path now builds XDR via `buildAtomicTx`, decodes with `decodeTx`, asserts merchant destination + total amount, shows `ConfirmTxModal` before `signTx`/`submitSignedTx` runs; user cancel aborts cleanly; Solana path unchanged via `adapter.payOneTime`.
- FIX 2 (client address validation): `isValidStellarAddress(merchantAddress)` called before buildAtomicTx on Stellar path; throws "endereço do recebedor inválido" on bad address.
- FIX 3 (server address validation): `merchants.ts` POST + PATCH both validate `stellar_address` via `StrKey.isValidEd25519PublicKey`; return 400 `invalid_stellar_address` on failure.
- FIX 4 (postMessage origin): `PARENT_ORIGIN = VITE_CHECKOUT_PARENT_ORIGIN ?? "*"`; wildcard fallback only when env unset, with code comment flagging the risk.

## checks

- tsc: clean (0 errors)
- vite build: ok (26.93s, 471 modules)
- vitest: 50/50 passed (9 test files)
