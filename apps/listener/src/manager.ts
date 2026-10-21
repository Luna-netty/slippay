import type { SupabaseClient } from "@supabase/supabase-js";
import { watchAccount } from "./horizon.js";
import { log } from "./log.js";
import { config } from "./config.js";
import { acquireLease } from "./lease.js";

interface Active { stop: () => void; releaseLease: () => Promise<void>; }

export function startManager(db: SupabaseClient) {
  const active = new Map<string, Active>();

  async function tick() {
    // Only watch merchants on the same network this listener streams (audit:
    // a testnet merchant left active would otherwise stream-error forever on a
    // mainnet listener). Fail-closed: a row with a null/other network is skipped.
    const { data, error } = await db.from("merchants").select("stellar_address").eq("active", true).eq("network", config.merchantNetwork).not("stellar_address", "is", null);
    if (error) { log("error", "manager_query_failed", { error: error.message }); return; }
    const desired = new Set((data ?? []).map(r => r.stellar_address as string));

    for (const addr of desired) {
      if (!active.has(addr)) {
        // audit-003 L2: serialize watchAccount on a per-account lease so two
        // pods can never run Horizon streams against the same merchant.
        const lease = await acquireLease(db, addr);
        if (!lease.acquired) {
          log("info", "manager_lease_held_elsewhere", { addr, heldBy: lease.heldBy, expiresAt: lease.expiresAt });
          continue;
        }
        try {
          const stop = await watchAccount({ db, network: config.network, accountId: addr });
          active.set(addr, { stop, releaseLease: lease.release });
          log("info", "manager_started", { addr });
        } catch (e) {
          log("error", "manager_start_failed", { addr, error: String(e) });
          await lease.release();
        }
      }
    }
    for (const addr of [...active.keys()]) {
      if (!desired.has(addr)) {
        const a = active.get(addr);
        a?.stop();
        await a?.releaseLease();
        active.delete(addr);
        log("info", "manager_stopped", { addr });
      }
    }
  }

  tick();
  const id = setInterval(tick, config.merchantPollMs);

  return async () => {
    clearInterval(id);
    for (const a of active.values()) {
      a.stop();
      await a.releaseLease();
    }
    active.clear();
  };
}
