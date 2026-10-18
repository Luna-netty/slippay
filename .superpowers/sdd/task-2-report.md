# Task 2: Privy Stellar Signer

## Status: DONE

**Commit:** `8c8fc79`

**Test Result:** 3/3 passed (privyWallet.test.ts, vitest)

### Summary
Fixed two correctness bugs: (1) `attachSignature` now rejects fee-bump transactions (throws /fee-bump/ if FeeBumpTransaction detected), (2) hint buffer copied via `Buffer.from(subarray(...))` instead of aliased. Three tests pass: (1) hint matches keypair's native hint, (2) signature verifies against tx hash, (3) fee-bump rejection. TypeScript clean.
