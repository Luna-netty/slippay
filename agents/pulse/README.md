# Pulse — Slippay Payment Intelligence Agent

Autonomous operational agent for slippay. Watches Stellar payments, subscription health, webhook delivery, and Horizon network status. Sends Telegram alerts to founders when anything needs attention.

Built with SSL v7 (Sovereign Specification Language) — the same cognitive architecture that powers Wave (Bluewave AI).

## What Pulse does

- **Payment watch** (every 60s) — queries Supabase for newly paid orders, classifies by size, alerts immediately on large or underpaid payments
- **Subscription health** (every 5min) — flags active subscriptions where `next_charge_at < now()`, telling you which ones need a manual charge call
- **Webhook health** (every 5min) — detects dead webhook deliveries (6 retries exhausted), alerts when merchants are unreachable
- **Horizon health** (every 2min) — pings mainnet + testnet Horizon endpoints, alerts on downtime or latency > 3s
- **Daily report** (09:00 BRT) — 24h summary: payment count + USDC volume, subscription state, dead webhooks

Alerts go to Telegram via `PULSE_TELEGRAM_CHAT_IDS`. CRITICAL and WARNING are sent immediately. INFO is batched into the daily report.

## Architecture

```
pulse.py           main runtime — async cognitive loop
pulse.ssl          SSL v7 spec — soul of the agent (protocols, scope, safeguards)
pulse_state.json   persisted timestamps (created on first run, not committed)
pulse_audit.jsonl  append-only audit log of every event (created on first run)
```

Pulse is read-only on Supabase and Stellar. It never submits transactions, never writes to `orders`, `subscriptions`, or `merchants`. The only writes are to local state/audit files and Telegram.

## Setup

### 1. Create a Telegram bot

1. Message `@BotFather` on Telegram → `/newbot`
2. Copy the token
3. Get your chat ID: message `@userinfobot` or use `https://api.telegram.org/bot<TOKEN>/getUpdates` after sending a message to the bot

### 2. Configure environment

```sh
cp .env.example .env
# fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PULSE_TELEGRAM_TOKEN, PULSE_TELEGRAM_CHAT_IDS
```

`SUPABASE_SERVICE_ROLE_KEY` is needed because Pulse bypasses RLS to read all merchants' data. Find it in Supabase dashboard → Settings → API → service_role.

`PULSE_TELEGRAM_CHAT_IDS` is a comma-separated list of Telegram chat IDs to notify (Manuel + Mario).

### 3. Install and run

```sh
cd agents/pulse
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python pulse.py
```

### 4. Run with PM2 (production)

Add to `ecosystem.config.cjs` in the repo root:

```js
{
  name: "pulse",
  script: "agents/pulse/pulse.py",
  interpreter: "agents/pulse/.venv/bin/python",
  cwd: "/opt/slippay-backend",
  env_file: "agents/pulse/.env",
  restart_delay: 5000,
}
```

Then:

```sh
pm2 reload ecosystem.config.cjs --update-env
pm2 save
```

## Alert format

Every alert is prefixed with the severity level:

```
Pulse · slippay
[CRITICAL] Payment received
Merchant: Loja Exemplo
Amount:   1250.0000 USDC (R$6875.00)
Tx:       fbfdbb66b88945
Order:    8ed4fa21
```

```
Pulse · slippay
[WARNING] Subscription overdue — charge needed
Merchant: SaaS Cliente
Sub:      a3b2c1d0
Amount:   R$29.90 USDC
Due:      2026-05-10T09:00:00+00:00
Charges:  3 / 12
Overdue:  6.2h
Action:   POST /v1/subscriptions/a3b2c1d0.../charge
```

## Audit log

Every cycle writes to `pulse_audit.jsonl` — append-only JSONL. Each line:

```json
{"ts": "2026-05-11T16:00:00Z", "event": "payment_detected", "severity": "WARNING", "payload": {"order_id": "...", "usdc_amount": 250.0, "merchant": "Loja"}, "alerted": true, "cost_ms": 142}
```

Do not delete or truncate without Manuel's approval (`@audit_chain` constraint from SSL).

## SSL v7 spec

`pulse.ssl` is the formal behavioral specification. It defines:

- `@scope` — what Pulse can read/write (hard boundaries)
- `@protocols` — the 5 operational cycles with their intervals and alert thresholds
- `@adversarial_battery` — 10 failure scenarios pre-enumerated and mitigated
- `@audit_chain` — every significant action is logged
- `@safeguards` — read-only on DB, no Stellar transactions, rate limits

The SSL is the source of truth. If `pulse.py` behavior ever diverges from `pulse.ssl`, the SSL wins.

## What to verify before running on mainnet

1. `SUPABASE_URL` points to the production project (not local)
2. `PULSE_TELEGRAM_CHAT_IDS` has both Manuel's and Mario's chat IDs
3. `STELLAR_NETWORK` env in the main API is `MAINNET` — if still `TESTNET`, Horizon alerts reflect testnet state
4. Test Telegram delivery: `python -c "import asyncio; from pulse import send_alert; asyncio.run(send_alert('Pulse test', 'INFO'))"`
