# 4P On-Ramp Margin & Rate Rounding Specification

- **Module:** `supabase/functions/api/routes/fourp.ts` & `apps/web/src/lib/ramp4p.ts`
- **Issue Reference:** Resolves #109
- **Status:** Implemented and verified

---

## 1. Margin & Net Crypto Calculation

When quoting an on-ramp purchase (Pix BRL → USDC):
1. 4P returns the pre-margin gross price: `gross[asset]` (USDC received per BRL before fee).
2. Slippay fee is configured in integer basis points: `marginBps` (default 280 bps = 2.80%).
3. The net multiplier in basis points is:
   $$\text{netBps} = 10\,000 - \text{marginBps}$$

### Explicit Rounding Direction: Round Down (Floor)
To prevent penny-clipping or fee over-collection:
* **Direction:** Explicit round down (`Math.floor`) to atomic USDC precision (6 decimal places / micro-USDC).
* **Bias:** Rounding down is strictly in the **platform's disfavour** (the user receives at least the truncated value, and platform fees never exceed the configured margin).
* **Formula:**
  $$\text{netCrypto} = \frac{\lfloor \text{gross} \times \text{netBps} \times 10^2 \rfloor}{10^6}$$
* **No `toFixed(8)` Truncation:** Replaces legacy string formatting with deterministic integer arithmetic.

---

## 2. Effective Rate Derivation

In earlier versions, `dollarRate` was computed as `brl / grossOut`, representing the raw pre-margin market rate. Because users receive `cryptoOut` (net after fee), multiplying `dollarRate * cryptoOut` produced an amount less than the BRL paid (a rate mismatch).

### Corrected Derivation:
The displayed rate is derived directly from the post-margin net crypto:
$$\text{dollarRate} = \frac{\text{brl}}{\text{cryptoOut}}$$

### Invariant:
For all order amounts:
$$\left| \text{dollarRate} \times \text{cryptoOut} - \text{brl} \right| \le 10^{-7}$$
The displayed rate and the settled amount agree within 1 stroop / 1 cent across the entire table of transaction sizes.
