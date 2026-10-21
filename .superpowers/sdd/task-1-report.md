# Task 1: TX Guard Core Implementation — DONE

## Summary
Created and tested two files: `txguard.ts` (guard logic) and `txguard.test.ts` (5 unit tests). All tests pass. TypeScript verification clean.

## Files Created
1. `/home/galmanus/projects/slippay-comex/apps/web/src/lib/txguard.ts`
   - `decodeTx()` — XDR → TxSummary (extracts source, operations, memo, fee)
   - `localHash()` — re-derives tx hash locally from XDR (proves non-reliance on passed hash)
   - `assertPaymentMatches()` — validates destination, amount, assetCode with 1e-7 tolerance

2. `/home/galmanus/projects/slippay-comex/apps/web/test/txguard.test.ts`
   - 5 unit tests covering happy path and three threat vectors

## Test Results (Final Run)
```
RUN  v2.1.9 /home/galmanus/projects/slippay-comex/apps/web

 ✓ test/txguard.test.ts (5 tests) 26ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  22:52:59
   Duration  963ms (transform 59ms, setup 0ms, collect 324ms, tests 26ms, environment 0ms, prepare 97ms)
```

## TypeScript Check
- Ran `npx tsc --noEmit -p apps/web`
- txguard files: clean
- Pre-existing errors in node_modules/@types/node (version conflicts) — not blocking

## Commit
```
[feat/comex-treasury-phase1 b39c59c] feat(comex): tx guard — decode + local hash + payment assertions (threat #1/#3)
 2 files changed, 95 insertions(+)
 create mode 100644 apps/web/src/lib/txguard.ts
 create mode 100644 apps/web/test/txguard.test.ts
```

## Threat Coverage
- **Threat #1 (Hash substitution):** `localHash()` re-derives from XDR, trusts only SDK recompute
- **Threat #3 (Amount/destination drift):** `assertPaymentMatches()` with 1e-7 float tolerance + explicit destination equality check

---

# Task 2: TX Guard Security Hardening — DONE

## Summary
Hardened `assertPaymentMatches` against three new attack vectors: (1) NaN/non-numeric amounts, (2) missing/optional assetCode, (3) multiple payment operations (hidden second payment).

## Test Results
```
RUN  v2.1.9 /home/galmanus/projects/slippay-comex/apps/web

 ✓ test/txguard.test.ts (7 tests) 31ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
```

## Implementation Changes

### File: `apps/web/src/lib/txguard.ts`
- Made `assetCode` REQUIRED in expect signature: `{ destination: string; amount: string; assetCode: string }`
- Added NaN check: `if (!Number.isFinite(got) || !Number.isFinite(want))`
- Changed from `.find()` to `.filter()` + count: rejects >1 or <1 payment ops
- Error messages in Portuguese (PT-BR) for consistency

### File: `apps/web/test/txguard.test.ts`
- Added `twoPaymentXdr()` generator (hidden-payment attack)
- Added `xlmXdr()` generator (asset-swap attack)
- New test: "throws when more than one payment op is present" (catches multi-op tx)
- New test: "throws on asset mismatch" (XLM→USDC receiver substitution)
- All 7 tests pass; 0 failures

## TypeScript Check
Verified clean: `npx tsc --noEmit apps/web/src/lib/txguard.ts apps/web/test/txguard.test.ts`
(Pre-existing @types/node config errors unrelated to our changes)

## Commit
```
[feat/comex-treasury-phase1 5082c36] fix(comex): harden tx guard — NaN reject, required asset check, single-payment enforcement
 2 files changed, 48 insertions(+), 12 deletions(-)
```

## Threat Coverage (Updated)
- **(NEW) Threat: NaN injection** — caught by `!Number.isFinite()` check
- **(NEW) Threat: Hidden second payment** — caught by `pays.length !== 1` enforcement
- **(NEW) Threat: Weak asset check** — `assetCode` now REQUIRED, always validated
