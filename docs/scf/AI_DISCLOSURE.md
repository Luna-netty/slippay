# AI Disclosure — SlipPay (SCF Open Track requirement)

The Open Track requires full disclosure of AI-generated or AI-assisted
artifacts. This is that disclosure, written plainly.

## How AI was used

SlipPay is built by a two-person team (Manuel Galmanus, engineering; Mario,
business/regulatory). Manuel uses AI coding assistants heavily and routinely —
primarily Claude (via Claude Code) and an in-house agent ("Wave"). Disclosure
by artifact type:

| Artifact | AI involvement | Human ownership |
|---|---|---|
| Soroban subscription contract (`lib.rs`) | AI-assisted drafting + review | Every line read, tested, and audited by Manuel; 5/5 unit tests; F1–F8 audit fixes human-decided |
| Off-chain API (Deno/Hono) | AI-assisted | Human-reviewed; security middleware human-specified |
| Web app / landing | AI-assisted (copy + components) | Design direction + copy decisions human |
| This application's prose | AI-assisted drafting | Facts human-verified against the repo before submission |
| Architecture & regulatory positioning (BCB Res. 519/520/521) | Human (Mario + legal counsel) | AI used only to summarize, not to decide |

## What is NOT AI-decided

- The regulatory strategy (Res. 561/519/520/521 compliance path, domestic
  dollarization positioning) is human + legal-counsel work.
- The decision of what to claim in this application: every factual claim was
  verified against the actual codebase before submission. Aspirational
  features (e.g. PYUSD support, the Pix-anchor integration) are labeled as
  roadmap, not as shipped — explicitly, to avoid AI-fluency masking gaps.

## Honesty note

We treat "AI-assisted" as the default state of the codebase, not an exception.
The relevant question for a reviewer is not "did AI touch this" (it did,
everywhere) but "is it verified and does it work on-chain" — which the mainnet
deploy, matching Wasm hash, and passing tests answer directly.
