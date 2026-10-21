# Concierge — Slippay Customer-Facing Agent

The agent that powers the "Ask Slippay" widget on the landing page. Answers
visitor questions about slippay, grounded in the `/docs/` corpus, with
citations.

Built on SSL v7 (Bluewave Soul Specification Language). The soul spec at
`concierge.ssl` defines identity, values, voice, decision engine, and
audit chain. The runtime is the slippay backend itself — the soul is
loaded as the head of the system prompt for `claude` CLI invocations
on `POST /api/v1/ask`.

## Architecture

```
visitor browser
   ↓ (SSE)
slippay backend (api.slippay.cc)
   ↓
supabase/functions/api/lib/ask.ts
   ↓
loads agents/concierge/concierge.ssl  ← soul spec (Bluewave SSL v7 grammar)
loads /tmp/slippay-docs-bundle.md     ← 16 doc files as a single corpus
   ↓
claude -p ... --append-system-prompt <ssl> --append-system-prompt-file <bundle>
   ↓
streams text + citations back to visitor
   ↓
agents/concierge/concierge_audit.jsonl  ← @audit_chain fleet run record
```

The agent runs **locally inside the slippay backend** — no external SaaS
dependency. The SSL spec is reusing Bluewave's grammar (MIT, public at
github.com/Galmanus/ssl-spec), not invoking Bluewave's commercial runtime.

## Soul spec

`concierge.ssl` defines 9 cognitive subsystems:

| section | purpose |
|---|---|
| `@vow` | immutable mission — grounded, cited, no fabrication |
| `@scope` | what concierge can read/write (HARD_DENY everything else) |
| `@identity` | the agent's self-name and category ("doc-grounded assistant", not "AI assistant") |
| `@values` | rigor > honest_disclosure > narrative_clarity > language_match > velocity |
| `@voice` | editorial, dry, no preamble/emoji/marketing |
| `@decision_engine` | when to answer, decline, say "I don't know", correct premise |
| `@action_types` | 4 discrete actions: respond_with_citations / decline_outside_scope / say_unknown / correct_misleading_premise |
| `@personality_constraints` | no legal/tax/investment advice, no promises, no quoting people without docs source |
| `@pre_mortem` | 5-check adversarial review before sending |
| `@audit_chain` | every fleet run appended to concierge_audit.jsonl |

## Audit chain

Every request appends one JSONL record to `concierge_audit.jsonl`:

```json
{
  "ts": "2026-05-11T19:46:00Z",
  "agent": "concierge",
  "soul_version": "1.0.0-concierge",
  "question_preview": "How much does slippay cost?",
  "response_preview": "Platform fee is 1% [docs/api-reference/orders.md]...",
  "docs_cited": ["docs/api-reference/orders.md", "docs/quickstart.md"],
  "action_taken": "respond",
  "latency_ms": 2143,
  "response_chars": 412,
  "language": "en",
  "history_turns": 0
}
```

Use this for:
- citation_rate: what % of answers cite ≥1 doc
- decline_rate: what % of questions are out-of-scope
- unknown_rate: what % land on "I don't have information about that"
- doc_coverage: which docs are cited most/least
- language_split: PT vs EN visitor breakdown

The chain is append-only. Never delete or rewrite.

## Updating the soul

Edit `concierge.ssl`. The slippay backend hot-reloads (well, restart-reloads
— `pm2 restart slippay-api`). No code changes needed for prompt-level
adjustments — just edit the spec.

When updating the spec significantly (changing `@values` weights, adding
`@action_types`, etc.), bump `SOUL_VERSION` so audit records can be
partitioned by spec version. The current version is `1.0.0-concierge`
defined in the SSL header.

## Boundaries (what Concierge is NOT)

- ❌ Not a sales agent — won't push signups.
- ❌ Not a support ticketing system — no escalation, no follow-up.
- ❌ Not a regulatory advisor — disclaims and redirects.
- ❌ Not a Bluewave SaaS tenant — runs locally in slippay backend only.
- ❌ Not connected to slippay DB — reads docs only, no merchant/order data.

## Boundaries (what Concierge IS)

- ✅ Educator — explains slippay features grounded in docs.
- ✅ Citation engine — every claim sourced to a file in the repo.
- ✅ Honest-disclosure layer — surfaces "mainnet not live" and "partnership
  pending" instead of glossing.
- ✅ Auditable — every fleet run is a JSONL record.

## Relation to Pulse

Pulse (`/agents/pulse/`) is the **ops monitoring agent** — alerts founders
via Telegram when payments arrive or webhooks die. Internal-facing.

Concierge is the **customer-facing agent** — answers visitor questions
on the landing page. External-facing.

Both follow the same SSL v7 architecture. Both are slippay-internal
(not Bluewave SaaS tenants). Different cognitive specs, different domains.
