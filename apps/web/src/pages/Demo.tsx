import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo.tsx";

declare global {
  interface Window {
    Slippay?: {
      version: string;
      open: (opts: {
        orderId: string;
        env?: string;
        onPaid?: (e: { txHash?: string; orderId?: string }) => void;
        onCancelled?: () => void;
        onExpired?: () => void;
        onError?: (e: { message?: string }) => void;
      }) => { close: () => void };
    };
  }
}

interface LogEntry { ts: string; type: string; payload?: unknown }

export default function Demo() {
  const [orderId, setOrderId] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [sdkReady, setSdkReady] = useState<boolean>(typeof window !== "undefined" && !!window.Slippay);
  const scriptInjected = useRef(false);

  useEffect(() => {
    if (scriptInjected.current) return;
    if (window.Slippay) { setSdkReady(true); return; }
    scriptInjected.current = true;
    const s = document.createElement("script");
    s.src = "/sdk.js";
    s.async = true;
    s.onload = () => setSdkReady(true);
    document.head.appendChild(s);
  }, []);

  function log(type: string, payload?: unknown) {
    setLogs(prev => [{ ts: new Date().toISOString().slice(11, 19), type, payload }, ...prev].slice(0, 12));
  }

  function openCheckout() {
    if (!window.Slippay) { log("sdk:not-loaded"); return; }
    if (!orderId.trim()) { log("error", { message: "orderId is required" }); return; }
    log("Slippay.open", { orderId });
    window.Slippay.open({
      orderId: orderId.trim(),
      env: window.location.origin,
      onPaid: (e) => log("slippay:paid", e),
      onCancelled: () => log("slippay:cancelled"),
      onExpired: () => log("slippay:expired"),
      onError: (e) => log("slippay:error", e),
    });
  }

  return (
    <div className="min-h-screen bg-[#f1eee7] text-[#0a0a0a]">
      <header className="max-w-[1400px] mx-auto px-8 md:px-12 py-8 flex items-center justify-between">
        <Logo />
        <Link to="/" className="text-[10px] uppercase tracking-[0.22em] hover:opacity-60">← Back</Link>
      </header>

      <main className="max-w-[1400px] mx-auto px-8 md:px-12 py-12 grid md:grid-cols-12 gap-8 md:gap-16">
        <div className="md:col-span-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55">
          ┃ SDK Demo
        </div>

        <div className="md:col-span-9">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-4 tabular-nums">
            006 · Drop-in checkout
          </div>
          <h1 className="text-4xl md:text-6xl font-medium tracking-[-0.04em] leading-[0.95] max-w-[20ch]">
            Two lines of <em className="font-light">JavaScript</em>.
          </h1>
          <p className="mt-8 text-lg text-[#0a0a0a]/75 max-w-[60ch] leading-[1.6]">
            Backend creates the order with your API key. Frontend calls
            <code className="font-mono px-1 mx-1 bg-[#0a0a0a]/5">Slippay.open()</code>
            with the returned id and a callback. SlipPay renders the modal,
            handles wallet flow, posts back when paid.
          </p>

          <div className="mt-12 grid md:grid-cols-2 gap-px bg-[#0a0a0a]/15 border border-[#0a0a0a]/15">
            <pre className="bg-[#0a0a0a] text-[#f1eee7] p-6 text-xs leading-[1.6] overflow-auto"><code>{`// 1. Server (your backend)
const r = await fetch("https://api.slippay.app/v1/orders", {
  method: "POST",
  headers: {
    authorization: "Bearer sk_live_...",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    brl_amount: "99.90",
    external_ref: "cart_42",
  }),
});
const { order } = await r.json();
// → return order.id to the browser`}</code></pre>
            <pre className="bg-[#0a0a0a] text-[#f1eee7] p-6 text-xs leading-[1.6] overflow-auto"><code>{`// 2. Browser (your checkout page)
<script src="https://app.slippay.app/sdk.js"></script>
<script>
  Slippay.open({
    orderId: "<order.id from step 1>",
    onPaid: ({ txHash }) => {
      window.location.href = "/thanks";
    },
    onCancelled: () => { /* user closed modal */ },
    onExpired:   () => { /* 30 min lapsed */ },
  });
</script>`}</code></pre>
          </div>

          {/* Live demo */}
          <div className="mt-16 border-t border-[#0a0a0a]/15 pt-12 grid md:grid-cols-12 gap-8">
            <div className="md:col-span-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-3 tabular-nums">
                Try it ▾
              </div>
              <p className="text-sm text-[#0a0a0a]/75 max-w-[40ch] leading-[1.6]">
                Paste an order id (created via the API or dashboard) and open the modal.
                Events from the iframe will print in the log on the right.
              </p>
              <label className="block mt-8">
                <span className="text-[10px] uppercase tracking-[0.18em] text-[#0a0a0a]/55 block mb-2">Order id</span>
                <input
                  value={orderId}
                  onChange={e => setOrderId(e.target.value)}
                  placeholder="ord_... or UUID"
                  className="w-full bg-transparent border-b border-[#0a0a0a]/30 py-3 font-mono text-sm focus:outline-none focus:border-[#0a0a0a]"
                />
              </label>
              <button
                onClick={openCheckout}
                disabled={!sdkReady || !orderId.trim()}
                className="mt-8 w-full bg-[#0a0a0a] text-[#f1eee7] py-4 text-[11px] uppercase tracking-[0.22em] hover:bg-[#1a1a1a] disabled:opacity-40">
                {sdkReady ? "Open checkout" : "Loading SDK..."}
              </button>
              <div className="mt-3 text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 font-mono">
                SDK status: {sdkReady ? <span className="text-[#0a0a0a]"><span className="inline-block w-1.5 h-1.5 bg-[#FDDA24] mr-1.5 align-middle" />Loaded</span> : "Loading..."}
              </div>
            </div>

            <div className="md:col-span-7">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/55 mb-3">
                Event log
              </div>
              <div className="bg-[#0a0a0a] text-[#f1eee7] p-4 min-h-[300px] max-h-[400px] overflow-auto font-mono text-xs leading-[1.7]">
                {logs.length === 0
                  ? <div className="text-[#f1eee7]/40">// no events yet · open checkout to start</div>
                  : logs.map((l, i) => (
                    <div key={i} className="border-b border-[#f1eee7]/10 pb-2 mb-2">
                      <span className="text-[#f1eee7]/55">{l.ts}</span>
                      <span className={`ml-3 ${l.type.includes("paid") ? "text-[#FDDA24]" : l.type.includes("error") ? "text-red-400" : "text-[#f1eee7]"}`}>{l.type}</span>
                      {l.payload != null && <pre className="mt-1 text-[#f1eee7]/70 text-[11px]">{JSON.stringify(l.payload, null, 2)}</pre>}
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
