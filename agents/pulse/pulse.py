"""
Pulse — Slippay Payment Intelligence Agent
SSL: agents/pulse/pulse.ssl
SOUL_VERSION: 1.0.0-pulse

Cognitive cycle:
  1. Perceive  — query Supabase + Horizon
  2. Reason    — classify signals, score anomalies
  3. Act       — send Telegram alerts
  4. Persist   — update state + audit log
"""

import os
import fcntl
import json
import sys
import time
import asyncio
import traceback
from datetime import datetime, timezone, timedelta
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
except ImportError:  # py<3.9 fallback
    ZoneInfo = None  # type: ignore

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

# ── Config ──────────────────────────────────────────────────────────────────

SUPABASE_URL         = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
TELEGRAM_TOKEN       = os.environ["PULSE_TELEGRAM_TOKEN"]
TELEGRAM_CHAT_IDS    = [c.strip() for c in os.environ["PULSE_TELEGRAM_CHAT_IDS"].split(",") if c.strip()]

STATE_FILE = Path(__file__).parent / "pulse_state.json"
LOCK_FILE  = Path(__file__).parent / "pulse.lock"
AUDIT_FILE = Path(__file__).parent / "pulse_audit.jsonl"

# Intervals (seconds) — from SSL @protocols
PAYMENT_INTERVAL      = 60
SUBSCRIPTION_INTERVAL = 300
WEBHOOK_INTERVAL      = 300
HORIZON_INTERVAL      = 120

# B10 mitigation: tolerate up to 60s clock drift between host and Supabase.
# Used as a buffer when filtering "<= now()" — subtract buffer from host time
# so a slightly-ahead host clock doesn't pick up not-yet-due rows. Trade-off:
# overdue detection is delayed by up to CLOCK_DRIFT_BUFFER_S.
CLOCK_DRIFT_BUFFER_S = 60

# Daily report hour in BRT
DAILY_REPORT_HOUR_BRT = 9

# Backfill: on first run, look back this many hours. Default 0 (no backfill
# — start fresh, don't alert-storm on historical events).
PULSE_BACKFILL_HOURS = int(os.environ.get("PULSE_BACKFILL_HOURS", "0"))

HORIZON_URLS = {
    "mainnet": "https://horizon.stellar.org",
    "testnet": "https://horizon-testnet.stellar.org",
}
HORIZON_LATENCY_THRESHOLD_MS = 3000

# Alert rate limit (CRITICAL/WARNING never suppressed, INFO batched in daily report)
MAX_ALERTS_PER_HOUR = 30

# ── Advisory lock (B6) ─────────────────────────────────────────────────────

_lock_fd: int | None = None

def acquire_advisory_lock() -> None:
    """SSL @adversarial_battery B6: prevent duplicate Pulse instances.
    fcntl.flock is held for the process lifetime; OS releases on exit/crash."""
    global _lock_fd
    _lock_fd = os.open(LOCK_FILE, os.O_CREAT | os.O_WRONLY, 0o644)
    try:
        fcntl.flock(_lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        os.ftruncate(_lock_fd, 0)
        os.write(_lock_fd, f"{os.getpid()}\n{datetime.now(timezone.utc).isoformat()}\n".encode())
    except BlockingIOError:
        print(f"[Pulse] Another instance is holding {LOCK_FILE}. Exiting.", file=sys.stderr)
        sys.exit(1)

# ── State ────────────────────────────────────────────────────────────────────

def _default_state() -> dict:
    if PULSE_BACKFILL_HOURS > 0:
        start = (datetime.now(timezone.utc) - timedelta(hours=PULSE_BACKFILL_HOURS)).isoformat()
    else:
        start = datetime.now(timezone.utc).isoformat()
    return {
        "last_payment_check":    start,
        "last_underpaid_check":  start,  # separate cursor since underpaid uses created_at, not paid_at
        "last_subscription_check": start,
        "last_webhook_check":    start,
        "last_daily_report":     "",
        "horizon": {
            "mainnet": {"status": "ok", "last_ok": start},
            "testnet": {"status": "ok", "last_ok": start},
        },
    }

def load_state() -> dict:
    try:
        if STATE_FILE.exists():
            saved = json.loads(STATE_FILE.read_text())
            # backward compat: ensure new cursor exists for old state files
            saved.setdefault("last_underpaid_check", saved.get("last_payment_check", datetime.now(timezone.utc).isoformat()))
            return saved
    except Exception:
        _audit("error", "WARNING", {"exception": "state file corrupted — reset to defaults"})
    return _default_state()

def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2))

