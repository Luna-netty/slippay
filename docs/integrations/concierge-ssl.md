# Ask Slippay · built on Bluewave SSL v7

The "Ask Slippay" widget on the landing and inside the dashboard is not
a vanilla LLM chat. It runs as a constrained agent named **Concierge**,
governed by the **Bluewave Soul Specification Language (SSL) v7**.

The full spec is open and human-readable at
[**galmanus.github.io/ssl-spec**](https://galmanus.github.io/ssl-spec/).

This page explains what that means in practice for visitors and
operators.

## What is SSL

SSL — Bluewave Soul Specification Language — is a formal cognitive
constraint format. A soul spec is a single declarative file that names
an agent's:

- **identity** — who it is, who it speaks for
- **values** — non-negotiables (e.g. "never claim mainnet-live unless
  the docs say so")
- **voice** — tone, lexicon, register, what it refuses to say
- **decision engine** — the deliberation pipeline before any reply
- **pre-mortem checklist** — explicit failure modes the agent must
  rule out before sending
- **audit chain** — every action is journaled to a JSONL file with
  inputs, deliberation snapshot, and outcome

The spec is **declarative, not executable**. The agent runtime reads
the SSL at boot and treats every directive in it as binding context.
The model then operates under those constraints for the rest of the
session. The teeth come from (a) the system prompt placing the spec
first, and (b) the audit chain — every reply is recorded and operator
can inspect drift.

See the full grammar, primitives, and rationale at
[galmanus.github.io/ssl-spec](https://galmanus.github.io/ssl-spec/).

## How Concierge is configured

The Concierge agent for slippay lives in the repo at:

```
agents/concierge/
├── concierge.ssl        # the soul spec — 9,142 chars, v7-compliant
└── concierge_audit.jsonl # append-only audit log of every interaction
```

At runtime, the API process loads `concierge.ssl` once at boot and
prepends it to the system prompt for every Ask Slippay request.

The model engine is **Claude Code (Opus 4.7, 1M context)** invoked as
a subprocess, using the operator's Claude Max subscription rather than
the metered Anthropic API. The docs bundle (every markdown file under
`docs/`) is concatenated and provided as a second system block via
`--append-system-prompt-file`, so the model has the full doc corpus
in-context for every reply.

The audit chain logs `{ts, question, answer_hash, citations, duration_ms}`
to `concierge_audit.jsonl` for retrospective review.

## What SSL gives slippay specifically

SSL v7 has five primitives that map directly to the Ask Slippay UX:

- **@scope** — Concierge will not answer outside the slippay
  documentation corpus. If you ask about something not in the docs,
  it says "I don't have information about that in the slippay
  documentation" and stops. No hallucination cover.
- **@cite_every_claim** — every factual claim is followed inline by
  the source path `[docs/api-reference/orders.md]`. The widget renders
  these as clickable cards at the bottom of each answer linking to the
  raw file on GitHub.
- **@adversarial_battery** — the model runs an internal red-team pass
  on its own draft before sending. If the draft contradicts the spec
  ("don't claim partnership-signed", "don't claim live without docs
  support"), it rewrites before emit.
- **@audit_chain** — every reply leaves a trace. The operator can grep
  the JSONL for drift, citation-rate, refusal-rate.
- **@register_engineer** — the response voice is calibrated to the
  reader (developer, merchant, investor). Concierge picks register
  from the question and consistent across the reply.

The combined effect: the widget feels less like a chatbot and more
like a calm support engineer who knows the codebase and will not
make things up.

## Verifying the constraints

Try these prompts on the widget:

- *"What's the slippay fee?"* → answers from `docs/business/revenue-model.md`
  with the actual published number, cites it.
- *"Does slippay have a partnership with Stripe?"* → "I don't have
  information about that in the slippay documentation."
  No hallucinated partnership.
- *"Are you live on mainnet?"* → answers from `docs/README.md` +
  `contracts/subscription/DEPLOYED.md`, points at the public mainnet
  contract id (`CBJMQ6ZY…DJKSEVQN`) and the deploy tx hash.
- *"Quanto custa Slippay?"* → switches to Portuguese, same citation
  discipline.

If any of these break — Concierge hallucinates, omits citations,
claims a partnership that doesn't exist in docs, or switches register
mid-reply — that's a spec violation worth reporting at
`github.com/Galmanus/slippay/issues` with the prompt + the full reply.

## SSL beyond slippay

SSL is not slippay-specific. The same spec format is used to govern
Bluewave AI's other agents (Wave, Pulse, Perena). The grammar at
[galmanus.github.io/ssl-spec](https://galmanus.github.io/ssl-spec/) is
the canonical reference; the v7 release notes are at the same site.

## Engineering notes

- **Streaming**: Concierge responses stream token-by-token via
  Server-Sent Events. The ThinkingIndicator in the widget covers the
  3-5s cold-start window before the first token (claude CLI
  subprocess init).
- **Cost model**: zero per-question billing — uses the operator's
  Claude Max subscription cap, not the metered Anthropic API. The
  practical cap is ~100-500 questions/day depending on context size.
- **Concurrency**: max 4 simultaneous subprocesses on the api process
  (audit-004 C7). Above that, requests return 503 `busy`.
- **Rate limit**: 5 requests / minute / IP and 100 requests / day / IP
  on the unauthenticated public endpoint. Authenticated future paths
  will keyed by `merchant.id` instead.
- **Origin allowlist**: only `slippay.cc`, `app.slippay.cc`, and
  localhost dev origins can call `/v1/ask`. Random pages on the open
  internet cannot CSRF-style invoke the widget.

## Falsifiable spec compliance · 30d

After Ask Slippay is live for 30 days, an audit of the JSONL log
should show:

- ≥95% of factual claims have an inline citation
- ≥99% of out-of-scope questions get a refusal, not a hallucinated
  answer
- 0 claims of mainnet status that contradict `DEPLOYED.md`
- 0 claims of partnership status that aren't in `docs/concepts/regulatory.md`

Below this threshold → SSL spec is not load-bearing, soul file
needs to be re-tightened or runtime needs a stricter critic loop.

## See also

- **Public spec:** [galmanus.github.io/ssl-spec](https://galmanus.github.io/ssl-spec/)
- **Repo:** `agents/concierge/concierge.ssl` in this codebase
- **Engine:** Claude Code (Opus 4.7) invoked via subprocess from
  `supabase/functions/api/lib/ask.ts`
- **Audit log:** `agents/concierge/concierge_audit.jsonl` on the prod
  VPS at `/opt/slippay-backend/agents/concierge/concierge_audit.jsonl`
