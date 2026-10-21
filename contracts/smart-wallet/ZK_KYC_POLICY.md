# ZK-KYC policy gate (design + patch proposal)

The highest-leverage move from the Stellar-recognition research: a payment only
authorizes if a **zero-knowledge proof of KYC verified on-chain**. This is the
"higher-level application logic on top of the X-Ray BN254 primitives" the SDF docs
explicitly say is missing. It binds confidential compliance to the auth layer
itself, not a separate pool.

This is a **proposal**, not a merged change. `__check_auth` is the security core
(a bug here drains funds), so it must be compiled + the security tests must pass +
a third-party audit before it ships. Written for reviewer legibility.

## The shape

1. **Extend `Policy`** with an optional KYC requirement:
   ```rust
   pub struct Policy {
       // ...existing fields...
       /// If non-zero, this policy only authorizes a pull when a fresh proof-of-KYC
       /// for `kyc_root` has been verified on-chain (see `record_kyc_attestation`).
       pub kyc_root: BytesN<32>,   // 32 zero bytes = no KYC gate (back-compat)
   }
   ```

2. **A verified-attestation store**, written only by the generic mainnet verifier
   path (CBDS2YSL) via a cross-contract call, keyed by (wallet, kyc_root):
   ```rust
   #[contracttype]
   pub enum DataKey {
       // ...existing...
       KycOk(BytesN<32>),          // kyc_root -> ledger timestamp it was verified
   }

   /// Called after the ZK proof-of-KYC verifies on the generic verifier. Records
   /// that `kyc_root` is satisfied for this wallet, with a freshness timestamp.
   /// The verify itself happens on the live mainnet verifier; this only records
   /// the verified verdict so __check_auth can read it cheaply (no re-verify per tx).
   pub fn record_kyc_attestation(env: Env, kyc_root: BytesN<32>, verified_at: u64) {
       // auth: the wallet admin (passkey) OR the trusted attester signer.
       // store DataKey::KycOk(kyc_root) = verified_at with a TTL.
   }
   ```

3. **Gate the pull path.** In `try_match_policy`, when `policy.kyc_root != zero`,
   require a fresh `KycOk(policy.kyc_root)` (within a max-age window) or reject:
   ```rust
   if policy.kyc_root != BytesN::from_array(&env, &[0u8; 32]) {
       let ok_at: u64 = env.storage().persistent()
           .get(&DataKey::KycOk(policy.kyc_root.clone()))
           .ok_or(Error::KycRequired)?;
       if env.ledger().timestamp().saturating_sub(ok_at) > KYC_MAX_AGE_SECS {
           return Err(Error::KycStale);
       }
   }
   ```

## Why a recorded verdict, not a per-tx re-verify

Re-running Groth16 verification inside every `__check_auth` is expensive and the
proof is large. The pattern: verify the proof ONCE on the generic mainnet verifier
(CBDS2YSL), record the boolean verdict + timestamp here, and let the hot auth path
read a cheap flag with a freshness window. Same selective-disclosure property
(no PII on-chain), one expensive verify amortized across the policy's lifetime.

## Errors to add

```rust
KycRequired = N,   // policy gated on KYC but no verified attestation exists
KycStale    = N+1, // attestation older than KYC_MAX_AGE_SECS
```

## Test plan (must pass before merge)

- back-compat: a `kyc_root == 0` policy behaves exactly as today (no regression).
- gated policy with a fresh `KycOk` authorizes the pull.
- gated policy with NO attestation -> `KycRequired`.
- gated policy with a stale attestation -> `KycStale`.
- the Agent path NEVER consults the KYC store (no side-effect crossover, mirror of
  the existing A1 audit invariant).
- record_kyc_attestation rejects an unauthorized caller.

## Honest status

Unaudited proposal. The ZK verifier it leans on (CBDS2YSL) is itself unaudited,
single-contributor trusted setup. Do not ship to mainnet money until both the
circuit setup is hardened (multi-party ceremony) and this contract change is
audited. The point of writing it now: it is the concrete artifact that turns the
live mainnet ZK verifier into a payment feature, which is the move that gets SDF
recognition (others can read + build on this exact pattern).