# ── Audit chain (SSL @audit_chain) ──────────────────────────────────────────

def _audit(event: str, severity: str, payload: dict, alerted: bool = False, cost_ms: int = 0) -> None:
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "severity": severity,
        "payload": payload,
        "alerted": alerted,
        "cost_ms": cost_ms,
    }
    with AUDIT_FILE.open("a") as f:
        f.write(json.dumps(record) + "\n")

# ── Time / drift ────────────────────────────────────────────────────────────

def host_now_minus_buffer_iso() -> str:
    """ISO timestamp of (host_now - CLOCK_DRIFT_BUFFER_S). For B10 mitigation."""
    return (datetime.now(timezone.utc) - timedelta(seconds=CLOCK_DRIFT_BUFFER_S)).isoformat()

def brt_hour_now() -> int:
    """Current hour in São Paulo timezone. Uses zoneinfo if available; falls back
    to fixed UTC-3 (BR has no DST since 2019 but this is policy-dependent)."""
    if ZoneInfo is not None:
        return datetime.now(ZoneInfo("America/Sao_Paulo")).hour
    return (datetime.now(timezone.utc).hour - 3) % 24

async def check_clock_skew(client: httpx.AsyncClient) -> None:
    """B10 startup check: detect host/Supabase clock drift via response Date header.
    Warn if > 30s. Does not alter behavior — CLOCK_DRIFT_BUFFER_S is the actual
    mitigation."""
    try:
        resp = await client.head(f"{SUPABASE_URL}/rest/v1/", headers=_supa_headers(), timeout=10)
        server_date = resp.headers.get("date")
        if not server_date: return
        from email.utils import parsedate_to_datetime
        server_dt = parsedate_to_datetime(server_date)
        if server_dt.tzinfo is None:
            server_dt = server_dt.replace(tzinfo=timezone.utc)
        skew = abs((server_dt - datetime.now(timezone.utc)).total_seconds())
        if skew > 30:
            _audit("clock_skew_detected", "WARNING", {"skew_seconds": round(skew, 1)})
            await send_alert(
                f"Pulse: host clock drift {skew:.1f}s vs Supabase. Buffer is {CLOCK_DRIFT_BUFFER_S}s — monitor.",
                "WARNING",
            )
    except Exception as e:
        print(f"[Pulse] skew check failed: {e}")

# ── HTTP helpers ─────────────────────────────────────────────────────────────

def _supa_headers() -> dict:
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
    }

async def _supa_get(client: httpx.AsyncClient, table: str, params: dict) -> list:
    t0 = time.monotonic()
    resp = await client.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        params=params,
        headers=_supa_headers(),
        timeout=15,
    )
    resp.raise_for_status()
    cost_ms = int((time.monotonic() - t0) * 1000)
    rows = resp.json()
    _audit(f"db_read:{table}", "INFO", {"params": {k: v for k, v in params.items() if k != "select"}, "rows": len(rows)}, cost_ms=cost_ms)
    return rows

# ── Telegram ─────────────────────────────────────────────────────────────────

_alerts_this_hour: list[float] = []

async def send_alert(text: str, severity: str = "INFO") -> None:
    global _alerts_this_hour
    now = time.monotonic()
    _alerts_this_hour = [t for t in _alerts_this_hour if now - t < 3600]

    if len(_alerts_this_hour) >= MAX_ALERTS_PER_HOUR and severity == "INFO":
        return  # rate-limit INFO only

    prefix = f"[{severity}] " if severity in ("CRITICAL", "WARNING") else ""
    message = f"Pulse · slippay\n{prefix}{text}"

    errors = []
    async with httpx.AsyncClient() as client:
        for chat_id in TELEGRAM_CHAT_IDS:
            try:
                r = await client.post(
                    f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
                    json={"chat_id": chat_id, "text": message},
                    timeout=10,
                )
                if r.status_code == 429:
                    await asyncio.sleep(60)
                    await client.post(
                        f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
                        json={"chat_id": chat_id, "text": message},
                        timeout=10,
                    )
            except Exception as e:
                errors.append(f"chat {chat_id}: {e}")

    _alerts_this_hour.append(now)
    _audit("alert_sent", severity, {"text_preview": text[:120], "recipients": TELEGRAM_CHAT_IDS}, alerted=True)

    if errors:
        print(f"[Pulse] Telegram errors: {errors}")

