# US defense-origin public-domain tech for Slippay — verified research

- **date:** 2026-06-01
- **method:** deep-research harness · 106 sub-agents · 23 sources · 102 claims extracted → 25 adversarially verified (3-vote) → **22 confirmed, 3 killed**
- **status:** REFERENCE / parked-direction ammo. Most of this serves the AGENT
  direction, which is deliberately parked (see
  `project_slippay_axlc_automaton_parked` + `project_slippay_positioning_grant_decision`).
  Do NOT let it reopen the moat-for-empty-castle trap. Two findings are usable
  now (BFT citation, Stellar halt risk); the rest is trigger-gated.

---

## Usable NOW (zero build — citations / operational knowledge)

### 1. Byzantine Fault Tolerance (Lamport-Shostak-Pease 1982) — validates the shipped signed-tx design
- **Verified 3-0** (oral-iff-2/3 sub-claim 2-1). Source: lamport.azurewebsites.net/pubs/byz.pdf
- Verbatim: *"With unforgeable written messages, the problem is solvable for any number of generals and possible traitors"* (Thm 2, Algorithm SM(m)). Oral messages need >2/3 loyal and ≥ 3m+1 nodes for m faults.
- **Slippay mapping:** passkey auth + signed Stellar transactions sit in the signed-message regime → relaxes the quorum lower bound. **Use as a grant-pitch credibility line, not code.**
- **Disanalogy/caveat:** signatures still need synchrony (A1–A3 timeout missing-message detection) + genuinely unforgeable signatures (A4). Stellar's SCP uses federated quorum slices, NOT a uniform >2/3 threshold — the oral bound is illustrative, not SCP's literal safety threshold.

### 2. Stellar FBA/SCP liveness risk — operational knowledge for ANY Stellar payments product
- **Verified 3-0** (design-tradeoff + safety-priority); 2-1 on the quantitative x≤PBFT and 2019 halt numbers. Sources: Mazières safety-vs-liveness blog (scs.stanford.edu), arXiv 1904.13302.
- Mazières (SCP author), verbatim: *"the consequences of a safety failure (double-spent digital money) are far worse than those of a liveness failure."* SCP **prioritizes safety over liveness → it HALTS rather than double-spends.**
- **Slippay mapping:** the rail can stop. A payments product should surface an honest "network paused, funds safe" state rather than a hung spinner. (Queued, not urgent at zero volume.)
- **Current numbers — independently verified 2026-06-01, pitch-safe with stamped sources:**
  - **87 active validators** at end of Q1 2026 (up from 81 in Q4 2025). Source: Messari, *State of Stellar Q1 2026*.
  - **7 Tier-1 organizations** since April 2025 — Blockdaemon, Creit Technologies, Franklin Templeton, LOBSTR, Public Node, SatoshiPay, SDF — each running 3 full validators (21 Tier-1 validators). Source: **Stellar Docs (official)** — developers.stellar.org/docs/validators/tier-1-orgs.
  - **Halt threshold: if 3 of the 7 Tier-1 orgs go down, the network halts (fault tolerance = 2 orgs).** Source: same official Stellar Docs page — this is a structural/official statement, NOT a paper inference.
  - Forward color (usable in pitch): SDF targeted raising Tier-1 from 7 → 13 (fault tolerance 2 → 4); as of Q1 2026 not yet achieved — still 7. Narrative = "network actively decentralizing."
- **DEAD — do not use:** the 2019 "2 SDF validators halt the network" figure. Anyone competent corrects you in public. (The "both nodes are SDF = single point of failure" framing was also **killed 0-3** as overreach.)

---

## Trigger-gated

> **DO NOT PURSUE WITHOUT A PAYING CUSTOMER ASKING FOR IT.**
> The trigger is NOT an internal decision ("we chose to go agent"). The trigger is
> a paying customer (or a signed grant RFP) explicitly demanding this capability.
> Absent that, re-reading these sections is how the moat-for-empty-castle trap
> reopens itself in 30 days. This is real public tech; it is also expensive
> engineering for a market that does not yet exist. Leave it parked.

