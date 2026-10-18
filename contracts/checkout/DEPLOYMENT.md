# SlipPay Checkout — deployment & proof

The "Stripe of stablecoin" revenue primitive. One customer payment → contract
forces an atomic 97/3 split (net to merchant, fee to SlipPay). Fee recipient +
bps fixed at deploy (constructor) — INESCAPABLE; the merchant cannot route around it.

## Contract
- src: `contracts/checkout/src/lib.rs` — `pay(from, merchant, token, amount)`, `__constructor(fee_to, fee_bps)`, `fee_bps()`, `fee_to()`.
- wasm: 5256 bytes, 4 exported fns.

## Testnet deploy (2026-06-05)
- contract id: `CBO2COBZUTHH4II4JCQRZVO4RKDUIUH4MXZTAWOYVUZIVYI47UIDQCWQ`
- fee_to: `GBVMU64N5JK3NICY3ZRPXVW4RQIQFHLBPW5UI4F55KVJPZJS3SIOWJF4` (slippay-fee)
- fee_bps: 300 (3%)
- token used in proof: native SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`

## Proof
- tx `e142cd0bbaa19adfe1b74d3629ea7788f06abca8a0ba6ba121e6f41c67390941`
- buyer paid 10 → merchant +9.7 (97%), slippay-fee +0.3 (3%), one atomic call.

## Mainnet path
- same contract, deploy with mainnet slippay-fee + USDC SAC as token. Needs deployer XLM.
- frontend wrapper (TODO): merchant creates charge (amount) → QR encodes {checkout contract, merchant, amount} → customer pays via /pay (passkey → invoke checkout.pay) → split auto.