# ── Perception functions ──────────────────────────────────────────────────────

async def perceive_paid_orders(client: httpx.AsyncClient, last_check: str) -> list[dict]:
    """SSL @protocols#payment_watch: status=paid, paid_at > last_check."""
    return await _supa_get(client, "orders", {
        "select": "id,merchant_id,usdc_amount,brl_amount,tx_hash,paid_at,subscription_id,status,merchants(display_name)",
        "status": "eq.paid",
        "paid_at": f"gt.{last_check}",
        "order": "paid_at.asc",
    })

async def perceive_underpaid_orders(client: httpx.AsyncClient, last_check: str) -> list[dict]:
    """SSL @protocols#payment_watch: underpaid → CRITICAL.
    Note: orders.updated_at doesn't exist; reconciler sets paid_at=null on
    underpaid. We track via created_at + a separate cursor (last_underpaid_check)
    and dedupe by id within the audit chain."""
    return await _supa_get(client, "orders", {
        "select": "id,merchant_id,usdc_amount,brl_amount,tx_hash,paid_at,subscription_id,status,created_at,merchants(display_name)",
        "status": "eq.underpaid",
        "created_at": f"gt.{last_check}",
        "order": "created_at.asc",
    })

async def perceive_overdue_subscriptions(client: httpx.AsyncClient) -> list[dict]:
    """SSL @protocols#subscription_health: status=active, next_charge_at < now()-buffer."""
    return await _supa_get(client, "subscriptions", {
        "select": "id,external_ref,brl_amount,asset_code,next_charge_at,charges_done,max_periods,created_at,merchants(display_name)",
        "status": "eq.active",
        "next_charge_at": f"lt.{host_now_minus_buffer_iso()}",
        "order": "next_charge_at.asc",
        "limit": "20",  # adversarial battery B8: cap burst
    })

async def perceive_dead_webhooks(client: httpx.AsyncClient, last_check: str) -> list[dict]:
    return await _supa_get(client, "webhook_deliveries", {
        "select": "id,order_id,type,attempt_n,last_attempt_at",
        "status": "eq.dead",
        "last_attempt_at": f"gt.{last_check}",
        "order": "last_attempt_at.asc",
    })

async def perceive_horizon() -> dict[str, dict]:
    results: dict[str, dict] = {}
    async with httpx.AsyncClient() as client:
        for network, url in HORIZON_URLS.items():
            t0 = time.monotonic()
            try:
                resp = await client.get(url, timeout=5)
                latency_ms = int((time.monotonic() - t0) * 1000)
                results[network] = {
                    "ok": resp.status_code == 200,
                    "latency_ms": latency_ms,
                    "status_code": resp.status_code,
                }
            except Exception as e:
                results[network] = {"ok": False, "latency_ms": None, "error": str(e)}
            _audit("horizon_check", "INFO", {"network": network, "result": results[network]})
    return results

async def build_daily_report() -> str:
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    async with httpx.AsyncClient() as client:
        paid = await _supa_get(client, "orders", {
            "select": "usdc_amount",
            "status": "eq.paid",
            "paid_at": f"gt.{since}",
        })
        active_subs = await _supa_get(client, "subscriptions", {
            "select": "id,next_charge_at",
            "status": "eq.active",
        })
        dead_wh = await _supa_get(client, "webhook_deliveries", {
            "select": "id",
            "status": "eq.dead",
            "last_attempt_at": f"gt.{since}",
        })

    now = datetime.now(timezone.utc)
    total_usdc = sum(float(o["usdc_amount"]) for o in paid)
    overdue = [s for s in active_subs if s["next_charge_at"] < now.isoformat()]

    # value_ratio hint — read recent audit
    return (
        f"Pulse · Daily Report\n"
        f"\n"
        f"Payments (24h):        {len(paid)} orders / {total_usdc:.4f} USDC\n"
        f"Subscriptions active:  {len(active_subs)} / {len(overdue)} overdue\n"
        f"Dead webhooks (24h):   {len(dead_wh)}\n"
        f"\n"
        f"{now.strftime('%Y-%m-%d %H:%M UTC')}"
    )

# ── Cognitive cycles ──────────────────────────────────────────────────────────