### 3. seL4 / DARPA HACMS — verified isolation kernel
- **Verified 3-0.** Sources: PMC5597724, sel4.systems, SOSP 2009 Klein et al.
- seL4: first OS kernel with machine-checked functional-correctness proof. ~10–12K LOC C, ~480–500K lines Isabelle/HOL. **GPLv2** (kernel+proofs), BSD-2 (libs).
- **HACMS red-team result (the gold):** *"even with root access to the Linux partition, they were unable to break out of their partition or disrupt the operation of the vehicles in any way."* (Fisher et al., Phil. Trans. R. Soc. A 375:20150401, 2017.) Live in-flight attack destroyed the unprotected vision app, left flight-critical functions untouched.
- **Integration point (if agent direction un-parks):** run the autonomous payment agent inside a verified seL4 partition for proven spatial isolation; cite the red-team survival.
- **Disanalogy/failure mode:** seL4 capabilities = OS-kernel runtime memory/IPC authorization; axlc bind/constrain/invariant = contract-level SMT-proven payment bounds. Different layer, different proof discipline. Proofs hold only under stated assumptions (C semantics, compiler/hardware model, correct MMU/DMA, verified Arm/RISC-V configs). **Only counts if you actually run on seL4 — citing the result is not the same as having the guarantee.**

### 4. DARPA SIEVE zero-knowledge cluster — permissive, public, but NO turnkey on-chain path
- **Verified 3-0** on licenses/provenance. Components + licenses:
  - **SIEVE IR** — CC-BY-4.0 + Distribution Statement A. Vendor-neutral circuit IR bridging ZK frontends (TA1) ↔ proof backends (TA2). github.com/sieve-zk/ir (DARPA HR001120C0087/86/85).
  - **WizToolKit** — MIT. C++ API over SIEVE IR. github.com/stealthsoftwareinc/wiztoolkit.
  - **ZK-SecreC** — BSD-3-Clause. ZKP DSL, Cybernetica AS (DARPA HR0011-20-C-0083). github.com/zk-secrec. (Note: targets proofs LARGER than typical Web3 use.)
  - **emp-zk** — Apache-2.0. VOLE-based **interactive** ZK (Wolverine/Quicksilver/Mystique). github.com/emp-toolkit/emp-zk.
- **The recurring blocker (verified 3-0):** NONE ships a non-interactive proof verifiable by a Stellar Soroban contract. emp-zk is designated-verifier/interactive (verifier holds a secret Δ, runs live rounds) — a deterministic, stateless on-chain contract cannot do that. axlc emits SMT-LIB; SIEVE is circuit-based. **The unbuilt engineering = SMT→circuit translation + a Soroban-verifiable non-interactive SNARK/STARK backend.** Months of work.
- **KILLED 0-3:** the framing that "SIEVE's prove-without-revealing goal is structurally identical to Slippay proving bound/constrain/invariant without exposing transaction internals." The prettiest analogy did not survive verification.
- **License caveat:** Distribution Statement A is a DoD public-release marking, NOT an EAR/ITAR export determination.

### 5. MoneyGram Access — confirmed cash↔USDC ramp (ALREADY acted on)
- **Verified 3-0.** Sources: stellar.org/products-and-tools/moneygram, developer.moneygram.com, developers.stellar.org/docs/tools/ramps/moneygram.
- Cash↔USDC on Stellar without a bank account, "one integration." Cash-in ~30 countries, cash-out ~170.
- **Status:** Slippay shipped the SEP-24 off-ramp (`/withdraw-demo`) 2026-06-01 (testnet). Going live needs MoneyGram allowlisting + Res 561 cross-border counsel. See `docs/integrations/moneygram.md`.
- **KILLED 1-2:** "the page discloses no fees/speed/API/agent-payment support" — it does disclose some; specifics still unverified.

---

## NOT substantiated by this pass (need a dedicated search if pursued)
- Onion routing (NRL/Tor) for payment privacy — no surviving claim.
- NSA CNSA 2.0 concrete algorithms/timeline (ML-KEM/ML-DSA/SLH-DSA) for a fiat rail — no surviving claim (only SIEVE's general post-quantum-ZK direction, and the CNSA bridge is inference, not a DARPA assertion).
- Authenticated timing (Roughtime/NTS) — no surviving claim.

## The recorded gap (archived — NOT a work item)
The technical blocker, written down once so it's not re-discovered later: no
production non-interactive, publicly-verifiable proof system (Groth16/PLONK/STARK)
is known to consume SIEVE IR or compile from ZK-SecreC AND verify inside a Stellar
Soroban contract within gas/CPU limits. **This is recorded as the gap to close IF
and WHEN the trigger above fires — it is not an open invitation to investigate.**
Do not scope, spike, or "just check feasibility" on this absent a paying customer
asking. If you find yourself reading this paragraph as a TODO, that is the trap.
