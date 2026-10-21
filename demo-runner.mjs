#!/usr/bin/env node
/**
 * SlipPay demo runner — deterministic, self-recording demo for the DoraHacks BUIDL.
 *
 * Drives a real browser over the LIVE app (app.slippay.cc), injects on-screen
 * captions + honest LIVE/roadmap badges, paces each scene, and records a clean
 * 1080p video. No OBS needed. Honest seam baked in: nothing testnet is labeled live.
 *
 * Run:   node demo-runner.mjs            # full ~2:45 take, records mp4
 *        FAST=1 node demo-runner.mjs     # quick smoke test (short dwells)
 *        BASE=http://localhost:5173 node demo-runner.mjs   # against local dev
 *
 * Output: ./demo-out/slippay-demo.mp4  (+ raw .webm)  and ./demo-out/narration.txt
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE || "https://app.slippay.cc";
const FAST = process.env.FAST === "1";
const OUT = join(process.cwd(), "demo-out");
const TX = "ede13fb6230334af91b2af1cfab92f86f8f44e8a7755acb57d92891d68a3e957"; // real mainnet tx
const W = 1920, H = 1080;
const s = (ms) => (FAST ? Math.max(600, Math.round(ms / 6)) : ms);

// scene: { path, ms, badge, type: 'live'|'road', caption, vo, scroll? }
const SCENES = [
  { card: "title", ms: 5000,
    caption: "SlipPay",
    sub: "The non-custodial dollar account — and the rail for bounded agent payments. Live on Stellar mainnet.",
    vo: "Two broken things: Brazilians can't hold dollars without a US bank, and nobody can safely let an AI agent pay. SlipPay fixes both on one non-custodial core, live on Stellar mainnet." },

  { path: "/", ms: 18000, badge: "LIVE · mainnet", type: "live", scroll: true,
    caption: "A dollar account that never holds your money",
    vo: "Non-custodial means the buyer's wallet signs funds straight to the recipient. SlipPay never holds money and never has signing power over yours." },

  { path: "/receber", ms: 21000, badge: "LIVE · mainnet", type: "live",
    caption: "Receive USDC by QR — final the instant the sender signs",
    vo: "Receive dollars by QR. The moment the sender signs, the money is yours on chain. No D+30, no chargeback, no processor in the middle." },

  { path: "/pay", ms: 24000, badge: "LIVE · mainnet", type: "live",
    caption: "Pay with Face / Touch ID — no seed phrase, relayer pays the gas",
    vo: "Pay with Face or Touch ID. No seed phrase, ever. A gas-sponsor relayer covers the network fee, so a user with dollars but no XLM still transacts. The smart wallet is a WebAuthn account on mainnet." },

  { path: `/comprovante/${TX}`, ms: 21000, badge: "LIVE · mainnet", type: "live",
    caption: "Every payment is a public transaction · ~5s · sub-cent fee",
    vo: "Every payment is a public transaction. Anyone can verify amount, parties and timestamp. Here is a real one. About five seconds, sub-cent fee." },

  { path: "/verify", ms: 13000, badge: "LIVE · mainnet", type: "live",
    caption: "Anyone can verify a payment or a cert — no login",
    vo: "Verification is open. No account, no login. Paste and check." },

  { path: "/agents", ms: 23000, badge: "LIVE · v0.4 rail", type: "live", scroll: true,
    caption: "Bounded agent payments: on-chain cap · allowlist · fail-closed + integrity attestation",
    vo: "For agents: an on-chain spending bound, per-transaction cap, recipient allowlist, fail-closed, plus a fail-closed integrity attestation. The kill-switch the forty-seven-thousand-dollar agent loop never had. Distributed as one MCP server." },

  { path: "/conformidade", ms: 15000, badge: "testnet · roadmap", type: "road", scroll: true,
    caption: "Deep adversarial detection + AXL offline proof of the bound = roadmap",
    vo: "The deep adversarial detection and the AXL offline proof of the spending bound are the frontier it is built to carry, on testnet today. We say so out loud." },

  { card: "end", ms: 8000,
    caption: "SlipPay",
    sub: "Non-custodial by architecture · built solo · live on Stellar mainnet\ngithub.com/Galmanus/slippay   ·   app.slippay.cc",
    vo: "SlipPay. Non-custodial by architecture. The dollar account that pays the bills today, the agent-payment rail that becomes the moat." },
];

const CARD_HTML = (title, sub) => `<!doctype html><html><head><meta charset=utf8>
<style>
  html,body{margin:0;height:100%;background:#0b0e14;overflow:hidden;font-family:Inter,Segoe UI,system-ui,sans-serif}
  .wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center}
  .t{font-size:130px;font-weight:800;letter-spacing:-2px;background:linear-gradient(90deg,#fff,#f5c451);-webkit-background-clip:text;background-clip:text;color:transparent}
  .s{margin-top:28px;font-size:34px;line-height:1.45;color:#c7cdd6;max-width:1300px;white-space:pre-line}
  .dot{margin-top:46px;color:#f5c451;font-size:22px;letter-spacing:3px;text-transform:uppercase}
</style></head><body><div class=wrap>
  <div class=t>${title}</div><div class=s>${sub}</div><div class=dot>Stellar · mainnet</div>
</div></body></html>`;

const overlayJS = (badge, type, caption, idx, total) => {
  const color = type === "live" ? "#16c784" : "#f5a623";
  const dot = type === "live" ? "●" : "▲";
  return `(() => {
    let o = document.getElementById('__demo_ov'); if(!o){o=document.createElement('div');o.id='__demo_ov';document.documentElement.appendChild(o);}
    o.innerHTML='';
    o.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:Inter,Segoe UI,system-ui,sans-serif';
    const bar=document.createElement('div');bar.style.cssText='position:fixed;top:0;left:0;height:5px;background:#f5c451;width:'+Math.round(${idx}/${total}*100)+'%;transition:width .6s';
    const badge=document.createElement('div');badge.style.cssText='position:fixed;top:22px;left:24px;background:rgba(11,14,20,.86);color:'+'${color}'+';border:1px solid '+'${color}'+';padding:9px 16px;border-radius:999px;font-weight:700;font-size:22px;letter-spacing:.3px;box-shadow:0 6px 24px rgba(0,0,0,.35)';badge.textContent='${dot} ${badge}';
    const cap=document.createElement('div');cap.style.cssText='position:fixed;left:0;right:0;bottom:0;padding:54px 60px 46px;background:linear-gradient(180deg,transparent,rgba(7,9,13,.92));color:#fff;font-size:40px;font-weight:700;line-height:1.3;text-shadow:0 2px 14px rgba(0,0,0,.6)';cap.textContent=${JSON.stringify(caption)};
    o.appendChild(bar);o.appendChild(badge);o.appendChild(cap);
  })();`;
};

const smoothScroll = (ms) => `(async()=>{const h=Math.max(0,document.body.scrollHeight-innerHeight);const t=${ms};const t0=performance.now();return await new Promise(r=>{function f(n){const p=Math.min(1,(n-t0)/t);const e=p<.5?2*p*p:1-Math.pow(-2*p+2,2)/2;scrollTo(0,h*e);p<1?requestAnimationFrame(f):r();}requestAnimationFrame(f);});})();`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const narration = SCENES.map((sc, i) => `${i + 1}. ${sc.vo}`).join("\n\n");
  writeFileSync(join(OUT, "narration.txt"), narration + "\n");

  const browser = await chromium.launch({ headless: false, args: [`--window-size=${W},${H}`, "--disable-infobars"] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
  const page = await ctx.newPage();

  for (let i = 0; i < SCENES.length; i++) {
    const sc = SCENES[i];
    try {
      if (sc.card) {
        await page.setContent(CARD_HTML(sc.caption, sc.sub), { waitUntil: "load" });
        await page.waitForTimeout(s(sc.ms));
        continue;
      }
      await page.goto(BASE + sc.path, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1500); // let SPA render
      try { await page.waitForLoadState("networkidle", { timeout: 6000 }); } catch {}
      await page.evaluate(overlayJS(sc.badge, sc.type, sc.caption, i, SCENES.length - 1));
      const dwell = s(sc.ms);
      if (sc.scroll) {
        await page.waitForTimeout(Math.round(dwell * 0.25));
        await page.evaluate(smoothScroll(Math.round(dwell * 0.5)));
        await page.waitForTimeout(Math.round(dwell * 0.25));
      } else {
        await page.waitForTimeout(dwell);
      }
    } catch (e) {
      console.error(`scene ${i} (${sc.path || sc.card}) failed:`, e.message);
    }
  }

  await ctx.close(); // flush video
  await browser.close();

  // find the webm Playwright wrote, rename, transcode to mp4 for YouTube
  const webm = readdirSync(OUT).filter((f) => f.endsWith(".webm")).map((f) => join(OUT, f)).sort().pop();
  if (webm) {
    const rawWebm = join(OUT, "slippay-demo.webm");
    if (webm !== rawWebm) renameSync(webm, rawWebm);
    try {
      execFileSync("ffmpeg", ["-y", "-i", rawWebm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", "-movflags", "+faststart", join(OUT, "slippay-demo.mp4")], { stdio: "inherit" });
      console.log("\n✓ video: demo-out/slippay-demo.mp4");
    } catch (e) {
      console.log("\nffmpeg transcode skipped:", e.message, "\nraw at demo-out/slippay-demo.webm");
    }
  }
  console.log("✓ narration script: demo-out/narration.txt");
}

main().catch((e) => { console.error(e); process.exit(1); });