async def cycle_payments(state: dict) -> None:
    async with httpx.AsyncClient() as client:
        paid     = await perceive_paid_orders(client, state["last_payment_check"])
        underpaid = await perceive_underpaid_orders(client, state["last_underpaid_check"])

    for p in paid:
        merchant = (p.get("merchants") or {}).get("display_name", "unknown")
        usdc = float(p["usdc_amount"])
        tx = (p.get("tx_hash") or "")[:16] or "no-hash"

        if usdc >= 1000:
            severity, label = "CRITICAL", "Large payment"
        elif usdc >= 100:
            severity, label = "WARNING", "Payment received"
        else:
            severity, label = "INFO", "Payment received"

        lines = [
            label,
            f"Merchant: {merchant}",
            f"Amount:   {usdc:.4f} USDC (R${p['brl_amount']})",
            f"Tx:       {tx}",
            f"Order:    {p['id'][:8]}",
        ]
        if p.get("subscription_id"):
            lines.append("[recurring charge]")

        await send_alert("\n".join(lines), severity)
        _audit("payment_detected", severity, {
            "order_id": p["id"], "usdc_amount": usdc, "merchant": merchant,
        }, alerted=True)

    for p in underpaid:
        merchant = (p.get("merchants") or {}).get("display_name", "unknown")
        usdc = float(p["usdc_amount"])
        lines = [
            "Underpaid order — manual reconcile required",
            f"Merchant: {merchant}",
            f"Amount:   {usdc:.4f} USDC (R${p['brl_amount']})",
            f"Order:    {p['id'][:8]}",
            f"Created:  {p.get('created_at', 'unknown')}",
            "Action:   investigate buyer-side payment vs expected amount",
        ]
        await send_alert("\n".join(lines), "CRITICAL")
        _audit("payment_underpaid", "CRITICAL", {
            "order_id": p["id"], "usdc_amount": usdc, "merchant": merchant,
        }, alerted=True)

    if paid:
        state["last_payment_check"] = paid[-1]["paid_at"]
    if underpaid:
        state["last_underpaid_check"] = underpaid[-1]["created_at"]
    if paid or underpaid:
        save_state(state)

async def cycle_subscriptions(state: dict) -> None:
    async with httpx.AsyncClient() as client:
        overdue = await perceive_overdue_subscriptions(client)

    for sub in overdue:
        merchant = (sub.get("merchants") or {}).get("display_name", "unknown")
        due_dt = datetime.fromisoformat(sub["next_charge_at"].replace("Z", "+00:00"))
        overdue_hours = (datetime.now(timezone.utc) - due_dt).total_seconds() / 3600

        if overdue_hours > 24:
            severity = "CRITICAL"
        elif overdue_hours > 6:
            severity = "CRITICAL"
        else:
            severity = "WARNING"

        charges_info = str(sub["charges_done"])
        if sub.get("max_periods"):
            charges_info += f" / {sub['max_periods']}"

        lines = [
            "Subscription overdue — charge needed",
            f"Merchant: {merchant}",
            f"Sub:      {sub['id'][:8]}",
            f"Amount:   R${sub['brl_amount']} {sub['asset_code']}",
            f"Due:      {sub['next_charge_at']}",
            f"Charges:  {charges_info}",
            f"Overdue:  {overdue_hours:.1f}h",
            f"Action:   POST /v1/subscriptions/{sub['id']}/charge",
        ]
        await send_alert("\n".join(lines), severity)
        _audit("subscription_overdue", severity, {
            "sub_id": sub["id"], "merchant": merchant, "overdue_hours": round(overdue_hours, 1),
        }, alerted=True)

    state["last_subscription_check"] = datetime.now(timezone.utc).isoformat()
    save_state(state)

async def cycle_webhooks(state: dict) -> None:
    async with httpx.AsyncClient() as client:
        dead = await perceive_dead_webhooks(client, state["last_webhook_check"])

    severity = "CRITICAL" if len(dead) > 3 else "WARNING"

    for wh in dead:
        lines = [
            "Webhook dead — merchant unreachable",
            f"Order:    {wh['order_id'][:8]}",
            f"Event:    {wh['type']}",
            f"Attempts: {wh['attempt_n']}",
            f"Last try: {wh.get('last_attempt_at', 'unknown')}",
            "Action:   check merchant webhook URL and retry manually",
        ]
        await send_alert("\n".join(lines), severity)
        _audit("webhook_dead", severity, {"wh_id": wh["id"], "order_id": wh["order_id"]}, alerted=True)

    if dead:
        state["last_webhook_check"] = dead[-1].get("last_attempt_at") or datetime.now(timezone.utc).isoformat()
        save_state(state)

