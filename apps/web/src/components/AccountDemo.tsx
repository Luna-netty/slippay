// AccountDemo — first contact + DNA. A looping iPhone that matches the real app
// (see /pay): light account + confirm screens, then the screen goes DARK for the
// secure payment — champagne-gold "Paid." with an on-chain receipt. Authenticate
// with a passkey (biometrics), see your balance, pay 0.05 with one touch, get proof.
// Decorative: the real WebAuthn prompt is the OS modal; this visualizes the flow.
import { useEffect, useState } from "react";
import { FaceScan } from "./FaceScan.tsx";

type Lang = "pt" | "en";
const YELLOW = "#FDDA24";
const GOLD = "#cabfb0";
const DARK_BG = "linear-gradient(160deg,#15151a 0%,#0a0a0c 55%,#101013 100%)";
const WALLET = "CA6K…VSRHP";
const TO = "GCEY…242P";
const FROM = "CDPH…MJVL";
const TX = "5da9741f";

const T = {
  pt: {
    badge: "sua conta, ao vivo · ~10s",
    title: "Conta em dólar", sub: "em segundos", btn: "Criar com biometria", alt: "ou Google",
    authing: "Autenticando · biometria", authed: "Autenticado", created: "Conta criada",
    hi: "sua conta", since: "desde 06/06/2026", balLabel: "saldo em dólar",
    add: "Adicionar · Pix → dólar", pay: "Pagar", receive: "Receber", withdraw: "Sacar", live: "Ao vivo",
    confirmL: "confirmar pagamento", to: "para", authorize: "Autorize com um toque", cancel: "Cancelar", authorizing: "Autorizando…",
    secure: "slippay · seguro", net: "Stellar · mainnet",
    paid: "Pago.", paidSub: "movido on-chain · só o seu toque autorizou",
    receipt: "recibo", verified: "✓ verificado on-chain",
    rAmount: "Valor", rTo: "Para", rFrom: "De", rFromV: "sua carteira · " + FROM, rNet: "Rede", rNetV: "Stellar mainnet",
  },
  en: {
    badge: "your account, live · ~10s",
    title: "Dollar account", sub: "in seconds", btn: "Create with biometrics", alt: "or Google",
    authing: "Authenticating · biometrics", authed: "Authenticated", created: "Account created",
    hi: "your account", since: "since 06/06/2026", balLabel: "dollar balance",
    add: "Add money · Pix → dollars", pay: "Pay", receive: "Get paid", withdraw: "Withdraw", live: "Live",
    confirmL: "confirm payment", to: "to", authorize: "Authorize with a touch", cancel: "Cancel", authorizing: "Authorizing…",
    secure: "slippay · secure", net: "Stellar · mainnet",
    paid: "Paid.", paidSub: "moved on-chain · only your touch authorized it",
    receipt: "receipt", verified: "✓ verified on-chain",
    rAmount: "Amount", rTo: "To", rFrom: "From", rFromV: "your wallet · " + FROM, rNet: "Network", rNetV: "Stellar mainnet",
  },
} as const;

const STEPS = [
  { key: "intro", ms: 2000 },
  { key: "tap", ms: 620 },
  { key: "scan", ms: 2000 },
  { key: "done", ms: 950 },
  { key: "created", ms: 1700 },
  { key: "home", ms: 2700 },
  { key: "confirm", ms: 2500 },
  { key: "authorizing", ms: 1500 },
  { key: "paid", ms: 4200 },
] as const;

