# key custody · slippay mainnet

- **status:** decision required before mainnet deploy
- **audit reference:** audit-005 · S1 (deployer seed) + S2 (platform-fee key)
- **date opened:** 2026-05-16

## what's at stake

| key | controls | failure mode if leaked |
|---|---|---|
| **deployer (mainnet)** | `stellar contract upload` + `stellar contract deploy` for `slippay-subscription` mainnet · funds initial deploy + reserve | attacker uploads new wasm under the same `WASM_HASH_MAINNET` storage slot · OR mints a malicious version under a different hash and tricks merchants to use it · platform-fee paid from this account is drained |
| **platform-fee receiver** | accepts every fee paid by the contract via the SAC transfer split | attacker re-routes the receiver address by signing as platform — all subsequent fees flow to attacker · also exposes operational metadata (volume, frequency) |
| **buyer subscription keys** | per-buyer; not slippay-side | out of scope — buyers manage their own |

## current state (testnet)

- `~/.config/stellar/identity/slippay-deployer.toml` on operator's laptop — seed phrase plaintext (REDACTED — was committed in plaintext until 2026-06-01; this is the **testnet** `slippay-deployer` key, never reused on mainnet; treat as compromised and rotate via friendbot). disk theft = contract takeover.
- platform-fee key not yet generated; docs at `docs/deploy-secrets.md:101-112` say "save in 1Password/Bitwarden" — plaintext-at-rest password manager, still software-only.
- both treated as compromised for mainnet purposes — generate fresh.

## options

### A · Ledger hardware (recommended for v0.1 mainnet)

- one Nano S Plus (~R$500) holds both keys via HD paths (different derivation indices).
- `stellar keys` CLI supports `--hd-path m/44'/148'/0'` etc.
- seed lives on hardware; never touches disk or RAM of the host.
- signing requires physical confirmation per transaction — friction is intentional.

**failure modes named:**
- single hardware item = single point of failure. if lost, recovery via 24-word seed (must be paper-stored, never typed).
- supply chain attack on the Ledger itself (rare but real — Trezor + Ledger have both had supply-chain incidents in 2022-2024).
- operator-side phishing: a malicious dApp can ask for arbitrary signatures; operator must read the screen.

### B · Stellar multisig 2-of-3

- 1 signer on a Ledger (operator)
- 1 signer server-side (KMS-mounted, e.g., AWS KMS / GCP KMS / age-encrypted file decrypted at boot)
- 1 cold backup signer (paper, in a sealed envelope in a different physical location)
- thresholds: `master=0`, `each signer weight=1`, `med_threshold=2`, `low_threshold=2`, `high_threshold=2`. operations require 2 of 3.

**failure modes named:**
- complexity: signing flow now requires operator + automation in lockstep. miscoordination = stuck transaction.
- KMS billing + setup overhead (~$1/mo + ~1h initial config).
- if KMS provider has a regional outage, server-side signer is unavailable; operator + paper still gives 2-of-3 in person.

### C · air-gapped laptop + QR signing

- old laptop without network. generate seed offline. sign tx offline by reading QR, return signed tx via QR.
- zero hardware cost.
- highest friction. signing a single transaction takes 5-10 min.

**failure modes named:**
- still software-only. seed lives on disk of the air-gapped laptop. theft of that laptop = compromise.
- QR-channel UX is fragile. fast iteration is impossible.

## decision (pending — operator must choose)

| | A · Ledger | B · multisig | C · air-gap |
|---|---|---|---|
| cost | R$500 | R$500 + ~$1/mo KMS | R$0 |
| setup time | 30 min | 2-4 h | 1-2 h |
| signing friction | low (button press) | medium-high (coordination) | high (QR roundtrip) |
| single-point-of-failure | hardware loss → paper recovery | none (2-of-3) | air-gap laptop loss → seed paper recovery |
| audit-005 satisfies | yes | yes (strongest) | yes (weakest of the three) |
| recommended for slippay v0.1 mainnet | **yes** | upgrade target for v0.2 | only if Ledger is unavailable |

**v0.1 default unless operator overrides:** option A · Ledger Nano S Plus, single signer, paper backup in a different physical location than the Ledger.

**v0.2 upgrade:** B · 2-of-3 multisig with KMS-backed server signer (auto-sign for routine ops like `extend_ttl` refresh; require operator Ledger for any `upgrade` op — though there is no upgrade in v0.1, so this is forward-looking).

## what changes in repo on adoption

- `docs/deploy-secrets.md` rewritten with the chosen option (currently still references "1Password/Bitwarden")
- `contracts/subscription/deploy-mainnet.sh` (new) uses the chosen signer source explicitly; never `stellar keys generate --global` for mainnet
- `ecosystem.config.cjs` does not need changes (no signing happens in the api/listener process — listener signs nothing; contract calls are buyer-side; platform-fee inflows are receive-only)

## falsifiable

if option A is adopted and the operator confirms the seed is paper-stored in a different physical location from the Ledger, the deployer key compromise rate over 18 months should be **zero**. > zero compromises in that window → revisit option B.

decisions to capture before mainnet:
- [ ] which option (A / B / C)
- [ ] mainnet deployer public address
- [ ] platform-fee receiver public address
- [ ] paper backup physical location (one line, in a private ops doc — not in the repo)
- [ ] who else has access to the paper backup
