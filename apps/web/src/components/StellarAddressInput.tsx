// Reusable Stellar receive-address field with live Horizon validation.
//
// Guards the #1 onboarding silent-failure: a merchant pastes a malformed /
// unfunded / trustline-less address, it saves clean, then EVERY payment fails
// at settlement (recipient_drift / unfunded destination). This surfaces the
// problem at input time. Format-invalid is a hard signal (parent blocks save);
// no-account / no-trustline are warnings (Horizon can be flaky, trustline can
// be added later).
//
// Security note: this only EDITS the address on an account the signed-in user
// owns. Setting "where money lands" stays behind account ownership — there is
// no anonymous link that sets a third party's address (that would be the exact
// recipient-redirection hole the settlement guard exists to prevent).

import { useEffect, useState } from "react";
import { getChainAdapter, type AddressCheck } from "../lib/chain/index.ts";
import { chainId } from "../lib/chain/validate.ts";

export function StellarAddressInput({
  value,
  onChange,
  network,
  label = "Stellar receive address",
  hint = "Where your dollars (USDC) land. Sign-in with your face — no seed phrase.",
}: {
  value: string;
  onChange: (v: string) => void;
  network: "TESTNET" | "PUBLIC";
  label?: string;
  hint?: string;
}) {
  const [check, setCheck] = useState<AddressCheck | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const a = value.trim();
    if (a === "") { setCheck(null); setChecking(false); return; }
    setChecking(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const adapter = await getChainAdapter();
        const c = await adapter.checkReceiveAddress(a);
        if (!cancelled) setCheck(c);
      } catch {
        if (!cancelled) setCheck({ validFormat: true, accountExists: null, hasUsdcTrustline: null });
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [value, network]);

  return (
    <div>
      <span className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 block mb-2">{label}</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="GABC..."
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="w-full bg-transparent border-b border-[#0a0a0a]/30 py-3 font-mono text-sm tracking-tight focus:outline-none focus:border-[#0a0a0a] transition-colors"
      />
      {hint && <p className="text-xs text-[#0a0a0a]/55 mt-2">{hint}</p>}
      <Status address={value} network={network} checking={checking} check={check} />
    </div>
  );
}

function Status({ address, network, checking, check }: {
  address: string; network: "TESTNET" | "PUBLIC"; checking: boolean; check: AddressCheck | null;
}) {
  if (address.trim() === "") return null;

  const GREEN = "#3f7d20", RED = "#b91c1c", AMBER = "#b45309", MUTED = "rgba(10,10,10,0.55)";
  let dot = MUTED, color = MUTED, text = "";

  if (checking) {
    text = `Checking on ${network.toLowerCase()}…`;
  } else if (check && !check.validFormat) {
    dot = RED; color = RED; text = chainId() === "solana"
      ? "Not a valid Solana address."
      : "Not a valid Stellar address — must start with G and be 56 characters.";
  } else if (check && check.accountExists === false) {
    dot = AMBER; color = AMBER; text = `Account not found on ${network.toLowerCase()}. Fund it before it can receive payments.`;
  } else if (check && check.accountExists === null) {
    text = "Format valid · couldn't reach Horizon to verify the account.";
  } else if (check && check.accountExists && check.hasUsdcTrustline === false) {
    dot = AMBER; color = AMBER; text = "No USDC trustline — USDC payments will fail until you add one to this account.";
  } else if (check && check.accountExists && check.hasUsdcTrustline) {
    dot = GREEN; color = GREEN; text = "Valid · funded · USDC trustline present — ready to receive.";
  } else {
    return null;
  }

  return (
    <div className="flex items-start gap-2 mt-2" aria-live="polite">
      <span className="inline-block w-1.5 h-1.5 mt-1.5 shrink-0" style={{ background: dot }} />
      <span className="text-xs leading-relaxed" style={{ color }}>{text}</span>
    </div>
  );
}
