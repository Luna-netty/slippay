# audit-002 · Soroban subscription contract

- **status:** opened · go-with-conditions
- **date:** 2026-05-16
- **scope:** `contracts/subscription/src/lib.rs` (272) + `src/test.rs` (190) + `Cargo.toml`
- **out of scope:** WC plugin (audit-001), `demo-testnet.mjs`, `deploy-testnet.sh`
- **target deploy:** Stellar mainnet (Sprint 4)
- **testnet baseline:** `CBWJ3LQGO7HBZBQK2MGS75EK266HNW4RJS77BVZIGZGDUUENXQMSHRHA` · wasm `dbf7633d...`

## findings

| # | sev | category | location | title |
|---|---|---|---|---|
| F1 | high | state/TTL | lib.rs:118, 179, 196, 212, 228, 259 | no `extend_ttl` on persistent storage; entries archived mid-lifecycle |
| F2 | high | upgradability | lib.rs (all) | no admin/upgrade path; chosen tradeoff but irreversible |
| F3 | medium | arithmetic | lib.rs:170 | `charges_done += 1` not `checked_add`; safe only via release profile flag |
| F4 | medium | doc/runtime | lib.rs:5, 126-140 | module doc says "anyone can charge"; code requires `buyer.require_auth()` |
| F5 | medium | authorization | lib.rs:140, test.rs:27 | tests use `mock_all_auths_allowing_non_root_auth`; nested SAC pre-auth not exercised |
| F6 | low | state machine | lib.rs:142, 192-193 | `cancel` allowed on Expired → emits second event |
| F7 | low | token interaction | lib.rs:167-168 | no auto-pause on N consecutive SAC freeze/clawback failures |
| F8 | low | events | lib.rs:119-122 | `subscription_created` omits merchant, token, max_periods, expires_at |
| F9 | info | edge case | lib.rs:89 | `max_periods = u32::MAX` safe (11.7M years) |
| F10 | info | determinism | lib.rs:146, 172 | `ledger().timestamp()` deterministic; pause/resume does not prorate |

## what the contract gets right

- `require_auth` on the correct principal for every privileged fn (buyer for create/charge/cancel; merchant for pause/resume)
- persistent storage for `DataKey::Sub` (instance would TTL-bind all subs to one key)
- nonce-based id with collision check (lib.rs:97-100) prevents replay/clobber
- `period_seconds < 86_400` rejected (lib.rs:89) blocks micro-period griefing
- `saturating_add` on `next_due` u64 (lib.rs:156, 172)
- `mark_expired` (lib.rs:245-265) correctly handles the Soroban panic-reverts-state quirk
- `panic = "abort"` + `overflow-checks = true` + `lto = true` (Cargo.toml release profile)

## mainnet conditions

1. **F1 mandatory** — add `extend_ttl` on every persistent `set` (create + charge), tested with multi-month ledger advance. without it, any sub with `period_seconds ≥ 30d` will fail its second charge. **falsifiable 60d:** if F1 unfixed and a 30d+ sub is created, second charge fails with "entry archived"; if not, my TTL model is wrong.
2. **F4 mandatory** — pick: implement pre-auth (v0.2 work) OR rewrite doc + tell backend/WC team every charge needs fresh buyer signature. cannot ship with central operational property contradictory.
3. **F5 mandatory** — at least one end-to-end testnet charge with a real wallet signature (not mock) before mainnet. confirms nested SAC auth chain works.
4. **F2 documented, not fixed** — publish v0.2 migration story (how merchants/buyers re-subscribe) before mainnet. trade is keeping contract immutable.
5. **F3, F6-F8** — optional pre-mainnet hygiene while already touching the contract.

## confidence ceiling

soroban-sdk v26 default TTL constants and `mock_all_auths_allowing_non_root_auth` semantics not confirmed against `github.com/stellar/rs-soroban-sdk` v26 tag. needs verification before F1/F5 work.