export function AccountDemo({ lang = "pt" }: { lang?: Lang }) {
  const t = T[lang];
  const [i, setI] = useState(0);
  const cur = STEPS[i] ?? STEPS[0];
  useEffect(() => {
    const id = setTimeout(() => setI((p) => (p + 1) % STEPS.length), cur.ms);
    return () => clearTimeout(id);
  }, [i, cur.ms]);
  const step = cur.key;
  const dark = step === "authorizing" || step === "paid";

  const lblL = "font-mono text-[10px] uppercase tracking-[0.22em] text-[#0a0a0a]/45";
  const Row = ({ k, v, d }: { k: string; v: string; d: number }) => (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-t border-[#f1eee7]/10 first:border-0 acct-row" style={{ animationDelay: `${d}ms` }}>
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#f1eee7]/40">{k}</span>
      <span className="font-mono text-[10px] text-[#f1eee7]/85 text-right break-all">{v}</span>
    </div>
  );

  return (
    <div className="mx-auto w-[286px] max-w-full">
      <div className="relative">
        <span className="absolute -left-[3px] top-[112px] h-7 w-[3px] rounded-l bg-[#0a0a0a]" />
        <span className="absolute -left-[3px] top-[156px] h-12 w-[3px] rounded-l bg-[#0a0a0a]" />
        <span className="absolute -left-[3px] top-[214px] h-12 w-[3px] rounded-l bg-[#0a0a0a]" />
        <span className="absolute -right-[3px] top-[176px] h-16 w-[3px] rounded-r bg-[#0a0a0a]" />

        <div className="relative rounded-[48px] bg-[#161616] p-[11px] ring-1 ring-white/15 shadow-[0_50px_100px_-30px_rgba(0,0,0,0.7),0_0_70px_-18px_rgba(255,255,255,0.18)]">
          <div className="pointer-events-none absolute inset-[3px] rounded-[45px] ring-1 ring-white/20" />
          <div className="relative rounded-[38px] overflow-hidden aspect-[9/19.4] transition-colors duration-500"
            style={dark ? { background: DARK_BG } : { background: "#f1eee7" }}>
            <div className={"absolute top-0 left-0 right-0 z-40 flex items-center justify-between px-8 pt-[20px] " + (dark ? "text-[#f1eee7]" : "text-[#0a0a0a]")}>
              <span className="text-[11px] font-semibold tracking-tight">9:41</span>
              <span className="flex items-center gap-1.5"><Wifi /><Battery /></span>
            </div>
            <div className="absolute top-[13px] left-1/2 -translate-x-1/2 z-30 h-[22px] w-[58px] rounded-full bg-[#0a0a0a]" />
            <div className="pointer-events-none absolute inset-0 z-30" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 42%)" }} />

            <div key={step} className="absolute inset-0 px-7 pt-[58px] pb-9 text-[#0a0a0a]">
              {(step === "intro" || step === "tap") && (
                <div className="h-full flex flex-col items-center acct-stagger">
                  <div className="text-[15px] lowercase tracking-[-0.03em]" style={{ fontWeight: 800 }}>slippay<span style={{ color: YELLOW }}>.</span></div>
                  <div className="mt-auto w-full">
                    <div className={"w-full rounded-2xl text-[#0a0a0a] py-4 flex items-center justify-center gap-2.5 text-[13px] font-semibold transition-transform duration-150 " + (step === "tap" ? "scale-[0.95]" : "")} style={{ background: YELLOW }}>
                      <FaceGlyph /> {t.btn}
                    </div>
                    <div className={"mt-3 text-center " + lblL}>{t.alt}</div>
                  </div>
                </div>
              )}

              {(step === "scan" || step === "done") && (
                <div className="h-full flex flex-col items-center justify-center">
                  <div className="relative grid place-items-center">
                    {step === "done" && <span className="absolute w-[120px] h-[120px] rounded-full acct-ring" style={{ border: `2px solid ${YELLOW}` }} />}
                    <FaceScan state={step === "done" ? "done" : "scanning"} />
                  </div>
                  <div className="mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-[#0a0a0a]/60">{step === "done" ? t.authed : t.authing}</div>
                </div>
              )}

              {step === "created" && (
                <div className="h-full flex flex-col items-center justify-center acct-stagger">
                  <Check c={YELLOW} />
                  <div className="mt-5 text-[15px] font-bold tracking-[-0.02em]">{t.created}</div>
                  <div className={"mt-4 " + lblL}>{t.balLabel}</div>
                  <div className="text-[42px] font-black tracking-[-0.03em] tabular-nums leading-none">$0.00</div>
                </div>
              )}

              {step === "home" && (
                <div className="h-full flex flex-col acct-stagger">
                  <div className="flex items-center justify-between">
                    <span className={lblL}>{t.hi}</span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#0a0a0a]/40 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: YELLOW }} />{t.live}</span>
                  </div>
                  <div className="mt-4 font-mono text-[11px] text-[#0a0a0a]/55 tracking-tight">{WALLET}</div>
                  <div className="mt-5">
                    <div className={lblL}>{t.balLabel}</div>
                    <div className="text-[44px] font-black tracking-[-0.03em] tabular-nums leading-none">$0.00</div>
                    <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#0a0a0a]/35">{t.since}</div>
                  </div>
                  <div className="mt-auto flex flex-col gap-2.5">
                    <div className="w-full rounded-2xl text-[#0a0a0a] py-3.5 text-center text-[12px] font-semibold" style={{ background: YELLOW }}>{t.add}</div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="rounded-2xl bg-[#0a0a0a] text-[#f1eee7] py-3 text-center text-[11px] font-semibold">{t.pay}</div>
                      <div className="rounded-2xl py-3 text-center text-[11px] font-semibold text-[#0a0a0a]" style={{ background: YELLOW }}>{t.receive}</div>
                      <div className="rounded-2xl border border-[#0a0a0a]/25 py-3 text-center text-[11px] font-semibold">{t.withdraw}</div>
                      <div className="rounded-2xl border border-[#0a0a0a]/25 py-3 text-center text-[11px] font-semibold">{t.live}</div>
                    </div>
                  </div>
                </div>
              )}

              {step === "confirm" && (
                <div className="h-full flex flex-col justify-center acct-stagger">
                  <div className="rounded-2xl border-2 border-[#0a0a0a] p-6">
                    <div className={lblL}>{t.confirmL}</div>
                    <div className="mt-3 text-[44px] font-black tracking-[-0.03em] tabular-nums leading-none">$200</div>
                    <div className="mt-3 font-mono text-[11px] text-[#0a0a0a]/55">{t.to} {TO}</div>
                    <div className="mt-6 w-full rounded-full text-[#0a0a0a] py-3.5 flex items-center justify-center gap-2 text-[12px] font-semibold acct-breathe" style={{ background: YELLOW }}>
                      <FaceGlyph /> {t.authorize}
                    </div>
                    <div className={"mt-2 text-center " + lblL}>{t.cancel}</div>
                  </div>
                </div>
              )}

              {(step === "authorizing" || step === "paid") && (
                <div className="h-full flex flex-col text-[#f1eee7]">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#f1eee7]/55 flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: YELLOW }} />{t.secure}</span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#f1eee7]/40">{t.net}</span>
                  </div>

                  {step === "authorizing" ? (
                    <div className="flex-1 flex flex-col items-center justify-center">
                      <FaceScan state="scanning" />
                      <div className="mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-[#f1eee7]/55">{t.authorizing}</div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col justify-center acct-stagger">
                      <div className="flex flex-col items-center">
                        <FaceScan state="done" />
                        <div className="mt-3 text-[30px] font-black tracking-[-0.03em]" style={{ color: GOLD }}>{t.paid}</div>
                        <div className="text-[15px] font-bold tabular-nums text-[#f1eee7]/90">$200</div>
                        <div className="mt-1 font-mono text-[10px] text-[#f1eee7]/45 text-center max-w-[30ch]">{t.paidSub}</div>
                      </div>
                      <div className="mt-5 rounded-2xl border border-[#f1eee7]/12 bg-[#f1eee7]/[0.04] px-4 py-3">
                        <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.2em] text-[#f1eee7]/45">
                          <span>{t.receipt}</span><span style={{ color: GOLD }}>{t.verified}</span>
                        </div>
                        <div className="mt-2">
                          <Row k={t.rAmount} v="$200" d={420} />
                          <Row k={t.rTo} v={TO} d={500} />
                          <Row k={t.rFrom} v={t.rFromV} d={580} />
                          <Row k={t.rNet} v={t.rNetV} d={660} />
                          <Row k="Tx" v={`${TX} ↗`} d={740} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 text-center font-mono text-[10px] uppercase tracking-[0.28em] text-[#0a0a0a]/45">{t.badge}</div>

      <style>{`
        @keyframes acctProg{from{width:0%}to{width:100%}}
        @keyframes acctRise{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}
        @keyframes acctRing{from{opacity:.6;transform:scale(.55)}to{opacity:0;transform:scale(1.25)}}
        @keyframes acctPop{0%{transform:scale(.5);opacity:0}60%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}
        @keyframes acctBreathe{0%,100%{box-shadow:0 0 0 0 rgba(253,218,36,0)}50%{box-shadow:0 0 0 7px rgba(253,218,36,0.28)}}
        .acct-stagger>*{opacity:0;animation:acctRise .55s cubic-bezier(.2,.7,.2,1) forwards}
        .acct-stagger>*:nth-child(1){animation-delay:.05s}.acct-stagger>*:nth-child(2){animation-delay:.13s}
        .acct-stagger>*:nth-child(3){animation-delay:.21s}.acct-stagger>*:nth-child(4){animation-delay:.29s}
        .acct-stagger>*:nth-child(5){animation-delay:.37s}
        .acct-row{opacity:0;animation:acctRise .5s cubic-bezier(.2,.7,.2,1) forwards}
        .acct-ring{animation:acctRing .8s ease-out forwards}
        .acct-breathe{animation:acctBreathe 1.6s ease-in-out infinite}
        @media (prefers-reduced-motion:reduce){
          [style*="acctProg"]{animation:none!important;width:100%!important}
          .acct-stagger>*,.acct-row{animation:none!important;opacity:1!important}
          .acct-ring,.acct-breathe{animation:none!important}
        }
      `}</style>
    </div>
  );
}

function Check({ c }: { c: string }) {
  return (
    <div className="w-12 h-12 rounded-full grid place-items-center" style={{ background: c, animation: "acctPop .5s cubic-bezier(.2,.8,.2,1) both" }}>
      <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="#0a0a0a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
    </div>
  );
}
function FaceGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="#0a0a0a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M9 10v1M15 10v1M12 10v3M9.5 15.5a3.5 3.5 0 0 0 5 0" />
    </svg>
  );
}
function Wifi() {
  return <svg viewBox="0 0 16 12" className="w-[15px] h-[11px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M1 4.2a10 10 0 0 1 14 0" /><path d="M3.5 6.8a6.4 6.4 0 0 1 9 0" /><circle cx="8" cy="10" r="1" fill="currentColor" stroke="none" /></svg>;
}
function Battery() {
  return (
    <span className="flex items-center gap-[2px]">
      <span className="relative inline-block w-[22px] h-[11px] rounded-[3px] border border-current opacity-90">
        <span className="absolute inset-[1.5px] right-[5px] rounded-[1px] bg-current" />
      </span>
      <span className="inline-block w-[1.5px] h-[4px] rounded-r bg-current opacity-60" />
    </span>
  );
}