async def cycle_horizon(state: dict) -> None:
    health = await perceive_horizon()
    now = datetime.now(timezone.utc).isoformat()

    for network, result in health.items():
        prev_status = state["horizon"][network]["status"]

        if not result["ok"]:
            state["horizon"][network]["status"] = "down"
            save_state(state)

            error = result.get("error") or f"HTTP {result.get('status_code')}"
            lines = [
                f"Horizon DOWN — {network}",
                f"Error:  {error}",
                "Impact: payment confirmations halted",
                "Action: check https://status.stellar.org",
            ]
            await send_alert("\n".join(lines), "CRITICAL")
            _audit("horizon_down", "CRITICAL", {"network": network, "error": error}, alerted=True)
        else:
            latency_ms = result["latency_ms"]
            state["horizon"][network]["status"] = "ok"
            state["horizon"][network]["last_ok"] = now
            save_state(state)

            if prev_status == "down":
                # RESOLVED severity → INFO (recovery is good news, don't noise-bomb)
                await send_alert(
                    f"Horizon RECOVERED — {network}\nLatency: {latency_ms}ms",
                    "INFO",
                )
                _audit("horizon_recovered", "INFO", {"network": network, "latency_ms": latency_ms}, alerted=True)
            elif latency_ms > HORIZON_LATENCY_THRESHOLD_MS:
                await send_alert(
                    f"Horizon slow — {network}\nLatency: {latency_ms}ms (threshold {HORIZON_LATENCY_THRESHOLD_MS}ms)",
                    "WARNING",
                )
                _audit("horizon_slow", "WARNING", {"network": network, "latency_ms": latency_ms}, alerted=True)

# ── Main loop ─────────────────────────────────────────────────────────────────

class PulseCognitiveCycle:
    def __init__(self) -> None:
        self.state = load_state()
        self._t_payment      = 0.0
        self._t_subscription = 0.0
        self._t_webhook      = 0.0
        self._t_horizon      = 0.0
        self._consecutive_errors = 0

    async def run(self) -> None:
        print("[Pulse] Starting — payment intelligence active")
        _audit("startup", "INFO", {
            "chat_ids": TELEGRAM_CHAT_IDS,
            "supabase_url": SUPABASE_URL,
            "backfill_hours": PULSE_BACKFILL_HOURS,
            "drift_buffer_s": CLOCK_DRIFT_BUFFER_S,
        })

        # Startup: check clock skew (B10 visibility) + send hello
        async with httpx.AsyncClient() as client:
            await check_clock_skew(client)
        await send_alert("Pulse started. Payment monitoring active.", "INFO")

        while True:
            now_mono = time.monotonic()
            now_utc  = datetime.now(timezone.utc)

            try:
                if now_mono - self._t_payment >= PAYMENT_INTERVAL:
                    await cycle_payments(self.state)
                    self._t_payment = now_mono

                if now_mono - self._t_subscription >= SUBSCRIPTION_INTERVAL:
                    await cycle_subscriptions(self.state)
                    self._t_subscription = now_mono

                if now_mono - self._t_webhook >= WEBHOOK_INTERVAL:
                    await cycle_webhooks(self.state)
                    self._t_webhook = now_mono

                if now_mono - self._t_horizon >= HORIZON_INTERVAL:
                    await cycle_horizon(self.state)
                    self._t_horizon = now_mono

                today = now_utc.date().isoformat()
                if brt_hour_now() == DAILY_REPORT_HOUR_BRT and self.state.get("last_daily_report") != today:
                    report = await build_daily_report()
                    await send_alert(report, "INFO")
                    self.state["last_daily_report"] = today
                    save_state(self.state)

                self._consecutive_errors = 0
            except Exception as e:
                self._consecutive_errors += 1
                tb = traceback.format_exc(limit=3)
                _audit("error", "WARNING", {"exception": str(e), "traceback": tb})
                print(f"[Pulse] Error: {e}")

                if self._consecutive_errors > 5:
                    await send_alert(
                        f"Pulse: {self._consecutive_errors} consecutive errors — may need restart\nLast: {e}",
                        "WARNING",
                    )
                    await asyncio.sleep(300)
                else:
                    await asyncio.sleep(30)
                continue

            await asyncio.sleep(10)


if __name__ == "__main__":
    acquire_advisory_lock()
    try:
        asyncio.run(PulseCognitiveCycle().run())
    except KeyboardInterrupt:
        print("\n[Pulse] Stopped by signal.")
